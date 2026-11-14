// Tiendas de confianza: reglas compartidas por el catálogo, los pagos, el webhook y la función "confianza".
// Una revendedora tiene en su tienda una COPIA del producto (con origenId/origenTienda).
// La foto, la cantidad y la disponibilidad siempre salen del ORIGINAL; el precio y el nombre, de la copia.
import { randomUUID } from 'node:crypto';
import { BatchGetCommand, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, PRODUCTO, CONFIANZA, REVENTA, leerTienda } from './tablas';
import { enviarCorreo } from './correo';

type Item = Record<string, any>;

/** id de la relación: las dos tiendas en orden alfabético. */
export const parDe = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Moneda en la que una tienda guarda sus precios: soles (Perú con precios en soles) o dólares. */
export const monedaDe = (t: Item) => (t.pais !== 'US' && t.moneda === 'PEN' ? 'PEN' : 'USD');

export async function leerRelacion(a: string, b: string) {
  if (!process.env.CONFIANZA_TABLE) return undefined;
  const { Item } = await ddb.send(new GetCommand({ TableName: CONFIANZA(), Key: { id: parDe(a, b) } }));
  return Item as Item | undefined;
}

export async function relacionActiva(a: string, b: string) {
  const r = await leerRelacion(a, b);
  return !!r && r.estado === 'aceptada';
}

/** Lee varios productos por id (de 100 en 100, como permite DynamoDB). */
export async function leerProductos(ids: string[]) {
  const unicos = [...new Set(ids.filter(Boolean))];
  const mapa = new Map<string, Item>();
  for (let i = 0; i < unicos.length; i += 100) {
    const r = await ddb.send(new BatchGetCommand({ RequestItems: { [PRODUCTO()]: { Keys: unicos.slice(i, i + 100).map((id) => ({ id })) } } }));
    for (const p of r.Responses?.[PRODUCTO()] || []) mapa.set(String(p.id), p as Item);
  }
  return mapa;
}

/** ¿El original de esta copia se puede vender? Devuelve el original o null. */
export function originalVendible(copia: Item, original: Item | undefined, relacionOk: boolean) {
  if (!original || !relacionOk) return null;
  if (original.tiendaId !== copia.origenTienda || !original.compartido) return null;
  if (original.estado === 'vendido' || original.estado === 'oculto') return null;
  return original;
}

/**
 * Resuelve las copias de una lista de productos de una tienda: devuelve, por id de copia,
 * el original si sigue disponible para revender (o null si ya no).
 */
export async function resolverCopias(tiendaId: string, productos: Item[]) {
  const copias = productos.filter((p) => p.origenId && p.origenTienda);
  const res = new Map<string, Item | null>();
  if (!copias.length) return res;
  const originales = await leerProductos(copias.map((c) => String(c.origenId)));
  const relaciones = new Map<string, boolean>();
  for (const t of new Set(copias.map((c) => String(c.origenTienda)))) relaciones.set(t, await relacionActiva(tiendaId, t));
  for (const c of copias) res.set(String(c.id), originalVendible(c, originales.get(String(c.origenId)), !!relaciones.get(String(c.origenTienda))));
  return res;
}

const plata = (n: number, moneda: string) => (moneda === 'PEN' ? 'S/ ' : '$') + n.toLocaleString('es-PE', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/**
 * La revendedora vendió q unidades de una copia: baja la cantidad del original
 * (o lo marca vendido si no lleva cantidad), anota la deuda y avisa a la dueña.
 * clave: evita registrar dos veces la misma venta (por ejemplo, pedido + producto).
 */
export async function registrarReventa(copia: Item, q: number, via: 'tarjeta' | 'yape' | 'manual', pedidoId?: string) {
  const cantidad = Math.min(99, Math.max(1, Math.floor(Number(q) || 1)));
  const { Item: original } = await ddb.send(new GetCommand({ TableName: PRODUCTO(), Key: { id: String(copia.origenId) } }));
  if (!original || original.tiendaId !== copia.origenTienda) return null;

  const id = pedidoId ? `${pedidoId}:${copia.id}` : randomUUID();
  const ahora = new Date().toISOString();
  const [duena, revendedora] = await Promise.all([leerTienda(String(original.tiendaId)), leerTienda(String(copia.tiendaId))]);
  const moneda = duena ? monedaDe(duena) : 'USD';
  const unitario = typeof original.precioReventa === 'number' ? original.precioReventa : (typeof original.precio === 'number' ? original.precio : 0);
  const monto = Math.round(unitario * cantidad * 100) / 100;
  try {
    await ddb.send(new PutCommand({
      TableName: REVENTA(),
      Item: {
        id, __typename: 'Reventa', duena: original.tiendaId, revendedora: copia.tiendaId, productoId: original.id, copiaId: copia.id,
        nombre: original.nombre, q: cantidad, monto, moneda, via, pedidoId, estado: 'debe', creado: Date.now(), createdAt: ahora, updatedAt: ahora,
      },
      ConditionExpression: 'attribute_not_exists(id)',
    }));
  } catch (e) {
    if ((e as { name?: string }).name === 'ConditionalCheckFailedException') return null; // ya estaba registrada
    throw e;
  }

  // Baja la cantidad del original; si no lleva cantidad, queda vendido (es una pieza única).
  if (typeof original.stock === 'number') {
    await ddb.send(new UpdateCommand({
      TableName: PRODUCTO(), Key: { id: original.id },
      UpdateExpression: 'SET stock = :s, updatedAt = :t',
      ExpressionAttributeValues: { ':s': Math.max(0, original.stock - cantidad), ':t': ahora },
    }));
  } else {
    await ddb.send(new UpdateCommand({
      TableName: PRODUCTO(), Key: { id: original.id },
      UpdateExpression: 'SET estado = :v, updatedAt = :t',
      ExpressionAttributeValues: { ':v': 'vendido', ':t': ahora },
    }));
  }

  if (duena && duena.email) {
    const quien = esc(revendedora?.nombre || copia.tiendaId);
    const html = `<!doctype html><html lang="es"><body style="margin:0;background:#f7f5f0;font-family:Arial,Helvetica,sans-serif;color:#16203a">
<div style="max-width:520px;margin:0 auto;padding:24px 16px"><div style="background:#fff;border:1px solid #e3dfd6;border-radius:14px;padding:24px">
<h1 style="margin:0 0 12px;font-size:22px">Vendieron tu producto</h1>
<p style="margin:0 0 12px;font-size:15px"><b>${quien}</b>, tu tienda de confianza, vendió <b>${esc(original.nombre)}</b>${cantidad > 1 ? ` × ${cantidad}` : ''}.</p>
<p style="margin:0 0 12px;font-size:15px">Te debe <b>${plata(monto, moneda)}</b>. Coordinen la entrega y el pago; cuando te pague, márcalo como pagado en <b>Tiendas de confianza › Cuentas</b>.</p>
</div><p style="font-size:12px;color:#5b6275;text-align:center;margin:16px 0 0">Aviso automático de tu tienda en Showroomcito.</p></div></body></html>`;
    await enviarCorreo({ para: duena.email, asunto: `Vendieron tu producto: ${original.nombre}`, html, responderA: revendedora?.email });
  }
  return { id, monto, moneda };
}
