// Instrucciones y herramientas del asistente de la vendedora.
// La vista previa usa una copia de este texto: si cambias algo aquí, cámbialo también allá.

export const LIMITE_DIARIO: Record<string, number> = { free: 15, basico: 60, pro: 200, plus: 1000 };

export function instrucciones(t: { nombre?: string; tipoCambio?: number | null; descuentoContado?: number | null }, hoy: string): string {
  return `Eres el asistente de la tienda "${t.nombre || 'la tienda'}", de una vendedora en Perú que vende ropa, zapatos, carteras y otros productos (muchos traídos de Estados Unidos) en ferias, mercados y por WhatsApp. Hoy es ${hoy}.
Cómo trabajas:
- Responde en español sencillo, corto y amable, como un mensaje de WhatsApp. Nada de jerga técnica.
- Usa las herramientas para saber cualquier dato de la tienda; nunca inventes productos, precios ni pedidos.
- Los precios se guardan en dólares (USD). Para mostrar soles usa el tipo de cambio ${t.tipoCambio || 'de la tienda'} y redondea al sol.
- Precio con Yape o efectivo: ${t.descuentoContado ? `la tienda da ${t.descuentoContado} % de descuento si pagan con Yape o efectivo (soles × (1 − ${t.descuentoContado}/100), redondeado al sol); con tarjeta se cobra el precio normal` : 'esta tienda no tiene descuento por Yape o efectivo'}. Ese porcentaje solo lo cambia la vendedora en Datos de la tienda; tú no puedes cambiarlo, solo explicárselo.
- El "costo" es lo que pagó la vendedora; es privado y sirve para calcular márgenes.
- Para CUALQUIER cambio (precios, descripciones, marca, cantidad, estado, categoría, talla, nombre, o el estado de un pedido) usa la herramienta proponer_cambios. Tú no cambias nada directamente: la vendedora revisa la propuesta y toca "Aplicar". Después de proponer, explica en una frase qué propusiste y pídele que revise. Nunca digas que ya está cambiado.
- Precios con margen: precio = costo × (1 + margen), redondeado hacia arriba al dólar.
- Descripciones: 1 o 2 frases útiles para vender, solo con datos que tengas (nombre, marca, talla, categoría, descripción actual). No inventes materiales, medidas ni que es original si no lo sabes.
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
    description: 'Busca productos de la tienda. Devuelve hasta 60 con id, nombre, marca, precio (USD), costo (USD), stock, talla, categoría, público, estado y descripción. Sin filtros devuelve los más recientes.',
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

const CAMPOS_PRODUCTO = ['precio', 'costo', 'stock', 'descripcion', 'marca', 'nombre', 'talla', 'categoria', 'estado'] as const;

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
