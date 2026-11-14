// Tiendas de confianza: dos vendedoras se conectan (invitación + aceptación), comparten productos
// y cada una puede revender los de la otra como si fueran suyos. Sus clientes nunca ven el origen.
// Cobra la revendedora; la app anota cuánto le debe a la dueña (el pago entre ellas es por fuera).
import { randomUUID } from 'node:crypto';
import { DeleteCommand, GetCommand, PutCommand, QueryCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, PRODUCTO, CONFIANZA, REVENTA, leerTienda, subDe } from '../shared/tablas';
import { parDe, monedaDe, leerRelacion, leerProductos, originalVendible, registrarReventa } from '../shared/reventa';
import { enviarCorreo } from '../shared/correo';

type Identidad = { sub?: string; groups?: string[] | null } | null | undefined;
type Evento = { arguments: { tiendaId?: string; accion?: string; datos?: string | null }; identity?: Identidad };
type Item = Record<string, any>;

const fallo = (mensaje: string): never => { throw new Error(mensaje); };
const esSuper = (ident: Identidad) => !!ident && Array.isArray(ident.groups) && ident.groups.includes('SUPERADMIN');

/** La tienda debe existir y pertenecer a quien llama (o ser SUPERADMIN). */
async function miTienda(id: string, ident: Identidad) {
  const t = await leerTienda(String(id || ''));
  if (!t) return fallo('La tienda no existe');
  if (!esSuper(ident) && (!ident?.sub || subDe(t.owner) !== ident.sub)) fallo('No autorizado');
  return t;
}

async function consultar(TableName: string, IndexName: string, campo: string, valor: string) {
  const items: Item[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(new QueryCommand({
      TableName, IndexName, KeyConditionExpression: '#c = :v',
      ExpressionAttributeNames: { '#c': campo }, ExpressionAttributeValues: { ':v': valor }, ExclusiveStartKey,
    }));
    items.push(...((r.Items || []) as Item[]));
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey && items.length < 5000);
  return items;
}

const productosDe = (tienda: string) => consultar(PRODUCTO(), 'byTienda', 'tiendaId', tienda);

async function relacionesDe(tienda: string) {
  const [a, b] = await Promise.all([
    consultar(CONFIANZA(), 'confianzaByA', 'tiendaA', tienda),
    consultar(CONFIANZA(), 'confianzaByB', 'tiendaB', tienda),
  ]);
  return [...a, ...b].map((r): Item => ({ ...r, otra: r.tiendaA === tienda ? r.tiendaB : r.tiendaA }));
}

const limpiarSlug = (s: unknown) => String(s || '').trim().toLowerCase()
  .replace(/^.*[?&]tienda=/, '').replace(/[&#].*$/, '').replace(/[^a-z0-9-]/g, '').slice(0, 40);

const datosProducto = (p: Item) => ({
  nombre: p.nombre, marca: p.marca || '', talla: p.talla || '', condicion: p.condicion || '',
  categoria: p.categoria || '', publico: p.publico || '', descripcion: p.descripcion || '',
  fotosFull: p.fotosFull || [], fotosThumb: p.fotosThumb || [],
});

// ---------- Ver todo lo de "Tiendas de confianza" de mi tienda ----------
async function listar(t: Item) {
  const rels = await relacionesDe(t.id);
  const nombres = new Map<string, string>();
  for (const r of rels) { const o = await leerTienda(r.otra); nombres.set(r.otra, o?.nombre || r.otra); }

  const mios = await productosDe(t.id);
  const misCopias = mios.filter((p) => p.origenId);
  const copiaDe = new Map(misCopias.map((c) => [String(c.origenId), String(c.id)]));

  // Productos que mis tiendas de confianza comparten conmigo
  const compartidos: Item[] = [];
  for (const r of rels.filter((x) => x.estado === 'aceptada')) {
    for (const p of await productosDe(r.otra)) {
      if (!p.compartido || p.origenId || p.estado === 'vendido' || p.estado === 'oculto') continue;
      compartidos.push({
        id: p.id, tienda: r.otra, tiendaNombre: nombres.get(r.otra), ...datosProducto(p),
        precio: p.precio ?? null, precioReventa: p.precioReventa ?? p.precio ?? null,
        stock: typeof p.stock === 'number' ? p.stock : null, estado: p.estado || 'disponible',
        yaAgregado: copiaDe.get(String(p.id)) || null, creado: p.creado || 0,
      });
    }
  }
  compartidos.sort((a, b) => Number(b.creado) - Number(a.creado));

  // Estado de mis copias (lo que muestro de otras tiendas)
  const originales = await leerProductos(misCopias.map((c) => String(c.origenId)));
  const activas = new Set(rels.filter((r) => r.estado === 'aceptada').map((r) => r.otra));
  const copias: Record<string, Item> = {};
  for (const c of misCopias) {
    const o = originales.get(String(c.origenId));
    const ok = originalVendible(c, o, activas.has(String(c.origenTienda)));
    copias[String(c.id)] = {
      disponible: !!ok, tienda: c.origenTienda, tiendaNombre: nombres.get(String(c.origenTienda)) || c.origenTienda,
      stock: o && typeof o.stock === 'number' ? o.stock : null, estado: o ? o.estado || 'disponible' : 'borrado',
      precioReventa: o ? (o.precioReventa ?? o.precio ?? null) : null,
    };
  }

  // Cuentas: lo que me deben (vendieron lo mío) y lo que debo (vendí lo de otras)
  const [meDeben, debo] = await Promise.all([
    consultar(REVENTA(), 'reventasByDuena', 'duena', t.id),
    consultar(REVENTA(), 'reventasByRevendedora', 'revendedora', t.id),
  ]);
  const nombreDe = async (id: string) => { if (!nombres.has(id)) { const o = await leerTienda(id); nombres.set(id, o?.nombre || id); } return nombres.get(id); };
  const cuenta = async (r: Item, otra: string) => ({
    id: r.id, tienda: otra, tiendaNombre: await nombreDe(otra), nombre: r.nombre, q: r.q, monto: r.monto,
    moneda: r.moneda, via: r.via, estado: r.estado, creado: r.creado,
  });
  const orden = (a: Item, b: Item) => Number(b.creado) - Number(a.creado);

  return {
    moneda: monedaDe(t),
    relaciones: rels.map((r) => ({ tienda: r.otra, nombre: nombres.get(r.otra), estado: r.estado, invitaYo: r.invita === t.id }))
      .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre))),
    compartidos,
    copias,
    compartidosPorMi: mios.filter((p) => p.compartido && !p.origenId).length,
    meDeben: await Promise.all(meDeben.sort(orden).slice(0, 300).map((r) => cuenta(r, r.revendedora))),
    debo: await Promise.all(debo.sort(orden).slice(0, 300).map((r) => cuenta(r, r.duena))),
  };
}

// ---------- Invitar, aceptar y cortar ----------
async function invitar(t: Item, d: Item) {
  const slug = limpiarSlug(d.slug);
  if (!slug) fallo('Escribe el enlace de la tienda (por ejemplo, lucia-store)');
  if (slug === t.id) fallo('Esa es tu propia tienda');
  const otra = await leerTienda(slug);
  if (!otra) fallo('No encontramos esa tienda. Revisa el enlace.');
  if (monedaDe(otra!) !== monedaDe(t)) fallo('Solo puedes conectarte con tiendas que usan la misma moneda que tú');
  const r = await leerRelacion(t.id, slug);
  if (r && r.estado === 'aceptada') fallo('Ya son tiendas de confianza');
  if (r && r.invita === t.id) fallo('Ya le enviaste una invitación; falta que la acepte');
  if (r) return aceptar(t, { slug }); // ella ya me había invitado: queda aceptada
  const ahora = new Date().toISOString();
  await ddb.send(new PutCommand({
    TableName: CONFIANZA(),
    Item: { id: parDe(t.id, slug), __typename: 'Confianza', tiendaA: t.id < slug ? t.id : slug, tiendaB: t.id < slug ? slug : t.id, invita: t.id, estado: 'pendiente', createdAt: ahora, updatedAt: ahora },
    ConditionExpression: 'attribute_not_exists(id)',
  }));
  if (otra!.email) {
    await enviarCorreo({
      para: otra!.email, responderA: t.email,
      asunto: `${t.nombre} quiere ser tu tienda de confianza`,
      html: `<p style="font-family:Arial,sans-serif;font-size:15px"><b>${String(t.nombre).replace(/</g, '&lt;')}</b> te invitó a ser tiendas de confianza en Showroomcito: podrán revender los productos que cada una comparta. Entra a tu tienda › <b>Tiendas de confianza</b> para aceptar o rechazar.</p>`,
    });
  }
  return { ok: true, estado: 'pendiente' };
}

async function aceptar(t: Item, d: Item) {
  const slug = limpiarSlug(d.slug);
  const r = await leerRelacion(t.id, slug);
  if (!r) fallo('La invitación ya no existe');
  if (r!.estado === 'aceptada') return { ok: true, estado: 'aceptada' };
  if (r!.invita === t.id) fallo('La otra tienda es la que debe aceptar');
  await ddb.send(new UpdateCommand({
    TableName: CONFIANZA(), Key: { id: r!.id },
    UpdateExpression: 'SET estado = :a, updatedAt = :t', ExpressionAttributeValues: { ':a': 'aceptada', ':t': new Date().toISOString() },
  }));
  return { ok: true, estado: 'aceptada' };
}

/** Corta la relación (o rechaza / cancela la invitación) y quita de ambas tiendas lo que revendían de la otra. */
async function cortarEntre(a: string, b: string) {
  await ddb.send(new DeleteCommand({ TableName: CONFIANZA(), Key: { id: parDe(a, b) } }));
  let quitados = 0;
  for (const [tienda, origen] of [[a, b], [b, a]]) {
    for (const p of await productosDe(tienda)) {
      if (p.origenId && p.origenTienda === origen) { await ddb.send(new DeleteCommand({ TableName: PRODUCTO(), Key: { id: p.id } })); quitados++; }
    }
  }
  return { ok: true, quitados };
}
async function cortar(t: Item, d: Item) {
  const slug = limpiarSlug(d.slug);
  if (!slug) fallo('Falta la tienda');
  return cortarEntre(t.id, slug);
}

// ---------- Agregar a mi tienda productos que me compartieron ----------
async function agregar(t: Item, d: Item) {
  const ids: string[] = (Array.isArray(d.ids) ? d.ids : []).map(String).slice(0, 200);
  if (!ids.length) fallo('Elige al menos un producto');
  const margen = Math.min(500, Math.max(0, Number(d.margen) || 0));
  const originales = await leerProductos(ids);
  const yaTengo = new Set((await productosDe(t.id)).filter((p) => p.origenId).map((p) => String(p.origenId)));
  const relOk = new Map<string, boolean>();
  const ahora = new Date().toISOString();
  let creados = 0, omitidos = 0;
  for (const [i, id] of ids.entries()) {
    const o = originales.get(id);
    if (!o || o.origenId || yaTengo.has(id) || o.tiendaId === t.id) { omitidos++; continue; }
    if (!relOk.has(o.tiendaId)) { const r = await leerRelacion(t.id, o.tiendaId); relOk.set(o.tiendaId, !!r && r.estado === 'aceptada'); }
    if (!originalVendible({ origenTienda: o.tiendaId }, o, !!relOk.get(o.tiendaId))) { omitidos++; continue; }
    const base = typeof o.precioReventa === 'number' ? o.precioReventa : (typeof o.precio === 'number' ? o.precio : null);
    await ddb.send(new PutCommand({
      TableName: PRODUCTO(),
      Item: {
        id: randomUUID(), __typename: 'Producto', owner: t.owner, tiendaId: t.id, ...datosProducto(o),
        precio: base == null ? null : Math.max(1, Math.ceil(base * (1 + margen / 100))),
        estado: 'disponible', creado: Date.now() + (ids.length - i), origenId: o.id, origenTienda: o.tiendaId,
        createdAt: ahora, updatedAt: ahora,
      },
    }));
    yaTengo.add(id); creados++;
  }
  return { creados, omitidos };
}

// ---------- Registrar una venta de un producto de confianza (WhatsApp, efectivo o Yape) ----------
async function vendi(t: Item, d: Item) {
  const { Item: copia } = await ddb.send(new GetCommand({ TableName: PRODUCTO(), Key: { id: String(d.copiaId || '') } }));
  if (!copia || copia.tiendaId !== t.id || !copia.origenId) fallo('Ese producto no es de una tienda de confianza');
  const via = d.via === 'yape' ? 'yape' : 'manual';
  if (via === 'manual') {
    const r = await leerRelacion(t.id, String(copia!.origenTienda));
    const o = (await leerProductos([String(copia!.origenId)])).get(String(copia!.origenId));
    const ok = originalVendible(copia!, o, !!r && r.estado === 'aceptada');
    if (!ok) fallo('Este producto ya no está disponible en la tienda de confianza');
    if (typeof ok!.stock === 'number' && Number(d.q) > ok!.stock) fallo(ok!.stock > 0 ? `Solo quedan ${ok!.stock}` : 'Ya no quedan unidades');
  }
  const r = await registrarReventa(copia!, Number(d.q) || 1, via, d.pedidoId ? String(d.pedidoId).slice(0, 60) : undefined);
  return { ok: true, ...(r || {}) };
}

/** La dueña marca que la revendedora ya le pagó (o lo deshace). */
async function saldar(t: Item, d: Item) {
  const { Item: r } = await ddb.send(new GetCommand({ TableName: REVENTA(), Key: { id: String(d.reventaId || '') } }));
  if (!r || r.duena !== t.id) fallo('Solo la dueña del producto puede marcarlo como pagado');
  const estado = d.estado === 'debe' ? 'debe' : 'pagado';
  await ddb.send(new UpdateCommand({
    TableName: REVENTA(), Key: { id: r!.id },
    UpdateExpression: 'SET estado = :e, updatedAt = :t', ExpressionAttributeValues: { ':e': estado, ':t': new Date().toISOString() },
  }));
  return { ok: true, estado };
}

// ---------- Panel de la dueña de Showroomcito ----------
async function adminListar() {
  const items: Item[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(new ScanCommand({ TableName: CONFIANZA(), ExclusiveStartKey }));
    items.push(...((r.Items || []) as Item[]));
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey && items.length < 5000);
  return { relaciones: items.map((r) => ({ id: r.id, tiendaA: r.tiendaA, tiendaB: r.tiendaB, invita: r.invita, estado: r.estado, creado: r.createdAt })) };
}

export const handler = async (event: Evento) => {
  const a = event.arguments || {};
  const ident = event.identity;
  let d: Item = {};
  try { d = JSON.parse(String(a.datos || '{}')) || {}; } catch { fallo('Datos no válidos'); }
  const accion = String(a.accion || '');
  let res: unknown;
  if (accion === 'admin_listar' || accion === 'admin_cortar') {
    if (!esSuper(ident)) fallo('No autorizado');
    if (accion === 'admin_listar') res = await adminListar();
    else { const [x, y] = String(d.id || '').split('|'); if (!x || !y) fallo('Relación no válida'); res = await cortarEntre(x, y); }
    return JSON.stringify(res);
  }
  const t = await miTienda(String(a.tiendaId || ''), ident);
  switch (accion) {
    case 'listar': res = await listar(t); break;
    case 'invitar': res = await invitar(t, d); break;
    case 'aceptar': res = await aceptar(t, d); break;
    case 'cortar': res = await cortar(t, d); break;
    case 'agregar': res = await agregar(t, d); break;
    case 'vendi': res = await vendi(t, d); break;
    case 'saldar': res = await saldar(t, d); break;
    default: fallo('Acción desconocida');
  }
  return JSON.stringify(res);
};
