import { type ClientSchema, a, defineData } from '@aws-amplify/backend';
import { clasificar } from '../functions/clasificar/resource';
import { catalogo } from '../functions/catalogo/resource';
import { pagos } from '../functions/pagos/resource';
import { fondo } from '../functions/fondo/resource';
import { asistente } from '../functions/asistente/resource';

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
      // id = enlace público de la vitrina (ej. "maria")
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
      estado: a.enum(['pendiente', 'aprobada', 'suspendida']).authorization(soloLecturaDueña),
      // Plan: free (10), basico (30), pro (150), plus (ilimitado)
      plan: a.enum(['free', 'basico', 'pro', 'plus']).authorization(soloLecturaDueña),
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
      huella: a.string(),        // huella visual de la foto principal, para detectar fotos repetidas
      categoria: a.string(),
      publico: a.string(),
      descripcion: a.string(),
      estado: a.enum(['disponible', 'apartado', 'vendido', 'oculto']),
      fotosFull: a.string().array(),
      fotosThumb: a.string().array(),
      creado: a.float(),
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

  catalogo: a
    .query()
    .arguments({ slug: a.string().required() })
    .returns(a.string())
    .handler(a.handler.function(catalogo))
    .authorization((allow) => [allow.guest(), allow.authenticated()]),

  clasificarFotos: a
    .query()
    .arguments({ paths: a.string().array().required() })
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
