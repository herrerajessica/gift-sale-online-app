import { ofertaActiva } from '../shared/oferta';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { preguntarTienda } from './cliente';
import { PLANES, planVigente } from '../shared/planes';
import { resolverCopias } from '../shared/reventa';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const MAX_PRODUCTOS = 5000;

type Identidad = { sub?: string; groups?: string[] | null } | null | undefined;

/**
 * Vitrina pública de una vendedora.
 * Devuelve productos solo si la tienda está aprobada, salvo para su dueña
 * o para SUPERADMIN, que pueden previsualizarla en cualquier estado.
 * El límite del plan se aplica aquí, en el servidor: solo se muestran los
 * productos más recientes que permite el plan vigente.
 */
type Evento = { fieldName?: string; info?: { fieldName?: string }; arguments: { slug?: string; mensajes?: string }; identity?: unknown };

export const handler = async (event: Evento) => {
  const campo = event.fieldName || (event.info && event.info.fieldName);
  if (campo === 'preguntarTienda') {
    // El asistente de clientes usa exactamente lo que el cliente ve en la tienda (sin la vista previa de la dueña).
    const { res, t } = await armarCatalogo({ ...event, identity: null });
    return preguntarTienda(res, t, String(event.arguments.mensajes || ''));
  }
  return JSON.stringify((await armarCatalogo(event)).res);
};

/** Devuelve lo que ve el cliente (res) y, si existe, la tienda tal cual está guardada (t). */
async function armarCatalogo(event: Evento): Promise<{ res: Record<string, unknown>; t?: Record<string, any> }> {
  const slug = String(event.arguments.slug || '').trim().toLowerCase();
  if (!/^[a-z0-9-]{3,40}$/.test(slug)) return { res: { estado: 'no_existe' } };

  const { Item: t } = await ddb.send(new GetCommand({ TableName: process.env.TIENDA_TABLE, Key: { id: slug } }));
  if (!t) return { res: { estado: 'no_existe' } };

  const ident = event.identity as Identidad;
  const sub = ident && ident.sub;
  const esDuena = !!sub && String(t.owner || '').split('::')[0] === sub;
  const esSuper = !!ident && Array.isArray(ident.groups) && ident.groups.includes('SUPERADMIN');
  const estado = t.estado || 'pendiente';

  if (estado !== 'aprobada' && !esDuena && !esSuper) {
    return { res: { estado, tienda: { id: t.id, nombre: t.nombre } }, t };
  }

  const productos: Record<string, unknown>[] = [];
  const crudos: Record<string, any>[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(new QueryCommand({
      TableName: process.env.PRODUCTO_TABLE,
      IndexName: 'byTienda',
      KeyConditionExpression: 'tiendaId = :t',
      ExpressionAttributeValues: { ':t': slug },
      ExclusiveStartKey,
    }));
    for (const p of r.Items || []) {
      if (p.estado === 'oculto') continue; // ocultos: solo los ve la vendedora
      crudos.push(p);
    }
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey && crudos.length < MAX_PRODUCTOS);

  // Productos de tiendas de confianza: fotos, cantidad y disponibilidad salen del original.
  // Si el original ya no se puede revender, no se muestra. El cliente nunca ve de qué tienda viene.
  const copias = await resolverCopias(slug, crudos);
  for (const c of crudos) {
    let p = c;
    if (c.origenId) {
      const o = copias.get(String(c.id));
      if (!o) continue;
      p = { ...c, stock: o.stock, fotosFull: o.fotosFull, fotosThumb: o.fotosThumb };
    }
    productos.push({
      id: p.id, codigo: c.codigo || '', nombre: p.nombre, marca: p.marca || '',
      // Con oferta vigente, "precio" ya es el de oferta (así el carrito, Yape y la tarjeta cobran lo mismo) y "precioAntes" el normal.
      ...(ofertaActiva(p) ? { precio: p.precioOferta, precioAntes: p.precio, ofertaHasta: p.ofertaHasta } : { precio: p.precio ?? null }),
      stock: typeof p.stock === 'number' ? p.stock : null, talla: p.talla || '', condicion: p.condicion || '', categoria: p.categoria || '', tipo: p.tipo || '',
      // "costo", "precioReventa" y el origen nunca se devuelven: son datos privados de las vendedoras.
      publico: p.publico || '', descripcion: p.descripcion || '', estado: p.estado || 'disponible',
      fotosFull: p.fotosFull || [], fotosThumb: p.fotosThumb || [], creado: p.creado || 0,
    });
  }

  const plan = planVigente(t);
  const limite = PLANES[plan].limite;
  productos.sort((a, b) => Number(b.creado) - Number(a.creado));
  const fueraDelPlan = limite == null ? 0 : Math.max(0, productos.length - limite);
  const visibles = limite == null ? productos : productos.slice(0, limite);

  return { t, res: {
    estado,
    vistaPrevia: estado !== 'aprobada',
    tienda: { id: t.id, nombre: t.nombre, pais: t.pais === 'US' ? 'US' : 'PE', moneda: t.pais !== 'US' && t.moneda === 'PEN' ? 'PEN' : 'USD', whatsapp: t.whatsapp || '', tipoCambio: t.tipoCambio ?? null, cobrosActivos: !!t.cobrosActivos,
      descuentoContado: typeof t.descuentoContado === 'number' ? t.descuentoContado : 0,
      yapeNumero: t.yapeNumero || '', yapeNombre: t.yapeNombre || '', yapeQr: t.yapeQr || '', grupoWhatsapp: t.grupoWhatsapp || '', chatClientes: t.chatClientes !== false,
      portada: t.portada || '', descripcionTienda: t.descripcionTienda || '' },
    productos: visibles,
    // Solo la dueña ve cuántos productos quedaron fuera por el límite del plan.
    ...(esDuena || esSuper ? { fueraDelPlan } : {}),
  } };
}
