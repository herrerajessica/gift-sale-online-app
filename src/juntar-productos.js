export function prepararUnion(productos, principalId, portada) {
  if (productos.length < 2 || new Set(productos.map(p => p.id)).size !== productos.length) throw new Error('Selecciona al menos dos productos distintos.');
  if (productos.some(p => p.origenId || p.compartido || !['disponible', 'oculto'].includes(p.estado))) {
    throw new Error('Solo puedes juntar productos propios, disponibles u ocultos, que no estén compartidos.');
  }
  const principal = productos.find(p => p.id === principalId);
  if (!principal) throw new Error('Elige el producto principal.');
  const vistos = new Set(), fotos = [];
  for (const p of [principal, ...productos.filter(p => p.id !== principalId)]) {
    for (const f of p.fotos || []) if (f.full && !vistos.has(f.full)) { vistos.add(f.full); fotos.push({full:f.full, thumb:f.thumb || f.full}); }
  }
  if (!fotos.length) throw new Error('Los productos seleccionados no tienen fotos.');
  const indice = fotos.findIndex(f => f.full === portada);
  if (indice > 0) fotos.unshift(...fotos.splice(indice, 1));
  return { principal, secundarios:productos.filter(p => p.id !== principalId), fotos };
}

// Copias independientes: borrar después un producto oculto no rompe la galería principal.
export async function ejecutarUnion(plan, {copiar, actualizar}) {
  const fotos = [];
  for (const foto of plan.fotos) fotos.push(await copiar(foto));
  // Nunca ocultar antes de confirmar que la galería principal quedó guardada.
  await actualizar(plan.principal.id, {fotos, huella:''});
  const fallidos = [];
  for (const p of plan.secundarios) {
    try { await actualizar(p.id, {estado:'oculto'}); } catch { fallidos.push(p.id); }
  }
  return {fallidos};
}
