import { defineAuth } from '@aws-amplify/backend';

/**
 * Vendedoras: se registran con su correo (código de verificación por email).
 * SUPERADMIN: la dueña de la plataforma; aprueba o suspende vitrinas.
 * Clientes: navegan sin cuenta (invitados del Identity Pool).
 */
export const auth = defineAuth({
  loginWith: {
    email: {
      verificationEmailSubject: 'Tu código para Vitrina USA',
      verificationEmailBody: (code) => `Tu código de verificación es ${code()}`,
    },
  },
  groups: ['SUPERADMIN'],
});
