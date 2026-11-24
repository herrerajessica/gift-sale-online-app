export const COLORES_UNION=['#167245','#2257aa','#8a3996','#9b4b12','#08747c','#ac2e55'];
export function crearGruposUnion(){
  let numero=1,activo=1;
  let grupos=[{id:1,nombre:'Grupo 1',ids:new Set()}];
  return {
    get grupos(){return grupos;},get activo(){return activo;},
    color:id=>COLORES_UNION[id-1]||`hsl(${Math.round(id*137.508)%360} 55% 32%)`,
    propietario:id=>grupos.find(g=>g.ids.has(id)),
    activar(id){if(!grupos.some(g=>g.id===id))throw Error('Grupo inexistente');activo=id;return new Set(grupos.find(g=>g.id===id).ids);},
    nuevo(){grupos.push({id:++numero,nombre:'Grupo '+numero,ids:new Set()});activo=numero;return new Set();},
    asignar(ids){const elegidos=new Set(ids);grupos=grupos.map(g=>({...g,ids:g.id===activo?elegidos:new Set([...g.ids].filter(id=>!elegidos.has(id)))}));return new Set(elegidos);},
    quitarGrupo(id){grupos=grupos.filter(g=>g.id!==id);if(!grupos.length)grupos=[{id:++numero,nombre:'Grupo '+numero,ids:new Set()}];activo=grupos[0].id;return new Set(grupos[0].ids);},
    limpiar(){numero=1;activo=1;grupos=[{id:1,nombre:'Grupo 1',ids:new Set()}];},
  };
}
