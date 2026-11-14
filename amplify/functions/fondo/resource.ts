import { defineFunction } from '@aws-amplify/backend';

export const fondo = defineFunction({
  name: 'fondo',
  // En el stack de datos: lee las tablas y responde consultas de AppSync (evita dependencias circulares).
  resourceGroupName: 'data',
  entry: './handler.ts',
  timeoutSeconds: 60,
  memoryMB: 512,
  environment: {
    // Amazon Nova Canvas: tarea BACKGROUND_REMOVAL (devuelve PNG con fondo transparente).
    MODEL_ID: 'amazon.nova-canvas-v1:0',
    // Nova Canvas está disponible en us-east-1.
    BEDROCK_REGION: 'us-east-1',
  },
});
