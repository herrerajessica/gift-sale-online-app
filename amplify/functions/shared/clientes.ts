// Clientes de cada tienda (tabla Cliente, id = "<tienda>|<correo>").
// Se crean solos cuando alguien compra con su correo o entra a "Mis pedidos".
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from './tablas';

export const CLIENTE = () => process.env.CLIENTE_TABLE as string;
export const normEmail = (s: unknown) => String(s || '').trim().toLowerCase().slice(0, 254);
export const emailOk = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
export const idCliente = (tiendaId: string, email: string) => `${tiendaId}|${normEmail(email)}`;

/** Crea o actualiza el cliente de una tienda sin borrar lo que ya tenía. Nunca rompe una venta. */
export async function registrarCliente(t: { id: string; owner?: string }, d: { email?: string; nombre?: string; telefono?: string; verificado?: boolean }) {
  const email = normEmail(d.email);
  if (!process.env.CLIENTE_TABLE || !emailOk(email)) return;
  const ahora = new Date().toISOString();
  const sets = ['tiendaId = :t', 'email = :e', '#o = :o', '#ty = :ty', 'createdAt = if_not_exists(createdAt, :a)', 'updatedAt = :a', 'ultimaVez = :a'];
  const v: Record<string, unknown> = { ':t': t.id, ':e': email, ':o': t.owner, ':ty': 'Cliente', ':a': ahora };
  if (d.nombre) { sets.push('nombre = if_not_exists(nombre, :n)'); v[':n'] = String(d.nombre).slice(0, 60); }
  if (d.telefono) { sets.push('telefono = if_not_exists(telefono, :f)'); v[':f'] = String(d.telefono).slice(0, 30); }
  if (d.verificado) { sets.push('verificado = :vf'); v[':vf'] = true; }
  try {
    await ddb.send(new UpdateCommand({
      TableName: CLIENTE(), Key: { id: idCliente(t.id, email) },
      UpdateExpression: 'SET ' + sets.join(', '),
      ExpressionAttributeNames: { '#o': 'owner', '#ty': '__typename' },
      ExpressionAttributeValues: v,
    }));
  } catch (e) { console.error('No se pudo registrar el cliente', e); }
}
