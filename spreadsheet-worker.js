'use strict';
importScripts('https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js');
const MAX_TEXT = 16000000;
function rangeSize(range, limits){
  const rows = range.e.r - range.s.r + 1, cols = range.e.c - range.s.c + 1;
  if (!Number.isSafeInteger(rows) || !Number.isSafeInteger(cols) || rows <= 0 || cols <= 0 ||
      rows > limits.rows || cols > limits.columns || rows * cols > limits.cells) throw new Error('limits');
  return rows * cols;
}
function csv(text, delimiter, limits){
  const rows = []; let row = [], field = '', quoted = false, width = 0;
  function cell(){
    row.push(field); field = '';
    if (row.length > limits.columns) throw new Error('limits');
  }
  function line(){
    cell(); width = Math.max(width, row.length); rows.push(row); row = [];
    if (rows.length > limits.rows || rows.length * width > limits.cells) throw new Error('limits');
  }
  for (let i = 0; i < text.length; i++){
    const ch = text[i];
    if (quoted){
      if (ch === '"'){ if (text[i + 1] === '"'){ field += '"'; i++; } else quoted = false; }
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) cell();
    else if (ch === '\n' || ch === '\r'){
      if (ch === '\r' && text[i + 1] === '\n') i++;
      line();
    } else field += ch;
  }
  if (field !== '' || row.length) line();
  return rows;
}
function delimiter(text){
  const sample = text.slice(0, 8192).split(/\r?\n/).slice(0, 5).join('\n');
  const counts = { ';': 0, ',': 0, '\t': 0 }; let quoted = false;
  for (const ch of sample){ if (ch === '"') quoted = !quoted; else if (!quoted && ch in counts) counts[ch]++; }
  return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
}
self.onmessage = async ({ data: { file, limits } }) => {
  try {
    // Upper bounds are fixed in this worker; caller options may only lower them.
    limits = { cells: Math.min(limits.cells, 250000), rows: 50000, columns: 2048 };
    if (file.size > 40 * 1048576) throw new Error('limits');
    const buffer = await file.arrayBuffer();
    const ext = file.name.split('.').pop().toLowerCase();
    let sheets;
    if (['csv', 'tsv', 'txt'].includes(ext)){
      let text = new TextDecoder('utf-8').decode(buffer);
      if (text.includes('\uFFFD')) text = new TextDecoder('windows-1252').decode(buffer);
      if (text.length > MAX_TEXT) throw new Error('limits');
      text = text.replace(/^\uFEFF/, '');
      sheets = [{ name: file.name.replace(/\.[^.]+$/, ''), grid: csv(text, ext === 'tsv' ? '\t' : delimiter(text), limits), r0: 0, c0: 0 }];
    } else {
      const workbook = XLSX.read(buffer, { type: 'array', sheetRows: limits.rows + 1, cellFormula: false, cellHTML: false, cellStyles: true });
      if (workbook.SheetNames.length > 100) throw new Error('limits');
      let cells = 0, textSize = 0;
      // Validate every declared range before expanding any worksheet into a grid.
      const ranges = workbook.SheetNames.map(name => {
        const ws = workbook.Sheets[name];
        if (!ws || !ws['!ref']) return null;
        const range = XLSX.utils.decode_range(ws['!fullref'] || ws['!ref']);
        cells += rangeSize(range, limits);
        if (cells > limits.cells) throw new Error('limits');
        return range;
      });
      sheets = workbook.SheetNames.map((name, i) => {
        const ws = workbook.Sheets[name], range = ranges[i];
        if (!range) return { name, grid: [], r0: 0, c0: 0 };
        const grid = XLSX.utils.sheet_to_json(ws, { range, header: 1, raw: false, defval: '', blankrows: true });
        for (const row of grid) for (const value of row){
          textSize += String(value ?? '').length;
          if (textSize > MAX_TEXT) throw new Error('limits');
        }
        return { name, grid, r0: range.s.r, c0: range.s.c,
          colsMeta: ws['!cols'], rowsMeta: ws['!rows'] };
      });
    }
    self.postMessage({ sheets });
  } catch (e){ self.postMessage({ error: e.message === 'limits' ? 'limits' : 'parse' }); }
};
