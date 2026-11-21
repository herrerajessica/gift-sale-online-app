import { defineBackend } from '@aws-amplify/backend';
import { Stack } from 'aws-cdk-lib';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { FunctionUrlAuthType } from 'aws-cdk-lib/aws-lambda';
import { CachePolicy, Distribution, ResponseHeadersPolicy, ViewerProtocolPolicy } from 'aws-cdk-lib/aws-cloudfront';
import { S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { auth } from './auth/resource';
import { preSignUp } from './auth/pre-sign-up/resource';
import { data } from './data/resource';
import { storage } from './storage/resource';
import { clasificar } from './functions/clasificar/resource';
import { catalogo } from './functions/catalogo/resource';
import { pagos } from './functions/pagos/resource';
import { stripeWebhook } from './functions/stripe-webhook/resource';
import { fondo } from './functions/fondo/resource';
import { asistente } from './functions/asistente/resource';
import { confianza } from './functions/confianza/resource';
import { clientes } from './functions/clientes/resource';

const backend = defineBackend({ auth, data, storage, clasificar, catalogo, pagos, stripeWebhook, fondo, asistente, confianza, clientes, preSignUp });

const bucket = backend.storage.resources.bucket;
const tablas = backend.data.resources.tables;
const tablaTienda = tablas['Tienda'];
const tablaProducto = tablas['Producto'];
const tablaPedido = tablas['Pedido'];
const tablaConfianza = tablas['Confianza'];
const tablaReventa = tablas['Reventa'];
const tablaCliente = tablas['Cliente'];

// CDN para que las fotos carguen rápido y sin URLs firmadas.
// Se crea en el mismo stack del bucket para evitar referencias circulares.
const cdn = new Distribution(Stack.of(bucket), 'FotosCdn', {
  comment: 'Showroomcito - fotos de productos',
  defaultBehavior: {
    origin: S3BucketOrigin.withOriginAccessControl(bucket),
    viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    cachePolicy: CachePolicy.CACHING_OPTIMIZED,
    // CORS: la web puede leer las miniaturas para comparar fotos repetidas.
    responseHeadersPolicy: ResponseHeadersPolicy.CORS_ALLOW_ALL_ORIGINS,
  },
});

// --- Catálogo público: lee las tablas (solo lectura) ---
const catalogoFn = backend.catalogo.resources.lambda;
// Lectura y escritura en Tienda: el asistente de clientes cuenta los mensajes del día (límite por plan).
tablaTienda.grantReadWriteData(catalogoFn);
tablaProducto.grantReadData(catalogoFn);
catalogoFn.addToRolePolicy(new PolicyStatement({
  actions: ['dynamodb:Query'],
  resources: [`${tablaProducto.tableArn}/index/*`],
}));
backend.catalogo.addEnvironment('TIENDA_TABLE', tablaTienda.tableName);
backend.catalogo.addEnvironment('PRODUCTO_TABLE', tablaProducto.tableName);
// Productos de tiendas de confianza: el catálogo verifica que la relación siga activa.
tablaConfianza.grantReadData(catalogoFn);
backend.catalogo.addEnvironment('CONFIANZA_TABLE', tablaConfianza.tableName);
// Asistente de compras de los clientes: Bedrock (Nova 2 Lite; Claude Haiku si se cambia MODEL_ID)
catalogoFn.addToRolePolicy(new PolicyStatement({
  actions: ['bedrock:InvokeModel'],
  resources: [
    'arn:aws:bedrock:*::foundation-model/amazon.nova-2-lite*',
    'arn:aws:bedrock:::foundation-model/amazon.nova-2-lite*',
    'arn:aws:bedrock:*:*:inference-profile/global.amazon.nova-2-lite*',
    'arn:aws:bedrock:*:*:inference-profile/us.amazon.nova-2-lite*',
    'arn:aws:bedrock:*::foundation-model/anthropic.claude-haiku-5-5*',
    'arn:aws:bedrock:*:*:inference-profile/global.anthropic.claude-haiku-5-5*',
  ],
}));

// --- Pagos: crea sesiones de Stripe y pedidos ---
const pagosFn = backend.pagos.resources.lambda;
tablaTienda.grantReadWriteData(pagosFn);
tablaProducto.grantReadData(pagosFn);
tablaPedido.grantWriteData(pagosFn);
backend.pagos.addEnvironment('TIENDA_TABLE', tablaTienda.tableName);
backend.pagos.addEnvironment('PRODUCTO_TABLE', tablaProducto.tableName);
backend.pagos.addEnvironment('PEDIDO_TABLE', tablaPedido.tableName);
tablaConfianza.grantReadData(pagosFn);
backend.pagos.addEnvironment('CONFIANZA_TABLE', tablaConfianza.tableName);

// --- Webhook de Stripe: URL pública protegida por la firma de Stripe ---
const webhookFn = backend.stripeWebhook.resources.lambda;
tablaTienda.grantReadWriteData(webhookFn);
tablaPedido.grantReadWriteData(webhookFn);
tablaProducto.grantReadWriteData(webhookFn);
backend.stripeWebhook.addEnvironment('TIENDA_TABLE', tablaTienda.tableName);
backend.stripeWebhook.addEnvironment('PEDIDO_TABLE', tablaPedido.tableName);
backend.stripeWebhook.addEnvironment('PRODUCTO_TABLE', tablaProducto.tableName);
// Venta con tarjeta de un producto de confianza: baja la cantidad del original y anota la deuda.
tablaReventa.grantReadWriteData(webhookFn);
backend.stripeWebhook.addEnvironment('REVENTA_TABLE', tablaReventa.tableName);
const webhookUrl = webhookFn.addFunctionUrl({ authType: FunctionUrlAuthType.NONE });

backend.addOutput({
  custom: {
    fotosUrl: `https://${cdn.distributionDomainName}`,
    stripeWebhookUrl: webhookUrl.url,
  },
});

// --- Fondo blanco: lee la foto y llama a Nova Canvas en Bedrock ---
const fondoFn = backend.fondo.resources.lambda;
bucket.grantRead(fondoFn, 'productos/*');
tablaTienda.grantReadData(fondoFn);
backend.fondo.addEnvironment('BUCKET_NAME', bucket.bucketName);
backend.fondo.addEnvironment('TIENDA_TABLE', tablaTienda.tableName);
fondoFn.addToRolePolicy(new PolicyStatement({
  actions: ['bedrock:InvokeModel'],
  resources: ['arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-canvas-v1:0'],
}));

// --- Asistente: lee productos y pedidos de la tienda; solo escribe su contador de uso ---
const asistenteFn = backend.asistente.resources.lambda;
tablaTienda.grantReadWriteData(asistenteFn);
tablaProducto.grantReadData(asistenteFn);
tablaPedido.grantReadData(asistenteFn);
asistenteFn.addToRolePolicy(new PolicyStatement({
  actions: ['dynamodb:Query'],
  resources: [`${tablaProducto.tableArn}/index/*`, `${tablaPedido.tableArn}/index/*`],
}));
backend.asistente.addEnvironment('TIENDA_TABLE', tablaTienda.tableName);
backend.asistente.addEnvironment('PRODUCTO_TABLE', tablaProducto.tableName);
backend.asistente.addEnvironment('PEDIDO_TABLE', tablaPedido.tableName);
asistenteFn.addToRolePolicy(new PolicyStatement({
  actions: ['bedrock:InvokeModel'],
  resources: [
    // Perfil global: puede atender desde cualquier región, por eso el modelo va sin región fija.
    'arn:aws:bedrock:*::foundation-model/anthropic.claude-haiku-5-5*',
    'arn:aws:bedrock:::foundation-model/anthropic.claude-haiku-5-5*',
    'arn:aws:bedrock:*:*:inference-profile/global.anthropic.claude-haiku-5-5*',
    'arn:aws:bedrock:*:*:inference-profile/us.anthropic.claude-haiku-5-5*',
    // Amazon Nova 2 Lite (versión de prueba)
    'arn:aws:bedrock:*::foundation-model/amazon.nova-2-lite*',
    'arn:aws:bedrock:::foundation-model/amazon.nova-2-lite*',
    'arn:aws:bedrock:*:*:inference-profile/global.amazon.nova-2-lite*',
    'arn:aws:bedrock:*:*:inference-profile/us.amazon.nova-2-lite*',
  ],
}));

// --- Clasificación con IA: lee miniaturas y llama a Claude en Bedrock ---
const clasificarFn = backend.clasificar.resources.lambda;
bucket.grantRead(clasificarFn, 'productos/*');
backend.clasificar.addEnvironment('BUCKET_NAME', bucket.bucketName);
clasificarFn.addToRolePolicy(new PolicyStatement({
  actions: ['bedrock:InvokeModel'],
  resources: [
    // Perfil global: puede atender desde cualquier región, por eso el modelo va sin región fija.
    'arn:aws:bedrock:*::foundation-model/anthropic.claude-haiku-5-5*',
    'arn:aws:bedrock:::foundation-model/anthropic.claude-haiku-5-5*',
    'arn:aws:bedrock:*:*:inference-profile/global.anthropic.claude-haiku-5-5*',
    'arn:aws:bedrock:*:*:inference-profile/us.anthropic.claude-haiku-5-5*',
    // Amazon Nova 2 Lite (versión de prueba)
    'arn:aws:bedrock:*::foundation-model/amazon.nova-2-lite*',
    'arn:aws:bedrock:::foundation-model/amazon.nova-2-lite*',
    'arn:aws:bedrock:*:*:inference-profile/global.amazon.nova-2-lite*',
    'arn:aws:bedrock:*:*:inference-profile/us.amazon.nova-2-lite*',
  ],
}));

// --- Tiendas de confianza: relaciones, productos compartidos y cuentas entre vendedoras ---
const confianzaFn = backend.confianza.resources.lambda;
tablaTienda.grantReadData(confianzaFn);
tablaProducto.grantReadWriteData(confianzaFn);
tablaConfianza.grantReadWriteData(confianzaFn);
tablaReventa.grantReadWriteData(confianzaFn);
confianzaFn.addToRolePolicy(new PolicyStatement({
  actions: ['dynamodb:Query'],
  resources: [`${tablaProducto.tableArn}/index/*`, `${tablaConfianza.tableArn}/index/*`, `${tablaReventa.tableArn}/index/*`],
}));
backend.confianza.addEnvironment('TIENDA_TABLE', tablaTienda.tableName);
backend.confianza.addEnvironment('PRODUCTO_TABLE', tablaProducto.tableName);
backend.confianza.addEnvironment('CONFIANZA_TABLE', tablaConfianza.tableName);
backend.confianza.addEnvironment('REVENTA_TABLE', tablaReventa.tableName);

// --- Cuentas de clientes ("Mis pedidos" con código por correo) ---
const clientesFn = backend.clientes.resources.lambda;
tablaTienda.grantReadData(clientesFn);
tablaCliente.grantReadWriteData(clientesFn);
tablaPedido.grantReadData(clientesFn);
clientesFn.addToRolePolicy(new PolicyStatement({ actions: ['dynamodb:Query'], resources: [`${tablaPedido.tableArn}/index/*`] }));
backend.clientes.addEnvironment('TIENDA_TABLE', tablaTienda.tableName);
backend.clientes.addEnvironment('CLIENTE_TABLE', tablaCliente.tableName);
backend.clientes.addEnvironment('PEDIDO_TABLE', tablaPedido.tableName);
// Cada pedido con correo (Yape o tarjeta) agrega al cliente a "Mis clientes" de la vendedora.
tablaCliente.grantReadWriteData(pagosFn);
backend.pagos.addEnvironment('CLIENTE_TABLE', tablaCliente.tableName);
tablaCliente.grantReadWriteData(webhookFn);
backend.stripeWebhook.addEnvironment('CLIENTE_TABLE', tablaCliente.tableName);

// --- Pre sign-up (Google): buscar la cuenta con el mismo correo y enlazarla ---
// Sin el ARN exacto del grupo de usuarios para no crear una dependencia circular (el grupo usa esta función).
const preSignUpFn = backend.preSignUp.resources.lambda;
preSignUpFn.addToRolePolicy(new PolicyStatement({
  actions: ['cognito-idp:ListUsers', 'cognito-idp:AdminLinkProviderForUser'],
  resources: [`arn:aws:cognito-idp:${Stack.of(preSignUpFn).region}:${Stack.of(preSignUpFn).account}:userpool/*`],
}));
