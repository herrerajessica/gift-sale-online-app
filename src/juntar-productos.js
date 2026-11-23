export function prepararUnion(productos, principalId, portada) {
  if (productos.length < 2 || new Set(productos.map(p => p.id)).size !== productos.length) throw new Error('Selecciona al menos dos productos distintos.');
  if (productos.some(p => p.origenId || p.compartido || !['disponible', 'oculto'].includes(p.estado))) {
    throw new Error('Solo puedes juntar productos propios, disponibles u ocultos, que no estén compartidos.');
  }
  const principal = productos.find(p => p.id === principalId);
  if (!principal) throw new Error('Elige el producto principal.');
  if(productos.some(p=>p.unidoA)) throw new Error('Uno de estos productos ya se unió a otro. Selecciona el producto principal en su lugar.');
  if(productos.some(p=>(p.unidosDesde||[]).some(id=>productos.some(x=>x.id===id)))) {
    throw new Error('Estos productos ya se juntaron. No se pueden volver a copiar sus fotos.');
  }
  const vistos = new Set(), fotos = [];
  for (const p of [principal, ...productos.filter(p => p.id !== principalId)]) {
    for (const f of p.fotos || []) if (f.full && !vistos.has(f.full)) { vistos.add(f.full); fotos.push({full:f.full, thumb:f.thumb || f.full}); }
  }
  if (!fotos.length) throw new Error('Los productos seleccionados no tienen fotos.');
  const indice = fotos.findIndex(f => f.full === portada);
  if (indice > 0) fotos.unshift(...fotos.splice(indice, 1));
  return { principal, secundarios:productos.filter(p => p.id !== principalId), fotos };
}

// Copias independientes: eliminar las fichas secundarias no rompe la galería principal.
export async function ejecutarUnion(plan, {copiar, actualizar, borrar}) {
  const fotos = [];
  for (const foto of plan.fotos) fotos.push(await copiar(foto));
  // Nunca eliminar antes de confirmar que la galería principal quedó guardada.
  const unidosDesde=[...new Set([...(plan.principal.unidosDesde||[]),...plan.secundarios.flatMap(p=>[p.id,...(p.unidosDesde||[])])])];
  await actualizar(plan.principal.id, {fotos, huella:'', unidosDesde});
  const fallidos = [];
  for (const p of plan.secundarios) {
    try { await borrar(p.id); } catch { fallidos.push(p.id); }
  }
  return {fallidos};
}
