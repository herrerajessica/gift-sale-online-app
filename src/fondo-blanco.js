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

/**
 * Devuelve la foto con fondo blanco (JPG). fuente: archivo o URL.
 * alAvanzar(texto) informa el paso (descarga, procesamiento).
 */
export async function ponerFondoBlanco(fuente, alAvanzar, max = 2048) {
  const ses = await preparar(alAvanzar);
  alAvanzar?.('Quitando el fondo…');
  const img = await abrir(fuente);
  const w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height, k = Math.min(1, max / Math.max(w0, h0));
  const W = Math.round(w0 * k), H = Math.round(h0 * k);

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

  // Máscara: normalizada entre 0 y 1, con bordes suaves.
  let mn = Infinity, mx = -Infinity; for (const v of pred) { if (v < mn) mn = v; if (v > mx) mx = v; }
  const m = document.createElement('canvas'); m.width = m.height = LADO;
  const gm = m.getContext('2d'); const md = gm.createImageData(LADO, LADO);
  for (let i = 0; i < n; i++) {
    const v = (pred[i] - mn) / ((mx - mn) || 1);
    const a = Math.max(0, Math.min(1, (v - 0.15) / 0.7));
    md.data[i * 4] = md.data[i * 4 + 1] = md.data[i * 4 + 2] = 0; md.data[i * 4 + 3] = Math.round(a * 255);
  }
  gm.putImageData(md, 0, 0);
  let cubierto = 0; for (let i = 0; i < n; i++) if (md.data[i * 4 + 3] > 128) cubierto++;
  if (cubierto < n * 0.01) throw new Error('No se encontró el producto en la foto');

  // Producto recortado con la máscara (agrandada con suavizado) sobre blanco.
  const recorte = document.createElement('canvas'); recorte.width = W; recorte.height = H;
  const gr = recorte.getContext('2d');
  gr.drawImage(img, 0, 0, W, H);
  gr.globalCompositeOperation = 'destination-in'; gr.imageSmoothingQuality = 'high';
  gr.drawImage(m, 0, 0, W, H);
  const out = document.createElement('canvas'); out.width = W; out.height = H;
  const go = out.getContext('2d'); go.fillStyle = '#fff'; go.fillRect(0, 0, W, H); go.drawImage(recorte, 0, 0);
  if (img.close) img.close();
  const b = await new Promise((res) => out.toBlob(res, 'image/jpeg', 0.9));
  if (!b || b.size < 1000) throw new Error('El celular no pudo procesar esta foto');
  return b;
}

/** Ventana con antes y después: resuelve true (usar) o false (dejar la original). */
export function compararFondo(antesUrl, despuesUrl, contenedor = document.body) {
  return new Promise((res) => {
    const ov = document.createElement('div'); ov.className = 'fb-ov';
    ov.innerHTML = `<div class="fb-caja" role="dialog" aria-modal="true" aria-label="Fondo blanco">
      <h3>Fondo blanco</h3>
      <div class="fb-par"><figure><img alt="Antes"><figcaption>Antes</figcaption></figure><figure><img alt="Después"><figcaption>Después</figcaption></figure></div>
      <p class="fb-nota">Revisa que no se haya borrado parte del producto.</p>
      <div class="fb-botones"><button type="button" class="btn">Dejar la original</button><button type="button" class="btn primary">Usar este</button></div></div>`;
    const [a, d] = ov.querySelectorAll('img'); a.src = antesUrl; d.src = despuesUrl;
    const [no, si] = ov.querySelectorAll('button');
    const fin = (v) => { ov.remove(); res(v); };
    no.onclick = () => fin(false); si.onclick = () => fin(true);
    ov.onclick = (e) => { if (e.target === ov) fin(false); };
    contenedor.append(ov); si.focus();
  });
}
