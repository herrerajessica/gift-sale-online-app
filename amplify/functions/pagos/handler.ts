import Stripe from 'stripe';
import { randomUUID } from 'node:crypto';
import { BatchGetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { PLANES, esPlan, paisDe } from '../shared/planes';
import { ddb, PRODUCTO, PEDIDO, leerTienda, actualizarTienda, subDe, origenSeguro } from '../shared/tablas';
import { avisarPedido } from '../shared/correo';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

type Identidad = { sub?: string; groups?: string[] | null } | null | undefined;
type Evento = { fieldName: string; arguments: Record<string, any>; identity?: Identidad };

const fallo = (mensaje: string) => { throw new Error(mensaje); };

/** La tienda debe existir y pertenecer a quien llama (o ser SUPERADMIN). */
async function miTienda(id: string, ident: Identidad) {
  const t = await leerTienda(String(id || ''));
  if (!t) fallo('La tienda no existe');
  const esSuper = !!ident && Array.isArray(ident.groups) && ident.groups.includes('SUPERADMIN');
  if (!esSuper && (!ident?.sub || subDe(t!.owner) !== ident.sub)) fallo('No autorizado');
  return t!;
}

// ---------- Planes de la vendedora (suscripción mensual) ----------
async function pagarPlan(a: Record<string, any>, ident: Identidad) {
  const t = await miTienda(a.tiendaId, ident);
  const origen = origenSeguro(a.origen);
  if (!esPlan(a.plan) || a.plan === 'free') fallo('Plan no válido');
  const plan = PLANES[a.plan as keyof typeof PLANES];

  let customer = t.stripeCustomerId as string | undefined;
  if (!customer) {
    const c = await stripe.customers.create({ email: t.email || undefined, name: t.nombre, metadata: { tiendaId: t.id } });
    customer = c.id;
    await actualizarTienda(t.id, { stripeCustomerId: customer });
  }

  const s = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer,
    line_items: [{
      quantity: 1,
      // Tiendas de EE. UU. pagan el plan en dólares; las de Perú, en soles.
      price_data: paisDe(t) === 'US'
        ? { currency: 'usd', unit_amount: Math.round(plan.precioUsd * 100), recurring: { interval: 'month' }, product_data: { name: `Showroomcito · ${plan.nombre} plan` } }
        : { currency: process.env.MONEDA_PLANES || 'pen', unit_amount: Math.round(plan.precio * 100), recurring: { interval: 'month' }, product_data: { name: `Showroomcito · Plan ${plan.nombre}` } },
    }],
    metadata: { tipo: 'plan', tiendaId: t.id, plan: a.plan },
    subscription_data: { metadata: { tipo: 'plan', tiendaId: t.id, plan: a.plan } },
    success_url: `${origen}/?plan=ok`,
    cancel_url: `${origen}/?plan=cancelado`,
  });
  return { url: s.url };
}

/** Volver al plan Free: la suscripción se cancela al terminar el mes ya pagado. */
async function cancelarPlan(a: Record<string, any>, ident: Identidad) {
  const t = await miTienda(a.tiendaId, ident);
  if (!t.stripeSubscriptionId) return { ok: true };
  const sub = await stripe.subscriptions.update(t.stripeSubscriptionId, { cancel_at_period_end: true });
  await actualizarTienda(t.id, { planCancelado: true });
  return { ok: true, hasta: sub.cancel_at ? sub.cancel_at * 1000 : null };
}

// ---------- Cobros de la vendedora (Stripe Connect Express) ----------
async function conectarCobros(a: Record<string, any>, ident: Identidad) {
  const t = await miTienda(a.tiendaId, ident);
  const origen = origenSeguro(a.origen);
  let cuenta = t.stripeAccountId as string | undefined;
  if (!cuenta) {
    const acc = await stripe.accounts.create({
      type: 'express',
      country: process.env.CONNECT_COUNTRY || 'US',
      email: t.email || undefined,
      business_profile: { name: t.nombre },
      capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
      metadata: { tiendaId: t.id },
    });
    cuenta = acc.id;
    await actualizarTienda(t.id, { stripeAccountId: cuenta, cobrosActivos: false });
  }
  const link = await stripe.accountLinks.create({
    account: cuenta,
    type: 'account_onboarding',
    refresh_url: `${origen}/?cobros=reintentar`,
    return_url: `${origen}/?cobros=ok`,
  });
  return { url: link.url };
}

/** Al volver de Stripe, consulta si la cuenta ya puede cobrar. */
async function estadoCobros(a: Record<string, any>, ident: Identidad) {
  const t = await miTienda(a.tiendaId, ident);
  if (!t.stripeAccountId) return { cobrosActivos: false };
  const acc = await stripe.accounts.retrieve(t.stripeAccountId);
  const activos = !!acc.charges_enabled;
  if (activos !== !!t.cobrosActivos) await actualizarTienda(t.id, { cobrosActivos: activos });
  return { cobrosActivos: activos };
}

// ---------- Pedidos del cliente ----------
type Linea = { id: string; nombre: string; q: number; precioUsd: number; monto: number };

/** Valida el pedido y calcula los montos con los precios de la base de datos. */
/** descuento: % por pagar con Yape o efectivo (0 para tarjeta). */
async function armarPedido(t: Record<string, any>, itemsJson: unknown, soloSoles: boolean, descuento = 0) {

  let pedidos: { id: string; q: number }[] = [];
  try { pedidos = JSON.parse(String(itemsJson || '[]')); } catch { fallo('Pedido no válido'); }
  pedidos = pedidos
    .map((x) => ({ id: String(x.id), q: Math.min(99, Math.max(1, Math.floor(Number(x.q) || 1))) }))
    .filter((x, i, arr) => x.id && arr.findIndex((y) => y.id === x.id) === i)
    .slice(0, 50);
  if (!pedidos.length) fallo('El pedido está vacío');

  // Los precios se leen de la base de datos, nunca del navegador.
  const r = await ddb.send(new BatchGetCommand({ RequestItems: { [PRODUCTO()]: { Keys: pedidos.map((p) => ({ id: p.id })) } } }));
  const productos = new Map((r.Responses?.[PRODUCTO()] || []).map((p) => [p.id, p]));

  // Tiendas de EE. UU.: todo en dólares. Tiendas de Perú: en soles (precios ya en soles, o en dólares × tipo de cambio).
  const enSoles = paisDe(t) !== 'US' && t.moneda === 'PEN';
  const rate = enSoles ? 1 : (paisDe(t) !== 'US' && typeof t.tipoCambio === 'number' && t.tipoCambio > 0 ? t.tipoCambio : null);
  if (soloSoles && !rate) fallo('La tienda no tiene tipo de cambio configurado para cobrar en soles');
  const moneda = rate ? 'pen' : 'usd';
  const lineas: Linea[] = [];
  for (const p of pedidos) {
    const prod = productos.get(p.id);
    if (!prod || prod.tiendaId !== t.id) fallo('Un producto del pedido ya no existe');
    if (prod!.estado === 'vendido' || prod!.estado === 'oculto') fallo(`"${prod!.nombre}" ya no está disponible`);
    if (typeof prod!.precio !== 'number') fallo(`"${prod!.nombre}" no tiene precio; consúltalo por WhatsApp`);
    if (typeof prod!.stock === 'number' && p.q > prod!.stock) {
      fallo(prod!.stock > 0 ? `Solo quedan ${prod!.stock} de "${prod!.nombre}"` : `"${prod!.nombre}" está agotado`);
    }
    // Monto en la unidad mínima: soles redondeados como en la tienda, o centavos de dólar.
    const factor = 1 - Math.min(30, Math.max(0, descuento)) / 100;
    // Precios en soles: con tarjeta se cobra exacto (céntimos); con Yape se redondea al sol, igual que en la tienda.
    const monto = enSoles && !soloSoles ? Math.round(prod!.precio * p.q * factor * 100)
      : rate ? Math.round(prod!.precio * p.q * rate * factor) * 100
      : Math.round(prod!.precio * p.q * factor * 100);
    lineas.push({ id: p.id, nombre: prod!.nombre, q: p.q, precioUsd: prod!.precio, monto });
  }
  const total = lineas.reduce((s, l) => s + l.monto, 0);
  return { lineas, total, moneda };
}

async function tiendaAbierta(id: unknown) {
  const t = await leerTienda(String(id || '').toLowerCase());
  if (!t || t.estado !== 'aprobada') fallo('Esta tienda no está disponible');
  return t!;
}

const texto = (v: unknown, max: number) => String(v || '').trim().slice(0, max);

/** Pago con tarjeta: crea la sesión de Stripe y el pedido pendiente. */
async function pagarPedido(a: Record<string, any>) {
  const origen = origenSeguro(a.origen);
  const t = await tiendaAbierta(a.tiendaId);
  if (!t.cobrosActivos || !t.stripeAccountId) fallo('Esta tienda todavía no acepta pagos con tarjeta');
  const { lineas, total, moneda } = await armarPedido(t, a.items, false);
  const comision = Math.round(total * Number(process.env.COMISION_PORCENTAJE || 0) / 100);

  const pedidoId = randomUUID();
  const ahora = new Date().toISOString();
  const nombre = texto(a.nombre, 60);
  const nota = texto(a.nota, 300);

  const s = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: lineas.map((l) => ({
      quantity: 1,
      price_data: { currency: moneda, unit_amount: l.monto, product_data: { name: l.q > 1 ? `${l.nombre} × ${l.q}` : l.nombre } },
    })),
    payment_intent_data: {
      application_fee_amount: comision || undefined,
      transfer_data: { destination: t!.stripeAccountId },
      metadata: { tipo: 'pedido', pedidoId, tiendaId: t!.id },
    },
    metadata: { tipo: 'pedido', pedidoId, tiendaId: t!.id },
    success_url: `${origen}/?tienda=${encodeURIComponent(t!.id)}&pago=ok&pedido=${pedidoId}`,
    cancel_url: `${origen}/?tienda=${encodeURIComponent(t!.id)}&pago=cancelado`,
  });

  await ddb.send(new PutCommand({
    TableName: PEDIDO(),
    Item: {
      id: pedidoId, __typename: 'Pedido', tiendaId: t!.id, owner: t!.owner,
      items: JSON.stringify(lineas), total, moneda, comision,
      cliente: nombre, nota, metodo: 'tarjeta', estado: 'pendiente', stripeSessionId: s.id,
      createdAt: ahora, updatedAt: ahora,
    },
  }));
  return { url: s.url, pedidoId };
}

/** Pago con Yape: el cliente ya pagó con el QR; la vendedora confirma el pago. */
async function pedidoYape(a: Record<string, any>) {
  const t = await tiendaAbierta(a.tiendaId);
  if (paisDe(t) === 'US') fallo('Yape solo está disponible en tiendas de Perú');
  if (!t.yapeNumero && !t.yapeQr) fallo('Esta tienda no acepta pagos con Yape');
  const nombre = texto(a.nombre, 60);
  if (!nombre) fallo('Escribe tu nombre para que la tienda identifique tu pago');
  const descuento = typeof t.descuentoContado === 'number' ? t.descuentoContado : 0;
  const { lineas, total, moneda } = await armarPedido(t, a.items, true, descuento);
  const pedidoId = randomUUID();
  const ahora = new Date().toISOString();
  const email = texto(a.email, 254) || undefined;
  const pedido = {
    id: pedidoId, __typename: 'Pedido', tiendaId: t.id, owner: t.owner,
    items: JSON.stringify(lineas), total, moneda, comision: 0,
    cliente: nombre, email, nota: texto(a.nota, 300), operacion: texto(a.operacion, 40),
    metodo: 'yape', estado: 'por_confirmar', createdAt: ahora, updatedAt: ahora,
  };
  await ddb.send(new PutCommand({ TableName: PEDIDO(), Item: pedido }));
  // Correo al cliente ("recibimos tu pedido") y a la vendedora ("confirma el pago"). Nunca rompe el pedido.
  await avisarPedido(t as any, pedido, email);
  return { pedidoId, total, moneda };
}

export const handler = async (event: Evento) => {
  const a = event.arguments || {};
  const ident = event.identity;
  let res: unknown;
  switch (event.fieldName) {
    case 'pagarPlan': res = await pagarPlan(a, ident); break;
    case 'cancelarPlan': res = await cancelarPlan(a, ident); break;
    case 'conectarCobros': res = await conectarCobros(a, ident); break;
    case 'estadoCobros': res = await estadoCobros(a, ident); break;
    case 'pagarPedido': res = await pagarPedido(a); break;
    case 'pedidoYape': res = await pedidoYape(a); break;
    default: fallo('Operación desconocida');
  }
  return JSON.stringify(res);
};
