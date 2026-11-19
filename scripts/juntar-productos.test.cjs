const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {resolve} = require('node:path');
const modulo = import('data:text/javascript;base64,'+readFileSync(resolve(__dirname,'../src/juntar-productos.js')).toString('base64'));
const productos = () => [
  {id:'a',nombre:'Cartera',codigo:'CAR-001',precio:85,stock:2,estado:'disponible',fotos:[{full:'frente',thumb:'mini-frente'}]},
  {id:'b',nombre:'Costado',stock:1,estado:'disponible',fotos:[{full:'costado'}, {full:'frente'}]},
  {id:'c',nombre:'Etiqueta',stock:1,estado:'oculto',fotos:[{full:'etiqueta'}]},
];

test('junta tres fichas, elimina fotos repetidas y respeta la portada elegida',async()=>{
  const {prepararUnion}=await modulo;
  const originales=productos(), antes=JSON.stringify(originales);
  const plan=prepararUnion(originales,'a','etiqueta');
  assert.deepEqual(plan.fotos.map(f=>f.full),['etiqueta','frente','costado']);
  assert.equal(plan.principal.stock,2);
  assert.equal(plan.principal.codigo,'CAR-001');
  assert.equal(JSON.stringify(originales),antes);
});

test('rechaza vendidos, apartados, compartidos y productos de otras tiendas',async()=>{
  const {prepararUnion}=await modulo;
  for(const patch of [{estado:'vendido'},{estado:'apartado'},{compartido:true},{origenId:'ajeno'}]){
    const lista=productos(); Object.assign(lista[1],patch);
    assert.throws(()=>prepararUnion(lista,'a'),/Solo puedes/);
  }
  assert.throws(()=>prepararUnion([productos()[0]],'a'),/al menos dos/);
  assert.throws(()=>prepararUnion(productos(),'inexistente'),/principal/);
});

test('guarda copias independientes antes de ocultar y conserva los datos principales',async()=>{
  const {prepararUnion,ejecutarUnion}=await modulo;
  const lista=productos(), cambios=[];
  await ejecutarUnion(prepararUnion(lista,'a'),{
    copiar:async f=>({full:'copia-'+f.full,thumb:'copia-'+f.thumb}),
    actualizar:async(id,patch)=>cambios.push({id,patch}),
  });
  assert.equal(cambios[0].id,'a');
  assert.deepEqual(Object.keys(cambios[0].patch).sort(),['fotos','huella']);
  assert.ok(cambios[0].patch.fotos.every(f=>f.full.startsWith('copia-')));
  assert.deepEqual(cambios.slice(1),[{id:'b',patch:{estado:'oculto'}},{id:'c',patch:{estado:'oculto'}}]);
  assert.equal(lista[0].stock,2);
});

test('si falla una foto no modifica ni oculta productos',async()=>{
  const {prepararUnion,ejecutarUnion}=await modulo;
  let cambios=0;
  await assert.rejects(ejecutarUnion(prepararUnion(productos(),'a'),{
    copiar:async()=>{throw Error('sin conexión');},actualizar:async()=>cambios++,
  }),/sin conexión/);
  assert.equal(cambios,0);
});

test('si falla el guardado principal no oculta secundarios',async()=>{
  const {prepararUnion,ejecutarUnion}=await modulo;
  const ids=[];
  await assert.rejects(ejecutarUnion(prepararUnion(productos(),'a'),{
    copiar:async f=>f, actualizar:async id=>{ids.push(id);throw Error('falló guardado');},
  }));
  assert.deepEqual(ids,['a']);
});

test('informa los secundarios que no pudo ocultar y continúa con los restantes',async()=>{
  const {prepararUnion,ejecutarUnion}=await modulo;
  const ids=[];
  const resultado=await ejecutarUnion(prepararUnion(productos(),'a'),{
    copiar:async f=>f,actualizar:async id=>{ids.push(id);if(id==='b')throw Error('falló');},
  });
  assert.deepEqual(ids,['a','b','c']);
  assert.deepEqual(resultado.fallidos,['b']);
});
