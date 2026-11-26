import {arrastrable} from './arrastrar.js';
import {normalizarGrupos,moverFoto} from './grupos-fotos.js';

// Organizador de fotos: cada tarjeta es un producto. Las acciones de cada foto (mover, portada, quitar)
// están en una hoja que se abre al tocar la foto, para que la pantalla muestre fotos y no botones.
export function abrirOrganizador(files, op){
  if(!files.length) return;
  const urls=files.map(f=>URL.createObjectURL(f));
  let grupos=[{id:'pendientes',nombre:'Por organizar',fotos:files.map((_,i)=>i)}], numero=0, ocupado=false;
  const subidas=new Map(), guardados=new Set();
  let aviso='Toca una foto para elegir a qué producto va, o arrástrala. Nada se publica automáticamente.';
  let hoja=null, ultimoArrastre={t:0,i:-1};
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
  function tecla(e){if(e.key==='Escape'){if(hoja){cerrarHoja();pintar();}else cerrar();}}
  document.addEventListener('keydown',tecla);
  async function sugerir(){
    if(ocupado)return;ocupado=true;aviso='Preparando fotos y buscando productos…';pintar();
    try{
      const paths=[];
      for(let i=0;i<Math.min(20,files.length);i++)paths.push((await preparar(i)).thumb);
      const resultado=normalizarGrupos(await op.agrupar(paths),files.length);
      grupos=[{id:'pendientes',nombre:'Por organizar',fotos:resultado.pendientes},...resultado.grupos.map(g=>({id:'grupo-'+(++numero),nombre:g.nombre,fotos:g.fotos}))];
      aviso='Grupos sugeridos por IA: comprueba que sean el mismo producto y corrige los nombres antes de guardar.';
      if(files.length>20)aviso+=' La IA analizó las primeras 20 fotos; organiza las restantes tú.';
    }catch(e){aviso='No se pudo agrupar con IA. Puedes organizar las fotos tú. '+(e.message||'');}
    finally{ocupado=false;pintar();}
  }
  async function guardar(){
    const pendientes=grupos.find(g=>g.id==='pendientes');
    const activos=editables().filter(g=>g.fotos.length);
    if(pendientes&&pendientes.fotos.length){aviso='Antes de guardar, ubica las fotos sin producto o quítalas del lote.';pintar();return;}
    if(!activos.length)return;
    if(!op.permitir(activos.length))return;
    ocupado=true;aviso='Guardando productos ocultos. No cierres esta ventana…';pintar();
    try{
      for(const g of activos){
        const fotos=[];for(const i of g.fotos)fotos.push(await preparar(i));
        // Reutilizar el ID en un reintento evita duplicar una creación cuyo resultado se perdió.
        g.ref ||= op.referencia();
        await op.guardar(g.ref,g.nombre,fotos);
        g.guardado=true;g.fotos.forEach(i=>guardados.add(i));
      }
      const ids=grupos.filter(g=>g.guardado).map(g=>g.ref.id);
      ocupado=false;cerrar();op.terminar(ids);
    }catch(e){aviso='Se conservan los productos guardados. Reintenta los pendientes: '+(e.message||'No se pudo guardar.');ocupado=false;pintar();}
  }

  // ---------- Hoja de acciones (foto o producto) ----------
  function abrirHoja(tipo,datos){if(ocupado||(datos.i===ultimoArrastre.i&&Date.now()-ultimoArrastre.t<400))return;hoja={tipo,...datos};pintar();}
  function cerrarHoja(){hoja=null;}
  function pintarHoja(){
    const fondo=el('div',null,'org-hoja-fondo');fondo.onclick=e=>{if(e.target===fondo){cerrarHoja();pintar();}};
    const panel=el('div',null,'org-hoja');panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');
    const cancelar=boton('Cancelar',()=>{cerrarHoja();pintar();},'btn org-hoja-cancelar');
    if(hoja.tipo==='foto'){
      const g=grupos.find(x=>x.fotos.includes(hoja.i));
      panel.setAttribute('aria-label','Opciones de la foto');
      const cab=el('div',null,'org-hoja-cab');const img=el('img');img.src=urls[hoja.i];img.alt='';
      const txt=el('div');txt.append(el('strong','Foto '+(hoja.i+1)),el('span',g&&g.id!=='pendientes'?'En: '+g.nombre:'Sin producto todavía','note'));
      cab.append(img,txt);panel.append(cab,el('p','Mover a','org-hoja-titulo'));
      const destinos=el('div',null,'org-chips');
      editables().filter(x=>x!==g).forEach(x=>destinos.append(boton(x.nombre,()=>mover(hoja.i,x.id),'chip org-chip')));
      destinos.append(boton('+ Producto nuevo',()=>mover(hoja.i,'nuevo'),'chip org-chip org-chip-nuevo'));
      panel.append(destinos);
      const acciones=el('div',null,'org-hoja-acciones');
      if(g&&g.id!=='pendientes'&&g.fotos[0]!==hoja.i)acciones.append(boton('★ Usar como portada',()=>{g.fotos=[hoja.i,...g.fotos.filter(x=>x!==hoja.i)];cerrarHoja();pintar();}));
      if(g&&g.id!=='pendientes'&&g.fotos.length>1)acciones.append(boton('Sacar de este producto',()=>mover(hoja.i,'pendientes')));
      acciones.append(boton('Quitar del lote',()=>{g.fotos=g.fotos.filter(x=>x!==hoja.i);grupos=grupos.filter(x=>x.id==='pendientes'||x.fotos.length||x.guardado);cerrarHoja();pintar();},'btn org-peligro'));
      panel.append(acciones,cancelar);
    } else {
      const g=grupos.find(x=>x.id===hoja.id);
      panel.setAttribute('aria-label','Opciones de '+g.nombre);
      panel.append(el('p',g.nombre,'org-hoja-nombre'),el('p','Juntar con (las fotos pasan a ese producto)','org-hoja-titulo'));
      const destinos=el('div',null,'org-chips');
      const otros=editables().filter(x=>x!==g);
      otros.forEach(x=>destinos.append(boton(x.nombre,()=>{x.fotos.push(...g.fotos);grupos=grupos.filter(y=>y!==g);cerrarHoja();pintar();},'chip org-chip')));
      if(!otros.length)destinos.append(el('span','No hay otros productos.','note'));
      panel.append(destinos,el('div',null,'org-hoja-acciones'));
      panel.lastChild.append(boton('Deshacer producto (sus fotos quedan sin producto)',()=>{
        if(!grupos.some(x=>x.id==='pendientes'))grupos.unshift({id:'pendientes',nombre:'Por organizar',fotos:[]});
        grupos.find(x=>x.id==='pendientes').fotos.push(...g.fotos);grupos=grupos.filter(y=>y!==g);cerrarHoja();pintar();
      },'btn org-peligro'));
      panel.append(cancelar);
    }
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
    const estado=el('p',aviso,'note org-aviso');estado.setAttribute('role','status');titulos.append(estado);
    head.append(titulos,boton('Cerrar',cerrar,'btn org-cerrar'));
    card.append(head);
    if(op.instrucciones)card.append(el('p','Tus indicaciones: '+op.instrucciones,'note instrucciones-fotos'));

    const prods=productos().filter(g=>g.fotos.length||g.recien);
    const barra=el('div',null,'org-barra');
    const total=grupos.reduce((n,g)=>n+g.fotos.length,0);
    barra.append(el('span',`${prods.length} producto${prods.length===1?'':'s'} · ${fotosTxt(total)}`,'org-resumen'));
    const ia=boton('✨ Sugerir con IA',sugerir,'btn org-ia');ia.setAttribute('aria-label','Sugerir grupos con IA');ia.disabled=ocupado||guardados.size>0;barra.append(ia);
    card.append(barra);

    const cuerpo=el('div',null,'organizador-cuerpo');
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
    pie.append(el('p',faltan?`Falta ubicar ${fotosTxt(faltan)}.`:'Se guardan ocultos: los revisas antes de publicarlos.','note org-pie-nota'+(faltan?' org-falta':'')));
    const guardarBtn=boton('Guardar productos ocultos y revisar',guardar,'btn primary org-guardar');
    guardarBtn.disabled=ocupado||!editables().some(g=>g.fotos.length);
    pie.append(guardarBtn);
    card.append(pie);
    if(hoja)card.append(pintarHoja());
    ov.append(card);
    const c=ov.querySelector('.organizador-cuerpo');if(c)c.scrollTop=scroll;
    if(hoja)ov.querySelector('.org-hoja button')?.focus();
  }
  pintar();
  if(op.autoSugerir)sugerir();
}
