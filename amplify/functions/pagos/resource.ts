import { defineFunction, secret } from '@aws-amplify/backend';

export const pagos = defineFunction({
  name: 'pagos',
  entry: './handler.ts',
  timeoutSeconds: 30,
  memoryMB: 256,
  environment: {
    // Las claves NO están en el código: se guardan como secretos en la consola de Amplify.
    STRIPE_SECRET_KEY: secret('STRIPE_SECRET_KEY'),
    // Correos de pedidos con Resend. Para no enviar correos, guarda el secreto con el valor "no".
    RESEND_API_KEY: secret('RESEND_API_KEY'),
    // Remitente: con onboarding@resend.dev Resend solo entrega a tu propio correo (ideal para la demo).
    // Con un dominio verificado en Resend, cámbialo, p. ej. 'Vitrina AI <pedidos@tudominio.com>'.
    CORREO_REMITENTE: 'Vitrina AI <onboarding@resend.dev>',
    // Moneda de los planes (los precios de PLANES están en soles).
    MONEDA_PLANES: 'pen',
    // País de las cuentas Stripe de las vendedoras (Stripe Connect Express).
    CONNECT_COUNTRY: 'US',
    // Comisión de la plataforma sobre cada pedido pagado con tarjeta.
    // 8 %: cubre lo que cobra Stripe (~6.8 % con tarjetas peruanas desde una cuenta de EE. UU.).
    COMISION_PORCENTAJE: '8',
  },
});
