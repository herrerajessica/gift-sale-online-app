// Verifica que cada caso automatizable de la matriz:
//  1) exista como test en el script indicado (por ID de caso), y
//  2) esté aprobado por QA.
// Falla (exit 1) si algo no cuadra. Se usa en GitHub Actions y en CodeBuild.
const fs = require('fs');
const path = require('path');

const MATRIZ = path.join(__dirname, '..', 'docs', 'matriz-trazabilidad.csv');
const requireApproval = process.argv.includes('--require-approval');

function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(v => v.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...data] = rows;
  return data.map(r => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] || '').trim()])));
}

const filas = parseCSV(fs.readFileSync(MATRIZ, 'utf8'));
const errores = [];

for (const f of filas) {
  if (!/^s[ií]$/i.test(f.Automatizable)) continue;
  const script = path.join(__dirname, '..', f.Script_Playwright);
  if (!fs.existsSync(script)) {
    errores.push(`${f.ID_Caso_Manual}: no existe el script ${f.Script_Playwright}`);
  } else if (!fs.readFileSync(script, 'utf8').includes(f.ID_Caso_Manual)) {
    errores.push(`${f.ID_Caso_Manual}: no hay test con ese ID en ${f.Script_Playwright}`);
  }
  if (requireApproval && f.Estado_Revision_QA !== 'Aprobado') {
    errores.push(`${f.ID_Caso_Manual}: estado QA = "${f.Estado_Revision_QA || 'vacío'}" (se requiere "Aprobado")`);
  }
}

const reqs = new Set(filas.map(f => f.ID_Requerimiento));
console.log(`Requerimientos: ${reqs.size} | Casos: ${filas.length} | Automatizables: ${filas.filter(f => /^s[ií]$/i.test(f.Automatizable)).length}`);

if (errores.length) {
  console.error('\nProblemas de trazabilidad:\n - ' + errores.join('\n - '));
  process.exit(1);
}
console.log('Trazabilidad OK');
