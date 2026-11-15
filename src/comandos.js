// Órdenes rápidas para el asistente, como con Alexa: frases cortas con palabras clave que se entienden
// siempre igual, sin IA. Si la frase no es una orden clara, devuelve null y responde la IA.
//
//   "CAR-002 precio 120"                       "car 2 stock 1"
//   "CAR-002 nombre Cartera Guess y stock 1"   "ZAP-003 vendido"
//   "categoría zapatos 15 % de descuento hoy"  "todos los zapatos oferta 20 % hasta el domingo"
//   "marca Guess baja el precio 10 %"          "los marcados quitar oferta"
//   "CAR-002 quita con cadena del nombre"      "CAR-002 en el nombre cambia bolso por cartera"

const sinTildes = (c) => c.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().charAt(0) || c;
/** Minúsculas y sin tildes, letra por letra: así las posiciones coinciden con el texto original. */
const normal = (s) => [...String(s)].map(sinTildes).join('');

const NUMEROS = { cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, veinte: 20, treinta: 30, cuarenta: 40, cincuenta: 50, cien: 100 };
const numero = (s) => {
  const t = String(s || '').trim();
  const m = /^(\d+(?:[.,]\d{1,2})?)/.exec(t);
  if (m) return parseFloat(m[1].replace(',', '.'));
  const w = /^([a-z]+)/.exec(t);
  return w && w[1] in NUMEROS ? NUMEROS[w[1]] : null;
};

// Palabras que identifican cada categoría (raíces, sin tildes)
const RAICES_CAT = [
  ['Zapatos', ['zapat', 'zapatill', 'calzad', 'sandali', 'botas', 'botin']],
  ['Carteras y bolsos', ['carter', 'bols', 'mochil', 'billeter']],
  ['Ropa', ['ropa', 'polo', 'blusa', 'vestido', 'casaca', 'jean', 'pantalon']],
  ['Accesorios', ['accesori', 'gorra', 'lentes', 'gafas', 'correa']],
  ['Relojes y joyería', ['reloj', 'joya', 'joyeri', 'aretes', 'collar', 'pulsera']],
  ['Perfumes y belleza', ['perfum', 'bellez', 'maquillaj', 'crema']],
  ['Electrónica', ['electron', 'audifon', 'celular']],
  ['Hogar', ['hogar', 'casa', 'cocina']],
  ['Juguetes', ['juguet']],
  ['Otros', ['otros']],
];
const categoriaDe = (palabra) => {
  const w = normal(palabra);
  for (const [cat, raices] of RAICES_CAT) if (raices.some((r) => w.startsWith(r))) return cat;
  return null;
};

const DIAS_SEMANA = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6 };
const finDia = (d) => { const x = new Date(d); x.setHours(23, 59, 59, 0); return x.getTime(); };
/** Hasta cuándo dura la oferta. null = no lo dijo. */
function duracion(n, ahora) {
  const hoy = new Date(ahora);
  if (/\bhoy\b|\bsolo hoy\b/.test(n)) return { hasta: finDia(hoy), txt: 'hoy' };
  if (/\bmanana\b/.test(n)) { const d = new Date(hoy); d.setDate(d.getDate() + 1); return { hasta: finDia(d), txt: 'mañana' }; }
  let m = /\b(?:por|durante|x)?\s*(\d+|[a-z]+)\s+dias?\b/.exec(n);
  if (m && numero(m[1])) { const k = numero(m[1]); const d = new Date(hoy); d.setDate(d.getDate() + k - 1); return { hasta: finDia(d), txt: `por ${k} día${k === 1 ? '' : 's'}` }; }
  m = /\bhasta el (domingo|lunes|martes|miercoles|jueves|viernes|sabado)\b/.exec(n);
  if (m) { const d = new Date(hoy); d.setDate(d.getDate() + ((DIAS_SEMANA[m[1]] - d.getDay() + 7) % 7)); return { hasta: finDia(d), txt: `hasta el ${m[1].replace('miercoles', 'miércoles').replace('sabado', 'sábado')}` }; }
  if (/\b(esta semana|fin de semana|finde)\b/.test(n)) { const d = new Date(hoy); d.setDate(d.getDate() + ((7 - d.getDay()) % 7)); return { hasta: finDia(d), txt: 'hasta el domingo' }; }
  m = /\bhasta el (\d{1,2})\b/.exec(n);
  if (m) { const dia = +m[1]; const d = new Date(hoy); if (dia < d.getDate()) d.setMonth(d.getMonth() + 1); d.setDate(dia); return { hasta: finDia(d), txt: `hasta el ${dia}` }; }
  if (/\b(este mes|fin de mes)\b/.test(n)) { const d = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0); return { hasta: finDia(d), txt: 'hasta fin de mes' }; }
  return null;
}

// Palabras clave de cada campo. El valor de un campo de texto llega hasta la siguiente palabra clave.
const CLAVES = [
  ['precio', /\b(?:el |nuevo )?precio(?: de venta)?\b/g],
  ['costo', /\bcosto\b/g],
  ['stock', /\b(?:stock|cantidad|unidades|quedan)\b/g],
  ['nombre', /\b(?:ponle de nombre|ponle nombre|el nombre|nombre)\b/g],
  ['descripcion', /\b(?:la descripcion|descripcion)\b/g],
  ['marca', /\bmarca\b/g],
  ['talla', /\btalla\b/g],
  ['condicion', /\bcondicion\b/g],
  ['categoria', /\bcategoria\b/g],
  ['publico', /\b(?:publico|para(?=\s+(?:mujer|mujeres|dama|damas|hombre|hombres|caballero|caballeros|varon|nino|ninos|nina|ninas|bebe|bebes|unisex)\b))\b/g],
];
const CONDICIONES = [
  ['nuevo_etiqueta', /\bnuevo con etiqueta\b/], ['caja_abierta', /\bcaja abierta\b/], ['como_nuevo', /\b(?:como nuevo|usado como nuevo)\b/],
  ['nuevo', /\bnuevo(?: sin etiqueta)?\b/], ['usado', /\busad[oa]\b/],
];
const RELLENO_INICIO = /^(?:\s|:|=|a\b|es\b|sea\b|por\b|de\b|en\b|ahora\b)+/i;
const limpiarValor = (s) => s.replace(RELLENO_INICIO, '').replace(/[\s,;.]+$/, '').replace(/\s+y$/i, '').replace(/^["“'«]|["”'»]$/g, '').trim();

/**
 * @param {string} texto  lo que dijo o escribió la vendedora
 * @param {object} ctx    { productos, seleccion: string[], codigoDe(p), enSoles: boolean, esCopia(p), money(n), ahora? }
 * @returns {null | {error:string} | {texto:string, propuesta:object}}
 */
export function interpretarComando(texto, ctx) {
  const orig = String(texto || '').replace(/\s+/g, ' ').trim();
  const n = normal(orig);
  if (!n || n.length > 400) return null;
  // Preguntas o pedidos de redactar: eso lo hace la IA
  if (/[?¿]|\b(escribe|escribele|redacta|mejora|mejorale|sugiere|inventa|genera|crea|cuanto|cuantos|cuantas|cuales|que productos|por que)\b|^(como|que|cual)\b/.test(n)) return null;

  const ahora = ctx.ahora || Date.now();
  const productos = ctx.productos || [];
  const cod = (p) => ctx.codigoDe(p) || '';
  const prefijos = new Set(productos.map((p) => cod(p).slice(0, 3).toLowerCase()).filter(Boolean));
  const usado = []; // rangos del texto que ya son "a quién" (para no leerlos como valores)

  // ---------- ¿A qué productos? ----------
  let objetivo = null, etiqueta = '';
  const codigos = [];
  const reCod = /\b([a-z]{3})\s*-?\s*(\d{1,4}|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b/g;
  for (let m; (m = reCod.exec(n));) {
    if (!prefijos.has(m[1])) continue;
    const num = numero(m[2]);
    codigos.push(`${m[1].toUpperCase()}-${String(num).padStart(3, '0')}`);
    usado.push([m.index, m.index + m[0].length]);
  }
  // Por voz el celular a veces escribe el código distinto ("real 3", "carro 2", "rob 1", "código sap 4"):
  // al inicio de la frase (o después de "código") se acepta una palabra parecida a un prefijo de la tienda.
  if (!codigos.length) {
    const ALIAS = { carro: 'car', carta: 'car', real: 'rel', rey: 'rel', rob: 'rop', ropa: 'rop', sap: 'zap', zapa: 'zap', sab: 'zap', pera: 'per', pero: 'per', jugo: 'jug', ace: 'acc', aks: 'acc', ele: 'ele', ogar: 'hog', otro: 'otr', otra: 'otr' };
    const re = /(?:^|\bcodigo\s+(?:el\s+|del\s+)?|\bel\s+)([a-z]{2,5})\s*-?\s*(\d{1,4}|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b/g;
    const cerca = (a, b) => { if (a === b) return true; if (Math.abs(a.length - b.length) > 1) return false;
      let i = 0, j = 0, d = 0; while (i < a.length && j < b.length) { if (a[i] === b[j]) { i++; j++; continue; } if (++d > 1) return false;
        if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; } } return d + (a.length - i) + (b.length - j) <= 1; };
    for (let m; (m = re.exec(n));) {
      const w = m[1], pre = prefijos.has(w) ? w : ALIAS[w] && prefijos.has(ALIAS[w]) ? ALIAS[w] : [...prefijos].find((x) => w.length >= 3 && w[0] === x[0] && cerca(w, x));
      if (!pre) continue;
      codigos.push(`${pre.toUpperCase()}-${String(numero(m[2])).padStart(3, '0')}`);
      usado.push([m.index, m.index + m[0].length]);
    }
  }
  if (codigos.length) {
    const lista = [...new Set(codigos)];
    const faltan = lista.filter((c) => !productos.some((p) => cod(p) === c));
    if (faltan.length) return { error: `No encontré ${faltan.length === 1 ? 'el código' : 'los códigos'} ${faltan.join(', ')} en tu tienda. Revisa el código en la tarjeta del producto.` };
    objetivo = productos.filter((p) => lista.includes(cod(p)));
    etiqueta = lista.join(', ');
  }
  if (!objetivo) {
    const m = /\b(?:los|las|productos)?\s*(marcados|marcadas|seleccionados|seleccionadas|estos|estas)\b/.exec(n);
    if (m) {
      objetivo = productos.filter((p) => (ctx.seleccion || []).includes(p.id));
      if (!objetivo.length) return { error: 'No tienes productos marcados. Toca "Editar varios", marca los productos y vuelve a decírmelo.' };
      etiqueta = `los ${objetivo.length} marcados`; usado.push([m.index, m.index + m[0].length]);
    }
  }
  if (!objetivo && ctx.tipoDe) {
    // Por tipo de producto: "todas las faldas", "los vestidos", "las zapatillas"
    const m = /\b(?:todos los|todas las|todo lo de|los de|las de|a los|a las|los|las)\s+([a-z]+(?: de [a-z]+)?)/.exec(n);
    const tipo = m && (ctx.tipoDe(m[1]) || ctx.tipoDe(m[1].replace(/(es|s)$/, '')));
    const conTipo = tipo ? productos.filter((p) => p.tipo === tipo) : [];
    if (conTipo.length) { objetivo = conTipo; etiqueta = `todos los de tipo ${tipo} (${conTipo.length})`; usado.push([m.index, m.index + m[0].length]); }
  }
  if (!objetivo) {
    let m = /\b(?:categoria|todos los|todas las|todo lo de|los de|las de)\s+(?:la categoria\s+|categoria\s+)?([a-z]+(?: y [a-z]+)?)/.exec(n);
    let cat = m && categoriaDe(m[1].split(' ')[0]);
    if (!cat) { m = /\b(?:a |de |en )?(?:los|las)\s+([a-z]+)/.exec(n); cat = m && categoriaDe(m[1]); }
    if (cat) {
      objetivo = productos.filter((p) => p.categoria === cat);
      if (!objetivo.length) return { error: `No tienes productos en la categoría ${cat}.` };
      etiqueta = `todos los de ${cat} (${objetivo.length})`; usado.push([m.index, m.index + m[0].length]);
    }
  }
  if (!objetivo) {
    // "marca Guess ..." o "todos los Guess ..." (la marca tiene que existir en la tienda)
    const marcas = [...new Set(productos.map((p) => p.marca).filter(Boolean))].sort((a, b) => b.length - a.length);
    for (const mk of marcas) {
      const nm = normal(mk).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const m = new RegExp(`^(?:a\\s+)?(?:(?:todos|todas|todo)\\s+(?:los|las|lo)?\\s*(?:de\\s+)?)?(?:la\\s+)?marca\\s+${nm}\\b|^(?:todos|todas)\\s+(?:los|las)\\s+(?:de\\s+)?${nm}\\b`).exec(n);
      if (m) { objetivo = productos.filter((p) => p.marca && normal(p.marca) === normal(mk)); etiqueta = `todos los ${mk} (${objetivo.length})`; usado.push([m.index, m.index + m[0].length]); break; }
    }
  }
  if (!objetivo) {
    const m = /\b(?:toda la tienda|todos los productos|todos mis productos)\b/.exec(n);
    if (m) { objetivo = productos.slice(); etiqueta = `todos tus productos (${objetivo.length})`; usado.push([m.index, m.index + m[0].length]); }
  }
  if (!objetivo) return null;

  const enUso = (i) => usado.some(([a, b]) => i >= a && i < b);
  const cambios = {}; const dice = [];
  const redondeo = (v) => (ctx.enSoles ? Math.round(v) : Math.round(v * 100) / 100);

  // ---------- Nombre: quitar o cambiar palabras ----------
  const tomar = (mm, g) => { const i = mm.index + mm[0].indexOf(mm[g]); return orig.slice(i, i + mm[g].length); };
  let m = /\bquita(?:r|le)?\s+(?:la palabra\s+|las palabras\s+)?(.+?)\s+(?:del|de el|en el)\s+nombre\b/.exec(n)
    || /\b(?:quita|quitar|quitale|borra|borrar|saca|sacar)\s+(?:la palabra|las palabras)\s+["“']?(.+?)["”']?(?=[.,;]|\s+y\s|$)/.exec(n);
  if (m) { cambios.quitarNombre = tomar(m, 1); usado.push([m.index, m.index + m[0].length]); }
  // "no poner bolsos sino cartera", "en vez de bolso pon cartera" (en el nombre)
  const mr = /\bno\s+(?:colocar|coloques|poner|pongas|decir|digas)?\s*(?:la palabra\s+)?(.+?)\s+sino\s+(.+?)(?=[.,;]|\s+y\s|$)/.exec(n)
    || /\ben vez de\s+(.+?)\s+(?:pon|poner|coloca|colocar|di)\s+(.+?)(?=[.,;]|\s+y\s|$)/.exec(n);
  if (mr) { cambios.reemplazarNombre = [tomar(mr, 1), tomar(mr, 2)]; usado.push([mr.index, mr.index + mr[0].length]); }
  m = /\b(?:en el nombre\s+)?(?:cambia|cambiar|cambiale|reemplaza|reemplazar)\s+(.+?)\s+por\s+(.+?)(?:\s+en el nombre\b|(?=,|;|\s+y\s+(?:precio|stock|cantidad|talla|marca|descripcion)\b)|$)/.exec(n);
  if (!cambios.reemplazarNombre && m && /\bnombre\b/.test(n.slice(Math.max(0, m.index - 20), m.index + m[0].length + 1)) && !CLAVES.some(([k]) => normal(m[1]).includes(k))) {
    const ia = m.index + m[0].indexOf(m[1]), ib = m.index + m[0].indexOf(m[2], m[0].indexOf(m[1]) + m[1].length);
    cambios.reemplazarNombre = [orig.slice(ia, ia + m[1].length), orig.slice(ib, ib + m[2].length)];
    usado.push([m.index, m.index + m[0].length]);
  }

  // ---------- Oferta ----------
  if (/\b(?:quita|quitar|quitale|sin|termina|terminar|acaba|fin de la|cancela|cancelar)\s+(?:la\s+)?(?:oferta|descuento)\b/.test(n)) { cambios.quitarOferta = true; dice.push('quitar la oferta'); }
  else if (/\b(?:descuento|oferta|rebaja|dcto)\b/.test(n)) {
    const pm = /(\d+(?:[.,]\d+)?)\s*(?:%|por\s*ciento)/.exec(n);
    const fijo = /\b(?:oferta|descuento)\s+(?:a|en)\s+(?:s\/\s*|\$\s*)?(\d+(?:[.,]\d{1,2})?)\b(?!\s*(?:%|por))/.exec(n);
    const dur = duracion(n, ahora) || { hasta: finDia(new Date(ahora).setDate(new Date(ahora).getDate() + 6)), txt: 'por 7 días', porDefecto: true };
    if (pm) { cambios.ofertaPct = parseFloat(pm[1].replace(',', '.')); dice.push(`oferta -${cambios.ofertaPct} % ${dur.txt}`); }
    else if (fijo) { cambios.ofertaPrecio = parseFloat(fijo[1].replace(',', '.')); dice.push(`oferta a ${ctx.money(cambios.ofertaPrecio)} ${dur.txt}`); }
    if (cambios.ofertaPct != null || cambios.ofertaPrecio != null) { cambios.ofertaHasta = dur.hasta; cambios.ofertaPorDefecto = !!dur.porDefecto; }
  }

  // ---------- Subir o bajar el precio (para siempre) ----------
  m = /\b(sube|subir|subele|aumenta|aumentar|aumentale|baja|bajar|bajale|reduce|reducir|reducele)\s+(?:el\s+)?(?:precio\s+)?(?:en\s+)?(\d+(?:[.,]\d+)?)\s*(%|por\s*ciento|soles|sol|dolares|dolar|\$)?/.exec(n);
  if (m && cambios.ofertaPct == null) {
    const signo = /^(sube|subir|subele|aumenta)/.test(m[1]) ? 1 : -1, v = parseFloat(m[2].replace(',', '.'));
    if (m[3] && /%|ciento/.test(m[3])) { cambios.ajustePct = signo * v; dice.push(`${signo > 0 ? 'subir' : 'bajar'} el precio ${v} %`); }
    else { cambios.ajusteMonto = signo * v; dice.push(`${signo > 0 ? 'subir' : 'bajar'} el precio ${ctx.money(v)}`); }
    usado.push([m.index, m.index + m[0].length]);
  }

  // ---------- Estado ----------
  if (/\b(?:vendido|vendida|ya se vendio|se vendio)\b/.test(n)) { cambios.estado = 'vendido'; dice.push('marcar vendido'); }
  else if (/\b(?:ocultar|ocultalo|ocultala|ocultalos|oculto|oculta|esconder|esconde)\b/.test(n)) { cambios.estado = 'oculto'; dice.push('ocultar'); }
  else if (/\b(?:apartado|apartada|apartar|separado|separada)\b/.test(n)) { cambios.estado = 'apartado'; dice.push('marcar apartado'); }
  else if (/\b(?:publicar|publicalo|publicala|publicalos|mostrar|disponible|disponibles)\b/.test(n)) { cambios.estado = 'disponible'; dice.push('publicar (disponible)'); }
  if (/\bagotad[oa]s?\b/.test(n)) { cambios.stock = 0; dice.push('cantidad 0 (agotado)'); }
  else {
    const ms = /\b(?:hay|tengo|quedan|queda)\s+(\d+|[a-z]+)(?:\s+(?:en stock|unidades?))?\b/.exec(n) || /\b(\d+)\s+(?:en stock|unidades)\b/.exec(n);
    if (ms && numero(ms[1]) != null && Number.isInteger(numero(ms[1]))) { cambios.stock = numero(ms[1]); dice.push(`cantidad ${cambios.stock}`); usado.push([ms.index, ms.index + ms[0].length]); }
  }

  // ---------- Campos con palabra clave ----------
  const hallados = [];
  for (const [campo, re] of CLAVES) {
    re.lastIndex = 0;
    for (let x; (x = re.exec(n));) if (!enUso(x.index)) hallados.push({ campo, i: x.index, fin: x.index + x[0].length });
  }
  hallados.sort((a, b) => a.i - b.i);
  // La siguiente palabra clave (o una orden de oferta / estado) corta el valor anterior
  const cortes = [...hallados.map((h) => h.i)];
  for (const re of [/\b(?:y\s+)?(?:\d+\s*%|descuento|oferta|vendido|ocultar|publicar|agotado|hoy|hasta el)\b/g]) for (let x; (x = re.exec(n));) cortes.push(x.index);
  const corteDespues = (i) => Math.min(...cortes.filter((c) => c > i), n.length);
  for (const h of hallados) {
    const crudo = orig.slice(h.fin, corteDespues(h.fin));
    const valor = limpiarValor(crudo);
    if (!valor) continue;
    if (h.campo === 'precio' || h.campo === 'costo') {
      if (/^(?:en\s+)?\d/.test(normal(valor)) || numero(normal(valor)) != null) { const v = numero(normal(valor).replace(/^en\s+/, '')); if (v != null) { cambios[h.campo] = v; dice.push(`${h.campo} ${h.campo === 'costo' ? '$' + v : ctx.money(v)}`); } }
    } else if (h.campo === 'stock') {
      const v = numero(normal(valor)); if (v != null && Number.isInteger(v)) { cambios.stock = v; dice.push(`cantidad ${v}`); }
    } else if (h.campo === 'categoria') {
      const c = categoriaDe(normal(valor).split(' ')[0]); if (c) { cambios.categoria = c; dice.push(`categoría ${c}`); }
    } else if (h.campo === 'publico') {
      const w = normal(valor).split(' ')[0];
      const pub = /^(mujer|dama|damas|mujeres)$/.test(w) ? 'Mujer' : /^(hombre|hombres|caballero|caballeros|varon)$/.test(w) ? 'Hombre' : /^(nino|ninos|nina|ninas|bebe|bebes)$/.test(w) ? 'Niños' : /^unisex$/.test(w) ? 'Unisex' : null;
      if (pub) { cambios.publico = pub; dice.push(`para ${pub}`); }
    } else if (h.campo === 'condicion') {
      const c = CONDICIONES.find(([, re]) => re.test(normal(valor))); if (c) { cambios.condicion = c[0]; dice.push(`condición ${valor}`); }
    } else if (h.campo === 'marca' || h.campo === 'talla' || h.campo === 'nombre' || h.campo === 'descripcion') {
      if (h.campo === 'nombre' && (cambios.quitarNombre || cambios.reemplazarNombre)) continue;
      cambios[h.campo] = valor.slice(0, h.campo === 'descripcion' ? 600 : 120); dice.push(`${h.campo === 'descripcion' ? 'descripción' : h.campo} «${cambios[h.campo]}»`);
    }
  }
  if (!cambios.condicion) { const c = CONDICIONES.slice(0, 3).find(([, re]) => re.test(n)); if (c) { cambios.condicion = c[0]; dice.push('condición ' + c[0].replace('_', ' ')); } }
  if (cambios.quitarNombre) dice.unshift(`quitar «${cambios.quitarNombre}» del nombre`);
  if (cambios.reemplazarNombre) dice.unshift(`cambiar «${cambios.reemplazarNombre[0]}» por «${cambios.reemplazarNombre[1]}» en el nombre`);

  if (!dice.length) return null; // dijo a qué productos pero no qué hacer: que lo intente la IA

  // ---------- Armar la propuesta ----------
  const filas = []; let sinPrecio = 0, copiasStock = 0;
  for (const p of objetivo) {
    const campos = {};
    let nombre = p.nombre || '';
    if (cambios.quitarNombre) { const re = new RegExp(`\\s*${cambios.quitarNombre.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'i'); nombre = nombre.replace(re, ' ').replace(/\s+/g, ' ').trim(); }
    if (cambios.reemplazarNombre) {
      const [a, b] = cambios.reemplazarNombre, esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // "bolsos" también cambia "Bolso" (singular o plural)
      const base = a.replace(/(es|s)$/i, ''), re = new RegExp(`\\b(?:${esc(a)}|${esc(base)}(?:es|s)?)\\b`, 'i');
      nombre = nombre.replace(re, (x) => (x[0] === x[0].toUpperCase() ? b.charAt(0).toUpperCase() + b.slice(1) : b));
    }
    if (cambios.nombre) nombre = cambios.nombre;
    if (nombre && nombre !== p.nombre) campos.nombre = nombre;
    for (const k of ['marca', 'talla', 'descripcion', 'condicion', 'estado', 'costo', 'categoria', 'publico']) if (cambios[k] != null && cambios[k] !== p[k]) campos[k] = cambios[k];
    if (cambios.stock != null) { if (ctx.esCopia(p)) copiasStock++; else if (cambios.stock !== p.stock) campos.stock = cambios.stock; }
    let precio = cambios.precio != null ? cambios.precio : p.precio;
    if (cambios.ajustePct != null || cambios.ajusteMonto != null) {
      if (p.precio == null) sinPrecio++;
      else precio = Math.max(0, redondeo(cambios.ajustePct != null ? p.precio * (1 + cambios.ajustePct / 100) : p.precio + cambios.ajusteMonto));
    }
    if (precio != null && precio !== p.precio) campos.precio = precio;
    if (cambios.quitarOferta && (p.precioOferta != null || p.ofertaHasta != null)) { campos.precioOferta = null; campos.ofertaHasta = null; }
    if (cambios.ofertaPct != null || cambios.ofertaPrecio != null) {
      if (precio == null) sinPrecio++;
      else {
        const po = cambios.ofertaPrecio != null ? cambios.ofertaPrecio : redondeo(precio * (1 - cambios.ofertaPct / 100));
        if (po >= 0 && po < precio) { campos.precioOferta = po; campos.ofertaHasta = cambios.ofertaHasta; }
      }
    }
    if (!Object.keys(campos).length) continue;
    const antes = Object.fromEntries(Object.keys(campos).map((k) => [k, p[k] ?? null]));
    filas.push({ id: p.id, nombre: (cod(p) ? cod(p) + ' · ' : '') + (p.nombre || 'Producto'), campos, antes });
  }
  const notas = [];
  if (sinPrecio) notas.push(`${sinPrecio} sin precio (no se les puso)`);
  if (copiasStock) notas.push(`${copiasStock} de tiendas de confianza (su cantidad la maneja la dueña)`);
  if (cambios.ofertaPorDefecto) notas.push('no dijiste hasta cuándo: la puse por 7 días');
  if (!filas.length) return { error: `No hay nada que cambiar en ${etiqueta}: ya tienen esos datos${notas.length ? ' (' + notas.join('; ') + ')' : ''}.` };
  const resumen = `${etiqueta}: ${dice.join(', ')}`;
  return {
    texto: `Entendí: ${resumen}.${notas.length ? ' Ojo: ' + notas.join('; ') + '.' : ''} Revisa y toca Aplicar.`,
    propuesta: { resumen: resumen.charAt(0).toUpperCase() + resumen.slice(1), productos: filas, pedidos: [] },
  };
}
