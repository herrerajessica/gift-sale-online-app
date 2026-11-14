import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, PRODUCTO } from './tablas';

/**
 * Descuenta las unidades vendidas. Solo toca productos que llevan control de
 * cantidad (campo stock numérico) y nunca deja el stock por debajo de 0.
 */
export async function descontarStock(itemsJson: unknown) {
  let items: { id?: string; q?: number }[] = [];
  try { items = JSON.parse(String(itemsJson || '[]')); } catch { return; }
  for (const it of items) {
    if (!it.id) continue;
    const q = Math.max(1, Math.floor(Number(it.q) || 1));
    try {
      await ddb.send(new UpdateCommand({
        TableName: PRODUCTO(),
        Key: { id: it.id },
        UpdateExpression: 'SET stock = stock - :q, updatedAt = :t',
        ConditionExpression: 'attribute_exists(id) AND stock >= :q',
        ExpressionAttributeValues: { ':q': q, ':t': new Date().toISOString() },
      }));
    } catch (e) {
      if ((e as { name?: string }).name !== 'ConditionalCheckFailedException') throw e;
      // Sin control de stock o vendieron más de lo registrado: si hay stock, queda en 0.
      await ddb.send(new UpdateCommand({
        TableName: PRODUCTO(),
        Key: { id: it.id },
        UpdateExpression: 'SET stock = :cero, updatedAt = :t',
        ConditionExpression: 'attribute_exists(id) AND attribute_type(stock, :n)',
        ExpressionAttributeValues: { ':cero': 0, ':n': 'N', ':t': new Date().toISOString() },
      })).catch(() => {});
    }
  }
}
