import { defineFunction, secret } from '@aws-amplify/backend';

export const pagos = defineFunction({
  name: 'pagos',
  entry: './handler.ts',
  timeoutSeconds: 30,
  memoryMB: 256,
  environment: {
    // Las claves NO están en el código: se guardan como secretos en la consola de Amplify.
    STRIPE_SECRET_KEY: secret('STRIPE_SECRET_KEY'),
    // Moneda de los planes (los precios de PLANES están en soles).
    MONEDA_PLANES: 'pen',
    // País de las cuentas Stripe de las vendedoras (Stripe Connect Express).
    CONNECT_COUNTRY: 'US',
    // Comisión de la plataforma sobre cada pedido pagado con tarjeta.
    COMISION_PORCENTAJE: '5',
  },
});
