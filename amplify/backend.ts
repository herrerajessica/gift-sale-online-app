import { defineBackend } from '@aws-amplify/backend';
import { Stack } from 'aws-cdk-lib';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { CachePolicy, Distribution, ViewerProtocolPolicy } from 'aws-cdk-lib/aws-cloudfront';
import { S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { storage } from './storage/resource';
import { clasificar } from './functions/clasificar/resource';
import { catalogo } from './functions/catalogo/resource';

const backend = defineBackend({ auth, data, storage, clasificar, catalogo });

const bucket = backend.storage.resources.bucket;

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
backend.addOutput({ custom: { fotosUrl: `https://${cdn.distributionDomainName}` } });

// --- Catálogo público: lee las tablas directamente (solo lectura) ---
const catalogoFn = backend.catalogo.resources.lambda;
const tablaTienda = backend.data.resources.tables['Tienda'];
const tablaProducto = backend.data.resources.tables['Producto'];
tablaTienda.grantReadData(catalogoFn);
tablaProducto.grantReadData(catalogoFn);
catalogoFn.addToRolePolicy(new PolicyStatement({
  actions: ['dynamodb:Query'],
  resources: [`${tablaProducto.tableArn}/index/*`],
}));
backend.catalogo.addEnvironment('TIENDA_TABLE', tablaTienda.tableName);
backend.catalogo.addEnvironment('PRODUCTO_TABLE', tablaProducto.tableName);

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
