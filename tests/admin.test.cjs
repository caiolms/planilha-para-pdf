const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../admin.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
function deferred(){
  let resolve; const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}
const snapshot = {
  usuarios_total: 2, conversoes_hoje: 3, conversoes_total: 9, limite_padrao: 0,
  atualizado_em: '2026-10-28T15:00:00Z',
  usuarios: [{ nome: '<img src=x onerror=alert(1)>', email: 'a@example.com',
    criado_em: '2026-10-28T15:00:00Z', conversoes_hoje: 3, limite_diario: 0 }],
  recentes: [{ email: 'a@example.com', ferramenta: 'planilha-pdf', criado_em: '2026-10-28T15:00:00Z' }]
};
function setup(rpc = async () => ({ data: snapshot })){
  const elements = new Map(), timers = [];
  let user = null, calls = 0;
  const element = () => ({
    hidden: true, textContent: '', children: [],
    replaceChildren(){ this.children = []; },
    appendChild(child){ this.children.push(child); },
    querySelectorAll(){ return [...elements.entries()]
      .filter(([id]) => !['adminPanel', 'adminUsers', 'adminConversions'].includes(id)).map(([, el]) => el); }
  });
  const get = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  for (const id of ['adminPanel', 'adminUsers', 'adminConversions', 'adminUserCount', 'adminTodayCount',
    'adminTotalCount', 'adminDefaultLimit', 'adminUpdated', 'adminNotice']) get(id);
  const context = vm.createContext({
    window: {}, document: { getElementById: get, createElement: element },
    Date, setTimeout: fn => { timers.push(fn); }
  });
  vm.runInContext(source, context);
  const panel = context.window.createAdminPanel({
    client: { rpc(name){ assert.equal(name, 'admin_painel'); calls++; return rpc(); } },
    getUser: () => user
  });
  return {
    panel, get, calls: () => calls,
    sync(next){ user = next; panel.sync(next); },
    async flush(){ while (timers.length) timers.shift()(); await Promise.resolve(); await Promise.resolve(); }
  };
}
test('admin markup starts hidden and has no entry or editing button', () => {
  const section = html.match(/<section class="admin-panel"[\s\S]*?<\/section>/)[0];
  assert.match(section, /id="adminPanel"[^>]*hidden/);
  assert.doesNotMatch(section, /<button|<input|<form|<a\s/i);
  assert.ok(html.indexOf('src="admin.js"') < html.indexOf('const Admin ='));
});
test('anonymous users trigger no administrative request', async () => {
  const app = setup();
  app.sync(null); await app.flush();
  assert.equal(app.calls(), 0);
  assert.equal(app.get('adminPanel').hidden, true);
});
test('email or metadata alone does not reveal the panel when server denies access', async () => {
  const app = setup(async () => ({ error: { code: '42501' }, data: null }));
  app.sync({ id: 'ordinary', email: 'caiolms98@yahoo.com.br', user_metadata: { admin: true } });
  assert.equal(app.calls(), 0, 'RPC is deferred out of Auth callbacks');
  await app.flush();
  assert.equal(app.calls(), 1);
  assert.equal(app.get('adminPanel').hidden, true);
  assert.equal(app.get('adminUsers').children.length, 0);
});
test('authorized server response renders real metrics and text without HTML insertion', async () => {
  const app = setup();
  app.sync({ id: 'admin' }); await app.flush();
  assert.equal(app.get('adminPanel').hidden, false);
  assert.equal(app.get('adminUserCount').textContent, '2');
  assert.equal(app.get('adminDefaultLimit').textContent, 'Sem limite');
  assert.equal(app.get('adminUsers').children[0].children[0].textContent, snapshot.usuarios[0].nome);
  assert.doesNotMatch(source, /innerHTML/);
});
test('logout removes every previously displayed administrative value', async () => {
  const app = setup();
  app.sync({ id: 'admin' }); await app.flush();
  app.sync(null);
  assert.equal(app.get('adminPanel').hidden, true);
  assert.equal(app.get('adminUserCount').textContent, '');
  assert.equal(app.get('adminUsers').children.length, 0);
  assert.equal(app.get('adminConversions').children.length, 0);
});
test('a delayed response cannot leak data after switching accounts', async () => {
  const pending = deferred(), app = setup(() => pending.promise);
  app.sync({ id: 'admin' }); await app.flush();
  app.sync({ id: 'ordinary' });
  pending.resolve({ data: snapshot }); await Promise.resolve(); await Promise.resolve();
  assert.equal(app.get('adminPanel').hidden, true);
  assert.equal(app.get('adminUsers').children.length, 0);
});
test('revocation or network failure on refresh clears previously loaded data', async () => {
  for (const fail of [async () => ({ error: { code: '42501' } }), async () => { throw new Error('network'); }]){
    let count = 0;
    const app = setup(() => ++count === 1 ? Promise.resolve({ data: snapshot }) : fail());
    app.sync({ id: 'admin' }); await app.flush();
    assert.equal(app.get('adminPanel').hidden, false);
    await app.panel.refresh();
    assert.equal(app.get('adminPanel').hidden, true);
    assert.equal(app.get('adminUserCount').textContent, '');
  }
});
test('malformed data never opens an administrative panel', async () => {
  const app = setup(async () => ({ data: { usuarios_total: '2', usuarios: [], recentes: [] } }));
  app.sync({ id: 'admin' }); await app.flush();
  assert.equal(app.get('adminPanel').hidden, true);
});
test('a transient failure does not disable subsequent administrative refreshes', async () => {
  let calls = 0;
  const app = setup(async () => ++calls === 2 ? { error: { message: 'network' } } : { data: snapshot });
  app.sync({ id: 'admin' }); await app.flush();
  await app.panel.refresh();
  assert.equal(app.get('adminPanel').hidden, true);
  await app.panel.refresh();
  assert.equal(calls, 3);
  assert.equal(app.get('adminPanel').hidden, false);
});
test('an explicit authorization denial disables refresh until the next session check', async () => {
  let calls = 0;
  const app = setup(async () => ++calls === 1 ? { data: snapshot } : { error: { code: '42501' } });
  app.sync({ id: 'admin' }); await app.flush();
  await app.panel.refresh();
  await app.panel.refresh();
  assert.equal(calls, 2);
  assert.equal(app.get('adminPanel').hidden, true);
});
