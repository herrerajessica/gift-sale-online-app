// Pointer Events: el mismo gesto funciona con mouse, lápiz y pantalla táctil.
export function arrastrable(nodo, {destino, soltar}) {
  let gesto;
  const limpiar = () => {
    if(!gesto) return;
    clearTimeout(gesto.reloj); gesto.sombra?.remove(); gesto.sobre?.classList.remove('drag-destino');
    gesto = null;
  };
  nodo.addEventListener('pointerdown', e => {
    if(e.button !== 0) return;
    limpiar();
    nodo.setPointerCapture(e.pointerId);
    gesto = {id:e.pointerId, x:e.clientX,y:e.clientY,activo:false};
    gesto.reloj = setTimeout(()=>{
      // Si la foto ya no está en pantalla (se abrió la hoja o se redibujó), no se empieza a arrastrar.
      if(!gesto || !nodo.isConnected){ limpiar(); return; }
      gesto.activo=true;
      gesto.sombra=nodo.cloneNode(true); gesto.sombra.classList.add('drag-fantasma');
      gesto.sombra.style.left=gesto.x+'px'; gesto.sombra.style.top=gesto.y+'px';
      document.body.append(gesto.sombra);
      navigator.vibrate?.(25);
    }, e.pointerType==='touch'?300:80);
  });
  nodo.addEventListener('pointermove', e => {
    if(!gesto || gesto.id!==e.pointerId) return;
    if(!gesto.activo) return;
    e.preventDefault();
    gesto.sombra.style.left=e.clientX+'px'; gesto.sombra.style.top=e.clientY+'px';
    const sobre=document.elementFromPoint(e.clientX,e.clientY)?.closest(destino);
    gesto.sobre?.classList.remove('drag-destino'); gesto.sobre=sobre;
    sobre?.classList.add('drag-destino');
    const area=sobre?.closest('.organizador-cuerpo');
    if(area){const r=area.getBoundingClientRect(); if(e.clientY>r.bottom-55) area.scrollTop+=18; else if(e.clientY<r.top+55) area.scrollTop-=18;}
    else if(e.clientY>innerHeight-65) window.scrollBy(0,18);
    else if(e.clientY<65) window.scrollBy(0,-18);
  });
  nodo.addEventListener('pointerup', e => {
    if(!gesto || gesto.id!==e.pointerId) return;
    const sobre=gesto.sobre, activo=gesto.activo;
    limpiar(); if(activo && sobre) soltar(sobre);
  });
  nodo.addEventListener('pointercancel',limpiar);
  // Respaldo: el dedo se levantó fuera de la foto o la foto se redibujó en medio del gesto.
  window.addEventListener('pointerup',e=>{ if(gesto && gesto.id===e.pointerId && !nodo.isConnected) limpiar(); });
  nodo.addEventListener('click',()=>{ if(gesto && !gesto.activo) limpiar(); });
  nodo.addEventListener('lostpointercapture',limpiar);
  nodo.addEventListener('contextmenu',e=>e.preventDefault());
}
