import { defineFunction } from '@aws-amplify/backend';

export const catalogo = defineFunction({
  name: 'catalogo',
  // En el stack de datos: lee las tablas y responde consultas de AppSync (evita dependencias circulares).
  resourceGroupName: 'data',
  entry: './handler.ts',
  timeoutSeconds: 15,
  memoryMB: 256,
});
