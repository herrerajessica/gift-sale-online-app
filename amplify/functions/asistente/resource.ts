import { defineFunction } from '@aws-amplify/backend';

export const asistente = defineFunction({
  name: 'asistente',
  entry: './handler.ts',
  timeoutSeconds: 90,
  memoryMB: 512,
  environment: {
    // Claude en Bedrock con herramientas (Converse API). Haiku es rápido y barato.
    MODEL_ID: 'us.anthropic.claude-haiku-5-5',
  },
});
