import { defineFunction, secret } from '@aws-amplify/backend';

// Cuenta del cliente en una tienda: entra con un código que le llega al correo (sin contraseña)
// y ve sus pedidos. No usa Cognito: las cuentas de Cognito son solo de las vendedoras.
export const clientes = defineFunction({
  name: 'clientes',
  resourceGroupName: 'data',
  entry: './handler.ts',
  timeoutSeconds: 20,
  memoryMB: 256,
  environment: {
    RESEND_API_KEY: secret('RESEND_API_KEY'),
    CORREO_REMITENTE: 'Showroomcito <pedidos@showroomcito.com>',
  },
});
