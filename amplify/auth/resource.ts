import { defineAuth, secret } from '@aws-amplify/backend';

/**
 * Vendedoras: se registran con su correo (código de verificación por email)
 * o con su cuenta de Google.
 * SUPERADMIN: la dueña de la plataforma; aprueba o suspende vitrinas.
 * Clientes: navegan sin cuenta (invitados del Identity Pool).
 *
 * "Continuar con Google" se activa con la variable de entorno GOOGLE_LOGIN=si
 * en Amplify, después de guardar los secretos GOOGLE_CLIENT_ID y
 * GOOGLE_CLIENT_SECRET (así el primer despliegue no falla si aún no existen).
 * SITE_URL es la URL de la app (ej. https://main.d123.amplifyapp.com).
 */
const conGoogle = process.env.GOOGLE_LOGIN === 'si';
const sitio = (process.env.SITE_URL || '').replace(/\/$/, '');
const urls = ['http://localhost:5173/', ...(sitio ? [`${sitio}/`] : [])];

export const auth = defineAuth({
  loginWith: {
    email: {
      verificationEmailSubject: 'Tu código para Vitrina USA',
      verificationEmailBody: (code) => `Tu código de verificación es ${code()}`,
    },
    ...(conGoogle
      ? {
          externalProviders: {
            google: {
              clientId: secret('GOOGLE_CLIENT_ID'),
              clientSecret: secret('GOOGLE_CLIENT_SECRET'),
              scopes: ['email', 'profile', 'openid'],
              attributeMapping: { email: 'email' },
            },
            callbackUrls: urls,
            logoutUrls: urls,
          },
        }
      : {}),
  },
  groups: ['SUPERADMIN'],
});
