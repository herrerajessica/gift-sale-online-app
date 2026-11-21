export function normalizarGrupos(respuesta, cantidad) {
  const usados=new Set(), grupos=[];
  for(const candidato of Array.isArray(respuesta)?respuesta:[]){
    const indices=Array.isArray(candidato.indices)?candidato.indices:[];
    // No confiar en respuestas repetidas: las fotos ambiguas quedan sin organizar.
    const validos=indices.filter(i=>Number.isInteger(i)&&i>=0&&i<cantidad);
    if(!validos.length) continue;
    grupos.push({nombre:String(candidato.nombre||'Producto').slice(0,80), fotos:[...new Set(validos)]});
  }
  const repeticiones=new Map();
  grupos.forEach(g=>g.fotos.forEach(i=>repeticiones.set(i,(repeticiones.get(i)||0)+1)));
  const salida=grupos.map(g=>({...g,fotos:g.fotos.filter(i=>repeticiones.get(i)===1)})).filter(g=>g.fotos.length);
  salida.forEach(g=>g.fotos.forEach(i=>usados.add(i)));
  return {grupos:salida, pendientes:Array.from({length:cantidad},(_,i)=>i).filter(i=>!usados.has(i))};
}

export function moverFoto(grupos, foto, destino) {
  if(!grupos.some(g=>g.id===destino)) throw Error('El grupo ya no existe');
  return grupos.map(g=>({...g,fotos:[...g.fotos.filter(i=>i!==foto),...(g.id===destino?[foto]:[])]}));
}
