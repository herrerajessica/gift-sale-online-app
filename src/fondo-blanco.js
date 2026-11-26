// Fondo blanco gratis, en el mismo celular o computadora: no pasa por AWS ni por ningún servicio de pago.
// Modelo U²-Net pequeño (u2netp, 4,4 MB, licencia Apache-2.0) con ONNX Runtime Web.
// La primera vez descarga el programa y el modelo; después el navegador los guarda.

const ORT_VERSION = '1.20.1';
const ORT_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
const MODELO = 'https://huggingface.co/edgetools/u2netp/resolve/main/u2netp.onnx';
const LADO = 320;
const MEDIA = [0.485, 0.456, 0.406], DESV = [0.229, 0.224, 0.225];

let sesion = null;

function cargarScript(src) {
  return new Promise((res, rej) => {
    if (window.ort) return res();
    const s = document.createElement('script');
    s.src = src; s.async = true; s.crossOrigin = 'anonymous';
    s.onload = () => res(); s.onerror = () => rej(new Error('No se pudo descargar el programa de fondo blanco. Revisa tu conexión.'));
    document.head.append(s);
  });
}

async function preparar(alAvanzar) {
  if (sesion) return sesion;
  alAvanzar?.('Descargando el programa (solo la primera vez)…');
  await cargarScript(ORT_BASE + 'ort.min.js');
  const ort = window.ort;
  ort.env.wasm.wasmPaths = ORT_BASE;
  ort.env.wasm.numThreads = 1; // sin requisitos especiales del servidor (cross-origin isolation)
  alAvanzar?.('Descargando el modelo (4 MB, solo la primera vez)…');
  const r = await fetch(MODELO);
  if (!r.ok) throw new Error('No se pudo descargar el modelo de fondo blanco.');
  const bytes = new Uint8Array(await r.arrayBuffer());
  sesion = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
  return sesion;
}

async function abrir(fuente) {
  if (fuente instanceof Blob && window.createImageBitmap) {
    try { return await createImageBitmap(fuente, { imageOrientation: 'from-image' }); } catch { /* se intenta con <img> */ }
  }
  const url = fuente instanceof Blob ? URL.createObjectURL(fuente) : fuente;
  try {
    return await new Promise((res, rej) => {
      const i = new Image(); if (!(fuente instanceof Blob)) i.crossOrigin = 'anonymous';
      i.onload = () => res(i); i.onerror = () => rej(new Error('No se pudo abrir la foto')); i.src = url;
    });
  } finally { if (fuente instanceof Blob) setTimeout(() => URL.revokeObjectURL(url), 1000); }
}

// Pone sobre blanco la imagen recortada con una máscara (canvas con alfa), a tamaño W×H.
async function componer(img, mascara, W, H) {
  const recorte = document.createElement('canvas'); recorte.width = W; recorte.height = H;
  const gr = recorte.getContext('2d');
  gr.drawImage(img, 0, 0, W, H);
  gr.globalCompositeOperation = 'destination-in'; gr.imageSmoothingQuality = 'high';
  gr.drawImage(mascara, 0, 0, W, H);
  const out = document.createElement('canvas'); out.width = W; out.height = H;
  const go = out.getContext('2d'); go.fillStyle = '#fff'; go.fillRect(0, 0, W, H); go.drawImage(recorte, 0, 0);
  const b = await new Promise((res) => out.toBlob(res, 'image/jpeg', 0.9));
  if (!b || b.size < 1000) throw new Error('El celular no pudo procesar esta foto');
  return b;
}

// "Con su caja": se borra solo el fondo que toca los bordes de la foto (mesa, tela, pared), avanzando
// mientras el color cambie poco. Lo que queda encerrado —la caja y lo que está dentro— se conserva.
function mascaraConCaja(img) {
  const w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height, k = Math.min(1, 480 / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * k)), h = Math.max(1, Math.round(h0 * k));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data, n = w * h;
  const dist = (a, b) => { const x = d[a * 4] - d[b * 4], y = d[a * 4 + 1] - d[b * 4 + 1], z = d[a * 4 + 2] - d[b * 4 + 2]; return Math.sqrt(x * x + y * y + z * z); };
  // Color típico del borde (mediana por canal)
  const borde = [];
  for (let x = 0; x < w; x++) borde.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) borde.push(y * w, y * w + w - 1);
  const med = [0, 1, 2].map((ch) => { const v = borde.map((p) => d[p * 4 + ch]).sort((a, b) => a - b); return v[v.length >> 1]; });
  const lejosDelBorde = (p) => { const x = d[p * 4] - med[0], y = d[p * 4 + 1] - med[1], z = d[p * 4 + 2] - med[2]; return Math.sqrt(x * x + y * y + z * z) > 110; };
  const fondo = new Uint8Array(n), cola = new Int32Array(n); let ini = 0, fin = 0;
  for (const p of borde) if (!fondo[p] && !lejosDelBorde(p)) { fondo[p] = 1; cola[fin++] = p; }
  while (ini < fin) {
    const p = cola[ini++], x = p % w;
    for (const q of [p - w, p + w, x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1]) {
      if (q < 0 || q >= n || fondo[q]) continue;
      if (dist(p, q) < 16 && !lejosDelBorde(q)) { fondo[q] = 1; cola[fin++] = q; }
    }
  }
  let objeto = 0; for (let p = 0; p < n; p++) if (!fondo[p]) objeto++;
  // Si casi no quedó nada o casi todo quedó, no se pudo separar la caja del fondo.
  if (objeto < n * 0.05 || objeto > n * 0.97) return null;
  const m = document.createElement('canvas'); m.width = w; m.height = h;
  const gm = m.getContext('2d'); const md = gm.createImageData(w, h);
  for (let p = 0; p < n; p++) md.data[p * 4 + 3] = fondo[p] ? 0 : 255;
  gm.putImageData(md, 0, 0);
  // Bordes un poco suaves
  const s = document.createElement('canvas'); s.width = w; s.height = h;
  const gs = s.getContext('2d'); try { gs.filter = 'blur(1px)'; } catch { /* sin filtro */ } gs.drawImage(m, 0, 0);
  return s;
}

/**
 * Devuelve dos versiones con fondo blanco (JPG): { conCaja, soloProducto } (conCaja puede ser null).
 * fuente: archivo o URL. alAvanzar(texto) informa el paso (descarga, procesamiento).
 */
export async function ponerFondoBlanco(fuente, alAvanzar, max = 2048) {
  const img = await abrir(fuente);
  const w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height, k = Math.min(1, max / Math.max(w0, h0));
  const W = Math.round(w0 * k), H = Math.round(h0 * k);
  let conCaja = null;
  try { const mc = mascaraConCaja(img); if (mc) conCaja = await componer(img, mc, W, H); } catch (e) { console.warn('Fondo con caja', e); }

  let soloProducto = null;
  try {
    const ses = await preparar(alAvanzar);
    alAvanzar?.('Quitando el fondo…');
    // Entrada: 320×320 RGB, como la usa U²-Net (sin conservar proporción), normalizada.
    const peq = document.createElement('canvas'); peq.width = peq.height = LADO;
    const gp = peq.getContext('2d', { willReadFrequently: true }); gp.drawImage(img, 0, 0, LADO, LADO);
    const px = gp.getImageData(0, 0, LADO, LADO).data;
    let maxPx = 1; for (let i = 0; i < px.length; i += 4) maxPx = Math.max(maxPx, px[i], px[i + 1], px[i + 2]);
    const n = LADO * LADO, datos = new Float32Array(3 * n);
    for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) datos[c * n + i] = (px[i * 4 + c] / maxPx - MEDIA[c]) / DESV[c];
    const ort = window.ort;
    const salida = await ses.run({ [ses.inputNames[0]]: new ort.Tensor('float32', datos, [1, 3, LADO, LADO]) });
    const pred = salida[ses.outputNames[0]].data;
    let mn = Infinity, mx = -Infinity; for (const v of pred) { if (v < mn) mn = v; if (v > mx) mx = v; }
    const m = document.createElement('canvas'); m.width = m.height = LADO;
    const gm = m.getContext('2d'); const md = gm.createImageData(LADO, LADO);
    let cubierto = 0;
    for (let i = 0; i < n; i++) {
      const v = (pred[i] - mn) / ((mx - mn) || 1);
      const a = Math.max(0, Math.min(1, (v - 0.15) / 0.7));
      md.data[i * 4 + 3] = Math.round(a * 255); if (a > 0.5) cubierto++;
    }
    gm.putImageData(md, 0, 0);
    if (cubierto >= n * 0.01) soloProducto = await componer(img, m, W, H);
  } catch (e) { if (!conCaja) throw e; console.warn('Fondo solo producto', e); }
  if (img.close) img.close();
  if (!conCaja && !soloProducto) throw new Error('No se encontró el producto en la foto');
  return { conCaja, soloProducto };
}

/**
 * Ventana con la foto original y las versiones con fondo blanco. opciones: [{titulo, url, valor}].
 * Resuelve el valor elegido, o null para dejar la original.
 */
export function compararFondo(antesUrl, opciones, contenedor = document.body) {
  return new Promise((res) => {
    const ov = document.createElement('div'); ov.className = 'fb-ov';
    const caja = document.createElement('div'); caja.className = 'fb-caja';
    caja.setAttribute('role', 'dialog'); caja.setAttribute('aria-modal', 'true'); caja.setAttribute('aria-label', 'Fondo blanco');
    const fin = (v) => { ov.remove(); res(v); };
    const h = document.createElement('h3'); h.textContent = 'Elige cómo queda';
    const par = document.createElement('div'); par.className = 'fb-par fb-n' + (opciones.length + 1);
    const fig = (url, titulo, valor) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'fb-op' + (valor == null ? ' fb-original' : '');
      const i = document.createElement('img'); i.src = url; i.alt = titulo;
      const t = document.createElement('span'); t.textContent = titulo;
      b.append(i, t); b.onclick = () => fin(valor ?? null); return b;
    };
    par.append(fig(antesUrl, 'Dejar la original', null), ...opciones.map((o) => fig(o.url, o.titulo, o.valor)));
    const nota = document.createElement('p'); nota.className = 'fb-nota';
    nota.textContent = 'Toca la que quieres usar. Revisa que no se haya borrado parte del producto.';
    caja.append(h, par, nota); ov.append(caja);
    ov.onclick = (e) => { if (e.target === ov) fin(null); };
    contenedor.append(ov); par.querySelector('button:not(.fb-original)')?.focus();
  });
}
