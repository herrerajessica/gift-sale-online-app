const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {resolve}=require('node:path');
const cargar=()=>import('data:text/javascript;base64,'+readFileSync(resolve(__dirname,'../src/grupos-fotos.js')).toString('base64'));
test('quince fotos se agrupan en tres productos sin pérdidas',async()=>{
  const {normalizarGrupos}=await cargar();
  const r=normalizarGrupos([0,1,2].map(n=>({nombre:'Producto',indices:Array.from({length:5},(_,i)=>n*5+i)})),15);
  assert.deepEqual(r.grupos.map(g=>g.fotos.length),[5,5,5]);assert.deepEqual(r.pendientes,[]);
});
test('índices ambiguos, ausentes o inválidos no se asignan silenciosamente',async()=>{
  const {normalizarGrupos}=await cargar();const r=normalizarGrupos([{indices:[0,1,99]},{indices:[1,2,-1]}],5);
  assert.deepEqual(r.grupos.map(g=>g.fotos),[[0],[2]]);assert.deepEqual(r.pendientes,[1,3,4]);
});
test('mover una foto conserva una sola asignación y no muta el estado anterior',async()=>{
  const {moverFoto}=await cargar();const antes=[{id:'a',fotos:[0,1]},{id:'b',fotos:[2]}];
  assert.deepEqual(moverFoto(antes,1,'b').map(g=>g.fotos),[[0],[2,1]]);assert.deepEqual(antes[0].fotos,[0,1]);
  assert.throws(()=>moverFoto(antes,1,'no-existe'));
});
