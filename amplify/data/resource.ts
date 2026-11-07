import { type ClientSchema, a, defineData } from '@aws-amplify/backend';
import { clasificar } from '../functions/clasificar/resource';
import { catalogo } from '../functions/catalogo/resource';

/**
 * Aislamiento por vendedora:
 * - Tienda y Producto usan allow.owner(): cada vendedora solo lee y escribe lo suyo.
 * - SUPERADMIN (la dueña de la plataforma) ve y administra todo.
 * - "estado" de la tienda solo lo cambia SUPERADMIN (la vendedora solo lo lee).
 * - Los clientes no leen las tablas: usan la consulta "catalogo", que solo
 *   devuelve vitrinas aprobadas.
 */
const schema = a.schema({
  Tienda: a
    .model({
      // id = enlace público de la vitrina (ej. "maria")
      nombre: a.string().required(),
      email: a.string(),
      whatsapp: a.string(),
      tipoCambio: a.float(),
      estado: a
        .enum(['pendiente', 'aprobada', 'suspendida'])
        .authorization((allow) => [allow.owner().to(['read']), allow.group('SUPERADMIN')]),
    })
    .authorization((allow) => [allow.owner(), allow.group('SUPERADMIN')]),

  Producto: a
    .model({
      tiendaId: a.string().required(),
      nombre: a.string().required(),
      precio: a.float(),
      categoria: a.string(),
      publico: a.string(),
      descripcion: a.string(),
      estado: a.enum(['disponible', 'apartado', 'vendido']),
      fotosFull: a.string().array(),
      fotosThumb: a.string().array(),
      creado: a.float(),
    })
    .secondaryIndexes((index) => [index('tiendaId').name('byTienda')])
    .authorization((allow) => [allow.owner(), allow.group('SUPERADMIN')]),

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
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'userPool',
  },
});
