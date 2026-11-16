// "Mis pedidos" del cliente: entra con un código de 6 números que le llega al correo.
// - pedirCodigo: envía el código (vence en 10 min; uno por minuto como máximo).
// - entrar: valida el código y devuelve una sesión (90 días, hasta 5 aparatos).
// - misPedidos / guardarPerfil: con esa sesión.
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, leerTienda, PEDIDO } from '../shared/tablas';
import { CLIENTE, emailOk, idCliente, normEmail, registrarCliente } from '../shared/clientes';
import { enviarCorreo } from '../shared/correo';

type Evento = { fieldName: string; arguments: Record<string, any> };
const fallo = (m: string) => { throw new Error(m); };
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const iguales = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const DIA = 864e5;

async function tienda(id: unknown) {
  const t = await leerTienda(String(id || '').toLowerCase());
  if (!t || t.estado !== 'aprobada') fallo('Esta tienda no está disponible');
  return t!;
}
const leer = async (id: string) => (await ddb.send(new GetCommand({ TableName: CLIENTE(), Key: { id } }))).Item as Record<string, any> | undefined;
const perfil = (c: Record<string, any>) => ({ email: c.email, nombre: c.nombre || '', telefono: c.telefono || '', sigue: !!c.sigue });

async function pedirCodigo(a: Record<string, any>) {
  const t = await tienda(a.tiendaId);
  const email = normEmail(a.email);
  const en = a.idioma === 'en';
  if (!emailOk(email)) fallo(en ? 'Check your email address' : 'Revisa tu correo: parece que falta algo');
  const id = idCliente(t.id, email);
  const c = await leer(id);
  if (c && c.codigoEnviado && Date.now() - c.codigoEnviado < 60e3) fallo(en ? 'Wait a minute before asking for another code' : 'Espera un minuto antes de pedir otro código');
  const codigo = String(randomInt(0, 1e6)).padStart(6, '0');
  await registrarCliente(t as any, { email });
  await ddb.send(new UpdateCommand({
    TableName: CLIENTE(), Key: { id },
    UpdateExpression: 'SET codigoHash = :h, codigoVence = :v, codigoEnviado = :ahora, intentos = :cero',
    ExpressionAttributeValues: { ':h': sha(id + '|' + codigo), ':v': Date.now() + 10 * 60e3, ':ahora': Date.now(), ':cero': 0 },
  }));
  const nombre = esc(t.nombre || t.id);
  const html = `<!doctype html><html lang="${en ? 'en' : 'es'}"><body style="margin:0;background:#f7f5f0;font-family:Arial,Helvetica,sans-serif;color:#16203a">
<div style="max-width:480px;margin:0 auto;padding:24px 16px"><div style="background:#fff;border:1px solid #e3dfd6;border-radius:14px;padding:24px">
<h1 style="margin:0 0 12px;font-size:20px">${nombre}</h1>
<p style="margin:0 0 16px;font-size:15px">${en ? 'Your code to see your orders:' : 'Tu código para ver tus pedidos:'}</p>
<p style="margin:0 0 16px;font-size:34px;font-weight:700;letter-spacing:8px">${codigo}</p>
<p style="margin:0;font-size:13px;color:#5b6275">${en ? 'It expires in 10 minutes. If you did not ask for it, ignore this email.' : 'Vence en 10 minutos. Si no lo pediste, ignora este correo.'}</p>
</div></div></body></html>`;
  const ok = await enviarCorreo({ para: email, asunto: en ? `${t.nombre || 'Store'}: your code ${codigo}` : `${t.nombre || 'Tienda'}: tu código ${codigo}`, html });
  if (!ok) fallo(en ? "We couldn't send the email. Try again in a moment." : 'No se pudo enviar el correo. Intenta de nuevo en un momento.');
  return { ok: true };
}

async function entrar(a: Record<string, any>) {
  const t = await tienda(a.tiendaId);
  const email = normEmail(a.email), en = a.idioma === 'en';
  const id = idCliente(t.id, email);
  const c = await leer(id);
  const codigo = String(a.codigo || '').replace(/\D/g, '');
  if (!c || !c.codigoHash || Date.now() > (c.codigoVence || 0)) fallo(en ? 'The code expired. Ask for a new one.' : 'El código venció. Pide uno nuevo.');
  if ((c!.intentos || 0) >= 5) fallo(en ? 'Too many tries. Ask for a new code.' : 'Muchos intentos. Pide un código nuevo.');
  if (!iguales(sha(id + '|' + codigo), String(c!.codigoHash))) {
    await ddb.send(new UpdateCommand({ TableName: CLIENTE(), Key: { id }, UpdateExpression: 'SET intentos = if_not_exists(intentos, :c) + :u', ExpressionAttributeValues: { ':c': 0, ':u': 1 } }));
    fallo(en ? 'Wrong code. Check the email and try again.' : 'El código no es correcto. Revisa el correo e intenta de nuevo.');
  }
  const secreto = randomBytes(24).toString('base64url');
  const sesiones = (Array.isArray(c!.sesiones) ? c!.sesiones : []).filter((s: any) => s && s.v > Date.now()).slice(-4);
  sesiones.push({ h: sha(secreto), v: Date.now() + 90 * DIA });
  await ddb.send(new UpdateCommand({
    TableName: CLIENTE(), Key: { id },
    UpdateExpression: 'SET sesiones = :s, verificado = :t, ultimaVez = :a REMOVE codigoHash, codigoVence, intentos',
    ExpressionAttributeValues: { ':s': sesiones, ':t': true, ':a': new Date().toISOString() },
  }));
  return { token: Buffer.from(email).toString('base64url') + '.' + secreto, perfil: perfil({ ...c, email }) };
}

/** Valida la sesión y devuelve el cliente. */
async function sesion(tiendaId: string, token: unknown) {
  const [e, secreto] = String(token || '').split('.');
  const email = normEmail(Buffer.from(e || '', 'base64url').toString());
  const c = emailOk(email) && secreto ? await leer(idCliente(tiendaId, email)) : undefined;
  const h = sha(String(secreto || ''));
  if (!c || !(c.sesiones || []).some((s: any) => s && s.v > Date.now() && iguales(String(s.h), h))) fallo('SESION');
  return c!;
}

async function misPedidos(a: Record<string, any>) {
  const t = await tienda(a.tiendaId);
  const c = await sesion(t.id, a.token);
  const pedidos: Record<string, any>[] = [];
  let ExclusiveStartKey: Record<string, any> | undefined;
  do {
    const r = await ddb.send(new QueryCommand({
      TableName: PEDIDO(), IndexName: 'pedidosByTienda', KeyConditionExpression: 'tiendaId = :t',
      FilterExpression: 'email = :e', ExpressionAttributeValues: { ':t': t.id, ':e': c.email },
      ExclusiveStartKey,
    }));
    pedidos.push(...(r.Items || []));
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey && pedidos.length < 200);
  // Los pagos con tarjeta que no se completaron no se muestran
  return {
    perfil: perfil(c),
    pedidos: pedidos.filter((p) => p.estado !== 'pendiente')
      .sort((x, y) => String(y.createdAt).localeCompare(String(x.createdAt)))
      .map((p) => ({ id: String(p.id).slice(0, 8).toUpperCase(), fecha: p.createdAt, items: p.items, total: p.total, moneda: p.moneda, metodo: p.metodo, estado: p.estado })),
  };
}

async function guardarPerfil(a: Record<string, any>) {
  const t = await tienda(a.tiendaId);
  const c = await sesion(t.id, a.token);
  const nombre = String(a.nombre ?? c.nombre ?? '').trim().slice(0, 60);
  const telefono = String(a.telefono ?? c.telefono ?? '').replace(/[^\d+ ]/g, '').trim().slice(0, 30);
  const sigue = typeof a.sigue === 'boolean' ? a.sigue : !!c.sigue;
  await ddb.send(new UpdateCommand({
    TableName: CLIENTE(), Key: { id: c.id },
    UpdateExpression: 'SET nombre = :n, telefono = :f, sigue = :s, updatedAt = :a',
    ExpressionAttributeValues: { ':n': nombre, ':f': telefono, ':s': sigue, ':a': new Date().toISOString() },
  }));
  return { perfil: perfil({ ...c, nombre, telefono, sigue }) };
}

async function salir(a: Record<string, any>) {
  const t = await tienda(a.tiendaId);
  let c; try { c = await sesion(t.id, a.token); } catch { return { ok: true }; }
  const h = sha(String(String(a.token).split('.')[1] || ''));
  await ddb.send(new UpdateCommand({ TableName: CLIENTE(), Key: { id: c.id }, UpdateExpression: 'SET sesiones = :s', ExpressionAttributeValues: { ':s': (c.sesiones || []).filter((s: any) => s.h !== h) } }));
  return { ok: true };
}

export const handler = async (event: Evento) => {
  const a = event.arguments || {};
  const accion = a.accion;
  let res: unknown;
  switch (accion) {
    case 'pedirCodigo': res = await pedirCodigo(a); break;
    case 'entrar': res = await entrar(a); break;
    case 'misPedidos': res = await misPedidos(a); break;
    case 'guardarPerfil': res = await guardarPerfil(a); break;
    case 'salir': res = await salir(a); break;
    default: fallo('Operación desconocida');
  }
  return JSON.stringify(res);
};
