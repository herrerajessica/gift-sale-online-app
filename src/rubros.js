// Catálogo base por rubro: qué tipos de producto, categorías y marcas trae cada tienda.
// Copia en amplify/functions/shared/rubros.ts (si cambias algo aquí, cámbialo también allá).

// Tipos de producto: [tipo, categoría, prefijo del código, palabras que lo reconocen al dictar]
export const TIPOS = [
  ['Vestido', 'Ropa', 'VES', 'vestido'], ['Blusa', 'Ropa', 'BLU', 'blusa'], ['Polo', 'Ropa', 'POL', 'polo|camiseta|t-shirt|tshirt'],
  ['Camisa', 'Ropa', 'CAM', 'camisa'], ['Pantalón', 'Ropa', 'PAN', 'pantalon|pants'], ['Jean', 'Ropa', 'JEA', 'jean|jeans|blue jean'],
  ['Falda', 'Ropa', 'FAL', 'falda|minifalda'], ['Short', 'Ropa', 'SHO', 'short|shorts|bermuda'], ['Casaca', 'Ropa', 'CAS', 'casaca|chaqueta|chamarra|abrigo|saco'],
  ['Chompa', 'Ropa', 'CHO', 'chompa|sueter|sweater|cardigan'], ['Polera', 'Ropa', 'PLR', 'polera|hoodie|buzo|sudadera'], ['Conjunto', 'Ropa', 'CON', 'conjunto|set de ropa'],
  ['Pijama', 'Ropa', 'PIJ', 'pijama'], ['Leggings', 'Ropa', 'LEG', 'legging|leggings|calza|licra'], ['Enterizo', 'Ropa', 'ENT', 'enterizo|jumpsuit|mameluco'],
  ['Ropa de baño', 'Ropa', 'BAN', 'ropa de bano|bikini|traje de bano|ropa de playa'], ['Ropa interior', 'Ropa', 'INT', 'ropa interior|brasier|calzon|boxer|lenceria'],
  ['Zapatillas', 'Zapatos', 'ZAP', 'zapatilla|zapatillas|tenis|sneakers'], ['Sandalias', 'Zapatos', 'SAN', 'sandalia|sandalias|chancla|chanclas|chinela'],
  ['Botas', 'Zapatos', 'BOT', 'bota|botas|botin|botines'], ['Tacones', 'Zapatos', 'TAC', 'tacon|tacones|taco|tacos'], ['Zapatos', 'Zapatos', 'ZPT', 'zapato|zapatos|mocasin|mocasines|ballerinas'],
  ['Cartera', 'Carteras y bolsos', 'CAR', 'cartera'], ['Bolso', 'Carteras y bolsos', 'BOL', 'bolso|tote|bandolera|crossbody'], ['Mochila', 'Carteras y bolsos', 'MCH', 'mochila'],
  ['Billetera', 'Carteras y bolsos', 'BIL', 'billetera|monedero'], ['Neceser', 'Carteras y bolsos', 'NEC', 'neceser|cosmetiquera|porta cosmeticos|portacosmeticos|estuche de maquillaje|bolso de maquillaje|organizador de maquillaje|makeup bag|cosmetic bag'], ['Lentes de sol', 'Accesorios', 'LEN', 'lentes|gafas|anteojos'], ['Gorra', 'Accesorios', 'GOR', 'gorra|gorro|sombrero'],
  ['Correa', 'Accesorios', 'COR', 'correa|cinturon'], ['Bufanda', 'Accesorios', 'BUF', 'bufanda|chalina'], ['Reloj', 'Relojes y joyería', 'REL', 'reloj|smartwatch'],
  ['Aretes', 'Relojes y joyería', 'ARE', 'arete|aretes|pendientes'], ['Collar', 'Relojes y joyería', 'COL', 'collar|cadena|dije'], ['Pulsera', 'Relojes y joyería', 'PUL', 'pulsera|brazalete'],
  ['Anillo', 'Relojes y joyería', 'ANI', 'anillo'], ['Perfume', 'Perfumes y belleza', 'PER', 'perfume|colonia|fragancia|eau de'], ['Body splash', 'Perfumes y belleza', 'BSP', 'body splash|splash|mist'],
  ['Crema', 'Perfumes y belleza', 'CRE', 'crema|locion|loción'], ['Maquillaje', 'Perfumes y belleza', 'MAQ', 'maquillaje|labial|rubor|sombras|delineador|mascara de pestanas'],
  ['Cuidado de piel', 'Perfumes y belleza', 'PIE', 'serum|limpiador|protector solar|bloqueador'],
];

// Rubros: lo que elige la vendedora al crear la tienda. "cats" = categorías que usa (vacío = todas).
export const RUBROS = [
  { id: 'moda', nombre: 'Ropa y moda', detalle: 'Vestidos, jeans, polos', cats: ['Ropa', 'Zapatos', 'Carteras y bolsos', 'Accesorios', 'Relojes y joyería'] },
  { id: 'zapatos', nombre: 'Zapatos', detalle: 'Zapatillas, botas, sandalias', cats: ['Zapatos', 'Accesorios'] },
  { id: 'carteras', nombre: 'Carteras y accesorios', detalle: 'Bolsos, lentes, billeteras', cats: ['Carteras y bolsos', 'Accesorios', 'Relojes y joyería'] },
  { id: 'belleza', nombre: 'Belleza y perfumes', detalle: 'Perfumes, cremas, maquillaje', cats: ['Perfumes y belleza'] },
  { id: 'joyeria', nombre: 'Relojes y joyería', detalle: 'Relojes, aretes, collares', cats: ['Relojes y joyería', 'Accesorios'] },
  { id: 'variado', nombre: 'De todo un poco', detalle: 'Ropa, hogar, juguetes, tecnología', cats: [] },
];
export const rubroDe = (id) => RUBROS.find((r) => r.id === id) || RUBROS[0];
/** Tipos que ofrece el rubro (todos si es "De todo un poco"). */
export const tiposDe = (id) => { const r = rubroDe(id); return TIPOS.filter((t) => !r.cats.length || r.cats.includes(t[1])); };
export const categoriaDeTipo = (tipo) => (TIPOS.find((t) => t[0] === tipo) || [])[1] || '';
export const prefijoDeTipo = (tipo) => (TIPOS.find((t) => t[0] === tipo) || [])[2] || '';

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** "vestido rojo de flores" → "Vestido". Busca la primera palabra de tipo que aparezca en el texto. */
export function tipoDeTexto(texto, rubro) {
  const t = ' ' + norm(texto).replace(/[^a-z0-9ñ ]+/g, ' ') + ' ';
  let mejor = null;
  for (const [tipo, , , palabras] of tiposDe(rubro)) {
    for (const w of palabras.split('|')) {
      const i = t.indexOf(' ' + norm(w) + ' ');
      // La que aparece primero; a igual posición, la frase más larga ("body splash" antes que "body")
      if (i >= 0 && (!mejor || i < mejor.i || (i === mejor.i && w.length > mejor.n))) mejor = { tipo, i, n: w.length };
    }
  }
  return mejor ? mejor.tipo : '';
}

// Marcas conocidas (se sugieren al escribir la marca y se reconocen al dictar)
export const MARCAS = ['Abercrombie & Fitch', 'Adidas', 'Aeropostale', 'American Eagle', 'Anne Klein', 'Avon', 'Banana Republic', 'Bath & Body Works', 'Bershka', 'Birkenstock',
  'Calvin Klein', 'Carolina Herrera', "Carter's", 'Casio', 'CeraVe', 'Champion', 'Clarks', 'Clinique', 'Coach', 'Columbia', 'Converse', 'Crocs', 'Dior', 'Disney', 'Dove',
  'Dr. Martens', 'Ésika', 'Estée Lauder', 'Express', 'Forever 21', 'Fossil', 'Furla', 'Gap', 'Guess', 'H&M', 'Hollister', 'Hugo Boss', 'Invicta', 'JanSport', 'Kate Spade',
  "L'Bel", "L'Oréal", 'Lacoste', 'Lancôme', "Levi's", 'Longchamp', 'Lululemon', 'MAC', 'Mango', 'Marc Jacobs', 'Massimo Dutti', 'Maybelline', 'Michael Kors', 'Natura',
  'Nautica', 'Neutrogena', 'New Balance', 'Nike', 'Nine West', 'Nivea', 'Oakley', 'Old Navy', 'OshKosh', 'Paco Rabanne', 'Pandora', 'Pull&Bear', 'Puma', 'Ralph Lauren',
  'Ray-Ban', 'Reebok', 'Revlon', 'Sephora', 'Shein', 'Skechers', 'Steve Madden', 'Stradivarius', 'Swarovski', 'The North Face', 'Timberland', 'Tommy Hilfiger', 'UGG',
  'Under Armour', 'Uniqlo', 'Vans', 'Vera Bradley', 'Versace', "Victoria's Secret", 'Yanbal', 'Zara'];
/** Marca conocida que aparece en lo dictado ("me compré un polo tomi" no; "polo Tommy Hilfiger" sí). */
export function marcaDeTexto(texto) {
  // Sin apóstrofos ni "the": "victoria secret" = Victoria's Secret, "north face" = The North Face
  const limpio = (x) => norm(x).replace(/'s\b/g, '').replace(/[^a-z0-9& ]+/g, ' ').replace(/\bs\b/g, ' ').replace(/^\s*the\s+/, '').replace(/\s+/g, ' ').trim();
  const t = ' ' + limpio(texto) + ' ';
  let mejor = null;
  for (const m of MARCAS) {
    const k = limpio(m);
    if (k.length < 3) continue;
    const i = t.indexOf(' ' + k + ' ');
    if (i >= 0 && (!mejor || k.length > mejor.k.length)) mejor = { m, k, i };
  }
  return mejor ? mejor.m : '';
}
