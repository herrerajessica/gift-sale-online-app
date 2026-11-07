// Capa de datos de la Vitrina USA sobre AWS Amplify.
// Expone la misma interfaz que usaba la versión de Claude (db, assets, ai)
// para que la lógica de la vitrina no cambie, más las funciones de cuentas
// y del panel de la dueña.
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import { uploadData, remove } from 'aws-amplify/storage';
import {
  signIn, signOut, signUp, confirmSignUp, resendSignUpCode, confirmSignIn, fetchAuthSession,
} from 'aws-amplify/auth';
import outputs from '../amplify_outputs.json';

Amplify.configure(outputs);
const client = generateClient();

export const FOTOS_BASE = (outputs.custom && outputs.custom.fotosUrl) || '';
export { signIn, signOut, signUp, confirmSignUp, resendSignUpCode, confirmSignIn };

// ---------- Sesión ----------
let AUTH = 'identityPool';
let MODO = 'publico';     // 'publico' | 'vendedora'
let TIENDA = null;        // id (enlace) de la tienda activa

export async function sesion() {
  try {
    const s = await fetchAuthSession();
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

export async function crearTienda({ slug, nombre, whatsapp, email }) {
  if (!SLUG_RE.test(slug) || RESERVADOS.has(slug)) throw { code: 'invalid', message: 'Enlace no válido' };
  const r = await client.models.Tienda.create({ id: slug, nombre, whatsapp, email, tipoCambio: 3.46 }, { authMode: 'userPool' });
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

// ---------- Productos ----------
const toProducto = (it) => ({
  id: it.id,
  nombre: it.nombre,
  precio: typeof it.precio === 'number' ? it.precio : null,
  categoria: it.categoria || '',
  publico: it.publico || '',
  descripcion: it.descripcion || '',
  estado: it.estado || 'disponible',
  creado: it.creado || 0,
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
  set: async (d) => { check(await client.models.Producto.create({ id, tiendaId: TIENDA, ...aCampos(d) }, { authMode: 'userPool' })); },
  update: async (d) => { check(await client.models.Producto.update({ id, ...aCampos(d) }, { authMode: 'userPool' })); },
  delete: async () => { check(await client.models.Producto.delete({ id }, { authMode: 'userPool' })); },
});

const aDocs = (items) => items.map(toProducto).sort((a, b) => b.creado - a.creado)
  .map((p) => ({ id: p.id, data: () => { const { id, ...resto } = p; return resto; } }));

function suscribirProductos(next, err) {
  if (MODO === 'vendedora') {
    const sub = client.models.Producto.observeQuery({
      filter: { tiendaId: { eq: TIENDA } }, authMode: 'userPool',
    }).subscribe({
      next: ({ items, isSynced }) => next({ docs: aDocs(items), metadata: { fromCache: !isSynced } }),
      error: (e) => { if (err) err(e); },
    });
    return () => sub.unsubscribe();
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
      const datos = { nombre: d.nombre || TIENDA, whatsapp: d.whatsapp || '', tipoCambio: d.tipoCambio ?? null };
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
    const r = await client.queries.clasificarFotos({ paths }, { authMode: 'userPool' });
    const d = check(r);
    return typeof d === 'string' ? JSON.parse(d) : d;
  },
};
