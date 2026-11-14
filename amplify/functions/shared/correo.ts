// Correos automáticos con Resend (https://resend.com), usando su API HTTP: no hace falta instalar nada.
// La clave RESEND_API_KEY es un secreto de Amplify: nunca va en el código.
// Si falta la clave, no se envía nada y el pedido sigue igual (el correo es un extra, no debe romper una venta).

type Linea = { nombre?: string; q?: number; monto?: number };
type Pedido = { id: string; cliente?: string; items?: string; total?: number; moneda?: string; metodo?: string; operacion?: string; nota?: string };
type Tienda = { id: string; nombre?: string; email?: string; whatsapp?: string };

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const emailValido = (s: unknown) => typeof s === 'string' && s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const plata = (centavos: number, moneda?: string) => (moneda === 'pen' ? 'S/ ' : '$') + (centavos / 100).toLocaleString('es-PE', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
export const numeroPedido = (id: string) => String(id || '').slice(0, 8).toUpperCase();

export async function enviarCorreo(c: { para: string; asunto: string; html: string; responderA?: string }) {
  const clave = process.env.RESEND_API_KEY;
  if (!clave || !clave.startsWith('re_') || !emailValido(c.para)) return false;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${clave}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.CORREO_REMITENTE || 'Vitrina AI <onboarding@resend.dev>',
        to: [c.para], subject: c.asunto, html: c.html,
        ...(emailValido(c.responderA) ? { reply_to: c.responderA } : {}),
      }),
    });
    if (!r.ok) console.error('Resend respondió', r.status, await r.text());
    return r.ok;
  } catch (e) {
    console.error('No se pudo enviar el correo', e);
    return false;
  }
}

function lineasHtml(p: Pedido) {
  let lineas: Linea[] = [];
  try { lineas = JSON.parse(p.items || '[]'); } catch { /* sin detalle */ }
  const filas = lineas.map((l) => `<tr><td style="padding:8px 0;border-bottom:1px solid #eee">${esc(l.nombre)}${(l.q || 1) > 1 ? ` × ${l.q}` : ''}</td><td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;white-space:nowrap">${plata(l.monto || 0, p.moneda)}</td></tr>`).join('');
  return `<table role="presentation" style="width:100%;border-collapse:collapse;font-size:15px">${filas}<tr><td style="padding:12px 0 0;font-weight:700">Total</td><td style="padding:12px 0 0;font-weight:700;text-align:right">${plata(p.total || 0, p.moneda)}</td></tr></table>`;
}

function marco(titulo: string, cuerpo: string, pie: string) {
  return `<!doctype html><html lang="es"><body style="margin:0;background:#f7f5f0;font-family:Arial,Helvetica,sans-serif;color:#16203a">
<div style="max-width:520px;margin:0 auto;padding:24px 16px">
<div style="background:#fff;border:1px solid #e3dfd6;border-radius:14px;padding:24px">
<h1 style="margin:0 0 12px;font-size:22px">${titulo}</h1>${cuerpo}</div>
<p style="font-size:12px;color:#5b6275;text-align:center;margin:16px 0 0">${pie}</p></div></body></html>`;
}

const waLink = (t: Tienda, texto: string) => {
  const d = String(t.whatsapp || '').replace(/\D/g, '');
  return d ? `https://wa.me/${d}?text=${encodeURIComponent(texto)}` : '';
};
const boton = (href: string, texto: string) => href ? `<p style="margin:20px 0 0"><a href="${esc(href)}" style="display:inline-block;background:#157347;color:#fff;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:10px">${esc(texto)}</a></p>` : '';

/** Al cliente: confirmación de su pedido (tarjeta pagada o Yape por confirmar). */
export function correoCliente(t: Tienda, p: Pedido) {
  const num = numeroPedido(p.id);
  const yape = p.metodo === 'yape';
  const titulo = yape ? 'Recibimos tu pedido' : '¡Tu pago fue aprobado!';
  const estado = yape
    ? `<p style="margin:0 0 16px;font-size:15px">La tienda <b>${esc(t.nombre)}</b> revisará tu Yape${p.operacion ? ` (operación ${esc(p.operacion)})` : ''} y te confirmará.</p>`
    : `<p style="margin:0 0 16px;font-size:15px">Pagaste con tarjeta en <b>${esc(t.nombre)}</b>. La tienda ya tiene tu pedido.</p>`;
  const cuerpo = `<p style="margin:0 0 4px;font-size:15px">Hola${p.cliente ? ' ' + esc(p.cliente) : ''},</p>${estado}
<p style="margin:0 0 8px;font-size:13px;color:#5b6275">Pedido N.° ${num}</p>${lineasHtml(p)}
${boton(waLink(t, `Hola, escribo por mi pedido N.° ${num}.`), 'Escribir a la tienda por WhatsApp')}`;
  return { asunto: `${yape ? 'Pedido recibido' : 'Pago aprobado'} · ${t.nombre || 'Tu tienda'} · N.° ${num}`, html: marco(titulo, cuerpo, 'Este correo confirma tu pedido; no es un comprobante de pago para SUNAT.') };
}

/** A la vendedora: aviso de pedido nuevo. */
export function correoVendedora(t: Tienda, p: Pedido) {
  const num = numeroPedido(p.id);
  const yape = p.metodo === 'yape';
  const cuerpo = `<p style="margin:0 0 16px;font-size:15px">${yape
    ? `<b>${esc(p.cliente || 'Un cliente')}</b> dice que yapeó${p.operacion ? ` (operación ${esc(p.operacion)})` : ''}. Revisa tu Yape y confirma el pago en tu panel.`
    : `<b>${esc(p.cliente || 'Un cliente')}</b> pagó con tarjeta. El dinero llega a tu cuenta de Stripe.`}</p>
<p style="margin:0 0 8px;font-size:13px;color:#5b6275">Pedido N.° ${num}</p>${lineasHtml(p)}
${p.nota ? `<p style="margin:16px 0 0;font-size:14px"><b>Nota del cliente:</b> ${esc(p.nota)}</p>` : ''}`;
  return { asunto: `${yape ? 'Nuevo pedido por Yape: confirma el pago' : 'Nuevo pedido pagado'} · N.° ${num}`, html: marco(yape ? 'Nuevo pedido por Yape' : 'Nuevo pedido pagado', cuerpo, 'Aviso automático de tu tienda en Vitrina AI.') };
}

/** Envía los dos correos de un pedido nuevo. Nunca lanza error. */
export async function avisarPedido(t: Tienda, p: Pedido, emailCliente?: string) {
  const envios: Promise<boolean>[] = [];
  if (emailValido(emailCliente)) { const c = correoCliente(t, p); envios.push(enviarCorreo({ para: emailCliente!, asunto: c.asunto, html: c.html, responderA: t.email })); }
  if (emailValido(t.email)) { const c = correoVendedora(t, p); envios.push(enviarCorreo({ para: t.email!, asunto: c.asunto, html: c.html, responderA: emailValido(emailCliente) ? emailCliente : undefined })); }
  await Promise.all(envios);
}
