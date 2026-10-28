const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const accountCode = html.slice(html.indexOf('const TOOL_IDS ='), html.indexOf('Auth.init();'));
const state = { ilimitado: false, restantes: 2, limite: 3 };
function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}
function setup({ available = true, rpc = async () => ({ data: state }), save = async () => 'saved' } = {}) {
  const values = new Map(), elements = new Map(), timers = [], session = deferred();
  let authCallback, authLocked = false, logoutError = null;
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      hidden: true, value: '', textContent: '', dataset: {}, disabled: false,
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      addEventListener(name, fn) { this[name] = fn; },
      setAttribute() {}, removeAttribute() {}, querySelectorAll() { return []; },
      contains() { return false; }, focus() {}, append() {}
    });
    return elements.get(id);
  };
  const client = {
    rpc(...args) {
      assert.equal(authLocked, false, 'RPC must run outside the Auth callback');
      return rpc(...args);
    },
    auth: {
      onAuthStateChange(fn) { authCallback = fn; },
      getSession() { return session.promise; },
      async signOut() { return { error: logoutError }; }
    }
  };
  const context = vm.createContext({
    window: { APP_CONFIG: { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'a'.repeat(30) },
      supabase: available ? { createClient: () => client } : undefined },
    document: { getElementById: element, querySelectorAll: () => [],
      addEventListener() {}, body: element('body') },
    qs: element, navigator: { onLine: true }, console: { warn() {} },
    Intl, Date, setTimeout: fn => { timers.push(fn); },
    localStorage: { getItem: k => values.get(k) || null, setItem: (k, v) => values.set(k, v) },
    saveFile: save
  });
  vm.runInContext(accountCode + `
    renderQuota = () => {};
    globalThis.api = { Server, Auth, gateCheck, saveWithQuota,
      user: () => currentUser, ready: () => authReady,
      setSession(user) { Server.clear(); currentUser = user; authReady = true; } };
  `, context);
  return { ...context.api, elements, session,
    emit(event, user) { authLocked = true; try { authCallback(event, user ? { user } : null); } finally { authLocked = false; } },
    flushTimers() { while (timers.length) timers.shift()(); },
    failLogout(error) { logoutError = error; }
  };
}

test('all inline scripts parse', () => {
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
  assert.ok(scripts.length > 1);
  for (const match of scripts) new vm.Script(match[1]);
});
test('failed guest downloads restore the local allowance', async () => {
  let attempts = 0;
  const app = setup({ save: async () => { if (++attempts === 1) throw new Error('download'); return 'saved'; } });
  app.setSession(null);
  await assert.rejects(app.saveWithQuota('fp'), /download/);
  assert.equal(app.gateCheck(), 'ok');
  assert.equal(await app.saveWithQuota('fp'), 'saved');
});
test('missing SDK blocks both processing and saving', async () => {
  let saved = 0;
  const app = setup({ available: false, save: async () => { saved++; } });
  assert.equal(app.gateCheck(), 'unavailable');
  assert.equal(await app.saveWithQuota('fp'), 'unavailable');
  assert.equal(saved, 0);
});
test('session restoration must finish before guest conversion', async () => {
  const app = setup();
  assert.equal(app.gateCheck(), 'loading');
  assert.equal(await app.saveWithQuota('fp'), 'loading');
  app.setSession(null);
  assert.equal(app.gateCheck(), 'ok');
});
test('missing, invalid or failed quota does not authorize processing', async () => {
  for (const rpc of [async () => ({ data: null }), async () => ({ data: { restantes: '9' } }),
    async () => { throw new Error('network'); }]) {
    const app = setup({ rpc });
    app.setSession({ id: 'a' });
    await app.Server.refresh();
    assert.equal(app.gateCheck(), 'quota');
    assert.equal(app.Server.canConvert(), false);
  }
});
test('quota refresh from a previous session cannot overwrite the current account', async () => {
  const pending = deferred();
  const app = setup({ rpc: () => pending.promise });
  app.setSession({ id: 'a' });
  const refresh = app.Server.refresh();
  app.setSession({ id: 'b' });
  pending.resolve({ data: state });
  await refresh;
  assert.equal(app.Server.state(), null);
});
test('session change during consumption prevents download', async () => {
  const pending = deferred();
  let saved = 0;
  const app = setup({ rpc: () => pending.promise, save: async () => { saved++; return 'saved'; } });
  app.setSession({ id: 'a' });
  const result = app.saveWithQuota('fp');
  app.setSession({ id: 'b' });
  pending.resolve({ data: { ...state, ok: true } });
  assert.equal(await result, 'session');
  assert.equal(saved, 0);
});
test('concurrent download requests consume quota only once', async () => {
  const pending = deferred();
  let calls = 0;
  const app = setup({ rpc: () => { calls++; return pending.promise; } });
  app.setSession({ id: 'a' });
  const first = app.saveWithQuota('fp');
  assert.equal(await app.saveWithQuota('jp'), 'busy');
  pending.resolve({ data: { ...state, ok: true } });
  assert.equal(await first, 'saved');
  assert.equal(calls, 1);
});
test('invalid tools and malformed consumption responses never download', async () => {
  let saved = 0, calls = 0;
  const app = setup({ rpc: async () => { calls++; return { data: { ok: true } }; },
    save: async () => { saved++; return 'saved'; } });
  app.setSession({ id: 'a' });
  assert.equal(await app.saveWithQuota('unknown'), 'quota');
  assert.equal(calls, 0);
  assert.equal(await app.saveWithQuota('fp'), 'quota');
  assert.equal(saved, 0);
});
test('authenticated cancellation explains that quota was consumed', async () => {
  const app = setup({ rpc: async () => ({ data: { ...state, ok: true } }), save: async () => 'declined' });
  app.setSession({ id: 'a' });
  assert.equal(await app.saveWithQuota('fp'), 'declined-counted');
});
test('download exceptions release the serialization lock', async () => {
  let attempts = 0;
  const app = setup({ rpc: async () => ({ data: { ...state, ok: true } }),
    save: async () => { if (++attempts === 1) throw new Error('download'); return 'saved'; } });
  app.setSession({ id: 'a' });
  await assert.rejects(app.saveWithQuota('fp'), /download/);
  assert.equal(await app.saveWithQuota('fp'), 'saved');
});
test('Auth callbacks defer RPC and stale initial sessions do not replace newer events', async () => {
  const app = setup();
  app.Auth.init();
  app.emit('SIGNED_IN', { id: 'new', email: 'new@example.com' });
  assert.equal(app.user().id, 'new');
  app.session.resolve({ data: { session: { user: { id: 'old' } } } });
  await Promise.resolve();
  app.flushTimers();
  await Promise.resolve();
  assert.equal(app.user().id, 'new');
});
test('failed logout keeps the account and displays a retry message', async () => {
  const app = setup();
  app.Auth.init();
  app.emit('SIGNED_IN', { id: 'a', email: 'a@example.com' });
  app.failLogout(new Error('network'));
  await app.elements.get('logoutBtn').click();
  assert.equal(app.user().id, 'a');
  assert.match(app.elements.get('authErr').textContent, /Não foi possível sair/);
  assert.equal(app.elements.get('logoutBtn').disabled, false);
});
