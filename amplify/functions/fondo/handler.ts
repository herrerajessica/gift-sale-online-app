import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { leerTienda, subDe } from '../shared/tablas';
import { planVigente } from '../shared/planes';

const s3 = new S3Client({});
const bedrock = new BedrockRuntimeClient({ region: process.env.BEDROCK_REGION || 'us-east-1' });

type Evento = { arguments: { tiendaId?: string; path?: string }; identity?: { sub?: string } | null };

/**
 * Quita el fondo de una foto ya subida y devuelve un PNG transparente (base64).
 * El navegador lo pone sobre fondo blanco y genera la foto final y la miniatura.
 */
export const handler = async (event: Evento) => {
  const { tiendaId, path } = event.arguments || {};
  const sub = event.identity?.sub;

  // Solo la dueña de una tienda puede usarlo (tiene costo por foto).
  const t = await leerTienda(String(tiendaId || ''));
  if (!t || !sub || subDe(t.owner) !== sub) throw new Error('No autorizado');
  // Tiene costo por foto en Bedrock: solo para el plan Plus.
  if (planVigente(t) !== 'plus') throw new Error('El fondo blanco con IA está disponible en el plan Plus');
  if (!path || !/^productos\/[^/]+\/[\w-]+\.jpg$/.test(path)) throw new Error('Ruta no permitida');

  const obj = await s3.send(new GetObjectCommand({ Bucket: process.env.BUCKET_NAME, Key: path }));
  const bytes = await obj.Body!.transformToByteArray();

  const res = await bedrock.send(new InvokeModelCommand({
    modelId: process.env.MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      taskType: 'BACKGROUND_REMOVAL',
      backgroundRemovalParams: { image: Buffer.from(bytes).toString('base64') },
    }),
  }));
  const out = JSON.parse(new TextDecoder().decode(res.body));
  if (out.error || !out.images?.[0]) throw new Error(out.error || 'No se pudo quitar el fondo');
  return JSON.stringify({ png: out.images[0] });
};
