// Instrucciones y herramientas del asistente de la vendedora.
// La vista previa usa una copia de este texto: si cambias algo aquí, cámbialo también allá.

export const LIMITE_DIARIO: Record<string, number> = { free: 15, basico: 60, pro: 200, plus: 1000 };

export function instrucciones(t: { nombre?: string; tipoCambio?: number | null; descuentoContado?: number | null; pais?: string | null; moneda?: string | null }, hoy: string): string {
  const us = t.pais === 'US';
  const pen = !us && t.moneda === 'PEN';
  return `Eres el asistente de la tienda "${t.nombre || 'la tienda'}", ${us ? 'de una vendedora en Estados Unidos que vende ropa, zapatos, carteras y otros productos a clientes de EE. UU. por internet y WhatsApp' : 'de una vendedora en Perú que vende ropa, zapatos, carteras y otros productos (muchos traídos de Estados Unidos) en ferias, mercados y por WhatsApp'}. Hoy es ${hoy}.
Cómo trabajas:
- Responde en español sencillo, corto y amable, como un mensaje de WhatsApp. Nada de jerga técnica.
- Usa las herramientas para saber cualquier dato de la tienda; nunca inventes productos, precios ni pedidos.
${us ? '- Es una tienda de EE. UU.: los precios están en dólares (USD) y se cobran en dólares. No uses soles, Yape ni tipo de cambio.\n- Sus clientes son de EE. UU. y ven la tienda en inglés: escribe los NOMBRES y DESCRIPCIONES de productos en inglés. A la vendedora le hablas en español.' : (pen ? `- Los precios de esta tienda están en SOLES (S/). El costo de la etiqueta está en dólares: para comparar, conviértelo con el tipo de cambio ${t.tipoCambio || 'de la tienda'}.` : `- Los precios se guardan en dólares (USD). Para mostrar soles usa el tipo de cambio ${t.tipoCambio || 'de la tienda'} y redondea al sol.`)}
- Tú no ves las fotos: los nombres los puso la IA y pueden ser distintos a como la vendedora los llama. Si encuentras menos productos de los que ella menciona, NO digas que no existen: busca otra vez con otras palabras (singular, sinónimos, la categoría) o sin filtros y revisa los nombres. Si aún faltan, dile cuáles encontraste y pídele que toque el botón "Editar varios", toque cada producto en su lista y te vuelva a escribir.
- Si la vendedora tiene productos marcados en su lista, te los paso abajo. Cuando diga "estos", "los marcados", "los seleccionados" o un número que coincida, usa esos.
${us ? '' : `- Precio con Yape o efectivo: ${t.descuentoContado ? `la tienda da ${t.descuentoContado} % de descuento si pagan con Yape o efectivo (soles × (1 − ${t.descuentoContado}/100), redondeado al sol); con tarjeta se cobra el precio normal` : 'esta tienda no tiene descuento por Yape o efectivo'}. Ese porcentaje solo lo cambia la vendedora en Datos de la tienda; tú no puedes cambiarlo, solo explicárselo.\n`}- El "costo" es lo que pagó la vendedora; es privado y sirve para calcular márgenes.
- Para CUALQUIER cambio (precios, descripciones, marca, cantidad, estado, condición (nuevo, usado, caja abierta…), categoría, talla, nombre, o el estado de un pedido) usa la herramienta proponer_cambios. Tú no cambias nada directamente: la vendedora revisa la propuesta y toca "Aplicar". Después de proponer, explica en una frase qué propusiste y pídele que revise. Nunca digas que ya está cambiado.
- Precios con margen: ${pen ? `precio en soles = costo (USD) × ${t.tipoCambio || 'tipo de cambio'} × (1 + margen), redondeado hacia arriba al sol` : 'precio = costo × (1 + margen), redondeado hacia arriba al dólar'}.
- Descripciones: 1 o 2 frases útiles para vender, solo con datos que tengas (nombre, marca, talla, categoría, condición, descripción actual). No inventes materiales, medidas ni que es original si no lo sabes.
- Si piden algo que afecta muchos productos, primero búscalos y luego propone todo en una sola propuesta.
- Si te piden algo que no tiene que ver con la tienda, dilo con amabilidad y ofrece ayuda con la tienda.`;
}

type Esquema = { type: 'object'; properties: Record<string, unknown>; required?: string[] };
export const HERRAMIENTAS: { name: string; description: string; schema: Esquema }[] = [
  {
    name: 'resumen_tienda',
    description: 'Resumen de la tienda: plan y límite, productos visibles, sin precio, sin descripción, agotados, con poco stock, pedidos por confirmar y por entregar, y ventas pagadas de los últimos 7 y 30 días.',
    schema: { type: 'object', properties: {} },
  },
  {
    name: 'buscar_productos',
    description: 'Busca productos de la tienda. Devuelve hasta 60 con id, nombre, marca, precio (en la moneda de la tienda), costo (USD), stock, talla, categoría, público, estado y descripción. El texto busca por palabras (sin importar tildes ni plural). Sin filtros devuelve los más recientes.',
    schema: {
      type: 'object',
      properties: {
        texto: { type: 'string', description: 'Palabras en nombre, marca, categoría o descripción' },
        categoria: { type: 'string' },
        marca: { type: 'string' },
        estado: { type: 'string', enum: ['disponible', 'apartado', 'vendido', 'oculto'] },
        sin_precio: { type: 'boolean' },
        sin_descripcion: { type: 'boolean' },
        stock_maximo: { type: 'number', description: 'Solo productos con stock menor o igual a este número' },
      },
    },
  },
  {
    name: 'listar_pedidos',
    description: 'Pedidos en línea (tarjeta o Yape). Devuelve id, fecha, cliente, productos, total, método, código de operación y estado.',
    schema: {
      type: 'object',
      properties: {
        estado: { type: 'string', enum: ['por_confirmar', 'pagado', 'entregado', 'cancelado', 'pendiente'] },
        dias: { type: 'number', description: 'Solo pedidos de los últimos N días' },
      },
    },
  },
  {
    name: 'proponer_cambios',
    description: 'Propone cambios para que la vendedora los revise y apruebe. No aplica nada. Usa los id que devolvieron las otras herramientas.',
    schema: {
      type: 'object',
      properties: {
        resumen: { type: 'string', description: 'Una frase: qué se propone y por qué' },
        productos: {
          type: 'array',
          description: 'Cambios a productos (máximo 100)',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              precio: { type: 'number' }, costo: { type: 'number' }, stock: { type: 'number' },
              descripcion: { type: 'string' }, marca: { type: 'string' }, nombre: { type: 'string' },
              talla: { type: 'string' }, categoria: { type: 'string' },
              estado: { type: 'string', enum: ['disponible', 'apartado', 'vendido', 'oculto'] },
              condicion: { type: 'string', enum: ['nuevo_etiqueta', 'nuevo', 'caja_abierta', 'como_nuevo', 'usado'], description: 'Nuevo con etiqueta, nuevo sin etiqueta, caja abierta, usado como nuevo o usado' },
            },
            required: ['id'],
          },
        },
        pedidos: {
          type: 'array',
          description: 'Cambios de estado de pedidos',
          items: {
            type: 'object',
            properties: { id: { type: 'string' }, estado: { type: 'string', enum: ['pagado', 'entregado', 'cancelado'] } },
            required: ['id', 'estado'],
          },
        },
      },
      required: ['resumen'],
    },
  },
];

const CAMPOS_PRODUCTO = ['precio', 'costo', 'stock', 'descripcion', 'marca', 'nombre', 'talla', 'categoria', 'estado', 'condicion'] as const;
const CONDICIONES = ['nuevo_etiqueta', 'nuevo', 'caja_abierta', 'como_nuevo', 'usado'];

/** Deja solo cambios válidos sobre productos y pedidos que existen en esta tienda. */
export function limpiarPropuesta(
  p: Record<string, any>,
  productos: Map<string, Record<string, any>>,
  pedidos: Map<string, Record<string, any>>,
) {
  const prods = (Array.isArray(p.productos) ? p.productos : []).slice(0, 100).flatMap((c: Record<string, any>) => {
    const actual = productos.get(String(c.id)); if (!actual) return [];
    const campos: Record<string, unknown> = {};
    for (const k of CAMPOS_PRODUCTO) {
      if (c[k] === undefined || c[k] === null) continue;
      let v = c[k];
      if (k === 'precio' || k === 'costo') { v = Number(v); if (!(v >= 0 && v < 100000)) continue; v = Math.round((v as number) * 100) / 100; }
      else if (k === 'stock') { v = Math.floor(Number(v)); if (!(v >= 0 && v < 100000)) continue; }
      else v = String(v).trim().slice(0, k === 'descripcion' ? 600 : 120);
      if (k === 'condicion' && !CONDICIONES.includes(v as string)) continue;
      if (actual[k] !== v) campos[k] = v;
    }
    if (!Object.keys(campos).length) return [];
    const antes = Object.fromEntries(Object.keys(campos).map((k) => [k, actual[k] ?? null]));
    return [{ id: actual.id, nombre: actual.nombre, campos, antes }];
  });
  const peds = (Array.isArray(p.pedidos) ? p.pedidos : []).slice(0, 100).flatMap((c: Record<string, any>) => {
    const actual = pedidos.get(String(c.id));
    if (!actual || !['pagado', 'entregado', 'cancelado'].includes(c.estado) || actual.estado === c.estado) return [];
    return [{ id: actual.id, cliente: actual.cliente || '', estado: c.estado, antes: actual.estado, metodo: actual.metodo || '' }];
  });
  return { resumen: String(p.resumen || '').slice(0, 300), productos: prods, pedidos: peds };
}

const normTxt = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const raizTxt = (w: string) => (w.length > 4 && w.endsWith('es') ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w);
/** Busca por palabras: sin tildes, singular o plural; primero todas las palabras y, si no hay nada, cualquiera. */
export function buscarTexto<T extends Record<string, any>>(lista: T[], texto: unknown): T[] {
  const ps = normTxt(texto).split(/[^a-z0-9ñ]+/).filter((w) => w.length > 1).map(raizTxt);
  if (!ps.length) return lista;
  const pajar = (p: T) => normTxt([p.nombre, p.marca, p.categoria, p.descripcion, p.talla, p.publico].join(' '));
  const todas = lista.filter((p) => { const h = pajar(p); return ps.every((w) => h.includes(w)); });
  return todas.length ? todas : lista.filter((p) => { const h = pajar(p); return ps.some((w) => h.includes(w)); });
}
