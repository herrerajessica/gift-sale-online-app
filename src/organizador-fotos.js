import {arrastrable} from './arrastrar.js';
import {normalizarGrupos,moverFoto} from './grupos-fotos.js';

export function abrirOrganizador(files, op){
  if(!files.length) return;
  const urls=files.map(f=>URL.createObjectURL(f));
  let grupos=[{id:'pendientes',nombre:'Por organizar',fotos:files.map((_,i)=>i)}], numero=0, ocupado=false;
  const subidas=new Map(), guardados=new Set();
  let aviso='Arrastra las fotos a un producto o usa “Mover a…”. Nada se publica automáticamente.';
  const ov=document.createElement('div'); ov.className='overlay'; document.body.append(ov);
  const el=(tag,txt,clase)=>{const n=document.createElement(tag);if(txt)n.textContent=txt;if(clase)n.className=clase;return n;};
  const boton=(texto,fn)=>{const b=el('button',texto,'btn'); b.type='button';b.disabled=ocupado;b.onclick=fn;return b;};
  function nuevo(){const id='grupo-'+(++numero);grupos.push({id,nombre:'Producto '+numero,fotos:[]});return id;}
  function mover(i,id){if(ocupado)return;if(id==='nuevo')id=nuevo();grupos=moverFoto(grupos,i,id);pintar();}
  async function preparar(i){if(!subidas.has(i))subidas.set(i,await op.preparar(files[i]));return subidas.get(i);}
  function cerrar(){if(ocupado)return;urls.forEach(URL.revokeObjectURL);ov.remove();
    // Si una creación perdió su respuesta, conservar también esas fotos: el servidor pudo guardarla.
    const protegidas=new Set(grupos.filter(g=>g.ref).flatMap(g=>g.fotos));
    for(const [i,f] of subidas)if(!guardados.has(i)&&!protegidas.has(i))op.limpiar(f).catch(console.warn);
  }
  async function sugerir(){
    if(ocupado)return;ocupado=true;aviso='Preparando fotos y buscando productos…';pintar();
    try{
      const paths=[];
      for(let i=0;i<Math.min(20,files.length);i++)paths.push((await preparar(i)).thumb);
      const resultado=normalizarGrupos(await op.agrupar(paths),files.length);
      grupos=[{id:'pendientes',nombre:'Por organizar',fotos:resultado.pendientes},...resultado.grupos.map(g=>({id:'grupo-'+(++numero),nombre:g.nombre,fotos:g.fotos}))];
      aviso='Grupos sugeridos por IA: comprueba que sean el mismo producto antes de guardar.';
      if(files.length>20)aviso+=' La IA analizó las primeras 20 fotos; organiza las restantes manualmente.';
    }catch(e){aviso='No se pudo agrupar con IA. Puedes organizar todas las fotos manualmente. '+(e.message||'');}
    finally{ocupado=false;pintar();}
  }
  async function guardar(){
    const activos=grupos.filter(g=>g.id!=='pendientes'&&g.fotos.length&&!g.guardado);
    if(grupos[0].fotos.length){aviso='Asigna todas las fotos de “Por organizar” o quítalas del lote.';pintar();return;}
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
    }catch(e){aviso='Se conservan los grupos guardados. Reintenta los pendientes: '+(e.message||'No se pudo guardar.');ocupado=false;pintar();}
  }
  function pintar(){
    ov.textContent='';
    const card=el('div',null,'cart organizador');card.setAttribute('role','dialog');card.setAttribute('aria-modal','true');card.setAttribute('aria-label','Organizar fotos por producto');
    const head=el('div',null,'cart-head');head.append(el('h2','Organizar fotos por producto'),boton('Cerrar',cerrar));
    const estado=el('p',aviso,'note');estado.setAttribute('role','status');
    const cuerpo=el('div',null,'organizador-cuerpo');
    const zonaNueva=el('div',null,'foto-grupo');zonaNueva.dataset.grupo='nuevo';zonaNueva.append(boton('+ Nuevo producto',()=>{nuevo();pintar();}));
    for(const g of grupos){
      const zona=el('section',null,'foto-grupo');if(!g.guardado)zona.dataset.grupo=g.id;
      const nombre=el('input');nombre.value=g.nombre;nombre.setAttribute('aria-label','Nombre del producto');nombre.disabled=ocupado||g.id==='pendientes'||g.guardado;
      nombre.onchange=()=>{g.nombre=nombre.value.trim()||'Producto';};
      zona.append(nombre,el('p',g.guardado?'Guardado como oculto':g.fotos.length+' fotos · primera foto = portada','note'));
      const galeria=el('div',null,'fotos-organizar');
      for(const i of g.fotos){
        const ficha=el('div',null,'foto-organizar');const img=el('img');img.src=urls[i];img.alt='Foto '+(i+1);img.draggable=false;ficha.append(img);
        if(!g.guardado){
          const asa=boton('⠿ Mover foto',()=>{});asa.classList.add('drag-asa');
          arrastrable(asa,{destino:'[data-grupo]',soltar:z=>mover(i,z.dataset.grupo)});
          const destino=el('select');destino.setAttribute('aria-label','Mover foto '+(i+1)+' a');destino.disabled=ocupado;
          const opciones=[['','Mover a…'],...grupos.filter(x=>!x.guardado&&x.id!==g.id).map(x=>[x.id,x.nombre]),['nuevo','Nuevo producto']];
          for(const [id,t] of opciones){const o=el('option',t);o.value=id;destino.append(o);}
          destino.onchange=()=>mover(i,destino.value);
          ficha.append(asa,destino,boton('Portada',()=>{g.fotos=[i,...g.fotos.filter(x=>x!==i)];pintar();}),boton('Quitar del lote',()=>{g.fotos=g.fotos.filter(x=>x!==i);pintar();}));
        }
        galeria.append(ficha);
      }
      zona.append(galeria);
      if(g.id!=='pendientes'&&!g.guardado){
        const unir=el('select');unir.setAttribute('aria-label','Juntar grupo '+g.nombre+' con');unir.disabled=ocupado;
        const vacio=el('option','Juntar este grupo con…');vacio.value='';unir.append(vacio);
        grupos.filter(x=>x.id!==g.id&&x.id!=='pendientes'&&!x.guardado).forEach(x=>{const o=el('option',x.nombre);o.value=x.id;unir.append(o);});
        unir.onchange=()=>{const d=grupos.find(x=>x.id===unir.value);d.fotos.push(...g.fotos);grupos=grupos.filter(x=>x.id!==g.id);pintar();};zona.append(unir);
      }
      cuerpo.append(zona);
    }
    cuerpo.append(zonaNueva);
    const ia=boton('Sugerir grupos con IA',sugerir);ia.disabled=ocupado||guardados.size>0;
    card.append(head,estado);
    if(op.instrucciones)card.append(el('p','Tus indicaciones: '+op.instrucciones,'note instrucciones-fotos'));
    card.append(ia,cuerpo,boton('Guardar productos ocultos y revisar',guardar));ov.append(card);
  }
  pintar();
  if(op.autoSugerir)sugerir();
}
