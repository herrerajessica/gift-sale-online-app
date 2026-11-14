import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
// Converse API: el mismo código sirve para Amazon Nova y para Claude; solo cambia MODEL_ID.
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import type { Schema } from '../../data/resource';

const s3 = new S3Client({});
const bedrock = new BedrockRuntimeClient({});

export const CATEGORIAS = [
  'Ropa', 'Zapatos', 'Carteras y bolsos', 'Accesorios', 'Relojes y joyería',
  'Perfumes y belleza', 'Electrónica', 'Hogar', 'Juguetes', 'Otros',
];
export const PUBLICOS = ['Mujer', 'Hombre', 'Niños', 'Unisex'];
const MAX_FOTOS = 8;

type Resultado = { i: number; categoria?: string; publico?: string; nombre?: string; marca?: string; costo?: number; talla?: string };

async function leerFoto(path: string): Promise<Uint8Array> {
  if (!path.startsWith('productos/')) throw new Error('Ruta no permitida');
  const obj = await s3.send(new GetObjectCommand({ Bucket: process.env.BUCKET_NAME, Key: path }));
  return obj.Body!.transformToByteArray();
}

function prompt(n: number, ingles: boolean): string {
  const nombre = ingles
    ? '- "nombre": nombre corto de venta EN INGLÉS (la tienda vende a clientes de EE. UU.), de 2 a 6 palabras, que describa tipo, estilo y color, sin la marca (ej. "Wide leg drawstring jeans", "Black running sneakers").'
    : '- "nombre": nombre corto de venta en español, de 2 a 6 palabras, que describa tipo, estilo y color, sin la marca (ej. "Jean wide leg con cordón", "Zapatillas running negras").';
  return `Eres el asistente de una tienda ${ingles ? 'de Estados Unidos' : 'en Perú que revende productos traídos de Estados Unidos'}. Te paso ${n} foto(s) de producto, en orden, numeradas desde 0.
Para cada foto responde un objeto con:
- "i": el número de la foto
- "categoria": exactamente una de: ${CATEGORIAS.join(', ')}
- "publico": exactamente uno de: ${PUBLICOS.join(', ')} (usa Unisex si no se distingue)
${nombre}
- "marca": la marca solo si su logo, etiqueta o diseño característico se ve claramente en la foto; si no, "".
- "costo": el precio en dólares que se lee en la etiqueta de precio de la tienda (si hay varios, el más bajo o el de liquidación), como número; si no se ve claro, null.
- "talla": la talla si se lee en la etiqueta o en el producto (ej. "8", "M", "32x30"); si no, "".
Responde solo con un arreglo JSON, por ejemplo: [{"i":0,"categoria":"Zapatos","publico":"Mujer","nombre":"Mocasines rosados con lazo","marca":"","costo":19.99,"talla":"8"}]`;
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
      marca: typeof r.marca === 'string' && r.marca.trim() ? r.marca.trim().slice(0, 40) : undefined,
      costo: typeof r.costo === 'number' && r.costo > 0 && r.costo < 10000 ? Math.round(r.costo * 100) / 100 : undefined,
      talla: typeof r.talla === 'string' && r.talla.trim() ? r.talla.trim().slice(0, 12) : undefined,
    }))
    .filter((r) => r.i >= 0 && r.i < n);
}

export const handler: Schema['clasificarFotos']['functionHandler'] = async (event) => {
  const paths = (event.arguments.paths ?? []).filter((p): p is string => !!p).slice(0, MAX_FOTOS);
  if (!paths.length) return JSON.stringify([]);

  const imagenes = await Promise.all(paths.map(leerFoto));
  const res = await bedrock.send(new ConverseCommand({
    modelId: process.env.MODEL_ID,
    messages: [{
      role: 'user',
      content: [
        ...imagenes.map((bytes) => ({ image: { format: 'jpeg' as const, source: { bytes } } })),
        { text: prompt(paths.length, event.arguments.idioma === 'en') },
      ],
    }],
    inferenceConfig: { maxTokens: 1024, temperature: 0 },
  }));

  const texto: string = (res.output?.message?.content ?? []).map((c) => c.text ?? '').join('');
  const inicio = texto.indexOf('['), fin = texto.lastIndexOf(']');
  let parsed: unknown = [];
  try { parsed = JSON.parse(texto.slice(inicio, fin + 1)); } catch { parsed = []; }
  return JSON.stringify(limpiar(parsed, paths.length));
};
