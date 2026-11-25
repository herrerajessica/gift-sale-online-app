// Catálogo base por rubro (copia del servidor de src/rubros.js: si cambias algo allá, cámbialo aquí).
export const TIPOS: [string, string][] = [
  ['Vestido', 'Ropa'],
  ['Blusa', 'Ropa'],
  ['Polo', 'Ropa'],
  ['Camisa', 'Ropa'],
  ['Pantalón', 'Ropa'],
  ['Jean', 'Ropa'],
  ['Falda', 'Ropa'],
  ['Short', 'Ropa'],
  ['Casaca', 'Ropa'],
  ['Chompa', 'Ropa'],
  ['Polera', 'Ropa'],
  ['Conjunto', 'Ropa'],
  ['Pijama', 'Ropa'],
  ['Leggings', 'Ropa'],
  ['Enterizo', 'Ropa'],
  ['Ropa de baño', 'Ropa'],
  ['Ropa interior', 'Ropa'],
  ['Zapatillas', 'Zapatos'],
  ['Sandalias', 'Zapatos'],
  ['Botas', 'Zapatos'],
  ['Tacones', 'Zapatos'],
  ['Zapatos', 'Zapatos'],
  ['Cartera', 'Carteras y bolsos'],
  ['Bolso', 'Carteras y bolsos'],
  ['Mochila', 'Carteras y bolsos'],
  ['Billetera', 'Carteras y bolsos'],
  ['Neceser', 'Carteras y bolsos'],
  ['Lentes de sol', 'Accesorios'],
  ['Gorra', 'Accesorios'],
  ['Correa', 'Accesorios'],
  ['Bufanda', 'Accesorios'],
  ['Reloj', 'Relojes y joyería'],
  ['Aretes', 'Relojes y joyería'],
  ['Collar', 'Relojes y joyería'],
  ['Pulsera', 'Relojes y joyería'],
  ['Anillo', 'Relojes y joyería'],
  ['Perfume', 'Perfumes y belleza'],
  ['Body splash', 'Perfumes y belleza'],
  ['Crema', 'Perfumes y belleza'],
  ['Maquillaje', 'Perfumes y belleza'],
  ['Cuidado de piel', 'Perfumes y belleza'],
];
export const RUBROS: Record<string, string[]> = {
  moda: ['Ropa', 'Zapatos', 'Carteras y bolsos', 'Accesorios', 'Relojes y joyería'],
  zapatos: ['Zapatos', 'Accesorios'],
  carteras: ['Carteras y bolsos', 'Accesorios', 'Relojes y joyería'],
  belleza: ['Perfumes y belleza'],
  joyeria: ['Relojes y joyería', 'Accesorios'],
  variado: [],
};
/** Tipos de producto del rubro (todos si no hay rubro o es "variado"). */
export function tiposDe(rubro?: string | null): [string, string][] {
  const cats = RUBROS[String(rubro || 'moda')] ?? RUBROS.moda;
  return TIPOS.filter(([, c]) => !cats.length || cats.includes(c));
}
export const categoriaDeTipo = (tipo: string) => (TIPOS.find(([t]) => t === tipo) || [])[1] || '';
