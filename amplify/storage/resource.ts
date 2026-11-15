import { defineStorage } from '@aws-amplify/backend';

/**
 * Cada vendedora sube y borra solo dentro de su propia carpeta
 * productos/<su identityId>/. Los clientes ven las fotos por CloudFront.
 */
export const storage = defineStorage({
  name: 'vitrinaFotos',
  access: (allow) => ({
    'productos/{entity_id}/*': [
      allow.entity('identity').to(['read', 'write', 'delete']),
      // La dueña también vende en su propia tienda: al estar en el grupo SUPERADMIN, AWS le da
      // el rol del grupo en vez del de vendedora, así que el grupo necesita poder subir fotos.
      allow.groups(['SUPERADMIN']).to(['read', 'write', 'delete']),
    ],
  }),
});
