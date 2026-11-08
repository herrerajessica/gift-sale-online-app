import {
  FOTOS_BASE, db, assets, ai, sesion, usarModoPublico, usarModoVendedora, estadoCatalogo,
  miTienda, crearTienda, listarTiendas, cambiarEstadoTienda, limpiarSlug, SLUG_RE,
  signIn, signOut, signUp, confirmSignUp, resendSignUpCode, confirmSignIn,
  googleDisponible, entrarConGoogle, alVolverDeGoogle,
  PLANES, planVigente, tieneFondoIA, pagarPlan, quitarFondo, cancelarPlan, conectarCobros, estadoCobros, pagarPedido, pedidoYape,
  miTiendaActual, listarPedidos, cambiarEstadoPedido, cambiarPlanTienda,
} from './amplify-adapter.js';

// Lógica de la Vitrina USA (misma que la versión de Claude).

  const $ = id => document.getElementById(id);
  const S = { db:null, assets:null, canEdit:false, products:[], config:{}, q:"", cat:"", mode:"each", pub:"",
              selecting:false, sel:new Set(), pending:[] };
  const money = n => (typeof n === "number" && isFinite(n)) ? "$" + n.toLocaleString("en-US",{minimumFractionDigits: n%1?2:0, maximumFractionDigits:2}) : "";
  const rate = () => { const r = parseFloat(S.config.tipoCambio); return isFinite(r) && r>0 ? r : null; };
  const soles = n => { const r=rate(); return (r && typeof n==="number" && isFinite(n)) ? "S/ " + Math.round(n*r).toLocaleString("es-PE") : ""; };
  const dual = n => { const a=money(n), b=soles(n); return a && b ? a+" · "+b : a; };
  const parseStock = v => { const t=String(v??"").trim(); if(t==="") return null; const n=parseInt(t.replace(/\D/g,""),10); return isFinite(n) ? Math.min(n, 99999) : null; };
  // Un producto no se puede pedir si está vendido o su cantidad llegó a 0.
  const agotado = p => p.estado==="vendido" || p.stock===0;
  const parsePrice = v => { const n = parseFloat(String(v||"").replace(/[^0-9.]/g,"")); return isFinite(n) ? Math.round(n*100)/100 : null; };
  const src = id => FOTOS_BASE + "/" + id;
  let toastT;
  function toast(msg){ const t=$("toast"); t.textContent=msg; t.hidden=false; clearTimeout(toastT); toastT=setTimeout(()=>t.hidden=true,2800); }
  function el(tag, attrs, ...kids){ const e=document.createElement(tag); for(const k in (attrs||{})){ if(k==="class") e.className=attrs[k]; else if(k.startsWith("on")) e.addEventListener(k.slice(2),attrs[k]); else if(attrs[k]!==false && attrs[k]!=null) e.setAttribute(k,attrs[k]); } for(const c of kids){ if(c==null) continue; e.append(c.nodeType?c:document.createTextNode(c)); } return e; }

  function nameFromFile(f){
    let n = f.name.replace(/\.[^.]+$/,"").replace(/[_\-]+/g," ").replace(/\s+/g," ").trim();
    const rest = n.replace(/^(whatsapp image|screenshot|captura de pantalla|captura|img|dscn?|pxl|photo|image|foto)/i,"").replace(/\b(at|a las|de|\d+)\b/gi,"").replace(/[\s.:()]/g,"");
    if(!n || !/[a-záéíóúñ]{3,}/i.test(rest)) return "Producto nuevo";
    return n.charAt(0).toUpperCase() + n.slice(1);
  }

  // ---------- Compresión ----------
  async function decode(file){
    if (window.createImageBitmap) { try { return await createImageBitmap(file, {imageOrientation:"from-image"}); } catch(e){} }
    return await new Promise((res,rej)=>{ const u=URL.createObjectURL(file); const i=new Image(); i.onload=()=>{res(i);}; i.onerror=()=>{URL.revokeObjectURL(u);rej(new Error("decode"));}; i.src=u; });
  }
  function toBlob(img, max, q){
    return aBlob(lienzo(img, max), max, q);
  }
  // Dibuja la imagen sobre fondo blanco, reducida a "max" píxeles por lado.
  function lienzo(img, max){
    const w = img.width, h = img.height, s = Math.min(1, max/Math.max(w,h));
    const c = document.createElement("canvas"); c.width=Math.max(1,Math.round(w*s)); c.height=Math.max(1,Math.round(h*s));
    const x = c.getContext("2d"); x.fillStyle="#fff"; x.fillRect(0,0,c.width,c.height); x.drawImage(img,0,0,c.width,c.height);
    return c;
  }
  function aBlob(c, max, q){
    let src = c;
    const s = Math.min(1, max/Math.max(c.width,c.height));
    if(s < 1){ src = document.createElement("canvas"); src.width=Math.round(c.width*s); src.height=Math.round(c.height*s); const x=src.getContext("2d"); x.imageSmoothingQuality="high"; x.drawImage(c,0,0,src.width,src.height); }
    return new Promise((res,rej)=>src.toBlob(b=>b?res(b):rej(new Error("encode")),"image/jpeg",q));
  }

  // ---------- Mejora automática de fotos (en el navegador, sin costo) ----------
  // Corrige luz y color (niveles por canal), aclara fotos oscuras, sube un poco la saturación y la nitidez.
  function mejorarPixeles(c){
    const x = c.getContext("2d"), w = c.width, h = c.height;
    const d = x.getImageData(0,0,w,h), a = d.data, n = w*h;
    const H = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
    let lum = 0;
    for(let i=0;i<a.length;i+=4){ H[0][a[i]]++; H[1][a[i+1]]++; H[2][a[i+2]]++; lum += .299*a[i]+.587*a[i+1]+.114*a[i+2]; }
    const pct = (hh,p)=>{ let acc=0; const t=n*p; for(let v=0;v<256;v++){ acc+=hh[v]; if(acc>=t) return v; } return 255; };
    const lo = H.map(hh=>pct(hh,.005)), hi = H.map(hh=>pct(hh,.995));
    const gLo = Math.min(...lo), gHi = Math.max(...hi);
    const media = lum/n;
    const gamma = media < 95 ? .8 : media < 120 ? .9 : 1;
    const LUT = [0,1,2].map(k=>{
      // mezcla nivel por canal (balance de blancos) con nivel global, para no exagerar colores dominantes
      const l = (lo[k]+gLo)/2, hgh = (hi[k]+gHi)/2;
      const esc = hgh-l < 40 ? 1 : Math.min(255/(hgh-l), 1.8);
      const t = new Uint8ClampedArray(256);
      for(let v=0;v<256;v++){ const y = Math.min(1, Math.max(0, ((v-l)*esc)/255)); t[v] = Math.round(Math.pow(y, gamma)*255); }
      return t;
    });
    const orig = new Uint8ClampedArray(a.length);
    for(let i=0;i<a.length;i+=4){
      let r=LUT[0][a[i]], g=LUT[1][a[i+1]], b=LUT[2][a[i+2]];
      const gr = .299*r+.587*g+.114*b;
      orig[i]=gr+(r-gr)*1.12; orig[i+1]=gr+(g-gr)*1.12; orig[i+2]=gr+(b-gr)*1.12; orig[i+3]=a[i+3];
    }
    // nitidez suave (máscara de enfoque con los 4 vecinos)
    const k = .35, fila = w*4;
    for(let yy=0; yy<h; yy++) for(let xx=0; xx<w; xx++){
      const i = yy*fila + xx*4;
      if(yy===0||xx===0||yy===h-1||xx===w-1){ a[i]=orig[i]; a[i+1]=orig[i+1]; a[i+2]=orig[i+2]; continue; }
      for(let ch=0; ch<3; ch++){
        const v = orig[i+ch], m = (orig[i+ch-4]+orig[i+ch+4]+orig[i+ch-fila]+orig[i+ch+fila])/4;
        a[i+ch] = v + (v-m)*k;
      }
    }
    x.putImageData(d,0,0);
    return c;
  }
  const cargarImagen = src => new Promise((res,rej)=>{ const i=new Image(); i.onload=()=>res(i); i.onerror=()=>rej(new Error("imagen")); i.src=src; });

  const MODOS_FOTO = {
    original: { nombre:"Tal cual", desc:"Se suben las fotos originales, solo comprimidas." },
    mejorar:  { nombre:"Mejoradas", desc:"Luz, color y nitidez automáticos. Gratis e instantáneo." },
    fondo:    { nombre:"Fondo blanco (IA)", desc:"Mejoradas y con el fondo quitado por IA. Más lento; tiene un pequeño costo por foto." },
  };
  const MODO_KEY = "vitrina-modo-foto";
  const fondoPermitido = ()=> !!S.quitarFondo && tieneFondoIA(S.config||{});
  const modoGuardado = ()=>{ try{ const m = localStorage.getItem(MODO_KEY); return MODOS_FOTO[m] ? m : ""; }catch(e){ return ""; } };
  function pintarModoFoto(){
    const m = modoGuardado(), box = $("modoFotoInfo"); if(!box) return;
    box.hidden = !m; if(!m) return;
    $("modoFotoTxt").textContent = "Fotos: " + MODOS_FOTO[m].nombre;
  }

  /** Pregunta una vez por lote cómo subir las fotos, con muestra de antes y después. */
  function elegirModo(files){
    const recordado = modoGuardado();
    if(recordado && (recordado!=="fondo" || fondoPermitido())) return Promise.resolve(recordado);
    return new Promise(resolve=>{
      const ov = $("planOverlay"); ov.textContent=""; ov.hidden=false;
      let elegido = "mejorar";
      const cerrar = v=>{ ov.hidden=true; ov.textContent=""; ov.onclick=null; resolve(v); };
      ov.onclick = e=>{ if(e.target===ov) cerrar(null); };
      const muestras = el("div",{class:"muestras"});
      const opciones = el("div",{class:"modos",role:"radiogroup","aria-label":"Cómo subir las fotos"});
      const pintar = ()=>[...opciones.children].forEach(b=>b.setAttribute("aria-checked", String(b.dataset.modo===elegido)));
      for(const [k,v] of Object.entries(MODOS_FOTO)){
        if(k==="fondo" && !S.quitarFondo) continue;
        const bloqueado = k==="fondo" && !fondoPermitido();
        const b = el("button",{type:"button",class:"modo"+(bloqueado?" bloqueado":""),role:"radio","data-modo":k,"aria-disabled":bloqueado?"true":false,
          onclick:()=>{ if(bloqueado){ cerrar(null); abrirPlanes(); toast("El fondo blanco con IA está en el plan Plus"); return; } elegido=k; pintar(); }},
          el("strong",null, v.nombre + (k==="mejorar" ? " · recomendado" : "") + (bloqueado ? " · plan Plus" : "")),
          el("span",null, bloqueado ? "Disponible en el plan Plus. Toca para ver los planes." : v.desc));
        opciones.append(b);
      }
      pintar();
      const recordar = el("input",{type:"checkbox",id:"modoRecordar"});
      const subir = el("button",{class:"btn primary",type:"button",onclick:()=>{ if(recordar.checked){ try{ localStorage.setItem(MODO_KEY, elegido); }catch(e){} pintarModoFoto(); } cerrar(elegido); }}, `Subir ${files.length} foto${files.length===1?"":"s"}`);
      ov.append(el("div",{class:"cart",role:"dialog","aria-modal":"true","aria-label":"Cómo subir las fotos"},
        el("div",{class:"cart-head"}, el("h2",null,`¿Cómo subimos tus ${files.length} foto${files.length===1?"":"s"}?`), el("button",{class:"btn",type:"button",onclick:()=>cerrar(null)},"Cancelar")),
        el("p",{class:"note",style:"margin:0"},"La elección vale para todo el lote. Así se ven con la mejora automática:"),
        muestras, opciones,
        el("label",{class:"recordar"}, recordar, " Recordar mi elección para los próximos lotes"),
        el("div",{class:"send"}, subir)));
      // Muestras de antes y después (hasta 3 fotos del lote)
      files.slice(0,3).forEach(async f=>{
        const par = el("div",{class:"par"}); muestras.append(par);
        try{
          const img = await decode(f);
          const a = lienzo(img, 260), b = mejorarPixeles(lienzo(img, 260));
          par.append(el("figure",null, a, el("figcaption",null,"Antes")), el("figure",null, b, el("figcaption",null,"Después")));
        }catch(e){ par.remove(); }
      });
    });
  }

  async function processPhoto(file, modo="original"){
    let img;
    try { img = await decode(file); }
    catch(e){ throw new Error(/heic|heif/i.test(file.type+file.name) ? "formato HEIC: expórtala como JPG (en iPhone: Ajustes › Cámara › Formatos › Más compatible)" : "no se pudo leer la imagen"); }
    const up = async b => { try { return await S.assets.upload(b,{type:"image/jpeg"}); } catch(e){ if(e&&e.code==="store_unavailable"){ await new Promise(r=>setTimeout(r,800)); return await S.assets.upload(b,{type:"image/jpeg"}); } throw e; } };
    if(modo==="fondo" && fondoPermitido()){
      try { return await fotoSinFondo(img, up); }
      catch(e){ S.fondoFallos = (S.fondoFallos||0) + 1; modo = "mejorar"; }
    }
    const c = lienzo(img, 1600);
    if(modo==="mejorar" || modo==="fondo") mejorarPixeles(c);
    const full = await aBlob(c,1600,.82), thumb = await aBlob(c,520,.78);
    const f = await up(full); const t = await up(thumb);
    return { full:f.id, thumb:t.id, _blob:thumb };
  }
  // Fondo blanco: sube una copia de trabajo, la IA devuelve un PNG sin fondo
  // y aquí se pone sobre blanco con un margen, para la foto final y la miniatura.
  async function fotoSinFondo(img, up){
    const c = mejorarPixeles(lienzo(img, 1024));
    if(Math.min(c.width, c.height) < 320) throw new Error("foto muy pequeña para quitar el fondo");
    const trabajo = await up(await aBlob(c, 1024, .9));
    try{
      const r = await S.quitarFondo(trabajo.id);
      const png = await cargarImagen("data:image/png;base64," + r.png);
      const pad = Math.round(Math.max(png.width, png.height) * .06);
      const out = document.createElement("canvas"); out.width = png.width + pad*2; out.height = png.height + pad*2;
      const x = out.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0,0,out.width,out.height); x.drawImage(png, pad, pad);
      const full = await aBlob(out, 1600, .86), thumb = await aBlob(out, 520, .8);
      const f = await up(full); const t = await up(thumb);
      return { full:f.id, thumb:t.id, _blob:thumb };
    } finally {
      S.assets.delete(trabajo.id).catch(()=>{});
    }
  }
  function errText(e){
    const c = e && e.code;
    if(c==="too_large") return "archivo demasiado grande";
    if(c==="quota_or_state") return "se llenó el espacio de la vitrina; borra productos viejos";
    if(c==="rate_limited") return "demasiadas subidas seguidas; reintenta en un minuto";
    if(c==="not_granted"||c==="capability_disabled") return "no tienes permiso para subir aquí";
    return (e && e.message) || "error al subir";
  }

  // ---------- Subida en bloque ----------
  async function handleFiles(list){
    const files = [...list].filter(f => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
    if(!files.length){ toast("Ninguno de esos archivos es una foto"); return; }
    if(!S.assets || !S.db){ toast("Solo quien administra la vitrina puede subir fotos"); return; }
    if(!limitarLote(files, S.mode)) return;
    const modoFoto = await elegirModo(files);
    if(!modoFoto) return;
    S.fondoFallos = 0;
    const price = parsePrice($("defPrice").value), cat = $("defCat").value.trim(), marca = $("defMarca").value.trim(), stock = parseStock($("defStock").value);
    const useAI = S.ai && $("aiToggle").checked;
    const total = files.length; let done = 0, ok = 0; const errs = $("errs"); errs.textContent="";
    const textoSubida = modoFoto==="fondo" ? "Quitando fondos con IA y subiendo…" : modoFoto==="mejorar" ? "Mejorando y subiendo fotos…" : "Subiendo fotos…";
    $("progress").hidden=false; setProg(0,total,textoSubida);
    const col = S.db.collection("productos"); const base = Date.now();
    const group = S.mode==="group" && files.length>1; const groupPhotos = new Array(files.length);
    const toClassify = [];
    let i = 0;
    async function worker(){
      while(i < files.length){
        const idx = i++; const f = files[idx];
        try{
          const ph = await processPhoto(f, modoFoto); const blob = ph.thumb; delete ph._blob;
          if(group){ groupPhotos[idx]={ph,blob}; }
          else {
            const nombre = nameFromFile(f), ref = col.doc();
            await ref.set({ nombre, marca, precio:price, stock, categoria:cat, publico:"", descripcion:"", estado:"disponible", fotos:[ph], creado: base + (total-idx) });
            if(useAI) toClassify.push({ id:ref.id, blob, name:nombre==="Producto nuevo", cat:!cat, marca:!marca });
          }
          ok++;
        }catch(e){ errs.append(el("li",null,f.name+": "+errText(e))); }
        done++; setProg(done,total, done<total ? textoSubida : "");
      }
    }
    await Promise.all(Array.from({length:Math.min(modoFoto==="fondo"?2:4,files.length)}, worker));
    if(group){
      const got = groupPhotos.filter(Boolean);
      if(got.length){ try{ const nombre=nameFromFile(files[0]), ref=col.doc(); await ref.set({ nombre, marca, precio:price, stock, categoria:cat, publico:"", descripcion:"", estado:"disponible", fotos:got.map(g=>g.ph), creado:base }); if(useAI) toClassify.push({ id:ref.id, blob:got[0].blob, name:nombre==="Producto nuevo", cat:!cat, marca:!marca }); }catch(e){ errs.append(el("li",null,"No se pudo crear el producto: "+errText(e))); ok=0; } }
    }
    const fail = total-ok;
    if(S.fondoFallos) errs.append(el("li",null,`${S.fondoFallos} foto(s) se subieron mejoradas pero sin quitar el fondo (la IA no respondió). Puedes reintentarlas más tarde.`));
    const doneMsg = fail ? `Listo: ${ok} subidas, ${fail} con problema` : (group ? `Listo: 1 producto con ${ok} fotos` : `Listo: ${ok} productos publicados`);
    setProg(total,total, doneMsg);
    $("fileInput").value="";
    if(toClassify.length){ await classify(toClassify); setProg(total,total, doneMsg + (S.aiMsg?` · ${S.aiMsg}`:"")); }
    else toast(group ? "Producto publicado" : `${ok} productos publicados`);
  }

  // ---------- Clasificación con IA ----------
  const CATS = ["Ropa","Zapatos","Carteras y bolsos","Accesorios","Relojes y joyería","Perfumes y belleza","Electrónica","Hogar","Juguetes","Otros"];
  const PUBLICOS = ["Mujer","Hombre","Niños","Unisex"];
  async function classify(items){
    if(!S.ai || !items.length) return;
    const per = Math.max(1, Math.min(8, S.aiMax||1));
    let n = 0, fails = 0; S.aiMsg = "";
    for(let k=0; k<items.length; k+=per){
      const batch = items.slice(k, k+per);
      setProg(n, items.length, "Detectando categorías con IA…");
      const prompt = `Eres el asistente de una tienda en Perú que revende productos traídos de Estados Unidos. Te paso ${batch.length} foto(s) de producto, en orden, numeradas desde 0.
Para cada foto responde un objeto con:
- "i": el número de la foto
- "categoria": exactamente una de: ${CATS.join(", ")}
- "publico": exactamente uno de: ${PUBLICOS.join(", ")} (usa Unisex si no se distingue)
- "nombre": nombre corto de venta en español, de 2 a 6 palabras, que describa tipo, estilo y color, sin la marca (ej. "Jean wide leg con cordón", "Zapatillas running negras").
- "marca": la marca solo si su logo, etiqueta o diseño característico se ve claramente en la foto; si no, "".
Responde solo con un arreglo JSON, por ejemplo: [{"i":0,"categoria":"Zapatos","publico":"Hombre","nombre":"Zapatillas running negras","marca":"Adidas"}]`;
      let res;
      try { res = await S.ai.json(prompt, { images: batch.map(b=>b.blob), modelTier:"quick" }); }
      catch(e){
        const c = e && e.code;
        if(c==="not_granted"||c==="sampling_disabled"||c==="images_unavailable"||c==="capability_disabled"||c==="capability_removed"||c==="not_declared"){ S.ai=null; $("aiRow").hidden=true; $("bulkAI").hidden=true; S.aiMsg="la IA no está disponible; pon las categorías a mano"; return; }
        if(c==="rate_limited"){ S.aiMsg=`IA en pausa: ${items.length-n} sin clasificar (usa "Editar varios" › Clasificar con IA más tarde)`; return; }
        fails += batch.length; n += batch.length; continue;
      }
      const arr = Array.isArray(res) ? res : [];
      await Promise.all(batch.map(async (b, j)=>{
        const r = arr.find(x=>x && Number(x.i)===j) || arr[j]; if(!r) { fails++; return; }
        const patch = {};
        if(b.cat && CATS.includes(r.categoria)) patch.categoria = r.categoria;
        if(PUBLICOS.includes(r.publico)) patch.publico = r.publico;
        if(b.name && typeof r.nombre==="string" && r.nombre.trim()) patch.nombre = r.nombre.trim().slice(0,80);
        if(b.marca!==false && typeof r.marca==="string" && r.marca.trim()) patch.marca = r.marca.trim().slice(0,40);
        if(Object.keys(patch).length){ try{ await S.db.doc("productos/"+b.id).update(patch); }catch(e){ fails++; } }
      }));
      n += batch.length; setProg(n, items.length, "Detectando categorías con IA…");
    }
    S.aiMsg = fails ? `IA: ${items.length-fails} clasificados, ${fails} sin clasificar` : `IA: ${items.length} clasificados`;
    toast(S.aiMsg);
  }
  async function classifySelected(){
    const ids=[...S.sel]; if(!ids.length) return;
    $("progress").hidden=false; $("errs").textContent="";
    setProg(0, ids.length, "Preparando fotos…");
    const items=[];
    for(const id of ids){
      const p=S.products.find(x=>x.id===id), f=p&&p.fotos&&p.fotos[0]; if(!f) continue;
      items.push({ id, blob:f.thumb||f.full, name:true, cat:true });
    }
    if(!items.length){ toast("Esos productos no tienen fotos"); return; }
    await classify(items); setProg(items.length, items.length, S.aiMsg||"Listo");
  }

  function setProg(d,t,msg){ $("progBar").style.width = (t? d/t*100:0)+"%"; $("progCount").textContent = d+" / "+t; if(msg) $("progText").textContent = msg; }

  // ---------- Render ----------
  function filtered(){
    const q = S.q.toLowerCase();
    return S.products.filter(p => (!S.cat || p.categoria===S.cat) && (!S.pub || p.publico===S.pub || (S.pub!=="Niños" && p.publico==="Unisex")) && (!q || (p.nombre+" "+(p.marca||"")+" "+(p.categoria||"")+" "+(p.publico||"")+" "+(p.descripcion||"")).toLowerCase().includes(q)));
  }
  function renderCats(){
    const counts = {}; S.products.forEach(p=>{ if(p.categoria) counts[p.categoria]=(counts[p.categoria]||0)+1; });
    const order = c => { const i=CATS.indexOf(c); return i<0 ? CATS.length-1.5 : i; };
    const cats = Object.keys(counts).sort((a,b)=>order(a)-order(b) || a.localeCompare(b,"es"));
    const pubs = PUBLICOS.filter(x=>x!=="Unisex" && S.products.some(p=>p.publico===x));
    const box=$("cats"); box.textContent="";
    if(cats.length){
      box.append(el("button",{class:"chip","aria-pressed":String(!S.cat),onclick:()=>{S.cat="";render();}},"Todo"));
      cats.forEach(c=>box.append(el("button",{class:"chip","aria-pressed":String(S.cat===c),onclick:()=>{S.cat=S.cat===c?"":c;render();}}, c+" ", el("span",{class:"cn"},String(counts[c])))));
    }
    const pb=$("pubs"); pb.textContent="";
    if(pubs.length>1) pubs.forEach(x=>pb.append(el("button",{class:"chip sub","aria-pressed":String(S.pub===x),onclick:()=>{S.pub=S.pub===x?"":x;render();}},x)));
    const dl=$("catList"); dl.textContent=""; [...new Set([...CATS,...cats])].forEach(c=>dl.append(el("option",{value:c})));
    const ml=$("marcaList"); ml.textContent=""; [...new Set(S.products.map(p=>p.marca).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"es")).forEach(m=>ml.append(el("option",{value:m})));
    if(S.cat && !cats.includes(S.cat)) S.cat="";
    if(S.pub && !pubs.includes(S.pub)) S.pub="";
  }
  // Vendedora: siempre ve la cantidad. Cliente: solo cuando quedan pocas.
  function stockTxt(p){
    if(typeof p.stock!=="number" || p.estado==="vendido") return "";
    if(S.canEdit) return p.stock===0 ? "Sin unidades" : `${p.stock} en stock`;
    if(p.stock===0) return "";
    return p.stock<=3 ? (p.stock===1 ? "¡Última unidad!" : `Quedan ${p.stock}`) : "";
  }
  function render(){
    renderCats();
    const list = filtered(), grid=$("grid"); grid.textContent="";
    for(const p of list){
      const cover = p.fotos && p.fotos[0];
      const st = p.estado||"disponible";
      const card = el("div",{class:"card "+st+(p.stock===0?" agotado":"")+(S.sel.has(p.id)?" sel":"")});
      const open = el("button",{class:"open",type:"button","aria-label":(S.selecting?"Seleccionar ":"Ver ")+(p.nombre||"producto"),onclick:()=>{ if(S.selecting){ toggleSel(p.id); } else openProduct(p.id); }});
      const ph = el("div",{class:"ph"});
      if(cover) ph.append(el("img",{src:src(cover.thumb||cover.full),alt:"",loading:"lazy",decoding:"async",onerror:function(){this.remove();}}));
      ph.append(el("span",{class:"price"+(p.precio==null?" none":"")}, p.precio==null ? "Consultar" : money(p.precio), p.precio!=null && soles(p.precio) ? el("small",null, soles(p.precio)) : null));
      if(st!=="disponible") ph.append(el("span",{class:"status "+st}, {vendido:"Vendido",apartado:"Apartado",oculto:"Oculto"}[st]||st));
      else if(p.stock===0) ph.append(el("span",{class:"status agotado"},"Agotado"));
      if(S.selecting) ph.append(el("span",{class:"check","aria-hidden":"true"}, S.sel.has(p.id)?"✓":""));
      else if(p.fotos && p.fotos.length>1) ph.append(el("span",{class:"multi"}, p.fotos.length+" fotos"));
      open.append(ph, el("div",{class:"info",style:"padding-bottom:0"}, p.marca ? el("span",{class:"marca-tag"},p.marca) : null, el("span",{class:"name"},p.nombre||"Sin nombre"), el("span",{class:"meta"}, el("span",null,p.categoria||""), el("span",null,p.publico||"")), stockTxt(p) ? el("span",{class:"stockpill"+(S.canEdit && p.stock>3?" ok":"")}, stockTxt(p)) : null));
      card.append(open);
      if(!S.selecting) card.append(el("div",{class:"info",style:"padding-top:0"}, addButton(p)));
      grid.append(card);
    }
    const n = S.products.length;
    $("count").textContent = n ? (list.length===n ? `${n} productos` : `${list.length} de ${n} productos`) : "";
    const empty=$("empty");
    if(S.loaded && !n){ empty.hidden=false; $("emptyTitle").textContent = S.canEdit ? "Tu vitrina está vacía" : "Pronto habrá productos aquí"; $("emptyText").textContent = S.canEdit ? "Arrastra todas tus fotos al recuadro de arriba. Cada foto se convierte en un producto listo para vender, y después le pones nombre y precio." : "Esta tienda todavía no ha publicado productos. Vuelve en un rato."; }
    else if(S.loaded && !list.length){ empty.hidden=false; $("emptyTitle").textContent="Nada coincide con tu búsqueda"; $("emptyText").textContent="Prueba con otra palabra o quita el filtro de categoría."; }
    else empty.hidden = S.loaded;
    renderBulk();
    renderCartBar();
  }

  // ---------- Selección en bloque ----------
  function toggleSel(id){ S.sel.has(id)?S.sel.delete(id):S.sel.add(id); render(); }
  function renderBulk(){
    $("bulk").hidden = !S.selecting;
    $("bulkCount").textContent = S.sel.size + (S.sel.size===1?" seleccionado":" seleccionados");
    $("bulkApply").disabled = $("bulkDel").disabled = $("bulkAI").disabled = !S.sel.size;
  }
  $("selectBtn").onclick = ()=>{ S.selecting=true; S.sel.clear(); render(); $("bulk").scrollIntoView({block:"nearest"}); };
  $("bulkDone").onclick = ()=>{ S.selecting=false; S.sel.clear(); $("bulkConfirm").hidden=true; render(); };
  $("bulkAll").onclick = ()=>{ const ids=filtered().map(p=>p.id); const all=ids.every(id=>S.sel.has(id)); ids.forEach(id=>all?S.sel.delete(id):S.sel.add(id)); render(); };
  async function runPool(ids, fn){ let i=0, fails=0; await Promise.all(Array.from({length:Math.min(4,ids.length)},async()=>{ while(i<ids.length){ const id=ids[i++]; try{ await fn(id); }catch(e){ fails++; } } })); return fails; }
  $("bulkApply").onclick = async ()=>{
    const patch={}; const pv=$("bulkPrice").value.trim(), cv=$("bulkCat").value.trim(), sv=$("bulkStatus").value, pb=$("bulkPub").value, mv=$("bulkMarca").value.trim(), qv=$("bulkStock").value.trim();
    if(pv) patch.precio=parsePrice(pv); if(cv) patch.categoria=cv; if(sv) patch.estado=sv; if(pb) patch.publico=pb; if(mv) patch.marca=mv; if(qv) patch.stock=parseStock(qv);
    if(!Object.keys(patch).length){ toast("Escribe un precio, marca, cantidad o categoría, o elige un estado"); return; }
    const ids=[...S.sel]; $("bulkApply").disabled=true;
    const fails = await runPool(ids, id=>S.db.doc("productos/"+id).update(patch));
    $("bulkPrice").value=$("bulkCat").value=$("bulkMarca").value=$("bulkStock").value=""; $("bulkStatus").value=""; $("bulkPub").value="";
    toast(fails ? `Actualizados ${ids.length-fails}; ${fails} fallaron` : `${ids.length} productos actualizados`); renderBulk();
  };
  $("bulkAI").onclick = ()=>classifySelected();
  $("bulkDel").onclick = ()=>{ $("bulkN").textContent=S.sel.size; $("bulkConfirm").hidden=false; };
  $("bulkDelNo").onclick = ()=>{ $("bulkConfirm").hidden=true; };
  $("bulkDelYes").onclick = async ()=>{
    $("bulkConfirm").hidden=true; const ids=[...S.sel];
    const fails = await runPool(ids, async id=>{ const p=S.products.find(x=>x.id===id); await S.db.doc("productos/"+id).delete(); if(p) await deletePhotos(p.fotos||[]); });
    S.sel.clear(); toast(fails ? `${fails} no se pudieron borrar` : `${ids.length} productos borrados`); render();
  };
  async function deletePhotos(fotos){ for(const f of fotos){ for(const id of [f.full,f.thumb]){ if(id){ try{ await S.assets.delete(id); }catch(e){} } } } }

  // ---------- Detalle / edición ----------
  let openId=null, photoIdx=0;
  function openProduct(id){ openId=id; photoIdx=0; drawSheet(); $("overlay").hidden=false; }
  function closeSheet(){ openId=null; $("overlay").hidden=true; $("overlay").textContent=""; }
  $("overlay").addEventListener("click", e=>{ if(e.target.id==="overlay") (cartOpen?closeCart:closeSheet)(); });
  document.addEventListener("keydown", e=>{ if(e.key==="Escape"){ if(cartOpen) closeCart(); else if(openId) closeSheet(); } });
  function drawSheet(){
    const p = S.products.find(x=>x.id===openId); const ov=$("overlay");
    if(!p){ closeSheet(); return; }
    const fotos = p.fotos||[]; if(photoIdx>=fotos.length) photoIdx=0;
    const keep = {}; ov.querySelectorAll("input,textarea,select").forEach(i=>{ if(i.id) keep[i.id]=i.value; });
    ov.textContent="";
    const gal = el("div",{class:"gal"});
    if(fotos[photoIdx]) gal.append(el("img",{class:"main",src:src(fotos[photoIdx].full),alt:p.nombre||""}));
    const th = el("div",{class:"thumbs"});
    fotos.forEach((f,i)=>{
      const t = el("button",{class:"t"+(i===photoIdx?" on":""),type:"button","aria-label":"Foto "+(i+1),onclick:()=>{photoIdx=i;drawSheet();}}, el("img",{src:src(f.thumb||f.full),alt:""}));
      if(S.canEdit && fotos.length>1){
        t.append(el("span",{class:"x",role:"button",tabindex:"0","aria-label":"Quitar foto",onclick:async ev=>{ ev.stopPropagation(); const nf=fotos.filter((_,j)=>j!==i); await S.db.doc("productos/"+p.id).update({fotos:nf}); deletePhotos([f]); toast("Foto quitada"); }},"×"));
      }
      th.append(t);
    });
    if(fotos.length>1 || S.canEdit) gal.append(th);
    if(S.canEdit && photoIdx>0) gal.append(el("button",{class:"btn",type:"button",onclick:async()=>{ const nf=[fotos[photoIdx],...fotos.filter((_,j)=>j!==photoIdx)]; await S.db.doc("productos/"+p.id).update({fotos:nf}); photoIdx=0; toast("Portada cambiada"); }},"Usar como portada"));
    if(S.canEdit){
      const add = el("input",{type:"file",accept:"image/*",multiple:"",hidden:"",id:"addPh"});
      add.onchange = async ()=>{ const fs=[...add.files]; if(!fs.length) return; toast("Subiendo "+fs.length+" foto(s)…"); const nuevas=[]; for(const f of fs){ try{ nuevas.push(await processPhoto(f, modoGuardado()||"mejorar")); }catch(e){ toast(f.name+": "+errText(e)); } } const cur=(S.products.find(x=>x.id===p.id)||p).fotos||[]; if(nuevas.length){ await S.db.doc("productos/"+p.id).update({fotos:[...cur,...nuevas]}); toast("Fotos agregadas"); } };
      gal.append(add, el("button",{class:"btn",type:"button",onclick:()=>add.click()},"+ Agregar fotos"));
    }
    const side = el("div",{class:"side"});
    if(S.canEdit){
      const v = (id,def)=> keep[id]!==undefined ? keep[id] : def;
      side.append(
        el("label",{class:"f"},"Nombre", el("input",{id:"eName",value:v("eName",p.nombre||""),maxlength:"120"})),
        el("div",{class:"row2"},
          el("label",{class:"f"},"Marca", el("input",{id:"eMarca",list:"marcaList",maxlength:"40",value:v("eMarca",p.marca||""),placeholder:"Ej. Michael Kors"})),
          el("label",{class:"f"},"Cantidad disponible", el("input",{id:"eStock",inputmode:"numeric",value:v("eStock",p.stock==null?"":String(p.stock)),placeholder:"Sin control"}))),
        el("div",{class:"row2"},
          el("label",{class:"f"},"Precio (USD)", el("input",{id:"ePrice",inputmode:"decimal",value:v("ePrice",p.precio==null?"":String(p.precio)),placeholder:"Consultar"})),
          el("label",{class:"f"},"Estado", (()=>{ const s=el("select",{id:"eStatus"}); [["disponible","Disponible"],["apartado","Apartado"],["vendido","Vendido"],["oculto","Oculto (no se muestra en la tienda)"]].forEach(([k,l])=>s.append(el("option",{value:k},l))); s.value=v("eStatus",p.estado||"disponible"); return s; })())
        ),
        el("div",{class:"row2"},
          el("label",{class:"f"},"Categoría", el("input",{id:"eCat",list:"catList",value:v("eCat",p.categoria||""),placeholder:"Ropa, zapatos…"})),
          el("label",{class:"f"},"Para", (()=>{ const s=el("select",{id:"ePub"}); [["","—"],...PUBLICOS.map(x=>[x,x])].forEach(([k,l])=>s.append(el("option",{value:k},l))); s.value=v("ePub",p.publico||""); return s; })())),
        (()=>{ const ta=el("textarea",{id:"eDesc",rows:"4",placeholder:"Talla, color, estado, si es original…"}); ta.value=v("eDesc",p.descripcion||""); return el("label",{class:"f"},"Descripción", ta); })()
      );
      const conf = el("span",{class:"confirm",hidden:""},"¿Borrar este producto?", el("button",{class:"btn danger",type:"button",onclick:async()=>{ await S.db.doc("productos/"+p.id).delete(); deletePhotos(fotos); closeSheet(); toast("Producto borrado"); }},"Sí, borrar"), el("button",{class:"btn",type:"button",onclick:()=>{conf.hidden=true;}},"No"));
      side.append(el("div",{class:"actions"},
        el("button",{class:"btn danger",type:"button",onclick:()=>{conf.hidden=false;}},"Borrar"),
        el("div",{style:"display:flex;gap:8px"}, el("button",{class:"btn",type:"button",onclick:closeSheet},"Cerrar"),
          el("button",{class:"btn primary",type:"button",onclick:async()=>{ const patch={ nombre:$("eName").value.trim()||"Producto nuevo", marca:$("eMarca").value.trim(), stock:parseStock($("eStock").value), precio:parsePrice($("ePrice").value), estado:$("eStatus").value, categoria:$("eCat").value.trim(), publico:$("ePub").value, descripcion:$("eDesc").value.trim() }; try{ await S.db.doc("productos/"+p.id).update(patch); toast("Guardado"); closeSheet(); }catch(e){ toast("No se pudo guardar. Revisa tu conexión e intenta de nuevo."); } }},"Guardar"))
      ), conf);
    } else {
      const st=p.estado||"disponible";
      side.append(p.marca ? el("span",{class:"marca-tag"},p.marca) : null, el("h2",null,p.nombre||"Producto"),
        el("div",{class:"bigprice"}, p.precio==null?"Precio a consultar":money(p.precio), p.precio!=null && soles(p.precio) ? el("span",{class:"bigsol"}, soles(p.precio)) : null),
        st!=="disponible" ? el("span",{class:"status "+st,style:"position:static;justify-self:start"}, st==="vendido"?"Vendido":"Apartado") : p.stock===0 ? el("span",{class:"status agotado",style:"position:static;justify-self:start"},"Agotado") : null,
        stockTxt(p) ? el("span",{class:"stockpill"}, stockTxt(p)) : null,
        (p.categoria||p.publico) ? el("span",{class:"note",style:"margin:0"}, [p.categoria,p.publico].filter(Boolean).join(" · ")) : null,
        p.descripcion ? el("p",{class:"desc"}, p.descripcion) : null);
      if(!agotado(p)){
        const b = addButton(p, true); b.classList.add("btn"); b.style.cssText="justify-self:start;padding:10px 16px;font-size:15px";
        side.append(b);
        if(cartCount()) side.append(el("button",{class:"btn tag",type:"button",style:"justify-self:start",onclick:openCart},"Ver mi pedido y enviar por WhatsApp"));
      }
      side.append(el("button",{class:"btn",type:"button",style:"justify-self:start",onclick:closeSheet},"Seguir viendo"));
    }
    ov.append(el("div",{class:"sheet",role:"dialog","aria-modal":"true","aria-label":p.nombre||"Producto"}, gal, side));
  }

  // ---------- Pedido por WhatsApp ----------
  const CART_KEY = "vitrina-pedido";
  let cart = {}, buyer = { nombre:"", nota:"" };
  try { const raw = JSON.parse(localStorage.getItem(CART_KEY)||"{}"); cart = raw.items||{}; buyer = Object.assign(buyer, raw.buyer||{}); } catch(e){}
  function saveCart(){ try{ localStorage.setItem(CART_KEY, JSON.stringify({items:cart, buyer})); }catch(e){} }
  const cartLines = () => Object.entries(cart).map(([id,q])=>({ p:S.products.find(x=>x.id===id), id, q })).filter(l=>l.p);
  const cartCount = () => cartLines().reduce((s,l)=>s+(agotado(l.p)?0:l.q),0);
  function cartTotals(){ let total=0, consultar=0; for(const l of cartLines()){ if(agotado(l.p)) continue; if(l.p.precio==null) consultar++; else total+=l.p.precio*l.q; } return {total, consultar}; }
  function addButton(p, big){
    const inCart = !!cart[p.id], sold = agotado(p);
    return el("button",{class:"addbtn"+(inCart?" in":""),type:"button",disabled:sold?"":false,
      onclick:e=>{ e.stopPropagation(); if(cart[p.id]) delete cart[p.id]; else { cart[p.id]=1; toast("Agregado a tu pedido"); } saveCart(); render(); if(openId) drawSheet(); }},
      sold ? (p.estado==="vendido" ? "Vendido" : "Agotado") : inCart ? (big?"✓ En tu pedido (quitar)":"✓ En tu pedido") : "+ Agregar al pedido");
  }
  function renderCartBar(){
    const n = cartCount(), {total, consultar} = cartTotals();
    $("cartbar").hidden = !n || S.selecting;
    $("cartN").textContent = n;
    $("cartT").textContent = total ? dual(total) + (consultar?" +":"") : (consultar?"Consultar":"");
  }
  $("cartbar").onclick = ()=>openCart();
  function buildMessage(){
    const lines = cartLines().filter(l=>!agotado(l.p));
    const {total, consultar} = cartTotals();
    let m = `Hola${S.config.nombre?" "+S.config.nombre:""}, quiero hacer este pedido:\n\n`;
    lines.forEach((l,i)=>{
      const pr = l.p.precio==null ? "precio a consultar" : (l.q>1 ? `${l.q} × ${money(l.p.precio)} = ${dual(l.p.precio*l.q)}` : dual(l.p.precio));
      m += `${i+1}. ${l.p.nombre}${l.q>1&&l.p.precio==null?` (${l.q} unidades)`:""} — ${pr}\n`;
    });
    m += `\nTotal: ${dual(total)||"$0"}${consultar?` + ${consultar} producto(s) a consultar`:""}`;
    if(buyer.nombre.trim()) m += `\nMi nombre: ${buyer.nombre.trim()}`;
    if(buyer.nota.trim()) m += `\nNota: ${buyer.nota.trim()}`;
    return m;
  }
  let cartOpen=false;
  function openCart(){ openId=null; cartOpen=true; drawCart(); $("overlay").hidden=false; }
  function drawCart(){
    const ov=$("overlay"); ov.textContent="";
    const lines = cartLines();
    const box = el("div",{class:"cart",role:"dialog","aria-modal":"true","aria-label":"Mi pedido"});
    box.append(el("div",{class:"cart-head"}, el("h2",null,"Mi pedido"), el("button",{class:"btn",type:"button",onclick:closeCart},"Seguir viendo")));
    if(!lines.length){
      box.append(el("p",{class:"note",style:"margin:0"},"Tu pedido está vacío. Toca \"+ Agregar al pedido\" en los productos que quieras."));
      ov.append(box); return;
    }
    const ul = el("ul",{class:"items"});
    for(const l of lines){
      const cover = l.p.fotos && l.p.fotos[0], sold = agotado(l.p);
      const maxQ = typeof l.p.stock==="number" ? l.p.stock : 99;
      const setQ = q=>{ if(q<1) delete cart[l.id]; else { if(q>maxQ) toast(`Solo hay ${maxQ} disponible${maxQ===1?"":"s"}`); cart[l.id]=Math.min(q,maxQ,99); } saveCart(); drawCart(); render(); };
      ul.append(el("li",{class:"item"},
        cover ? el("img",{src:src(cover.thumb||cover.full),alt:""}) : el("span",{class:"noimg"}),
        el("div",{style:"min-width:0;display:grid;gap:2px"},
          el("span",{class:"nm"},l.p.nombre||"Producto"),
          el("span",{class:"pr"}, l.p.precio==null?"Precio a consultar":(l.q>1?`${money(l.p.precio)} × ${l.q} = ${dual(l.p.precio*l.q)}`:dual(l.p.precio))),
          sold ? el("span",{class:"warn"},"Ya no está disponible; no se incluirá en el pedido") : (typeof l.p.stock==="number" && l.q>l.p.stock) ? el("span",{class:"warn"},`Solo quedan ${l.p.stock}`) : null),
        el("div",{style:"display:grid;gap:4px;justify-items:end"},
          sold ? null : el("div",{class:"qty"},
            el("button",{type:"button","aria-label":"Quitar uno",onclick:()=>setQ(l.q-1)},"−"),
            el("span",null,String(l.q)),
            el("button",{type:"button","aria-label":"Agregar uno",disabled:l.q>=maxQ?"":false,onclick:()=>setQ(l.q+1)},"+")),
          el("button",{class:"rm",type:"button",onclick:()=>setQ(0)},"Quitar"))
      ));
    }
    box.append(ul);
    const {total, consultar} = cartTotals();
    box.append(el("div",{class:"totals"}, el("span",null,"Total"+(consultar?` (+${consultar} a consultar)`:"")), el("span",{class:"t",style:"text-align:right"},money(total)||"$0", soles(total)?el("span",{class:"bigsol"},soles(total)):null)));
    const nm = el("input",{id:"buyerName",maxlength:"60",placeholder:"Para saber quién escribe",value:buyer.nombre});
    const nt = el("textarea",{id:"buyerNote",rows:"2",placeholder:"Talla, color, entrega o recogida…"}); nt.value = buyer.nota;
    const pv = el("div",{class:"preview","aria-label":"Mensaje que se enviará"}, buildMessage());
    const upd = ()=>{ buyer.nombre=nm.value; buyer.nota=nt.value; saveCart(); pv.textContent=buildMessage(); link.href=waLink(); };
    nm.addEventListener("input",upd); nt.addEventListener("input",upd);
    box.append(el("label",{class:"f"},"Tu nombre (opcional)", nm), el("label",{class:"f"},"Nota (opcional)", nt),
      el("div",{style:"display:grid;gap:4px"}, el("span",{class:"note",style:"margin:0"},"Este es el mensaje que llegará:"), pv));
    const wa = waDigits();
    const waLink = ()=>`https://wa.me/${wa}?text=${encodeURIComponent(buildMessage())}`;
    const link = el("a",{class:"btn tag",href:wa?waLink():"#",target:"_blank",rel:"noopener"},"Enviar pedido por WhatsApp");
    const copyBtn = el("button",{class:"btn",type:"button",onclick:async()=>{ try{ await navigator.clipboard.writeText(buildMessage()); toast("Mensaje copiado"); }catch(e){ const r=document.createRange(); r.selectNodeContents(pv); const s=getSelection(); s.removeAllRanges(); s.addRange(r); toast("Selecciona y copia el mensaje"); } }},"Copiar mensaje");
    const send = el("div",{class:"send"});
    if(S.config && S.config.cobrosActivos && !S.canEdit){
      const pagables = lines.filter(l=>!agotado(l.p));
      const sinPrecio = pagables.some(l=>l.p.precio==null);
      const payBtn = el("button",{class:"btn primary",type:"button",disabled:sinPrecio?"":false,onclick:async()=>{
        payBtn.disabled=true; payBtn.textContent="Abriendo pago seguro…";
        try{ const r = await pagarPedido(pagables.map(l=>({id:l.id,q:l.q})), buyer.nombre.trim(), buyer.nota.trim()); location.href = r.url; }
        catch(e){ toast((e&&e.message)||"No se pudo iniciar el pago"); payBtn.disabled=false; payBtn.textContent="Pagar con tarjeta"; }
      }},"Pagar con tarjeta");
      send.append(payBtn, el("span",{class:"note",style:"margin:0;text-align:center"}, sinPrecio ? "Algunos productos no tienen precio: consúltalos por WhatsApp o quítalos para pagar con tarjeta." : "Pago seguro con Stripe. El total final se muestra en la página de pago."));
    }
    if(S.config && (S.config.yapeNumero || S.config.yapeQr) && !S.canEdit){
      const pagables = lines.filter(l=>!agotado(l.p));
      const sinPrecio = pagables.some(l=>l.p.precio==null);
      const sinCambio = !(S.config.tipoCambio > 0);
      const yBtn = el("button",{class:"btn yape",type:"button",disabled:(sinPrecio||sinCambio)?"":false,onclick:()=>mostrarYape(box, pagables)},"Pagar con Yape");
      send.append(yBtn);
      if(sinPrecio) send.append(el("span",{class:"note",style:"margin:0;text-align:center"},"Algunos productos no tienen precio: consúltalos por WhatsApp o quítalos para pagar con Yape."));
    }
    if(wa){
      send.append(link, copyBtn, el("span",{class:"note",style:"margin:0;text-align:center"},"Se abre WhatsApp con tu pedido escrito; solo tocas enviar. Si no se abre, copia el mensaje y escríbelo al ", el("span",{class:"copy"},S.config.whatsapp)));
    } else {
      send.append(copyBtn, el("span",{class:"note",style:"margin:0;text-align:center"},"La tienda todavía no ha puesto su número de WhatsApp. Copia el mensaje para enviarlo cuando lo tengas."));
    }
    box.append(send,
      el("button",{class:"rm",type:"button",style:"justify-self:center",onclick:()=>{ cart={}; saveCart(); render(); closeCart(); toast("Pedido vaciado"); }},"Vaciar pedido"));
    ov.append(box);
  }
  function closeCart(){ cartOpen=false; $("overlay").hidden=true; $("overlay").textContent=""; }

  // ----- Pago con Yape (QR) -----
  // El total en soles se muestra aquí, pero el servidor lo vuelve a calcular con los precios guardados.
  const solesDe = lines => lines.reduce((t,l)=> t + Math.round(l.p.precio * l.q * S.config.tipoCambio), 0);
  function mostrarYape(box, pagables){
    const total = solesDe(pagables);
    box.textContent = "";
    const volver = el("button",{class:"btn",type:"button",onclick:drawCart},"Volver");
    const nom = el("input",{id:"yapeNombreCliente",maxlength:"60",autocomplete:"name",placeholder:"Para que la tienda identifique tu pago",value:buyer.nombre});
    const op = el("input",{id:"yapeOperacion",maxlength:"40",inputmode:"numeric",placeholder:"Aparece en tu constancia de Yape"});
    const err = el("p",{class:"err",role:"alert",hidden:""});
    const enviar = el("button",{class:"btn yape",type:"button"},"Ya pagué, enviar pedido");
    const panel = el("div",{class:"yape-pay"},
      S.config.yapeQr ? el("img",{src:src(S.config.yapeQr),alt:"Código QR de Yape de la tienda"}) : null,
      el("span",null,"Yapea exactamente"),
      el("span",{class:"monto"},"S/ " + total.toLocaleString("es-PE")),
      S.config.yapeNumero ? el("span",null,"al número ", el("span",{class:"num"}, S.config.yapeNumero)) : null,
      S.config.yapeNombre ? el("span",{class:"note",style:"margin:0"},"a nombre de " + S.config.yapeNombre) : null);
    box.append(
      el("div",{class:"cart-head"}, el("h2",null,"Pagar con Yape"), volver),
      el("p",{class:"note",style:"margin:0"},"1. Abre Yape y escanea el QR o yapea al número. 2. Vuelve aquí y envía tu pedido. La tienda confirmará tu pago."),
      panel,
      el("label",{class:"f"},"Tu nombre", nom),
      el("label",{class:"f"},"Código de operación (opcional)", op),
      err, el("div",{class:"send"}, enviar));
    enviar.onclick = async ()=>{
      err.hidden = true;
      const nombre = nom.value.trim();
      if(!nombre){ err.textContent="Escribe tu nombre para que la tienda reconozca tu pago"; err.hidden=false; nom.focus(); return; }
      buyer.nombre = nombre; saveCart();
      enviar.disabled = true; enviar.textContent = "Enviando…";
      try{
        const r = await pedidoYape(pagables.map(l=>({id:l.id,q:l.q})), nombre, buyer.nota.trim(), op.value.trim());
        const num = String(r.pedidoId||"").slice(0,8).toUpperCase();
        cart = {}; saveCart(); render();
        const wa = waDigits();
        const msg = `Hola, acabo de yapear S/ ${(r.total/100).toLocaleString("es-PE")} por mi pedido N.° ${num}${op.value.trim()?` (operación ${op.value.trim()})`:""}. Mi nombre: ${nombre}.`;
        box.textContent = "";
        box.append(
          el("div",{class:"cart-head"}, el("h2",null,"¡Pedido enviado!"), el("button",{class:"btn",type:"button",onclick:closeCart},"Cerrar")),
          el("p",{style:"margin:0"}, `Tu pedido N.° ${num} quedó registrado. La tienda revisará tu Yape y te confirmará.`),
          wa ? el("a",{class:"btn tag",href:`https://wa.me/${wa}?text=${encodeURIComponent(msg)}`,target:"_blank",rel:"noopener",style:"text-decoration:none;justify-content:center"},"Avisar por WhatsApp") : null);
      }catch(e){
        err.textContent = (e && e.message) || "No se pudo enviar el pedido. Intenta de nuevo."; err.hidden = false;
        enviar.disabled = false; enviar.textContent = "Ya pagué, enviar pedido";
      }
    };
    nom.focus();
  }

  // ---------- Tienda ----------
  function waDigits(){ return String(S.config.whatsapp||"").replace(/\D/g,""); }
  let yapeQrNuevo;  // QR de Yape en edición: undefined = sin cambios; "" = quitar; ruta = nuevo QR
  function renderConfig(){
    const name = S.config.nombre || "Vitrina USA";
    $("shopName").textContent = name; document.title = name;
    const c=$("contact"); c.textContent=""; const wa=waDigits();
    if(wa){ c.hidden=false; c.append("WhatsApp ", el("a",{href:"https://wa.me/"+wa,target:"_blank",rel:"noopener"}, S.config.whatsapp)); } else c.hidden=true;
    if(document.activeElement!==$("setName")) $("setName").value = S.config.nombre||"";
    if(document.activeElement!==$("setWa")) $("setWa").value = S.config.whatsapp||"";
    if(document.activeElement!==$("setRate")) $("setRate").value = S.config.tipoCambio!=null ? String(S.config.tipoCambio) : "";
    if(document.activeElement!==$("setYapeNum")) $("setYapeNum").value = S.config.yapeNumero||"";
    if(document.activeElement!==$("setYapeName")) $("setYapeName").value = S.config.yapeNombre||"";
    if(yapeQrNuevo===undefined) pintarQrConfig(S.config.yapeQr||"");
    render(); if(openId) drawSheet();
  }
  $("settingsBtn").onclick = ()=>{ $("settings").hidden = !$("settings").hidden; };
  // QR de Yape: se sube al elegirlo y se guarda junto con los demás datos.
  function pintarQrConfig(path){
    const img=$("setYapeImg");
    img.hidden = !path; if(path) img.src = src(path); else img.removeAttribute("src");
    $("setYapeDel").hidden = !path; $("setYapeUp").textContent = path ? "Cambiar QR" : "Subir QR";
  }
  $("setYapeUp").onclick = ()=>$("setYapeFile").click();
  $("setYapeDel").onclick = ()=>{ yapeQrNuevo = ""; pintarQrConfig(""); };
  $("setYapeFile").onchange = async e=>{
    const f = e.target.files && e.target.files[0]; e.target.value = ""; if(!f) return;
    $("setYapeUp").disabled = true; $("setYapeUp").textContent = "Subiendo…";
    try{ const img = await decode(f); const blob = await toBlob(img, 900, .9); const r = await S.assets.upload(blob, {type:"image/jpeg"}); yapeQrNuevo = r.id; pintarQrConfig(r.id); toast("QR listo. Toca Guardar."); }
    catch(err){ toast("No se pudo subir el QR: " + errText(err)); pintarQrConfig(S.config.yapeQr||""); }
    finally{ $("setYapeUp").disabled = false; }
  };
  $("saveSettings").onclick = async ()=>{
    try{
      await S.db.doc("config/tienda").set({
        nombre:$("setName").value.trim(), whatsapp:$("setWa").value.trim(), tipoCambio: parsePrice($("setRate").value),
        yapeNumero:$("setYapeNum").value.trim(), yapeNombre:$("setYapeName").value.trim(),
        yapeQr: yapeQrNuevo!==undefined ? yapeQrNuevo : (S.config.yapeQr||""),
      });
      yapeQrNuevo = undefined; $("settings").hidden=true; toast("Datos guardados");
    }catch(e){ toast("No se pudo guardar. Intenta de nuevo."); }
  };

  // ---------- Controles ----------
  $("q").addEventListener("input", e=>{ S.q=e.target.value; render(); });
  $("pickBtn").onclick = ()=>$("fileInput").click();
  $("fileInput").onchange = e=>handleFiles(e.target.files);
  const setMode = m=>{ S.mode=m; $("modeEach").setAttribute("aria-pressed",String(m==="each")); $("modeGroup").setAttribute("aria-pressed",String(m==="group")); };
  $("modeEach").onclick=()=>setMode("each"); $("modeGroup").onclick=()=>setMode("group");
  const drop=$("drop");
  ["dragenter","dragover"].forEach(t=>drop.addEventListener(t,e=>{e.preventDefault();drop.classList.add("over");}));
  ["dragleave","drop"].forEach(t=>drop.addEventListener(t,e=>{e.preventDefault();drop.classList.remove("over");}));
  drop.addEventListener("drop", e=>{ if(e.dataTransfer && e.dataTransfer.files) handleFiles(e.dataTransfer.files); });
  document.addEventListener("paste", e=>{ if(!S.canEdit) return; const fs=[...(e.clipboardData?.files||[])]; if(fs.length) handleFiles(fs); });

  render();

  // ---------- Conexión (AWS Amplify) ----------
  const params = new URLSearchParams(location.search);
  const slugPublico = (params.get("tienda") || "").toLowerCase();
  const enlaceDe = slug => location.origin + location.pathname + "?tienda=" + encodeURIComponent(slug);
  const show = (id, on) => { $(id).hidden = !on; };
  const ESTADO_TXT = { pendiente:"Pendiente de aprobación", aprobada:"Aprobada", suspendida:"Suspendida" };

  // ----- Cuenta: entrar / registrarse / verificar -----
  let paso = "login", correoPendiente = "";
  const loginErr = m=>{ const e=$("loginErr"); e.textContent=m; e.hidden=!m; };
  function pasoAuth(p, hint){
    paso = p; loginErr("");
    const t = { login:["Entrar","Entrar"], signup:["Crear cuenta","Crear cuenta"], confirm:["Verifica tu correo","Verificar"], newPassword:["Nueva contraseña","Guardar y entrar"] }[p];
    $("authTitle").textContent = t[0]; $("loginBtn").textContent = t[1];
    show("emailRow", p==="login"||p==="signup"); show("passRow", p==="login"||p==="signup");
    show("codeRow", p==="confirm"); show("resendCode", p==="confirm"); show("newPassRow", p==="newPassword");
    show("authSwitch", p==="login"||p==="signup");
    show("googleBox", googleDisponible && (p==="login"||p==="signup"));
    $("authSwitch").textContent = p==="signup" ? "Ya tengo cuenta" : "Crear una cuenta";
    $("loginPass").autocomplete = p==="signup" ? "new-password" : "current-password";
    const h=$("authHint"); h.textContent = hint||""; h.hidden = !hint;
  }
  function abrirAuth(p){ show("landing", false); show("login", true); pasoAuth(p, p==="signup" ? "Usa tu correo. La contraseña necesita 8 caracteres con mayúscula, minúscula, número y símbolo." : ""); $("login").scrollIntoView({block:"start"}); (p==="confirm"?$("loginCode"):$("loginEmail")).focus(); }
  $("googleBtn").onclick = async ()=>{
    $("googleBtn").disabled = true; loginErr("");
    try{ await entrarConGoogle(); }   // la página se va a Google y vuelve sola
    catch(e){ $("googleBtn").disabled = false; loginErr(e && e.name==="UserAlreadyAuthenticatedException" ? "Ya tienes una sesión abierta. Recarga la página." : "No se pudo abrir Google. Intenta de nuevo."); }
  };
  $("adminLink").onclick = ()=>abrirAuth("signup");
  $("goSignup").onclick = ()=>abrirAuth("signup");
  $("goLogin").onclick = ()=>abrirAuth("login");
  $("authSwitch").onclick = ()=>pasoAuth(paso==="signup"?"login":"signup");
  $("loginCancel").onclick = ()=>{ show("login", false); if(!slugPublico) show("landing", true); };
  $("logoutBtn").onclick = async ()=>{ try{ await signOut(); }finally{ location.href = location.pathname; } };
  $("resendCode").onclick = async ()=>{ try{ await resendSignUpCode({ username: correoPendiente }); toast("Te enviamos un código nuevo"); }catch(e){ loginErr((e&&e.message)||"No se pudo reenviar el código"); } };
  const errAuth = err => { const n = err && err.name;
    return n==="NotAuthorizedException"||n==="UserNotFoundException" ? "Correo o contraseña incorrectos"
      : n==="UsernameExistsException" ? "Ya existe una cuenta con ese correo. Toca \"Ya tengo cuenta\"."
      : n==="InvalidPasswordException" ? "La contraseña necesita 8 caracteres con mayúscula, minúscula, número y símbolo"
      : n==="CodeMismatchException" ? "El código no es correcto. Revísalo o pide uno nuevo."
      : n==="ExpiredCodeException" ? "El código venció. Toca \"Reenviar código\"."
      : n==="UserNotConfirmedException" ? "Falta verificar tu correo."
      : ((err && err.message) || "No se pudo completar. Intenta de nuevo."); };
  async function trasLogin(r){
    if(r.isSignedIn){ location.href = location.pathname; return; }
    const step = r.nextStep && r.nextStep.signInStep;
    if(step==="CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED") return pasoAuth("newPassword","Es tu primer ingreso: crea una contraseña nueva.");
    if(step==="CONFIRM_SIGN_UP"){ correoPendiente=$("loginEmail").value.trim(); try{ await resendSignUpCode({username:correoPendiente}); }catch(e){} return pasoAuth("confirm", `Te enviamos un código a ${correoPendiente}.`); }
    loginErr("Falta un paso para entrar: " + (step||"desconocido"));
  }
  $("login").addEventListener("submit", async e=>{
    e.preventDefault(); loginErr(""); $("loginBtn").disabled=true;
    const email=$("loginEmail").value.trim(), pass=$("loginPass").value;
    try{
      if(paso==="login"){
        if(!email||!pass) return loginErr("Escribe tu correo y tu contraseña");
        await trasLogin(await signIn({ username: email, password: pass }));
      } else if(paso==="signup"){
        if(!email||!pass) return loginErr("Escribe tu correo y una contraseña");
        const r = await signUp({ username: email, password: pass, options:{ userAttributes:{ email } } });
        correoPendiente = email;
        if(r.nextStep && r.nextStep.signUpStep==="CONFIRM_SIGN_UP") pasoAuth("confirm", `Te enviamos un código a ${email}. Escríbelo aquí.`);
        else await trasLogin(await signIn({ username: email, password: pass }));
      } else if(paso==="confirm"){
        const code=$("loginCode").value.trim(); if(!code) return loginErr("Escribe el código que te llegó por correo");
        await confirmSignUp({ username: correoPendiente, confirmationCode: code });
        if(pass) await trasLogin(await signIn({ username: correoPendiente, password: pass }));
        else { pasoAuth("login","Correo verificado. Ahora entra con tu contraseña."); $("loginEmail").value=correoPendiente; }
      } else if(paso==="newPassword"){
        if($("newPass").value.length<8) return loginErr("La nueva contraseña debe tener al menos 8 caracteres");
        await trasLogin(await confirmSignIn({ challengeResponse: $("newPass").value }));
      }
    }catch(err){ loginErr(errAuth(err)); }
    finally{ $("loginBtn").disabled=false; }
  });

  // ----- Crear vitrina -----
  let slugTocado = false;
  const prevSlug = ()=>{ $("obPreview").textContent = enlaceDe($("obSlug").value || "tu-tienda"); };
  $("obName").addEventListener("input", ()=>{ if(!slugTocado){ $("obSlug").value = limpiarSlug($("obName").value); prevSlug(); } });
  $("obSlug").addEventListener("input", ()=>{ slugTocado=true; $("obSlug").value = limpiarSlug($("obSlug").value); prevSlug(); });
  prevSlug();

  // ----- Vitrina (pública o de la vendedora) -----
  function iniciarVitrina(){
    show("vitrina", true);
    const slow = setTimeout(()=>{ if(!S.loaded){ $("emptyTitle").textContent="La vitrina tarda en responder"; $("emptyText").textContent="Revisa tu conexión. Los productos aparecerán en cuanto se conecte."; } },10000);
    db.collection("productos").orderBy("creado","desc").onSnapshot(snap=>{
      S.products = snap.docs.map(d=>({id:d.id, ...d.data()}));
      if(!snap.metadata.fromCache){ S.loaded=true; clearTimeout(slow); }
      else if(S.products.length) S.loaded=true;
      for(const id of [...S.sel]) if(!S.products.some(p=>p.id===id)) S.sel.delete(id);
      if(!snap.metadata.fromCache){ let ch=false; for(const id of Object.keys(cart)) if(!S.products.some(p=>p.id===id)){ delete cart[id]; ch=true; } if(ch) saveCart(); }
      render(); if(openId) drawSheet();
      if(cartOpen && !$("overlay").contains(document.activeElement)) drawCart();
      if(!S.canEdit) mensajeEstadoPublico(); else actualizarPlan();
    }, ()=>{ clearTimeout(slow); S.loaded=true; $("emptyTitle").textContent="No se pudo cargar la vitrina"; $("emptyText").textContent="Recarga la página en unos minutos."; render(); });
    db.doc("config/tienda").onSnapshot(s=>{ S.config = s.exists ? s.data() : {}; renderConfig(); if(S.canEdit){ actualizarPlan(); pintarCobros(); } }, ()=>{});
  }
  function mensajeEstadoPublico(){
    const c = estadoCatalogo(); if(!c) return;
    if(c.estado==="no_existe"){ $("emptyTitle").textContent="Esta vitrina no existe"; $("emptyText").textContent="Revisa el enlace que te compartieron."; show("empty", true); }
    else if(!c.productos){ $("emptyTitle").textContent = c.estado==="suspendida" ? "Esta vitrina no está disponible" : "Esta vitrina abrirá pronto"; $("emptyText").textContent = c.estado==="suspendida" ? "La tienda está pausada por ahora." : "La tienda está terminando de prepararse. Vuelve en un rato."; show("empty", true); }
    else if(c.vistaPrevia) toast("Vista previa: los clientes aún no ven esta vitrina");
  }
  function bannerVendedora(t){
    const est = t.estado || "pendiente";
    show("storeBanner", true);
    const pill=$("bannerPill"); pill.className="pill "+est; pill.textContent=ESTADO_TXT[est];
    $("bannerText").textContent = est==="aprobada" ? "Tu vitrina está publicada. Comparte este enlace con tus clientes:"
      : est==="suspendida" ? "Tu vitrina está pausada. Escribe a la administración para reactivarla."
      : "Ya puedes subir tus productos. Los clientes la verán cuando la administración la apruebe.";
    $("bannerLink").textContent = enlaceDe(t.id);
    $("viewStore").href = enlaceDe(t.id);
    $("copyLink").onclick = async ()=>{ try{ await navigator.clipboard.writeText(enlaceDe(t.id)); toast("Enlace copiado"); }catch(e){ const r=document.createRange(); r.selectNodeContents($("bannerLink")); const sl=getSelection(); sl.removeAllRanges(); sl.addRange(r); toast("Selecciona y copia el enlace"); } };
  }

  // ----- Panel de la dueña -----
  let panelFiltro = "pendiente", tiendasCache = [];
  async function abrirPanel(){
    show("vitrina", false); show("storeBanner", false); show("onboard", false); show("panel", true);
    $("panelRows").textContent = ""; $("panelCount").textContent = "Cargando vitrinas…";
    try{ tiendasCache = await listarTiendas(); }catch(e){ $("panelCount").textContent = "No se pudieron cargar las vitrinas: " + ((e&&e.message)||""); return; }
    pintarPanel();
  }
  function pintarPanel(){
    const cuenta = { todas: tiendasCache.length };
    tiendasCache.forEach(t=>{ const e=t.estado||"pendiente"; cuenta[e]=(cuenta[e]||0)+1; });
    const f=$("panelFilter"); f.textContent="";
    [["pendiente","Pendientes"],["aprobada","Aprobadas"],["suspendida","Suspendidas"],["todas","Todas"]].forEach(([k,l])=>
      f.append(el("button",{class:"chip",type:"button","aria-pressed":String(panelFiltro===k),onclick:()=>{panelFiltro=k;pintarPanel();}}, l+" ", el("span",{class:"cn"},String(cuenta[k]||0)))));
    const lista = tiendasCache.filter(t=>panelFiltro==="todas" || (t.estado||"pendiente")===panelFiltro)
      .sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||"")));
    $("panelCount").textContent = `${tiendasCache.length} vitrinas en total`;
    const tb=$("panelRows"); tb.textContent="";
    if(!lista.length){ tb.append(el("tr",null, el("td",{colspan:"7",style:"color:var(--muted)"}, "No hay vitrinas en este grupo."))); return; }
    for(const t of lista){
      const est=t.estado||"pendiente";
      const acc = async (nuevo, okMsg)=>{ try{ await cambiarEstadoTienda(t.id, nuevo); t.estado=nuevo; toast(okMsg); pintarPanel(); }catch(e){ toast("No se pudo cambiar el estado: "+((e&&e.message)||"")); } };
      const acts = el("div",{class:"acts"});
      if(est!=="aprobada") acts.append(el("button",{class:"btn primary",type:"button",onclick:()=>acc("aprobada","Vitrina aprobada")}, "Aprobar"));
      if(est!=="suspendida") acts.append(el("button",{class:"btn danger",type:"button",onclick:()=>acc("suspendida","Vitrina suspendida")}, "Suspender"));
      acts.append(el("a",{class:"btn",href:enlaceDe(t.id),target:"_blank",rel:"noopener",style:"text-decoration:none"},"Ver"));
      tb.append(el("tr",null,
        el("td",null, el("strong",null,t.nombre||t.id), el("br"), el("small",null,"?tienda="+t.id)),
        el("td",null,t.email||"—"), el("td",null,t.whatsapp||"—"),
        el("td",null, el("span",{class:"pill "+est}, ESTADO_TXT[est])),
        el("td",null, planSelect(t)),
        el("td",null, el("small",null, t.createdAt ? new Date(t.createdAt).toLocaleDateString("es-PE") : "")),
        el("td",null, acts)));
    }
  }

  // ----- Planes de la vendedora -----
  const visiblesEnTienda = () => S.products.filter(p=>p.estado!=="oculto").length;
  function usoPlan(){
    const plan = planVigente(S.config || {});
    const usados = visiblesEnTienda();
    return { plan, usados, libres: plan.limite==null ? Infinity : Math.max(0, plan.limite - usados) };
  }
  function actualizarPlan(){
    const box=$("planBox"); if(!S.canEdit){ box.hidden=true; return; }
    const u = usoPlan(), ilimitado = u.plan.limite==null;
    const pct = ilimitado ? 0 : Math.min(100, Math.round(u.usados / u.plan.limite * 100));
    const lleno = !ilimitado && u.usados >= u.plan.limite, cerca = !lleno && pct >= 80;
    box.hidden=false; box.className = "plan" + (lleno ? " full" : cerca ? " near" : ""); box.textContent="";
    const vence = S.config && S.config.planVence && u.plan.id!=="free" ? new Date(S.config.planVence).toLocaleDateString("es-PE") : "";
    const msg = ilimitado ? "Puedes publicar todos los productos que quieras."
      : u.usados > u.plan.limite ? `Tienes ${u.usados - u.plan.limite} producto(s) que los clientes no ven porque superan tu plan.`
      : lleno ? "Llegaste al límite de tu plan. Mejóralo para seguir publicando."
      : cerca ? `Te quedan ${u.libres} productos en tu plan.` : `Puedes publicar ${u.libres} productos más.`;
    const extra = S.config && S.config.planCancelado && vence ? ` Vuelves a Free el ${vence}.` : vence ? ` Se renueva el ${vence}.` : "";
    const info = el("div",{class:"plan-info"},
      el("strong",null,"Plan "+u.plan.nombre),
      el("span",{class:"plan-n"}, ilimitado ? `${u.usados} productos · ilimitado` : `${u.usados} de ${u.plan.limite} productos`));
    if(!ilimitado){ const bar=el("div",{class:"meter"}); const i=el("i"); i.style.width=pct+"%"; bar.append(i); info.append(bar); }
    info.append(el("span",{class:"note",style:"margin:0"}, msg + extra));
    box.append(info, el("button",{class:"btn"+(lleno||cerca?" tag":""),type:"button",onclick:abrirPlanes}, ilimitado ? "Ver planes" : "Mejorar plan"));
  }
  function abrirPlanes(){
    const u = usoPlan(), ov=$("planOverlay"); ov.textContent=""; ov.hidden=false;
    const cerrar = ()=>{ ov.hidden=true; ov.textContent=""; };
    ov.onclick = e=>{ if(e.target===ov) cerrar(); };
    const card = el("div",{class:"cart",role:"dialog","aria-modal":"true","aria-label":"Planes"},
      el("div",{class:"cart-head"}, el("h2",null,"Planes"), el("button",{class:"btn",type:"button",onclick:cerrar},"Cerrar")),
      el("p",{class:"note",style:"margin:0"}, `Hoy tienes ${u.usados} productos visibles. Pagas según cuántos productos se muestran en tu vitrina; los ocultos no cuentan.`));
    const grid = el("div",{class:"plans"});
    for(const pl of PLANES){
      let btn;
      if(pl.id===u.plan.id) btn = el("button",{class:"btn",type:"button",disabled:""},"Tu plan actual");
      else if(pl.id==="free") btn = el("button",{class:"btn",type:"button",onclick:async()=>{
          btn.disabled=true; try{ await cancelarPlan(); toast("Tu plan seguirá activo hasta fin de mes y luego pasarás a Free"); S.config = await miTiendaActual(); actualizarPlan(); cerrar(); }
          catch(e){ toast((e&&e.message)||"No se pudo cambiar el plan"); btn.disabled=false; } }},"Volver a Free");
      else btn = el("button",{class:"btn primary",type:"button",onclick:async()=>{
          btn.disabled=true; btn.textContent="Abriendo pago…";
          try{ const r = await pagarPlan(pl.id); location.href = r.url; }
          catch(e){ toast((e&&e.message)||"No se pudo iniciar el pago"); btn.disabled=false; btn.textContent="Elegir este plan"; } }},
          PLANES.indexOf(pl) > PLANES.indexOf(u.plan) ? "Elegir este plan" : "Cambiar a este plan");
      grid.append(el("div",{class:"plan-card"+(pl.id===u.plan.id?" on":"")},
        el("strong",null,pl.nombre),
        el("div",{class:"plan-price"}, pl.precio ? `S/ ${pl.precio}` : "Gratis", pl.precio ? el("small",null," /mes") : null),
        el("span",null, pl.limite==null ? "Productos ilimitados" : `Hasta ${pl.limite} productos`),
        el("span",null, "Fotos mejoradas automáticamente"),
        pl.extra ? el("span",{class:"extra"}, "+ " + pl.extra) : null, btn));
    }
    card.append(grid, el("p",{class:"note",style:"margin:0"},"Pago mensual con tarjeta a través de Stripe. Puedes volver a Free cuando quieras."));
    ov.append(card);
  }
  // Antes de subir: recorta el lote a lo que permite el plan
  function limitarLote(files, modo){
    if(!S.canEdit) return true;
    const u = usoPlan();
    if(u.libres <= 0){ abrirPlanes(); toast("Llegaste al límite de tu plan"); return false; }
    if(modo !== "group" && files.length > u.libres){ toast(`Tu plan permite ${u.libres} producto(s) más: se subirán las primeras ${u.libres} fotos`); files.splice(u.libres); }
    return true;
  }
  function planSelect(t){
    const s = el("select",{"aria-label":"Plan de "+(t.nombre||t.id)});
    PLANES.forEach(pl=>s.append(el("option",{value:pl.id}, `${pl.nombre} (${pl.limite==null?"ilimitado":pl.limite})`)));
    s.value = planVigente(t).id;
    s.onchange = async ()=>{ try{ await cambiarPlanTienda(t.id, s.value); t.plan = s.value; toast(`Plan de ${t.nombre} cambiado a ${s.selectedOptions[0].textContent} por 30 días`); }catch(e){ toast("No se pudo cambiar el plan: "+((e&&e.message)||"")); s.value = planVigente(t).id; } };
    return s;
  }

  // ----- Cobros con tarjeta de la vendedora (Stripe Connect) -----
  function pintarCobros(){
    if(!S.canEdit){ show("cobrosBox", false); return; }
    const activos = !!(S.config && S.config.cobrosActivos), empezado = !!(S.config && S.config.stripeAccountId);
    show("cobrosBox", true);
    const pill=$("cobrosPill"); pill.className="pill "+(activos?"activos":"inactivos"); pill.textContent = activos ? "Pagos con tarjeta activos" : "Pagos con tarjeta";
    $("cobrosText").textContent = activos ? "Tus clientes pueden pagar su pedido con tarjeta. El dinero llega a tu cuenta de Stripe."
      : empezado ? "Falta completar tus datos en Stripe para recibir pagos." : "Activa los pagos con tarjeta para que tus clientes paguen en la web. También pueden seguir pidiendo por WhatsApp.";
    const b=$("cobrosBtn"); b.hidden = activos; b.textContent = empezado ? "Completar datos en Stripe" : "Activar pagos con tarjeta";
    b.onclick = async ()=>{ b.disabled=true; try{ const r = await conectarCobros(); location.href = r.url; }catch(e){ toast((e&&e.message)||"No se pudo abrir Stripe"); b.disabled=false; } };
  }

  // ----- Pedidos pagados (vendedora) -----
  const PEDIDO_TXT = { pendiente:"Pago pendiente", por_confirmar:"Por confirmar", pagado:"Pagado", entregado:"Entregado", cancelado:"Cancelado" };
  const montoTxt = (n, moneda) => (moneda==="pen" ? "S/ " : "$") + (n/100).toLocaleString("es-PE",{minimumFractionDigits: n%100?2:0, maximumFractionDigits:2});
  async function descontarStockLocal(items){
    for(const it of items){
      const prod = S.products.find(x=>x.id===it.id);
      if(!prod || typeof prod.stock!=="number") continue;
      try{ await S.db.doc("productos/"+prod.id).update({ stock: Math.max(0, prod.stock - (Number(it.q)||1)) }); }catch(e){}
    }
  }
  async function cargarPedidos(){
    let lista = [];
    try{ lista = await listarPedidos(); }catch(e){ return; }
    show("pedidosBox", lista.length > 0);
    const pagados = lista.filter(p=>p.estado==="pagado").length, porConfirmar = lista.filter(p=>p.estado==="por_confirmar").length;
    $("pedidosCount").textContent = [porConfirmar ? `${porConfirmar} por confirmar` : "", pagados ? `${pagados} por entregar` : ""].filter(Boolean).join(" · ") || `${lista.length}`;
    if(porConfirmar) $("pedidosBox").open = true;
    const tb=$("pedidosRows"); tb.textContent="";
    for(const p of lista){
      let items=[]; try{ items = JSON.parse(p.items||"[]"); }catch(e){}
      const acts = el("div",{class:"acts"});
      const cambiar = (estado, msg)=>async()=>{
        try{
          await cambiarEstadoPedido(p.id, estado);
          // Yape confirmado: se descuentan las unidades (tarjeta lo hace el webhook).
          if(estado==="pagado" && p.metodo==="yape") await descontarStockLocal(items);
          toast(msg); cargarPedidos();
        }catch(e){ toast("No se pudo actualizar"); }
      };
      if(p.estado==="por_confirmar") acts.append(
        el("button",{class:"btn primary",type:"button",onclick:cambiar("pagado","Pago confirmado")},"Confirmar pago"),
        el("button",{class:"btn danger",type:"button",onclick:cambiar("cancelado","Pedido rechazado")},"No llegó"));
      if(p.estado==="pagado") acts.append(el("button",{class:"btn",type:"button",onclick:async()=>{ try{ await cambiarEstadoPedido(p.id,"entregado"); toast("Pedido marcado como entregado"); cargarPedidos(); }catch(e){ toast("No se pudo actualizar"); } }},"Marcar entregado"));
      tb.append(el("tr",null,
        el("td",null, el("small",null, new Date(p.createdAt).toLocaleString("es-PE",{dateStyle:"short",timeStyle:"short"}))),
        el("td",null, p.cliente||"—", p.email ? el("br") : null, p.email ? el("small",null,p.email) : null, p.nota ? el("br") : null, p.nota ? el("small",null,"Nota: "+p.nota) : null),
        el("td",null, items.map(i=>`${i.nombre}${i.q>1?" × "+i.q:""}`).join(", ")),
        el("td",null, montoTxt(p.total||0, p.moneda)),
        el("td",null, p.metodo==="yape" ? "Yape" : "Tarjeta", p.operacion ? el("br") : null, p.operacion ? el("small",null,"Op. "+p.operacion) : null),
        el("td",null, el("span",{class:"pill "+p.estado}, PEDIDO_TXT[p.estado]||p.estado)),
        el("td",null, acts)));
    }
  }

  // ----- Regreso desde Stripe -----
  function limpiarParams(...k){ const u=new URL(location.href); k.forEach(x=>u.searchParams.delete(x)); history.replaceState(null,"",u.pathname+u.search+u.hash); }
  function retornoVendedora(){
    if(params.get("plan")==="ok"){ toast("¡Pago recibido! Tu plan se activa en unos segundos"); setTimeout(async()=>{ try{ S.config = await miTiendaActual(); actualizarPlan(); }catch(e){} }, 4000); }
    if(params.get("plan")==="cancelado") toast("No se realizó el pago. Tu plan no cambió.");
    if(params.get("cobros")){ estadoCobros().then(r=>{ S.config = { ...S.config, cobrosActivos: r.cobrosActivos, stripeAccountId: S.config.stripeAccountId || "pendiente" }; pintarCobros(); toast(r.cobrosActivos ? "¡Listo! Ya puedes recibir pagos con tarjeta" : "Stripe todavía está revisando tus datos"); }).catch(()=>{}); }
    limpiarParams("plan","cobros");
  }
  function retornoCliente(){
    const pago = params.get("pago");
    if(pago==="ok"){
      cart = {}; saveCart();
      const num = (params.get("pedido")||"").slice(0,8).toUpperCase();
      const aviso = el("section",{class:"paid",role:"status"},
        el("h2",null,"¡Pago recibido!"),
        el("p",{style:"margin:0"}, `Tu pedido ${num ? "N.° "+num+" " : ""}está pagado. La tienda se pondrá en contacto contigo para coordinar la entrega.`));
      $("vitrina").prepend(aviso);
      setTimeout(()=>{ const wa = waDigits(); if(wa) aviso.append(el("a",{class:"btn tag",href:`https://wa.me/${wa}?text=${encodeURIComponent(`Hola, acabo de pagar mi pedido ${num} en la web.`)}`,target:"_blank",rel:"noopener",style:"justify-self:start;text-decoration:none"},"Avisar por WhatsApp")); }, 1500);
    }
    if(pago==="cancelado") toast("No se realizó el pago. Tu pedido sigue guardado.");
    limpiarParams("pago","pedido");
  }

  // ----- Arranque -----
  (async ()=>{
    // Regreso desde Google: esperar a que Amplify termine de abrir la sesión.
    if(params.has("code") && params.has("state")){
      show("landing", false); show("vitrina", false);
      toast("Entrando con tu cuenta de Google…");
      await new Promise(res=>{
        const listo = ()=>{ parar(); res(); };
        const parar = alVolverDeGoogle(listo, ()=>{ parar(); toast("No se pudo entrar con Google. Intenta de nuevo."); res(); });
        setTimeout(listo, 8000);
      });
      history.replaceState(null, "", location.pathname);
    }
    const ses = await sesion();
    show("logoutBtn", ses.logged); show("adminLink", !ses.logged && !slugPublico);
    show("panelBtn", !!ses.superadmin);
    $("panelBtn").onclick = abrirPanel;

    if(slugPublico){
      // Vista de cliente (también la usa la vendedora con "Ver como cliente")
      usarModoPublico(slugPublico, ses.logged);
      S.db = db; S.assets = null; S.ai = null; S.canEdit = false;
      show("upload", false); show("settingsBtn", false);
      retornoCliente();
      iniciarVitrina();
      return;
    }
    if(!ses.logged){ show("landing", true); show("vitrina", false); if(location.hash==="#entrar") abrirAuth("login"); return; }

    let tienda = null;
    try{ tienda = await miTienda(ses.sub); }catch(e){ toast("No se pudo cargar tu cuenta. Recarga la página."); return; }
    if(location.hash==="#panel" && ses.superadmin && !tienda){ abrirPanel(); return; }
    if(!tienda){
      if(ses.superadmin){ abrirPanel(); return; }
      show("onboard", true); $("obName").focus();
      $("onboard").addEventListener("submit", async e=>{
        e.preventDefault(); const er=$("obErr"); er.hidden=true;
        const nombre=$("obName").value.trim(), slug=limpiarSlug($("obSlug").value), whatsapp=$("obWa").value.trim();
        if(!nombre){ er.textContent="Escribe el nombre de tu tienda"; er.hidden=false; return; }
        if(!SLUG_RE.test(slug)){ er.textContent="El enlace debe tener entre 3 y 40 letras, números o guiones"; er.hidden=false; return; }
        $("obBtn").disabled=true;
        try{ await crearTienda({ slug, nombre, whatsapp, email: ses.email }); location.reload(); }
        catch(err){ er.textContent = err && err.code==="exists" ? "Ese enlace ya lo usa otra tienda. Prueba con otro." : err && err.code==="invalid" ? "Ese enlace no está permitido. Prueba con otro." : "No se pudo crear la vitrina: "+((err&&err.message)||""); er.hidden=false; }
        finally{ $("obBtn").disabled=false; }
      });
      return;
    }

    // Vitrina de la vendedora: solo sus productos y sus fotos
    usarModoVendedora(tienda.id);
    S.db = db; S.assets = assets; S.ai = ai; S.aiMax = 8; S.canEdit = true; S.quitarFondo = quitarFondo;
    pintarModoFoto();
    $("modoFotoCambiar").onclick = ()=>{ try{ localStorage.removeItem(MODO_KEY); }catch(e){} pintarModoFoto(); toast("Te preguntaremos en la próxima subida"); };
    show("upload", true); show("settingsBtn", true); show("aiRow", true); show("bulkAI", true);
    show("myStoreBtn", !!ses.superadmin);
    $("myStoreBtn").onclick = ()=>{ location.hash=""; location.reload(); };
    bannerVendedora(tienda);
    S.config = tienda; actualizarPlan(); pintarCobros(); cargarPedidos();
    if(tienda.stripeAccountId && !tienda.cobrosActivos && !params.get("cobros")){
      estadoCobros().then(r=>{ if(r.cobrosActivos){ S.config = { ...S.config, cobrosActivos:true }; pintarCobros(); } }).catch(()=>{});
    }
    retornoVendedora();
    if(location.hash==="#panel" && ses.superadmin){ abrirPanel(); return; }
    iniciarVitrina();
  })();
