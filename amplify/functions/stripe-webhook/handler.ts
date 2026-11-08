import Stripe from 'stripe';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { esPlan } from '../shared/planes';
import { ddb, PEDIDO, leerTienda, actualizarTienda } from '../shared/tablas';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

type UrlEvent = { body?: string; isBase64Encoded?: boolean; headers?: Record<string, string> };
const resp = (statusCode: number, body: string) => ({ statusCode, body });

/** Fin del periodo pagado (en versiones nuevas de la API está en el ítem). */
function finPeriodo(sub: Stripe.Subscription): number | null {
  const item = sub.items?.data?.[0] as (Stripe.SubscriptionItem & { current_period_end?: number }) | undefined;
  const fin = item?.current_period_end ?? (sub as unknown as { current_period_end?: number }).current_period_end;
  return fin ? fin * 1000 : null;
}

async function marcarPedido(pedidoId: string, estado: 'pagado' | 'cancelado', extra: Record<string, unknown> = {}) {
  const campos = { estado, updatedAt: new Date().toISOString(), ...extra };
  const k = Object.keys(campos);
  await ddb.send(new UpdateCommand({
    TableName: PEDIDO(),
    Key: { id: pedidoId },
    UpdateExpression: 'SET ' + k.map((_, i) => `#k${i} = :v${i}`).join(', '),
    ExpressionAttributeNames: Object.fromEntries(k.map((x, i) => [`#k${i}`, x])),
    ExpressionAttributeValues: Object.fromEntries(k.map((x, i) => [`:v${i}`, (campos as Record<string, unknown>)[x]])),
    ConditionExpression: 'attribute_exists(id)',
  }));
}

async function aplicarSuscripcion(sub: Stripe.Subscription) {
  const tiendaId = sub.metadata?.tiendaId;
  const plan = sub.metadata?.plan;
  if (!tiendaId || !esPlan(plan)) return;
  const t = await leerTienda(tiendaId);
  if (!t) return;

  const activa = sub.status === 'active' || sub.status === 'trialing' || sub.status === 'past_due';
  if (activa) {
    // Si tenía otra suscripción (cambió de plan), se cancela la anterior.
    if (t.stripeSubscriptionId && t.stripeSubscriptionId !== sub.id) {
      try { await stripe.subscriptions.cancel(t.stripeSubscriptionId); } catch { /* ya cancelada */ }
    }
    await actualizarTienda(tiendaId, {
      plan, planVence: finPeriodo(sub), stripeSubscriptionId: sub.id, planCancelado: !!sub.cancel_at_period_end,
    });
  } else if (t.stripeSubscriptionId === sub.id) {
    // Terminó la suscripción vigente: vuelve a Free.
    await actualizarTienda(tiendaId, { plan: 'free', planVence: null, stripeSubscriptionId: null, planCancelado: null });
  }
}

export const handler = async (event: UrlEvent) => {
  const firma = event.headers?.['stripe-signature'] || event.headers?.['Stripe-Signature'];
  if (!firma || !event.body) return resp(400, 'Falta la firma');
  const cuerpo = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;

  let ev: Stripe.Event;
  try {
    ev = stripe.webhooks.constructEvent(cuerpo, firma, process.env.STRIPE_WEBHOOK_SECRET as string);
  } catch {
    return resp(400, 'Firma no válida');
  }

  try {
    switch (ev.type) {
      case 'checkout.session.completed': {
        const s = ev.data.object as Stripe.Checkout.Session;
        if (s.metadata?.tipo === 'pedido' && s.metadata.pedidoId && s.payment_status === 'paid') {
          await marcarPedido(s.metadata.pedidoId, 'pagado', { email: s.customer_details?.email || undefined, telefono: s.customer_details?.phone || undefined });
        }
        if (s.metadata?.tipo === 'plan' && s.subscription) {
          const sub = await stripe.subscriptions.retrieve(String(s.subscription));
          await aplicarSuscripcion(sub);
        }
        break;
      }
      case 'checkout.session.expired': {
        const s = ev.data.object as Stripe.Checkout.Session;
        if (s.metadata?.tipo === 'pedido' && s.metadata.pedidoId) await marcarPedido(s.metadata.pedidoId, 'cancelado');
        break;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await aplicarSuscripcion(ev.data.object as Stripe.Subscription);
        break;
      case 'invoice.paid': {
        // Renovación mensual: extiende la fecha de vencimiento.
        const inv = ev.data.object as Stripe.Invoice & { subscription?: string; parent?: { subscription_details?: { subscription?: string } } };
        const subId = inv.parent?.subscription_details?.subscription || inv.subscription;
        if (subId) await aplicarSuscripcion(await stripe.subscriptions.retrieve(String(subId)));
        break;
      }
      case 'account.updated': {
        const acc = ev.data.object as Stripe.Account;
        const tiendaId = acc.metadata?.tiendaId;
        if (tiendaId) await actualizarTienda(tiendaId, { cobrosActivos: !!acc.charges_enabled });
        break;
      }
    }
  } catch (e) {
    console.error('Error procesando', ev.type, e);
    return resp(500, 'Error'); // Stripe reintenta automáticamente
  }
  return resp(200, 'ok');
};
