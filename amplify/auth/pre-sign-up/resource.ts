import { defineFunction } from '@aws-amplify/backend';

// Antes de crear una cuenta nueva con Google: si ya existe una cuenta con ese correo
// (creada con correo y contraseña), se enlaza a ella en vez de crear otra.
export const preSignUp = defineFunction({
  name: 'pre-sign-up',
  resourceGroupName: 'auth',
  entry: './handler.ts',
  timeoutSeconds: 10,
});
