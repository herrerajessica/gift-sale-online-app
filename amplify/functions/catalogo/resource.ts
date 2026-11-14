import { defineFunction } from '@aws-amplify/backend';

export const catalogo = defineFunction({
  name: 'catalogo',
  entry: './handler.ts',
  timeoutSeconds: 15,
  memoryMB: 256,
});
