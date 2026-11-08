import { defineBackend } from '@aws-amplify/backend';
import { Stack } from 'aws-cdk-lib';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { FunctionUrlAuthType } from 'aws-cdk-lib/aws-lambda';
import { CachePolicy, Distribution, ViewerProtocolPolicy } from 'aws-cdk-lib/aws-cloudfront';
import { S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { storage } from './storage/resource';
import { clasificar } from './functions/clasificar/resource';
import { catalogo } from './functions/catalogo/resource';
import { pagos } from './functions/pagos/resource';
import { stripeWebhook } from './functions/stripe-webhook/resource';

const backend = defineBackend({ auth, data, storage, clasificar, catalogo, pagos, stripeWebhook });

const bucket = backend.storage.resources.bucket;
const tablas = backend.data.resources.tables;
const tablaTienda = tablas['Tienda'];
const tablaProducto = tablas['Producto'];
const tablaPedido = tablas['Pedido'];

// CDN para que las fotos carguen rápido y sin URLs firmadas.
// Se crea en el mismo stack del bucket para evitar referencias circulares.
const cdn = new Distribution(Stack.of(bucket), 'FotosCdn', {
  comment: 'Vitrina USA - fotos de productos',
  defaultBehavior: {
    origin: S3BucketOrigin.withOriginAccessControl(bucket),
    viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    cachePolicy: CachePolicy.CACHING_OPTIMIZED,
  },
});

// --- Catálogo público: lee las tablas (solo lectura) ---
const catalogoFn = backend.catalogo.resources.lambda;
tablaTienda.grantReadData(catalogoFn);
tablaProducto.grantReadData(catalogoFn);
catalogoFn.addToRolePolicy(new PolicyStatement({
  actions: ['dynamodb:Query'],
  resources: [`${tablaProducto.tableArn}/index/*`],
}));
backend.catalogo.addEnvironment('TIENDA_TABLE', tablaTienda.tableName);
backend.catalogo.addEnvironment('PRODUCTO_TABLE', tablaProducto.tableName);

// --- Pagos: crea sesiones de Stripe y pedidos ---
const pagosFn = backend.pagos.resources.lambda;
tablaTienda.grantReadWriteData(pagosFn);
tablaProducto.grantReadData(pagosFn);
tablaPedido.grantWriteData(pagosFn);
backend.pagos.addEnvironment('TIENDA_TABLE', tablaTienda.tableName);
backend.pagos.addEnvironment('PRODUCTO_TABLE', tablaProducto.tableName);
backend.pagos.addEnvironment('PEDIDO_TABLE', tablaPedido.tableName);

// --- Webhook de Stripe: URL pública protegida por la firma de Stripe ---
const webhookFn = backend.stripeWebhook.resources.lambda;
tablaTienda.grantReadWriteData(webhookFn);
tablaPedido.grantReadWriteData(webhookFn);
backend.stripeWebhook.addEnvironment('TIENDA_TABLE', tablaTienda.tableName);
backend.stripeWebhook.addEnvironment('PEDIDO_TABLE', tablaPedido.tableName);
const webhookUrl = webhookFn.addFunctionUrl({ authType: FunctionUrlAuthType.NONE });

backend.addOutput({
  custom: {
    fotosUrl: `https://${cdn.distributionDomainName}`,
    stripeWebhookUrl: webhookUrl.url,
  },
});

// --- Clasificación con IA: lee miniaturas y llama a Claude en Bedrock ---
const clasificarFn = backend.clasificar.resources.lambda;
bucket.grantRead(clasificarFn, 'productos/*');
backend.clasificar.addEnvironment('BUCKET_NAME', bucket.bucketName);
clasificarFn.addToRolePolicy(new PolicyStatement({
  actions: ['bedrock:InvokeModel'],
  resources: [
    'arn:aws:bedrock:*::foundation-model/anthropic.claude-haiku-5-5*',
    'arn:aws:bedrock:*:*:inference-profile/us.anthropic.claude-haiku-5-5*',
  ],
}));
