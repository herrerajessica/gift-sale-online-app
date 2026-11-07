import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import type { Schema } from '../../data/resource';

const s3 = new S3Client({});
const bedrock = new BedrockRuntimeClient({});

export const CATEGORIAS = [
  'Ropa', 'Zapatos', 'Carteras y bolsos', 'Accesorios', 'Relojes y joyería',
  'Perfumes y belleza', 'Electrónica', 'Hogar', 'Juguetes', 'Otros',
];
export const PUBLICOS = ['Mujer', 'Hombre', 'Niños', 'Unisex'];
const MAX_FOTOS = 8;

type Resultado = { i: number; categoria?: string; publico?: string; nombre?: string };

async function leerFoto(path: string): Promise<string> {
  if (!path.startsWith('productos/')) throw new Error('Ruta no permitida');
  const obj = await s3.send(new GetObjectCommand({ Bucket: process.env.BUCKET_NAME, Key: path }));
  const bytes = await obj.Body!.transformToByteArray();
  return Buffer.from(bytes).toString('base64');
}

function prompt(n: number): string {
  return `Eres el asistente de una tienda en Perú que revende productos traídos de Estados Unidos. Te paso ${n} foto(s) de producto, en orden, numeradas desde 0.
Para cada foto responde un objeto con:
- "i": el número de la foto
- "categoria": exactamente una de: ${CATEGORIAS.join(', ')}
- "publico": exactamente uno de: ${PUBLICOS.join(', ')} (usa Unisex si no se distingue)
- "nombre": nombre corto de venta en español, de 2 a 6 palabras, que describa tipo, estilo y color (ej. "Jean wide leg con cordón", "Zapatillas running negras"). Incluye la marca solo si su logo o diseño es claramente visible.
Responde solo con un arreglo JSON, por ejemplo: [{"i":0,"categoria":"Ropa","publico":"Mujer","nombre":"Jean wide leg con cordón"}]`;
}

function limpiar(arr: unknown, n: number): Resultado[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((r): r is Resultado => !!r && typeof r === 'object' && Number.isInteger(Number((r as Resultado).i)))
    .map((r) => ({
      i: Number(r.i),
      categoria: CATEGORIAS.includes(String(r.categoria)) ? String(r.categoria) : undefined,
      publico: PUBLICOS.includes(String(r.publico)) ? String(r.publico) : undefined,
      nombre: typeof r.nombre === 'string' && r.nombre.trim() ? r.nombre.trim().slice(0, 80) : undefined,
    }))
    .filter((r) => r.i >= 0 && r.i < n);
}

export const handler: Schema['clasificarFotos']['functionHandler'] = async (event) => {
  const paths = (event.arguments.paths ?? []).filter((p): p is string => !!p).slice(0, MAX_FOTOS);
  if (!paths.length) return JSON.stringify([]);

  const imagenes = await Promise.all(paths.map(leerFoto));
  const content = [
    ...imagenes.map((data) => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } })),
    { type: 'text', text: prompt(paths.length) },
  ];

  const res = await bedrock.send(new InvokeModelCommand({
    modelId: process.env.MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 1024,
      messages: [{ role: 'user', content }],
    }),
  }));

  const out = JSON.parse(new TextDecoder().decode(res.body));
  const texto: string = (out.content ?? []).map((c: { text?: string }) => c.text ?? '').join('');
  const inicio = texto.indexOf('['), fin = texto.lastIndexOf(']');
  let parsed: unknown = [];
  try { parsed = JSON.parse(texto.slice(inicio, fin + 1)); } catch { parsed = []; }
  return JSON.stringify(limpiar(parsed, paths.length));
};
