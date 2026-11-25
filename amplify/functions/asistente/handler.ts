import { ofertaActiva, zonaDe } from '../shared/oferta';
import {
  BedrockRuntimeClient, ConverseCommand,
  type ContentBlock, type Message, type Tool,
} from '@aws-sdk/client-bedrock-runtime';
import { QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, PRODUCTO, PEDIDO, TIENDA, leerTienda, subDe } from '../shared/tablas';
import { PLANES, planVigente } from '../shared/planes';
import { HERRAMIENTAS, LIMITE_DIARIO, LIMITE_WEB, WEB_POR_MENSAJE, buscarTexto, instrucciones, limpiarPropuesta } from './herramientas';

const bedrock = new BedrockRuntimeClient({});
const MAX_RONDAS = 7;
const DICE_QUE_PROPUSO = /te dej[eé] (los|el) cambios?|aqu[ií] (est[aá]|tienes) la propuesta|propuse|toca (el bot[oó]n )?"?aplicar|rev[ií]salos/i;

type Evento = { arguments: { tiendaId?: string; mensajes?: string; seleccion?: string | null }; identity?: { sub?: string } | null };

async function todos(tabla: string, indice: string, tiendaId: string) {
  const out: Record<string, any>[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(new QueryCommand({
      TableName: tabla, IndexName: indice, KeyConditionExpression: 'tiendaId = :t',
      ExpressionAttributeValues: { ':t': tiendaId }, ExclusiveStartKey,
    }));
    out.push(...(r.Items || []));
    ExclusiveStartKey = r.LastEvaluatedKey;
  } while (ExclusiveStartKey && out.length < 5000);
  return out;
}

/** Cuenta el uso del día; rechaza si pasó el límite del plan. */
async function contarUso(t: Record<string, any>) {
  const hoy = new Date().toISOString().slice(0, 10);
  const plan = planVigente(t);
  const limite = LIMITE_DIARIO[plan];
  try {
    await ddb.send(new UpdateCommand({
      TableName: TIENDA(), Key: { id: t.id },
      UpdateExpression: 'SET asistenteDia = :hoy, asistenteUsos = if_not_exists(asistenteUsos, :cero) + :uno',
      ConditionExpression: 'asistenteDia <> :hoy OR attribute_not_exists(asistenteDia) OR asistenteUsos < :lim',
      ExpressionAttributeValues: { ':hoy': hoy, ':cero': 0, ':uno': 1, ':lim': limite },
    }));
    // Primer mensaje del día: reinicia el contador
    if (t.asistenteDia !== hoy) {
      await ddb.send(new UpdateCommand({ TableName: TIENDA(), Key: { id: t.id }, UpdateExpression: 'SET asistenteUsos = :uno', ExpressionAttributeValues: { ':uno': 1 } }));
    }
  } catch (e) {
    if ((e as { name?: string }).name === 'ConditionalCheckFailedException') {
      throw new Error(`Llegaste al límite de ${limite} mensajes del asistente por hoy en el plan ${PLANES[plan].nombre}. Mañana se renueva, o mejora tu plan.`);
    }
    throw e;
  }
}

/** Cuenta una búsqueda en internet; devuelve false si ya se usaron las del día. */
async function contarWeb(t: Record<string, any>): Promise<boolean> {
  const hoy = new Date().toISOString().slice(0, 10);
  const limite = LIMITE_WEB[planVigente(t)] ?? 0;
  try {
    // Día nuevo: empieza en 1. Mismo día: suma 1 si no pasó el límite.
    await ddb.send(new UpdateCommand({
      TableName: TIENDA(), Key: { id: t.id },
      UpdateExpression: 'SET webUsos = if_not_exists(webUsos, :cero) + :uno',
      ConditionExpression: 'webDia = :hoy AND webUsos < :lim',
      ExpressionAttributeValues: { ':hoy': hoy, ':cero': 0, ':uno': 1, ':lim': limite },
    }));
    return true;
  } catch (e) {
    if ((e as { name?: string }).name !== 'ConditionalCheckFailedException') throw e;
  }
  if (limite < 1) return false;
  try {
    await ddb.send(new UpdateCommand({
      TableName: TIENDA(), Key: { id: t.id },
      UpdateExpression: 'SET webDia = :hoy, webUsos = :uno',
      ConditionExpression: 'attribute_not_exists(webDia) OR webDia <> :hoy',
      ExpressionAttributeValues: { ':hoy': hoy, ':uno': 1 },
    }));
    return true;
  } catch (e) {
    if ((e as { name?: string }).name === 'ConditionalCheckFailedException') return false;
    throw e;
  }
}

/** Búsqueda en internet con Amazon Nova Web Grounding. Devuelve un resumen y las fuentes (obligatorias). */
async function buscarWeb(consulta: string, us: boolean) {
  const res = await bedrock.send(new ConverseCommand({
    modelId: process.env.WEB_MODEL_ID || 'us.amazon.nova-2-lite-v1:0',
    system: [{ text: 'Busca en internet el producto indicado y responde en español, corto (máximo 8 líneas), solo con datos que encuentres: nombre exacto del modelo, descripción breve, material, medidas, colores disponibles y precio en tiendas de EE. UU. (en dólares). Si no encuentras ese mismo modelo, dilo. No inventes.' }],
    messages: [{ role: 'user', content: [{ text: `Producto: ${consulta}${us ? '' : ' (vendido en Perú, traído de EE. UU.)'}` }] }],
    // Herramienta de sistema de Nova: hace la búsqueda en internet y cita las páginas.
    toolConfig: { tools: [{ systemTool: { name: 'nova_grounding' } } as any] },
    inferenceConfig: { maxTokens: 800 },
  }));
  let texto = '';
  const fuentes: { url: string; dominio: string }[] = [];
  for (const c of (res.output?.message?.content || []) as any[]) {
    if (c.text) texto += c.text;
    for (const ci of c.citationsContent?.citations || []) {
      const url = ci?.location?.web?.url;
      if (url && !fuentes.some((f) => f.url === url)) fuentes.push({ url: String(url), dominio: String(ci.location.web.domain || '') });
    }
  }
  return { resumen: texto.trim().slice(0, 1500), fuentes: fuentes.slice(0, 6) };
}

/** Ficha de un producto desde internet, para completar productos recién subidos desde fotos. */
async function fichaWeb(consulta: string, us: boolean) {
  const res = await bedrock.send(new ConverseCommand({
    modelId: process.env.WEB_MODEL_ID || 'us.amazon.nova-2-lite-v1:0',
    system: [{ text: `Busca en internet el producto indicado. Responde SOLO con un objeto JSON, sin texto antes ni después, con estas claves: "encontrado" (true solo si encontraste ese mismo modelo), "modelo" (nombre exacto del modelo), "descripcion" (1 o 2 frases para vender, ${us ? 'en inglés' : 'en español'}, solo con datos encontrados), "material", "medidas", "colores", "precio_usd" (número, precio en tiendas de EE. UU., o null). Si un dato no aparece, usa "" o null. No inventes.` }],
    messages: [{ role: 'user', content: [{ text: `Producto: ${consulta}` }] }],
    toolConfig: { tools: [{ systemTool: { name: 'nova_grounding' } } as any] },
    inferenceConfig: { maxTokens: 700 },
  }));
  let texto = '';
  const fuentes: { url: string; dominio: string }[] = [];
  for (const c of (res.output?.message?.content || []) as any[]) {
    if (c.text) texto += c.text;
    for (const ci of c.citationsContent?.citations || []) {
      const url = ci?.location?.web?.url;
      if (url && !fuentes.some((f) => f.url === url)) fuentes.push({ url: String(url), dominio: String(ci.location.web.domain || '') });
    }
  }
  let d: Record<string, any> = {};
  try { const m = texto.match(/\{[\s\S]*\}/); d = m ? JSON.parse(m[0]) : {}; } catch { d = {}; }
  const txt = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
  const precio = Number(d.precio_usd);
  return {
    encontrado: d.encontrado === true && !!txt(d.descripcion, 600),
    modelo: txt(d.modelo, 120), descripcion: txt(d.descripcion, 600), material: txt(d.material, 120),
    medidas: txt(d.medidas, 120), colores: txt(d.colores, 160),
    precio_usd: precio > 0 && precio < 100000 ? Math.round(precio * 100) / 100 : null,
    fuentes: fuentes.slice(0, 5),
  };
}

const resumirProducto = (p: Record<string, any>) => ({
  id: p.id, codigo: p.codigo || '', nombre: p.nombre, marca: p.marca || '', precio: p.precio ?? null, costo: p.costo ?? null,
  stock: typeof p.stock === 'number' ? p.stock : null, talla: p.talla || '', condicion: p.condicion || '', categoria: p.categoria || '', tipo: p.tipo || '',
  publico: p.publico || '', estado: p.estado || 'disponible', descripcion: (p.descripcion || '').slice(0, 200),
  ...(ofertaActiva(p) ? { oferta: { precio: p.precioOferta, hasta: new Date(p.ofertaHasta).toISOString().slice(0, 10) } } : {}),
});

export const handler = async (event: Evento) => {
  const { tiendaId, mensajes, seleccion } = event.arguments || {};
  const sub = event.identity?.sub;
  const t = await leerTienda(String(tiendaId || ''));
  if (!t || !sub || subDe(t.owner) !== sub) throw new Error('No autorizado');

  // Completar con internet un producto recién creado desde fotos (no cuenta como mensaje del asistente).
  let pedido: unknown = null;
  try { pedido = JSON.parse(String(mensajes || 'null')); } catch { /* se valida abajo */ }
  if (pedido && !Array.isArray(pedido) && (pedido as any).modo === 'web') {
    const consulta = String((pedido as any).consulta || '').trim().slice(0, 200);
    if (consulta.length < 3) throw new Error('Falta qué buscar');
    if (!(await contarWeb(t))) return JSON.stringify({ ok: false, limite: true, limiteDia: LIMITE_WEB[planVigente(t)] ?? 0 });
    try {
      return JSON.stringify({ ok: true, ...(await fichaWeb(consulta, t.pais === 'US')) });
    } catch (e) {
      console.error('fichaWeb', e);
      return JSON.stringify({ ok: false, error: 'La búsqueda en internet no respondió' });
    }
  }

  // Conversación que guarda el navegador: solo texto, últimos turnos.
  let historial: { role: 'user' | 'assistant'; text: string }[] = [];
  try { historial = JSON.parse(String(mensajes || '[]')); } catch { throw new Error('Mensajes no válidos'); }
  historial = historial
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string' && m.text.trim())
    .slice(-12)
    .map((m) => ({ role: m.role, text: m.text.slice(0, 2000) }));
  while (historial.length && historial[0].role !== 'user') historial.shift();
  if (!historial.length || historial[historial.length - 1].role !== 'user') throw new Error('Falta tu mensaje');

  await contarUso(t);

  // Datos de la tienda (cargados una vez por mensaje)
  const [productos, pedidos] = await Promise.all([
    todos(PRODUCTO(), 'byTienda', t.id),
    todos(PEDIDO(), 'pedidosByTienda', t.id),
  ]);
  const mapaProd = new Map(productos.map((p) => [p.id, p]));
  const mapaPed = new Map(pedidos.map((p) => [p.id, p]));
  let propuesta: ReturnType<typeof limpiarPropuesta> | null = null;
  const hayPropuesta = (): boolean => { const p = propuesta as ReturnType<typeof limpiarPropuesta> | null; return !!p && p.productos.length + p.pedidos.length > 0; };

  const fuentesWeb: { url: string; dominio: string }[] = [];
  let busquedasMensaje = 0;
  const ejecutar = async (nombre: string, input: Record<string, any>): Promise<unknown> => {
    switch (nombre) {
      case 'resumen_tienda': {
        const plan = planVigente(t);
        const visibles = productos.filter((p) => p.estado !== 'oculto');
        const hace = (d: number) => Date.now() - d * 864e5;
        const ventas = (d: number) => pedidos.filter((p) => ['pagado', 'entregado'].includes(p.estado) && Date.parse(p.createdAt) >= hace(d));
        const suma = (l: Record<string, any>[]) => l.reduce((s, p) => s + (p.total || 0), 0) / 100;
        return {
          tienda: t.nombre, pais: t.pais === 'US' ? 'US' : 'PE', moneda_precios: t.pais !== 'US' && t.moneda === 'PEN' ? 'soles' : 'dólares', plan: PLANES[plan].nombre, limite_productos: PLANES[plan].limite ?? 'ilimitado', tipo_cambio: t.tipoCambio ?? null, descuento_yape_o_efectivo: t.descuentoContado ?? 0,
          productos_visibles: visibles.length, sin_precio: visibles.filter((p) => typeof p.precio !== 'number').length,
          sin_descripcion: visibles.filter((p) => !p.descripcion).length,
          agotados: visibles.filter((p) => p.stock === 0 || p.estado === 'vendido').length,
          poco_stock: visibles.filter((p) => typeof p.stock === 'number' && p.stock > 0 && p.stock <= 2).length,
          pedidos_por_confirmar: pedidos.filter((p) => p.estado === 'por_confirmar').length,
          pedidos_por_entregar: pedidos.filter((p) => p.estado === 'pagado').length,
          moneda_ventas: t.pais === 'US' ? 'USD' : 'soles',
          ventas_7_dias: { pedidos: ventas(7).length, total: suma(ventas(7)) },
          ventas_30_dias: { pedidos: ventas(30).length, total: suma(ventas(30)) },
        };
      }
      case 'buscar_productos': {
        const lista = buscarTexto(productos, input.texto)
          .filter((p) => !input.categoria || String(p.categoria || '').toLowerCase() === String(input.categoria).toLowerCase())
          .filter((p) => !input.marca || String(p.marca || '').toLowerCase().includes(String(input.marca).toLowerCase()))
          .filter((p) => !input.estado || (p.estado || 'disponible') === input.estado)
          .filter((p) => !input.sin_precio || typeof p.precio !== 'number')
          .filter((p) => !input.sin_descripcion || !p.descripcion)
          .filter((p) => input.stock_maximo == null || (typeof p.stock === 'number' && p.stock <= Number(input.stock_maximo)))
          .sort((a, b) => (b.creado || 0) - (a.creado || 0));
        return { total: lista.length, productos: lista.slice(0, 60).map(resumirProducto) };
      }
      case 'listar_pedidos': {
        const lista = pedidos
          .filter((p) => !input.estado || p.estado === input.estado)
          .filter((p) => !input.dias || Date.parse(p.createdAt) >= Date.now() - Number(input.dias) * 864e5)
          .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
          .slice(0, 40)
          .map((p) => {
            let items: { nombre?: string; q?: number }[] = [];
            try { items = JSON.parse(p.items || '[]'); } catch { /* sin detalle */ }
            return {
              id: p.id, fecha: p.createdAt, cliente: p.cliente || '', metodo: p.metodo || 'tarjeta', estado: p.estado,
              total: `${p.moneda === 'pen' ? 'S/' : '$'} ${(p.total || 0) / 100}`, operacion: p.operacion || '',
              productos: items.map((i) => `${i.nombre}${(i.q || 1) > 1 ? ` x${i.q}` : ''}`).join(', '),
            };
          });
        return { total: lista.length, pedidos: lista };
      }
      case 'buscar_en_internet': {
        const consulta = String(input.consulta || '').trim().slice(0, 200);
        if (!consulta) return { error: 'Falta qué buscar' };
        if (busquedasMensaje >= WEB_POR_MENSAJE) return { ok: false, nota: `Ya hiciste ${WEB_POR_MENSAJE} búsquedas en este mensaje. Responde con lo que tienes y dile que te pida los siguientes productos.` };
        if (!(await contarWeb(t))) {
          const lim = LIMITE_WEB[planVigente(t)] ?? 0;
          return { ok: false, nota: `Se acabaron las búsquedas en internet de hoy (${lim} por día). Díselo a la vendedora: mañana se renuevan.` };
        }
        busquedasMensaje++;
        try {
          const r = await buscarWeb(consulta, t.pais === 'US');
          for (const f of r.fuentes) if (!fuentesWeb.some((x) => x.url === f.url)) fuentesWeb.push(f);
          return { ok: true, consulta, resultado: r.resumen || 'No se encontró información.', paginas: r.fuentes.map((f) => f.dominio) };
        } catch (e) {
          console.error('buscar_en_internet', e);
          return { ok: false, nota: 'La búsqueda en internet no respondió. Dile que intente más tarde.' };
        }
      }
      case 'proponer_cambios': {
        propuesta = limpiarPropuesta(input, mapaProd, mapaPed, zonaDe(t.pais), t.pais !== 'US' && t.moneda === 'PEN' ? 'PEN' : 'USD');
        const n = propuesta.productos.length + propuesta.pedidos.length;
        return n
          ? { ok: true, cambios: n, nota: 'Propuesta enviada a la vendedora. Aún NO está aplicada: debe revisarla y tocar Aplicar.' }
          : { ok: false, nota: 'No se envió ninguna propuesta: ningún cambio era válido o esos productos ya tenían ese valor. No digas que propusiste cambios.' };
      }
      default:
        return { error: 'Herramienta desconocida' };
    }
  };

  const tools: Tool[] = HERRAMIENTAS.map((h) => ({
    toolSpec: { name: h.name, description: h.description, inputSchema: { json: h.schema as any } },
  }));
  const messages: Message[] = historial.map((m) => ({ role: m.role, content: [{ text: m.text }] }));
  // Productos que la vendedora tiene marcados en su lista ("estos", "los seleccionados")
  let idsSel: unknown = [];
  try { idsSel = JSON.parse(String(seleccion || '[]')); } catch { idsSel = []; }
  const sel = (Array.isArray(idsSel) ? idsSel : []).slice(0, 100).map((id) => mapaProd.get(String(id))).filter(Boolean)
    .map((p) => ({ id: p!.id, nombre: p!.nombre, marca: p!.marca || '', categoria: p!.categoria || '' }));
  const textoSel = sel.length
    ? `\n\nProductos que la vendedora tiene marcados ahora en su lista (${sel.length}):\n${JSON.stringify(sel)}`
    : '\n\nLa vendedora no tiene productos marcados en su lista.';
  const system = [{ text: instrucciones(t, new Date().toLocaleDateString('es-PE', { timeZone: zonaDe(t.pais), dateStyle: 'full' }) + ` (${new Date().toLocaleDateString('en-CA', { timeZone: zonaDe(t.pais) })})`) + textoSel }];

  let texto = '';
  let insistio = false;
  for (let ronda = 0; ronda < MAX_RONDAS; ronda++) {
    const res = await bedrock.send(new ConverseCommand({
      modelId: process.env.MODEL_ID, system, messages,
      toolConfig: { tools }, inferenceConfig: { maxTokens: 2000 },
    }));
    const msg = res.output?.message;
    if (!msg) break;
    messages.push(msg);
    const contenido = msg.content || [];
    texto = contenido.map((c) => c.text || '').filter(Boolean).join('\n').trim() || texto;
    const usos = contenido.filter((c) => c.toolUse);
    if (res.stopReason !== 'tool_use' || !usos.length) {
      // A veces el modelo escribe "te dejé los cambios" sin llamar a proponer_cambios y no sale ninguna tarjeta.
      // Se le pide una vez que la llame de verdad.
      if (!hayPropuesta() && !insistio && DICE_QUE_PROPUSO.test(texto) && ronda < MAX_RONDAS - 1) {
        insistio = true;
        messages.push({ role: 'user', content: [{ text: 'Aviso del sistema: no llamaste a la herramienta proponer_cambios, así que la vendedora no ve ninguna tarjeta para aplicar. Llámala ahora con esos cambios (usa buscar_productos si te falta el id) y después responde una sola frase.' }] });
        continue;
      }
      break;
    }
    const resultados: ContentBlock[] = await Promise.all(usos.map(async (c) => {
      let salida: unknown;
      try { salida = await ejecutar(c.toolUse!.name!, (c.toolUse!.input || {}) as Record<string, any>); }
      catch (e) { salida = { error: (e as Error).message }; }
      return { toolResult: { toolUseId: c.toolUse!.toolUseId!, content: [{ json: salida as any }] } };
    }));
    messages.push({ role: 'user', content: resultados });
  }

  if (!hayPropuesta() && DICE_QUE_PROPUSO.test(texto)) {
    texto = 'No pude preparar la tarjeta con los cambios. Escríbemelo otra vez con el código y el cambio, por ejemplo: "En el CAR-002 pon de nombre Cartera Guess y 1 en stock".';
  }
  // Fuentes de internet: AWS exige mostrarlas siempre que se usa la búsqueda.
  if (fuentesWeb.length) {
    texto = (texto || 'Listo.') + '\n\nFuentes de internet:\n' + fuentesWeb.slice(0, 8).map((f) => `- ${f.url}`).join('\n');
  }
  return JSON.stringify({ texto: texto || 'Listo.', propuesta });
};
