const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const cargar = nombre => import('data:text/javascript;base64,' + readFileSync(resolve(__dirname, '../src/', nombre)).toString('base64'));

test('separa las frases completas sin dejar producto en el siguiente artículo', async () => {
  const { SEPARADOR_PRODUCTOS } = await cargar('voz.js');
  for (const separador of ['siguiente producto', 'siguiente', 'otro producto', 'próximo producto', 'next item']) {
    assert.deepEqual(`cartera ${separador} polo`.split(SEPARADOR_PRODUCTOS).map(s => s.trim()), ['cartera', 'polo']);
  }
});

test('corrige alias y conserva marcas ambiguas, palabras comunes y números', async () => {
  const { corregir, vocabulario } = await cargar('voz.js');
  const vocab = vocabulario([{txt:'Michael Kors',tipo:'marca'}, {txt:'Lumina',tipo:'marca'}, {txt:'Lumine',tipo:'marca'}]);
  assert.equal(corregir('cartera maicol cors con 85 soles', vocab), 'cartera Michael Kors con 85 soles');
  assert.equal(corregir('marca lumino 85 soles', vocab), 'marca lumino 85 soles');
  assert.equal(corregir('marca Zunari talla M', vocab), 'marca Zunari talla M');
});

test('espera el resultado final que llega después de stop antes de continuar', async () => {
  const { escucha } = await cargar('voz.js');
  global.window = {};
  global.document = {addEventListener(){}, removeEventListener(){}};
  let texto = '';
  class SR {
    start() {}
    stop() {
      setTimeout(() => {
        this.onresult({resultIndex:0, results:[Object.assign([{transcript:'tengo tres'}], {isFinal:true})]});
        this.onend();
      }, 15);
    }
  }
  const rec = escucha(SR, {alTexto:t=>texto+=t});
  rec.iniciar();
  const fin = rec.finalizar();
  assert.equal(texto, '');
  await fin;
  assert.equal(texto.trim(), 'tengo tres');
});

test('procesa más de 40 productos sin perder índices', async () => {
  const { interpretarPorLotes } = await cargar('dictado.js');
  const lotes = [];
  const resultado = await interpretarPorLotes(Array.from({length:43}, (_,i)=>String(i)), async lote => {
    lotes.push(lote.length);
    return lote.map((nombre,i)=>({i,nombre}));
  });
  assert.equal(lotes.length, 9);
  assert.ok(lotes.every(n=>n<=5));
  assert.equal(resultado.resultados[42].nombre, '42');
  assert.equal(resultado.resultados[42].i, 42);
  assert.deepEqual(resultado.pendientes, []);
});

test('detecta respuestas faltantes y duplicadas conservando los productos válidos', async () => {
  const { interpretarPorLotes } = await cargar('dictado.js');
  const resultado = await interpretarPorLotes(['a','b','c'], async()=>[{i:0},{i:1},{i:1}]);
  assert.deepEqual(resultado.resultados, [{i:0}]);
  assert.deepEqual(resultado.pendientes, [2,3]);
});

test('un lote fallido no impide interpretar los siguientes', async () => {
  const { interpretarPorLotes } = await cargar('dictado.js');
  let llamadas = 0;
  const resultado = await interpretarPorLotes(['a','b','c','d','e','f'], async()=>{
    if(++llamadas===1) throw new Error('fallo simulado');
    return [{i:0,nombre:'f'}];
  });
  assert.deepEqual(resultado.pendientes, [1,2,3,4,5]);
  assert.deepEqual(resultado.resultados, [{i:5,nombre:'f'}]);
});
