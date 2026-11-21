// Capa de datos de Showroomcito sobre AWS Amplify.
// Expone la misma interfaz que usaba la versión de Claude (db, assets, ai)
// para que la lógica de la vitrina no cambie, más las funciones de cuentas
// y del panel de la dueña.
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import { uploadData, downloadData, remove } from 'aws-amplify/storage';
import {
  signIn, signOut, signUp, confirmSignUp, resendSignUpCode, confirmSignIn, fetchAuthSession, signInWithRedirect,
  resetPassword, confirmResetPassword, updatePassword,
} from 'aws-amplify/auth';
import { Hub } from 'aws-amplify/utils';
import 'aws-amplify/auth/enable-oauth-listener';
import outputs from '../amplify_outputs.json';

Amplify.configure(outputs);
const client = generateClient();

export const FOTOS_BASE = (outputs.custom && outputs.custom.fotosUrl) || '';

// ---------- Inicio de sesión con Google ----------
export const googleDisponible = !!(outputs.auth && outputs.auth.oauth
  && (outputs.auth.oauth.identity_providers || []).includes('GOOGLE'));
export const entrarConGoogle = () => signInWithRedirect({ provider: 'Google' });
/** Al volver de Google: avisa cuando la sesión quedó lista o si falló. */
export function alVolverDeGoogle(ok, error) {
  return Hub.listen('auth', ({ payload }) => {
    if (payload.event === 'signInWithRedirect') ok();
    if (payload.event === 'signInWithRedirect_failure') error(payload.data && payload.data.error);
  });
}
export { signIn, signOut, signUp, confirmSignUp, resendSignUpCode, confirmSignIn, resetPassword, confirmResetPassword, updatePassword };

// ---------- Sesión ----------
let AUTH = 'identityPool';
let MODO = 'publico';     // 'publico' | 'vendedora'
let TIENDA = null;        // id (enlace) de la tienda activa

export async function sesion() {
  try {
    // Si una sesión guardada quedó a medias, fetchAuthSession puede quedarse esperando:
    // a los 8 segundos se descarta en este navegador y se muestra la pantalla de inicio.
    const espera = new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 8000));
    const s = await Promise.race([fetchAuthSession(), espera]).catch(async (e) => {
      if (e && e.message === 'timeout') { try { await signOut({ global: false }); } catch { /* ya estaba cerrada */ } }
      throw e;
    });
    if (!s.tokens) return { logged: false };
    const p = s.tokens.idToken ? s.tokens.idToken.payload : s.tokens.accessToken.payload;
    const g = s.tokens.accessToken.payload['cognito:groups'];
    return { logged: true, sub: p.sub, email: p.email || '', superadmin: Array.isArray(g) && g.includes('SUPERADMIN') };
  } catch { return { logged: false }; }
}
export function usarModoPublico(slug, logged) { MODO = 'publico'; TIENDA = slug; AUTH = logged ? 'userPool' : 'identityPool'; }
export function usarModoVendedora(slug) { MODO = 'vendedora'; TIENDA = slug; AUTH = 'userPool'; }

function check(r) {
  if (r && r.errors && r.errors.length) {
    const msg = r.errors.map((e) => e.message).join('; ');
    throw { code: /unauthori[sz]ed|not authorized/i.test(msg) ? 'not_granted' : /conditional/i.test(msg) ? 'exists' : 'upstream_error', message: msg };
  }
  return r ? r.data : null;
}

// ---------- Tiendas ----------
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/;
const RESERVADOS = new Set(['admin', 'panel', 'api', 'www', 'tienda', 'vitrina', 'login', 'registro', 'soporte']);

export function limpiarSlug(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

export async function miTienda(sub) {
  const r = await client.models.Tienda.list({ authMode: 'userPool', limit: 1000 });
  const items = check(r) || [];
  return items.find((t) => String(t.owner || '').split('::')[0] === sub) || null;
}

export async function crearTienda({ slug, nombre, whatsapp, email, pais = 'PE', moneda, rubro = 'moda' }) {
  if (!SLUG_RE.test(slug) || RESERVADOS.has(slug)) throw { code: 'invalid', message: 'Enlace no válido' };
  const esUS = pais === 'US';
  const r = await client.models.Tienda.create({ id: slug, nombre, whatsapp, email, pais: esUS ? 'US' : 'PE', moneda: esUS ? 'USD' : (moneda === 'USD' ? 'USD' : 'PEN'), tipoCambio: esUS ? null : 3.46, rubro }, { authMode: 'userPool' });
  return check(r);
}

export async function listarTiendas() {
  const todas = [];
  let nextToken = null;
  do {
    const r = await client.models.Tienda.list({ authMode: 'userPool', limit: 500, nextToken });
    todas.push(...(check(r) || []));
    nextToken = r.nextToken;
  } while (nextToken);
  return todas;
}

export async function cambiarEstadoTienda(id, estado) {
  check(await client.models.Tienda.update({ id, estado }, { authMode: 'userPool' }));
}

// ---------- Catálogo público ----------
let catalogoActual = null;
export async function cargarCatalogo() {
  const r = await client.queries.catalogo({ slug: TIENDA }, { authMode: AUTH });
  const d = check(r);
  catalogoActual = typeof d === 'string' ? JSON.parse(d) : (d || { estado: 'no_existe' });
  return catalogoActual;
}
export const estadoCatalogo = () => catalogoActual;

/** Asistente de compras del cliente: devuelve { texto, codigos } (solo productos de esta tienda). */
export async function preguntarTienda(mensajes, idioma) {
  const r = await client.queries.preguntarTienda({ slug: TIENDA, mensajes: JSON.stringify(mensajes), ...(idioma ? { idioma } : {}) }, { authMode: AUTH });
  const d = check(r);
  return typeof d === 'string' ? JSON.parse(d) : d;
}

// ---------- Productos ----------
const toProducto = (it) => ({
  id: it.id,
  nombre: it.nombre,
  marca: it.marca || '',
  precio: typeof it.precio === 'number' ? it.precio : null,
  stock: typeof it.stock === 'number' ? it.stock : null,
  costo: typeof it.costo === 'number' ? it.costo : null,
  talla: it.talla || '',
  condicion: it.condicion || '',
  codigo: it.codigo || '',
  huella: it.huella || '',
  categoria: it.categoria || '',
  tipo: it.tipo || '',
  trNombre: it.trNombre || '',
  trDescripcion: it.trDescripcion || '',
  trFuente: it.trFuente || '',
  publico: it.publico || '',
  descripcion: it.descripcion || '',
  estado: it.estado || 'disponible',
  creado: it.creado || 0,
  // Tiendas de confianza
  compartido: !!it.compartido,
  precioReventa: typeof it.precioReventa === 'number' ? it.precioReventa : null,
  // Oferta con fecha de fin. En la vendedora vienen precioOferta y ofertaHasta tal cual están guardados;
  // en el catálogo público "precio" ya es el de oferta y "precioAntes" el normal.
  precioOferta: typeof it.precioOferta === 'number' ? it.precioOferta : null,
  ofertaHasta: typeof it.ofertaHasta === 'number' ? it.ofertaHasta : null,
  precioAntes: typeof it.precioAntes === 'number' ? it.precioAntes : null,
  origenId: it.origenId || '',
  origenTienda: it.origenTienda || '',
  fotos: (it.fotosFull || []).map((full, i) => ({ full, thumb: (it.fotosThumb || [])[i] || full })),
});

function aCampos(d) {
  const o = { ...d };
  if (o.fotos) {
    o.fotosFull = o.fotos.map((f) => f.full);
    o.fotosThumb = o.fotos.map((f) => f.thumb);
    delete o.fotos;
  }
  if (o.estado === '') delete o.estado;
  return o;
}

const productoRef = (id) => ({
  id,
  set: async (d) => {
    // El id es nuevo y al azar: si DynamoDB dice que ya existe es porque un reintento de la red
    // ya lo había guardado. Se cuenta como guardado (antes salía "conditional request failed").
    try { check(await client.models.Producto.create({ id, tiendaId: TIENDA, ...aCampos(d) }, { authMode: 'userPool' })); }
    catch (e) { if (e && e.code === 'exists') return; throw e; }
  },
  update: async (d) => { check(await client.models.Producto.update({ id, ...aCampos(d) }, { authMode: 'userPool' })); },
  delete: async () => { check(await client.models.Producto.delete({ id }, { authMode: 'userPool' })); },
});

const aDocs = (items) => items.map(toProducto).sort((a, b) => b.creado - a.creado)
  .map((p) => ({ id: p.id, data: () => { const { id, ...resto } = p; return resto; } }));

let reiniciarVendedora = null;
/** Vuelve a leer los productos de la vendedora (lo que crea o borra el servidor no llega solo). */
export function refrescarProductos() { if (reiniciarVendedora) reiniciarVendedora(); }

function suscribirProductos(next, err) {
  if (MODO === 'vendedora') {
    let sub = null;
    const abrir = () => {
      if (sub) sub.unsubscribe();
      sub = client.models.Producto.observeQuery({
        filter: { tiendaId: { eq: TIENDA } }, authMode: 'userPool',
      }).subscribe({
        next: ({ items, isSynced }) => next({ docs: aDocs(items), metadata: { fromCache: !isSynced } }),
        error: (e) => { if (err) err(e); },
      });
    };
    abrir();
    reiniciarVendedora = abrir;
    return () => { reiniciarVendedora = null; if (sub) sub.unsubscribe(); };
  }
  // Público: carga el catálogo y lo refresca cada minuto mientras la página esté visible.
  let parado = false;
  const tick = async () => {
    try { const c = await cargarCatalogo(); if (!parado) next({ docs: aDocs(c.productos || []), metadata: { fromCache: false } }); emitirConfig(); }
    catch (e) { if (err) err(e); }
  };
  tick();
  const t = setInterval(() => { if (document.visibilityState === 'visible') tick(); }, 60000);
  return () => { parado = true; clearInterval(t); };
}

// ---------- Datos de la tienda (nombre, WhatsApp, tipo de cambio) ----------
const configListeners = [];
function emitirConfig() { configListeners.forEach((f) => f()); }
function configRef() {
  const ref = {
    async get() {
      if (MODO === 'publico') { const c = catalogoActual; return c && c.tienda ? c.tienda : null; }
      return check(await client.models.Tienda.get({ id: TIENDA }, { authMode: 'userPool' }));
    },
    onSnapshot(next, err) {
      const emit = async () => {
        try { const d = await ref.get(); next({ exists: !!d, data: () => d || {} }); }
        catch (e) { if (err) err(e); }
      };
      configListeners.push(emit); emit();
      return () => { const i = configListeners.indexOf(emit); if (i >= 0) configListeners.splice(i, 1); };
    },
    async set(d) {
      const datos = {
        nombre: d.nombre || TIENDA, whatsapp: d.whatsapp || '', tipoCambio: d.tipoCambio ?? null,
        yapeNumero: d.yapeNumero || '', yapeNombre: d.yapeNombre || '', yapeQr: d.yapeQr || '',
        descuentoContado: typeof d.descuentoContado === 'number' ? d.descuentoContado : 0,
        ...(Number.isInteger(d.diasSeparado) ? { diasSeparado: d.diasSeparado } : {}),
        ...(typeof d.grupoWhatsapp === 'string' ? { grupoWhatsapp: d.grupoWhatsapp } : {}),
        ...(typeof d.chatClientes === 'boolean' ? { chatClientes: d.chatClientes } : {}),
        ...(typeof d.rubro === 'string' && d.rubro ? { rubro: d.rubro } : {}),
        ...(typeof d.portada === 'string' ? { portada: d.portada } : {}),
        ...(typeof d.descripcionTienda === 'string' ? { descripcionTienda: d.descripcionTienda.slice(0, 300) } : {}),
        ...(typeof d.trDescripcionTienda === 'string' ? { trDescripcionTienda: d.trDescripcionTienda.slice(0, 400) } : {}),
        ...(d.pais === 'US' || d.pais === 'PE' ? { pais: d.pais } : {}),
        ...(d.moneda === 'USD' || d.moneda === 'PEN' ? { moneda: d.moneda } : {}),
      };
      check(await client.models.Tienda.update({ id: TIENDA, ...datos }, { authMode: 'userPool' }));
      emitirConfig();
    },
  };
  return ref;
}

export const db = {
  collection(nombre) {
    if (nombre !== 'productos') throw new Error('Colección desconocida: ' + nombre);
    return {
      doc: (id) => productoRef(id || crypto.randomUUID()),
      orderBy: () => ({ onSnapshot: suscribirProductos }),
    };
  },
  doc(path) {
    const [col, id] = path.split('/');
    if (col === 'productos') return productoRef(id);
    if (col === 'config') return configRef();
    throw new Error('Ruta desconocida: ' + path);
  },
};

// ---------- Fotos: cada vendedora en su carpeta productos/<identityId>/ ----------
export const assets = {
  async download(path) {
    if (typeof path !== 'string' || !path.startsWith('productos/')) throw new Error('Ruta de foto no permitida');
    const resultado = await downloadData({ path }).result;
    return resultado.body.blob();
  },
  async upload(blob) {
    const nombre = `${crypto.randomUUID()}.jpg`;
    let path;
    try {
      const r = await uploadData({
        path: ({ identityId }) => `productos/${identityId}/${nombre}`,
        data: blob,
        options: { contentType: 'image/jpeg' },
      }).result;
      path = r.path;
    } catch (e) {
      throw { code: /denied|forbidden|unauthori/i.test(String(e && e.message)) ? 'not_granted' : 'upstream_error', message: e && e.message };
    }
    return { id: path, url: FOTOS_BASE + '/' + path };
  },
  async delete(path) { await remove({ path }); return { deleted: true }; },
};

// ---------- IA: función "clasificar" (Claude en Bedrock) ----------
export const ai = {
  async json(_prompt, opts) {
    const paths = [].concat((opts && opts.images) || []).filter((p) => typeof p === 'string');
    const r = await client.queries.clasificarFotos({ paths, idioma: (opts && opts.idioma) || 'es', rubro: (opts && opts.rubro) || 'moda' }, { authMode: 'userPool' });
    const d = check(r);
    return typeof d === 'string' ? JSON.parse(d) : d;
  },
};

// Dictado por voz: un texto por producto → datos del producto (IA de la función "clasificar").
export async function interpretarDictado(textos, idioma = 'es', moneda = 'USD', rubro = 'moda') {
  const r = await client.queries.interpretarDictado({ textos, idioma, moneda, rubro }, { authMode: 'userPool' });
  const d = check(r);
  return typeof d === 'string' ? JSON.parse(d) : (d || []);
}

/** Traduce textos de productos al idioma "a" ('en' o 'es'). Devuelve un arreglo del mismo largo (o vacío si falla). */
export async function traducirTextos(textos, a) {
  const r = await client.queries.traducirTextos({ textos, a }, { authMode: 'userPool' });
  const d = check(r);
  return typeof d === 'string' ? JSON.parse(d) : (d || []);
}

// ---------- Planes y pagos (Stripe) ----------
// Debe coincidir con amplify/functions/shared/planes.ts
export const PLANES = [
  // asis: mensajes del asistente por día (LIMITE_DIARIO en asistente/herramientas.ts); cli: preguntas de clientes por día (LIMITE_CLIENTES en catalogo/cliente.ts).
  // precio: soles (tiendas de Perú). precioUsd: dólares (tiendas de EE. UU.), PROVISIONALES: deben coincidir con amplify/functions/shared/planes.ts.
  { id: 'free', nombre: 'Free', limite: 20, precio: 0, precioUsd: 0, asis: 15, cli: 20 },
  { id: 'basico', nombre: 'Básico', limite: 50, precio: 19, precioUsd: 9, asis: 60, cli: 100 },
  { id: 'pro', nombre: 'Pro', limite: null, precio: 49, precioUsd: 19, asis: 200, cli: 300 },
  { id: 'plus', nombre: 'Plus', limite: null, precio: 99, precioUsd: 39, asis: 1000, cli: 1000, extra: 'Próximamente: fotos con fondo blanco (IA)' },
];
// Funciones con costo por uso: solo en el plan Plus.
export const tieneFondoIA = (t) => planVigente(t).id === 'plus';
const GRACIA_MS = 3 * 24 * 60 * 60 * 1000;
export function planVigente(t) {
  const p = PLANES.find((x) => x.id === (t && t.plan)) || PLANES[0];
  if (p.id === 'free') return p;
  if (!t.planVence || t.planVence + GRACIA_MS < Date.now()) return PLANES[0];
  return p;
}

async function llamar(nombre, args, authMode) {
  const r = await client.mutations[nombre](args, { authMode });
  const d = check(r);
  return typeof d === 'string' ? JSON.parse(d) : d;
}
const origen = () => location.origin;

// Asistente de la vendedora: manda la conversación (solo texto) y recibe respuesta + cambios propuestos.
export const asistente = (mensajes, seleccion = []) => llamar('asistente', { tiendaId: TIENDA, mensajes: JSON.stringify(mensajes), seleccion: JSON.stringify(seleccion.slice(0, 100)) }, 'userPool');
// Quita el fondo de una foto ya subida; devuelve un PNG transparente en base64.
export const quitarFondo = (path) => llamar('quitarFondo', { tiendaId: TIENDA, path }, 'userPool');
export const pagarPlan = (plan) => llamar('pagarPlan', { tiendaId: TIENDA, plan, origen: origen() }, 'userPool');
export const cancelarPlan = () => llamar('cancelarPlan', { tiendaId: TIENDA }, 'userPool');
export const conectarCobros = () => llamar('conectarCobros', { tiendaId: TIENDA, origen: origen() }, 'userPool');
export const estadoCobros = () => llamar('estadoCobros', { tiendaId: TIENDA }, 'userPool');
// Tiendas de confianza: listar, invitar, aceptar, cortar, agregar, vendi, saldar (y admin_listar / admin_cortar).
export const confianza = (accion, datos = {}) => llamar('confianza', { tiendaId: TIENDA || '-', accion, datos: JSON.stringify(datos) }, 'userPool');
export const pedidoYape = (items, nombre, nota, operacion, email) =>
  llamar('pedidoYape', { tiendaId: TIENDA, items: JSON.stringify(items), nombre, nota, operacion, email: email || null }, AUTH);
export const pagarPedido = (items, nombre, nota, email) =>
  llamar('pagarPedido', { tiendaId: TIENDA, items: JSON.stringify(items), nombre, nota, email: email || null, origen: origen() }, AUTH);
// "Mis pedidos" del cliente (código por correo). accion: pedirCodigo | entrar | misPedidos | guardarPerfil | salir
export const clienteCuenta = (accion, datos = {}) => llamar('clienteCuenta', { accion, tiendaId: TIENDA, ...datos }, AUTH);
/** Clientes de la tienda (los que compraron con su correo o entraron a "Mis pedidos"). */
export async function listarClientes() {
  const todos = [];
  let nextToken = null;
  do {
    const r = await client.models.Cliente.list({ filter: { tiendaId: { eq: TIENDA } }, authMode: 'userPool', limit: 500, nextToken });
    todos.push(...(check(r) || []));
    nextToken = r.nextToken;
  } while (nextToken);
  return todos;
}

export async function miTiendaActual() {
  return check(await client.models.Tienda.get({ id: TIENDA }, { authMode: 'userPool' }));
}

export async function listarPedidos() {
  const todos = [];
  let nextToken = null;
  do {
    const r = await client.models.Pedido.list({ filter: { tiendaId: { eq: TIENDA } }, authMode: 'userPool', limit: 500, nextToken });
    todos.push(...(check(r) || []));
    nextToken = r.nextToken;
  } while (nextToken);
  // Los pagos con tarjeta que nunca se completaron se ocultan después de un día.
  return todos.filter((p) => p.estado !== 'pendiente' || Date.now() - Date.parse(p.createdAt) < 24 * 3600e3)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}
export async function cambiarEstadoPedido(id, estado) {
  check(await client.models.Pedido.update({ id, estado }, { authMode: 'userPool' }));
}

// Solo SUPERADMIN: asignar un plan a mano (por ejemplo, cortesía o pago fuera de Stripe) por 30 días.
export async function cambiarPlanTienda(id, plan) {
  const planVence = plan === 'free' ? null : Date.now() + 30 * 24 * 3600e3;
  check(await client.models.Tienda.update({ id, plan, planVence }, { authMode: 'userPool' }));
  return planVence;
}
