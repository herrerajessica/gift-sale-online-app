import {
  BedrockRuntimeClient, ConverseCommand,
  type ContentBlock, type Message, type Tool,
} from '@aws-sdk/client-bedrock-runtime';
import { QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, PRODUCTO, PEDIDO, TIENDA, leerTienda, subDe } from '../shared/tablas';
import { PLANES, planVigente } from '../shared/planes';
import { HERRAMIENTAS, LIMITE_DIARIO, buscarTexto, instrucciones, limpiarPropuesta } from './herramientas';

const bedrock = new BedrockRuntimeClient({});
const MAX_RONDAS = 6;

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

const resumirProducto = (p: Record<string, any>) => ({
  id: p.id, nombre: p.nombre, marca: p.marca || '', precio: p.precio ?? null, costo: p.costo ?? null,
  stock: typeof p.stock === 'number' ? p.stock : null, talla: p.talla || '', categoria: p.categoria || '',
  publico: p.publico || '', estado: p.estado || 'disponible', descripcion: (p.descripcion || '').slice(0, 200),
});

export const handler = async (event: Evento) => {
  const { tiendaId, mensajes, seleccion } = event.arguments || {};
  const sub = event.identity?.sub;
  const t = await leerTienda(String(tiendaId || ''));
  if (!t || !sub || subDe(t.owner) !== sub) throw new Error('No autorizado');

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

  const ejecutar = (nombre: string, input: Record<string, any>): unknown => {
    switch (nombre) {
      case 'resumen_tienda': {
        const plan = planVigente(t);
        const visibles = productos.filter((p) => p.estado !== 'oculto');
        const hace = (d: number) => Date.now() - d * 864e5;
        const ventas = (d: number) => pedidos.filter((p) => ['pagado', 'entregado'].includes(p.estado) && Date.parse(p.createdAt) >= hace(d));
        const suma = (l: Record<string, any>[]) => l.reduce((s, p) => s + (p.total || 0), 0) / 100;
        return {
          tienda: t.nombre, pais: t.pais === 'US' ? 'US' : 'PE', plan: PLANES[plan].nombre, limite_productos: PLANES[plan].limite ?? 'ilimitado', tipo_cambio: t.tipoCambio ?? null, descuento_yape_o_efectivo: t.descuentoContado ?? 0,
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
      case 'proponer_cambios': {
        propuesta = limpiarPropuesta(input, mapaProd, mapaPed);
        const n = propuesta.productos.length + propuesta.pedidos.length;
        return n
          ? { ok: true, cambios: n, nota: 'Propuesta enviada a la vendedora. Aún NO está aplicada: debe revisarla y tocar Aplicar.' }
          : { ok: false, nota: 'Ningún cambio era válido o todos ya tenían ese valor.' };
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
  const system = [{ text: instrucciones(t, new Date().toLocaleDateString('es-PE', { timeZone: 'America/Lima', dateStyle: 'full' })) + textoSel }];

  let texto = '';
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
    if (res.stopReason !== 'tool_use' || !usos.length) break;
    const resultados: ContentBlock[] = usos.map((c) => {
      let salida: unknown;
      try { salida = ejecutar(c.toolUse!.name!, (c.toolUse!.input || {}) as Record<string, any>); }
      catch (e) { salida = { error: (e as Error).message }; }
      return { toolResult: { toolUseId: c.toolUse!.toolUseId!, content: [{ json: salida as any }] } };
    });
    messages.push({ role: 'user', content: resultados });
  }

  return JSON.stringify({ texto: texto || 'Listo.', propuesta });
};
