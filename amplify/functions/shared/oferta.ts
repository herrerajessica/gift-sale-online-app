// Ofertas con fecha de fin: el producto guarda su precio normal y, aparte, el precio de oferta y hasta cuándo vale.
// Cuando vence, vuelve solo al precio normal (no hay que cambiar nada en la base de datos).
type ConOferta = { precio?: number | null; precioOferta?: number | null; ofertaHasta?: number | null };

export function ofertaActiva(p: ConOferta, ahora = Date.now()): boolean {
  return typeof p.precio === 'number' && typeof p.precioOferta === 'number' && p.precioOferta >= 0
    && p.precioOferta < p.precio && typeof p.ofertaHasta === 'number' && p.ofertaHasta > ahora;
}

/** Precio que se cobra hoy: el de oferta si está vigente; si no, el normal. */
export function precioVigente(p: ConOferta, ahora = Date.now()): number | null {
  if (ofertaActiva(p, ahora)) return p.precioOferta as number;
  return typeof p.precio === 'number' ? p.precio : null;
}

/** Fin del día (23:59:59) de una fecha AAAA-MM-DD en la zona horaria de la tienda. */
export function finDelDia(fecha: string, zona: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(fecha || '').trim());
  if (!m) return null;
  const utc = Date.UTC(+m[1], +m[2] - 1, +m[3], 23, 59, 59);
  // Diferencia entre la hora de la zona y UTC en ese momento (cubre el horario de verano de EE. UU.)
  const partes = new Intl.DateTimeFormat('en-US', { timeZone: zona, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(utc)).reduce((o, x) => ({ ...o, [x.type]: x.value }), {} as Record<string, string>);
  const comoLocal = Date.UTC(+partes.year, +partes.month - 1, +partes.day, +partes.hour, +partes.minute, +partes.second);
  return utc - (comoLocal - utc);
}

export const zonaDe = (pais?: string | null) => (pais === 'US' ? 'America/New_York' : 'America/Lima');
