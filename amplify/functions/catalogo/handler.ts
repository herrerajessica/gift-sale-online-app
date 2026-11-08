import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { Schema } from '../../data/resource';
import { PLANES, planVigente } from '../shared/planes';

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
export const handler: Schema['catalogo']['functionHandler'] = async (event) => {
  const slug = String(event.arguments.slug || '').trim().toLowerCase();
  if (!/^[a-z0-9-]{3,40}$/.test(slug)) return JSON.stringify({ estado: 'no_existe' });

  const { Item: t } = await ddb.send(new GetCommand({ TableName: process.env.TIENDA_TABLE, Key: { id: slug } }));
  if (!t) return JSON.stringify({ estado: 'no_existe' });

  const ident = event.identity as Identidad;
  const sub = ident && ident.sub;
  const esDuena = !!sub && String(t.owner || '').split('::')[0] === sub;
  const esSuper = !!ident && Array.isArray(ident.groups) && ident.groups.includes('SUPERADMIN');
  const estado = t.estado || 'pendiente';

  if (estado !== 'aprobada' && !esDuena && !esSuper) {
    return JSON.stringify({ estado, tienda: { id: t.id, nombre: t.nombre } });
  }

  const productos: Record<string, unknown>[] = [];
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
      productos.push({
        id: p.id, nombre: p.nombre, marca: p.marca || '', precio: p.precio ?? null,
        stock: typeof p.stock === 'number' ? p.stock : null, talla: p.talla || '', categoria: p.categoria || '',
        // "costo" nunca se devuelve: es dato privado de la vendedora.
        publico: p.publico || '', descripcion: p.descripcion || '', estado: p.estado || 'disponible',
        fotosFull: p.fotosFull || [], fotosThumb: p.fotosThumb || [], creado: p.creado || 0,
      });
    }
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey && productos.length < MAX_PRODUCTOS);

  const plan = planVigente(t);
  const limite = PLANES[plan].limite;
  productos.sort((a, b) => Number(b.creado) - Number(a.creado));
  const fueraDelPlan = limite == null ? 0 : Math.max(0, productos.length - limite);
  const visibles = limite == null ? productos : productos.slice(0, limite);

  return JSON.stringify({
    estado,
    vistaPrevia: estado !== 'aprobada',
    tienda: { id: t.id, nombre: t.nombre, whatsapp: t.whatsapp || '', tipoCambio: t.tipoCambio ?? null, cobrosActivos: !!t.cobrosActivos,
      yapeNumero: t.yapeNumero || '', yapeNombre: t.yapeNombre || '', yapeQr: t.yapeQr || '' },
    productos: visibles,
    // Solo la dueña ve cuántos productos quedaron fuera por el límite del plan.
    ...(esDuena || esSuper ? { fueraDelPlan } : {}),
  });
};
