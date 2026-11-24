const {chromium}=require('@playwright/test');
const {readFileSync,mkdirSync}=require('node:fs');
const {resolve}=require('node:path');
const assert=require('node:assert/strict');
const estilos=[...readFileSync(resolve(__dirname,'../index.html'),'utf8').matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m=>m[1]).join('\n');
(async()=>{
  const browser=await chromium.launch({headless:true,channel:'chrome'});
  try{
    for(const width of [1440,390,320]){
      const page=await browser.newPage({viewport:{width,height:850}});
      await page.route('**/qa-layout',r=>r.fulfill({contentType:'text/html',body:`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${estilos}</style><link rel="stylesheet" href="/src/organizador.css"></head><body></body></html>`}));
      await page.goto((process.env.ORGANIZADOR_URL||'http://127.0.0.1:5173')+'/qa-layout');
      await page.evaluate(async()=>{
        const {abrirOrganizador}=await import('/src/organizador-fotos.js');
        const svg='<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="teal"/></svg>';
        abrirOrganizador(Array.from({length:20},(_,i)=>new File([svg],i+'.svg',{type:'image/svg+xml'})),{
          preparar:async f=>({full:f.name,thumb:f.name}),limpiar:async()=>{},
          agrupar:async()=>Array.from({length:20},(_,i)=>({nombre:'Producto con nombre largo '+i,indices:[i]})),
          permitir:()=>true,referencia:()=>({id:crypto.randomUUID()}),guardar:()=>new Promise(()=>{}),terminar:()=>{},
        });
      });
      await page.getByRole('button',{name:'Sugerir grupos con IA'}).click();
      await page.getByText('Grupos sugeridos por IA:',{exact:false}).waitFor();
      async function comprobar(etapa){
        const problemas=await page.evaluate(()=>{
          const errores=[];
          const zonas=[...document.querySelectorAll('.foto-grupo')];
          zonas.forEach((z,i)=>{
            const r=z.getBoundingClientRect();
            for(const hijo of z.querySelectorAll('img,button,select,input')){
              const h=hijo.getBoundingClientRect();
              if(h.bottom>r.bottom+1||h.right>r.right+1||h.left<r.left-1)errores.push('Contenido fuera de grupo '+i);
            }
            zonas.slice(i+1).forEach(o=>{const s=o.getBoundingClientRect();if(Math.min(r.right,s.right)-Math.max(r.left,s.left)>1&&Math.min(r.bottom,s.bottom)-Math.max(r.top,s.top)>1)errores.push('Grupos superpuestos');});
          });
          const dialog=document.querySelector('.organizador').getBoundingClientRect();
          if(dialog.left<0||dialog.right>innerWidth+1||dialog.bottom>innerHeight+1)errores.push('Modal fuera de pantalla');
          return [...new Set(errores)];
        });
        assert.deepEqual(problemas,[],`${width}px ${etapa}`);
      }
      await comprobar('revisión');
      await page.getByRole('button',{name:'Guardar productos ocultos y revisar'}).click();
      await page.getByText('Guardando productos ocultos.',{exact:false}).waitFor();
      await comprobar('guardado');
      mkdirSync(resolve(__dirname,'../test-results'),{recursive:true});
      await page.screenshot({path:resolve(__dirname,`../test-results/organizador-${width}.png`)});
      console.log(`${width}px: 20 grupos sin superposición en revisión y guardado`);
      await page.close();
    }
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
