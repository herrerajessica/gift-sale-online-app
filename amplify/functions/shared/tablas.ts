import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

export const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

export const TIENDA = () => process.env.TIENDA_TABLE as string;
export const PRODUCTO = () => process.env.PRODUCTO_TABLE as string;
export const PEDIDO = () => process.env.PEDIDO_TABLE as string;

export async function leerTienda(id: string) {
  const { Item } = await ddb.send(new GetCommand({ TableName: TIENDA(), Key: { id } }));
  return Item as Record<string, any> | undefined;
}

/** Actualiza campos de la tienda (y updatedAt, que AppSync necesita). */
export async function actualizarTienda(id: string, campos: Record<string, unknown>) {
  const entradas = Object.entries({ ...campos, updatedAt: new Date().toISOString() });
  const sets: string[] = [], removes: string[] = [];
  const names: Record<string, string> = {}, values: Record<string, unknown> = {};
  entradas.forEach(([k, v], i) => {
    names[`#k${i}`] = k;
    if (v === null) removes.push(`#k${i}`);
    else { sets.push(`#k${i} = :v${i}`); values[`:v${i}`] = v; }
  });
  await ddb.send(new UpdateCommand({
    TableName: TIENDA(),
    Key: { id },
    UpdateExpression: [sets.length ? 'SET ' + sets.join(', ') : '', removes.length ? 'REMOVE ' + removes.join(', ') : ''].join(' ').trim(),
    ExpressionAttributeNames: names,
    ...(Object.keys(values).length ? { ExpressionAttributeValues: values } : {}),
    ConditionExpression: 'attribute_exists(id)',
  }));
}

/** El dueño en Amplify se guarda como "<sub>::<usuario>". */
export const subDe = (owner: unknown) => String(owner || '').split('::')[0];

/** Dominio propio de la plataforma (con y sin www). */
const DOMINIOS = ['https://showroomcito.com', 'https://www.showroomcito.com'];

/** Solo se permite volver a la propia web: el dominio propio, SITE_URL, Amplify o localhost. */
export function origenSeguro(origen: unknown): string {
  const o = String(origen || '');
  const permitido = DOMINIOS.includes(o)
    || (!!process.env.SITE_URL && o === process.env.SITE_URL.replace(/\/$/, ''))
    || /^https:\/\/[a-z0-9-]+\.[a-z0-9]+\.amplifyapp\.com$/.test(o)
    || /^http:\/\/localhost:\d{2,5}$/.test(o);
  if (!permitido) throw new Error('Origen no permitido');
  return o;
}
