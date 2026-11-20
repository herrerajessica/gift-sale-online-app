// Voz del navegador, reforzada (sin servicios de pago):
// 1) escucha(): no se corta con los silencios (se vuelve a encender sola), no repite frases (error de Android),
//    se pausa sola si la pantalla se apaga y elige, entre las opciones que oye el navegador, la que más
//    palabras conocidas tiene.
// 2) corregir(): acerca lo que entendió el navegador a un vocabulario (marcas, tipos de producto, palabras de la tienda):
//    "maicol cors" → "Michael Kors", "sige ente" → "siguiente", "abercrombi" → "Abercrombie & Fitch".

const sinTildes = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const minus = (s) => sinTildes(s).toLowerCase();

/** Clave "como suena" (español e inglés simplificados): se comparan palabras por su sonido, no por su letra. */
export function sonido(s) {
  let t = minus(s).replace(/[^a-z0-9ñ ]+/g, ' ').trim();
  // "esquechers" = "skechers": la "e" que el español pone antes de s + consonante
  t = t.replace(/(^| )es(?=[bcdfgkmnpqrtvwz])/g, '$1s').replace(/\s+/g, '');
  t = t.replace(/ph/g, 'f').replace(/sh/g, 'ch').replace(/ck/g, 'k').replace(/qu/g, 'k').replace(/q/g, 'k')
    .replace(/gu([ei])/g, 'G$1').replace(/g([ei])/g, 'j$1').replace(/G/g, 'g')
    .replace(/c([eiy])/g, 's$1').replace(/c/g, 'k').replace(/z/g, 's').replace(/x/g, 'ks')
    .replace(/v/g, 'b').replace(/w/g, 'u').replace(/ll/g, 'y').replace(/y([^aeiou]|$)/g, 'i$1')
    .replace(/[hj]/g, '').replace(/ñ/g, 'ni')
    .replace(/([a-z])\1+/g, '$1');
  // La "e" muda del inglés al final pesa poco
  return t.replace(/e$/, '');
}

function distancia(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m || !n) return m || n;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

// Palabras comunes que nunca se cambian (si no, "con" podría volverse "Coach")
const COMUNES = new Set(('a al algo con de del el en es esta este la las lo los me mi muy no o para por que se si son su sus te tengo tiene un una uno unos unas y ' +
  'hay quedan cuesta precio soles sol dolares dolar talla tallas color nuevo nueva nuevos nuevas usado usada etiqueta caja abierta marca ' +
  'correr corre ropa casa cosa caso mismo otro otra bien mas menos the and of for with new size price used box open tag dollars to in is my').split(' '));

// Cómo suelen quedar escritas las marcas en inglés cuando se dictan en español (el sonido solo no alcanza)
export const ALIAS = [
  [/\b(?:m[ai]i?[ck]o?l|maikel|michel|mikael)\s+(?:[ck]ors?|core?s)\b/i, 'Michael Kors'],
  [/\b(?:tom+[iy]\s+)?(?:j|h)il+\s*fi(?:gu|g|j)u?er\b/i, 'Tommy Hilfiger'], [/\btom+[iy]\b(?=\s+(?:polo|camisa|casaca|perfume))/i, 'Tommy Hilfiger'],
  [/\b(?:the\s+|de\s+la\s+)?nor+t?h?\s*f[ae]i?[cs]e?\b/i, 'The North Face'],
  [/\b(?:couch|cauch|co+ch)\b/i, 'Coach'], [/\b(?:yan|jan)\s*sport\b/i, 'JanSport'],
  [/\b(?:l[ei]v[ae]i?s|livais|levais)\b/i, "Levi's"], [/\b(?:[ck]alvin|calbin)\s+(?:[ck]l[ae]i?n|clein)\b/i, 'Calvin Klein'],
  [/\b(?:ral+?f|rafael)\s+lo?ren\b/i, 'Ralph Lauren'], [/\bander\s*armou?r\b/i, 'Under Armour'], [/\bnaik\b/i, 'Nike'],
  [/\b(?:bat|baz)\s+(?:and|an|en|y)\s+bod[iy]\s+(?:guor|wor|uor)ks?\b/i, 'Bath & Body Works'], [/\bvictoria'?s?\s+s[ie]?cret\b/i, "Victoria's Secret"],
  [/\b(?:es)?k[ae]tch?ers\b|\besquechers\b/i, 'Skechers'], [/\bold\s+nei?vi\b/i, 'Old Navy'], [/\bkeit\s+es?pade?\b/i, 'Kate Spade'],
  [/\bstiv\s+mad+en\b/i, 'Steve Madden'], [/\bamerican\s+igol\b/i, 'American Eagle'], [/\bab[ae]r\s*crom+bi\b(?:\s+(?:and|an|y)\s+fitch)?/i, 'Abercrombie & Fitch'],
];

/**
 * Arma el vocabulario. Cada frase puede ser texto o { txt, tipo }:
 * - 'marca': se escribe siempre como la marca (levis → Levi's) y acepta sonidos parecidos.
 * - 'clave': palabra importante del dictado ("siguiente"), acepta sonidos parecidos.
 * - 'palabra' (por defecto, tipos de producto, palabras de la tienda): solo si suena igual (no cambia "correr" por "correa").
 */
export function vocabulario(frases) {
  const vistos = new Set(), lista = [];
  for (const f of frases) {
    const txt = String((f && f.txt) || f || '').trim(), tipo = (f && f.tipo) || 'palabra';
    if (!txt || txt.length < 3) continue;
    const k = minus(txt);
    if (vistos.has(k) || COMUNES.has(k)) continue;
    vistos.add(k);
    const palabras = k.replace(/[^a-z0-9ñ&' ]+/g, ' ').split(/\s+/).filter(Boolean);
    lista.push({ txt, tipo, palabras: palabras.length, son: sonido(txt), k: k.replace(/[^a-z0-9ñ]+/g, '') });
  }
  // Primero las frases largas ("New Balance" antes que "Balance")
  return lista.sort((a, b) => b.palabras - a.palabras || b.son.length - a.son.length);
}

/** ¿Qué tan parecido suena (so) a la palabra del vocabulario? (0 = igual). Infinity si no se parece. */
function parecido(so, v) {
  if (!so || so.length < 3) return Infinity;
  if (so === v.son) return 0;
  if (v.tipo === 'palabra') return Infinity;
  // Tolerancia según el largo: palabras cortas tienen que sonar casi igual
  const tope = (v.son.length <= 4 ? 0 : v.son.length <= 7 ? 1 : v.son.length <= 11 ? 2 : 3) + (v.tipo === 'clave' ? 1 : 0);
  const d = distancia(so, v.son);
  if (d > tope) return Infinity;
  // La primera letra tiene que coincidir (evita "polera" → "Pandora")
  if (so[0] !== v.son[0]) return Infinity;
  return d;
}

/** Corrige lo que entendió el navegador acercándolo al vocabulario. Números, precios y palabras comunes no se tocan. */
export function corregir(texto, vocab) {
  if (!texto) return texto;
  // Primero las marcas que el sonido no alcanza ("maicol cors")
  // (quedan protegidas con una marca invisible para que el paso siguiente no las toque)
  let base = String(texto);
  const protegidas = [];
  for (const [re, marca] of ALIAS) base = base.replace(new RegExp(re.source, 'gi'), () => { protegidas.push(marca); return '\u0001' + (protegidas.length - 1) + '\u0001'; });
  const devolver = (x) => x.replace(/\u0001(\d+)\u0001/g, (_, i) => protegidas[+i]);
  if (!vocab || !vocab.length) return devolver(base);
  const tokens = base.split(/(\s+)/);          // conserva los espacios
  const palabras = [];                                   // índices de las palabras en tokens
  tokens.forEach((t, i) => { if (t.trim()) palabras.push(i); });
  const usado = new Array(palabras.length).fill(false);
  const reemplazos = [];
  const maxN = Math.min(3, Math.max(...vocab.map((v) => v.palabras)) + 1);
  for (let n = maxN; n >= 1; n--) {
    for (let a = 0; a + n <= palabras.length; a++) {
      if (usado.slice(a, a + n).some(Boolean)) continue;
      const trozo = palabras.slice(a, a + n).map((i) => tokens[i]);
      const limpio = trozo.map((w) => w.replace(/^[^\p{L}\p{N}&']+|[^\p{L}\p{N}&']+$/gu, ''));
      if (trozo.some((w) => w.includes('\u0001')) || limpio.some((w) => !w || /\d/.test(w))) continue;
      if (n === 1 && COMUNES.has(minus(limpio[0]))) continue;
      if (n > 1 && (COMUNES.has(minus(limpio[0])) || COMUNES.has(minus(limpio[n - 1])))) continue;
      const oido = limpio.join(' '), so = sonido(oido);
      let mejor = null, mejorD = Infinity;
      for (const v of vocab) {
        if (Math.abs(v.palabras - n) > 1) continue;
        const d = parecido(so, v);
        if (d < mejorD) { mejor = v; mejorD = d; if (d === 0) break; }
      }
      if (!mejor) continue;
      // Ya estaba bien escrito (solo cambian mayúsculas o tildes): se deja como lo dijo
      // Ya estaba bien (solo cambian mayúsculas o tildes): se deja como lo dijo, salvo las marcas (levis → Levi's)
      if (minus(oido).replace(/[^a-z0-9ñ]+/g, '') === mejor.k && n === mejor.palabras && (mejor.tipo !== 'marca' || oido === mejor.txt)) { for (let k = a; k < a + n; k++) usado[k] = true; continue; }
      for (let k = a; k < a + n; k++) usado[k] = true;
      const pre = trozo[0].match(/^[^\p{L}\p{N}&']*/u)[0], post = trozo[n - 1].match(/[^\p{L}\p{N}&']*$/u)[0];
      reemplazos.push({ desde: palabras[a], hasta: palabras[a + n - 1], txt: pre + mejor.txt + post });
    }
  }
  reemplazos.sort((x, y) => y.desde - x.desde).forEach((r) => { tokens.splice(r.desde, r.hasta - r.desde + 1, r.txt); });
  return devolver(tokens.join(''));
}

/** Cuántas palabras del vocabulario aparecen (para elegir la mejor opción de lo que oyó el navegador). */
function puntaje(texto, vocab) {
  const t = ' ' + minus(texto).replace(/[^a-z0-9ñ&' ]+/g, ' ') + ' ';
  let p = 0;
  for (const v of vocab) if (t.includes(' ' + minus(v.txt).replace(/[^a-z0-9ñ&' ]+/g, ' ').trim() + ' ')) p += v.palabras;
  return p;
}

/**
 * Escucha continua y reforzada.
 * op: { lang, vocab (de vocabulario()), unaFrase?, alTexto(final), alInterino(texto), alEstado('escuchando'|'pausa'|'silencio'|'error', detalle) }
 * Devuelve { iniciar(), pausar(), activo() }.
 */
export function escucha(SR, op) {
  let rec = null, activo = false, reinicios = [], ultimoFinal = '', ultimoCuando = 0, oyoAlgo = false, ocultoPausa = false;
  const vocab = op.vocab || [];

  function elegir(resultado) {
    // El navegador da hasta 5 versiones de lo que oyó: se queda con la que tiene más palabras conocidas
    let mejor = resultado[0].transcript, mejorP = -1;
    for (let k = 0; k < resultado.length; k++) {
      const alt = resultado[k].transcript, p = puntaje(corregir(alt, vocab), vocab) * 10 - k;
      if (p > mejorP) { mejor = alt; mejorP = p; }
    }
    return String(mejor || '').trim();
  }

  function crear() {
    const r = new SR();
    r.lang = op.lang; r.continuous = true; r.interimResults = true; r.maxAlternatives = 5;
    // Lista de palabras (Chrome casi no la usa, pero en otros navegadores ayuda)
    try {
      const G = window.SpeechGrammarList || window.webkitSpeechGrammarList;
      if (G && vocab.length) { const g = new G(); g.addFromString('#JSGF V1.0; grammar vocab; public <p> = ' + vocab.slice(0, 300).map((v) => v.txt.replace(/[|;<>*+()[\]{}"=]/g, ' ')).join(' | ') + ' ;', 1); r.grammars = g; }
    } catch { /* sin gramática */ }
    const procesados = new Set();
    r.onresult = (e) => {
      oyoAlgo = true;
      let fin = '', inter = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) {
          if (procesados.has(i)) continue;      // Android a veces manda el mismo resultado dos veces
          procesados.add(i);
          let crudo = elegir(res);
          // Android repite: la misma frase otra vez enseguida (se descarta) o acumulada
          // ("cartera negra" y luego "cartera negra coach": solo lo nuevo)
          const a = minus(ultimoFinal).trim(), b = minus(crudo).trim(), reciente = Date.now() - ultimoCuando < 2500;
          if (a && reciente && b === a) crudo = '';
          else if (a && reciente && b.startsWith(a + ' ')) crudo = crudo.slice(ultimoFinal.length).trim();
          if (crudo) { ultimoFinal = elegir(res); ultimoCuando = Date.now(); fin += corregir(crudo, vocab) + ' '; }
        } else inter += res[0].transcript;
      }
      if (fin) op.alTexto && op.alTexto(fin);
      op.alInterino && op.alInterino(inter ? corregir(inter, vocab) : '');
      // Una sola frase (chat del cliente): al terminar la frase deja de escuchar
      if (fin && op.unaFrase) pausar();
    };
    r.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture') { activo = false; op.alEstado && op.alEstado('error', e.error); }
      // no-speech, aborted, network: se reintenta en onend
    };
    r.onend = () => {
      op.alInterino && op.alInterino('');
      if (!activo) return;
      // Se cortó solo (silencio o el celular): se vuelve a encender, pero si se corta muchas veces seguidas
      // sin oír nada, se pausa para no gastar batería
      const ahora = Date.now();
      reinicios = reinicios.filter((x) => ahora - x < 20000); reinicios.push(ahora);
      if (reinicios.length > 8 && !oyoAlgo) { activo = false; op.alEstado && op.alEstado('silencio'); return; }
      if (reinicios.length > 8) { reinicios = []; oyoAlgo = false; }
      setTimeout(() => { if (!activo) return; try { rec = crear(); rec.start(); } catch { activo = false; op.alEstado && op.alEstado('error', 'start'); } }, reinicios.length > 3 ? 600 : 150);
    };
    return r;
  }

  const alCambiarVista = () => {
    if (document.hidden && activo) { ocultoPausa = true; pausar(); }
    else if (!document.hidden && ocultoPausa) { ocultoPausa = false; iniciar(); }
  };

  function iniciar() {
    if (activo) return true;
    activo = true; reinicios = []; oyoAlgo = false; ultimoFinal = '';
    document.addEventListener('visibilitychange', alCambiarVista);
    try { rec = crear(); rec.start(); op.alEstado && op.alEstado('escuchando'); return true; }
    catch { activo = false; op.alEstado && op.alEstado('error', 'start'); return false; }
  }
  function pausar() {
    activo = false;
    if (!ocultoPausa) document.removeEventListener('visibilitychange', alCambiarVista);
    try { rec && rec.stop(); } catch { /* ya estaba parado */ }
    op.alEstado && op.alEstado('pausa');
  }
  return { iniciar, pausar, activo: () => activo };
}

/**
 * Códigos dichos de palabra: "rop 3", "ropa cero cero tres", "R O P 3" → "ROP-003",
 * solo con los prefijos que existen en la tienda (para el asistente y las órdenes rápidas).
 */
export function codigosDichos(texto, prefijos) {
  const pref = [...new Set((prefijos || []).map((p) => String(p).toUpperCase()).filter((p) => /^[A-Z]{2,5}$/.test(p)))];
  if (!pref.length || !texto) return texto;
  const DIG = { cero: '0', uno: '1', una: '1', dos: '2', tres: '3', cuatro: '4', cinco: '5', seis: '6', siete: '7', ocho: '8', nueve: '9', zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9' };
  // "R O P" → "ROP"; "cero cero tres" → "003"
  let t = String(texto).replace(/\b([A-Za-z])\s+([A-Za-z])\s+([A-Za-z])\b(?=\s*[-\s]*(?:\d|cero|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve))/g, '$1$2$3');
  t = t.replace(/\b(?:cero|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|zero|one|two|three|four|five|six|seven|eight|nine)(?:\s+(?:cero|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|zero|one|two|three|four|five|six|seven|eight|nine))*\b/gi,
    (m, off, all) => /[A-Za-z]{2,6}[\s-]*$/.test(all.slice(0, off)) ? m.split(/\s+/).map((w) => DIG[minus(w)]).join('') : m);
  return t.replace(/\b([A-Za-zÁÉÍÓÚáéíóú]{2,6})[\s-]*(\d{1,4})\b/g, (m, w, n) => {
    const up = minus(w).toUpperCase();
    if ((COMUNES.has(minus(w)) && w.length <= 3 && !pref.includes(up)) || /^(TALLA|SOLES|PRECIO|STOCK|TENGO|QUEDAN|HAY|SON)$/.test(up)) return m;
    const so = sonido(w);
    const p = pref.find((x) => x === up) || pref.find((x) => { const sx = sonido(x); return sx[0] === so[0] && distancia(so, sx) <= 1; });
    return p ? `${p}-${n.padStart(3, '0')}` : m;
  });
}
