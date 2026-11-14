import { defineFunction, secret } from '@aws-amplify/backend';

export const stripeWebhook = defineFunction({
  name: 'stripe-webhook',
  entry: './handler.ts',
  timeoutSeconds: 30,
  memoryMB: 256,
  environment: {
    STRIPE_SECRET_KEY: secret('STRIPE_SECRET_KEY'),
    // Correos de pedidos con Resend. Para no enviar correos, guarda el secreto con el valor "no".
    RESEND_API_KEY: secret('RESEND_API_KEY'),
    // Remitente: con onboarding@resend.dev Resend solo entrega a tu propio correo (ideal para la demo).
    // Con un dominio verificado en Resend, cámbialo, p. ej. 'Vitrina AI <pedidos@tudominio.com>'.
    CORREO_REMITENTE: 'Vitrina AI <onboarding@resend.dev>',
    // Firma del webhook: confirma que el aviso viene de Stripe y no de un tercero.
    STRIPE_WEBHOOK_SECRET: secret('STRIPE_WEBHOOK_SECRET'),
  },
});
