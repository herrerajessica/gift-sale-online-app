import { defineFunction } from '@aws-amplify/backend';

export const clasificar = defineFunction({
  name: 'clasificar',
  entry: './handler.ts',
  timeoutSeconds: 90,
  memoryMB: 512,
  environment: {
    // Claude Haiku 5.5 en Bedrock, perfil de inferencia entre regiones de EE. UU.
    MODEL_ID: 'us.anthropic.claude-haiku-5-5',
  },
});
