const {test}=require('node:test');const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');const {resolve}=require('node:path');
const cargar=()=>import('data:text/javascript;base64,'+readFileSync(resolve(__dirname,'../src/grupos-union.js')).toString('base64'));
test('mantiene grupos separados y permite cambiar el activo',async()=>{
 const {crearGruposUnion}=await cargar();const s=crearGruposUnion();s.asignar(['a','b']);s.nuevo();s.asignar(['c','d']);
 assert.deepEqual([...s.activar(1)],['a','b']);assert.deepEqual([...s.activar(2)],['c','d']);assert.notEqual(s.color(1),s.color(2));
});
test('mover un producto elimina su pertenencia al grupo anterior',async()=>{
 const {crearGruposUnion}=await cargar();const s=crearGruposUnion();s.asignar(['a','b']);s.nuevo();s.asignar(['b','c']);
 assert.deepEqual([...s.grupos[0].ids],['a']);assert.equal(s.propietario('b').id,2);
});
test('confirmar o cancelar un grupo conserva los otros y permite reiniciar',async()=>{
 const {crearGruposUnion}=await cargar();const s=crearGruposUnion();s.asignar(['a','b']);s.nuevo();s.asignar(['c','d']);
 assert.deepEqual([...s.quitarGrupo(1)],['c','d']);assert.equal(s.grupos.length,1);s.limpiar();assert.equal(s.grupos[0].ids.size,0);
});
