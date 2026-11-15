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
    productoId: r.productoId, copiaId: r.copiaId, hasta: r.hasta ?? null, cliente: r.cliente || '',
  });
  const orden = (a: Item, b: Item) => Number(b.creado) - Number(a.creado);

  return {
    moneda: monedaDe(t),
    diasSeparado: diasDe(t),
    relaciones: rels.map((r) => ({ tienda: r.otra, nombre: nombres.get(r.otra), estado: r.estado, invitaYo: r.invita === t.id }))
      .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre))),
    compartidos,
    copias,
    compartidosPorMi: mios.filter((p) => p.compartido && !p.origenId).length,
    meDeben: await Promise.all(meDeben.sort(orden).slice(0, 300).map((r) => cuenta(r, r.revendedora))),
    debo: await Promise.all(debo.sort(orden).slice(0, 300).map((r) => cuenta(r, r.duena))),
  };
}

const diasDe = (t: Item) => (Number.isInteger(t.diasSeparado) && t.diasSeparado > 0 ? Math.min(60, t.diasSeparado) : 7);
const plataTxt = (n: number, moneda: string) => (moneda === 'PEN' ? 'S/ ' : '$') + n.toLocaleString('es-PE', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const escHtml = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const fechaTxt = (ms: number) => new Date(ms).toLocaleDateString('es-PE', { day: 'numeric', month: 'long', timeZone: 'America/Lima' });
function avisoHtml(titulo: string, texto: string) {
  return `<!doctype html><html lang="es"><body style="margin:0;background:#f7f5f0;font-family:Arial,Helvetica,sans-serif;color:#16203a"><div style="max-width:520px;margin:0 auto;padding:24px 16px"><div style="background:#fff;border:1px solid #e3dfd6;border-radius:14px;padding:24px"><h1 style="margin:0 0 12px;font-size:22px">${titulo}</h1><p style="margin:0;font-size:15px">${texto}</p></div><p style="font-size:12px;color:#5b6275;text-align:center;margin:16px 0 0">Aviso automático de tu tienda en Showroomcito.</p></div></body></html>`;
}

// ---------- Separar (la clienta de la revendedora pidió que se lo guarden) ----------
async function separar(t: Item, d: Item) {
  const { Item: copia } = await ddb.send(new GetCommand({ TableName: PRODUCTO(), Key: { id: String(d.copiaId || '') } }));
  if (!copia || copia.tiendaId !== t.id || !copia.origenId) fallo('Ese producto no es de una tienda de confianza');
  const r = await leerRelacion(t.id, String(copia!.origenTienda));
  const o = (await leerProductos([String(copia!.origenId)])).get(String(copia!.origenId));
  const ok = originalVendible(copia!, o, !!r && r.estado === 'aceptada');
  if (!ok) fallo('Este producto ya no está disponible para separar');
  const q = Math.min(99, Math.max(1, Math.floor(Number(d.q) || 1)));
  if (typeof ok!.stock === 'number' && q > ok!.stock) fallo(ok!.stock > 0 ? `Solo quedan ${ok!.stock}` : 'Ya no quedan unidades');
  if (typeof ok!.stock !== 'number' && q > 1) fallo('Este producto es una pieza única');
  const duena = await leerTienda(String(ok!.tiendaId));
  const dias = diasDe(duena || {});
  const ahora = Date.now(), iso = new Date().toISOString();
  const moneda = duena ? monedaDe(duena) : 'USD';
  const unitario = typeof ok!.precioReventa === 'number' ? ok!.precioReventa : (typeof ok!.precio === 'number' ? ok!.precio : 0);
  const id = randomUUID(), hasta = ahora + dias * 864e5, cliente = String(d.cliente || '').trim().slice(0, 60);
  // Primero se bloquean las unidades en el original (con condición, para que dos tiendas no separen la misma).
  try {
    if (typeof ok!.stock === 'number') {
      await ddb.send(new UpdateCommand({
        TableName: PRODUCTO(), Key: { id: ok!.id },
        UpdateExpression: 'SET stock = stock - :q, updatedAt = :t', ConditionExpression: 'stock >= :q',
        ExpressionAttributeValues: { ':q': q, ':t': iso },
      }));
    } else {
      await ddb.send(new UpdateCommand({
        TableName: PRODUCTO(), Key: { id: ok!.id },
        UpdateExpression: 'SET estado = :a, updatedAt = :t', ConditionExpression: 'attribute_not_exists(estado) OR estado = :d',
        ExpressionAttributeValues: { ':a': 'apartado', ':d': 'disponible', ':t': iso },
      }));
    }
  } catch (e) {
    if ((e as { name?: string }).name === 'ConditionalCheckFailedException') fallo('Alguien lo acaba de separar o vender. Ya no está disponible.');
    throw e;
  }
  await ddb.send(new PutCommand({
    TableName: REVENTA(),
    Item: {
      id, __typename: 'Reventa', duena: ok!.tiendaId, revendedora: t.id, productoId: ok!.id, copiaId: copia!.id, nombre: ok!.nombre,
      q, monto: Math.round(unitario * q * 100) / 100, moneda, via: 'manual', estado: 'separado', hasta, cliente, creado: ahora, createdAt: iso, updatedAt: iso,
    },
  }));
  const msg = `Hola, soy ${t.nombre}. Separé ${q > 1 ? q + ' unidades de ' : ''}"${ok!.nombre}"${cliente ? ' para ' + cliente : ''}. Te confirmo la venta hasta el ${fechaTxt(hasta)}.`;
  if (duena && duena.email) {
    await enviarCorreo({
      para: duena.email, responderA: t.email, asunto: `${t.nombre} separó tu producto: ${ok!.nombre}`,
      html: avisoHtml('Separaron tu producto', `<b>${escHtml(t.nombre)}</b>, tu tienda de confianza, separó <b>${escHtml(ok!.nombre)}</b>${q > 1 ? ` × ${q}` : ''}${cliente ? ` para ${escHtml(cliente)}` : ''}. Ya no se puede vender en ninguna tienda. Tiene hasta el <b>${fechaTxt(hasta)}</b> para confirmar la venta; si no, puedes liberarlo desde <b>Tiendas de confianza › Cuentas</b>.`),
    });
  }
  const wa = String(duena?.whatsapp || '').replace(/\D/g, '');
  return { ok: true, id, hasta, dias, duenaNombre: duena?.nombre || '', whatsapp: wa ? `https://wa.me/${wa}?text=${encodeURIComponent(msg)}` : '' };
}

/** La revendedora confirma que el separado se vendió: pasa a la cuenta "debe". */
async function confirmarSeparado(t: Item, d: Item) {
  const { Item: r } = await ddb.send(new GetCommand({ TableName: REVENTA(), Key: { id: String(d.reventaId || '') } }));
  if (!r || r.revendedora !== t.id) fallo('Ese separado no es tuyo');
  if (r!.estado !== 'separado') fallo('Ese separado ya se cerró');
  const iso = new Date().toISOString();
  await ddb.send(new UpdateCommand({
    TableName: REVENTA(), Key: { id: r!.id }, ConditionExpression: 'estado = :s',
    UpdateExpression: 'SET estado = :e, creado = :c, updatedAt = :t', ExpressionAttributeValues: { ':s': 'separado', ':e': 'debe', ':c': Date.now(), ':t': iso },
  }));
  // Pieza única: de apartada pasa a vendida (con cantidad, las unidades ya se descontaron al separar).
  const { Item: o } = await ddb.send(new GetCommand({ TableName: PRODUCTO(), Key: { id: String(r!.productoId) } }));
  if (o && typeof o.stock !== 'number' && o.estado === 'apartado') {
    await ddb.send(new UpdateCommand({ TableName: PRODUCTO(), Key: { id: o.id }, UpdateExpression: 'SET estado = :v, updatedAt = :t', ExpressionAttributeValues: { ':v': 'vendido', ':t': iso } }));
  }
  const duena = await leerTienda(String(r!.duena));
  if (duena && duena.email) {
    await enviarCorreo({
      para: duena.email, responderA: t.email, asunto: `Vendieron tu producto: ${r!.nombre}`,
      html: avisoHtml('Vendieron tu producto', `<b>${escHtml(t.nombre)}</b> confirmó la venta de <b>${escHtml(r!.nombre)}</b>${r!.q > 1 ? ` × ${r!.q}` : ''}. Te debe <b>${plataTxt(Number(r!.monto) || 0, r!.moneda)}</b>. Cuando te pague, márcalo en <b>Tiendas de confianza › Cuentas</b>.`),
    });
  }
  return { ok: true, monto: r!.monto, moneda: r!.moneda };
}

/** Libera un separado: la revendedora en cualquier momento; la dueña cuando ya venció. */
async function liberarSeparado(t: Item, d: Item) {
  const { Item: r } = await ddb.send(new GetCommand({ TableName: REVENTA(), Key: { id: String(d.reventaId || '') } }));
  if (!r || (r.revendedora !== t.id && r.duena !== t.id)) fallo('Ese separado no es tuyo');
  if (r!.estado !== 'separado') fallo('Ese separado ya se cerró');
  if (r!.duena === t.id && r!.revendedora !== t.id && Number(r!.hasta) > Date.now()) fallo(`Todavía no vence: la otra tienda tiene hasta el ${fechaTxt(Number(r!.hasta))}`);
  const iso = new Date().toISOString();
  await ddb.send(new UpdateCommand({
    TableName: REVENTA(), Key: { id: r!.id }, ConditionExpression: 'estado = :s',
    UpdateExpression: 'SET estado = :e, updatedAt = :t', ExpressionAttributeValues: { ':s': 'separado', ':e': 'liberado', ':t': iso },
  }));
  // Devuelve las unidades (o vuelve a dejar disponible la pieza única).
  const { Item: o } = await ddb.send(new GetCommand({ TableName: PRODUCTO(), Key: { id: String(r!.productoId) } }));
  if (o && typeof o.stock === 'number') {
    await ddb.send(new UpdateCommand({ TableName: PRODUCTO(), Key: { id: o.id }, UpdateExpression: 'SET stock = stock + :q, updatedAt = :t', ExpressionAttributeValues: { ':q': Number(r!.q) || 1, ':t': iso } }));
  } else if (o && o.estado === 'apartado') {
    await ddb.send(new UpdateCommand({ TableName: PRODUCTO(), Key: { id: o.id }, UpdateExpression: 'SET estado = :v, updatedAt = :t', ExpressionAttributeValues: { ':v': 'disponible', ':t': iso } }));
  }
  const otra = await leerTienda(String(r!.duena === t.id ? r!.revendedora : r!.duena));
  if (otra && otra.email) {
    await enviarCorreo({
      para: otra.email, asunto: `Separado liberado: ${r!.nombre}`,
      html: avisoHtml('Se liberó un separado', `<b>${escHtml(t.nombre)}</b> liberó <b>${escHtml(r!.nombre)}</b>${r!.q > 1 ? ` × ${r!.q}` : ''}. Vuelve a estar disponible.`),
    });
  }
  return { ok: true };
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
  if (r!.estado === 'separado' || r!.estado === 'liberado') fallo('Primero la otra tienda debe confirmar la venta');
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
    case 'separar': res = await separar(t, d); break;
    case 'confirmar': res = await confirmarSeparado(t, d); break;
    case 'liberar': res = await liberarSeparado(t, d); break;
    case 'saldar': res = await saldar(t, d); break;
    default: fallo('Acción desconocida');
  }
  return JSON.stringify(res);
};
