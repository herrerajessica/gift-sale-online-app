// Código QR (modo byte, corrección M, versiones 1 a 10). Sin librerías: basado en el algoritmo de la norma ISO 18004.
// qrMatriz("https://…") → arreglo de filas con true (negro) / false (blanco).

const ECC_M = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];        // códigos de corrección por bloque
const BLOQUES_M = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];               // número de bloques

function modulosTotales(v) {
  let r = (16 * v + 128) * v + 64;
  if (v >= 2) { const n = Math.floor(v / 7) + 2; r -= (25 * n - 10) * n - 55; if (v >= 7) r -= 36; }
  return r;
}
const bytesDatos = (v) => Math.floor(modulosTotales(v) / 8) - ECC_M[v] * BLOQUES_M[v];

// Reed-Solomon en GF(256)
function mulGF(x, y) { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; } return z & 0xff; }
function divisorRS(grado) {
  const r = new Array(grado).fill(0); r[grado - 1] = 1; let raiz = 1;
  for (let i = 0; i < grado; i++) {
    for (let j = 0; j < r.length; j++) { r[j] = mulGF(r[j], raiz); if (j + 1 < r.length) r[j] ^= r[j + 1]; }
    raiz = mulGF(raiz, 0x02);
  }
  return r;
}
function restoRS(datos, div) {
  const r = div.map(() => 0);
  for (const b of datos) { const f = b ^ r.shift(); r.push(0); div.forEach((c, i) => { r[i] ^= mulGF(c, f); }); }
  return r;
}

function posicionesAlineacion(v) {
  if (v === 1) return [];
  const n = Math.floor(v / 7) + 2, paso = Math.floor((v * 8 + n * 3 + 5) / (n * 4 - 4)) * 2, r = [6];
  for (let p = v * 4 + 10; r.length < n; p -= paso) r.splice(1, 0, p);
  return r;
}

export function qrMatriz(texto) {
  const datos = [...new TextEncoder().encode(String(texto))];
  let v = 1;
  for (; v <= 10; v++) if (datos.length + (v < 10 ? 2 : 3) <= bytesDatos(v)) break;
  if (v > 10) throw new Error('Texto muy largo para el QR');

  // Bits: modo byte (0100) + largo + datos + terminador + relleno
  const bits = [];
  const poner = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  poner(4, 4); poner(datos.length, v < 10 ? 8 : 16); datos.forEach((b) => poner(b, 8));
  const cap = bytesDatos(v) * 8;
  poner(0, Math.min(4, cap - bits.length));
  poner(0, (8 - (bits.length % 8)) % 8);
  for (let p = 0xec; bits.length < cap; p ^= 0xec ^ 0x11) poner(p, 8);
  const bytes = []; for (let i = 0; i < bits.length; i += 8) bytes.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));

  // Bloques con corrección de errores, intercalados
  const nb = BLOQUES_M[v], ecc = ECC_M[v], cortos = nb - (Math.floor(modulosTotales(v) / 8) % nb), largoCorto = Math.floor(Math.floor(modulosTotales(v) / 8) / nb);
  const div = divisorRS(ecc), bloques = [];
  for (let i = 0, k = 0; i < nb; i++) {
    const d = bytes.slice(k, k + largoCorto - ecc + (i < cortos ? 0 : 1)); k += d.length;
    const e = restoRS(d, div); if (i < cortos) d.push(0); bloques.push(d.concat(e));
  }
  const final = [];
  for (let i = 0; i < bloques[0].length; i++) bloques.forEach((b, j) => { if (i !== largoCorto - ecc || j >= cortos) final.push(b[i]); });

  // Matriz y patrones fijos
  const t = v * 4 + 17, m = Array.from({ length: t }, () => new Array(t).fill(false)), fijo = Array.from({ length: t }, () => new Array(t).fill(false));
  const set = (x, y, n) => { m[y][x] = n; fijo[y][x] = true; };
  for (let i = 0; i < t; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const buscador = (cx, cy) => { for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const d = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy; if (x >= 0 && x < t && y >= 0 && y < t) set(x, y, d !== 2 && d !== 4); } };
  buscador(3, 3); buscador(t - 4, 3); buscador(3, t - 4);
  const al = posicionesAlineacion(v);
  al.forEach((a, i) => al.forEach((b, j) => { if (!((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0))) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(a + dx, b + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1); }));
  const formato = (mask) => {
    const d = (0 << 3) | mask; let r = d; for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
    const b = ((d << 10) | r) ^ 0x5412, bit = (i) => ((b >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(t - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, t - 15 + i, bit(i));
    set(8, t - 8, true);
  };
  formato(0);
  if (v >= 7) {
    let r = v; for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
    const b = (v << 12) | r;
    for (let i = 0; i < 18; i++) { const bit = ((b >>> i) & 1) !== 0, a = t - 11 + (i % 3), c = Math.floor(i / 3); set(a, c, bit); set(c, a, bit); }
  }

  // Datos en zigzag
  let i = 0;
  for (let der = t - 1; der >= 1; der -= 2) {
    if (der === 6) der = 5;
    for (let vert = 0; vert < t; vert++) for (let j = 0; j < 2; j++) {
      const x = der - j, arriba = ((der + 1) & 2) === 0, y = arriba ? t - 1 - vert : vert;
      if (!fijo[y][x] && i < final.length * 8) { m[y][x] = ((final[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0; i++; }
    }
  }

  // Elegir la máscara con menos penalidad
  const MASK = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => (x * y) % 2 + (x * y) % 3 === 0,
    (x, y) => ((x * y) % 2 + (x * y) % 3) % 2 === 0, (x, y) => ((x + y) % 2 + (x * y) % 3) % 2 === 0];
  const aplicar = (k) => { for (let y = 0; y < t; y++) for (let x = 0; x < t; x++) if (!fijo[y][x] && MASK[k](x, y)) m[y][x] = !m[y][x]; };
  const penalidad = () => {
    let p = 0;
    const linea = (get) => {
      for (let a = 0; a < t; a++) {
        let run = 1;
        for (let b = 1; b <= t; b++) {
          if (b < t && get(a, b) === get(a, b - 1)) run++;
          else { if (run >= 5) p += run - 2; run = 1; }
        }
        for (let b = 0; b + 10 < t + 1; b++) {
          const s = Array.from({ length: 11 }, (_, k) => (b + k < t ? get(a, b + k) : false));
          const pat = [true, false, true, true, true, false, true];
          const ok1 = pat.every((q, k) => s[k] === q) && s.slice(7, 11).every((q) => !q);
          const ok2 = s.slice(0, 4).every((q) => !q) && pat.every((q, k) => s[k + 4] === q);
          if (ok1 || ok2) p += 40;
        }
      }
    };
    linea((a, b) => m[a][b]); linea((a, b) => m[b][a]);
    for (let y = 0; y < t - 1; y++) for (let x = 0; x < t - 1; x++) { const c = m[y][x]; if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) p += 3; }
    const negros = m.reduce((s, f) => s + f.filter(Boolean).length, 0), total = t * t;
    p += Math.floor(Math.abs(negros * 20 - total * 10) / total) * 10;
    return p;
  };
  let mejor = 0, minP = Infinity;
  for (let k = 0; k < 8; k++) { aplicar(k); formato(k); const p = penalidad(); if (p < minP) { minP = p; mejor = k; } aplicar(k); }
  aplicar(mejor); formato(mejor);
  return m;
}

/** Dibuja el QR en un canvas (con borde blanco de 4 módulos). */
export function qrCanvas(texto, px = 512) {
  const m = qrMatriz(texto), n = m.length + 8, esc = Math.max(1, Math.floor(px / n));
  const c = document.createElement('canvas'); c.width = c.height = n * esc;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.fillStyle = '#000';
  m.forEach((fila, y) => fila.forEach((on, x) => { if (on) g.fillRect((x + 4) * esc, (y + 4) * esc, esc, esc); }));
  return c;
}
