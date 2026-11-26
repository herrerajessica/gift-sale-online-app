import {arrastrable} from './arrastrar.js';
import {normalizarGrupos,moverFoto} from './grupos-fotos.js';

// Organizador de fotos: cada tarjeta es un producto. Las acciones de cada foto (mover, portada, quitar)
// están en una hoja que se abre al tocar la foto, para que la pantalla muestre fotos y no botones.
// Gira una imagen 90° a la derecha y devuelve un JPG.
export async function girarImagen(url){
  const img=await new Promise((res,rej)=>{const i=new Image();i.crossOrigin='anonymous';i.onload=()=>res(i);i.onerror=()=>rej(new Error('No se pudo abrir la foto'));i.src=url;});
  const c=document.createElement('canvas');c.width=img.naturalHeight;c.height=img.naturalWidth;
  const g=c.getContext('2d');g.translate(c.width,0);g.rotate(Math.PI/2);g.drawImage(img,0,0);
  return await new Promise((res,rej)=>c.toBlob(b=>b?res(b):rej(new Error('No se pudo girar')),'image/jpeg',.92));
}

export function abrirOrganizador(files, op){
  files=[...files];
  if(!files.length) return;
  const urls=files.map(f=>URL.createObjectURL(f));
  let grupos=[{id:'pendientes',nombre:'Por organizar',fotos:files.map((_,i)=>i)}], numero=0, ocupado=false;
  const subidas=new Map(), guardados=new Set();
  let aviso='Toca una foto para elegir a qué producto va, o arrástrala. Nada se publica automáticamente.';
  let hoja=null, ultimoArrastre={t:0,i:-1};
  // Trabajo en curso, bien visible: qué hace la IA y cuánto falta.
  let trabajo=null;
  // Visor de foto a pantalla completa (para ver bien de qué producto se trata).
  let visor=null;
  const avanzar=(titulo,paso,actual,total)=>{trabajo={titulo,paso,actual,total};pintar();};
  const ov=document.createElement('div'); ov.className='overlay'; document.body.append(ov);
  const el=(tag,txt,clase)=>{const n=document.createElement(tag);if(txt)n.textContent=txt;if(clase)n.className=clase;return n;};
  const boton=(texto,fn,clase='btn')=>{const b=el('button',texto,clase); b.type='button';b.disabled=ocupado;b.onclick=fn;return b;};
  const fotosTxt=n=>n+(n===1?' foto':' fotos');
  const productos=()=>grupos.filter(g=>g.id!=='pendientes');
  const editables=()=>productos().filter(g=>!g.guardado);
  function nuevo(){const id='grupo-'+(++numero);grupos.push({id,nombre:'Producto '+numero,fotos:[]});return id;}
  function mover(i,id){
    if(ocupado)return;
    if(id==='nuevo')id=nuevo();
    if(id==='pendientes'&&!grupos.some(g=>g.id==='pendientes'))grupos.unshift({id:'pendientes',nombre:'Por organizar',fotos:[]});
    grupos=moverFoto(grupos,i,id);
    // Un producto que se queda sin fotos desaparece (no se guardan productos vacíos).
    grupos=grupos.filter(g=>g.id==='pendientes'||g.fotos.length||g.guardado||g.recien===true);
    cerrarHoja();pintar();
  }
  async function preparar(i){if(!subidas.has(i))subidas.set(i,await op.preparar(files[i]));return subidas.get(i);}
  function cerrar(){if(ocupado)return;urls.forEach(URL.revokeObjectURL);document.querySelectorAll('.drag-fantasma').forEach(n=>n.remove());document.removeEventListener('keydown',tecla);ov.remove();
    // Si una creación perdió su respuesta, conservar también esas fotos: el servidor pudo guardarla.
    const protegidas=new Set(grupos.filter(g=>g.ref).flatMap(g=>g.fotos));
    for(const [i,f] of subidas)if(!guardados.has(i)&&!protegidas.has(i))op.limpiar(f).catch(console.warn);
  }
  function tecla(e){
    if(visor){if(e.key==='Escape'){visor=null;pintar();}else if(e.key==='ArrowRight'||e.key==='ArrowLeft'){pasarVisor(e.key==='ArrowRight'?1:-1);}return;}
    if(e.key==='Escape'){if(hoja){cerrarHoja();pintar();}else cerrar();}
  }
  document.addEventListener('keydown',tecla);
  async function sugerir(){
    if(ocupado)return;ocupado=true;aviso='Preparando fotos y buscando productos…';
    try{
      const paths=[];
      const n=Math.min(20,files.length);
      for(let i=0;i<n;i++){avanzar('Preparando tus fotos',`Foto ${i+1} de ${n}`,i,n+1);paths.push((await preparar(i)).thumb);}
      avanzar('La IA está agrupando tus fotos','Busca qué fotos son del mismo producto. Tarda unos segundos.',n,n+1);
      const resultado=normalizarGrupos(await op.agrupar(paths),files.length);
      grupos=[{id:'pendientes',nombre:'Por organizar',fotos:resultado.pendientes},...resultado.grupos.map(g=>({id:'grupo-'+(++numero),nombre:String(g.nombre||'Producto').charAt(0).toUpperCase()+String(g.nombre||'Producto').slice(1),fotos:g.fotos}))];
      aviso='Grupos sugeridos por IA: comprueba que sean el mismo producto y corrige los nombres antes de guardar.';
      if(files.length>20)aviso+=' La IA analizó las primeras 20 fotos; organiza las restantes tú.';
    }catch(e){aviso='No se pudo agrupar con IA. Puedes organizar las fotos tú. '+(e.message||'');}
    finally{ocupado=false;trabajo=null;pintar();}
  }
  async function guardar(){
    const pendientes=grupos.find(g=>g.id==='pendientes');
    const activos=editables().filter(g=>g.fotos.length);
    if(pendientes&&pendientes.fotos.length){aviso='Antes de guardar, ubica las fotos sin producto o quítalas del lote.';pintar();return;}
    if(!activos.length)return;
    if(!op.permitir(activos.length))return;
    ocupado=true;aviso='Guardando productos ocultos. No cierres esta ventana…';
    try{
      let k=0;
      for(const g of activos){
        avanzar('Guardando tus productos',`Producto ${++k} de ${activos.length}: ${g.nombre}. No cierres esta ventana.`,k-1,activos.length);
        const fotos=[];for(const i of g.fotos)fotos.push(await preparar(i));
        // Reutilizar el ID en un reintento evita duplicar una creación cuyo resultado se perdió.
        g.ref ||= op.referencia();
        await op.guardar(g.ref,g.nombre,fotos);
        g.guardado=true;g.fotos.forEach(i=>guardados.add(i));
      }
      const ids=grupos.filter(g=>g.guardado).map(g=>g.ref.id);
      ocupado=false;trabajo=null;cerrar();op.terminar(ids);
    }catch(e){aviso='Se conservan los productos guardados. Reintenta los pendientes: '+(e.message||'No se pudo guardar.');ocupado=false;trabajo=null;pintar();}
  }

  // ---------- Hoja de acciones (foto o producto) ----------
  function abrirHoja(tipo,datos){if(ocupado||(datos.i===ultimoArrastre.i&&Date.now()-ultimoArrastre.t<400))return;hoja={tipo,...datos};pintar();}
  function cerrarHoja(){hoja=null;}
  // Girar antes de guardar: se reemplaza el archivo; si ya se había preparado (subido), se prepara de nuevo.
  async function girar(i){
    if(ocupado)return;
    try{
      const b=await girarImagen(urls[i]);
      files[i]=new File([b],(files[i].name||'foto').replace(/\.[^.]+$/,'')+'.jpg',{type:'image/jpeg'});
      URL.revokeObjectURL(urls[i]);urls[i]=URL.createObjectURL(files[i]);
      if(subidas.has(i)){const vieja=subidas.get(i);subidas.delete(i);op.limpiar(vieja).catch(console.warn);}
      pintar();
    }catch(e){aviso='No se pudo girar la foto. '+(e.message||'');pintar();}
  }
  function abrirVisor(i,g){visor={i,lista:(g&&g.fotos.length?g.fotos:[i]).slice(),zoom:false,nombre:g&&g.id!=='pendientes'?g.nombre:'Sin producto'};pintar();}
  function pasarVisor(d){if(!visor)return;const k=visor.lista.indexOf(visor.i);visor.i=visor.lista[(k+d+visor.lista.length)%visor.lista.length];visor.zoom=false;pintar();}
  function pintarVisor(){
    const v=el('div',null,'org-visor'+(visor.zoom?' zoom':''));v.setAttribute('role','dialog');v.setAttribute('aria-modal','true');v.setAttribute('aria-label','Foto en grande');
    const arriba=el('div',null,'org-visor-barra');
    const k=visor.lista.indexOf(visor.i);
    arriba.append(el('span',`${visor.nombre}${visor.lista.length>1?` · ${k+1} de ${visor.lista.length}`:''}`,'org-visor-titulo'));
    const x=boton('✕',()=>{visor=null;pintar();},'org-visor-btn');x.setAttribute('aria-label','Cerrar foto');arriba.append(x);
    const marco=el('div',null,'org-visor-marco');const img=el('img');img.src=urls[visor.i];img.alt='Foto '+(visor.i+1);
    // Tocar la foto la acerca (2x) y se puede recorrer con el dedo; tocar otra vez la aleja.
    img.onclick=()=>{visor.zoom=!visor.zoom;pintar();};marco.append(img);
    v.append(arriba,marco);
    if(visor.lista.length>1){
      const ant=boton('‹',()=>pasarVisor(-1),'org-visor-btn org-visor-ant');ant.setAttribute('aria-label','Foto anterior');
      const sig=boton('›',()=>pasarVisor(1),'org-visor-btn org-visor-sig');sig.setAttribute('aria-label','Foto siguiente');
      v.append(ant,sig);
    }
    v.append(el('p',visor.zoom?'Toca la foto para alejar':'Toca la foto para acercar','org-visor-ayuda'));
    return v;
  }
  function pintarHoja(){
    const fondo=el('div',null,'org-hoja-fondo');fondo.onclick=e=>{if(e.target===fondo){cerrarHoja();pintar();}};
    const panel=el('div',null,'org-hoja');panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');
    const cerrarX=boton('✕',()=>{cerrarHoja();pintar();},'btn org-hoja-x');cerrarX.setAttribute('aria-label','Cerrar');
    // Cada destino se reconoce por su foto de portada, no solo por el nombre (los nombres suelen parecerse).
    const fila=(x,accion,etiqueta)=>{
      const b=boton('',accion,'org-destino');b.setAttribute('aria-label',etiqueta+' '+x.nombre);
      const img=el('img');img.src=urls[x.fotos[0]];img.alt='';
      const t=el('span',null,'org-destino-txt');t.append(el('strong',x.nombre),el('span',fotosTxt(x.fotos.length)));
      b.append(img,t);
      const ver=boton('🔍',e=>{e.stopPropagation();abrirVisor(x.fotos[0],x);},'btn org-destino-ver');ver.setAttribute('aria-label','Ver fotos de '+x.nombre);
      const f=el('div',null,'org-destino-fila');f.append(b,ver);return f;
    };
    const lista=el('div',null,'org-destinos');
    const pie=el('div',null,'org-hoja-acciones');
    if(hoja.tipo==='foto'){
      const g=grupos.find(x=>x.fotos.includes(hoja.i));
      const enProducto=g&&g.id!=='pendientes';
      panel.setAttribute('aria-label','Opciones de la foto');
      const grande=boton('',()=>abrirVisor(hoja.i,g),'org-hoja-foto');grande.setAttribute('aria-label','Ver la foto en grande');
      const gimg=el('img');gimg.src=urls[hoja.i];gimg.alt='Foto '+(hoja.i+1);grande.append(gimg,el('span','🔍 Ver en grande','org-hoja-lupa'));
      panel.append(grande);
      const cab=el('div',null,'org-hoja-cab');
      const txt=el('div');txt.append(el('strong',enProducto?'Esta foto está en':'Foto sin producto'),el('span',enProducto?g.nombre:'Elige a qué producto pertenece','note'));
      cab.append(txt,cerrarX);panel.append(cab,el('p',enProducto?'Moverla a otro producto':'¿De qué producto es?','org-hoja-titulo'));
      editables().filter(x=>x!==g&&x.fotos.length).forEach(x=>lista.append(fila(x,()=>mover(hoja.i,x.id),'Mover a')));
      const nuevoB=boton('',()=>mover(hoja.i,'nuevo'),'org-destino org-destino-nuevo');nuevoB.setAttribute('aria-label','Mover a un producto nuevo');
      nuevoB.append(el('span','+','org-destino-mas'),el('strong','Producto nuevo'));
      lista.append(nuevoB);panel.append(lista);
      pie.append(boton('↻ Girar foto',()=>girar(hoja.i)));
      if(enProducto&&g.fotos[0]!==hoja.i)pie.append(boton('★ Usar como portada',()=>{g.fotos=[hoja.i,...g.fotos.filter(x=>x!==hoja.i)];cerrarHoja();pintar();}));
      if(enProducto&&g.fotos.length>1)pie.append(boton('Dejar sin producto',()=>mover(hoja.i,'pendientes')));
      pie.append(boton('🗑 No subir esta foto',()=>{g.fotos=g.fotos.filter(x=>x!==hoja.i);grupos=grupos.filter(x=>x.id==='pendientes'||x.fotos.length||x.guardado);cerrarHoja();pintar();},'btn org-peligro'));
    } else {
      const g=grupos.find(x=>x.id===hoja.id);
      panel.setAttribute('aria-label','Opciones de '+g.nombre);
      const cab=el('div',null,'org-hoja-cab');const img=el('img');img.src=urls[g.fotos[0]];img.alt='';
      const txt=el('div');txt.append(el('strong',g.nombre),el('span',fotosTxt(g.fotos.length),'note'));
      cab.append(img,txt,cerrarX);panel.append(cab,el('p','¿Es el mismo producto que…? Junta sus fotos','org-hoja-titulo'));
      const otros=editables().filter(x=>x!==g&&x.fotos.length);
      otros.forEach(x=>lista.append(fila(x,()=>{x.fotos.push(...g.fotos);grupos=grupos.filter(y=>y!==g);cerrarHoja();pintar();},'Juntar con')));
      if(!otros.length)lista.append(el('p','No hay otros productos.','note'));
      panel.append(lista);
      pie.append(boton('Deshacer producto (sus fotos quedan sin producto)',()=>{
        if(!grupos.some(x=>x.id==='pendientes'))grupos.unshift({id:'pendientes',nombre:'Por organizar',fotos:[]});
        grupos.find(x=>x.id==='pendientes').fotos.push(...g.fotos);grupos=grupos.filter(y=>y!==g);cerrarHoja();pintar();
      },'btn org-peligro'));
    }
    panel.append(pie);
    fondo.append(panel);
    return fondo;
  }

  // ---------- Pantalla ----------
  function miniatura(g,i,pos){
    const ficha=el('button',null,'foto-organizar');ficha.type='button';ficha.disabled=ocupado||!!g.guardado;
    ficha.setAttribute('aria-label',`Foto ${i+1}${pos===0&&g.id!=='pendientes'?' (portada)':''}. Opciones`);
    const img=el('img');img.src=urls[i];img.alt='';img.draggable=false;ficha.append(img);
    if(pos===0&&g.id!=='pendientes')ficha.append(el('span','Portada','org-portada'));
    if(!g.guardado){
      ficha.onclick=()=>abrirHoja('foto',{i});
      // Asa para arrastrar en celular (la foto deja hacer scroll); en computadora se arrastra la foto entera.
      const asa=el('span','⠿','org-asa');asa.setAttribute('aria-hidden','true');ficha.append(asa);
      const soltar=z=>{ultimoArrastre={t:Date.now(),i};if(z.dataset.grupo!==g.id)mover(i,z.dataset.grupo);};
      arrastrable(ficha,{destino:'[data-grupo]',soltar});arrastrable(asa,{destino:'[data-grupo]',soltar});
    }
    return ficha;
  }
  function pintar(){
    const scroll=ov.querySelector('.organizador-cuerpo')?.scrollTop||0;
    // Si la foto que se arrastraba desapareció al redibujar, su sombra no debe quedarse flotando.
    document.querySelectorAll('.drag-fantasma').forEach(n=>n.remove());
    ov.textContent='';
    const card=el('div',null,'cart organizador');card.setAttribute('role','dialog');card.setAttribute('aria-modal','true');card.setAttribute('aria-label','Organizar fotos por producto');
    const head=el('div',null,'cart-head org-head');
    const titulos=el('div');titulos.append(el('h2','Organizar fotos por producto'));
    if(!trabajo){const estado=el('p',aviso,'note org-aviso');estado.setAttribute('role','status');titulos.append(estado);}
    head.append(titulos,boton('Cerrar',cerrar,'btn org-cerrar'));
    card.append(head);
    if(op.instrucciones)card.append(el('p','Tus indicaciones: '+op.instrucciones,'note instrucciones-fotos'));

    const prods=productos().filter(g=>g.fotos.length||g.recien);
    const barra=el('div',null,'org-barra');
    const total=grupos.reduce((n,g)=>n+g.fotos.length,0);
    barra.append(el('span',`${prods.length} producto${prods.length===1?'':'s'} · ${fotosTxt(total)}`,'org-resumen'));
    const ia=boton('✨ Sugerir con IA',sugerir,'btn org-ia');ia.setAttribute('aria-label','Sugerir grupos con IA');ia.disabled=ocupado||guardados.size>0;barra.append(ia);
    card.append(barra);

    if(trabajo){
      const panel=el('div',null,'org-trabajo');panel.setAttribute('role','status');panel.setAttribute('aria-live','polite');
      const giro=el('span',null,'org-giro');giro.setAttribute('aria-hidden','true');
      const txt=el('div',null,'org-trabajo-txt');txt.append(el('strong',trabajo.titulo+'…'),el('span',trabajo.paso));
      const barraP=el('div',null,'org-trabajo-barra');const lleno=el('span');lleno.style.width=Math.max(6,Math.round(100*trabajo.actual/trabajo.total))+'%';barraP.append(lleno);
      panel.append(giro,txt,barraP);card.append(panel);
    }
    const cuerpo=el('div',null,'organizador-cuerpo'+(trabajo?' org-ocupado':''));
    const pend=grupos.find(g=>g.id==='pendientes');
    if(pend&&pend.fotos.length){
      const zona=el('section',null,'foto-grupo org-bandeja');zona.dataset.grupo='pendientes';
      const cab=el('div',null,'org-bandeja-cab');
      cab.append(el('strong',`Fotos sin producto (${pend.fotos.length})`),el('span','Tócalas para elegir su producto','note'));
      const galeria=el('div',null,'fotos-organizar');pend.fotos.forEach((i,p)=>galeria.append(miniatura(pend,i,p)));
      zona.append(cab,galeria);cuerpo.append(zona);
    }
    const rejilla=el('div',null,'org-rejilla');
    for(const g of productos()){
      if(!g.fotos.length&&!g.recien&&!g.guardado)continue;
      const zona=el('section',null,'foto-grupo org-producto'+(g.guardado?' guardado':''));if(!g.guardado)zona.dataset.grupo=g.id;
      const cab=el('div',null,'org-prod-cab');
      const nombre=el('input');nombre.value=g.nombre;nombre.placeholder='¿Qué producto es?';nombre.setAttribute('aria-label','Nombre del producto');
      nombre.disabled=ocupado||!!g.guardado;nombre.oninput=()=>{g.nombre=nombre.value.trim()||'Producto';};
      nombre.onfocus=()=>{if(/^producto \d+$/i.test(nombre.value))nombre.select();};
      cab.append(nombre);
      if(!g.guardado){const mas=boton('⋯',()=>abrirHoja('grupo',{id:g.id}),'btn org-mas');mas.setAttribute('aria-label','Más opciones de '+g.nombre);cab.append(mas);}
      zona.append(cab);
      const galeria=el('div',null,'fotos-organizar');g.fotos.forEach((i,p)=>galeria.append(miniatura(g,i,p)));
      if(!g.fotos.length)galeria.append(el('p','Arrastra fotos aquí o tócalas y elige este producto.','note org-vacio'));
      zona.append(galeria,el('p',g.guardado?'✓ Guardado como oculto':fotosTxt(g.fotos.length),'note org-cuenta'));
      rejilla.append(zona);
    }
    const zonaNueva=el('section',null,'foto-grupo org-nuevo');zonaNueva.dataset.grupo='nuevo';
    zonaNueva.append(boton('+ Nuevo producto',()=>{const id=nuevo();grupos.find(x=>x.id===id).recien=true;pintar();ov.querySelector(`[data-grupo="${id}"] input`)?.focus();},'org-nuevo-btn'));
    rejilla.append(zonaNueva);
    cuerpo.append(rejilla);
    card.append(cuerpo);

    const pie=el('div',null,'org-pie');
    const faltan=pend?pend.fotos.length:0;
    pie.append(trabajo?el('p','Espera un momento…','note org-pie-nota'):el('p',faltan?`Falta ubicar ${fotosTxt(faltan)}.`:'Se guardan ocultos: los revisas antes de publicarlos.','note org-pie-nota'+(faltan?' org-falta':'')));
    const guardarBtn=boton('Guardar productos ocultos y revisar',guardar,'btn primary org-guardar');
    guardarBtn.disabled=ocupado||!editables().some(g=>g.fotos.length);
    pie.append(guardarBtn);
    card.append(pie);
    if(hoja)card.append(pintarHoja());
    if(visor)card.append(pintarVisor());
    ov.append(card);
    const c=ov.querySelector('.organizador-cuerpo');if(c)c.scrollTop=scroll;
    if(visor)ov.querySelector('.org-visor .org-visor-btn')?.focus();else if(hoja)(ov.querySelector('.org-hoja .org-destino')||ov.querySelector('.org-hoja button'))?.focus();
  }
  pintar();
  if(op.autoSugerir)sugerir();
}
