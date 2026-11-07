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
      allow.groups(['SUPERADMIN']).to(['read', 'delete']),
    ],
  }),
});
