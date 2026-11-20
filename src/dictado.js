// Mantiene los índices originales aunque falle un lote o falten respuestas.
export async function interpretarPorLotes(textos, interpretar) {
  const resultados = [], pendientes = [];
  for (let inicio = 0; inicio < textos.length; inicio += 5) {
    const lote = textos.slice(inicio, inicio + 5);
    let respuesta = [];
    try { respuesta = await interpretar(lote); } catch (e) { console.warn('No se pudo interpretar un lote de dictado', e); }
    for (let i = 0; i < lote.length; i++) {
      const coincidencias = Array.isArray(respuesta) ? respuesta.filter(r => r && r.i === i) : [];
      if (coincidencias.length === 1) resultados.push({ ...coincidencias[0], i: inicio + i });
      else pendientes.push(inicio + i + 1);
    }
  }
  return { resultados, pendientes };
}
