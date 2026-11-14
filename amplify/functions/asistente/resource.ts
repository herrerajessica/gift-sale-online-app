import { defineFunction } from '@aws-amplify/backend';

export const asistente = defineFunction({
  name: 'asistente',
  // En el stack de datos: lee las tablas y responde consultas de AppSync (evita dependencias circulares).
  resourceGroupName: 'data',
  entry: './handler.ts',
  timeoutSeconds: 90,
  memoryMB: 512,
  environment: {
    // Claude en Bedrock con herramientas (Converse API). Haiku es rápido y barato.
    // Perfil de inferencia de Bedrock (el ID exacto aparece en Bedrock › Perfiles de inferencia).
    // Versión de prueba: Amazon Nova 2 Lite (funciona en el plan gratuito de AWS).
    // Producción con Claude: cambiar a 'global.anthropic.claude-haiku-5-5' (requiere el plan de pago de AWS).
    MODEL_ID: 'global.amazon.nova-2-lite-v1:0',
  },
});
