// Planes de las vendedoras. Fuente única para el cobro, el webhook y el catálogo.
// limite: cantidad máxima de productos visibles en la tienda (null = ilimitado).
// precio: en soles por mes (0 = gratis).
export type PlanId = 'free' | 'basico' | 'pro' | 'plus';

export const PLANES: Record<PlanId, { nombre: string; limite: number | null; precio: number }> = {
  free:   { nombre: 'Free',   limite: 10,   precio: 0 },
  basico: { nombre: 'Básico', limite: 30,   precio: 19 },
  pro:    { nombre: 'Pro',    limite: 150,  precio: 49 },
  plus:   { nombre: 'Plus',   limite: null, precio: 99 },
};

export const esPlan = (p: unknown): p is PlanId => typeof p === 'string' && p in PLANES;

// Días de gracia después del vencimiento antes de volver al plan Free.
const GRACIA_MS = 3 * 24 * 60 * 60 * 1000;

/** Plan que realmente aplica hoy (si el pago venció, vuelve a Free). */
export function planVigente(t: { plan?: string | null; planVence?: number | null }): PlanId {
  const p = esPlan(t.plan) ? t.plan : 'free';
  if (p === 'free') return 'free';
  if (!t.planVence || t.planVence + GRACIA_MS < Date.now()) return 'free';
  return p;
}
