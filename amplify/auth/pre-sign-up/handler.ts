// Cognito "Pre sign-up": se ejecuta antes de crear una cuenta.
// - Cuentas con correo y contraseña: no se toca nada.
// - Primera vez con Google: si ya hay una cuenta con ese correo, se enlaza Google a esa cuenta
//   (mismo usuario, misma tienda). Cognito igual responde con un error esa primera vez
//   ("Already found an entry…"); la web reintenta sola y ya entra a la cuenta enlazada.
import {
  AdminLinkProviderForUserCommand, CognitoIdentityProviderClient, ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider';

const cognito = new CognitoIdentityProviderClient({});

type Evento = {
  triggerSource: string;
  userPoolId: string;
  userName: string;
  request: { userAttributes: Record<string, string> };
  response: { autoConfirmUser?: boolean; autoVerifyEmail?: boolean };
};

export const handler = async (event: Evento) => {
  if (event.triggerSource !== 'PreSignUp_ExternalProvider') return event;

  const email = String(event.request.userAttributes.email || '').trim().toLowerCase();
  // userName llega como "google_1234567890": proveedor + id en ese proveedor
  const [prov, ...resto] = String(event.userName || '').split('_');
  const idProveedor = resto.join('_');
  if (!email || !idProveedor) return event;
  const proveedor = prov.toLowerCase() === 'google' ? 'Google' : prov;

  const { Users = [] } = await cognito.send(new ListUsersCommand({
    UserPoolId: event.userPoolId, Filter: `email = "${email.replace(/"/g, '')}"`, Limit: 10,
  }));
  // Una cuenta propia (no de Google) con ese correo
  const nativa = Users.find((u) => u.UserStatus !== 'EXTERNAL_PROVIDER' && u.Username && !/^google_/i.test(u.Username));
  if (nativa) {
    await cognito.send(new AdminLinkProviderForUserCommand({
      UserPoolId: event.userPoolId,
      DestinationUser: { ProviderName: 'Cognito', ProviderAttributeValue: nativa.Username },
      SourceUser: { ProviderName: proveedor, ProviderAttributeName: 'Cognito_Subject', ProviderAttributeValue: idProveedor },
    }));
    console.log('Google enlazado a la cuenta existente', nativa.Username);
  }
  // Google ya verificó el correo
  event.response.autoConfirmUser = true;
  event.response.autoVerifyEmail = true;
  return event;
};
