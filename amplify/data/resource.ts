import { type ClientSchema, a, defineData } from '@aws-amplify/backend';
import { clasificar } from '../functions/clasificar/resource';
import { catalogo } from '../functions/catalogo/resource';
import { pagos } from '../functions/pagos/resource';
import { fondo } from '../functions/fondo/resource';
import { asistente } from '../functions/asistente/resource';
import { confianza } from '../functions/confianza/resource';

/**
 * Aislamiento por vendedora:
 * - Tienda, Producto y Pedido usan allow.owner(): cada vendedora solo lee lo suyo.
 * - SUPERADMIN (la dueña de la plataforma) ve y administra todo.
 * - Estado de aprobación, plan y datos de Stripe solo los cambia SUPERADMIN
 *   o el webhook de Stripe; la vendedora solo los lee.
 * - Los clientes no leen las tablas: usan la consulta "catalogo", que solo
 *   devuelve vitrinas aprobadas y respeta el límite del plan.
 */
const soloLecturaDueña = (allow: any) => [allow.owner().to(['read']), allow.group('SUPERADMIN')];

const schema = a.schema({
  Tienda: a
    .model({
      // id = enlace público de la vitrina (ej. "maria"). Se declara explícito porque la tabla tiene
      // permisos por campo: sin esto, AppSync rechaza crear o editar la tienda con "Unauthorized on [id]".
      id: a.id().required(),
      nombre: a.string().required(),
      email: a.string(),
      whatsapp: a.string(),
      tipoCambio: a.float(),
      // Pago con Yape (QR): lo configura la vendedora
      yapeNumero: a.string(),
      yapeNombre: a.string(),
      yapeQr: a.string(),       // ruta de la imagen del QR en S3
      // Descuento (%) por pagar con Yape o efectivo; el precio normal es el de tarjeta
      descuentoContado: a.float(),
      // Tiendas de confianza: cuántos días puede durar un separado de los productos de esta tienda (por defecto 7)
      diasSeparado: a.integer(),
      // Enlace del grupo de WhatsApp de ventas (https://chat.whatsapp.com/...): la tienda muestra "Únete a mi grupo"
      grupoWhatsapp: a.string(),
      // País de la tienda: PE (soles, Yape, tienda en español) o US (solo dólares, tienda del cliente en inglés)
      pais: a.enum(['PE', 'US']),
      // Moneda de los precios: PEN (soles, tiendas de Perú) o USD. Sin valor = USD (tiendas antiguas).
      moneda: a.enum(['USD', 'PEN']),
      // Texto y no enum: Amplify no permite permisos por campo en un enum. Valores: pendiente | aprobada | suspendida
      estado: a.string().authorization(soloLecturaDueña),
      // Plan: free (10), basico (30), pro (150), plus (ilimitado)
      // Valores: free | basico | pro | plus (lo cambian SUPERADMIN o el webhook de Stripe)
      plan: a.string().authorization(soloLecturaDueña),
      planVence: a.float().authorization(soloLecturaDueña),
      planCancelado: a.boolean().authorization(soloLecturaDueña),
      stripeCustomerId: a.string().authorization(soloLecturaDueña),
      stripeSubscriptionId: a.string().authorization(soloLecturaDueña),
      stripeAccountId: a.string().authorization(soloLecturaDueña),
      cobrosActivos: a.boolean().authorization(soloLecturaDueña),
      // Uso del asistente por día (límite según el plan)
      asistenteDia: a.string().authorization(soloLecturaDueña),
      asistenteUsos: a.integer().authorization(soloLecturaDueña),
    })
    .authorization((allow) => [allow.owner(), allow.group('SUPERADMIN')]),

  Producto: a
    .model({
      tiendaId: a.string().required(),
      nombre: a.string().required(),
      marca: a.string(),
      precio: a.float(),
      stock: a.integer(),        // unidades disponibles; vacío = sin control de cantidad
      costo: a.float(),          // lo que pagó la vendedora (USD); privado: el catálogo público no lo devuelve
      talla: a.string(),
      // Condición: nuevo_etiqueta | nuevo | caja_abierta | como_nuevo | usado (vacío = sin indicar)
      condicion: a.string(),
      // Código corto para identificar el producto (ej. CAR-001): letras de la categoría + número.
      // Lo pone la app de la vendedora; no cambia aunque cambie la categoría.
      codigo: a.string(),
      huella: a.string(),        // huella visual de la foto principal, para detectar fotos repetidas
      categoria: a.string(),
      publico: a.string(),
      descripcion: a.string(),
      estado: a.enum(['disponible', 'apartado', 'vendido', 'oculto']),
      fotosFull: a.string().array(),
      fotosThumb: a.string().array(),
      creado: a.float(),
      // Tiendas de confianza: la dueña del producto lo comparte con sus tiendas de confianza
      // y fija cuánto le paga la revendedora por cada unidad (en la moneda de su tienda).
      compartido: a.boolean(),
      precioReventa: a.float(),
      // Oferta con fecha de fin: mientras ofertaHasta (fecha en ms) no pase, se cobra precioOferta; después, el precio normal.
      precioOferta: a.float(),
      ofertaHasta: a.float(),
      // Copia en la tienda de una revendedora: apunta al producto original y a su tienda.
      // Lo llena la función "confianza"; el catálogo y los pagos lo verifican en el servidor
      // y nunca lo muestran al cliente (para el cliente, el producto es de la revendedora).
      origenId: a.string(),
      origenTienda: a.string(),
    })
    .secondaryIndexes((index) => [index('tiendaId').name('byTienda')])
    .authorization((allow) => [allow.owner(), allow.group('SUPERADMIN')]),

  // Pedidos pagados en línea. Los crea la función "pagos".
  // Tarjeta: los confirma el webhook de Stripe. Yape: los confirma la vendedora.
  Pedido: a
    .model({
      tiendaId: a.string().required(),
      items: a.string(),          // JSON: [{id, nombre, q, precioUsd, monto}]
      total: a.integer(),         // en la unidad mínima de la moneda (céntimos)
      moneda: a.string(),
      comision: a.integer(),
      cliente: a.string(),
      email: a.string(),
      telefono: a.string(),
      nota: a.string(),
      metodo: a.enum(['tarjeta', 'yape']),
      operacion: a.string(),      // código de operación Yape que escribe el cliente
      estado: a.enum(['pendiente', 'por_confirmar', 'pagado', 'entregado', 'cancelado']),
      stripeSessionId: a.string(),
    })
    .secondaryIndexes((index) => [index('tiendaId').name('pedidosByTienda')])
    .authorization((allow) => [allow.owner().to(['read', 'update']), allow.group('SUPERADMIN')]),

  // Relación entre dos tiendas de confianza. id = "tiendaA|tiendaB" (en orden alfabético).
  // Solo la lee y escribe la función "confianza" (y SUPERADMIN); las vendedoras la ven a través de ella.
  Confianza: a
    .model({
      id: a.id().required(),
      tiendaA: a.string().required(),
      tiendaB: a.string().required(),
      invita: a.string().required(),     // tienda que envió la invitación
      estado: a.string().required(),     // pendiente | aceptada
    })
    .secondaryIndexes((index) => [index('tiendaA').name('confianzaByA'), index('tiendaB').name('confianzaByB')])
    .authorization((allow) => [allow.group('SUPERADMIN')]),

  // Venta de un producto ajeno: la revendedora le debe a la dueña el precio para revendedoras.
  // El pago entre ellas es por fuera (Yape, efectivo); la dueña lo marca como pagado.
  Reventa: a
    .model({
      duena: a.string().required(),        // tienda dueña del producto
      revendedora: a.string().required(),  // tienda que lo vendió
      productoId: a.string().required(),   // producto original
      copiaId: a.string(),
      nombre: a.string(),
      q: a.integer(),
      monto: a.float(),                    // lo que debe la revendedora, en la moneda de las tiendas
      moneda: a.string(),                  // PEN | USD
      via: a.string(),                     // tarjeta | yape | manual
      pedidoId: a.string(),
      estado: a.string(),                  // separado | debe | pagado | liberado
      hasta: a.float(),                    // separado: vence en esta fecha (según los días que fijó la dueña)
      cliente: a.string(),                 // separado: para quién (opcional)
      creado: a.float(),
    })
    .secondaryIndexes((index) => [index('duena').name('reventasByDuena'), index('revendedora').name('reventasByRevendedora')])
    .authorization((allow) => [allow.group('SUPERADMIN')]),

  // Tiendas de confianza: invitar, aceptar, compartir, revender y llevar las cuentas.
  confianza: a
    .mutation()
    .arguments({ tiendaId: a.string().required(), accion: a.string().required(), datos: a.string() })
    .returns(a.string())
    .handler(a.handler.function(confianza))
    .authorization((allow) => [allow.authenticated()]),

  catalogo: a
    .query()
    .arguments({ slug: a.string().required() })
    .returns(a.string())
    .handler(a.handler.function(catalogo))
    .authorization((allow) => [allow.guest(), allow.authenticated()]),

  clasificarFotos: a
    .query()
    .arguments({ paths: a.string().array().required(), idioma: a.string() })
    .returns(a.string())
    .handler(a.handler.function(clasificar))
    .authorization((allow) => [allow.authenticated()]),

  // Dictado por voz: convierte lo que dijo la vendedora (un texto por producto) en datos del producto
  interpretarDictado: a
    .query()
    .arguments({ textos: a.string().array().required(), idioma: a.string(), moneda: a.string() })
    .returns(a.string())
    .handler(a.handler.function(clasificar))
    .authorization((allow) => [allow.authenticated()]),

  // Asistente de la vendedora: Claude con herramientas; solo propone cambios
  asistente: a
    .mutation()
    .arguments({ tiendaId: a.string().required(), mensajes: a.string().required(), seleccion: a.string() })
    .returns(a.string())
    .handler(a.handler.function(asistente))
    .authorization((allow) => [allow.authenticated()]),

  // Foto con fondo blanco: quita el fondo con Nova Canvas (Bedrock)
  quitarFondo: a
    .mutation()
    .arguments({ tiendaId: a.string().required(), path: a.string().required() })
    .returns(a.string())
    .handler(a.handler.function(fondo))
    .authorization((allow) => [allow.authenticated()]),

  // --- Pagos (Stripe) ---
  pagarPlan: a
    .mutation()
    .arguments({ tiendaId: a.string().required(), plan: a.string().required(), origen: a.string().required() })
    .returns(a.string())
    .handler(a.handler.function(pagos))
    .authorization((allow) => [allow.authenticated()]),

  cancelarPlan: a
    .mutation()
    .arguments({ tiendaId: a.string().required() })
    .returns(a.string())
    .handler(a.handler.function(pagos))
    .authorization((allow) => [allow.authenticated()]),

  conectarCobros: a
    .mutation()
    .arguments({ tiendaId: a.string().required(), origen: a.string().required() })
    .returns(a.string())
    .handler(a.handler.function(pagos))
    .authorization((allow) => [allow.authenticated()]),

  estadoCobros: a
    .mutation()
    .arguments({ tiendaId: a.string().required() })
    .returns(a.string())
    .handler(a.handler.function(pagos))
    .authorization((allow) => [allow.authenticated()]),

  pedidoYape: a
    .mutation()
    .arguments({
      tiendaId: a.string().required(),
      items: a.string().required(),
      nombre: a.string().required(),
      email: a.string(),
      nota: a.string(),
      operacion: a.string(),
    })
    .returns(a.string())
    .handler(a.handler.function(pagos))
    .authorization((allow) => [allow.guest(), allow.authenticated()]),

  pagarPedido: a
    .mutation()
    .arguments({
      tiendaId: a.string().required(),
      items: a.string().required(),
      nombre: a.string(),
      nota: a.string(),
      origen: a.string().required(),
    })
    .returns(a.string())
    .handler(a.handler.function(pagos))
    .authorization((allow) => [allow.guest(), allow.authenticated()]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'userPool',
  },
});
