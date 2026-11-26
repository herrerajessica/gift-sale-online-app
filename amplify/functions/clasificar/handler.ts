import { tiposDe, categoriaDeTipo } from '../shared/rubros';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
// Converse API: el mismo código sirve para Amazon Nova y para Claude; solo cambia MODEL_ID.
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';

const s3 = new S3Client({});
const bedrock = new BedrockRuntimeClient({});

export const CATEGORIAS = [
  'Ropa', 'Zapatos', 'Carteras y bolsos', 'Accesorios', 'Relojes y joyería',
  'Perfumes y belleza', 'Electrónica', 'Hogar', 'Juguetes', 'Otros',
];
export const PUBLICOS = ['Mujer', 'Hombre', 'Niños', 'Unisex'];
const MAX_FOTOS = 8;

export const CONDICIONES = ['nuevo_etiqueta', 'nuevo', 'caja_abierta', 'como_nuevo', 'usado'];

type Resultado = { i: number; tipo?: string; categoria?: string; publico?: string; nombre?: string; marca?: string; costo?: number; talla?: string; condicion?: string; descripcion?: string };

async function leerFoto(path: string): Promise<Uint8Array> {
  if (!path.startsWith('productos/')) throw new Error('Ruta no permitida');
  const obj = await s3.send(new GetObjectCommand({ Bucket: process.env.BUCKET_NAME, Key: path }));
  return obj.Body!.transformToByteArray();
}

function prompt(n: number, ingles: boolean, rubro?: string | null): string {
  const tipos = tiposDe(rubro).map(([t]) => t);
  const nombre = ingles
    ? '- "nombre": nombre corto de venta EN INGLÉS (la tienda vende a clientes de EE. UU.), de 2 a 6 palabras, que describa tipo, estilo y color, sin la marca (ej. "Wide leg drawstring jeans", "Black running sneakers").'
    : '- "nombre": nombre corto de venta en español, de 2 a 6 palabras, que describa tipo, estilo y color, sin la marca (ej. "Jean wide leg con cordón", "Zapatillas running negras").';
  return `Eres el asistente de una tienda ${ingles ? 'de Estados Unidos' : 'en Perú que revende productos traídos de Estados Unidos'}. Te paso ${n} foto(s) de producto, en orden, numeradas desde 0.
Para cada foto responde un objeto con:
- "i": el número de la foto
- "tipo": el tipo de producto, exactamente uno de: ${tipos.join(', ')}; si no es ninguno, ""
- "categoria": exactamente una de: ${CATEGORIAS.join(', ')}
- "publico": exactamente uno de: ${PUBLICOS.join(', ')} (usa Unisex si no se distingue)
${nombre}
- "marca": la marca si se ve su logo o diseño característico, o si su nombre está escrito en el producto, la caja, la bolsa, el estuche o la etiqueta (ej. "GUESS" impreso en la caja); si no, "".
- "costo": el precio en dólares que se lee en la etiqueta de precio de la tienda (si hay varios, el más bajo o el de liquidación), como número; si no se ve claro, null.
- "talla": la talla si se lee en la etiqueta o en el producto (ej. "8", "M", "32x30"); si no, "". Las medidas en pulgadas escríbelas con "pulg" (ej. 16 pulg), nunca con comillas.
- "condicion": exactamente una de: ${CONDICIONES.join(', ')}. Usa nuevo_etiqueta si se ve la etiqueta de la tienda colgando; caja_abierta si está en su caja abierta; si no estás segura, "".
- Si el producto está dentro de su caja o estuche, el "nombre", el "tipo" y la "descripcion" son del PRODUCTO (collar, pulsera, reloj, perfume…), nunca de la caja; la caja solo se menciona en la descripción ("viene en su caja original").
- "descripcion": 1 o 2 frases cortas para vender, ${ingles ? 'EN INGLÉS' : 'en español'}, solo con lo que se ve (tipo, color, estilo, detalles, si trae caja o etiqueta). No inventes materiales, medidas ni que es original.
Responde solo con un arreglo JSON, por ejemplo: [{"i":0,"tipo":"Zapatos","categoria":"Zapatos","publico":"Mujer","nombre":"Mocasines rosados con lazo","marca":"","costo":19.99,"talla":"8","condicion":"nuevo_etiqueta","descripcion":"Mocasines rosados con lazo, nuevos con etiqueta. Cómodos para el día a día."}]`;
}

function limpiar(arr: unknown, n: number): Resultado[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((r): r is Resultado => !!r && typeof r === 'object' && Number.isInteger(Number((r as Resultado).i)))
    .map((r) => ({
      i: Number(r.i),
      tipo: categoriaDeTipo(String(r.tipo)) ? String(r.tipo) : undefined,
      // Si la IA dio un tipo conocido, la categoría sale de él (así nunca se contradicen)
      categoria: categoriaDeTipo(String(r.tipo)) || (CATEGORIAS.includes(String(r.categoria)) ? String(r.categoria) : undefined),
      publico: PUBLICOS.includes(String(r.publico)) ? String(r.publico) : undefined,
      nombre: typeof r.nombre === 'string' && r.nombre.trim() ? r.nombre.trim().slice(0, 80) : undefined,
      marca: typeof r.marca === 'string' && r.marca.trim() ? r.marca.trim().slice(0, 40) : undefined,
      costo: typeof r.costo === 'number' && r.costo > 0 && r.costo < 10000 ? Math.round(r.costo * 100) / 100 : undefined,
      talla: typeof r.talla === 'string' && r.talla.trim() ? r.talla.trim().slice(0, 12) : undefined,
      condicion: CONDICIONES.includes(String(r.condicion)) ? String(r.condicion) : undefined,
      descripcion: typeof r.descripcion === 'string' && r.descripcion.trim() ? r.descripcion.trim().slice(0, 300) : undefined,
    }))
    .filter((r) => r.i >= 0 && r.i < n);
}

// ---------- Dictado por voz ----------
const MAX_TEXTOS = 40;
type Dictado = { i: number; tipo?: string; nombre?: string; marca?: string; precio?: number; moneda?: string; costo?: number; stock?: number; talla?: string; condicion?: string; categoria?: string; publico?: string; descripcion?: string };

function promptDictado(textos: string[], ingles: boolean, moneda: string, rubro?: string | null): string {
  const tipos = tiposDe(rubro).map(([t]) => t);
  return `Eres el asistente de una vendedora ${ingles ? 'de Estados Unidos' : 'en Perú'}. Ella fue mirando sus productos y dictó por voz un texto por producto (puede tener errores del reconocimiento de voz). Los precios de su tienda están en ${moneda === 'PEN' ? 'soles' : 'dólares'}.
Para cada texto responde un objeto con:
- "i": el número del texto
- "tipo": el tipo de producto que dijo, exactamente uno de: ${tipos.join(', ')}; si no es ninguno, ""
- "nombre": nombre corto de venta ${ingles ? 'EN INGLÉS' : 'en español'}, de 2 a 6 palabras (tipo, estilo, color), sin la marca ni el precio
- "marca": la marca si la dijo, con su ortografía correcta (ej. "gues" → "Guess", "maicol cors" → "Michael Kors", "bat an bodi" → "Bath & Body Works"); si no, ""
- "precio": el precio de venta que dijo, como número; si no dijo precio, null
- "moneda": "PEN" si dijo soles, "USD" si dijo dólares, null si no dijo la moneda
- "costo": lo que le costó en dólares si lo dijo ("me costó 20 dólares", "la etiqueta dice 19.99"), como número; si no, null
- "stock": cuántas unidades tiene si lo dijo ("tengo 3", "son 2", "quedan 5"), como número entero; si no, null
- "talla": la talla si la dijo; si no, ""
- "condicion": exactamente una de: ${CONDICIONES.join(', ')} según lo que dijo (nueva con etiqueta, nueva, caja abierta, como nueva, usada); si no lo dijo, ""
- "categoria": exactamente una de: ${CATEGORIAS.join(', ')}
- "publico": exactamente uno de: ${PUBLICOS.join(', ')} (Unisex si no se sabe)
- "descripcion": 1 o 2 frases cortas para vender, ${ingles ? 'EN INGLÉS' : 'en español'}, solo con lo que ella dijo. No inventes nada.
Textos:
${textos.map((t, i) => `${i}: ${t}`).join('\n')}
Responde solo con un arreglo JSON con un objeto por texto, en el mismo orden.`;
}

function limpiarDictado(arr: unknown, n: number): Dictado[] {
  if (!Array.isArray(arr)) return [];
  const num = (v: unknown, max: number) => (typeof v === 'number' && v > 0 && v < max ? Math.round(v * 100) / 100 : undefined);
  const txt = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
  return arr
    .filter((r): r is Dictado => !!r && typeof r === 'object' && Number.isInteger(Number((r as Dictado).i)))
    .map((r) => ({
      i: Number(r.i),
      tipo: categoriaDeTipo(String(r.tipo)) ? String(r.tipo) : undefined,
      nombre: txt(r.nombre, 80), marca: txt(r.marca, 40), talla: txt(r.talla, 12), descripcion: txt(r.descripcion, 300),
      precio: num(r.precio, 100000), moneda: r.moneda === 'PEN' || r.moneda === 'USD' ? r.moneda : undefined,
      costo: num(r.costo, 10000), stock: typeof r.stock === 'number' && r.stock >= 0 && r.stock < 100000 ? Math.floor(r.stock) : undefined,
      condicion: CONDICIONES.includes(String(r.condicion)) ? String(r.condicion) : undefined,
      categoria: categoriaDeTipo(String(r.tipo)) || (CATEGORIAS.includes(String(r.categoria)) ? String(r.categoria) : undefined),
      publico: PUBLICOS.includes(String(r.publico)) ? String(r.publico) : undefined,
    }))
    .filter((r) => r.i >= 0 && r.i < n);
}

function leerArreglo(texto: string): unknown {
  const inicio = texto.indexOf('['), fin = texto.lastIndexOf(']');
  const crudo = texto.slice(inicio, fin + 1);
  try { return JSON.parse(crudo); } catch { /* se intenta reparar abajo */ }
  // Medidas en pulgadas copiadas de la caja (16"18"+2") rompen el JSON: la comilla después de un número
  // que no cierra el texto se cambia por "pulg". Si aun así falla, se descarta.
  try { return JSON.parse(crudo.replace(/(\d)\s*"(?!\s*[,}\]:])/g, '$1 pulg')); } catch { return []; }
}

async function interpretarDictado(args: { textos?: (string | null)[] | null; idioma?: string | null; moneda?: string | null; rubro?: string | null }) {
  const textos = (args.textos ?? []).filter((t): t is string => !!t && !!t.trim()).map((t) => t.trim().slice(0, 600)).slice(0, MAX_TEXTOS);
  if (!textos.length) return JSON.stringify([]);
  const res = await bedrock.send(new ConverseCommand({
    modelId: process.env.MODEL_ID,
    messages: [{ role: 'user', content: [{ text: promptDictado(textos, args.idioma === 'en', args.moneda === 'PEN' ? 'PEN' : 'USD', args.rubro) }] }],
    inferenceConfig: { maxTokens: 4096, temperature: 0 },
  }));
  const texto: string = (res.output?.message?.content ?? []).map((c: { text?: string }) => c.text ?? '').join('');
  if (res.stopReason === 'max_tokens') throw new Error('Respuesta de dictado incompleta. Reduce el lote.');
  const resultados = limpiarDictado(leerArreglo(texto), textos.length);
  if (resultados.length !== textos.length || new Set(resultados.map(r => r.i)).size !== textos.length) {
    throw new Error('La IA no devolvió todos los productos del dictado.');
  }
  return JSON.stringify(resultados);
}

// ---------- Traducción de productos (tienda en dos idiomas) ----------
async function traducirTextos(args: { textos?: (string | null)[] | null; a?: string | null }) {
  const textos = (args.textos ?? []).map((t) => String(t ?? '').slice(0, 600)).slice(0, 60);
  if (!textos.some((t) => t.trim())) return JSON.stringify(textos.map(() => ''));
  const idioma = args.a === 'es' ? 'español (de Perú)' : 'inglés (de EE. UU.)';
  const prompt = `Traduce al ${idioma} estos textos de productos de una tienda de ropa y accesorios. Son nombres cortos y descripciones de venta.
- Mantén igual las marcas, tallas, códigos, números y precios.
- Nombres: cortos y naturales, como en una tienda (ej. "Cartera negra con cadena" → "Black chain-strap handbag").
- Si un texto está vacío, devuelve "".
Responde SOLO con un arreglo JSON de ${textos.length} textos, en el mismo orden.
Textos:
${JSON.stringify(textos)}`;
  const res = await bedrock.send(new ConverseCommand({
    modelId: process.env.MODEL_ID,
    messages: [{ role: 'user', content: [{ text: prompt }] }],
    inferenceConfig: { maxTokens: 4096, temperature: 0 },
  }));
  const texto: string = (res.output?.message?.content ?? []).map((c: { text?: string }) => c.text ?? '').join('');
  const arr = leerArreglo(texto);
  const salida = Array.isArray(arr) && arr.length === textos.length ? arr.map((x, i) => (textos[i].trim() ? String(x ?? '').slice(0, 600) : '')) : [];
  return JSON.stringify(salida);
}

// ---------- Fotos ----------
type EventoIA = { fieldName?: string; arguments: { paths?: (string | null)[] | null; idioma?: string | null; textos?: (string | null)[] | null; moneda?: string | null; rubro?: string | null } };

export const handler = async (event: EventoIA) => {
  if (event.fieldName === 'agruparFotos') {
    const paths = event.arguments.paths;
    if (!paths?.length || paths.length > 20 || paths.some(p => !p?.startsWith('productos/'))) throw new Error('Envía entre 1 y 20 fotos de productos.');
    const imagenes = await Promise.all(paths.map(p => leerFoto(p!)));
    const res = await bedrock.send(new ConverseCommand({
      modelId: process.env.MODEL_ID,
      messages: [{role:'user',content:[
        ...imagenes.map(bytes=>({image:{format:'jpeg' as const,source:{bytes}}})),
        {text:'Organiza estas fotos numeradas desde 0 en productos físicos individuales. Agrupa solo fotos que claramente muestran el MISMO artículo desde distintos ángulos. No agrupes solo por categoría o marca: colores, modelos o tallas diferentes son productos distintos. Una etiqueta aislada sin vínculo claro debe quedar fuera. Las fotos ambiguas deben quedar fuera para revisión humana. No supongas grupos de tamaño fijo ni uses el orden como evidencia suficiente. Si una foto muestra solo la caja (cerrada o vacía) y no hay forma clara de saber de qué producto es, déjala fuera. El "nombre" es el del producto (collar, pulsera, reloj…), nunca el de la caja o el empaque. Devuelve SOLO JSON: [{"nombre":"nombre corto en español","indices":[0,2,5]}]. Cada índice puede aparecer una sola vez. Incluye grupos de una foto si claramente muestran un producto.'},
      ]}],
      inferenceConfig:{maxTokens:8000,temperature:0},
    }));
    const texto=(res.output?.message?.content??[]).map(c=>'text' in c?c.text:'').join('');
    let arr: unknown[] = [];
    const leido = leerArreglo(texto); if (Array.isArray(leido)) arr = leido;
    // Respuesta cortada o mal formada (pasa con muchas fotos): se rescatan los grupos que sí llegaron completos.
    if(!arr.length){
      arr=[...texto.matchAll(/\{[^{}]*"indices"\s*:\s*\[[\d,\s]*\][^{}]*\}/g)].flatMap(m=>{try{return [JSON.parse(m[0])];}catch{return [];}});
    }
    if(!arr.length) throw new Error(res.stopReason==='max_tokens'?'La agrupación quedó incompleta.':'Respuesta de agrupación inválida');
    return JSON.stringify(arr);
  }
  if (event.fieldName === 'interpretarDictado') return interpretarDictado(event.arguments);
  if (event.fieldName === 'traducirTextos') return traducirTextos(event.arguments as { textos?: (string | null)[] | null; a?: string | null });
  const paths = (event.arguments.paths ?? []).filter((p): p is string => !!p).slice(0, MAX_FOTOS);
  if (!paths.length) return JSON.stringify([]);

  const imagenes = await Promise.all(paths.map(leerFoto));
  const res = await bedrock.send(new ConverseCommand({
    modelId: process.env.MODEL_ID,
    messages: [{
      role: 'user',
      content: [
        ...imagenes.map((bytes) => ({ image: { format: 'jpeg' as const, source: { bytes } } })),
        { text: prompt(paths.length, event.arguments.idioma === 'en', event.arguments.rubro) },
      ],
    }],
    inferenceConfig: { maxTokens: 2048, temperature: 0 },
  }));

  const texto: string = (res.output?.message?.content ?? []).map((c: { text?: string }) => c.text ?? '').join('');
  return JSON.stringify(limpiar(leerArreglo(texto), paths.length));
};
