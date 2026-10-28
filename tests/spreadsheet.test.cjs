const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const workerSource = read('spreadsheet-worker.js');
function worker(xlsx = {}){
  let response;
  const context = vm.createContext({
    importScripts(url){ assert.match(url, /xlsx-0\.20\.3/); },
    self: { postMessage(data){ response = data; } }, XLSX: xlsx, TextDecoder
  });
  vm.runInContext(workerSource, context);
  return {
    async parse(name, text){
      const buffer = new TextEncoder().encode(text).buffer;
      await context.self.onmessage({ data: { file: { name, size: buffer.byteLength, arrayBuffer: async () => buffer },
        limits: { cells: 250000 } } });
      return response;
    }
  };
}
test('SheetJS version is patched in both main page and worker', () => {
  assert.match(read('index.html'), /xlsx-0\.20\.3/);
  assert.doesNotMatch(read('index.html'), /xlsx\/0\.18\.5/);
  new vm.Script(workerSource);
  new vm.Script(read('spreadsheet-reader.js'));
});
test('CSV keeps quoted delimiters, multiline fields and escaped quotes', async () => {
  const result = await worker().parse('sample.csv', 'name;value\r\n"a;b";"line1\nline2 ""quoted"""');
  assert.equal(result.sheets[0].grid[1][0], 'a;b');
  assert.equal(result.sheets[0].grid[1][1], 'line1\nline2 "quoted"');
});
test('TSV supports empty fields and rejects excessive columns', async () => {
  const parser = worker();
  const good = await parser.parse('sample.tsv', 'a\t\tc');
  assert.equal(good.sheets[0].grid[0][1], '');
  const bad = await parser.parse('bad.tsv', Array(2049).fill('x').join('\t'));
  assert.equal(bad.error, 'limits');
});
test('CSV rejects excessive rows during parsing', async () => {
  const result = await worker().parse('bad.csv', 'x\n'.repeat(50001));
  assert.equal(result.error, 'limits');
});
test('oversized declared workbook dimensions are rejected before expanding cells', async () => {
  let expanded = 0;
  const parser = worker({
    read(){ return { SheetNames: ['large'], Sheets: { large: { '!ref': 'A1:A50001', '!fullref': 'A1:A1000000' } } }; },
    utils: {
      decode_range(){ return { s: { r: 0, c: 0 }, e: { r: 999999, c: 0 } }; },
      sheet_to_json(){ expanded++; return []; }
    }
  });
  assert.equal((await parser.parse('bad.xlsx', 'fixture')).error, 'limits');
  assert.equal(expanded, 0);
});
test('all worksheets share one cell budget before any grid is expanded', async () => {
  let expanded = 0;
  const parser = worker({
    read(){ return { SheetNames: ['one', 'two'], Sheets: { one: { '!ref': 'range' }, two: { '!ref': 'range' } } }; },
    utils: {
      decode_range(){ return { s: { r: 0, c: 0 }, e: { r: 19999, c: 9 } }; },
      sheet_to_json(){ expanded++; return []; }
    }
  });
  assert.equal((await parser.parse('bad.xlsx', 'fixture')).error, 'limits');
  assert.equal(expanded, 0);
});
test('workbook offsets and hidden-row metadata survive worker parsing', async () => {
  const parser = worker({
    read(_, options){
      assert.equal(options.cellHTML, false);
      assert.equal(options.cellFormula, false);
      return { SheetNames: ['sheet'], Sheets: { sheet: { '!ref': 'C5:D5', '!rows': [{ hidden: true }] } } };
    },
    utils: {
      decode_range(){ return { s: { r: 4, c: 2 }, e: { r: 4, c: 3 } }; },
      sheet_to_json(){ return [['hello', 'world']]; }
    }
  });
  const result = await parser.parse('good.xlsx', 'fixture');
  assert.equal(result.sheets[0].r0, 4);
  assert.equal(result.sheets[0].c0, 2);
  assert.equal(result.sheets[0].rowsMeta[0].hidden, true);
});
function reader(){
  const workers = [], timers = [];
  const context = vm.createContext({
    window: {}, Worker: class {
      constructor(){ workers.push(this); }
      postMessage() {}
      terminate(){ this.terminated = true; }
    },
    setTimeout(fn){ timers.push(fn); return timers.length; }, clearTimeout() {}
  });
  vm.runInContext(read('spreadsheet-reader.js'), context);
  return { parse: context.window.readSpreadsheet, workers, timers };
}
test('parser timeout terminates worker instead of leaving the page blocked', async () => {
  const app = reader();
  const result = app.parse({}, {});
  const rejected = assert.rejects(result, /timeout/);
  app.timers[0](); await rejected;
  assert.equal(app.workers[0].terminated, true);
});
test('selecting a new file terminates the previous parser and ignores its late response', async () => {
  const app = reader();
  const first = app.parse({}, {});
  const rejected = assert.rejects(first, /cancelled/);
  const second = app.parse({}, {});
  await rejected;
  app.workers[0].onmessage({ data: { sheets: ['old'] } });
  app.workers[1].onmessage({ data: { sheets: ['new'] } });
  assert.equal((await second)[0], 'new');
  assert.equal(app.workers[0].terminated, true);
  assert.equal(app.workers[1].terminated, true);
});
test('hidden rows and columns respect nonzero worksheet offsets', () => {
  const html = read('index.html');
  const start = html.indexOf('  function makeSheet(');
  const end = html.indexOf('  let loadRevision', start);
  const makeSheet = new Function(html.slice(start, end) + ';return makeSheet;')();
  const rowsMeta = []; rowsMeta[4] = { hidden: true };
  const colsMeta = []; colsMeta[3] = { hidden: true };
  const sheet = makeSheet('offset', [['hidden', 'hidden'], ['keep', 'exclude']], 4, 2, colsMeta, rowsMeta);
  assert.deepEqual(sheet.rowNums, [6]);
  assert.deepEqual(sheet.colNums, [2, 3]);
  assert.deepEqual(sheet.rows, [['keep', 'exclude']]);
  assert.equal(sheet.hidden.has(1), true);
});
