import { defineFunction, secret } from '@aws-amplify/backend';

export const stripeWebhook = defineFunction({
  name: 'stripe-webhook',
  // En el stack de datos: lee las tablas y responde consultas de AppSync (evita dependencias circulares).
  resourceGroupName: 'data',
  entry: './handler.ts',
  timeoutSeconds: 30,
  memoryMB: 256,
  environment: {
    STRIPE_SECRET_KEY: secret('STRIPE_SECRET_KEY'),
    // Correos de pedidos con Resend. Para no enviar correos, guarda el secreto con el valor "no".
    RESEND_API_KEY: secret('RESEND_API_KEY'),
    // Remitente: dominio showroomcito.com verificado en Resend (registros en send. y resend._domainkey).
    CORREO_REMITENTE: 'Showroomcito <pedidos@showroomcito.com>',
    // Firma del webhook: confirma que el aviso viene de Stripe y no de un tercero.
    STRIPE_WEBHOOK_SECRET: secret('STRIPE_WEBHOOK_SECRET'),
  },
});
