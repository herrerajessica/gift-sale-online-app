import { defineFunction } from '@aws-amplify/backend';

export const catalogo = defineFunction({
  name: 'catalogo',
  // En el stack de datos: lee las tablas y responde consultas de AppSync (evita dependencias circulares).
  resourceGroupName: 'data',
  entry: './handler.ts',
  timeoutSeconds: 45,
  memoryMB: 512,
  environment: {
    // Asistente de compras de los clientes (consulta "preguntarTienda"). Mismo modelo que el asistente de la vendedora.
    MODEL_ID: 'global.amazon.nova-2-lite-v1:0',
  },
});
