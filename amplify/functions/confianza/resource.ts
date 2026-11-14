import { defineFunction, secret } from '@aws-amplify/backend';

export const confianza = defineFunction({
  name: 'confianza',
  // En el stack de datos: lee las tablas y responde consultas de AppSync (evita dependencias circulares).
  resourceGroupName: 'data',
  entry: './handler.ts',
  timeoutSeconds: 30,
  memoryMB: 256,
  environment: {
    // Aviso por correo a la dueña cuando una revendedora vende su producto.
    RESEND_API_KEY: secret('RESEND_API_KEY'),
    CORREO_REMITENTE: 'Showroomcito <onboarding@resend.dev>',
  },
});
