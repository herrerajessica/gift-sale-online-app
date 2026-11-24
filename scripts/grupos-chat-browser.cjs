const {chromium}=require('@playwright/test');const {readFileSync}=require('node:fs');const {resolve}=require('node:path');const assert=require('node:assert/strict');
(async()=>{
const browser=await chromium.launch({headless:true,channel:'chrome'});
try{for(const width of [1200,390]){
 const page=await browser.newPage({viewport:{width,height:850}});page.setDefaultTimeout(30000);const errores=[];page.on('pageerror',e=>{errores.push(e.message);console.error('Error navegador:',e.message);});
 await page.route('https://**/*',r=>r.abort());
 let codigo=readFileSync(resolve(__dirname,'../src/main.js'),'utf8');
 codigo=codigo.slice(0,codigo.lastIndexOf('  (async ()=>{'));
 codigo=codigo.replace("import './organizador.css';","import '/src/organizador.css?import';");
 codigo=codigo.replace('agrupar:agruparFotos,','agrupar:async paths=>[{nombre:"Cartera negra",indices:paths.map((_,i)=>i)}],');
 codigo=codigo.replace("await ai.json('',","await window.__qaVisual('',");
 codigo=codigo.replace('await interpretarDictado([','await window.__qaDictado([');
 codigo+='\nwindow.__qa={S,render,gruposUnion,abrirAsis};';
 await page.route('**/src/main.js*',r=>r.fulfill({contentType:'application/javascript',body:codigo}));
 await page.goto((process.env.ORGANIZADOR_URL||'http://127.0.0.1:5173')+'/',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>!!window.__qa);
 await page.evaluate(()=>{
  const q=window.__qa;q.S.canEdit=true;q.S.loaded=true;q.S.config={id:'test',nombre:'Test',plan:'free'};
  q.S.products=['a','b','c','d'].map((id,i)=>({id,nombre:'Producto '+id,estado:'disponible',fotos:[{full:'foto-'+id}],creado:i}));
  q.S.assets={upload:async()=>({id:'productos/mock/foto.jpg'}),delete:async()=>{}};
  window.__qaVisual=async()=>[{marca:'Marca de prueba',categoria:'Carteras y bolsos',descripcion:'Cartera negra'}];
  window.__qaDictado=async()=>[{precio:85,moneda:'PEN',stock:2}];window.__guardados=[];
  q.S.db={collection:()=>({doc:()=>({id:'nuevo',set:async datos=>window.__guardados.push(datos)})})};
  document.querySelector('#vitrina').hidden=false;q.render();
  for(const id of ['selectBtn','grid','bulk']){let n=document.getElementById(id);while(n){n.hidden=false;n=n.parentElement;}}
 });
 await page.locator('#selectBtn').click();
 await page.locator('[data-producto="a"] .open').click();await page.locator('[data-producto="b"] .open').click();
 assert.match(await page.locator('#bulkJuntar').innerText(),/2/);
 await page.locator('#unionNuevo').click();
 await page.locator('[data-producto="c"] .open').click();await page.locator('[data-producto="d"] .open').click();
 assert.equal(await page.locator('.grupo-leyenda').count(),2);
 assert.equal(await page.locator('.card.en-grupo-union').count(),4);
 assert.notEqual(await page.locator('[data-producto="a"]').evaluate(e=>e.style.getPropertyValue('--grupo-color')),await page.locator('[data-producto="c"]').evaluate(e=>e.style.getPropertyValue('--grupo-color')));
 await page.locator('#bulkJuntar').click();assert.equal(await page.locator('[aria-label="Producto principal"] option').count(),2);
 await page.getByRole('dialog',{name:'Juntar en un producto'}).getByRole('button',{name:'Cancelar',exact:true}).click();
 await page.locator('#bulkCancelarUnion').click();assert.equal(await page.locator('.grupo-leyenda').count(),1);
 await page.evaluate(()=>window.__qa.abrirAsis());
 const svg='<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="black"/></svg>';
 await page.locator('#asisFotos').setInputFiles([{name:'cartera.svg',mimeType:'image/svg+xml',buffer:Buffer.from(svg)}]);
 assert.equal(await page.locator('.asis-adjunto').count(),1);
 await page.locator('#asisInput').fill('Cartera negra 85 soles tengo dos');await page.locator('#asisEnviar').click();
 const dialog=page.getByRole('dialog',{name:'Organizar fotos por producto'});await dialog.waitFor();
 await dialog.getByText('Grupos sugeridos por IA:',{exact:false}).waitFor();
 assert.match(await dialog.locator('.instrucciones-fotos').innerText(),/85 soles/);
 assert.equal(await dialog.locator('.foto-organizar').count(),1);
 await dialog.getByRole('button',{name:'Guardar productos ocultos y revisar'}).click();
 await page.waitForFunction(()=>window.__guardados.length===1);
 assert.deepEqual(await page.evaluate(()=>({estado:window.__guardados[0].estado,precio:window.__guardados[0].precio,stock:window.__guardados[0].stock})),{estado:'oculto',precio:85,stock:2});
 assert.deepEqual(errores,[]);console.log(width+'px: grupos por color y fotos del asistente correctos');await page.close();
}}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
