// Asistente de compras para los clientes de una tienda ("regalos para niño de 5 años", "¿qué ofertas hay?").
// Solo recomienda productos de esa tienda, con los datos que el cliente ya ve (nunca costos ni el origen).
// No cambia nada: responde con un texto corto y los códigos de los productos que recomienda.
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { planVigente } from '../shared/planes';

const bedrock = new BedrockRuntimeClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// Preguntas de clientes por día y por tienda, según el plan de la tienda
export const LIMITE_CLIENTES: Record<string, number> = { free: 20, basico: 100, pro: 300, plus: 1000 };
const MAX_EN_PROMPT = 350;

type Mensaje = { role: 'user' | 'assistant'; text: string };
const respuesta = (texto: string, codigos: string[] = [], extra: Record<string, unknown> = {}) => JSON.stringify({ texto, codigos, ...extra });

const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

async function contarPregunta(t: Record<string, any>): Promise<boolean> {
  const hoy = new Date().toISOString().slice(0, 10);
  const limite = LIMITE_CLIENTES[planVigente(t)] ?? 20;
  try {
    if (t.clienteDia !== hoy) {
      await ddb.send(new UpdateCommand({
        TableName: process.env.TIENDA_TABLE, Key: { id: t.id },
        UpdateExpression: 'SET clienteDia = :hoy, clienteUsos = :uno',
        ConditionExpression: 'attribute_not_exists(clienteDia) OR clienteDia <> :hoy',
        ExpressionAttributeValues: { ':hoy': hoy, ':uno': 1 },
      }));
      return true;
    }
    await ddb.send(new UpdateCommand({
      TableName: process.env.TIENDA_TABLE, Key: { id: t.id },
      UpdateExpression: 'SET clienteUsos = if_not_exists(clienteUsos, :cero) + :uno',
      ConditionExpression: 'clienteDia = :hoy AND (attribute_not_exists(clienteUsos) OR clienteUsos < :lim)',
      ExpressionAttributeValues: { ':hoy': hoy, ':cero': 0, ':uno': 1, ':lim': limite },
    }));
    return true;
  } catch (e) {
    if ((e as { name?: string }).name === 'ConditionalCheckFailedException') {
      // Dos preguntas a la vez justo al cambiar de día: se cuenta en el día nuevo
      if (t.clienteDia !== hoy) return true;
      return false;
    }
    throw e;
  }
}

/** Lista corta de productos para el modelo (solo lo que el cliente puede comprar hoy). */
function listaParaIA(productos: Record<string, any>[], pregunta: string, moneda: string) {
  const disponibles = productos.filter((p) => (p.estado || 'disponible') === 'disponible' && p.stock !== 0 && p.codigo);
  let lista = disponibles;
  if (lista.length > MAX_EN_PROMPT) {
    // Muchos productos: primero los que comparten palabras con la pregunta, luego los más nuevos
    const palabras = norm(pregunta).split(/[^a-z0-9ñ]+/).filter((w) => w.length > 2);
    const puntaje = (p: Record<string, any>) => { const h = norm([p.nombre, p.marca, p.categoria, p.publico, p.descripcion, p.talla].join(' ')); return palabras.filter((w) => h.includes(w)).length; };
    lista = [...lista].sort((a, b) => puntaje(b) - puntaje(a) || Number(b.creado) - Number(a.creado)).slice(0, MAX_EN_PROMPT);
  }
  const sim = moneda === 'PEN' ? 'S/ ' : '$';
  return lista.map((p) => {
    const o: Record<string, unknown> = { c: p.codigo, n: p.nombre };
    if (p.marca) o.m = p.marca;
    o.p = p.precio == null ? 'consultar' : sim + p.precio;
    if (p.precioAntes != null) { o.antes = sim + p.precioAntes; if (p.ofertaHasta) o.ofertaHasta = new Date(p.ofertaHasta).toISOString().slice(0, 10); }
    if (p.talla) o.t = p.talla;
    if (p.categoria) o.cat = p.categoria;
    if (p.tipo) o.tipo = p.tipo;
    if (p.publico) o.para = p.publico;
    if (p.condicion) o.cond = p.condicion;
    if (p.descripcion) o.d = String(p.descripcion).slice(0, 140);
    if (typeof p.stock === 'number' && p.stock <= 3) o.quedan = p.stock;
    return o;
  });
}

function instrucciones(nombre: string, en: boolean, hoy: string) {
  if (en) {
    return `You are the shopping assistant of the online store "${nombre}". Today is ${hoy}.
- Recommend ONLY products from the PRODUCTS list below. Never invent products, prices, sizes or stock.
- Be brief and warm (2-4 sentences, like a WhatsApp message). Mention prices exactly as listed.
- For gift ideas use the fields "para" (Mujer = women, Hombre = men, Niños = kids, Unisex), the category and the description. If an age is asked and the list does not say it, recommend what fits best and say the customer can confirm with the store.
- If nothing fits, say so kindly and suggest messaging the store on WhatsApp.
- Never talk about costs, suppliers, other stores or anything not about this store's products.
- Answer ONLY with JSON: {"texto": "your message", "codigos": ["CODE", ...]} with up to 6 product codes (the "c" field) in recommendation order. No text outside the JSON.`;
  }
  return `Eres el asistente de compras de la tienda online "${nombre}". Hoy es ${hoy}.
- Recomienda SOLO productos de la lista PRODUCTOS de abajo. Nunca inventes productos, precios, tallas ni stock.
- Responde corto y cálido (2 a 4 frases, como un mensaje de WhatsApp), en español sencillo. Di los precios tal como están en la lista.
- Para regalos usa el campo "para" (Mujer, Hombre, Niños, Unisex), la categoría y la descripción. Si preguntan por una edad y la lista no la dice, recomienda lo que mejor encaje y di que pueden confirmarlo con la tienda.
- Si hay productos en oferta ("antes"), puedes destacarlos.
- Si nada encaja, dilo con amabilidad y sugiere escribir a la tienda por WhatsApp.
- Nunca hables de costos, proveedores, otras tiendas ni de temas que no sean los productos de esta tienda.
- Responde SOLO con JSON: {"texto": "tu mensaje", "codigos": ["CODIGO", ...]} con hasta 6 códigos (campo "c") en orden de recomendación. Nada fuera del JSON.`;
}

/** Saca el JSON de la respuesta del modelo aunque venga con texto alrededor. */
function leerJson(s: string): { texto?: string; codigos?: unknown } {
  const limpio = s.replace(/```(?:json)?/g, '');
  const i = limpio.indexOf('{'), j = limpio.lastIndexOf('}');
  if (i >= 0 && j > i) { try { return JSON.parse(limpio.slice(i, j + 1)); } catch { /* sigue abajo */ } }
  return { texto: limpio.trim(), codigos: [] };
}

export async function preguntarTienda(cat: Record<string, any>, t: Record<string, any> | undefined, mensajesJson: string): Promise<string> {
  const tienda = cat.tienda || {};
  const en = tienda.pais === 'US';
  const tx = (es: string, eng: string) => (en ? eng : es);
  if (!t || cat.estado !== 'aprobada' || !Array.isArray(cat.productos)) return respuesta(tx('Esta tienda todavía no está abierta.', "This store isn't open yet."), [], { error: true });
  if (t.chatClientes === false) return respuesta(tx('Esta tienda no tiene el asistente activado. Escríbenos por WhatsApp.', "This store's assistant is off. Message us on WhatsApp."), [], { error: true, apagado: true });

  let mensajes: Mensaje[] = [];
  try { mensajes = JSON.parse(mensajesJson); } catch { mensajes = []; }
  mensajes = (Array.isArray(mensajes) ? mensajes : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string' && m.text.trim())
    .map((m) => ({ role: m.role, text: m.text.slice(0, 500) }))
    .slice(-8);
  while (mensajes.length && mensajes[0].role !== 'user') mensajes.shift();
  if (!mensajes.length || mensajes[mensajes.length - 1].role !== 'user') return respuesta(tx('Escribe tu pregunta.', 'Type your question.'), [], { error: true });

  if (!(await contarPregunta(t))) {
    return respuesta(tx(`Por hoy ya respondí todas las preguntas que puedo (${LIMITE_CLIENTES[planVigente(t)]} por día en esta tienda). Escríbenos por WhatsApp y te ayudamos.`, 'I have answered all the questions I can for today. Please message us on WhatsApp.'), [], { error: true, limite: true });
  }

  const pregunta = mensajes[mensajes.length - 1].text;
  const lista = listaParaIA(cat.productos, pregunta, tienda.moneda);
  if (!lista.length) return respuesta(tx('Ahora mismo no hay productos disponibles. Escríbenos por WhatsApp.', 'There are no products available right now. Message us on WhatsApp.'));
  const hoy = new Date().toLocaleDateString(en ? 'en-US' : 'es-PE', { timeZone: en ? 'America/New_York' : 'America/Lima', dateStyle: 'full' });
  const system = [{ text: `${instrucciones(tienda.nombre || 'la tienda', en, hoy)}\n\nPRODUCTOS (${lista.length}):\n${JSON.stringify(lista)}` }];

  const r = await bedrock.send(new ConverseCommand({
    modelId: process.env.MODEL_ID, system,
    messages: mensajes.map((m) => ({ role: m.role, content: [{ text: m.text }] })),
    inferenceConfig: { maxTokens: 700, temperature: 0.3 },
  }));
  const salida = (r.output?.message?.content || []).map((c) => c.text || '').join('').trim();
  const j = leerJson(salida);
  const validos = new Set(lista.map((p) => String(p.c)));
  const codigos = (Array.isArray(j.codigos) ? j.codigos : []).map((c) => String(c).toUpperCase().trim()).filter((c) => validos.has(c));
  const texto = String(j.texto || '').trim() || tx('Te dejo algunas opciones de la tienda:', 'Here are some options from the store:');
  return respuesta(texto.slice(0, 1200), [...new Set(codigos)].slice(0, 6));
}

