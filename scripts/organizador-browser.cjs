const {chromium}=require('@playwright/test');
const assert=require('node:assert/strict');
(async()=>{
  const browser=await chromium.launch({headless:true,channel:'chrome'});
  try {
    for(const movil of [false,true]){
      const context=await browser.newContext({viewport:{width:movil?390:1100,height:850},isMobile:movil,hasTouch:movil});
      const page=await context.newPage();
      await page.route('**/qa-organizador',route=>route.fulfill({contentType:'text/html',body:'<html><head><link rel="stylesheet" href="/src/organizador.css"><style>.overlay{position:fixed;inset:0;display:grid;place-items:center}.cart{padding:15px;background:white}.cart-head{display:flex}</style></head><body></body></html>'}));
      await page.goto((process.env.ORGANIZADOR_URL || 'http://127.0.0.1:5173')+'/qa-organizador');
      await page.evaluate(async()=>{
        const {abrirOrganizador}=await import('/src/organizador-fotos.js');
        window.guardados=[];window.ids=[];
        abrirOrganizador(Array.from({length:15},(_,i)=>new File(['foto'],i+'.jpg',{type:'image/jpeg'})),{
          preparar:async f=>({full:f.name,thumb:f.name}),limpiar:async()=>{},
          agrupar:async()=>[0,1,2].map(n=>({nombre:'Producto '+n,indices:Array.from({length:5},(_,i)=>n*5+i)})),
          permitir:()=>true,referencia:()=>({id:String(Math.random())}),
          guardar:async(ref,nombre,fotos)=>window.guardados.push({nombre,fotos}),terminar:ids=>window.ids=ids,
        });
      });
      await page.getByRole('button',{name:'Sugerir grupos con IA'}).click();
      await page.getByText('Grupos sugeridos por IA:',{exact:false}).waitFor();
      assert.equal(await page.locator('.foto-organizar').count(),15);
      // Arrastre real por Pointer Events, con eventos de mouse o touch del navegador.
      const origen=page.locator('.org-producto').nth(0).locator('.org-asa').first();
      const destino=page.locator('.org-producto').nth(1);
      await origen.scrollIntoViewIfNeeded();
      // Disponer dos zonas visibles contiguas en ambas pantallas para aislar el gesto.
      await page.addStyleTag({content:'.org-rejilla{display:flex!important}.org-producto{min-width:140px;flex:1}.org-nuevo{display:none}.foto-organizar:not(:first-child){display:none}.org-asa{opacity:1!important}'});
      const a=await origen.boundingBox(),b=await destino.boundingBox();
      const x=a.x+a.width/2,y=a.y+a.height/2,dx=b.x+b.width/2,dy=b.y+25;
      if(movil){
        const cdp=await context.newCDPSession(page);
        await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
        await page.waitForTimeout(350);
        await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:dx,y:dy}]});
        await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      }else{
        await page.mouse.move(x,y);await page.mouse.down();await page.waitForTimeout(120);await page.mouse.move(dx,dy,{steps:8});await page.mouse.up();
      }
      assert.equal(await page.locator('.org-producto').nth(1).locator('.foto-organizar').count(),6);
      // Tocar una foto abre la hoja de opciones; "Mover a" la lleva a otro producto.
      await page.locator('.org-producto').nth(2).locator('.foto-organizar').first().click();
      await page.getByRole('dialog',{name:'Opciones de la foto'}).getByRole('button',{name:'Producto 1',exact:true}).click();
      assert.equal(await page.locator('.org-producto').nth(1).locator('.foto-organizar').count(),7);
      await page.getByRole('button',{name:'Guardar productos ocultos y revisar'}).click();
      await page.waitForFunction(()=>window.ids.length===3);
      assert.deepEqual(await page.evaluate(()=>window.guardados.map(g=>g.fotos.length)),[4,7,4]);
      console.log((movil?'Celular táctil':'Web mouse')+': 15 fotos, arrastre y guardado correctos');
      await context.close();
    }
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
