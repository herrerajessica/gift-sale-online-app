import {
  FOTOS_BASE, db, assets, ai, agruparFotos, verificarConfiguracionUnion, sesion, usarModoPublico, usarModoVendedora, estadoCatalogo,
  miTienda, crearTienda, listarTiendas, cambiarEstadoTienda, limpiarSlug, SLUG_RE,
  signIn, signOut, signUp, confirmSignUp, resendSignUpCode, confirmSignIn, resetPassword, confirmResetPassword, updatePassword,
  googleDisponible, entrarConGoogle, alVolverDeGoogle, cerrarSesion,
  PLANES, planVigente, tieneFondoIA, pagarPlan, quitarFondo, asistente, buscarInternet, interpretarDictado, cancelarPlan, conectarCobros, estadoCobros, pagarPedido, pedidoYape,
  miTiendaActual, listarPedidos, cambiarEstadoPedido, cambiarPlanTienda, confianza, refrescarProductos, preguntarTienda, traducirTextos, clienteCuenta, listarClientes,
} from './amplify-adapter.js';
import { interpretarComando } from './comandos.js';
import { qrCanvas } from './qr.js';
import { escucha, vocabulario, corregir, codigosDichos, SEPARADOR_PRODUCTOS } from './voz.js';
import { interpretarPorLotes } from './dictado.js';
import { prepararUnion, ejecutarUnion } from './juntar-productos.js';
import { arrastrable } from './arrastrar.js';
import { abrirOrganizador, girarImagen } from './organizador-fotos.js';
import { abrirCapa } from './atras.js';
import { ponerFondoBlanco, compararFondo } from './fondo-blanco.js';
import './organizador.css';
import { crearGruposUnion } from './grupos-union.js';
const gruposUnion=crearGruposUnion();
import { RUBROS, TIPOS, tiposDe, categoriaDeTipo, prefijoDeTipo, tipoDeTexto, marcaDeTexto, MARCAS } from './rubros.js';

// Lógica de Showroomcito (misma que la versión de Claude).

  const $ = id => document.getElementById(id);
  // append() del navegador escribe "null" si le pasas null: aquí se ignoran los vacíos (campos opcionales).
  for(const Proto of [Element.prototype, DocumentFragment.prototype]){
    const original = Proto.append;
    if(!original.__sinVacios){ Proto.append = function(...k){ return original.apply(this, k.filter(x=>x!=null && x!==false)); }; Proto.append.__sinVacios = true; }
  }
  const S = { db:null, assets:null, canEdit:false, products:[], config:{}, q:"", cat:"", mode:"each", pub:"",
              selecting:false, sel:new Set(), pending:[] };
  // Dólares siempre (el costo de la etiqueta está en USD).
  const usd = n => (typeof n === "number" && isFinite(n)) ? "$" + n.toLocaleString("en-US",{minimumFractionDigits: n%1?2:0, maximumFractionDigits:2}) : "";
  // Precio en la moneda de la tienda: soles si la vendedora de Perú pone sus precios en soles; si no, dólares.
  const money = n => (typeof n === "number" && isFinite(n)) ? (enSoles() ? "S/ " + n.toLocaleString("es-PE",{minimumFractionDigits: n%1?2:0, maximumFractionDigits:2}) : usd(n)) : "";
  // País de la tienda: "US" = solo dólares y tienda del cliente en inglés; "PE" (o vacío) = soles, Yape y español.
  const esUS = () => !!S.config && S.config.pais === "US";
  // Idioma que ve el cliente: el que eligió con el botón ES | EN, o el de la tienda (EE. UU. = inglés)
  const IDIOMA_KEY = "vitrina-idioma";
  S.idioma = (()=>{ const u = new URLSearchParams(location.search).get("lang"); if(u==="es"||u==="en") return u; try{ const v = localStorage.getItem(IDIOMA_KEY); return v==="es"||v==="en" ? v : ""; }catch(e){ return ""; } })();
  const idiomaBase = () => esUS() ? "en" : "es";
  const EN = () => !S.canEdit && (S.idioma ? S.idioma === "en" : esUS());
  // Nombre y descripción en el idioma que ve el cliente (traducción automática si existe)
  const traducido = p => !S.canEdit && (EN() ? "en" : "es") !== idiomaBase();
  const nom = p => (traducido(p) && p.trNombre) || p.nombre || "";
  // Página de inicio y cuenta (antes de entrar): en español salvo que elija English (o abra con ?lang=en)
  const enInicio = () => S.idioma === "en";
  const ti = (es, en) => enInicio() ? en : es;
  function aplicarIdiomaInicio(){
    const en = enInicio();
    document.querySelectorAll("#landing [data-en], #login [data-en]").forEach(x=>{
      if(x.dataset.es === undefined) x.dataset.es = x.innerHTML;
      x.innerHTML = en ? x.dataset.en : x.dataset.es;
    });
    document.querySelectorAll(".foot .legales a").forEach((a,i)=>{ a.textContent = en ? ["Privacy","Terms"][i] : ["Privacidad","Términos"][i]; });
    const ad = document.getElementById("adminLink"); if(ad) ad.textContent = en ? "Have things to sell? Create your showroom" : "¿Tienes cosas para vender? Crea tu showroom";
    document.documentElement.lang = en ? "en" : "es";
    const lb = $("langBtn"); lb.textContent = en ? "Español" : "English"; lb.setAttribute("aria-label", en ? "Ver en español" : "See in English");
  }
  const descr = p => (traducido(p) && p.trDescripcion) || p.descripcion || "";
  const tx = (es, en) => EN() ? en : es;
  const CAT_EN = { "Ropa":"Clothing", "Zapatos":"Shoes", "Carteras y bolsos":"Bags", "Accesorios":"Accessories", "Relojes y joyería":"Watches & jewelry", "Perfumes y belleza":"Beauty & fragrance", "Electrónica":"Electronics", "Hogar":"Home", "Juguetes":"Toys", "Otros":"Other" };
  const PUB_EN = { "Mujer":"Women", "Hombre":"Men", "Niños":"Kids", "Unisex":"Unisex" };
  const catTxt = c => EN() ? (CAT_EN[c]||c) : c;
  // Condición del producto (nuevo, usado…): se guarda la clave, se muestra el texto en el idioma del cliente.
  const CONDICIONES = [["nuevo_etiqueta","Nuevo con etiqueta","New with tags"],["nuevo","Nuevo sin etiqueta","New without tags"],["caja_abierta","Caja abierta","Open box"],["como_nuevo","Usado como nuevo","Like new"],["usado","Usado","Used"]];
  const CLAVES_COND = CONDICIONES.map(c=>c[0]);
  const condTxt = k => { const c = CONDICIONES.find(x=>x[0]===k); return c ? (EN() ? c[2] : c[1]) : ""; };
  const opcionesCond = (vacio) => [["", vacio], ...CONDICIONES.map(c=>[c[0], c[1]])];
  const pubTxt = x => EN() ? (PUB_EN[x]||x) : x;
  // Tipo de cambio (S/ por 1 USD) de la tienda.
  const tipoCambio = () => { if(esUS()) return null; const r = parseFloat(S.config.tipoCambio); return isFinite(r) && r>0 ? r : null; };
  // ¿Esta tienda pone sus precios en soles? (Perú; las tiendas de EE. UU. siempre en dólares)
  const enSoles = () => !esUS() && !!S.config && S.config.moneda === "PEN";
  // Factor para pasar un precio guardado a soles: 1 si ya está en soles; el tipo de cambio si está en dólares.
  const rate = () => enSoles() ? 1 : tipoCambio();
  // El costo de la etiqueta (USD) llevado a la moneda de la tienda, para calcular márgenes.
  const costoMon = c => (typeof c === "number" && c > 0) ? (enSoles() ? (tipoCambio() ? c * tipoCambio() : null) : c) : null;
  // Precio con margen: en dólares redondea al dólar; en soles convierte el costo y redondea al sol.
  const precioConMargen = (costo, margen) => { const c = costoMon(costo); return c ? Math.max(1, Math.ceil(c * (1 + margen/100))) : null; };
  const simbolo = () => enSoles() ? "S/" : "$";
  // Descuento por pagar con Yape o efectivo: el precio publicado es el de tarjeta. Solo tiendas de Perú.
  const descuento = () => { if(esUS()) return 0; const d = Number(S.config && S.config.descuentoContado); return isFinite(d) && d > 0 ? Math.min(30, d) : 0; };
  const solesContado = n => { const r = rate(), d = descuento(); return (r && d && typeof n==="number" && isFinite(n)) ? Math.round(n*r*(1-d/100)) : null; };
  // Precio equivalente en soles, como dato secundario (no hace falta si el precio ya está en soles).
  const soles = n => { const r=rate(); return (!enSoles() && r && typeof n==="number" && isFinite(n)) ? "S/ " + Math.round(n*r).toLocaleString("es-PE") : ""; };
  const dual = n => { const a=money(n), b=soles(n); return a && b ? a+" · "+b : a; };
  const parseStock = v => { const t=String(v??"").trim(); if(t==="") return null; const n=parseInt(t.replace(/\D/g,""),10); return isFinite(n) ? Math.min(n, 99999) : null; };
  // Un producto no se puede pedir si está vendido o su cantidad llegó a 0.
  const agotado = p => p.estado==="vendido" || p.stock===0;
  // Precio de venta = costo + margen, redondeado hacia arriba al dólar.
  const conMargen = (costo, margen) => Math.max(1, Math.ceil(costo * (1 + margen/100)));
  const parseMargen = v => { const n = parseFloat(String(v||"").replace(",",".").replace(/[^0-9.]/g,"")); return isFinite(n) && n>=0 && n<1000 ? n : null; };
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
  // Fotos livianas: tamaño máximo por foto. Si queda pesada, baja la calidad de a poco (sin bajar de 55 %).
  const FOTO = { grande: 1280, grandeKB: 250, mini: 480, miniKB: 60 };
  async function aBlobLiviano(c, max, q, maxKB){
    let b = await aBlob(c, max, q);
    while(b.size > maxKB*1024 && q > 0.56){ q = Math.round((q - 0.08)*100)/100; b = await aBlob(c, max, q); }
    return b;
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
  // Fondo blanco con IA (Nova Canvas): oculto hasta habilitar el modelo en Bedrock (no está disponible en el plan gratuito de AWS).
  const FONDO_IA_LISTO = false;
  const fondoPermitido = ()=> FONDO_IA_LISTO && !!S.quitarFondo && tieneFondoIA(S.config||{});
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
        if(k==="fondo" && (!S.quitarFondo || !FONDO_IA_LISTO)) continue;
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
    const c = lienzo(img, FOTO.grande);
    if(modo==="mejorar" || modo==="fondo") mejorarPixeles(c);
    const full = await aBlobLiviano(c, FOTO.grande, .82, FOTO.grandeKB), thumb = await aBlobLiviano(c, FOTO.mini, .78, FOTO.miniKB);
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
      const full = await aBlobLiviano(out, FOTO.grande, .86, FOTO.grandeKB), thumb = await aBlobLiviano(out, FOTO.mini, .8, FOTO.miniKB);
      const f = await up(full); const t = await up(thumb);
      return { full:f.id, thumb:t.id, _blob:thumb };
    } finally {
      S.assets.delete(trabajo.id).catch(()=>{});
    }
  }
  // Mensajes simples para la vendedora: nunca se muestran códigos ni textos técnicos de AWS.
  // El detalle técnico queda en la consola del navegador para revisarlo si hace falta.
  function errText(e){
    const c = e && e.code, m = String((e && e.message) || "");
    if(e) console.warn("Detalle técnico:", e);
    if(c==='union_desactualizada') return m;
    if(/not defined for input object type.*UpdateProductoInput|field.*not.*defined.*UpdateProductoInput/i.test(m)) return 'el backend de este entorno no está actualizado para unir productos; revisa el despliegue y amplify_outputs.json';
    if(c==="too_large") return "la foto es demasiado grande";
    if(c==="quota_or_state") return "se llenó el espacio de tu tienda; borra productos que ya no vendes";
    if(c==="rate_limited" || /throttl|too many|rate/i.test(m)) return "hubo muchas subidas seguidas; reintenta en un minuto";
    if(c==="not_granted"||c==="capability_disabled" || /unauthori|not authorized|expired|token/i.test(m)) return "no se pudo guardar con tu sesión actual; cierra sesión, vuelve a entrar e inténtalo otra vez";
    if(/network|fetch|timeout|timed out|conexi/i.test(m)) return "se cortó la conexión";
    if(/decode|image|imagen|format/i.test(m)) return "no se pudo leer la foto; prueba con otra (JPG o PNG)";
    return "no se pudo subir";
  }

  // ---------- Fotos repetidas ----------
  // Huella de cada foto: cómo cambia el brillo en una cuadrícula de 9×8 (64 bits) + color promedio.
  // Dos fotos iguales (aunque estén comprimidas distinto) dan huellas casi iguales.
  function huellaDeImagen(img){
    // Se achica a la mitad varias veces (promedia bien) antes del 9×8 final:
    // así la misma foto da la misma huella venga del archivo original o de la miniatura.
    let w = img.width, h = img.height, fuente = img;
    while(w > 36 || h > 32){
      const nw = Math.max(9, Math.round(w/2)), nh = Math.max(8, Math.round(h/2));
      const t = document.createElement("canvas"); t.width = nw; t.height = nh;
      const tx = t.getContext("2d"); tx.imageSmoothingEnabled = true; tx.imageSmoothingQuality = "high";
      tx.drawImage(fuente, 0, 0, nw, nh); fuente = t; w = nw; h = nh;
    }
    const c = document.createElement("canvas"); c.width = 9; c.height = 8;
    const x = c.getContext("2d", { willReadFrequently:true }); x.imageSmoothingQuality = "high"; x.drawImage(fuente, 0, 0, 9, 8);
    const d = x.getImageData(0, 0, 9, 8).data;
    const lum = i => .299*d[i] + .587*d[i+1] + .114*d[i+2];
    let bits = "", r = 0, g = 0, b = 0;
    for(let y=0; y<8; y++) for(let xx=0; xx<8; xx++){ const i = (y*9+xx)*4; bits += lum(i) > lum(i+4) ? "1" : "0"; }
    for(let i=0; i<d.length; i+=4){ r += d[i]; g += d[i+1]; b += d[i+2]; }
    const n = d.length/4, hx = v => Math.round(v/n).toString(16).padStart(2,"0");
    return "h2:" + BigInt("0b"+bits).toString(16).padStart(16,"0") + "-" + hx(r) + hx(g) + hx(b);
  }
  function parecidas(a, b){
    // La huella puede llevar al final "|<id de la foto>" (de qué foto se calculó): no cuenta para comparar.
    a = String(a||"").split("|")[0]; b = String(b||"").split("|")[0];
    if(!a || !b || !a.startsWith("h2:") || !b.startsWith("h2:")) return false;
    const [ha, ca] = a.slice(3).split("-"), [hb, cb] = b.slice(3).split("-");
    let v = BigInt("0x"+ha) ^ BigInt("0x"+hb), dist = 0;
    while(v){ dist += Number(v & 1n); v >>= 1n; }
    // Color: se compara el TONO (proporción de rojo, verde y azul), no el brillo. Así la misma foto
    // subida "tal cual" y "mejorada" (más clara y contrastada) se reconoce como repetida.
    const prop = c => { const v = [0,2,4].map(k=>parseInt(c.substr(k,2),16)), t = (v[0]+v[1]+v[2]) || 1; return v.map(x=>x/t); };
    const pa = prop(ca), pb = prop(cb);
    const tono = Math.abs(pa[0]-pb[0]) + Math.abs(pa[1]-pb[1]) + Math.abs(pa[2]-pb[2]);
    return dist <= 5 && tono <= 0.06;
  }
  async function huellaDeArchivo(f){ try{ return huellaDeImagen(await decode(f)); }catch(e){ return null; } }
  async function huellaDeUrl(url){
    // Primero con fetch sin caché (evita una copia guardada sin permiso CORS); si falla, con <img>.
    try{
      const b = await (await fetch(url, { mode:"cors", cache:"no-store" })).blob();
      const bmp = await createImageBitmap(b);
      try{ return huellaDeImagen(bmp); } finally { if(bmp.close) bmp.close(); }
    }catch(e){}
    return new Promise(res=>{
      const i = new Image(); i.crossOrigin = "anonymous"; i.decoding = "async";
      i.onload = ()=>{ try{ res(huellaDeImagen(i)); }catch(e){ res(null); } };
      i.onerror = ()=>res(null); i.src = url + (url.includes("?") ? "&" : "?") + "h=1";
    });
  }
  // La huella es de la foto principal: si se cambió la foto (o el producto vino del dictado), se calcula de nuevo.
  const fotoPrincipal = p => p.fotos && p.fotos[0] ? (p.fotos[0].thumb || p.fotos[0].full) : "";
  // Al día = calculada de la foto principal actual (las huellas antiguas sin "|foto" se recalculan una vez)
  const huellaAlDia = p => { const [h, foto] = String(p.huella||"").split("|"); return h.startsWith("h2:") && foto === fotoPrincipal(p); };
  /** Calcula (y guarda) la huella de los productos que no la tienen o cuya foto principal cambió. */
  async function asegurarHuellas(onAvance){
    const faltan = S.products.filter(p=>fotoPrincipal(p) && !huellaAlDia(p));
    let hechas = 0, fallidas = 0;
    await runPool(faltan.map(p=>p.id), async id=>{
      const p = S.products.find(x=>x.id===id); if(!p) return;
      const foto = fotoPrincipal(p), h = await huellaDeUrl(src(foto));
      if(h){ p.huella = h + "|" + foto; try{ await S.db.doc("productos/"+id).update({ huella:p.huella }); }catch(e){} }
      else fallidas++;
      hechas++; if(onAvance) onAvance(hechas, faltan.length);
    });
    return { revisadas: faltan.length, fallidas };
  }
  /** Agrupa productos con la misma foto (unión de parecidos). */
  function gruposRepetidos(lista){
    const padre = lista.map((_,i)=>i);
    const raiz = i => padre[i]===i ? i : (padre[i] = raiz(padre[i]));
    for(let i=0;i<lista.length;i++) for(let j=i+1;j<lista.length;j++)
      if(parecidas(lista[i].huella, lista[j].huella)) padre[raiz(j)] = raiz(i);
    const g = {};
    lista.forEach((p,i)=>{ (g[raiz(i)] = g[raiz(i)] || []).push(p); });
    return Object.values(g).filter(x=>x.length > 1);
  }
  // Se queda el que tiene más datos completos; a igualdad, el más antiguo.
  const datosLlenos = p => ["precio","marca","descripcion","talla","costo","stock"].filter(k=>p[k]!=null && p[k]!=="").length;
  async function buscarRepetidos(){
    toast("Buscando fotos repetidas…");
    const r = await asegurarHuellas();
    const grupos = gruposRepetidos(S.products.filter(p=>p.huella));
    const aviso = r.fallidas ? ` (no pude revisar ${r.fallidas} foto${r.fallidas===1?"":"s"}; revisa tu conexión y vuelve a intentar)` : "";
    if(!grupos.length){ toast("No encontré fotos repetidas" + aviso); return; }
    if(aviso) toast("Encontré repetidas" + aviso);
    const ov = $("planOverlay"); ov.textContent = ""; ov.hidden = false;
    const cerrar = ()=>{ ov.hidden = true; ov.textContent = ""; ov.onclick = null; };
    ov.onclick = e=>{ if(e.target===ov) cerrar(); };
    const marcados = new Set();
    const lista = el("div",{class:"dups"});
    grupos.forEach(g=>{
      g.sort((a,b)=> datosLlenos(b)-datosLlenos(a) || (a.creado||0)-(b.creado||0));
      const fila = el("div",{class:"dup-grupo"});
      g.forEach((p,k)=>{
        if(k>0) marcados.add(p.id);
        const etiqueta = el("span",{class: k===0 ? "queda" : "va"}, k===0 ? "Se queda" : "Se borra");
        const item = el("button",{type:"button",class:"dup-item"+(k>0?" borrar":""),"aria-pressed":String(k>0),
          onclick:()=>{ const b = !marcados.has(p.id); b ? marcados.add(p.id) : marcados.delete(p.id);
            item.classList.toggle("borrar", b); item.setAttribute("aria-pressed", String(b)); etiqueta.className = b ? "va" : "queda"; etiqueta.textContent = b ? "Se borra" : "Se queda"; pintarBoton(); }},
          p.fotos && p.fotos[0] ? el("img",{src:src(p.fotos[0].thumb||p.fotos[0].full),alt:""}) : null,
          el("span",null, p.nombre || "Producto"), etiqueta);
        fila.append(item);
      });
      lista.append(fila);
    });
    const borrar = el("button",{class:"btn danger",type:"button"});
    const pintarBoton = ()=>{ borrar.textContent = `Borrar ${marcados.size} repetido${marcados.size===1?"":"s"}`; borrar.disabled = !marcados.size; };
    pintarBoton();
    borrar.onclick = async ()=>{
      borrar.disabled = true; borrar.textContent = "Borrando…";
      const ids = [...marcados];
      const fails = await runPool(ids, async id=>{ const p = S.products.find(x=>x.id===id); await S.db.doc("productos/"+id).delete(); if(p) await deletePhotos(p.fotos||[]); quitarFilaLote(id); });
      cerrar(); S.sel.clear(); render();
      toast(fails ? `Se borraron ${ids.length-fails}; ${fails} no se pudieron borrar` : `${ids.length} repetido${ids.length===1?"":"s"} borrado${ids.length===1?"":"s"}`);
    };
    ov.append(el("div",{class:"cart",role:"dialog","aria-modal":"true","aria-label":"Fotos repetidas"},
      el("div",{class:"cart-head"}, el("h2",null,`${grupos.length} grupo${grupos.length===1?"":"s"} de fotos repetidas`), el("button",{class:"btn",type:"button",onclick:cerrar},"Cancelar")),
      el("p",{class:"note",style:"margin:0"},"En cada grupo se queda el producto con más datos. Toca una foto para cambiar si se queda o se borra."),
      lista, el("div",{class:"send"}, borrar)));
  }
  /** Antes de subir: avisa si hay fotos que ya están en la tienda o repetidas en el lote. */
  function preguntarRepetidas(files, repetidas){
    return new Promise(resolve=>{
      const ov = $("planOverlay"); ov.textContent = ""; ov.hidden = false;
      const urls = [];
      const fin = v=>{ ov.hidden = true; ov.textContent = ""; ov.onclick = null; urls.forEach(u=>URL.revokeObjectURL(u)); resolve(v); };
      ov.onclick = e=>{ if(e.target===ov) fin(null); };
      const fila = el("div",{class:"dup-grupo"});
      repetidas.forEach(r=>{ const u = URL.createObjectURL(files[r.idx]); urls.push(u);
        fila.append(el("div",{class:"dup-item borrar"}, el("img",{src:u,alt:""}), el("span",null, r.motivo))); });
      const n = repetidas.length;
      ov.append(el("div",{class:"cart",role:"dialog","aria-modal":"true","aria-label":"Fotos repetidas"},
        el("div",{class:"cart-head"}, el("h2",null,`${n} foto${n===1?"":"s"} repetida${n===1?"":"s"}`), el("button",{class:"btn",type:"button",onclick:()=>fin(null)},"Cancelar")),
        el("p",{class:"note",style:"margin:0"},"Estas fotos ya están en tu tienda o vienen dos veces en este lote."),
        el("div",{class:"dups"}, fila),
        el("div",{class:"send"},
          el("button",{class:"btn primary",type:"button",onclick:()=>fin("saltar")}, `Saltar las repetidas y subir ${files.length-n}`),
          el("button",{class:"btn",type:"button",onclick:()=>fin("todas")}, `Subir las ${files.length} igual`))));
    });
  }

  // ---------- Subida en bloque ----------
  const FOTOS_POR_TANDA = 20;
  // Aviso entre partes: seguir con las fotos que faltan o dejarlas para después.
  function siguienteTanda(resto, opciones, tanda){
    const ov = $("planOverlay"); ov.textContent=""; ov.hidden=false; delete ov.dataset.dict; delete ov.dataset.conf;
    const cerrar = ()=>{ ov.hidden=true; ov.textContent=""; ov.onclick=null; };
    ov.onclick = e=>{ if(e.target===ov) cerrar(); };
    const n = resto.length;
    ov.append(el("div",{class:"cart",role:"dialog","aria-modal":"true","aria-label":"Siguiente parte"},
      el("h2",null,`Parte ${tanda.n-1} lista ✓`),
      el("p",{style:"margin:0;font-size:16px"}, `Faltan ${n} foto${n===1?"":"s"} por subir (parte ${tanda.n} de ${tanda.total}).`),
      el("p",{class:"note",style:"margin:0"}, "Si prefieres, primero revisa los precios de esta parte y luego vuelve a elegir las fotos que faltan."),
      el("div",{class:"actions",style:"justify-content:stretch;display:grid;grid-template-columns:1fr 1fr;gap:8px"},
        el("button",{class:"btn",type:"button",onclick:cerrar},"Más tarde"),
        el("button",{class:"btn primary",type:"button",onclick:()=>{ cerrar(); abrirOrganizadorFotos(resto, { ...opciones, tanda }); }},`Seguir con ${n} foto${n===1?"":"s"}`))));
  }
  function abrirOrganizadorFotos(list, opciones={}){
    if(!S.canEdit || !S.assets || !S.db) return;
    const files=[...list].filter(f=>f.type.startsWith('image/')||/\.(heic|heif)$/i.test(f.name));
    if(!files.length){toast('Selecciona al menos una foto');return;}
    // Por partes: como máximo FOTOS_POR_TANDA fotos a la vez (la IA agrupa bien hasta 20). Las demás esperan
    // y al terminar cada tanda se ofrece seguir con la siguiente.
    const tanda = opciones.tanda || { n:1, total:Math.ceil(files.length/FOTOS_POR_TANDA) };
    const resto = files.splice(FOTOS_POR_TANDA);
    if(tanda.n===1 && resto.length) toast(`Elegiste ${files.length+resto.length} fotos: las subimos por partes, de ${FOTOS_POR_TANDA} en ${FOTOS_POR_TANDA}. Parte 1 de ${tanda.total}.`);
    // "Completa con internet": primero se lee la foto y con esa marca y nombre se busca la ficha en internet.
    const conInternet = !!(opciones.asistente && S.buscarInternet && /internet|\bweb\b|google|en l[ií]nea|busca|investiga/i.test(opciones.texto||''));
    const web = { hechos: [], sinDatos: [], limite: false, error: false };
    const sinLeer = [];
    const pd = opciones.porDefecto || {};
    abrirOrganizador(files,{
      // La IA agrupa sola las fotos del mismo producto (asistente, "Con fotos" y "Productos con varias fotos").
      autoSugerir:!!opciones.agrupar || (!!opciones.asistente && !opciones.cadaFoto),
      cadaFoto:!!opciones.cadaFoto,
      publicar:!!opciones.publicar,
      instrucciones:opciones.texto||'',
      preparar:async f=>{const foto=await processPhoto(f,modoGuardado()||'mejorar');delete foto._blob;return foto;},
      limpiar:deletePhotos,
      agrupar:agruparFotos,
      permitir:n=>{if(n>usoPlan().libres){toast('Los grupos superan los productos disponibles en tu plan');return false;}return true;},
      referencia:()=>S.db.collection('productos').doc(),
      guardar:async(ref,nombre,fotos,info={})=>{
        let visual={},dictado={};
        // Un nombre puesto por la IA al agrupar es solo una pista: manda la lectura de la foto.
        const nombreGenerico = !!info.nombreIA || /^producto( \d+| nuevo)?$/i.test(String(nombre||'').trim());
        // La IA lee las fotos (hasta 3: la de la caja o la etiqueta suele traer la marca) cuando viene del
        // asistente o cuando el producto todavía no tiene un nombre de verdad ("Producto 7").
        if(opciones.asistente || opciones.ia || nombreGenerico){
          // Hasta 3 intentos: con varios productos seguidos la IA a veces responde ocupada o vacía.
          for(let intento=0; intento<3 && !visual.nombre && !visual.descripcion; intento++){
            if(intento) await new Promise(r=>setTimeout(r, 1500*intento));
            try{
              const r=await ai.json('',{images:fotos.slice(0,3).map(f=>f.thumb),idioma:esUS()?'en':'es',rubro:rubroActual()});
              // Primero las fotos del producto; las que solo muestran la caja quedan al final (de ahí solo se toma la marca).
              const esCaja = x=>/^(caja|estuche|empaque|bolsa de regalo|box)\b/i.test(String(x&&x.nombre||''));
              const lect = (Array.isArray(r)?r:[]).sort((a,b)=>(esCaja(a)-esCaja(b))||((a.i||0)-(b.i||0)));
              const hayProducto = lect.some(x=>!esCaja(x));
              for(const x of lect) for(const [k,v] of Object.entries(x||{})) if(k!=='i' && v!=null && v!=='' && visual[k]==null && (!hayProducto || !esCaja(x) || k==='marca')) visual[k]=v;
            }catch(e){console.warn('No se completaron datos de la foto (intento '+(intento+1)+')',e);}
          }
          if(!visual.nombre && !visual.descripcion) sinLeer.push(nombre);
        }
        if(opciones.asistente){
          if(opciones.texto)try{const r=await interpretarDictado([`Producto: ${nombre}. Extrae solamente datos de este producto presentes en estas indicaciones; si se refieren a otro producto, deja esos campos vacíos: ${opciones.texto}`],esUS()?'en':'es',enSoles()?'PEN':'USD',rubroActual());dictado=r?.[0]||{};}catch(e){console.warn('No se interpretaron las indicaciones',e);}
        }
        // El nombre del grupo lo revisó la vendedora: si dice qué es ("Porta cosméticos beige"), eso manda
        // sobre lo que la IA creyó ver en la foto. Los nombres por defecto ("Producto 3") no cuentan.
        const nombrePropio = !nombreGenerico;
        // Marca escrita en la caja o en la descripción ("caja original de GUESS") aunque la IA no la puso como marca.
        if(!visual.marca) visual.marca = marcaDeTexto([visual.nombre, visual.descripcion].filter(Boolean).join(' ')) || '';
        if(!visual.tipo && visual.nombre) visual.tipo = tipoDeTexto(visual.nombre, rubroActual()) || '';
        const tipoNombre = nombrePropio ? tipoDeTexto(nombre, rubroActual()) : '';
        const marcaNombre = nombrePropio ? marcaDeTexto(nombre) : '';
        let extraWeb = '';
        if(conInternet && !web.limite){
          // Marca + nombre leído de la foto + tipo, sin repetir palabras que ya están en el nombre.
          const base=String(nombrePropio ? nombre : (visual.nombre||nombre||'')), tiene=w=>base.toLowerCase().includes(String(w).toLowerCase());
          const marca=marcaNombre||dictado.marca||visual.marca, tipo=nombrePropio ? '' : (visual.tipo||'');
          const consulta=[marca&&!tiene(marca)?marca:'', base, tipo&&!tiene(tipo)?tipo:''].filter(Boolean).join(' ').trim();
          if(consulta.length>2){
            try{
              const r=await S.buscarInternet(consulta);
              if(r && r.limite) web.limite=true;
              else if(r && r.ok && r.encontrado){
                extraWeb=[r.descripcion, r.material&&('Material: '+r.material+'.'), r.medidas&&('Medidas: '+r.medidas+'.'), r.colores&&('Colores: '+r.colores+'.')].filter(Boolean).join(' ');
                web.hechos.push({nombre:nombrePropio?nombre:(visual.nombre||nombre), modelo:r.modelo, precio:r.precio_usd, fuentes:r.fuentes||[]});
              } else if(r && r.ok) web.sinDatos.push(nombrePropio?nombre:(visual.nombre||nombre));
              else web.error=true;
            }catch(e){console.warn('No se buscó en internet',e);web.error=true;}
          }
        }
        let precio=dictado.precio??pd.precio??null;
        if(precio==null && pd.margen!=null && visual.costo) precio=precioConMargen(visual.costo, pd.margen);
        const moneda=enSoles()?'PEN':'USD';if(precio!=null&&dictado.moneda&&dictado.moneda!==moneda&&tipoCambio())precio=moneda==='PEN'?Math.round(precio*tipoCambio()*100)/100:Math.round(precio/tipoCambio()*100)/100;
        const tipoFinal = tipoNombre || visual.tipo || '';
        const nombreFinal = nombrePropio ? nombre : (visual.nombre || dictado.nombre || nombre);
        const datos={nombre:nombreFinal,...(tipoFinal?{tipo:tipoFinal}:{}),marca:marcaNombre||dictado.marca||pd.marca||visual.marca||'',precio,stock:dictado.stock??pd.stock??1,...(visual.costo?{costo:visual.costo}:{}),talla:dictado.talla||visual.talla||'',categoria:(tipoNombre&&categoriaDeTipo(tipoNombre))||dictado.categoria||pd.cat||visual.categoria||'',publico:dictado.publico||visual.publico||'',descripcion:(extraWeb||dictado.descripcion||visual.descripcion||'').slice(0,600),condicion:dictado.condicion||pd.condicion||visual.condicion||'',estado:opciones.publicar?'disponible':'oculto',fotos,creado:Date.now()};
        await ref.set(datos);
        if(!S.products.some(p=>p.id===ref.id))S.products.push({id:ref.id,...datos});
      },
      terminar:ids=>{
        render();toast(opciones.publicar ? (sinLeer.length ? `Productos publicados. La IA no pudo leer ${sinLeer.length===1?'1 producto':sinLeer.length+' productos'}: complétalo${sinLeer.length===1?'':'s'} en la lista.` : 'Productos publicados. Revisa precio y datos en la lista.') : sinLeer.length ? `Guardados como ocultos. La IA no pudo leer ${sinLeer.length===1?'1 producto':sinLeer.length+' productos'}: complétalo${sinLeer.length===1?'':'s'} en la lista.` : 'Productos guardados como ocultos. Revisa los datos antes de publicarlos.');
        if(conInternet) avisoWeb(web);
        abrirLote(ids,'subida');
        if(resto.length) setTimeout(()=>siguienteTanda(resto, opciones, { n:tanda.n+1, total:tanda.total }), 900);
      },
    });
  }
  // Resumen de lo que se completó con internet, con sus fuentes, en el chat del asistente.
  function avisoWeb(web){
    const l=[];
    if(web.hechos.length){
      l.push(`Completé con internet la descripción de ${web.hechos.length} producto${web.hechos.length===1?'':'s'}. Revísala antes de publicar:`);
      web.hechos.forEach(h=>l.push(`- **${h.nombre}**${h.modelo&&h.modelo!==h.nombre?` (${h.modelo})`:''}${h.precio?` · en EE. UU. cuesta unos $${h.precio}`:''}`));
    }
    if(web.sinDatos.length) l.push(`No encontré en internet ese mismo modelo para: ${web.sinDatos.join(', ')}. Les dejé lo que se ve en la foto.`);
    if(web.limite) l.push('Se acabaron las búsquedas en internet de hoy; los demás productos quedaron con lo que se ve en la foto. Mañana se renuevan.');
    if(web.error) l.push('Algunas búsquedas en internet no respondieron; esos productos quedaron con lo que se ve en la foto.');
    const fuentes=[...new Set(web.hechos.flatMap(h=>h.fuentes.map(f=>f.url)))].slice(0,10);
    if(fuentes.length) l.push('', 'Fuentes de internet:', ...fuentes.map(u=>'- '+u));
    if(!l.length) return;
    cargarAsis(); asisLog.push({role:'assistant',text:l.join('\n')}); guardarAsis();
    if(!$('asis').hidden) pintarAsis(); else setTimeout(()=>toast('Te dejé en el Asistente lo que encontré en internet, con las fuentes.'), 2500);
  }
  // Opciones antes de subir (precio, categoría, marca, cantidad, margen y condición para todo el lote).
  function valoresPorDefecto(){
    const v = { precio:parsePrice($("defPrice").value), cat:$("defCat").value.trim(), marca:$("defMarca").value.trim(), stock:parseStock($("defStock").value), margen:parseMargen($("defMargen").value), condicion:$("defCond").value };
    for(const k of Object.keys(v)) if(v[k]==null || v[k]==="") delete v[k];
    return v;
  }
  // Al elegir las fotos se leen UNA vez, de a una, y se guarda una copia liviana (máx. 2048 px) en memoria.
  // Así no se vuelven a pedir a la galería (con Google Fotos, leer muchas fotos grandes varias veces
  // las dejaba en blanco) y todo lo que sigue es más rápido. Se ve el avance en pantalla.
  async function leerFotos(lista){
    const files = [...lista].filter(f => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
    if(!files.length) return { fotos:[], fallidas:0 };
    const ov = el("div",{class:"overlay lectura-fotos"});
    const txt = el("strong",null,"Leyendo tus fotos…"), paso = el("span",null,""), barra = el("span");
    ov.append(el("div",{class:"cart lectura-caja",role:"status","aria-live":"polite"}, el("span",{class:"org-giro","aria-hidden":"true"}), el("div",null, txt, paso), el("div",{class:"org-trabajo-barra"}, barra)));
    document.body.append(ov);
    const fotos = []; let fallidas = 0;
    try{
      for(let i=0;i<files.length;i++){
        paso.textContent = `Foto ${i+1} de ${files.length}`; barra.style.width = Math.max(6, Math.round(100*i/files.length))+"%";
        const f = files[i];
        try{
          const img = await decode(f);
          const w = img.naturalWidth||img.width, h = img.naturalHeight||img.height, k = Math.min(1, 2048/Math.max(w,h));
          const c = document.createElement("canvas"); c.width = Math.round(w*k); c.height = Math.round(h*k);
          c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); if(img.close) img.close();
          const b = await new Promise(r=>c.toBlob(r,"image/jpeg",.92));
          if(!b || b.size < 1000) throw new Error("vacía");
          fotos.push(new File([b], (f.name||"foto").replace(/\.[^.]+$/,"")+".jpg", { type:"image/jpeg", lastModified:f.lastModified||Date.now() }));
        }catch(e){
          // No se pudo leer aquí (por ejemplo HEIC): se intenta con el archivo original más adelante.
          if(/\.(heic|heif)$/i.test(f.name) || /heic|heif/i.test(f.type)) fotos.push(f); else fallidas++;
        }
      }
    }finally{ ov.remove(); }
    if(fallidas) toast(`${fallidas===1?"1 foto no se pudo":fallidas+" fotos no se pudieron"} leer. Si están en Google Fotos, descárgalas al celular y vuelve a elegirlas.`);
    return { fotos, fallidas };
  }
  async function handleFiles(list, organizado=false){
    if(!organizado){ const r = await leerFotos(list); if(!r.fotos.length){ if(!r.fallidas) toast("Ninguno de esos archivos es una foto"); return; } list = r.fotos; }
    // Agrupar fotos de varios productos: organizador con sugerencia de la IA.
    if(S.mode==='group' && !organizado) { abrirOrganizadorFotos(list,{asistente:true,publicar:true,porDefecto:valoresPorDefecto()}); return; }
    const files = [...list].filter(f => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
    if(!files.length){ toast("Ninguno de esos archivos es una foto"); return; }
    if(!S.assets || !S.db){ toast("Solo quien administra la vitrina puede subir fotos"); return; }
    if(!limitarLote(files, S.mode)) return;
    const modoFoto = await elegirModo(files);
    if(!modoFoto) return;
    // Fotos repetidas: contra la tienda y dentro del mismo lote (no aplica a "varias fotos = 1 producto")
    let huellas = [];
    if(!(S.mode==="group" && files.length>1)){
      $("progress").hidden=false; setProg(0, files.length, "Revisando fotos repetidas…");
      const aviso = el("div",{class:"overlay lectura-fotos"}, el("div",{class:"cart lectura-caja",role:"status"}, el("span",{class:"org-giro","aria-hidden":"true"}), el("div",null, el("strong",null,"Revisando fotos repetidas…"), el("span",null,"Un momento"))));
      document.body.append(aviso);
      try{ huellas = []; for(const f of files) huellas.push(await huellaDeArchivo(f)); await asegurarHuellas(); }
      finally{ aviso.remove(); }
      const existentes = S.products.map(p=>p.huella).filter(Boolean);
      const repetidas = [];
      huellas.forEach((h, idx)=>{
        if(!h) return;
        if(existentes.some(e=>parecidas(e, h))) repetidas.push({ idx, motivo:"Ya está en tu tienda" });
        else if(huellas.slice(0, idx).some(o=>parecidas(o, h))) repetidas.push({ idx, motivo:"Repetida en este lote" });
      });
      if(repetidas.length){
        const decision = await preguntarRepetidas(files, repetidas);
        if(!decision){ $("progress").hidden = true; return; }
        if(decision==="saltar"){
          const fuera = new Set(repetidas.map(r=>r.idx));
          for(let k=files.length-1; k>=0; k--) if(fuera.has(k)){ files.splice(k,1); huellas.splice(k,1); }
          if(!files.length){ $("progress").hidden = true; toast("Todas las fotos ya estaban en tu tienda"); return; }
        }
      }
    }
    // "Con fotos": también pasa por el organizador (cada foto empieza como un producto) para poder
    // ver, mover, girar o juntar fotos antes de guardar. La IA lee cada foto al guardar.
    if(!organizado){ $("progress").hidden = true; abrirOrganizadorFotos(files,{cadaFoto:true,agrupar:true,ia:!!(S.ai && $("aiToggle").checked),publicar:true,porDefecto:valoresPorDefecto()}); return; }
    S.fondoFallos = 0;
    const price = parsePrice($("defPrice").value), cat = $("defCat").value.trim(), marca = $("defMarca").value.trim(), stock = parseStock($("defStock").value), margen = parseMargen($("defMargen").value), condicion = $("defCond").value;
    const useAI = S.ai && $("aiToggle").checked;
    const total = files.length; let done = 0, ok = 0; const errs = $("errs"); errs.textContent="";
    const fallidas = [], motivos = new Set();
    const textoSubida = modoFoto==="fondo" ? "Quitando fondos con IA y subiendo…" : modoFoto==="mejorar" ? "Mejorando y subiendo fotos…" : "Subiendo fotos…";
    $("progress").hidden=false; setProg(0,total,textoSubida);
    const col = S.db.collection("productos"); const base = Date.now();
    const group = S.mode==="group" && files.length>1; const groupPhotos = new Array(files.length);
    const toClassify = [], creados = [];
    let i = 0;
    async function worker(){
      while(i < files.length){
        const idx = i++; const f = files[idx];
        try{
          const ph = await processPhoto(f, modoFoto); const blob = ph.full; delete ph._blob; // foto grande: la IA lee mejor las etiquetas
          if(group){ groupPhotos[idx]={ph,blob}; }
          else {
            const nombre = nameFromFile(f), ref = col.doc();
            await ref.set({ nombre, marca, precio:price, stock, categoria:cat, publico:"", descripcion:"", condicion, estado:"disponible", fotos:[ph], huella: huellas[idx] ? huellas[idx] + "|" + (ph.thumb || ph.full) : "", creado: base + (total-idx) });
            creados.push({ id:ref.id, orden:idx });
            if(useAI) toClassify.push({ id:ref.id, blob, name:nombre==="Producto nuevo", cat:!cat, marca:!marca, cond:!condicion, desc:true, margen: price==null ? margen : null });
          }
          ok++;
        }catch(e){ fallidas.push(f); motivos.add(errText(e)); }
        done++; setProg(done,total, done<total ? textoSubida : "");
      }
    }
    await Promise.all(Array.from({length:Math.min(modoFoto==="fondo"?2:4,files.length)}, worker));
    if(group){
      const got = groupPhotos.filter(Boolean);
      if(got.length){ try{ const nombre=nameFromFile(files[0]), ref=col.doc(); creados.push({ id:ref.id, orden:0 }); await ref.set({ nombre, marca, precio:price, stock, categoria:cat, publico:"", descripcion:"", condicion, estado:"disponible", fotos:got.map(g=>g.ph), creado:base }); if(useAI) toClassify.push({ id:ref.id, blob:got[0].blob, name:nombre==="Producto nuevo", cat:!cat, marca:!marca, cond:!condicion, desc:true, margen: price==null ? margen : null }); }catch(e){ errs.append(el("li",null,"No se pudo crear el producto: "+errText(e))); ok=0; } }
    }
    const fail = total-ok;
    // Un solo aviso amable con las fotos que faltaron y un botón para reintentarlas.
    if(fallidas.length){
      const n = fallidas.length, porQue = [...motivos].join("; ");
      const reintentar = el("button",{class:"btn",type:"button",onclick:()=>{ errs.textContent=""; handleFiles(fallidas); }}, n===1 ? "Reintentar esta foto" : `Reintentar estas ${n} fotos`);
      errs.append(el("li",null, el("span",null, `${n===1 ? "1 foto no se subió" : n+" fotos no se subieron"} (${porQue}). Las demás quedaron guardadas.`), reintentar));
    }
    if(S.fondoFallos) errs.append(el("li",null,`${S.fondoFallos} foto(s) se subieron mejoradas pero sin quitar el fondo (la IA no respondió). Puedes reintentarlas más tarde.`));
    const doneMsg = fail ? `Listo: ${ok} subidas, ${fail} con problema` : (group ? `Listo: 1 producto con ${ok} fotos` : `Listo: ${ok} productos publicados`);
    setProg(total,total, doneMsg);
    $("fileInput").value="";
    if(toClassify.length){ await classify(toClassify); setProg(total,total, doneMsg + (S.aiMsg?` · ${S.aiMsg}`:"")); }
    else toast(group ? "Producto publicado" : `${ok} productos publicados`);
    // Revisión del lote: precio, marca, descripción… de todo lo que se acaba de subir
    if(creados.length){ await new Promise(r=>setTimeout(r, 700)); abrirLote(creados.sort((a,b)=>a.orden-b.orden).map(c=>c.id), "subida"); }
  }

  // ---------- Clasificación con IA ----------
  const CATS = ["Ropa","Zapatos","Carteras y bolsos","Accesorios","Relojes y joyería","Perfumes y belleza","Electrónica","Hogar","Juguetes","Otros"];
  // ---------- Código de cada producto (ej. CAR-001) ----------
  // Letras de la categoría + número. Se pone solo y no cambia aunque después cambie la categoría.
  const PREFIJOS = { "Ropa":"ROP", "Zapatos":"ZAP", "Carteras y bolsos":"CAR", "Accesorios":"ACC", "Relojes y joyería":"REL", "Perfumes y belleza":"PER", "Electrónica":"ELE", "Hogar":"HOG", "Juguetes":"JUG", "Otros":"OTR" };
  // Rubro de la tienda (moda por defecto): decide los tipos de producto que se ofrecen
  const rubroActual = () => (S.config && S.config.rubro) || "moda";
  const prefijoDe = cat => { if(PREFIJOS[cat]) return PREFIJOS[cat]; const l = String(cat||"").normalize("NFD").replace(/[^A-Za-z]/g,"").toUpperCase(); return l.length >= 3 ? l.slice(0,3) : "OTR"; };
  // Códigos ya pedidos en esta sesión: cuentan aunque la lista todavía no traiga el cambio, para no repetir números.
  // Valen 30 s: después manda lo que está guardado.
  const codigosLocales = new Map();
  const codigoDe = p => { const l = codigosLocales.get(p.id); if(l && (l.c === p.codigo || Date.now() - l.t > 30000)){ codigosLocales.delete(p.id); return p.codigo || ""; } return l ? l.c : (p.codigo || ""); };
  async function asignarCodigos(){
    if(!S.canEdit || !S.loaded) return;
    const ahora = Date.now(), orden = (a,b)=>(a.creado||0)-(b.creado||0) || String(a.id).localeCompare(String(b.id));
    const ultimo = {}, vistos = new Map(), repetidos = [];
    for(const p of [...S.products].sort(orden)){
      const c = codigoDe(p); if(!c) continue;
      // Código repetido (por ejemplo, dos pestañas o dos equipos a la vez): se queda con el producto más antiguo.
      if(vistos.has(c)){ repetidos.push(p); continue; }
      vistos.set(c, p.id);
      const m = /^([A-Z]{3})-(\d+)$/.exec(c); if(m) ultimo[m[1]] = Math.max(ultimo[m[1]]||0, +m[2]);
    }
    // Espera a que la IA ponga la categoría (o 3 minutos) para elegir bien las letras.
    const faltan = S.products.filter(p=>!codigoDe(p) && (p.tipo || p.categoria || ahora - (p.creado||0) > 180000));
    const lista = [...repetidos, ...faltan].sort(orden).slice(0, 200);
    for(const p of lista){
      const pre = prefijoDeTipo(p.tipo) || prefijoDe(p.categoria), n = (ultimo[pre]||0) + 1; ultimo[pre] = n;
      const codigo = pre + "-" + String(n).padStart(3,"0");
      const l = { c: codigo, t: Date.now() }; codigosLocales.set(p.id, l);
      S.db.doc("productos/"+p.id).update({ codigo }).catch(()=>{ if(codigosLocales.get(p.id) === l) codigosLocales.delete(p.id); });
    }
  }
  // "car 002", "CAR-2", "car002" → "CAR-002" ('' si no es un código)
  const normCodigo = s => { const m = /^\s*([a-zA-Z]{3})[\s\-_.#]*0*(\d{1,5})\s*$/.exec(String(s||"")); return m ? m[1].toUpperCase() + "-" + m[2].padStart(3,"0") : ""; };
  const codTag = p => codigoDe(p) ? el("span",{class:"cod-tag"}, codigoDe(p)) : null;
  // Enlace de invitación a un grupo de WhatsApp (solo se acepta chat.whatsapp.com)
  const grupoValido = v => { const m = /^\s*(?:https?:\/\/)?chat\.whatsapp\.com\/(?:invite\/)?([A-Za-z0-9]{10,40})\s*$/.exec(String(v||"")); return m ? "https://chat.whatsapp.com/" + m[1] : ""; };
  // ---------- Ofertas con fecha de fin ----------
  // Vendedora: el producto trae precio normal + precioOferta + ofertaHasta. Cliente: el catálogo ya manda el precio
  // de oferta en "precio" y el normal en "precioAntes".
  function oferta(p){
    if(!p) return null;
    if(p.precioAntes!=null && p.precio!=null) return { precio:p.precio, antes:p.precioAntes, hasta:p.ofertaHasta, pct: Math.round((1 - p.precio/p.precioAntes)*100) };
    if(p.precio!=null && p.precioOferta!=null && p.precioOferta < p.precio && p.ofertaHasta > Date.now())
      return { precio:p.precioOferta, antes:p.precio, hasta:p.ofertaHasta, pct: Math.round((1 - p.precioOferta/p.precio)*100) };
    return null;
  }
  const precioHoy = p => { const o = oferta(p); return o ? o.precio : p.precio; };
  const fechaOferta = ms => { const d = new Date(ms), hoy = new Date(), man = new Date(Date.now()+864e5);
    if(d.toDateString()===hoy.toDateString()) return tx("hoy","today");
    if(d.toDateString()===man.toDateString()) return tx("mañana","tomorrow");
    return d.toLocaleDateString(EN() ? "en-US" : "es-PE", { weekday:"short", day:"numeric", month:"short" }); };
  // Fin de la oferta (23:59:59 en la hora del equipo de la vendedora)
  const finDia = d => { const x = new Date(d); x.setHours(23,59,59,0); return x.getTime(); };
  const hastaOferta = v => { const hoy = new Date();
    if(v==="hoy") return finDia(hoy);
    if(v==="domingo"){ const d = new Date(hoy); d.setDate(d.getDate() + ((7 - d.getDay()) % 7)); return finDia(d); }
    const n = Number(v); if(n > 0){ const d = new Date(hoy); d.setDate(d.getDate() + n - 1); return finDia(d); }
    return null; };
  const precioConDescuento = (precio, pct) => enSoles() ? Math.round(precio * (1 - pct/100)) : Math.round(precio * (1 - pct/100) * 100) / 100;
  const textoOferta = o => tx(`Oferta hasta ${fechaOferta(o.hasta)}`, `Sale ends ${fechaOferta(o.hasta)}`);
  const PUBLICOS = ["Mujer","Hombre","Niños","Unisex"];
  async function classify(items){
    if(!S.ai || !items.length) return;
    const per = Math.max(1, Math.min(8, S.aiMax||1));
    let n = 0, fails = 0; S.aiMsg = "";
    for(let k=0; k<items.length; k+=per){
      const batch = items.slice(k, k+per);
      setProg(n, items.length, "Detectando categorías con IA…");
      const prompt = `Eres el asistente de una tienda ${esUS() ? "de Estados Unidos" : "en Perú que revende productos traídos de Estados Unidos"}. Te paso ${batch.length} foto(s) de producto, en orden, numeradas desde 0.
Para cada foto responde un objeto con:
- "i": el número de la foto
- "tipo": el tipo de producto, exactamente uno de: ${tiposDe(rubroActual()).map(t=>t[0]).join(", ")}; si no es ninguno, ""
- "categoria": exactamente una de: ${CATS.join(", ")}
- "publico": exactamente uno de: ${PUBLICOS.join(", ")} (usa Unisex si no se distingue)
${esUS() ? '- "nombre": nombre corto de venta EN INGLÉS (la tienda vende a clientes de EE. UU.), de 2 a 6 palabras, que describa tipo, estilo y color, sin la marca (ej. "Wide leg drawstring jeans", "Black running sneakers").' : '- "nombre": nombre corto de venta en español, de 2 a 6 palabras, que describa tipo, estilo y color, sin la marca (ej. "Jean wide leg con cordón", "Zapatillas running negras").'}
- "marca": la marca solo si su logo, etiqueta o diseño característico se ve claramente en la foto; si no, "".
- "costo": el precio en dólares que se lee en la etiqueta de precio de la tienda (si hay varios, el más bajo o el de liquidación), como número; si no se ve claro, null.
- "talla": la talla si se lee en la etiqueta o en el producto (ej. "8", "M", "32x30"); si no, "".
- "condicion": exactamente una de: ${CLAVES_COND.join(", ")}. Usa nuevo_etiqueta si se ve la etiqueta de la tienda colgando; caja_abierta si está en su caja abierta; si no estás segura, "".
- "descripcion": 1 o 2 frases cortas para vender, ${esUS() ? "EN INGLÉS" : "en español"}, solo con lo que se ve (tipo, color, estilo, detalles, si trae caja o etiqueta). No inventes materiales, medidas ni que es original.
Responde solo con un arreglo JSON, por ejemplo: [{"i":0,"categoria":"Zapatos","publico":"Mujer","nombre":"Mocasines rosados con lazo","marca":"","costo":19.99,"talla":"8","condicion":"nuevo_etiqueta","descripcion":"Mocasines rosados con lazo, nuevos con etiqueta. Cómodos para el día a día."}]`;
      let res;
      try { res = await S.ai.json(prompt, { images: batch.map(b=>b.blob), modelTier:"quick", idioma: esUS() ? "en" : "es", rubro: rubroActual() }); }
      catch(e){
        const c = e && e.code;
        if(c==="not_granted"||c==="sampling_disabled"||c==="images_unavailable"||c==="capability_disabled"||c==="capability_removed"||c==="not_declared"){ S.ai=null; $("aiRow").hidden=true; $("bulkAI").hidden=true; console.warn("IA no disponible:", e); S.aiMsg="La IA no está disponible en este momento; completa los datos a mano o intenta más tarde"; toast(S.aiMsg); return; }
        if(c==="rate_limited"){ S.aiMsg=`IA en pausa: ${items.length-n} sin clasificar (usa "Editar varios" › Clasificar con IA más tarde)`; return; }
        console.warn("La IA no respondió:", e); fails += batch.length; n += batch.length; S.aiError = "sin respuesta"; continue;
      }
      const arr = Array.isArray(res) ? res : [];
      await Promise.all(batch.map(async (b, j)=>{
        const r = arr.find(x=>x && Number(x.i)===j) || arr[j]; if(!r) { fails++; return; }
        const patch = {};
        // Tipo (Vestido, Falda…): la categoría sale de él
        if((b.cat || b.tipo) && categoriaDeTipo(r.tipo)){ patch.tipo = r.tipo; if(b.cat) patch.categoria = categoriaDeTipo(r.tipo); }
        else if(b.cat && CATS.includes(r.categoria)) patch.categoria = r.categoria;
        if(b.pub!==false && PUBLICOS.includes(r.publico)) patch.publico = r.publico;
        // Dictado por voz: si la foto parece de otra categoría que lo dictado, se avisa en la vista previa.
        if(b.check && CATS.includes(r.categoria) && r.categoria!==b.check && S.noCoinciden) S.noCoinciden.add(b.id);
        if(b.name && typeof r.nombre==="string" && r.nombre.trim()) patch.nombre = r.nombre.trim().slice(0,80);
        if(b.marca!==false && typeof r.marca==="string" && r.marca.trim()) patch.marca = r.marca.trim().slice(0,40);
        if(b.costo!==false && typeof r.costo==="number" && r.costo>0 && r.costo<10000){
          patch.costo = Math.round(r.costo*100)/100;
          if(b.margen!=null){ const pm = precioConMargen(patch.costo, b.margen); if(pm!=null) patch.precio = pm; }
        }
        if(b.talla!==false && typeof r.talla==="string" && r.talla.trim()) patch.talla = r.talla.trim().slice(0,12);
        if(b.cond!==false && CLAVES_COND.includes(r.condicion)) patch.condicion = r.condicion;
        if(b.desc && typeof r.descripcion==="string" && r.descripcion.trim()) patch.descripcion = r.descripcion.trim().slice(0,300);
        if(Object.keys(patch).length){ try{ await S.db.doc("productos/"+b.id).update(patch); }catch(e){ fails++; } }
      }));
      n += batch.length; setProg(n, items.length, "Detectando categorías con IA…");
    }
    S.aiMsg = fails ? `IA: ${items.length-fails} completados, ${fails} sin completar (márcalos y toca "Clasificar con IA" para reintentar)` : `IA: ${items.length} completados`;
    S.aiError = "";
    toast(S.aiMsg);
  }
  async function classifySelected(){
    const ids=[...S.sel]; if(!ids.length) return;
    $("progress").hidden=false; $("errs").textContent="";
    setProg(0, ids.length, "Preparando fotos…");
    const items=[];
    for(const id of ids){
      const p=S.products.find(x=>x.id===id), f=p&&p.fotos&&p.fotos[0]; if(!f) continue;
      items.push({ id, blob:f.full||f.thumb, name:true, cat:true, cond:!p.condicion, desc:!p.descripcion });
    }
    if(!items.length){ toast("Esos productos no tienen fotos"); return; }
    await classify(items); setProg(items.length, items.length, S.aiMsg||"Listo");
  }

  function setProg(d,t,msg){ $("progBar").style.width = (t? d/t*100:0)+"%"; $("progCount").textContent = d+" / "+t; if(msg) $("progText").textContent = msg; }

  // ---------- Render ----------
  // Ordenar: más nuevos (como vienen) o por precio de hoy (con oferta); los "a consultar" al final
  const ORDEN_KEY = "vitrina-orden";
  S.orden = (()=>{ try{ return localStorage.getItem(ORDEN_KEY) || "nuevos"; }catch(e){ return "nuevos"; } })();
  function ordenar(lista){
    if(S.orden !== "barato" && S.orden !== "caro") return lista;
    const sig = S.orden === "barato" ? 1 : -1;
    return [...lista].sort((a,b)=>{ const pa = precioHoy(a), pb = precioHoy(b);
      if(pa==null && pb==null) return 0; if(pa==null) return 1; if(pb==null) return -1; return sig * (pa - pb); });
  }
  function filtered(){ return ordenar(filtrar()); }
  function filtrar(){
    const q = S.q.toLowerCase(), cod = normCodigo(S.q);
    if(cod) return S.products.filter(p => normCodigo(codigoDe(p)) === cod);
    return S.products.filter(p => (!S.cat || p.categoria===S.cat) && (!S.pub || p.publico===S.pub || (S.pub!=="Niños" && p.publico==="Unisex")) && (!q || ((p.codigo||"")+" "+(p.codigo||"").replace("-","")+" "+(p.tipo||"")+" "+p.nombre+" "+(p.trNombre||"")+" "+(p.trDescripcion||"")+" "+(p.marca||"")+" "+(p.talla?"talla size "+p.talla:"")+" "+(p.categoria||"")+" "+catTxt(p.categoria||"")+" "+(p.publico||"")+" "+pubTxt(p.publico||"")+" "+condTxt(p.condicion)+" "+(p.descripcion||"")).toLowerCase().includes(q)));
  }
  function renderCats(){
    const counts = {}; S.products.forEach(p=>{ if(p.categoria) counts[p.categoria]=(counts[p.categoria]||0)+1; });
    const order = c => { const i=CATS.indexOf(c); return i<0 ? CATS.length-1.5 : i; };
    const cats = Object.keys(counts).sort((a,b)=>order(a)-order(b) || a.localeCompare(b,"es"));
    const pubs = PUBLICOS.filter(x=>x!=="Unisex" && S.products.some(p=>p.publico===x));
    const box=$("cats"); box.textContent="";
    if(cats.length){
      box.append(el("button",{class:"chip","aria-pressed":String(!S.cat),onclick:()=>{S.cat="";render();}},tx("Todo","All")));
      cats.forEach(c=>box.append(el("button",{class:"chip","aria-pressed":String(S.cat===c),onclick:()=>{S.cat=S.cat===c?"":c;render();}}, catTxt(c)+" ", el("span",{class:"cn"},String(counts[c])))));
    }
    const pb=$("pubs"); pb.textContent="";
    if(pubs.length>1) pubs.forEach(x=>pb.append(el("button",{class:"chip sub","aria-pressed":String(S.pub===x),onclick:()=>{S.pub=S.pub===x?"":x;render();}},pubTxt(x))));
    const dl=$("catList"); dl.textContent=""; [...new Set([...CATS,...cats])].forEach(c=>dl.append(el("option",{value:c})));
    const ml=$("marcaList"); ml.textContent=""; [...new Set([...S.products.map(p=>p.marca).filter(Boolean), ...MARCAS])].sort((a,b)=>a.localeCompare(b,"es")).forEach(m=>ml.append(el("option",{value:m})));
    if(S.cat && !cats.includes(S.cat)) S.cat="";
    if(S.pub && !pubs.includes(S.pub)) S.pub="";
  }
  // Vendedora: siempre ve la cantidad. Cliente: solo cuando quedan pocas.
  function stockTxt(p){
    if(typeof p.stock!=="number" || p.estado==="vendido") return "";
    if(S.canEdit) return p.stock===0 ? "Sin unidades" : `${p.stock} en stock`;
    if(p.stock===0) return "";
    return p.stock<=3 ? (p.stock===1 ? tx("¡Última unidad!","Last one!") : tx(`Quedan ${p.stock}`,`Only ${p.stock} left`)) : "";
  }
  function render(){
    renderCats();
    const list = filtered(), grid=$("grid"); grid.textContent="";
    for(const p of list){
      const cover = p.fotos && p.fotos[0];
      const st = p.estado||"disponible";
      const card = el("div",{class:"card "+st+(p.stock===0?" agotado":"")+(S.sel.has(p.id)?" sel":"")});
      // Los grupos para juntar solo se ven en "Modo juntar"; al seleccionar para editar o borrar no aparecen.
      const grupoUnion=S.selecting&&S.juntando?gruposUnion.propietario(p.id):null;
      if(grupoUnion){card.classList.add('en-grupo-union');card.style.setProperty('--grupo-color',gruposUnion.color(grupoUnion.id));card.append(el('span',{class:'grupo-etiqueta'},grupoUnion.nombre));}
      if(!p.unidoA) card.dataset.producto=p.id;
      if(S.canEdit && p.unidoA) card.append(el('span',{class:'union-etiqueta'},'Ya unido a otro producto'));
      if(S.canEdit && S.selecting && S.juntando){
        const asa=el('button',{class:'drag-asa',type:'button','aria-label':'Arrastrar '+nom(p)+' para juntar'},'⠿ Arrastrar para juntar');
        asa.disabled=!!p.unidoA || !!grupoUnion;
        asa.textContent=p.unidoA?'Ya unido':grupoUnion?grupoUnion.nombre:'⠿ Arrastrar para juntar';
        card.append(asa);
        if(!asa.disabled) arrastrable(asa,{destino:'.card[data-producto]',soltar:destino=>{
          const otro=destino.dataset.producto; if(otro===p.id) return;
          const destinoGrupo=gruposUnion.propietario(otro);
          if(destinoGrupo)S.sel=gruposUnion.activar(destinoGrupo.id);
          const seleccion = new Set([...S.sel,otro,p.id]);
          const productos = [...seleccion].map(id=>S.products.find(x=>x.id===id));
          if(productos.some(x=>!x)){toast('Algún producto ya no está disponible. Revisa la selección.');return;}
          try{prepararUnion(productos,[...seleccion][0]);}catch(e){toast(e.message);return;}
          S.sel=gruposUnion.asignar(seleccion); render();
          toast(`${seleccion.size} productos preparados. Puedes agregar más o tocar Juntar.`);
        }});
      }
      if(S.canEdit&&S.selecting&&S.juntando&&grupoUnion){
        const mover=el('select',{'aria-label':'Grupo de '+nom(p)});
        gruposUnion.grupos.forEach(g=>mover.append(el('option',{value:g.id},g.nombre)));mover.value=grupoUnion.id;
        mover.onchange=()=>{S.sel=gruposUnion.activar(Number(mover.value));S.sel.add(p.id);S.sel=gruposUnion.asignar(S.sel);render();};card.append(mover);
      }
      const open = el("button",{class:"open",type:"button","aria-label":(S.selecting?"Seleccionar ":tx("Ver ","View "))+(nom(p)||tx("producto","product")),onclick:()=>{ if(S.selecting){ toggleSel(p.id); } else openProduct(p.id); }});
      const ph = el("div",{class:"ph"});
      if(cover) ph.append(el("img",{src:src(cover.thumb||cover.full),alt:"",loading:"lazy",decoding:"async",onerror:function(){this.remove();}}));
      const of = oferta(p), pv = precioHoy(p);
      ph.append(el("span",{class:"price"+(pv==null?" none":"")+(of?" oferta":"")}, pv==null ? tx("Consultar","Ask price") : money(pv), of ? el("s",null, money(of.antes)) : null, pv!=null && soles(pv) ? el("small",null, soles(pv)) : null));
      if(of) ph.append(el("span",{class:"oferta-tag"}, `-${of.pct} %`));
      if(st!=="disponible") ph.append(el("span",{class:"status "+st}, {vendido:tx("Vendido","Sold"),apartado:tx("Apartado","On hold"),oculto:"Oculto"}[st]||st));
      else if(p.stock===0) ph.append(el("span",{class:"status agotado"},tx("Agotado","Sold out")));
      if(S.selecting) ph.append(el("span",{class:"check","aria-hidden":"true"}, S.sel.has(p.id)?"✓":""));
      else if(p.fotos && p.fotos.length>1) ph.append(el("span",{class:"multi"}, p.fotos.length+tx(" fotos"," photos")));
      const contado = pv!=null && !agotado(p) ? solesContado(pv) : null;
      // Producto de una tienda de confianza: la cantidad es la del original.
      const ic = S.canEdit && esCopia(p) ? infoCopia(p) : null;
      const ps = ic ? { ...p, stock: ic.stock } : p;
      open.append(ph, el("div",{class:"info",style:"padding-bottom:0"}, contado!=null ? el("span",{class:"contado"}, `S/ ${contado.toLocaleString("es-PE")} ` + tx("con Yape o efectivo","with Yape or cash")) : null, (p.marca || p.codigo) ? el("span",{class:"tags-row"}, p.marca ? el("span",{class:"marca-tag"},p.marca) : null, codTag(p)) : null, el("span",{class:"name"},nom(p)||tx("Sin nombre","Untitled")), of ? el("span",{class:"oferta-hasta"}, textoOferta(of)) : null, p.condicion ? el("span",{class:"cond-tag cond-"+p.condicion}, condTxt(p.condicion)) : null, S.canEdit ? etiquetaConf(p) : null, el("span",{class:"meta"}, el("span",null,[catTxt(p.categoria), p.talla ? tx("Talla ","Size ")+p.talla : ""].filter(Boolean).join(" · ")), el("span",null,pubTxt(p.publico||""))), S.canEdit && p.costo!=null && !esCopia(p) ? el("span",{class:"costo"}, `Costo ${usd(p.costo)}`+(p.precio!=null && costoMon(p.costo) ? ` · margen ${Math.round((p.precio/costoMon(p.costo)-1)*100)} %` : "")) : null, ic && ic.precioReventa!=null ? el("span",{class:"costo"}, `Te cuesta ${money(ic.precioReventa)}` + (p.precio!=null ? ` · ganas ${money(p.precio - ic.precioReventa)}` : "")) : null, stockTxt(ps) ? el("span",{class:"stockpill"+(S.canEdit && ps.stock>3?" ok":"")}, stockTxt(ps)) : null));
      card.append(open);
      if(!S.selecting) card.append(el("div",{class:"info",style:"padding-top:0"}, addButton(p)));
      grid.append(card);
    }
    const n = S.products.length;
    if(S.canEdit) marcarTab("productos", n, false); else pintarPortada();
    $("count").textContent = n ? (list.length===n ? tx(`${n} productos`,`${n} products`) : tx(`${list.length} de ${n} productos`,`${list.length} of ${n} products`)) : "";
    const empty=$("empty");
    if(S.loaded && !n){ empty.hidden=false; $("emptyTitle").textContent = S.canEdit ? "Tu vitrina está vacía" : tx("Pronto habrá productos aquí","Products coming soon"); $("emptyText").textContent = S.canEdit ? "Arrastra todas tus fotos al recuadro de arriba. Cada foto se convierte en un producto listo para vender, y después le pones nombre y precio." : tx("Esta tienda todavía no ha publicado productos. Vuelve en un rato.","This store hasn't published any products yet. Check back soon."); }
    else if(S.loaded && !list.length){ empty.hidden=false; $("emptyTitle").textContent=tx("Nada coincide con tu búsqueda","No matches"); $("emptyText").textContent=tx("Prueba con otra palabra o quita el filtro de categoría.","Try another word or clear the category filter."); }
    else empty.hidden = S.loaded;
    // Cliente: si la tienda no existe o aún no abre, ese aviso manda (no "Pronto habrá productos aquí")
    if(!S.canEdit && S.loaded && !n) mensajeEstadoPublico(true);
    renderBulk();
    renderCartBar();
  }

  // ---------- Selección en bloque ----------
  function toggleSel(id){
    const p=S.products.find(x=>x.id===id);
    if(!S.juntando){ S.sel.has(id)?S.sel.delete(id):S.sel.add(id); render(); return; }
    if(p?.unidoA){toast('Este producto ya está unido. Usa su producto principal.');return;}
    const anterior=gruposUnion.propietario(id);
    if(anterior&&anterior.id!==gruposUnion.activo){S.sel=gruposUnion.activar(anterior.id);render();return;}
    S.sel.has(id)?S.sel.delete(id):S.sel.add(id);S.sel=gruposUnion.asignar(S.sel); render();
  }
  function renderBulk(){
    if(S.juntando) gruposUnion.asignar(S.sel);
    $("bulkJuntando").hidden = !S.juntando; $("bulkAcciones").hidden = !!S.juntando; $("bulkAll").hidden = !!S.juntando;
    $("bulk").classList.toggle("juntando", !!S.juntando); $("grid").classList.toggle("seleccionando", !!S.selecting);
    $("bulkAyuda").textContent = S.juntando ? "" : (S.sel.size ? "Ahora elige qué hacer con ellos:" : "Toca los productos que quieres cambiar y elige qué hacer.");
    $("bulkAyuda").hidden = !!S.juntando;
    const leyenda=$('unionGrupos');leyenda.textContent='';
    gruposUnion.grupos.forEach(g=>leyenda.append(el('button',{class:'btn grupo-leyenda',type:'button',style:`--grupo-color:${gruposUnion.color(g.id)}`,'aria-pressed':String(g.id===gruposUnion.activo),onclick:()=>{S.sel=gruposUnion.activar(g.id);render();}},`${g.nombre} · ${g.ids.size} productos`)));
    pintarAsisSel();
    $("bulk").hidden = !S.selecting;
    $("bulkCount").textContent = S.juntando ? `${S.sel.size} en el grupo` : S.sel.size + (S.sel.size===1?" seleccionado":" seleccionados");
    $("bulkJuntar").disabled = S.sel.size < 2;
    $("bulkJuntar").textContent = S.sel.size >= 2 ? `Juntar los ${S.sel.size} productos` : 'Juntar en un producto';
    $("bulkCancelarUnion").hidden = S.sel.size < 2;
    $("bulkApply").disabled = $("bulkDel").disabled = $("bulkAI").disabled = $("bulkShare").disabled = $("bulkMover").disabled = $("bulkUnshare").disabled = !S.sel.size;
  }
  $('unionNuevo').onclick=()=>{S.sel=gruposUnion.nuevo();render();};
  function cerrarSecciones(){ document.querySelectorAll("#bulk details.bulk-seccion").forEach(d=>d.open=false); }
  function salirJuntar(){ S.juntando=false; gruposUnion.limpiar(); S.sel.clear(); cerrarSecciones(); render(); }
  $("selectBtn").onclick = ()=>{ S.selecting=true; S.juntando=false; gruposUnion.limpiar();S.sel.clear(); cerrarSecciones(); render(); $("bulk").scrollIntoView({block:"nearest"}); };
  $("bulkDone").onclick = ()=>{ S.selecting=false; S.juntando=false; gruposUnion.limpiar(); S.sel.clear(); $("bulkConfirm").hidden=true; cerrarSecciones(); render(); };
  // Juntar es un modo aparte: empieza sin nada marcado y se sale con "Salir de juntar".
  $("bulkEntrarJuntar").onclick = ()=>{ S.juntando=true; gruposUnion.limpiar(); S.sel.clear(); $("bulkConfirm").hidden=true; render(); $("bulk").scrollIntoView({block:"nearest"}); toast("Toca las fichas que son el mismo producto"); };
  $("bulkSalirJuntar").onclick = salirJuntar;
  // Abrir una sección cierra las otras: así siempre queda claro qué se está haciendo.
  document.querySelectorAll("#bulk details.bulk-seccion").forEach(d=>d.addEventListener("toggle",()=>{ if(d.open) document.querySelectorAll("#bulk details.bulk-seccion").forEach(o=>{ if(o!==d) o.open=false; }); }));
  $("bulkAll").onclick = ()=>{ const ids=filtered().filter(p=>!p.unidoA&&(!gruposUnion.propietario(p.id)||gruposUnion.propietario(p.id).id===gruposUnion.activo)).map(p=>p.id); const all=ids.every(id=>S.sel.has(id)); ids.forEach(id=>all?S.sel.delete(id):S.sel.add(id)); render(); };
  async function runPool(ids, fn){ let i=0, fails=0; await Promise.all(Array.from({length:Math.min(4,ids.length)},async()=>{ while(i<ids.length){ const id=ids[i++]; try{ await fn(id); }catch(e){ fails++; } } })); return fails; }
  $("bulkApply").onclick = async ()=>{
    const patch={}; const pv=$("bulkPrice").value.trim(), cv=$("bulkCat").value.trim(), sv=$("bulkStatus").value, pb=$("bulkPub").value, mv=$("bulkMarca").value.trim(), qv=$("bulkStock").value.trim(), cdv=$("bulkCond").value, mg=parseMargen($("bulkMargen").value);
    if(pv) patch.precio=parsePrice(pv); if(cv) patch.categoria=cv; if(sv) patch.estado=sv; if(pb) patch.publico=pb; if(mv) patch.marca=mv; if(qv) patch.stock=parseStock(qv); if(cdv) patch.condicion=cdv;
    // Oferta por tiempo: % sobre el precio normal de cada producto, o quitarla
    const ofv = $("bulkOfertaHasta").value, ofPct = parseMargen($("bulkOferta").value), quitarOf = ofv==="quitar";
    if(ofPct!=null && !(ofPct > 0 && ofPct < 100)){ toast("La oferta debe ser un porcentaje entre 1 y 99"); return; }
    const hayOferta = quitarOf || ofPct!=null, hastaOf = hayOferta && !quitarOf ? hastaOferta(ofv) : null;
    if(!Object.keys(patch).length && mg==null && !hayOferta){ toast("Escribe un precio, margen, oferta, marca, cantidad o categoría, o elige un estado o una condición"); return; }
    if(pv && mg!=null){ toast("Usa precio fijo o margen, no los dos"); return; }
    const ids=[...S.sel]; $("bulkApply").disabled=true;
    let sinCosto = 0, sinPrecio = 0;
    const fails = await runPool(ids, id=>{
      const p = S.products.find(x=>x.id===id); const cambio = { ...patch };
      // De una tienda de confianza: la cantidad y las ventas las maneja la dueña (se registran con "Registrar venta").
      if(esCopia(p)){ delete cambio.stock; if(cambio.estado && cambio.estado!=="oculto" && cambio.estado!=="disponible") delete cambio.estado; }
      if(mg!=null && !esCopia(p)){ const pm = p ? precioConMargen(p.costo, mg) : null; if(pm!=null) cambio.precio = pm; else sinCosto++; }
      if(quitarOf){ cambio.precioOferta = null; cambio.ofertaHasta = null; }
      else if(ofPct!=null){ const base = cambio.precio ?? (p && p.precio); if(base!=null){ cambio.precioOferta = precioConDescuento(base, ofPct); cambio.ofertaHasta = hastaOf; } else sinPrecio++; }
      return Object.keys(cambio).length ? S.db.doc("productos/"+id).update(cambio) : Promise.resolve();
    });
    if(sinCosto) toast(`${sinCosto} producto(s) sin costo: el margen no se aplicó a esos`);
    if(sinPrecio) toast(`${sinPrecio} producto(s) sin precio: la oferta no se aplicó a esos`);
    $("bulkPrice").value=$("bulkCat").value=$("bulkMarca").value=$("bulkStock").value=$("bulkMargen").value=$("bulkOferta").value=""; $("bulkOfertaHasta").value="7"; $("bulkStatus").value=""; $("bulkPub").value=""; $("bulkCond").value="";
    toast(fails ? `Actualizados ${ids.length-fails}; ${fails} fallaron` : `${ids.length} productos actualizados`); renderBulk();
  };
  $("dictBtn").onclick = ()=>{ if(!S.canEdit) return; abrirDictado(); };
  $("bulkAI").onclick = ()=>classifySelected();
  $("bulkShare").onclick = ()=>abrirCompartir([...S.sel]);
  $("bulkGrupo").onclick = ()=>abrirMensajeGrupo([...S.sel]);
  // Mover a otra categoría (o tipo) con botones grandes, sin escribir
  $("bulkMover").onclick = ()=>{
    const ids = [...S.sel]; if(!ids.length){ toast("Toca los productos que quieres mover"); return; }
    const ov=$("planOverlay"); ov.textContent=""; ov.hidden=false; delete ov.dataset.conf; delete ov.dataset.dict;
    const cerrar = ()=>{ ov.hidden=true; ov.textContent=""; };
    ov.onclick = e=>{ if(e.target===ov) cerrar(); };
    const mover = async (cambio, nombre)=>{
      cerrar();
      const fails = await runPool(ids, id=>S.db.doc("productos/"+id).update(cambio));
      toast(fails ? `Se movieron ${ids.length-fails}; ${fails} no se pudieron mover` : `${ids.length} producto${ids.length===1?"":"s"} movido${ids.length===1?"":"s"} a ${nombre}`);
    };
    const usadas = [...new Set(S.products.map(p=>p.categoria).filter(Boolean))];
    const cats = [...new Set([...CATS.filter(c=>c!=="Otros"), ...usadas, "Otros"])];
    const tipos = tiposDe(rubroActual());
    const card = el("div",{class:"cart",role:"dialog","aria-modal":"true","aria-label":"Mover a",style:"width:min(620px,100%)"},
      el("div",{class:"cart-head"}, el("h2",null,`Mover ${ids.length} producto${ids.length===1?"":"s"} a…`), el("button",{class:"btn",type:"button",onclick:cerrar},"Cancelar")),
      el("strong",null,"Categoría"),
      el("div",{class:"mover-grid"}, ...cats.map(c=>el("button",{type:"button",class:"mover-op",onclick:()=>mover({ categoria:c }, c)}, catTxt(c)))),
      el("details",null, el("summary",null,"O elige el tipo exacto (Vestido, Falda, Zapatillas…)"),
        el("div",{class:"mover-grid",style:"margin-top:8px"}, ...tipos.map(([t,c])=>el("button",{type:"button",class:"mover-op",onclick:()=>mover({ tipo:t, categoria:c }, t)}, t)))));
    ov.append(card);
  };
  $("grupoBtn").onclick = ()=>abrirMensajeGrupo(S.selecting ? [...S.sel] : []);
  $("bulkUnshare").onclick = async ()=>{
    const ids = [...S.sel].filter(id=>{ const p=S.products.find(x=>x.id===id); return p && p.compartido && !esCopia(p); });
    if(!ids.length){ toast("Ninguno de los seleccionados está compartido"); return; }
    const fails = await runPool(ids, id=>S.db.doc("productos/"+id).update({ compartido:false }));
    toast(fails ? `${fails} no se pudieron cambiar` : `${ids.length} producto(s) ya no se comparten. Las otras tiendas dejan de mostrarlos.`);
  };
  $("bulkDup").onclick = ()=>buscarRepetidos();
  $("bulkTabla").onclick = ()=>{ if(!S.sel.size){ toast("Selecciona productos o toca Todos"); return; } abrirLote([...S.sel], "seleccion"); };
  $("bulkJuntar").onclick = ()=>abrirUnion();
  $("bulkCancelarUnion").onclick = ()=>{S.sel=gruposUnion.quitarGrupo(gruposUnion.activo);render();toast('Grupo cancelado. No se modificó ningún producto.');};
  function abrirUnion(){
    const grupoId=gruposUnion.activo;
    if(!S.canEdit) return;
    const ids = [...S.sel], productos = ids.map(id=>S.products.find(p=>p.id===id)).filter(Boolean);
    let principalId = ids[0], portada = null, ocupado = false, seguro = productos.length <= 3;
    try { prepararUnion(productos, principalId); } catch(e) { toast(e.message); return; }
    const firma = JSON.stringify(productos);
    const ov = $("planOverlay"); ov.hidden=false; delete ov.dataset.dict; delete ov.dataset.conf;
    const cerrar = ()=>{ if(!ocupado){ ov.hidden=true; ov.textContent=""; } };
    ov.onclick = e=>{ if(e.target===ov) cerrar(); };
    function pintar(){
      const plan = prepararUnion(productos, principalId, portada);
      ov.textContent="";
      const selector = el("select",{"aria-label":"Producto principal",disabled:ocupado});
      productos.forEach(p=>selector.append(el("option",{value:p.id},`${codigoDe(p)} · ${p.nombre}`)));
      selector.value=principalId;
      selector.onchange=()=>{ principalId=selector.value; portada=null; pintar(); };
      const galeria = el("div",{class:"thumbs",style:"flex-wrap:wrap"});
      plan.fotos.forEach((f,i)=>galeria.append(el("button",{class:"t"+(i===0?" on":""),type:"button",disabled:ocupado,"aria-label":`Usar foto ${i+1} como portada`,"aria-pressed":String(i===0),onclick:()=>{ portada=f.full; pintar(); }},el("img",{src:src(f.thumb),alt:`Foto ${i+1}`,style:"width:80px;height:80px;object-fit:cover"}))));
      const confirmar = el("button",{class:"btn primary",type:"button",disabled:ocupado,onclick:async()=>{
        if(ocupado) return;
        try { verificarConfiguracionUnion(); } catch(e) { toast(errText(e)); return; }
        const actuales=ids.map(id=>S.products.find(p=>p.id===id)).filter(Boolean);
        if(JSON.stringify(actuales)!==firma){ toast("Los productos cambiaron. Cierra y vuelve a seleccionarlos para revisar los datos actuales."); return; }
        ocupado=true; pintar();
        try {
          const resultado = await ejecutarUnion(plan, {
            copiar:async f=>{
              const copiarArchivo = async path=>{
                const foto = await S.assets.download(path);
                const archivo=await S.assets.upload(foto,{type:"image/jpeg"});
                return archivo.id;
              };
              const full=await copiarArchivo(f.full);
              return {full,thumb:f.thumb===f.full?full:await copiarArchivo(f.thumb)};
            },
            actualizar:(id,patch)=>S.db.doc("productos/"+id).update(patch),
            borrar:id=>S.db.doc("productos/"+id).delete(),
          });
          const unidosDesde=[...new Set([...(plan.principal.unidosDesde||[]),...plan.secundarios.flatMap(p=>[p.id,...(p.unidosDesde||[])])])];
          const principalLocal=S.products.find(p=>p.id===plan.principal.id);
          if(principalLocal) principalLocal.unidosDesde=unidosDesde;
          const eliminados=new Set(plan.secundarios.filter(p=>!resultado.fallidos.includes(p.id)).map(p=>p.id));
          S.products=S.products.filter(p=>!eliminados.has(p.id));
          ocupado=false; cerrar();S.sel=gruposUnion.quitarGrupo(grupoId); if(!gruposUnion.grupos.some(g=>g.ids.size)){ S.juntando=false; S.selecting=false; S.sel.clear(); } render();
          if(resultado.fallidos.length) toast(`Las fotos quedaron juntas, pero ${resultado.fallidos.length} ficha(s) secundaria(s) no se pudieron eliminar. Puedes borrarlas sin volver a unir sus fotos.`);
          else toast(`Listo: queda un solo producto con ${plan.fotos.length} fotos.`);
          openProduct(plan.principal.id);
        } catch(e) { ocupado=false; pintar(); toast("No se pudo completar la unión. Revisa el producto principal antes de reintentar. "+errText(e)); }
      }},ocupado?"Juntando fotos…":`Juntar ${productos.length} fichas en una`);
      confirmar.disabled = ocupado || !seguro;
      // Las fichas que se van a juntar, con su foto, para ver que de verdad son el mismo producto.
      const fichas = el("div",{class:"union-fichas"}, ...productos.map(p=>el("div",{class:"union-ficha"}, p.fotos&&p.fotos[0] ? el("img",{src:src(p.fotos[0].thumb||p.fotos[0].full),alt:""}) : el("span"), el("span",null, `${codigoDe(p)||""} ${p.nombre||""}`.trim()))));
      const check = productos.length > 3 ? el("label",{class:"union-seguro"}, el("input",{type:"checkbox",checked:seguro?"":false,disabled:ocupado,onchange:e=>{ seguro=e.target.checked; confirmar.disabled = ocupado || !seguro; }}), ` Sí, estas ${productos.length} fichas son el mismo producto`) : null;
      ov.append(el("div",{class:"cart",role:"dialog","aria-modal":"true","aria-label":"Juntar en un producto",style:"width:min(680px,100%)"},
        el("div",{class:"cart-head"},el("h2",null,"Juntar en un producto"),el("button",{class:"btn",type:"button",disabled:ocupado,onclick:cerrar},"Cancelar")),
        el("p",{class:"union-aviso"},`Vas a juntar ${productos.length} fichas en una sola. Las otras ${plan.secundarios.length} se borran y no se puede deshacer.`),
        fichas,
        el("label",{class:"f"},"Conservar el nombre, código y precio de",selector),
        el("strong",null,`${plan.fotos.length} fotos · Toca una para elegir la portada`),galeria,check,confirmar));
    }
    pintar();
  }
  $("bulkDel").onclick = ()=>{ $("bulkN").textContent=S.sel.size; $("bulkConfirm").hidden=false; };
  $("bulkDelNo").onclick = ()=>{ $("bulkConfirm").hidden=true; };
  $("bulkDelYes").onclick = async ()=>{
    $("bulkConfirm").hidden=true; const ids=[...S.sel];
    // Las fotos de un producto de confianza son de la otra tienda: solo se quita de esta.
    const fails = await runPool(ids, async id=>{ const p=S.products.find(x=>x.id===id); await S.db.doc("productos/"+id).delete(); if(p && !esCopia(p)) await deletePhotos(p.fotos||[]); });
    S.sel.clear(); toast(fails ? `${fails} no se pudieron borrar` : `${ids.length} productos borrados`); render();
  };
  async function deletePhotos(fotos){ for(const f of fotos){ for(const id of [f.full,f.thumb]){ if(id){ try{ await S.assets.delete(id); }catch(e){} } } } }

  // ---------- Revisión del lote en tabla ----------
  // Una fila por producto: se edita todo de corrido (Tab / Enter) y se guarda junto.
  let loteIds = [], loteSucio = new Set(), loteGuardadoAlgo = false, loteCapa = null;
  const COLS_LOTE = [
    { k:"nombre", label:"Nombre", cls:"c-nombre", tipo:"text", max:120 },
    { k:"marca", label:"Marca", cls:"c-marca w-marca", tipo:"text", max:40, list:"marcaList" },
    { k:"precio", get label(){ return "Precio " + simbolo(); }, cls:"c-precio w-num", tipo:"precio" },
    { k:"stock", label:"Cantidad", cls:"c-stock w-num", tipo:"stock" },
    { k:"talla", label:"Talla", cls:"c-talla w-talla", tipo:"text", max:12 },
    { k:"descripcion", label:"Descripción", cls:"c-desc", tipo:"area" },
  ];
  function valorLote(p, c){
    const v = p[c.k];
    return v==null ? "" : String(v);
  }
  function abrirLote(ids, origen){
    loteIds = ids.filter(id=>S.products.some(p=>p.id===id)); loteSucio = new Set(); loteGuardadoAlgo = false;
    const box = $("lote"); box.textContent = "";
    if(!loteIds.length){ box.hidden = true; return; }
    const titulo = origen==="subida" ? `Revisa tu lote (${loteIds.length} producto${loteIds.length===1?"":"s"})` : `Editar ${loteIds.length} producto${loteIds.length===1?"":"s"}`;
    // Botón principal: guarda si hay cambios; si no, termina la revisión (no hay que subir a buscar "Cerrar").
    const guardar = el("button",{class:"btn primary",type:"button",id:"loteGuardar",onclick:()=>{ if(loteSucio.size) guardarLote(); else cerrarLote(); }},"Listo");
    const cerrar = el("button",{class:"btn",type:"button",onclick:cerrarLote},"Cerrar");
    box.append(el("div",{class:"lote-head"},
      el("h2",{id:"loteTitulo"}, titulo), el("button",{class:"btn lote-repetidos",type:"button",onclick:buscarRepetidos},"Buscar repetidos"), cerrar,
      el("p",{class:"note"}, origen==="subida" ? "La IA llenó lo que pudo. Revisa sobre todo el precio, la marca y la descripción." : "Cambia lo que necesites y guarda al final.",
        el("span",{class:"solo-pc"}," Enter baja a la siguiente fila."))));
    // Mismo precio para varios: lo escribe una vez y se copia a todos los productos del lote.
    if(loteIds.length > 1){
      const colPrecio = COLS_LOTE.findIndex(c=>c.tipo==="precio");
      const pp = el("input",{type:"text",inputmode:"decimal",placeholder:"Ej. 120","aria-label":"Precio para todos",class:"lote-todos-input"});
      const poner = ()=>{
        const v = parsePrice(pp.value); if(v==null){ toast("Escribe un precio"); pp.focus(); return; }
        let n = 0;
        box.querySelectorAll(`[data-col="${colPrecio}"]`).forEach(inp=>{ if(inp.value.trim() !== pp.value.trim()){ inp.value = pp.value.trim(); inp.dispatchEvent(new Event("input")); n++; } });
        toast(n ? `Precio ${money(v)} puesto en ${n} producto${n===1?"":"s"}. Revisa y toca Guardar cambios.` : "Ya tenían ese precio");
        pp.value = ""; pp.blur();
      };
      pp.addEventListener("keydown", e=>{ if(e.key==="Enter"){ e.preventDefault(); poner(); } });
      box.append(el("div",{class:"lote-todos"}, el("span",null,"¿Todos al mismo precio? ", el("b",null, simbolo())), pp,
        el("button",{class:"btn",type:"button",onclick:poner},"Poner a todos")));
    }
    const tb = el("tbody");
    loteIds.forEach((id, fila)=>{
      const p = S.products.find(x=>x.id===id);
      const cover = p.fotos && p.fotos[0];
      const tr = el("tr",{"data-id":id});
      tr.append(el("td",{class:"c-foto"}, cover ? el("img",{src:src(cover.thumb||cover.full),alt:""}) : el("span",null,""), codTag(p)));
      COLS_LOTE.forEach((c, col)=>{
        const attrs = { "data-fila":String(fila), "data-col":String(col), "aria-label":`${c.label} de ${p.nombre||"producto"}`, value: valorLote(p,c) };
        let inp;
        if(c.tipo==="area"){ inp = el("textarea",{...attrs, rows:"2", maxlength:"600", placeholder:"Talla, color, estado, si es original…"}); inp.value = valorLote(p,c); }
        else inp = el("input",{...attrs, maxlength: c.max ? String(c.max) : "12", inputmode: c.tipo==="precio" ? "decimal" : c.tipo==="stock" ? "numeric" : false, list: c.list || false,
          placeholder: c.tipo==="precio" ? "Consultar" : c.tipo==="stock" ? "—" : "", title: c.tipo==="stock" ? "Vacío = sin control de cantidad" : false});
        inp.addEventListener("input", ()=>{ loteSucio.add(id); tr.classList.add("cambiado"); if(c.tipo==="precio") pintarHint(); pintarPieLote(); });
        inp.addEventListener("keydown", e=>{
          if(e.key==="Enter" && !(c.tipo==="area" && e.shiftKey)){
            e.preventDefault();
            const sig = box.querySelector(`[data-fila="${fila+1}"][data-col="${col}"]`);
            if(sig) sig.focus(); else guardar.focus();
          }
        });
        const td = el("td",{class:c.cls, "data-label":c.label}, inp);
        let pintarHint = ()=>{};
        if(c.tipo==="precio"){
          const hint = el("span",{class:"hint"});
          pintarHint = ()=>{
            const v = parsePrice(inp.value);
            const partes = [];
            if(v!=null && soles(v)) partes.push(soles(v));
            if(p.costo!=null) partes.push(`costo ${usd(p.costo)}` + (v!=null && costoMon(p.costo) ? ` · ${Math.round((v/costoMon(p.costo)-1)*100)} %` : ""));
            hint.textContent = partes.join(" · ");
          };
          pintarHint(); td.append(hint);
        }
        tr.append(td);
      });
      const acc = el("td",{class:"c-acc"});
      const btnBorrar = el("button",{class:"btn danger lote-borrar",type:"button","aria-label":`Borrar ${p.nombre||"producto"}`},"🗑 Borrar");
      btnBorrar.onclick = ()=>{
        acc.textContent = "";
        acc.append(el("div",{class:"borrar-si"}, "¿Borrar?",
          el("span",{style:"display:flex;gap:6px"},
            el("button",{class:"btn danger",type:"button",onclick:async()=>{
              try{ const pr = S.products.find(x=>x.id===id); await S.db.doc("productos/"+id).delete(); if(pr) deletePhotos(pr.fotos||[]); quitarFilaLote(id); toast("Producto borrado"); }
              catch(e){ toast("No se pudo borrar. Intenta de nuevo."); }
            }},"Sí"),
            el("button",{class:"btn",type:"button",onclick:()=>{ acc.textContent=""; acc.append(btnBorrar); }},"No"))));
      };
      acc.append(btnBorrar); tr.append(acc);
      tb.append(tr);
    });
    box.append(el("div",{class:"tablewrap"}, el("table",null,
      el("thead",null, el("tr",null, el("th",null,"Foto"), ...COLS_LOTE.map(c=>el("th",null,c.label)), el("th",null,""))), tb)));
    // Barra fija abajo: lo que falta guardar y el botón principal, siempre a la vista.
    box.append(el("div",{class:"lote-pie"}, el("span",{id:"loteEstado",class:"lote-estado","aria-live":"polite"}),
      el("div",{class:"lote-pie-botones"}, el("button",{class:"btn",type:"button",id:"loteCerrarPie",onclick:cerrarLote},"Cerrar"), guardar)));
    pintarPieLote();
    document.body.classList.add("lote-abierto");
    // Botón atrás del celular: cierra la revisión; si hay cambios sin guardar, pregunta abajo.
    if(!loteCapa){
      loteCapa = abrirCapa(()=>{ if(loteSucio.size){ cerrarLote(); $("loteGuardar")?.scrollIntoView({block:"end"}); return false; } loteCapa = null; cerrarLote(); return true; });
      loteCapa.pendiente = ()=>loteSucio.size>0;
    }
    box.hidden = false;
    box.scrollIntoView({block:"start", behavior:"smooth"});
    // Celular: mientras se escribe, la barra de abajo se esconde para que el teclado no la deje cortada.
    if(!box.dataset.escucha){ box.dataset.escucha = "1";
    box.addEventListener("focusin", e=>{ if(e.target.matches("input,textarea")) document.body.classList.add("lote-escribiendo"); });
    box.addEventListener("focusout", ()=>setTimeout(()=>{ if(!box.contains(document.activeElement) || !document.activeElement.matches("input,textarea")) document.body.classList.remove("lote-escribiendo"); }, 0)); }
    const primero = box.querySelector('[data-fila="0"][data-col="1"]') || box.querySelector("input");
    if(primero) setTimeout(()=>primero.focus({preventScroll:true}), 350);
  }
  function pintarPieLote(){
    const e = $("loteEstado"), b = $("loteGuardar"); if(!e || !b) return;
    const n = loteSucio.size;
    e.textContent = n ? `${n} producto${n===1?"":"s"} con cambios sin guardar` : (loteGuardadoAlgo ? "✓ Todo guardado" : "Revisa y corrige lo que haga falta");
    e.classList.toggle("pendiente", n>0); e.classList.toggle("ok", !n && loteGuardadoAlgo);
    if(!b.disabled) b.textContent = n ? `Guardar cambios (${n})` : "Listo, cerrar";
    const c = $("loteCerrarPie"); if(c) c.hidden = !n;
  }
  function quitarFilaLote(id){
    const tr = document.querySelector(`#lote tr[data-id="${id}"]`); if(!tr) return;
    tr.remove(); loteIds = loteIds.filter(x=>x!==id); loteSucio.delete(id); pintarPieLote();
    if(!loteIds.length){ cerrarLote(); return; }
    const t = $("loteTitulo"); if(t) t.textContent = t.textContent.replace(/\(\d+ producto(s)?\)|\d+ producto(s)?/, m=> m.startsWith("(") ? `(${loteIds.length} producto${loteIds.length===1?"":"s"})` : `${loteIds.length} producto${loteIds.length===1?"":"s"}`);
  }
  async function guardarLote(){
    const box = $("lote"), btn = $("loteGuardar");
    if(!loteSucio.size){ toast("No hay cambios por guardar"); return; }
    btn.disabled = true; btn.textContent = "Guardando…";
    const ids = [...loteSucio];
    const fails = await runPool(ids, id=>{
      if(!box.querySelector(`tr[data-id="${id}"]`)) return Promise.resolve();
      const leer = c => box.querySelector(`tr[data-id="${id}"] [data-col="${COLS_LOTE.indexOf(c)}"]`).value;
      const patch = {};
      for(const c of COLS_LOTE){
        const v = leer(c);
        patch[c.k] = c.tipo==="precio" ? parsePrice(v) : c.tipo==="stock" ? parseStock(v) : c.k==="nombre" ? (v.trim() || "Producto nuevo") : v.trim();
      }
      return S.db.doc("productos/"+id).update(patch);
    });
    btn.disabled = false; pintarPieLote();
    if(fails){ toast(`Se guardaron ${ids.length-fails}; ${fails} no se pudieron guardar. Intenta de nuevo.`); return; }
    loteSucio.clear(); loteGuardadoAlgo = true; box.querySelectorAll("tr.cambiado").forEach(tr=>tr.classList.remove("cambiado")); pintarPieLote();
    toast(`${ids.length} producto${ids.length===1?"":"s"} guardado${ids.length===1?"":"s"}`);
  }
  function cerrarLote(){
    const box = $("lote");
    if(loteSucio.size && !box.querySelector(".lote-aviso")){
      box.querySelector(".lote-pie").prepend(el("div",{class:"lote-aviso",role:"alert"},
        el("span",{style:"flex-basis:100%"}, `Tienes ${loteSucio.size===1?'1 producto':loteSucio.size+' productos'} con cambios sin guardar. ¿Qué hago?`),
        el("button",{class:"btn primary",type:"button",onclick:async()=>{ await guardarLote(); if(!loteSucio.size) cerrarLote(); }},"Guardar y cerrar"),
        el("button",{class:"btn",type:"button",onclick:()=>{ loteSucio.clear(); cerrarLote(); }},"Descartar")));
      return;
    }
    box.hidden = true; box.textContent = ""; loteIds = []; document.body.classList.remove("lote-abierto", "lote-escribiendo");
    if(loteCapa){ const c = loteCapa; loteCapa = null; c.cerrar(); }
  }

  // ---------- Detalle / edición ----------
  let openId=null, photoIdx=0;
  function openProduct(id){ openId=id; photoIdx=0; drawSheet(); $("overlay").hidden=false; }
  function closeSheet(){ openId=null; $("overlay").hidden=true; $("overlay").textContent=""; if(!$("cli").hidden) pintarCli(); }
  $("overlay").addEventListener("click", e=>{ if(e.target.id==="overlay") (cartOpen||cuentaOpen?closeCart:closeSheet)(); });
  document.addEventListener("keydown", e=>{ if(e.key==="Escape"){ if(cartOpen||cuentaOpen) closeCart(); else if(openId) closeSheet(); } });
  async function separarFotos(p, b){
    { const u = usoPlan(); if(u && u.libres!=null && u.libres < p.fotos.length-1){ toast("Tu plan no tiene espacio para tantos productos nuevos"); return; } }
    b.disabled = true; b.textContent = "Separando…";
    const fotos = (S.products.find(x=>x.id===p.id)||p).fotos.slice(), [portada, ...resto] = fotos, nuevos = [];
    try{
      for(const f of resto){
        let v = {};
        try{ const r = await ai.json('',{images:[f.thumb||f.full],idioma:esUS()?'en':'es',rubro:rubroActual()}); v = (Array.isArray(r)&&r[0])||{}; }catch(e){}
        const ref = S.db.collection("productos").doc();
        const datos = { nombre:v.nombre||"Producto nuevo", marca:v.marca||p.marca||"", ...(v.tipo?{tipo:v.tipo}:{}), categoria:v.categoria||p.categoria||"", publico:v.publico||p.publico||"", descripcion:v.descripcion||"", condicion:v.condicion||p.condicion||"", precio:p.precio??null, stock:1, estado:p.estado||"disponible", fotos:[f], creado:Date.now() };
        await ref.set(datos); nuevos.push(ref.id);
        if(!S.products.some(x=>x.id===ref.id)) S.products.push({id:ref.id,...datos});
      }
      await S.db.doc("productos/"+p.id).update({ fotos:[portada], huella:"" });
      closeSheet(); render(); toast(`Listo: ${nuevos.length+1} productos separados. Revisa sus datos.`);
      abrirLote([p.id, ...nuevos], "subida");
    }catch(e){ toast("No se pudo separar: "+errText(e)+(nuevos.length?` (${nuevos.length} ya se crearon)`:"")); b.disabled=false; b.textContent="✂️ Separar fotos en productos"; }
  }
  function drawSheet(){
    const p = S.products.find(x=>x.id===openId); const ov=$("overlay");
    if(!p){ closeSheet(); return; }
    const fotos = p.fotos||[]; if(photoIdx>=fotos.length) photoIdx=0;
    const keep = {}; ov.querySelectorAll("input,textarea,select").forEach(i=>{ if(i.id) keep[i.id] = i.type==="checkbox" ? i.checked : i.value; });
    const editaFotos = S.canEdit && !esCopia(p);   // las fotos de un producto de confianza las maneja la otra tienda
    ov.textContent="";
    const gal = el("div",{class:"gal"});
    // Mientras carga la foto grande se ve la miniatura (ya está en caché), en vez de un recuadro en blanco.
    if(fotos[photoIdx]) gal.append(el("img",{class:"main",src:src(fotos[photoIdx].full),alt:nom(p),style:`background:#f1f3f5 url("${src(fotos[photoIdx].thumb||fotos[photoIdx].full)}") center/contain no-repeat`}));
    const th = el("div",{class:"thumbs"});
    fotos.forEach((f,i)=>{
      const t = el("button",{class:"t"+(i===photoIdx?" on":""),type:"button","aria-label":tx("Foto ","Photo ")+(i+1),onclick:()=>{photoIdx=i;drawSheet();}}, el("img",{src:src(f.thumb||f.full),alt:""}));
      if(editaFotos && fotos.length>1){
        t.append(el("span",{class:"x",role:"button",tabindex:"0","aria-label":"Quitar foto",onclick:async ev=>{ ev.stopPropagation(); const nf=fotos.filter((_,j)=>j!==i); await S.db.doc("productos/"+p.id).update({fotos:nf}); deletePhotos([f]); toast("Foto quitada"); }},"×"));
      }
      th.append(t);
    });
    if(fotos.length>1 || editaFotos) gal.append(th);
    // Girar la foto que se está viendo (90° a la derecha cada toque) y guardarla así.
    if(editaFotos && fotos[photoIdx]) gal.append(el("button",{class:"btn",type:"button",id:"girarFoto",onclick:async ev=>{
      const b = ev.currentTarget; if(b.disabled) return; b.disabled = true; b.textContent = "Girando…";
      const idx = photoIdx, vieja = fotos[idx];
      try{
        const blob = await girarImagen(src(vieja.full));
        const nueva = await processPhoto(new File([blob],"girada.jpg",{type:"image/jpeg"}), "original"); delete nueva._blob;
        const cur = ((S.products.find(x=>x.id===p.id)||p).fotos||[]).slice(); const k = cur.findIndex(f=>f.full===vieja.full);
        if(k<0) throw new Error("la foto cambió");
        cur[k] = nueva; await S.db.doc("productos/"+p.id).update({fotos:cur, huella:""}); deletePhotos([vieja]); toast("Foto girada");
      }catch(e){ toast("No se pudo girar: "+errText(e)); b.disabled = false; b.textContent = "↻ Girar foto"; }
    }},"↻ Girar foto"));
    // Fondo blanco gratis (en el celular) para la foto que se está viendo.
    if(editaFotos && fotos[photoIdx]) gal.append(el("button",{class:"btn",type:"button",id:"fondoFoto",onclick:async ev=>{
      const b = ev.currentTarget; if(b.disabled) return; b.disabled = true;
      const idx = photoIdx, vieja = fotos[idx];
      try{
        const r = await ponerFondoBlanco(src(vieja.full), t=>{ b.textContent = t; });
        const ops = [r.conCaja && {titulo:"Con su caja", url:URL.createObjectURL(r.conCaja), valor:"caja"}, r.soloProducto && {titulo:"Solo el producto", url:URL.createObjectURL(r.soloProducto), valor:"solo"}].filter(Boolean);
        b.textContent = "⬜ Fondo blanco"; b.disabled = false;
        const elegido = await compararFondo(src(vieja.full), ops);
        ops.forEach(o=>URL.revokeObjectURL(o.url));
        if(!elegido) return;
        const blob = elegido==="caja" ? r.conCaja : r.soloProducto;
        b.disabled = true; b.textContent = "Guardando…";
        const nueva = await processPhoto(new File([blob],"fondo.jpg",{type:"image/jpeg"}), "original"); delete nueva._blob;
        const cur = ((S.products.find(x=>x.id===p.id)||p).fotos||[]).slice(); const k = cur.findIndex(f=>f.full===vieja.full);
        if(k<0) throw new Error("la foto cambió");
        cur[k] = nueva; await S.db.doc("productos/"+p.id).update({fotos:cur, huella:""}); deletePhotos([vieja]); toast("Foto con fondo blanco");
      }catch(e){ toast("No se pudo poner el fondo blanco: "+((e&&e.message)||errText(e))); }
      finally{ if(b.isConnected){ b.disabled = false; b.textContent = "⬜ Fondo blanco"; } }
    }},"⬜ Fondo blanco"));
    // Separar: cada foto (menos la portada) pasa a ser su propio producto. Sirve para deshacer una unión hecha por error.
    if(editaFotos && fotos.length>1) gal.append(el("button",{class:"btn",type:"button",id:"separarFotos",onclick:ev=>{
      const b = ev.currentTarget;
      if(!b.dataset.seguro){ b.dataset.seguro="1"; b.textContent = `¿Separar en ${fotos.length} productos? Toca otra vez`; b.classList.add("danger"); setTimeout(()=>{ if(b.isConnected){ delete b.dataset.seguro; b.textContent="✂️ Separar fotos en productos"; b.classList.remove("danger"); } }, 5000); return; }
      separarFotos(p, b);
    }},"✂️ Separar fotos en productos"));
    if(editaFotos && photoIdx>0) gal.append(el("button",{class:"btn",type:"button",onclick:async()=>{ const nf=[fotos[photoIdx],...fotos.filter((_,j)=>j!==photoIdx)]; await S.db.doc("productos/"+p.id).update({fotos:nf}); photoIdx=0; toast("Portada cambiada"); }},"Usar como portada"));
    if(editaFotos){
      const add = el("input",{type:"file",accept:"image/*",multiple:"",hidden:"",id:"addPh"});
      add.onchange = async ()=>{ const fs=[...add.files]; if(!fs.length) return; toast("Subiendo "+fs.length+" foto(s)…"); const nuevas=[]; for(const f of fs){ try{ nuevas.push(await processPhoto(f, modoGuardado()||"mejorar")); }catch(e){ toast(f.name+": "+errText(e)); } } const cur=(S.products.find(x=>x.id===p.id)||p).fotos||[]; if(nuevas.length){ await S.db.doc("productos/"+p.id).update({fotos:[...cur,...nuevas]}); toast("Fotos agregadas"); } };
      gal.append(add, el("button",{class:"btn",type:"button",onclick:()=>add.click()},"+ Agregar fotos"));
    }
    const side = el("div",{class:"side"});
    if(S.canEdit && esCopia(p)) fichaCopia(p, side, keep);
    else if(S.canEdit){
      const v = (id,def)=> keep[id]!==undefined ? keep[id] : def;
      side.append(
        p.codigo ? el("span",{class:"cod-tag"}, "Código " + p.codigo) : null,
        oferta(p) ? el("div",{class:"oferta-fila"}, el("span",null, `En oferta: ${money(oferta(p).precio)} (-${oferta(p).pct} %) · ${textoOferta(oferta(p))}. El precio normal se queda en ${money(p.precio)}.`),
          el("button",{class:"linkish",type:"button",onclick:async()=>{ try{ await S.db.doc("productos/"+p.id).update({ precioOferta:null, ofertaHasta:null }); toast("Oferta terminada"); }catch(e){ toast("No se pudo quitar la oferta"); } }},"Quitar oferta")) : null,
        el("label",{class:"f"},"Nombre", el("input",{id:"eName",value:v("eName",p.nombre||""),maxlength:"120"})),
        el("div",{class:"row2"},
          el("label",{class:"f"},"Marca", el("input",{id:"eMarca",list:"marcaList",maxlength:"40",value:v("eMarca",p.marca||""),placeholder:"Ej. Michael Kors"})),
          el("label",{class:"f"},"Cantidad disponible", el("input",{id:"eStock",inputmode:"numeric",value:v("eStock",p.stock==null?"":String(p.stock)),placeholder:"Sin control"}))),
        el("div",{class:"row2"},
          el("label",{class:"f"},"Costo USD (privado)", el("input",{id:"eCosto",inputmode:"decimal",value:v("eCosto",p.costo==null?"":String(p.costo)),placeholder:"Precio de la etiqueta"})),
          el("label",{class:"f"},"Condición", (()=>{ const s=el("select",{id:"eCond"}); opcionesCond("—").forEach(([k,l])=>s.append(el("option",{value:k},l))); s.value=v("eCond",p.condicion||""); return s; })())),
        el("div",{class:"row2"},
          el("label",{class:"f"},"Talla", el("input",{id:"eTalla",maxlength:"12",value:v("eTalla",p.talla||""),placeholder:"Ej. 8, M, 32x30"}))),
        el("div",{class:"row2"},
          el("label",{class:"f"},enSoles() ? "Precio (S/)" : "Precio (USD)", el("input",{id:"ePrice",inputmode:"decimal",value:v("ePrice",p.precio==null?"":String(p.precio)),placeholder:"Consultar"})),
          el("label",{class:"f"},"Estado", (()=>{ const s=el("select",{id:"eStatus"}); [["disponible","Disponible"],["apartado","Apartado"],["vendido","Vendido"],["oculto","Oculto (no se muestra en la tienda)"]].forEach(([k,l])=>s.append(el("option",{value:k},l))); s.value=v("eStatus",p.estado||"disponible"); return s; })())
        ),
        el("div",{class:"row2"},
          el("label",{class:"f"},"Tipo", (()=>{ const s=el("select",{id:"eTipo",onchange:()=>{ const c = categoriaDeTipo(s.value); if(c) $("eCat").value = c; }}); s.append(el("option",{value:""},"—"));
            const tipos = tiposDe(rubroActual()).map(t=>t[0]); if(p.tipo && !tipos.includes(p.tipo)) tipos.unshift(p.tipo);
            tipos.forEach(t=>s.append(el("option",{value:t},t))); s.value = v("eTipo",p.tipo||""); return s; })()),
          el("label",{class:"f"},"Categoría", el("input",{id:"eCat",list:"catList",value:v("eCat",p.categoria||""),placeholder:"Ropa, zapatos…"})),
          el("label",{class:"f"},"Para", (()=>{ const s=el("select",{id:"ePub"}); [["","—"],...PUBLICOS.map(x=>[x,x])].forEach(([k,l])=>s.append(el("option",{value:k},l))); s.value=v("ePub",p.publico||""); return s; })())),
        (()=>{ const ta=el("textarea",{id:"eDesc",rows:"4",placeholder:"Talla, color, estado, si es original…"}); ta.value=v("eDesc",p.descripcion||""); return el("label",{class:"f"},"Descripción", ta); })(),
        el("fieldset",{class:"share-set"}, el("legend",null,"Tiendas de confianza"),
          el("label",{class:"chk"}, el("input",{type:"checkbox",id:"eShare",checked: v("eShare",!!p.compartido) ? "" : false}), "Compartir con mis tiendas de confianza"),
          el("label",{class:"f"},`Precio para revendedoras (${simbolo()})`, el("input",{id:"ePrecioRev",inputmode:"decimal",value:v("ePrecioRev",p.precioReventa==null?"":String(p.precioReventa)),placeholder: p.precio!=null ? "Ej. "+redondeoRev(p.precio*0.85) : "Lo que te pagan por unidad"})),
          el("span",{class:"note",style:"margin:0"},"Es lo que te pagan por cada unidad que vendan. Ellas le ponen su propio precio a sus clientes."))
      );
      const conf = el("span",{class:"confirm",hidden:""},"¿Borrar este producto?", el("button",{class:"btn danger",type:"button",onclick:async()=>{ await S.db.doc("productos/"+p.id).delete(); deletePhotos(fotos); closeSheet(); toast("Producto borrado"); }},"Sí, borrar"), el("button",{class:"btn",type:"button",onclick:()=>{conf.hidden=true;}},"No"));
      side.append(el("div",{class:"actions"},
        el("button",{class:"btn danger",type:"button",onclick:()=>{conf.hidden=false;}},"Borrar"),
        el("div",{style:"display:flex;gap:8px"}, el("button",{class:"btn",type:"button",onclick:closeSheet},"Cerrar"),
          el("button",{class:"btn primary",type:"button",onclick:async()=>{ const patch={ nombre:$("eName").value.trim()||"Producto nuevo", marca:$("eMarca").value.trim(), stock:parseStock($("eStock").value), costo:parsePrice($("eCosto").value), talla:$("eTalla").value.trim(), condicion:$("eCond").value, precio:parsePrice($("ePrice").value), estado:$("eStatus").value, tipo:$("eTipo").value, categoria:$("eCat").value.trim(), publico:$("ePub").value, descripcion:$("eDesc").value.trim(), compartido:$("eShare").checked, precioReventa:parsePrice($("ePrecioRev").value) }; if(patch.compartido && patch.precioReventa==null){ if(patch.precio==null){ toast("Para compartirlo, ponle un precio para revendedoras"); return; } patch.precioReventa = patch.precio; } const recienCompartido = patch.compartido && !p.compartido; try{ await S.db.doc("productos/"+p.id).update(patch); toast("Guardado"); closeSheet(); if(recienCompartido) confianza("avisar",{ n:1 }).catch(e=>console.warn("Aviso por correo", e)); }catch(e){ toast("No se pudo guardar. Revisa tu conexión e intenta de nuevo."); } }},"Guardar"))
      ), conf);
    } else {
      const st=p.estado||"disponible";
      side.append((p.marca || p.codigo) ? el("span",{class:"tags-row"}, p.marca ? el("span",{class:"marca-tag"},p.marca) : null, p.codigo ? el("span",{class:"cod-tag"}, tx("Código ","Code ")+p.codigo) : null) : null, el("h2",null,nom(p)||tx("Producto","Product")),
        el("div",{class:"bigprice"+(oferta(p)?" oferta":"")}, precioHoy(p)==null?tx("Precio a consultar","Price on request"):money(precioHoy(p)), oferta(p) ? el("s",null, money(oferta(p).antes)) : null, precioHoy(p)!=null && soles(precioHoy(p)) ? el("span",{class:"bigsol"}, soles(precioHoy(p)) + tx(" con tarjeta"," by card")) : null),
        oferta(p) ? el("span",{class:"oferta-hasta",style:"font-size:14px"}, `-${oferta(p).pct} % · ` + textoOferta(oferta(p))) : null,
        precioHoy(p)!=null && solesContado(precioHoy(p))!=null ? el("span",{class:"contado",style:"font-size:15px"}, `S/ ${solesContado(precioHoy(p)).toLocaleString("es-PE")} ` + tx(`pagando con Yape o efectivo (${descuento()} % menos)`,`paying with Yape or cash (${descuento()}% off)`)) : null,
        st!=="disponible" ? el("span",{class:"status "+st,style:"position:static;justify-self:start"}, st==="vendido"?tx("Vendido","Sold"):tx("Apartado","On hold")) : p.stock===0 ? el("span",{class:"status agotado",style:"position:static;justify-self:start"},tx("Agotado","Sold out")) : null,
        p.condicion ? el("span",{class:"cond-tag cond-"+p.condicion,style:"justify-self:start"}, condTxt(p.condicion)) : null,
        p.talla ? el("span",null, el("strong",null,tx("Talla: ","Size: ")), p.talla) : null,
        stockTxt(p) ? el("span",{class:"stockpill"}, stockTxt(p)) : null,
        (p.categoria||p.publico) ? el("span",{class:"note",style:"margin:0"}, [catTxt(p.categoria),pubTxt(p.publico)].filter(Boolean).join(" · ")) : null,
        descr(p) ? el("p",{class:"desc"}, descr(p)) : null);
      if(!agotado(p)){
        const b = addButton(p, true); b.classList.add("btn"); b.style.cssText="justify-self:start;padding:10px 16px;font-size:15px";
        side.append(b);
        if(cartCount()) side.append(el("button",{class:"btn tag",type:"button",style:"justify-self:start",onclick:openCart},tx("Ver mi pedido y enviar por WhatsApp","View my order")));
      }
      side.append(el("button",{class:"btn",type:"button",style:"justify-self:start",onclick:closeSheet},tx("Seguir viendo","Keep browsing")));
    }
    ov.append(el("div",{class:"sheet",role:"dialog","aria-modal":"true","aria-label":nom(p)||tx("Producto","Product")}, gal, side));
  }

  // ---------- Pedido por WhatsApp ----------
  const CART_KEY = "vitrina-pedido";
  let cart = {}, buyer = { nombre:"", nota:"", email:"" };
  try { const raw = JSON.parse(localStorage.getItem(CART_KEY)||"{}"); cart = raw.items||{}; buyer = Object.assign(buyer, raw.buyer||{}); } catch(e){}
  function saveCart(){ try{ localStorage.setItem(CART_KEY, JSON.stringify({items:cart, buyer})); }catch(e){} }
  const cartLines = () => Object.entries(cart).map(([id,q])=>({ p:S.products.find(x=>x.id===id), id, q })).filter(l=>l.p);
  const cartCount = () => cartLines().reduce((s,l)=>s+(agotado(l.p)?0:l.q),0);
  // Total en soles con descuento (redondeado por línea, igual que el servidor)
  function totalContado(lines){ if(!descuento() || !rate()) return null; const ok = lines.filter(l=>!agotado(l.p) && l.p.precio!=null); if(!ok.length) return null; return ok.reduce((t,l)=>t+Math.round(l.p.precio*l.q*rate()*(1-descuento()/100)),0); }
  function cartTotals(){ let total=0, consultar=0; for(const l of cartLines()){ if(agotado(l.p)) continue; if(l.p.precio==null) consultar++; else total+=l.p.precio*l.q; } return {total, consultar}; }
  function addButton(p, big){
    const inCart = !!cart[p.id], sold = agotado(p);
    return el("button",{class:"addbtn"+(inCart?" in":""),type:"button",disabled:sold?"":false,
      onclick:e=>{ e.stopPropagation(); if(cart[p.id]) delete cart[p.id]; else { cart[p.id]=1; toast(tx("Agregado a tu pedido","Added to your order")); } saveCart(); render(); if(openId) drawSheet(); }},
      sold ? (p.estado==="vendido" ? tx("Vendido","Sold") : tx("Agotado","Sold out")) : inCart ? (big?tx("✓ En tu pedido (quitar)","✓ In your order (remove)"):tx("✓ En tu pedido","✓ In your order")) : tx("+ Agregar al pedido","+ Add to order"));
  }
  function renderCartBar(){
    const n = cartCount(), {total, consultar} = cartTotals();
    $("cartbar").hidden = !n || S.selecting;
    pintarCliBtn();
    $("cartN").textContent = n;
    $("cartT").textContent = total ? dual(total) + (consultar?" +":"") : (consultar?tx("Consultar","Ask price"):"");
    $("cartLbl").textContent = tx("Mi pedido","My order");
  }
  $("cartbar").onclick = ()=>openCart();
  // El pedido le llega a la vendedora en el idioma de su tienda, aunque el cliente vea la tienda en el otro
  function buildMessage(){ const antes = S.idioma; S.idioma = idiomaBase(); try{ return armarMensaje(); } finally { S.idioma = antes; } }
  function armarMensaje(){
    const lines = cartLines().filter(l=>!agotado(l.p));
    const {total, consultar} = cartTotals();
    let m = tx(`Hola${S.config.nombre?" "+S.config.nombre:""}, quiero hacer este pedido:\n\n`, `Hi${S.config.nombre?" "+S.config.nombre:""}, I'd like to order:\n\n`);
    lines.forEach((l,i)=>{
      const pr = l.p.precio==null ? tx("precio a consultar","price on request") : (l.q>1 ? `${l.q} × ${money(l.p.precio)} = ${dual(l.p.precio*l.q)}` : dual(l.p.precio));
      m += `${i+1}. ${l.p.codigo ? l.p.codigo+" · " : ""}${l.p.nombre}${oferta(l.p) ? tx(" (oferta)"," (sale)") : ""}${l.p.condicion ? " ("+condTxt(l.p.condicion).toLowerCase()+")" : ""}${l.q>1&&l.p.precio==null?tx(` (${l.q} unidades)`,` (${l.q} units)`):""} — ${pr}\n`;
    });
    m += `\nTotal: ${dual(total)||money(0)}${consultar?tx(` + ${consultar} producto(s) a consultar`,` + ${consultar} item(s) to confirm price`):""}`;
    { const tc = totalContado(lines); if(tc!=null) m += `\nTotal pagando con Yape o efectivo: S/ ${tc.toLocaleString("es-PE")}`; }
    if(buyer.nombre.trim()) m += tx(`\nMi nombre: ${buyer.nombre.trim()}`,`\nMy name: ${buyer.nombre.trim()}`);
    if(buyer.nota.trim()) m += tx(`\nNota: ${buyer.nota.trim()}`,`\nNote: ${buyer.nota.trim()}`);
    return m;
  }
  let cartOpen=false;
  function openCart(){ openId=null; cartOpen=true; drawCart(); $("overlay").hidden=false; }
  function drawCart(){
    const ov=$("overlay"); ov.textContent="";
    const lines = cartLines();
    const box = el("div",{class:"cart",role:"dialog","aria-modal":"true","aria-label":tx("Mi pedido","My order")});
    box.append(el("div",{class:"cart-head"}, el("h2",null,tx("Mi pedido","My order")), el("button",{class:"btn",type:"button",onclick:closeCart},tx("Seguir viendo","Keep browsing"))));
    if(!lines.length){
      box.append(el("p",{class:"note",style:"margin:0"},tx("Tu pedido está vacío. Toca \"+ Agregar al pedido\" en los productos que quieras.","Your order is empty. Tap \"+ Add to order\" on the products you want.")));
      ov.append(box); return;
    }
    const ul = el("ul",{class:"items"});
    for(const l of lines){
      const cover = l.p.fotos && l.p.fotos[0], sold = agotado(l.p);
      const maxQ = typeof l.p.stock==="number" ? l.p.stock : 99;
      const setQ = q=>{ if(q<1) delete cart[l.id]; else { if(q>maxQ) toast(tx(`Solo hay ${maxQ} disponible${maxQ===1?"":"s"}`,`Only ${maxQ} available`)); cart[l.id]=Math.min(q,maxQ,99); } saveCart(); drawCart(); render(); };
      ul.append(el("li",{class:"item"},
        cover ? el("img",{src:src(cover.thumb||cover.full),alt:""}) : el("span",{class:"noimg"}),
        el("div",{style:"min-width:0;display:grid;gap:2px"},
          el("span",{class:"nm"},nom(l.p)||tx("Producto","Product")),
          el("span",{class:"pr"}, l.p.precio==null?tx("Precio a consultar","Price on request"):(l.q>1?`${money(l.p.precio)} × ${l.q} = ${dual(l.p.precio*l.q)}`:dual(l.p.precio))),
          sold ? el("span",{class:"warn"},tx("Ya no está disponible; no se incluirá en el pedido","No longer available; it won't be included")) : (typeof l.p.stock==="number" && l.q>l.p.stock) ? el("span",{class:"warn"},tx(`Solo quedan ${l.p.stock}`,`Only ${l.p.stock} left`)) : null),
        el("div",{style:"display:grid;gap:4px;justify-items:end"},
          sold ? null : el("div",{class:"qty"},
            el("button",{type:"button","aria-label":tx("Quitar uno","One less"),onclick:()=>setQ(l.q-1)},"−"),
            el("span",null,String(l.q)),
            el("button",{type:"button","aria-label":tx("Agregar uno","One more"),disabled:l.q>=maxQ?"":false,onclick:()=>setQ(l.q+1)},"+")),
          el("button",{class:"rm",type:"button",onclick:()=>setQ(0)},tx("Quitar","Remove")))
      ));
    }
    box.append(ul);
    const {total, consultar} = cartTotals();
    box.append(el("div",{class:"totals"}, el("span",null,"Total"+(consultar?tx(` (+${consultar} a consultar)`,` (+${consultar} to confirm)`):"")), el("span",{class:"t",style:"text-align:right"},money(total)||money(0), soles(total)?el("span",{class:"bigsol"},soles(total)):null)));
    const totCont = totalContado(lines);
    if(totCont!=null){
      const totTarj = lines.filter(l=>!agotado(l.p) && l.p.precio!=null).reduce((t,l)=>t+Math.round(l.p.precio*l.q*rate()),0);
      box.append(el("div",{class:"totals2"},
        el("div",{class:"fila"}, el("span",null,tx("Con tarjeta","By card")), el("strong",null,`S/ ${totTarj.toLocaleString("es-PE")}`)),
        el("div",{class:"fila contado"}, el("span",null,tx(`Con Yape o efectivo (${descuento()} % menos)`,`Yape or cash (${descuento()}% off)`)), el("strong",null,`S/ ${totCont.toLocaleString("es-PE")}`)),
        totTarj-totCont>0 ? el("span",{class:"note",style:"margin:0"}, tx(`Ahorras S/ ${(totTarj-totCont).toLocaleString("es-PE")} pagando con Yape o efectivo.`,`You save S/ ${(totTarj-totCont).toLocaleString("es-PE")} paying with Yape or cash.`)) : null));
    }
    const nm = el("input",{id:"buyerName",maxlength:"60",placeholder:tx("Para saber quién escribe","So the store knows who you are"),value:buyer.nombre});
    const nt = el("textarea",{id:"buyerNote",rows:"2",placeholder:tx("Talla, color, entrega o recogida…","Size, color, delivery or pickup…")}); nt.value = buyer.nota;
    const pv = el("div",{class:"preview","aria-label":tx("Mensaje que se enviará","Message that will be sent")}, buildMessage());
    const upd = ()=>{ buyer.nombre=nm.value; buyer.nota=nt.value; saveCart(); pv.textContent=buildMessage(); link.href=waLink(); };
    nm.addEventListener("input",upd); nt.addEventListener("input",upd);
    box.append(el("label",{class:"f"},tx("Tu nombre (opcional)","Your name (optional)"), nm), el("label",{class:"f"},tx("Nota (opcional)","Note (optional)"), nt),
      el("div",{style:"display:grid;gap:4px"}, el("span",{class:"note",style:"margin:0"},tx("Este es el mensaje que llegará:","This is the message the store will get:")), pv));
    const wa = waDigits();
    const waLink = ()=>`https://wa.me/${wa}?text=${encodeURIComponent(buildMessage())}`;
    const link = el("a",{class:"btn tag",href:wa?waLink():"#",target:"_blank",rel:"noopener"},tx("Enviar pedido por WhatsApp","Send order on WhatsApp"));
    const copyBtn = el("button",{class:"btn",type:"button",onclick:async()=>{ try{ await navigator.clipboard.writeText(buildMessage()); toast(tx("Mensaje copiado","Message copied")); }catch(e){ const r=document.createRange(); r.selectNodeContents(pv); const s=getSelection(); s.removeAllRanges(); s.addRange(r); toast(tx("Selecciona y copia el mensaje","Select and copy the message")); } }},tx("Copiar mensaje","Copy message"));
    const send = el("div",{class:"send"});
    if(S.config && S.config.cobrosActivos && !S.canEdit){
      const pagables = lines.filter(l=>!agotado(l.p));
      const sinPrecio = pagables.some(l=>l.p.precio==null);
      const payBtn = el("button",{class:"btn primary",type:"button",disabled:sinPrecio?"":false,onclick:async()=>{
        payBtn.disabled=true; payBtn.textContent=tx("Abriendo pago seguro…","Opening secure checkout…");
        try{ const r = await pagarPedido(pagables.map(l=>({id:l.id,q:l.q})), buyer.nombre.trim(), buyer.nota.trim(), cuenta.perfil ? cuenta.perfil.email : ""); location.href = r.url; }
        catch(e){ toast((e&&e.message)||tx("No se pudo iniciar el pago","Couldn't start the payment")); payBtn.disabled=false; payBtn.textContent=tx("Pagar con tarjeta","Pay with card"); }
      }},tx("Pagar con tarjeta","Pay with card"));
      send.append(payBtn, el("span",{class:"note",style:"margin:0;text-align:center"}, sinPrecio ? tx("Algunos productos no tienen precio: consúltalos por WhatsApp o quítalos para pagar con tarjeta.","Some items have no price: ask on WhatsApp or remove them to pay by card.") : descuento() ? tx("Pago seguro con Stripe, al precio normal con tarjeta.","Secure payment with Stripe, at the regular card price.") : tx("Pago seguro con Stripe. El total final se muestra en la página de pago.","Secure payment with Stripe. You'll see the final total on the checkout page.")));
    }
    if(S.config && !esUS() && (S.config.yapeNumero || S.config.yapeQr) && !S.canEdit){
      const pagables = lines.filter(l=>!agotado(l.p));
      const sinPrecio = pagables.some(l=>l.p.precio==null);
      const sinCambio = !rate();
      const yBtn = el("button",{class:"btn yape",type:"button",disabled:(sinPrecio||sinCambio)?"":false,onclick:()=>mostrarYape(box, pagables)},tx("Pagar con Yape","Pay with Yape"));
      send.append(yBtn);
      if(sinPrecio) send.append(el("span",{class:"note",style:"margin:0;text-align:center"},tx("Algunos productos no tienen precio: consúltalos por WhatsApp o quítalos para pagar con Yape.","Some items have no price: ask on WhatsApp or remove them to pay with Yape.")));
    }
    if(wa){
      send.append(link, copyBtn, el("span",{class:"note",style:"margin:0;text-align:center"},tx("Se abre WhatsApp con tu pedido escrito; solo tocas enviar. Si no se abre, copia el mensaje y escríbelo al ","WhatsApp opens with your order already written; just tap send. If it doesn't open, copy the message and send it to "), el("span",{class:"copy"},S.config.whatsapp)));
    } else {
      send.append(copyBtn, el("span",{class:"note",style:"margin:0;text-align:center"},tx("La tienda todavía no ha puesto su número de WhatsApp. Copia el mensaje para enviarlo cuando lo tengas.","The store hasn't added its WhatsApp number yet. Copy the message to send it later.")));
    }
    box.append(send,
      el("button",{class:"rm",type:"button",style:"justify-self:center",onclick:()=>{ cart={}; saveCart(); render(); closeCart(); toast(tx("Pedido vaciado","Order cleared")); }},tx("Vaciar pedido","Clear order")));
    ov.append(box);
  }
  function closeCart(){ cartOpen=false; cuentaOpen=false; $("overlay").hidden=true; $("overlay").textContent=""; }

  // ----- "Mis pedidos" del cliente: entra con un código que le llega al correo (sin contraseña) -----
  const CUENTA_KEY = () => "cuenta:" + ((S.config && S.config.id) || "tienda");
  let cuentaOpen = false;
  const cuenta = { token:"", perfil:null, pedidos:null, paso:"correo", email:"", leida:"" };
  // La sesión se guarda por tienda: se lee cuando ya se sabe qué tienda es
  function leerCuenta(){
    const id = S.config && S.config.id; if(!id || cuenta.leida === id) return; cuenta.leida = id;
    try{ const c = JSON.parse(localStorage.getItem(CUENTA_KEY()) || "null"); if(c && c.token){ cuenta.token = c.token; cuenta.perfil = c.perfil || null; usarPerfil(); } }catch(e){}
  }
  function guardarCuenta(){ try{ if(cuenta.token) localStorage.setItem(CUENTA_KEY(), JSON.stringify({ token:cuenta.token, perfil:cuenta.perfil })); else localStorage.removeItem(CUENTA_KEY()); }catch(e){} pintarCuentaBtn(); }
  function pintarCuentaBtn(){
    const b = $("cuentaBtn"); if(!b) return;
    if(!S.canEdit) leerCuenta();
    b.hidden = S.canEdit || (estadoCatalogo()||{}).estado !== "aprobada";
    const n = cuenta.perfil && cuenta.perfil.nombre ? cuenta.perfil.nombre.split(" ")[0] : "";
    b.querySelector("span").textContent = n ? n : tx("Mis pedidos","My orders");
    b.setAttribute("aria-label", tx("Mis pedidos","My orders"));
  }
  // Con la cuenta abierta, el cliente no vuelve a escribir su nombre ni su correo al pagar
  function usarPerfil(){ const p = cuenta.perfil; if(!p) return; if(p.nombre && !buyer.nombre) buyer.nombre = p.nombre; if(p.email) buyer.email = p.email; saveCart(); }
  const ESTADO_PEDIDO = () => ({ por_confirmar:tx("Por confirmar","Waiting confirmation"), pagado:tx("Pagado","Paid"), entregado:tx("Entregado","Delivered"), cancelado:tx("Cancelado","Cancelled") });
  function openCuenta(){ openId=null; cartOpen=false; cuentaOpen=true; $("overlay").hidden=false; drawCuenta(); if(cuenta.token) cargarMisPedidos(); }
  async function cargarMisPedidos(){
    try{ const r = await clienteCuenta("misPedidos", { token: cuenta.token }); cuenta.perfil = r.perfil; cuenta.pedidos = r.pedidos || []; guardarCuenta(); usarPerfil(); }
    catch(e){ if(/SESION/.test(String(e && e.message))){ cuenta.token = ""; cuenta.perfil = null; cuenta.paso = "correo"; guardarCuenta(); } else { cuenta.pedidos = cuenta.pedidos || []; toast(tx("No se pudieron cargar tus pedidos","Couldn't load your orders")); } }
    if(cuentaOpen) drawCuenta();
  }
  function drawCuenta(){
    const ov = $("overlay"); ov.textContent = "";
    const box = el("div",{class:"cart cuenta",role:"dialog","aria-modal":"true","aria-label":tx("Mis pedidos","My orders")});
    box.append(el("div",{class:"cart-head"}, el("h2",null,tx("Mis pedidos","My orders")), el("button",{class:"btn",type:"button",onclick:closeCart},tx("Cerrar","Close"))));
    const err = el("p",{class:"err",role:"alert",hidden:""});
    const mostrarError = e=>{ err.textContent = (e && e.message) || tx("Algo falló. Intenta de nuevo.","Something went wrong. Try again."); err.hidden = false; };
    if(!cuenta.token){
      if(cuenta.paso === "codigo"){
        const cod = el("input",{id:"cuentaCodigo",inputmode:"numeric",autocomplete:"one-time-code",maxlength:"6",placeholder:"123456",class:"codigo-6"});
        const entrarBtn = el("button",{class:"btn primary",type:"submit"},tx("Entrar","Sign in"));
        const f = el("form",{class:"cuenta-form"},
          el("p",{style:"margin:0"}, tx("Te enviamos un código de 6 números a ","We sent a 6-digit code to "), el("strong",null,cuenta.email), tx(". Revisa también la carpeta de spam.",". Check your spam folder too.")),
          el("label",{class:"f"},tx("Código","Code"), cod), err, entrarBtn,
          el("div",{class:"cuenta-links"},
            el("button",{class:"linkish",type:"button",onclick:()=>{ cuenta.paso="correo"; drawCuenta(); }},tx("Cambiar correo","Change email")),
            el("button",{class:"linkish",type:"button",onclick:async()=>{ try{ await clienteCuenta("pedirCodigo",{ email:cuenta.email, idioma: EN()?"en":"es" }); toast(tx("Te enviamos otro código","We sent you another code")); }catch(e){ mostrarError(e); } }},tx("Enviar otro código","Send another code"))));
        f.onsubmit = async e=>{ e.preventDefault(); err.hidden = true;
          if(cod.value.replace(/\D/g,"").length !== 6){ mostrarError({ message: tx("Escribe los 6 números del correo","Type the 6 digits from the email") }); return; }
          entrarBtn.disabled = true; entrarBtn.textContent = tx("Entrando…","Signing in…");
          try{ const r = await clienteCuenta("entrar",{ email:cuenta.email, codigo:cod.value, idioma: EN()?"en":"es" }); cuenta.token = r.token; cuenta.perfil = r.perfil; cuenta.pedidos = null; guardarCuenta(); usarPerfil(); drawCuenta(); cargarMisPedidos(); toast(tx("¡Listo! Ya entraste","You're in!")); }
          catch(e2){ mostrarError(e2); entrarBtn.disabled = false; entrarBtn.textContent = tx("Entrar","Sign in"); } };
        cod.addEventListener("input", ()=>{ cod.value = cod.value.replace(/\D/g,"").slice(0,6); if(cod.value.length===6) f.requestSubmit(); });
        box.append(f); ov.append(box); setTimeout(()=>cod.focus(), 50); return;
      }
      const mail = el("input",{id:"cuentaEmail",type:"email",autocomplete:"email",maxlength:"254",placeholder:tx("tucorreo@ejemplo.com","you@example.com"),value:cuenta.email||buyer.email||""});
      const pedir = el("button",{class:"btn primary",type:"submit"},tx("Enviarme el código","Send me the code"));
      const f = el("form",{class:"cuenta-form"},
        el("p",{style:"margin:0"}, tx("Mira tus pedidos de esta tienda y compra más rápido. Sin contraseña: te mandamos un código a tu correo.","See your orders from this store and check out faster. No password: we email you a code.")),
        el("label",{class:"f"},tx("Tu correo","Your email"), mail), err, pedir);
      f.onsubmit = async e=>{ e.preventDefault(); err.hidden = true;
        const v = mail.value.trim().toLowerCase();
        if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)){ mostrarError({ message: tx("Revisa tu correo: parece que falta algo","Check your email: something seems missing") }); mail.focus(); return; }
        pedir.disabled = true; pedir.textContent = tx("Enviando…","Sending…");
        try{ await clienteCuenta("pedirCodigo",{ email:v, idioma: EN()?"en":"es" }); cuenta.email = v; cuenta.paso = "codigo"; drawCuenta(); }
        catch(e2){ mostrarError(e2); pedir.disabled = false; pedir.textContent = tx("Enviarme el código","Send me the code"); } };
      box.append(f); ov.append(box); setTimeout(()=>mail.focus(), 50); return;
    }
    // Con sesión: sus pedidos y sus datos
    const p = cuenta.perfil || {};
    box.append(el("p",{style:"margin:0"}, tx("Hola","Hi") + (p.nombre ? " " + p.nombre : "") + " · ", el("small",{class:"note"}, p.email||"")));
    const lista = el("div",{class:"mis-pedidos"});
    if(cuenta.pedidos === null) lista.append(el("p",{class:"note",style:"margin:0"},tx("Cargando tus pedidos…","Loading your orders…")));
    else if(!cuenta.pedidos.length) lista.append(el("p",{class:"note",style:"margin:0"},tx("Todavía no tienes pedidos con este correo. Cuando pagues aquí con tarjeta o Yape usando este correo, tus pedidos aparecerán solos. Los que pides solo por WhatsApp no se guardan aquí.","No orders with this email yet. When you pay here by card or Yape with this email, your orders show up here. Orders sent only on WhatsApp aren't saved here.")));
    else for(const o of cuenta.pedidos){
      let items = []; try{ items = JSON.parse(o.items||"[]"); }catch(e){}
      lista.append(el("div",{class:"mi-pedido"},
        el("div",{class:"mp-top"}, el("strong",null, tx("Pedido N.° ","Order #") + o.id), el("span",{class:"mp-estado est-"+o.estado}, ESTADO_PEDIDO()[o.estado]||o.estado)),
        el("small",{class:"note"}, new Date(o.fecha).toLocaleDateString(EN()?"en-US":"es-PE",{dateStyle:"medium"}) + " · " + (o.metodo==="yape" ? "Yape" : tx("Tarjeta","Card"))),
        el("span",null, items.map(i=>`${i.nombre}${i.q>1?" × "+i.q:""}`).join(", ")),
        el("strong",null, (o.moneda==="pen"?"S/ ":"$") + (o.total/100).toLocaleString("es-PE",{maximumFractionDigits:2}))));
    }
    box.append(lista);
    const nm = el("input",{id:"cuentaNombre",maxlength:"60",autocomplete:"name",value:p.nombre||""});
    const tel = el("input",{id:"cuentaTel",maxlength:"30",inputmode:"tel",autocomplete:"tel",placeholder:tx("Para que la tienda te escriba","So the store can message you"),value:p.telefono||""});
    const sigue = el("input",{type:"checkbox",id:"cuentaSigue"}); sigue.checked = !!p.sigue;
    const guardar = el("button",{class:"btn",type:"button",onclick:async()=>{
      guardar.disabled = true;
      try{ const r = await clienteCuenta("guardarPerfil",{ token:cuenta.token, nombre:nm.value.trim(), telefono:tel.value.trim(), sigue:sigue.checked }); cuenta.perfil = r.perfil; guardarCuenta(); buyer.nombre = r.perfil.nombre || buyer.nombre; saveCart(); toast(tx("Datos guardados","Saved")); }
      catch(e){ mostrarError(e); } finally{ guardar.disabled = false; } }},tx("Guardar mis datos","Save"));
    box.append(el("details",{class:"cuenta-datos"}, el("summary",null,tx("Mis datos","My details")),
      el("label",{class:"f"},tx("Tu nombre","Your name"), nm), el("label",{class:"f"},tx("Tu WhatsApp (opcional)","Your WhatsApp (optional)"), tel),
      el("label",{class:"check"}, sigue, tx(" Quiero enterarme de ofertas y novedades de esta tienda"," Tell me about this store's deals and new arrivals")), err, guardar));
    box.append(el("button",{class:"rm",type:"button",style:"justify-self:center",onclick:async()=>{ const t = cuenta.token; cuenta.token=""; cuenta.perfil=null; cuenta.pedidos=null; cuenta.paso="correo"; guardarCuenta(); drawCuenta(); try{ await clienteCuenta("salir",{ token:t }); }catch(e){} }},tx("Salir","Sign out")));
    ov.append(box);
  }

  // ----- Pago con Yape (QR) -----
  // El total en soles se muestra aquí, pero el servidor lo vuelve a calcular con los precios guardados.
  const solesDe = lines => lines.reduce((t,l)=> t + Math.round(l.p.precio * l.q * rate() * (1 - descuento()/100)), 0);
  function mostrarYape(box, pagables){
    const total = solesDe(pagables);
    box.textContent = "";
    const volver = el("button",{class:"btn",type:"button",onclick:drawCart},tx("Volver","Back"));
    const nom = el("input",{id:"yapeNombreCliente",maxlength:"60",autocomplete:"name",placeholder:tx("Para que la tienda identifique tu pago","So the store can match your payment"),value:buyer.nombre});
    const op = el("input",{id:"yapeOperacion",maxlength:"40",inputmode:"numeric",placeholder:tx("Aparece en tu constancia de Yape","It's on your Yape receipt")});
    const mail = el("input",{id:"yapeEmail",type:"email",maxlength:"254",autocomplete:"email",placeholder:tx("Te enviamos la confirmación","We'll send you the confirmation"),value:buyer.email||""});
    const err = el("p",{class:"err",role:"alert",hidden:""});
    const enviar = el("button",{class:"btn yape",type:"button"},tx("Ya pagué, enviar pedido","I paid, send my order"));
    const panel = el("div",{class:"yape-pay"},
      S.config.yapeQr ? el("img",{src:src(S.config.yapeQr),alt:tx("Código QR de Yape de la tienda","Store's Yape QR code")}) : null,
      el("span",null,tx("Yapea exactamente","Send exactly")),
      el("span",{class:"monto"},"S/ " + total.toLocaleString("es-PE")),
      S.config.yapeNumero ? el("span",null,tx("al número ","to the number "), el("span",{class:"num"}, S.config.yapeNumero)) : null,
      S.config.yapeNombre ? el("span",{class:"note",style:"margin:0"},tx("a nombre de ","in the name of ") + S.config.yapeNombre) : null);
    box.append(
      el("div",{class:"cart-head"}, el("h2",null,tx("Pagar con Yape","Pay with Yape")), volver),
      el("p",{class:"note",style:"margin:0"},tx("1. Abre Yape y escanea el QR o yapea al número. 2. Vuelve aquí y envía tu pedido. La tienda confirmará tu pago.","1. Open Yape and scan the QR or send to the number. 2. Come back here and send your order. The store will confirm your payment.")),
      panel,
      el("label",{class:"f"},tx("Tu nombre","Your name"), nom),
      el("label",{class:"f"},tx("Código de operación (opcional)","Transaction code (optional)"), op),
      el("label",{class:"f"},tx("Tu correo (opcional)","Your email (optional)"), mail),
      err, el("div",{class:"send"}, enviar));
    enviar.onclick = async ()=>{
      err.hidden = true;
      const nombre = nom.value.trim();
      if(!nombre){ err.textContent=tx("Escribe tu nombre para que la tienda reconozca tu pago","Type your name so the store can match your payment"); err.hidden=false; nom.focus(); return; }
      const email = mail.value.trim();
      if(email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ err.textContent=tx("Revisa tu correo: parece que falta algo","Check your email: something seems missing"); err.hidden=false; mail.focus(); return; }
      buyer.nombre = nombre; buyer.email = email; saveCart();
      enviar.disabled = true; enviar.textContent = tx("Enviando…","Sending…");
      try{
        const r = await pedidoYape(pagables.map(l=>({id:l.id,q:l.q})), nombre, buyer.nota.trim(), op.value.trim(), email);
        const num = String(r.pedidoId||"").slice(0,8).toUpperCase();
        cart = {}; saveCart(); render();
        const wa = waDigits();
        const msg = `Hola, acabo de yapear S/ ${(r.total/100).toLocaleString("es-PE")} por mi pedido N.° ${num}${op.value.trim()?` (operación ${op.value.trim()})`:""}. Mi nombre: ${nombre}.`;
        box.textContent = "";
        box.append(
          el("div",{class:"cart-head"}, el("h2",null,tx("¡Pedido enviado!","Order sent!")), el("button",{class:"btn",type:"button",onclick:closeCart},tx("Cerrar","Close"))),
          el("p",{style:"margin:0"}, tx(`Tu pedido N.° ${num} quedó registrado. La tienda revisará tu Yape y te confirmará.` + (email ? ` Te enviamos la confirmación a ${email}.` : ""), `Your order #${num} is registered. The store will check your Yape payment and confirm.` + (email ? ` We sent the confirmation to ${email}.` : ""))),
          wa ? el("a",{class:"btn tag",href:`https://wa.me/${wa}?text=${encodeURIComponent(msg)}`,target:"_blank",rel:"noopener",style:"text-decoration:none;justify-content:center"},tx("Avisar por WhatsApp","Tell the store on WhatsApp")) : null);
      }catch(e){
        err.textContent = (e && e.message) || tx("No se pudo enviar el pedido. Intenta de nuevo.","Couldn't send the order. Please try again."); err.hidden = false;
        enviar.disabled = false; enviar.textContent = tx("Ya pagué, enviar pedido","I paid, send my order");
      }
    };
    nom.focus();
  }

  // ---------- Tienda ----------
  function waDigits(){ return String(S.config.whatsapp||"").replace(/\D/g,""); }
  let yapeQrNuevo;  // QR de Yape en edición: undefined = sin cambios; "" = quitar; ruta = nuevo QR
  function renderConfig(){
    const name = S.config.nombre || "Showroomcito";
    $("shopName").textContent = name; document.title = name;
    // El WhatsApp de la tienda va en un botón flotante (solo para clientes), no en la barra.
    const c=$("contact"); c.textContent=""; c.hidden=true; const wa=waDigits();
    const fl=$("waFloat"); fl.hidden = !wa || S.canEdit;
    if(wa) fl.href = `https://wa.me/${wa}?text=${encodeURIComponent(tx(`Hola${S.config.nombre?" "+S.config.nombre:""}, vi tu tienda online y tengo una consulta.`, `Hi${S.config.nombre?" "+S.config.nombre:""}, I saw your online store and have a question.`))}`;
    fl.setAttribute("aria-label", tx("Escríbenos por WhatsApp","Message us on WhatsApp")); fl.querySelector("span").textContent = tx("Escríbenos","Chat with us");
    // Tienda de EE. UU.: el sello "Traído de USA" no aplica; el cliente ve la tienda en inglés.
    document.querySelector(".brand .stamp").hidden = esUS(); document.querySelector(".brand .stamp").textContent = tx("Traído de USA","Imported from USA");
    { const o = $("orden").options; o[0].text = tx("Más nuevos","Newest"); o[1].text = tx("Precio: menor a mayor","Price: low to high"); o[2].text = tx("Precio: mayor a menor","Price: high to low"); $("orden").setAttribute("aria-label", tx("Ordenar productos","Sort products")); }
    document.documentElement.lang = EN() ? "en" : "es";
    // Botón ES | EN: el cliente cambia el idioma de la tienda (la vendedora siempre ve su panel en español)
    pintarCuentaBtn();
    const lb = $("langBtn"); lb.hidden = S.canEdit; lb.textContent = EN() ? "Español" : "English";
    lb.setAttribute("aria-label", EN() ? "Ver la tienda en español" : "See the store in English"); lb.lang = EN() ? "es" : "en";
    $("q").placeholder = tx("Buscar producto…","Search products…"); $("q").setAttribute("aria-label", tx("Buscar producto","Search products"));
    if(document.activeElement!==$("setPais")) $("setPais").value = esUS() ? "US" : "PE";
    document.querySelectorAll(".solo-pe").forEach(x=>{ x.hidden = esUS(); });
    if(document.activeElement!==$("setMoneda")) $("setMoneda").value = enSoles() ? "PEN" : "USD";
    $("defPrice").placeholder = $("bulkPrice").placeholder = "Precio " + simbolo();
    $("monedaNota").textContent = enSoles()
      ? "Tus precios están en soles. El tipo de cambio solo se usa para convertir el costo de la etiqueta (en dólares) y calcular tu margen."
      : "Pones los precios en dólares y el catálogo muestra también el precio en soles con este tipo de cambio, redondeado al sol.";
    if(document.activeElement!==$("setName")) $("setName").value = S.config.nombre||"";
    if(document.activeElement!==$("setWa")) $("setWa").value = S.config.whatsapp||"";
    if(document.activeElement!==$("setRate")) $("setRate").value = S.config.tipoCambio!=null ? String(S.config.tipoCambio) : "";
    if(document.activeElement!==$("setDesc")) $("setDesc").value = S.config.descuentoContado ? String(S.config.descuentoContado) : "";
    if(document.activeElement!==$("setDias")) $("setDias").value = S.config.diasSeparado ? String(S.config.diasSeparado) : "";
    if(document.activeElement!==$("setGrupo")) $("setGrupo").value = S.config.grupoWhatsapp || "";
    $("setChatCli").checked = S.config.chatClientes !== false;
    if(document.activeElement!==$("setDescTienda")){ $("setDescTienda").value = S.config.descripcionTienda || ""; $("setDescCuenta").textContent = `${$("setDescTienda").value.length} / 300`; }
    if(portadaNueva===undefined) pintarPortadaConfig(S.config.portada||"");
    pintarPortada();
    if(document.activeElement!==$("setRubro")){ const sr=$("setRubro"); if(!sr.options.length) RUBROS.forEach(r=>sr.append(el("option",{value:r.id},r.nombre))); sr.value = rubroActual(); }
    pintarCliBtn();
    // Botón "Únete a mi grupo" para los clientes
    const gl = $("grupoLink"), grupo = grupoValido(S.config.grupoWhatsapp);
    gl.hidden = !grupo || S.canEdit;
    if(grupo){ gl.href = grupo; gl.textContent = tx("💬 Únete a mi grupo de WhatsApp: ofertas y novedades primero", "💬 Join my WhatsApp group for deals and new arrivals"); }
    if(document.activeElement!==$("setYapeNum")) $("setYapeNum").value = S.config.yapeNumero||"";
    if(document.activeElement!==$("setYapeName")) $("setYapeName").value = S.config.yapeNombre||"";
    if(yapeQrNuevo===undefined) pintarQrConfig(S.config.yapeQr||"");
    render(); if(openId) drawSheet();
  }
  $("cuentaBtn").onclick = openCuenta;
  $("langBtn").onclick = ()=>{
    // Página de inicio y cuenta (sin tienda abierta)
    if(!slugPublico && !S.canEdit){
      S.idioma = enInicio() ? "es" : "en";
      try{ localStorage.setItem(IDIOMA_KEY, S.idioma); }catch(e){}
      aplicarIdiomaInicio(); pintarPlanesLanding(monedaLanding);
      if(!$("login").hidden) pasoAuth(paso, paso==="signup" ? ti("Crea tu cuenta con tu correo. Te enviaremos un código para confirmar que es tuyo.","Create your account with your email. We'll send you a code to confirm it's yours.") : "");
      return;
    }
    S.idioma = EN() ? "es" : "en";
    try{ localStorage.setItem(IDIOMA_KEY, S.idioma); }catch(e){}
    renderConfig(); if(cartOpen) drawCart(); if(cuentaOpen) drawCuenta(); if(!$("cli").hidden) pintarCli();
    if(!S.canEdit) mensajeEstadoPublico(true);
    toast(EN() ? "Store in English" : "Tienda en español");
  };
  $("settingsBtn").onclick = ()=>{ if(document.querySelector("main").classList.contains("con-tabs")) irTab("datos"); else $("settings").hidden = !$("settings").hidden; };
  // Cambiar contraseña estando dentro (Datos de la tienda)
  $("verSetPass").onclick = ()=>{ const ver = $("setPassNueva").type==="password"; ["setPassActual","setPassNueva"].forEach(id=>{ $(id).type = ver ? "text" : "password"; }); $("verSetPass").setAttribute("aria-pressed", String(ver)); $("verSetPass").textContent = ver ? "🙈" : "👁"; };
  $("setPassNueva").addEventListener("input", ()=>{
    const v = $("setPassNueva").value, falta = [["8 caracteres", v.length>=8],["mayúscula", /[A-Z]/.test(v)],["minúscula", /[a-z]/.test(v)],["número", /[0-9]/.test(v)],["símbolo", /[^A-Za-z0-9\s]/.test(v)]].filter(x=>!x[1]).map(x=>x[0]);
    $("setPassNota").textContent = !v ? "8 caracteres o más, con mayúscula, minúscula, número y símbolo." : falta.length ? "Falta: " + falta.join(", ") : "✓ La contraseña nueva cumple todo";
  });
  $("cambiarPass").onclick = async ()=>{
    const actual = $("setPassActual").value, nueva = $("setPassNueva").value, b = $("cambiarPass");
    if(!actual || !nueva){ toast("Escribe tu contraseña actual y la nueva"); return; }
    if(!passCumple(nueva)){ toast("La contraseña nueva no cumple todo lo que pide"); return; }
    b.disabled = true;
    try{ await updatePassword({ oldPassword: actual, newPassword: nueva }); $("setPassActual").value = $("setPassNueva").value = ""; $("setPassNota").textContent = "8 caracteres o más, con mayúscula, minúscula, número y símbolo."; toast("Contraseña cambiada"); }
    catch(e){ console.warn("Detalle técnico:", e); toast(e && e.name==="NotAuthorizedException" ? "La contraseña actual no es correcta" : e && /LimitExceeded|TooManyRequests/.test(e.name) ? "Muchos intentos seguidos. Espera unos minutos." : "No se pudo cambiar la contraseña. Si entras con Google, cámbiala desde tu cuenta de Google."); }
    finally{ b.disabled = false; }
  };
  // ---------- Traducción automática (la tienda se ve en español e inglés) ----------
  // La vendedora escribe en su idioma; aquí se guarda la traducción para los clientes que eligen el otro idioma.
  const otroIdioma = pais => (pais ? pais==="US" : esUS()) ? "es" : "en";
  const hashTxt = s => { let h = 5381; for(let i=0;i<s.length;i++) h = ((h<<5)+h+s.charCodeAt(i))|0; return (h>>>0).toString(36); };
  const fuenteTr = p => hashTxt([p.nombre||"", p.descripcion||"", otroIdioma()].join("|"));
  async function traducirDescTienda(desc, pais){
    if(!desc) return "";
    if(desc===(S.config.descripcionTienda||"") && S.config.trDescripcionTienda && pais===(S.config.pais||"PE")) return S.config.trDescripcionTienda;
    try{ const r = await traducirTextos([desc], otroIdioma(pais)); return String((r && r[0]) || "").slice(0,400); }catch(e){ console.warn("No se pudo traducir la descripción:", e); return ""; }
  }
  const trEnCurso = new Set(); let trTimer = null, trFallos = 0;
  function programarTraduccion(){ if(!S.canEdit || !S.db) return; clearTimeout(trTimer); trTimer = setTimeout(traducirPendientes, 4000); }
  async function traducirPendientes(){
    if(!S.canEdit || trFallos >= 3) return;
    const faltan = S.products.filter(p => !esCopia(p) && (p.nombre||p.descripcion) && !trEnCurso.has(p.id) && p.trFuente !== fuenteTr(p)).slice(0, 15);
    if(!faltan.length) return;
    faltan.forEach(p=>trEnCurso.add(p.id));
    try{
      const textos = faltan.flatMap(p=>[p.nombre||"", (p.descripcion||"").slice(0,600)]);
      const r = await traducirTextos(textos, otroIdioma());
      if(!Array.isArray(r) || r.length !== textos.length) throw new Error("respuesta incompleta");
      await runPool(faltan.map((p,i)=>({p,i})), ({p,i})=>S.db.doc("productos/"+p.id).update({ trNombre: String(r[2*i]||"").slice(0,120), trDescripcion: String(r[2*i+1]||"").slice(0,800), trFuente: fuenteTr(p) }));
      trFallos = 0;
    }catch(e){ trFallos++; console.warn("No se pudo traducir (se reintenta luego):", e); }
    finally{ faltan.forEach(p=>trEnCurso.delete(p.id)); }
    if(S.products.some(p=>!esCopia(p) && (p.nombre||p.descripcion) && !trEnCurso.has(p.id) && p.trFuente !== fuenteTr(p))) programarTraduccion();
  }

  // ---------- Página de venta: portada y descripción ----------
  let portadaNueva;  // undefined = sin cambios; "" = quitar; ruta = nueva foto
  function pintarPortadaConfig(path){
    const prev = $("setPortadaPrev");
    prev.style.backgroundImage = path ? `url("${src(path)}")` : ""; $("setPortadaVacia").hidden = !!path;
    $("setPortadaDel").hidden = !path; $("setPortadaUp").textContent = path ? "Cambiar foto" : "Subir foto de portada";
  }
  $("setPortadaUp").onclick = ()=>$("setPortadaFile").click();
  $("setPortadaDel").onclick = ()=>{ portadaNueva = ""; pintarPortadaConfig(""); };
  $("setDescTienda").addEventListener("input", ()=>{ $("setDescCuenta").textContent = `${$("setDescTienda").value.length} / 300`; });
  $("setPortadaFile").onchange = async e=>{
    const f = e.target.files && e.target.files[0]; e.target.value = ""; if(!f) return;
    $("setPortadaUp").disabled = true; $("setPortadaUp").textContent = "Subiendo…";
    try{ const img = await decode(f); const c = lienzo(img, 1600); const blob = await aBlobLiviano(c, 1600, .84, 320); const r = await S.assets.upload(blob, {type:"image/jpeg"}); portadaNueva = r.id; pintarPortadaConfig(r.id); toast("Foto lista. Toca Guardar."); }
    catch(err){ toast("No se pudo subir la foto: " + errText(err)); pintarPortadaConfig(S.config.portada||""); }
    finally{ $("setPortadaUp").disabled = false; }
  };
  // Cabecera de la tienda para el cliente: foto, nombre, descripción y cuántos productos hay
  function pintarPortada(){
    const box = $("portadaTienda"); if(!box) return;
    const foto = S.config && S.config.portada, desc = (traducido() && S.config && S.config.trDescripcionTienda) || (S.config && S.config.descripcionTienda) || "";
    box.hidden = S.canEdit || !(foto || desc);
    if(box.hidden) return;
    box.classList.toggle("con-foto", !!foto);
    box.style.backgroundImage = foto ? `url("${src(foto)}")` : "";
    $("portadaNombre").textContent = S.config.nombre || "";
    $("portadaDesc").textContent = desc; $("portadaDesc").hidden = !desc;
    const n = S.products.filter(p=>p.estado!=="oculto").length;
    $("portadaMeta").textContent = n ? tx(`${n} producto${n===1?"":"s"}`, `${n} item${n===1?"":"s"}`) : "";
  }
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
    const antes = enSoles() ? "PEN" : "USD";
    const pais = $("setPais").value === "US" ? "US" : "PE";
    const moneda = pais === "US" ? "USD" : ($("setMoneda").value === "PEN" ? "PEN" : "USD");
    const tc = parsePrice($("setRate").value);
    const conPrecio = S.products.filter(p=>typeof p.precio==="number");
    if(moneda!==antes && conPrecio.length && !(tc>0)){ toast("Escribe el tipo de cambio para convertir tus precios"); $("setRate").focus(); return; }
    if($("setGrupo").value.trim() && !grupoValido($("setGrupo").value)){ toast("El enlace del grupo debe ser de chat.whatsapp.com (en WhatsApp: tu grupo › Invitar al grupo › Copiar enlace)"); $("setGrupo").focus(); return; }
    try{
      await S.db.doc("config/tienda").set({
        nombre:$("setName").value.trim(), whatsapp:$("setWa").value.trim(), tipoCambio: parsePrice($("setRate").value),
        descuentoContado: Math.min(30, Math.max(0, parseMargen($("setDesc").value) || 0)),
        diasSeparado: Math.min(60, Math.max(1, parseStock($("setDias").value) || 7)),
        grupoWhatsapp: grupoValido($("setGrupo").value) || "",
        chatClientes: $("setChatCli").checked,
        rubro: $("setRubro").value || "moda",
        portada: portadaNueva!==undefined ? portadaNueva : (S.config.portada||""),
        descripcionTienda: $("setDescTienda").value.trim().slice(0,300),
        trDescripcionTienda: await traducirDescTienda($("setDescTienda").value.trim().slice(0,300), pais),
        yapeNumero:$("setYapeNum").value.trim(), yapeNombre:$("setYapeName").value.trim(),
        yapeQr: yapeQrNuevo!==undefined ? yapeQrNuevo : (S.config.yapeQr||""),
        pais, moneda,
      });
      // Si cambió la moneda, se convierten los precios ya publicados para que el cliente vea lo mismo.
      if(moneda!==antes && conPrecio.length){
        const fails = await runPool(conPrecio.map(p=>p.id), id=>{ const p = S.products.find(x=>x.id===id); const v = moneda==="PEN" ? Math.round(p.precio*tc) : Math.round(p.precio/tc*100)/100; return S.db.doc("productos/"+id).update({ precio: v }); });
        toast(fails ? `Datos guardados; ${fails} precios no se pudieron convertir` : `Datos guardados y ${conPrecio.length} precios convertidos a ${moneda==="PEN" ? "soles" : "dólares"}`);
      } else toast("Datos guardados");
      yapeQrNuevo = undefined; portadaNueva = undefined; if(!document.querySelector("main").classList.contains("con-tabs")) $("settings").hidden=true;
    }catch(e){ toast("No se pudo guardar. Intenta de nuevo."); }
  };

  // ---------- Controles ----------
  $("q").addEventListener("input", e=>{ S.q=e.target.value; render(); });
  $("orden").value = S.orden;
  $("orden").onchange = e=>{ S.orden = e.target.value; try{ localStorage.setItem(ORDEN_KEY, S.orden); }catch(err){} render(); };
  $("pickBtn").onclick = ()=>$("fileInput").click();
  $("fileInput").onchange = e=>handleFiles(e.target.files);
  const setMode = m=>{ S.mode=m; $("modeEach").setAttribute("aria-pressed",String(m==="each")); $("modeGroup").setAttribute("aria-pressed",String(m==="group")); };
  $("modeEach").onclick=()=>setMode("each"); $("modeGroup").onclick=()=>setMode("group");
  // Tarjetas "¿Cómo quieres subir tus productos?": eligen el modo y abren las fotos
  $("formaFotos").onclick = ()=>{ setMode("each"); $("fileInput").click(); };
  $("formaVarias").onclick = ()=>{ setMode("group"); $("fileInput").click(); };
  const drop=$("drop");
  ["dragenter","dragover"].forEach(t=>drop.addEventListener(t,e=>{e.preventDefault();drop.classList.add("over");}));
  ["dragleave","drop"].forEach(t=>drop.addEventListener(t,e=>{e.preventDefault();drop.classList.remove("over");}));
  drop.addEventListener("drop", e=>{ if(e.dataTransfer && e.dataTransfer.files) handleFiles(e.dataTransfer.files); });
  document.addEventListener("paste", e=>{ if(!S.canEdit) return; const fs=[...(e.clipboardData?.files||[])]; if(fs.length) handleFiles(fs); });

  render();

  // ---------- Conexión (AWS Amplify) ----------
  const params = new URLSearchParams(location.search);
  // Enlace corto: showroomcito.com/maria-importados (necesita la regla de reescritura en Amplify, ver README)
  const slugDeRuta = (/^\/([a-z0-9][a-z0-9-]{1,39})\/?$/i.exec(location.pathname) || [])[1] || "";
  const slugPublico = (params.get("tienda") || slugDeRuta || "").toLowerCase();
  // Se usa el enlace corto solo si la página responde en esa dirección (si falta la regla, sigue el enlace con ?tienda=)
  let linkCorto = slugDeRuta ? true : null;
  const enlaceDe = slug => linkCorto ? location.origin + "/" + encodeURIComponent(slug) : location.origin + "/?tienda=" + encodeURIComponent(slug);
  async function probarLinkCorto(t){
    if(linkCorto !== null) return;
    try{ const r = await fetch("/" + encodeURIComponent(t.id), { cache:"no-store" }); linkCorto = r.ok && /text\/html/.test(r.headers.get("content-type")||""); }catch(e){ linkCorto = false; }
    if(linkCorto) bannerVendedora(t);
  }
  const show = (id, on) => { $(id).hidden = !on; };
  const ESTADO_TXT = { pendiente:"Pendiente de aprobación", aprobada:"Aprobada", suspendida:"Suspendida" };

  // ----- Cuenta: entrar / registrarse / verificar -----
  let paso = "login", correoPendiente = "";
  const loginErr = m=>{ const e=$("loginErr"); e.textContent=m; e.hidden=!m; };
  function pasoAuth(p, hint){
    paso = p; loginErr("");
    const t = (enInicio()
      ? { login:["Sign in","Sign in"], signup:["Create account","Create account"], confirm:["Check your email","Verify"], newPassword:["New password","Save and sign in"], olvido:["Reset password","Send me a code"], reset:["Create your new password","Save and sign in"] }
      : { login:["Entrar","Entrar"], signup:["Crear cuenta","Crear cuenta"], confirm:["Verifica tu correo","Verificar"], newPassword:["Nueva contraseña","Guardar y entrar"], olvido:["Recuperar contraseña","Enviarme un código"], reset:["Crea tu nueva contraseña","Guardar y entrar"] })[p];
    $("authTitle").textContent = t[0]; $("loginBtn").textContent = t[1];
    show("emailRow", p==="login"||p==="signup"||p==="olvido"); show("passRow", p==="login"||p==="signup");
    show("codeRow", p==="confirm"||p==="reset"); show("resendCode", p==="confirm"||p==="reset"); show("newPassRow", p==="newPassword"||p==="reset");
    show("authSwitch", p!=="confirm" && p!=="newPassword"); show("olvideBtn", p==="login");
    show("googleBox", googleDisponible && (p==="login"||p==="signup"));
    $("authSwitch").textContent = p==="signup" ? ti("Ya tengo cuenta","I already have an account") : p==="login" ? ti("Crear una cuenta","Create an account") : ti("Volver a entrar","Back to sign in");
    $("loginPass").autocomplete = p==="signup" ? "new-password" : "current-password";
    // Crear cuenta: lista de requisitos que se marca sola y "repite la contraseña".
    show("reqPass", p==="signup" || p==="newPassword" || p==="reset"); show("pass2Row", p==="signup"); show("passIgual", false);
    revisarPass();
    const h=$("authHint"); h.textContent = hint||""; h.hidden = !hint;
  }
  // Requisitos de contraseña de Cognito: 8 caracteres, mayúscula, minúscula, número y símbolo.
  const REQS = { largo:v=>v.length>=8, may:v=>/[A-Z]/.test(v), min:v=>/[a-z]/.test(v), num:v=>/[0-9]/.test(v), sim:v=>/[^A-Za-z0-9\s]/.test(v) };
  const passCumple = v => Object.values(REQS).every(f=>f(v));
  function revisarPass(){
    const v = (paso==="newPassword" || paso==="reset") ? $("newPass").value : $("loginPass").value;
    document.querySelectorAll("#reqPass li").forEach(li=>li.classList.toggle("ok", REQS[li.dataset.r](v)));
    const v2 = $("loginPass2").value, igual = $("passIgual");
    if(paso==="signup" && v2){ igual.hidden = false; const ok = v2===$("loginPass").value; igual.className = "pass-igual " + (ok?"ok":"no"); igual.textContent = ok ? ti("✓ Las contraseñas coinciden","✓ Passwords match") : ti("Las contraseñas todavía no coinciden","Passwords don't match yet"); }
    else igual.hidden = true;
    // En cuanto la contraseña cumple todo (y coincide), se borra el aviso anterior.
    if(passCumple(v) && (paso!=="signup" || v2===v)) loginErr("");
  }
  ["loginPass","loginPass2","newPass"].forEach(id=>$(id).addEventListener("input", revisarPass));
  $("verPass").onclick = ()=>{
    const ver = $("loginPass").type==="password";
    ["loginPass","loginPass2"].forEach(id=>{ $(id).type = ver ? "text" : "password"; });
    $("verPass").setAttribute("aria-pressed", String(ver)); $("verPass").setAttribute("aria-label", ver ? "Ocultar contraseña" : "Mostrar contraseña");
    $("verPass").textContent = ver ? "🙈" : "👁";
  };
  function abrirAuth(p){ show("landing", false); show("login", true); pasoAuth(p, p==="signup" ? ti("Crea tu cuenta con tu correo. Te enviaremos un código para confirmar que es tuyo.","Create your account with your email. We'll send you a code to confirm it's yours.") : ""); $("login").scrollIntoView({block:"start"}); (p==="confirm"?$("loginCode"):$("loginEmail")).focus(); }
  $("googleBtn").onclick = async ()=>{
    $("googleBtn").disabled = true; loginErr("");
    try{ await entrarConGoogle(); }   // la página se va a Google y vuelve sola
    catch(e){ $("googleBtn").disabled = false; loginErr(e && e.name==="UserAlreadyAuthenticatedException" ? ti("Ya tienes una sesión abierta. Recarga la página.","You're already signed in. Reload the page.") : ti("No se pudo abrir Google. Intenta de nuevo.","Couldn't open Google. Please try again.")); }
  };
  $("adminLink").onclick = ()=>abrirAuth("signup");
  $("goSignup").onclick = ()=>abrirAuth("signup");
  // ----- Página principal: planes en soles o dólares y botones para crear la cuenta -----
  document.querySelectorAll('[data-ir="signup"]').forEach(b=>b.onclick = ()=>abrirAuth("signup"));
  let monedaLanding = "PEN";
  function pintarPlanesLanding(moneda){
    monedaLanding = moneda;
    const box = $("lPlanes"); if(!box) return; box.textContent = "";
    document.querySelectorAll(".l-moneda .chip").forEach(b=>b.setAttribute("aria-pressed", String(b.dataset.moneda===moneda)));
    for(const pl of PLANES){
      const precio = moneda==="USD" ? pl.precioUsd : pl.precio;
      box.append(el("div",{class:"plan-card"+(pl.id==="basico"?" on":"")},
        el("strong",null, pl.nombre),
        el("div",{class:"plan-price"}, precio ? (moneda==="USD" ? `$${precio}` : `S/ ${precio}`) : ti("Gratis","Free"), precio ? el("small",null,ti(" /mes"," /month")) : null),
        el("span",null, pl.limite==null ? ti("Productos ilimitados","Unlimited products") : ti(`Hasta ${pl.limite} productos`,`Up to ${pl.limite} products`)),
        el("span",null, ti("IA, voz, WhatsApp, Yape y tarjeta","AI, voice, WhatsApp, Yape and card")),
        pl.id!=="free" ? el("span",null, ti("Asistente y tiendas de confianza","Assistant and trusted stores")) : el("span",null, ti("Ideal para probar","Great to try it out")),
        pl.extra ? el("span",{class:"extra"}, "+ " + ti(pl.extra, "Coming soon: white-background photos (AI)")) : null,
        el("button",{class:"btn"+(pl.id==="free"?" primary":""),type:"button",onclick:()=>abrirAuth("signup")}, pl.id==="free" ? ti("Empezar gratis","Start free") : ti("Empezar","Start"))));
    }
  }
  document.querySelectorAll(".l-moneda .chip").forEach(b=>b.onclick = ()=>pintarPlanesLanding(b.dataset.moneda));
  pintarPlanesLanding(/^en-US/i.test(navigator.language||"") ? "USD" : "PEN");
  $("goLogin").onclick = ()=>abrirAuth("login");
  $("authSwitch").onclick = ()=>pasoAuth(paso==="login"?"signup":"login");
  $("olvideBtn").onclick = ()=>{ pasoAuth("olvido",ti("Escribe el correo de tu cuenta y te enviaremos un código para crear una contraseña nueva.","Enter your account email and we'll send you a code to create a new password.")); $("loginEmail").focus(); };
  $("verNewPass").onclick = ()=>{ const ver = $("newPass").type==="password"; $("newPass").type = ver ? "text" : "password"; $("verNewPass").setAttribute("aria-pressed", String(ver)); $("verNewPass").setAttribute("aria-label", ver ? "Ocultar contraseña" : "Mostrar contraseña"); $("verNewPass").textContent = ver ? "🙈" : "👁"; };
  $("loginCancel").onclick = ()=>{ show("login", false); if(!slugPublico) show("landing", true); };
  $("logoutBtn").onclick = async ()=>{
    $("logoutBtn").disabled = true;
    let conGoogle = false;
    try{ conGoogle = await cerrarSesion(); }catch(e){ console.warn("Cerrar sesión:", e); }
    // Con Google la página va a Cognito a cerrar su sesión y vuelve sola; si no, se recarga aquí.
    if(conGoogle) setTimeout(()=>{ location.href = location.pathname; }, 8000);
    else location.href = location.pathname;
  };
  // En "Crea tu vitrina": si entró con la cuenta equivocada, sale y vuelve a elegir.
  $("obOtra").onclick = ()=>$("logoutBtn").click();
  $("resendCode").onclick = async ()=>{ try{ if(paso==="reset") await resetPassword({ username: correoPendiente }); else await resendSignUpCode({ username: correoPendiente }); toast("Te enviamos un código nuevo"); }catch(e){ loginErr(errAuth(e)); } };
  const errAuth = err => { const n = err && err.name;
    return n==="NotAuthorizedException"||n==="UserNotFoundException" ? ti("Correo o contraseña incorrectos","Wrong email or password")
      : n==="UsernameExistsException" ? ti("Ya existe una cuenta con ese correo. Toca \"Ya tengo cuenta\".","An account with that email already exists. Tap \"I already have an account\".")
      : n==="InvalidPasswordException" ? ti("La contraseña necesita 8 caracteres con mayúscula, minúscula, número y símbolo","Password needs 8 characters with an uppercase, a lowercase, a number and a symbol")
      : n==="CodeMismatchException" ? ti("El código no es correcto. Revísalo o pide uno nuevo.","Wrong code. Check it or ask for a new one.")
      : n==="ExpiredCodeException" ? ti("El código venció. Toca \"Reenviar código\".","The code expired. Tap \"Resend code\".")
      : n==="UserNotConfirmedException" ? ti("Falta verificar tu correo.","You still need to verify your email.")
      : n==="LimitExceededException"||n==="TooManyRequestsException" ? ti("Hiciste muchos intentos seguidos. Espera unos minutos y vuelve a intentar.","Too many attempts. Wait a few minutes and try again.")
      : n==="InvalidParameterException" && paso==="olvido" ? "Esta cuenta entra con Google y no tiene contraseña. Toca Cancelar y luego \"Continuar con Google\"."
      : ((err && err.message) || ti("No se pudo completar. Intenta de nuevo.","Something went wrong. Please try again.")); };
  async function trasLogin(r){
    if(r.isSignedIn){ location.href = location.pathname; return; }
    const step = r.nextStep && r.nextStep.signInStep;
    if(step==="CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED") return pasoAuth("newPassword","Es tu primer ingreso: crea una contraseña nueva.");
    if(step==="CONFIRM_SIGN_UP"){ correoPendiente=$("loginEmail").value.trim(); try{ await resendSignUpCode({username:correoPendiente}); }catch(e){} return pasoAuth("confirm", ti(`Te enviamos un código a ${correoPendiente}.`,`We sent a code to ${correoPendiente}.`)); }
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
        if(!passCumple(pass)) return loginErr("A tu contraseña le falta algo de la lista: complétala hasta que todo tenga ✓");
        if($("loginPass2").value!==pass) return loginErr("Las dos contraseñas no coinciden. Usa 👁 para revisarlas.");
        const r = await signUp({ username: email, password: pass, options:{ userAttributes:{ email } } });
        correoPendiente = email;
        if(r.nextStep && r.nextStep.signUpStep==="CONFIRM_SIGN_UP") pasoAuth("confirm", `Te enviamos un código a ${email}. Escríbelo aquí.`);
        else await trasLogin(await signIn({ username: email, password: pass }));
      } else if(paso==="confirm"){
        const code=$("loginCode").value.trim(); if(!code) return loginErr("Escribe el código que te llegó por correo");
        await confirmSignUp({ username: correoPendiente, confirmationCode: code });
        if(pass) await trasLogin(await signIn({ username: correoPendiente, password: pass }));
        else { pasoAuth("login","Correo verificado. Ahora entra con tu contraseña."); $("loginEmail").value=correoPendiente; }
      } else if(paso==="olvido"){
        if(!email) return loginErr("Escribe el correo de tu cuenta");
        try{ await resetPassword({ username: email }); }
        catch(e){ if(e && e.name==="UserNotFoundException") return loginErr("No encontramos una cuenta con ese correo. Revisa que esté bien escrito."); throw e; }
        correoPendiente = email;
        pasoAuth("reset", `Te enviamos un código a ${email}. Escríbelo aquí y crea tu contraseña nueva.`); $("loginCode").focus();
      } else if(paso==="reset"){
        const code=$("loginCode").value.trim(), nueva=$("newPass").value;
        if(!code) return loginErr("Escribe el código que te llegó por correo");
        if(!passCumple(nueva)) return loginErr("A tu contraseña le falta algo de la lista: complétala hasta que todo tenga ✓");
        await confirmResetPassword({ username: correoPendiente, confirmationCode: code, newPassword: nueva });
        toast("Contraseña cambiada");
        await trasLogin(await signIn({ username: correoPendiente, password: nueva }));
      } else if(paso==="newPassword"){
        if(!passCumple($("newPass").value)) return loginErr("A tu contraseña le falta algo de la lista: complétala hasta que todo tenga ✓");
        await trasLogin(await confirmSignIn({ challengeResponse: $("newPass").value }));
      }
    }catch(err){
      // Ya había una sesión abierta (por ejemplo, la página no la detectó a tiempo): entrar directo a la vitrina.
      if(err && err.name==="UserAlreadyAuthenticatedException"){ location.href = location.pathname; return; }
      loginErr(errAuth(err));
    }
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
      // Vista previa del dictado: se actualiza con lo que completa la IA (sin interrumpir si está escribiendo)
      if(typeof dictAbierto==="function" && dictAbierto() && D.paso==="previa" && !(document.activeElement && $("planOverlay").contains(document.activeElement) && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName))) pintarDict();
      if(cartOpen && !$("overlay").contains(document.activeElement)) drawCart();
      if(!S.canEdit){ mensajeEstadoPublico(); pintarCuentaBtn(); } else { actualizarPlan(); if(!snap.metadata.fromCache){ asignarCodigos(); if(!S.timerCodigos) S.timerCodigos = setInterval(asignarCodigos, 60000); programarTraduccion(); if(!S.timerTr) S.timerTr = setInterval(()=>{ trFallos = 0; traducirPendientes(); }, 300000); } }
    }, ()=>{ clearTimeout(slow); S.loaded=true; $("emptyTitle").textContent="No se pudo cargar la vitrina"; $("emptyText").textContent="Recarga la página en unos minutos."; render(); });
    db.doc("config/tienda").onSnapshot(s=>{ S.config = s.exists ? s.data() : {}; renderConfig(); if(S.canEdit){ actualizarPlan(); pintarCobros(); } }, ()=>{});
  }
  function mensajeEstadoPublico(silencio){
    const c = estadoCatalogo(); if(!c) return;
    if(c.estado==="no_existe"){ $("emptyTitle").textContent="Esta vitrina no existe / Store not found"; $("emptyText").textContent="Revisa el enlace que te compartieron. / Check the link you received."; show("empty", true); }
    else if(!c.productos){ $("emptyTitle").textContent = c.estado==="suspendida" ? tx("Esta vitrina no está disponible","This store isn't available") : tx("Esta vitrina abrirá pronto","This store opens soon"); $("emptyText").textContent = c.estado==="suspendida" ? tx("La tienda está pausada por ahora.","The store is paused for now.") : tx("La tienda está terminando de prepararse. Vuelve en un rato.","The store is getting ready. Check back soon."); show("empty", true); }
    else if(c.vistaPrevia && !silencio) toast("Vista previa: los clientes aún no ven esta vitrina");
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
    probarLinkCorto(t);
    $("shareStore").onclick = ()=>compartirTienda(t);
    $("qrStore").onclick = ()=>abrirQR(t);
    $("copyLink").onclick = async ()=>{ try{ await navigator.clipboard.writeText(enlaceDe(t.id)); toast("Enlace copiado"); }catch(e){ const r=document.createRange(); r.selectNodeContents($("bannerLink")); const sl=getSelection(); sl.removeAllRanges(); sl.addRange(r); toast("Selecciona y copia el enlace"); } };
  }

  // ---------- Compartir la tienda: un toque (WhatsApp, Instagram…) y código QR para imprimir ----------
  const textoCompartir = t => `¡Mira mi tienda ${t.nombre||""}! 🛍️ Novedades y ofertas aquí 👉 ${enlaceDe(t.id)}`;
  async function compartirTienda(t){
    const url = enlaceDe(t.id), texto = textoCompartir(t);
    if(navigator.share){ try{ await navigator.share({ title: t.nombre || "Mi tienda", text: texto.replace(" " + url, ""), url }); return; }catch(e){ if(e && e.name==="AbortError") return; } }
    window.open("https://wa.me/?text=" + encodeURIComponent(texto), "_blank", "noopener");
  }
  /** Tarjeta para imprimir o compartir: nombre de la tienda, el QR y el enlace. */
  function tarjetaQR(t){
    const W = 1080, H = 1350, c = document.createElement("canvas"); c.width = W; c.height = H;
    const g = c.getContext("2d"), q = qrCanvas(enlaceDe(t.id), 760);
    g.fillStyle = "#14213d"; g.fillRect(0, 0, W, H);
    g.fillStyle = "#fff"; g.beginPath(); g.roundRect ? g.roundRect(70, 250, W-140, 900, 48) : g.rect(70, 250, W-140, 900); g.fill();
    g.textAlign = "center"; g.fillStyle = "#fff";
    let tam = 76; g.font = `800 ${tam}px Inter, system-ui, sans-serif`;
    const nombre = t.nombre || "Mi tienda"; while(g.measureText(nombre).width > W-120 && tam > 36){ tam -= 4; g.font = `800 ${tam}px Inter, system-ui, sans-serif`; }
    g.fillText(nombre, W/2, 140);
    g.font = "500 40px Inter, system-ui, sans-serif"; g.fillStyle = "#ffcc29"; g.fillText("Escanéame y mira mi tienda", W/2, 205);
    const lado = 760; g.drawImage(q, (W-lado)/2, 300, lado, lado);
    g.fillStyle = "#14213d"; g.font = "600 34px ui-monospace, Menlo, monospace";
    const corto = enlaceDe(t.id).replace(/^https?:\/\//, ""); g.fillText(corto.length > 44 ? corto.slice(0, 43) + "…" : corto, W/2, 1110);
    g.fillStyle = "#c9d1e3"; g.font = "500 30px Inter, system-ui, sans-serif"; g.fillText("Apunta la cámara de tu celular al código", W/2, 1240);
    return c;
  }
  function abrirQR(t){
    const ov = $("overlay"); ov.textContent = ""; openId = null; cartOpen = false; cuentaOpen = true; ov.hidden = false;
    const c = tarjetaQR(t); c.className = "qr-tarjeta"; c.setAttribute("role","img"); c.setAttribute("aria-label", "Código QR de tu tienda");
    const nombreArchivo = "qr-" + t.id + ".png";
    const bajar = el("a",{class:"btn primary",download:nombreArchivo,href:"#",style:"text-decoration:none;justify-content:center"},"Descargar imagen");
    bajar.onclick = ()=>{ bajar.href = c.toDataURL("image/png"); };
    const enviar = el("button",{class:"btn",type:"button",onclick:async()=>{
      try{ const blob = await new Promise(r=>c.toBlob(r,"image/png")); const f = new File([blob], nombreArchivo, {type:"image/png"});
        if(navigator.canShare && navigator.canShare({ files:[f] })){ await navigator.share({ files:[f], text: textoCompartir(t) }); return; } }catch(e){ if(e && e.name==="AbortError") return; }
      bajar.click(); toast("Imagen descargada: envíala por WhatsApp o ponla en tu estado"); }},"Compartir imagen");
    const imprimir = el("button",{class:"btn",type:"button",onclick:()=>{
      const w = window.open("", "_blank"); if(!w){ toast("Permite las ventanas emergentes para imprimir"); return; }
      w.document.write(`<!doctype html><title>QR ${t.nombre||""}</title><body style="margin:0;display:grid;place-items:center;min-height:100vh"><img src="${c.toDataURL("image/png")}" style="width:12cm;max-width:90vw" onload="setTimeout(()=>print(),200)"></body>`); w.document.close(); }},"Imprimir");
    ov.append(el("div",{class:"cart qr-box",role:"dialog","aria-modal":"true","aria-label":"Código QR de tu tienda"},
      el("div",{class:"cart-head"}, el("h2",null,"Código QR de tu tienda"), el("button",{class:"btn",type:"button",onclick:closeCart},"Cerrar")),
      el("p",{class:"note",style:"margin:0"},"Imprímelo y pégalo en tu puesto, en tus bolsas o en una tarjeta. Tus clientes lo escanean con la cámara del celular y entran directo a tu tienda."),
      c, el("div",{class:"send"}, bajar, enviar, imprimir)));
  }

  // ---------- Asistente de compras del cliente ----------
  // El cliente pregunta ("regalos para niño de 5 años") y recibe productos de ESTA tienda para ver o pedir.
  let cliLog = [], cliOcupado = false, cliRec = null;
  const CLI_KEY = () => "cli:" + ((S.config && S.config.id) || "tienda");
  const guardarCli = ()=>{ try{ sessionStorage.setItem(CLI_KEY(), JSON.stringify(cliLog.slice(-30))); }catch(e){} };
  const cargarCli = ()=>{ try{ cliLog = JSON.parse(sessionStorage.getItem(CLI_KEY()) || "[]"); }catch(e){ cliLog = []; } };
  function cliActivo(){ return !S.canEdit && S.config && S.config.chatClientes !== false && S.products.length > 0 && (estadoCatalogo()||{}).estado === "aprobada"; }
  function pintarCliBtn(){
    const b = $("cliBtn"); if(!b) return;
    b.hidden = !cliActivo() || !$("cli").hidden;
    b.style.bottom = $("cartbar").hidden ? "" : "calc(76px + env(safe-area-inset-bottom,0px))";
    if(!b.style.bottom) b.style.bottom = "calc(16px + env(safe-area-inset-bottom,0px))";
    $("cliBtnTxt").textContent = tx("¿Buscas algo?","Need help?");
  }
  function tarjetaCli(p){
    const of = oferta(p), cover = p.fotos && p.fotos[0], enPedido = !!cart[p.id], sold = agotado(p);
    // Agregar (o quitar) del pedido sin salir del chat
    const agregar = el("button",{class:"cli-add"+(enPedido?" in":""),type:"button",disabled:sold?"":false,"aria-label":(enPedido?tx("Quitar del pedido: ","Remove from order: "):tx("Agregar al pedido: ","Add to order: "))+nom(p),
      onclick:()=>{ if(cart[p.id]) delete cart[p.id]; else { cart[p.id]=1; toast(tx("Agregado a tu pedido","Added to your order")); } saveCart(); render(); pintarCli(); }},
      sold ? tx("Agotado","Sold out") : enPedido ? tx("✓ Agregado","✓ Added") : tx("+ Agregar","+ Add"));
    return el("div",{class:"cli-prod"},
      el("button",{class:"cli-ver",type:"button",onclick:()=>openProduct(p.id),"aria-label":tx("Ver ","View ")+nom(p)},
        cover ? el("img",{src:src(cover.thumb||cover.full),alt:"",loading:"lazy"}) : el("span",{class:"sinfoto"}),
        el("span",null, el("b",null, nom(p)), el("small",null, [codigoDe(p), p.marca, p.talla ? tx("Talla ","Size ")+p.talla : ""].filter(Boolean).join(" · ")))),
      el("span",{class:"cli-der"}, el("span",{class:"pr"}, p.precio==null ? tx("Consultar","Ask") : money(p.precio), of ? el("s",null, money(of.antes)) : null), agregar));
  }
  function pintarCli(){
    const log = $("cliLog"); log.textContent = "";
    $("cliTitulo").textContent = tx("¿En qué te ayudo?","How can I help?");
    $("cliSub").textContent = tx(`Te recomiendo productos de ${S.config.nombre || "esta tienda"}.`, `I'll suggest products from ${S.config.nombre || "this store"}.`);
    $("cliInput").placeholder = tx("Ej.: regalos para niño de 5 años","E.g.: gifts for a 5-year-old boy");
    $("cliNuevo").textContent = tx("Nueva","New"); $("cliEnviar").textContent = tx("Enviar","Send");
    if(!cliLog.length) log.append(el("div",{class:"burbuja assistant"}, tx("¡Hola! Cuéntame qué buscas (para quién, ocasión, talla o presupuesto) y te muestro opciones de la tienda.","Hi! Tell me what you're looking for (who it's for, occasion, size or budget) and I'll show you options from the store.")));
    for(const m of cliLog){
      if(m.text){ const b = el("div",{class:"burbuja " + m.role}); if(m.role==="assistant") b.append(...textoAsis(m.text)); else b.textContent = m.text; log.append(b); }
      if(m.codigos && m.codigos.length){
        const prods = m.codigos.map(c=>S.products.find(p=>codigoDe(p)===c)).filter(Boolean);
        if(prods.length) log.append(el("div",{class:"cli-prods"}, ...prods.map(tarjetaCli)));
      }
    }
    if(cliOcupado) log.append(el("div",{class:"pensando"}, tx("Buscando en la tienda…","Looking through the store…")));
    const sug = $("cliSug"); sug.textContent = "";
    if(!cliLog.length){
      const ideas = esUS() ? ["Gifts for a 5-year-old boy","What's on sale?","Something for mom","Under $50"] : ["Regalos para niño de 5 años","¿Qué ofertas hay?","Algo para mamá","Menos de S/ 100"];
      ideas.forEach(t=>sug.append(el("button",{type:"button",onclick:()=>enviarCli(t)}, t)));
    }
    const wa = waDigits(), w = $("cliWa"); w.textContent = "";
    const n = cartCount();
    if(n) w.append(el("button",{class:"btn tag cli-pedido",type:"button",onclick:()=>{ $("cli").hidden = true; document.body.classList.remove("cli-abierto"); pintarCliBtn(); openCart(); }}, tx(`🛒 Ver mi pedido (${n}) · ${money(cartTotals().total)}`, `🛒 View my order (${n}) · ${money(cartTotals().total)}`)), el("br"));
    if(wa) w.append(tx("¿Prefieres hablar con la tienda? ","Rather talk to the store? "), el("a",{href:`https://wa.me/${wa}`,target:"_blank",rel:"noopener"}, tx("Escríbenos por WhatsApp","Message us on WhatsApp")));
    log.scrollTop = log.scrollHeight;
  }
  async function enviarCli(texto){
    texto = String(texto||"").trim(); if(!texto || cliOcupado) return;
    if(cliRec){ const r = cliRec; cliRec = null; r.pausar(); $("cliMic").classList.remove("on"); }
    cliLog.push({ role:"user", text:texto }); cliOcupado = true; guardarCli(); pintarCli();
    const inp = $("cliInput"); inp.blur(); inp.value = ""; $("cliEnviar").disabled = true;
    try{
      const r = await preguntarTienda(cliLog.filter(m=>m.role==="user"||m.role==="assistant").map(m=>({ role:m.role, text:m.text })), EN() ? "en" : "es");
      cliLog.push({ role:"assistant", text: r.texto || "", codigos: Array.isArray(r.codigos) ? r.codigos : [] });
    }catch(e){
      cliLog.push({ role:"error", text: tx("No pude responder ahora. Intenta de nuevo o escríbenos por WhatsApp.","I couldn't answer right now. Try again or message us on WhatsApp.") });
    }finally{ cliOcupado = false; $("cliEnviar").disabled = false; guardarCli(); pintarCli(); }
  }
  $("cliBtn").onclick = ()=>{ cargarCli(); $("cli").hidden = false; document.body.classList.add("cli-abierto"); pintarCliBtn(); pintarCli(); $("cliInput").focus(); };
  $("cliCerrar").onclick = ()=>{ $("cli").hidden = true; document.body.classList.remove("cli-abierto"); pintarCliBtn(); };
  $("cliNuevo").onclick = ()=>{ cliLog = []; guardarCli(); pintarCli(); };
  $("cliForm").addEventListener("submit", e=>{ e.preventDefault(); enviarCli($("cliInput").value); });
  $("cliInput").addEventListener("keydown", e=>{ if(e.key==="Enter" && !e.shiftKey){ e.preventDefault(); enviarCli($("cliInput").value); } });

  // ---------- Mensaje para el grupo de WhatsApp de ventas ----------
  // WhatsApp no deja publicar solo en un grupo: armamos el mensaje y la vendedora lo comparte y elige su grupo.
  const TIPOS_GRUPO = [
    ["ofertas","🔥 Ofertas","🔥 *OFERTAS*","Pídelo escribiéndome el código 👉"],
    ["preventa","🛍️ Preventa","🛍️ *PREVENTA*","Separa el tuyo escribiéndome el código 📩"],
    ["novedades","✨ Novedades","✨ *NUEVOS INGRESOS*","Pídelo escribiéndome el código 👉"],
    ["remate","⚡ Últimas unidades","⚡ *ÚLTIMAS UNIDADES*","¡Corre que se acaban! Escríbeme el código 👉"],
  ];
  function textoGrupo(tipo, lista){
    const t = TIPOS_GRUPO.find(x=>x[0]===tipo) || TIPOS_GRUPO[0];
    const lineas = lista.map(p=>{
      const of = oferta(p), cod = codigoDe(p);
      const precio = of ? `~${money(of.antes)}~ *${money(of.precio)}* (-${of.pct} %) · hasta ${fechaOferta(of.hasta)}` : p.precio!=null ? `*${money(p.precio)}*` : "Precio a consultar";
      return `▪️ ${cod ? "*"+cod+"* " : ""}${p.nombre || "Producto"}${p.talla ? " · Talla "+p.talla : ""}\n     ${precio}`;
    });
    return `${t[2]} · ${S.config.nombre || "mi tienda"}\n\n${lineas.join("\n")}\n\n${t[3]}\n${enlaceDe(S.config.id || "")}`;
  }
  function abrirMensajeGrupo(ids){
    let lista = ids.map(id=>S.products.find(p=>p.id===id)).filter(Boolean);
    let origen = "marcados";
    if(!lista.length){ lista = S.products.filter(p=>oferta(p)); origen = "ofertas"; }
    lista = lista.filter(p=>p.estado!=="vendido" && p.estado!=="oculto");
    if(!lista.length){ toast("Marca productos con Editar varios, o pon productos en oferta, para armar el mensaje"); return; }
    let tipo = origen==="ofertas" || lista.some(p=>oferta(p)) ? "ofertas" : "novedades";
    const ov=$("planOverlay"); ov.textContent=""; ov.hidden=false; delete ov.dataset.conf; delete ov.dataset.dict;
    const cerrar = ()=>{ ov.hidden=true; ov.textContent=""; };
    ov.onclick = e=>{ if(e.target===ov) cerrar(); };
    const area = el("textarea",{rows:"12",style:"width:100%;font:inherit;font-size:14px",id:"grupoTexto","aria-label":"Mensaje para el grupo"});
    const chips = el("div",{class:"cats",role:"group","aria-label":"Tipo de mensaje"});
    const pintar = ()=>{ area.value = textoGrupo(tipo, lista); enlazar(); chips.querySelectorAll("button").forEach(b=>b.setAttribute("aria-pressed", String(b.dataset.tipo===tipo))); };
    TIPOS_GRUPO.forEach(([k,l])=>chips.append(el("button",{class:"chip",type:"button","data-tipo":k,onclick:()=>{ tipo=k; pintar(); }}, l)));
    const grupo = grupoValido(S.config.grupoWhatsapp);
    const copiar = el("button",{class:"btn",type:"button",onclick:async()=>{ try{ await navigator.clipboard.writeText(area.value); toast("Mensaje copiado: pégalo en tu grupo"); }catch(e){ area.select(); toast("Selecciona el texto y cópialo"); } }},"Copiar");
    const compartir = el("a",{class:"btn primary",href:"https://wa.me/",target:"_blank",rel:"noopener",style:"text-decoration:none"},"Enviar por WhatsApp");
    const enlazar = ()=>{ compartir.href = "https://wa.me/?text=" + encodeURIComponent(area.value); };
    area.addEventListener("input", enlazar);
    // Con fotos: el celular abre "Compartir" con las fotos y el texto (WhatsApp › elige tu grupo)
    const conFotos = el("button",{class:"btn",type:"button",hidden:true,onclick:async()=>{
      conFotos.disabled = true; conFotos.textContent = "Preparando fotos…";
      try{
        const files = [];
        for(const p of lista.slice(0,10)){ const f = p.fotos && p.fotos[0]; if(!f) continue; try{ const b = await (await fetch(src(f.full||f.thumb))).blob(); files.push(new File([b], (codigoDe(p)||p.id) + ".jpg", { type: b.type || "image/jpeg" })); }catch(e){} }
        if(files.length && navigator.canShare && navigator.canShare({ files })) await navigator.share({ files, text: area.value });
        else await navigator.share({ text: area.value });
      }catch(e){ if(!(e && e.name==="AbortError")) toast("Tu celular no dejó compartir las fotos; usa Enviar por WhatsApp"); }
      finally{ conFotos.disabled = false; conFotos.textContent = "Compartir con fotos"; }
    }},"Compartir con fotos");
    try{ conFotos.hidden = !(navigator.canShare && navigator.canShare({ files:[new File([""],"x.jpg",{type:"image/jpeg"})] })); }catch(e){}
    const card = el("div",{class:"cart",role:"dialog","aria-modal":"true","aria-label":"Mensaje para tu grupo",style:"width:min(620px,100%)"},
      el("div",{class:"cart-head"}, el("h2",null,"Mensaje para tu grupo"), el("button",{class:"btn",type:"button",onclick:cerrar},"Cerrar")),
      el("p",{class:"note",style:"margin:0"}, `${lista.length} producto${lista.length===1?"":"s"} ${origen==="ofertas" ? "en oferta" : "marcado" + (lista.length===1?"":"s")}. Elige el tipo de mensaje; puedes editar el texto antes de enviarlo.`),
      chips, area,
      el("div",{class:"acciones",style:"display:flex;flex-wrap:wrap;gap:8px"}, compartir, conFotos, copiar,
        grupo ? el("a",{class:"btn",href:grupo,target:"_blank",rel:"noopener",style:"text-decoration:none"},"Abrir mi grupo") : null),
      el("p",{class:"note",style:"margin:0"}, grupo ? "Al tocar Enviar por WhatsApp, elige tu grupo de ventas en la lista." : "Tip: agrega el enlace de tu grupo en Datos de la tienda para que tus clientes vean el botón Únete a mi grupo."));
    ov.append(card); pintar(); area.focus();
  }

  // ---------- Pestañas de la vendedora ----------
  const TABS = ["productos","pedidos","clientes","confianza","plan","datos"], TAB_KEY = "vitrina-tab";
  function irTab(tab, guardar = true){
    if(!TABS.includes(tab)) tab = "productos";
    const main = document.querySelector("main"); main.dataset.tab = tab;
    document.querySelectorAll("#vtabs [data-tab]").forEach(b=>{ const on = b.dataset.tab === tab; b.setAttribute("aria-selected", String(on)); b.tabIndex = on ? 0 : -1; });
    if(tab === "pedidos") $("pedidosBox").open = true;
    if(guardar){ try{ localStorage.setItem(TAB_KEY, tab); }catch(e){} }
    const nav = $("vtabs"); if(nav.getBoundingClientRect().top < 0) nav.scrollIntoView({ block:"start" });
  }
  function activarTabs(){
    const main = document.querySelector("main"); main.classList.add("con-tabs");
    show("vtabs", true); show("settings", true); show("settingsBtn", false);
    const nav = $("vtabs"); nav.setAttribute("role","tablist");
    nav.querySelectorAll("[data-tab]").forEach(b=>{ b.setAttribute("role","tab"); b.onclick = ()=>irTab(b.dataset.tab); });
    nav.addEventListener("keydown", e=>{
      if(e.key!=="ArrowRight" && e.key!=="ArrowLeft") return;
      const i = TABS.indexOf(main.dataset.tab), sig = TABS[(i + (e.key==="ArrowRight" ? 1 : TABS.length-1)) % TABS.length];
      irTab(sig); nav.querySelector(`[data-tab="${sig}"]`).focus();
    });
    let tab = (location.hash||"").slice(1);
    if(!TABS.includes(tab)){ try{ tab = localStorage.getItem(TAB_KEY) || ""; }catch(e){ tab = ""; } }
    if(params.get("plan") || params.get("cobros")) tab = "plan";
    irTab(tab, false);
  }
  function quitarTabs(){ document.querySelector("main").classList.remove("con-tabs"); show("vtabs", false); }
  // Numerito en cada pestaña (resaltado si hay algo por hacer)
  function marcarTab(tab, n, alerta){ const e = $("vtN-"+tab); if(!e) return; e.textContent = n ? String(n) : ""; e.classList.toggle("alerta", !!alerta); }

  // ----- Panel de la dueña -----
  let panelFiltro = "pendiente", tiendasCache = [];
  async function abrirPanel(){
    quitarTabs();
    // El panel de la dueña muestra solo la administración: se ocultan los recuadros de su propia tienda.
    show("vitrina", false); show("storeBanner", false); show("onboard", false); show("confBox", false);
    show("planBox", false); show("planAviso", false); show("pedidosVacio", false); show("cobrosBox", false); show("pedidosBox", false); show("settings", false); show("asisBtn", false);
    show("panel", true);
    $("panelRows").textContent = ""; $("panelCount").textContent = "Cargando vitrinas…";
    try{ tiendasCache = await listarTiendas(); }catch(e){ $("panelCount").textContent = "No se pudieron cargar las vitrinas: " + ((e&&e.message)||""); return; }
    pintarPanel(); cargarPanelConf();
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
    const box=$("planBox"); if(!S.canEdit || !$("panel").hidden){ box.hidden=true; $("planAviso").hidden=true; return; }
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
    // Con pestañas el plan queda en otra hoja: si está lleno, se avisa también en Productos.
    marcarTab("plan", lleno ? "!" : "", lleno);
    const av = $("planAviso"); av.textContent = "";
    av.hidden = !lleno;
    if(lleno) av.append(el("span",null, msg), el("button",{class:"linkish",type:"button",onclick:abrirPlanes},"Mejorar plan"));
  }
  function abrirPlanes(){
    const u = usoPlan(), ov=$("planOverlay"); ov.textContent=""; ov.hidden=false; delete ov.dataset.conf;
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
        el("div",{class:"plan-price"}, pl.precio ? (esUS() ? `$${pl.precioUsd}` : `S/ ${pl.precio}`) : "Gratis", pl.precio ? el("small",null," /mes") : null),
        el("span",null, pl.limite==null ? "Productos ilimitados" : `Hasta ${pl.limite} productos`),
        el("span",null, "Fotos mejoradas automáticamente"),
        pl.asis ? el("span",null, `Asistente: ${pl.asis} mensajes al día`) : null,
        pl.cli ? el("span",null, `Chat para tus clientes: ${pl.cli} preguntas al día`) : null,
        pl.extra ? el("span",{class:"extra"}, "+ " + pl.extra) : null, btn));
    }
    card.append(grid, el("p",{class:"note",style:"margin:0"},`Pago mensual con tarjeta a través de Stripe${esUS() ? ", en dólares" : ", en soles"}. Puedes volver a Free cuando quieras.`));
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
    if(!S.canEdit || !$("panel").hidden){ show("cobrosBox", false); return; }
    const activos = !!(S.config && S.config.cobrosActivos), empezado = !!(S.config && S.config.stripeAccountId);
    show("cobrosBox", true);
    const pill=$("cobrosPill"); pill.className="pill "+(activos?"activos":"inactivos"); pill.textContent = activos ? "Pagos con tarjeta activos" : "Pagos con tarjeta";
    $("cobrosText").textContent = activos ? "Tus clientes pueden pagar su pedido con tarjeta. El dinero llega a tu cuenta de Stripe."
      : empezado ? "Falta completar tus datos en Stripe para recibir pagos." : "Activa los pagos con tarjeta para que tus clientes paguen en la web. También pueden seguir pidiendo por WhatsApp.";
    const b=$("cobrosBtn"); b.hidden = activos; b.textContent = empezado ? "Completar datos en Stripe" : "Activar pagos con tarjeta";
    b.onclick = async ()=>{ b.disabled=true; try{ const r = await conectarCobros(); location.href = r.url; }catch(e){ toast((e&&e.message)||"No se pudo abrir Stripe"); b.disabled=false; } };
  }

  // ----- Dictado por voz -----
  // La vendedora mira sus productos y los dicta, uno tras otro, diciendo "siguiente" entre cada uno.
  // Cada producto se guarda al instante (borrador en este navegador). Luego la IA entiende el texto,
  // ella elige las fotos en el mismo orden, ve una vista previa (productos ocultos) y recién publica.
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  // "siguiente" y lo que suele entender el navegador en su lugar
  const SEPARADOR = SEPARADOR_PRODUCTOS;
  // Vocabulario para ayudar al reconocimiento: marcas conocidas y de la tienda, tipos de producto y palabras de sus productos
  let vocabCache = null, vocabClave = "";
  function vocabTienda(){
    const prods = S.products || [], clave = prods.length + "|" + rubroActual();
    if(vocabCache && vocabClave === clave) return vocabCache;
    const marcasTienda = [...new Set(prods.map(p=>p.marca).filter(Boolean))];
    const palabras = new Map();
    prods.forEach(p=>String(p.nombre||"").split(/[^A-Za-zÁÉÍÓÚÑáéíóúñ]+/).forEach(w=>{ if(w.length>=4) palabras.set(w.toLowerCase(), w.toLowerCase()); }));
    vocabCache = vocabulario([
      ...MARCAS.map(txt=>({ txt, tipo:"marca" })), ...marcasTienda.map(txt=>({ txt, tipo:"marca" })),
      { txt: esUS() ? "next" : "siguiente", tipo:"clave" },
      ...TIPOS.map(t=>t[0]), ...TIPOS.flatMap(t=>t[3].split("|")), ...palabras.values()]);
    vocabClave = clave; return vocabCache;
  }
  const D = { paso:"dictar", items:[], buffer:"", datos:[], fotos:[], ids:[], escuchando:false, interino:"" };
  let rec = null;
  const claveDict = () => "dictado-" + ((S.config && S.config.id) || "tienda");
  function guardarDict(){ try{ localStorage.setItem(claveDict(), JSON.stringify({ items:D.items, buffer:D.buffer, ids:D.ids })); }catch(e){} }
  function cargarDict(){ try{ const d = JSON.parse(localStorage.getItem(claveDict()) || "{}"); D.items = Array.isArray(d.items) ? d.items : []; D.buffer = d.buffer || ""; D.ids = Array.isArray(d.ids) ? d.ids : []; }catch(e){} }
  const dictAbierto = () => !$("planOverlay").hidden && $("planOverlay").dataset.dict === "1";
  function agregarTexto(t){
    let resto = (D.buffer + " " + t).replace(/\s+/g," ");
    const partes = resto.split(SEPARADOR);
    resto = partes.pop();
    for(const p of partes){ const x = p.trim().replace(/^[.,;:\s]+|[.,;:\s]+$/g,""); if(x) D.items.push(x); }
    D.buffer = resto.trimStart();
    guardarDict();
  }
  function cerrarProductoActual(){ agregarTexto(" siguiente "); }
  // Escucha reforzada (src/voz.js): se vuelve a encender sola tras los silencios, no repite frases,
  // se pausa si se apaga la pantalla y corrige marcas y palabras con el vocabulario de la tienda.
  function microfono(on){
    if(D.finalizando) return;
    if(!SR){ toast("Tu navegador no permite dictar aquí: escribe con el micrófono del teclado"); return; }
    if(!on){ D.pausaSola = false; if(rec) rec.pausar(); D.escuchando=false; D.interino=""; pintarDict(); return; }
    if(rec) rec.pausar();
    rec = escucha(SR, { lang: esUS() ? "en-US" : "es-PE", vocab: vocabTienda(),
      alTexto: t=>{ agregarTexto(t); pintarVivo(); },
      alInterino: t=>{ D.interino = t; pintarVivo(); },
      alEstado: (estado, det)=>{
        if(estado==="escuchando"){ D.escuchando = true; D.pausaSola = false; }
        else if(estado==="silencio"){ D.escuchando = false; D.pausaSola = true; toast("Me pausé porque no te escuché. Toca el micrófono para seguir donde te quedaste"); }
        else if(estado==="error"){ D.escuchando = false; toast(/not-allowed|audio-capture/.test(det||"") ? "Permite el micrófono para dictar, o escribe con el micrófono del teclado" : "No se pudo usar el micrófono"); }
        else if(estado==="pausa"){ D.escuchando = false; }
        if(dictAbierto()) pintarDict();
      } });
    rec.iniciar();
  }
  function abrirDictado(){
    cargarDict();
    D.paso = D.ids.length && S.products.some(p=>D.ids.includes(p.id)) ? "previa" : "dictar";
    const ov=$("planOverlay"); ov.hidden=false; ov.dataset.dict="1"; delete ov.dataset.conf;
    ov.onclick = e=>{ if(e.target===ov) cerrarDictado(); };
    pintarDict();
  }
  function cerrarDictado(){ microfono(false); D.fotos.forEach(f=>{ if(f && f.url) URL.revokeObjectURL(f.url); }); const ov=$("planOverlay"); ov.hidden=true; ov.textContent=""; delete ov.dataset.dict; }
  function pintarVivo(){
    const b = $("dictBuffer"), i = $("dictInterino");
    if(b) b.textContent = D.buffer || (D.escuchando ? "Escuchando…" : "");
    if(i) i.textContent = D.interino;
    // Producto nuevo cerrado con "siguiente": se vuelve a dibujar la lista (también la primera vez, cuando aún no existe)
    const l = $("dictLista"); if((l ? l.childElementCount : 0) !== D.items.length) pintarDict();
  }
  function pintarDict(){
    if(!dictAbierto()) return;
    const ov=$("planOverlay"); ov.textContent="";
    const titulos = { dictar:"Dictar productos", revisar:"Revisa lo que entendí", fotos:"Elige las fotos en el mismo orden", subiendo:"Preparando la vista previa", previa:"Vista previa antes de publicar" };
    const card = el("div",{class:"cart",role:"dialog","aria-modal":"true","aria-label":titulos[D.paso],style:"width:min(720px,100%)"},
      el("div",{class:"cart-head"}, el("h2",null,titulos[D.paso]), el("button",{class:"btn",type:"button",onclick:cerrarDictado}, D.paso==="subiendo" ? "Ocultar" : "Cerrar")));
    ({ dictar:pasoDictar, revisar:pasoRevisar, fotos:pasoFotos, subiendo:pasoSubiendo, previa:pasoPrevia })[D.paso](card);
    ov.append(card);
  }
  function pasoDictar(card){
    const enCurso = !!(D.buffer.trim() || D.items.length);
    const mic = el("button",{class:"mic",type:"button","aria-label": D.escuchando ? "Pausar el dictado" : enCurso ? "Seguir dictando" : "Empezar a dictar", onclick:()=>microfono(!D.escuchando)}, D.escuchando ? "❚❚" : "🎙️");
    card.append(
      el("p",{class:"note",style:"margin:0"}, "Mira cada producto y dilo de corrido: qué es, marca, condición, precio y cuántos tienes. Al terminar uno, di ", el("strong",null,"“siguiente”"), ". Ej.: ", el("em",null,"“Cartera Coach negra, nueva con etiqueta, 85 soles, tengo 2… siguiente”"), "."),
      el("div",{class:"dict-mic"+(D.escuchando?" on":"")}, mic,
        el("div",{class:"dict-vivo"}, el("strong",null, D.escuchando ? "Te escucho" : !SR ? "Escribe tus productos" : D.pausaSola ? "En pausa (no te escuché). Toca el micrófono para seguir" : enCurso ? "En pausa. Toca el micrófono para seguir donde te quedaste" : "Toca el micrófono para empezar"),
          el("span",{class:"en-curso",id:"dictBuffer"}, D.buffer || (D.escuchando ? "Escuchando…" : "")), el("span",{class:"interino",id:"dictInterino"}, D.interino)),
        D.buffer.trim() ? el("button",{class:"btn",type:"button",onclick:()=>{ cerrarProductoActual(); pintarDict(); }},"Siguiente producto") : null));
    // Escribir (o usar el micrófono del teclado del celular): sirve en cualquier navegador.
    const ta = el("textarea",{rows:"2",placeholder: SR ? "O escríbelo aquí…" : "Escribe o usa el micrófono de tu teclado. Di “siguiente” entre productos…","aria-label":"Escribir producto"});
    const add = el("button",{class:"btn",type:"button",onclick:()=>{ const t = corregir(ta.value.trim(), vocabTienda()); if(!t) return; agregarTexto(t + " siguiente "); ta.value=""; pintarDict(); }},"Agregar");
    card.append(el("div",{style:"display:flex;gap:8px;align-items:end"}, el("label",{class:"f",style:"flex:1"},"Escribir", ta), add));
    const lista = el("div",{class:"dict-list",id:"dictLista"});
    D.items.forEach((t,i)=>{
      const tx = el("textarea",{rows:"2","aria-label":"Producto "+(i+1)}); tx.value = t;
      tx.onchange = ()=>{ D.items[i] = tx.value.trim(); guardarDict(); };
      lista.append(el("div",{class:"dict-item"}, el("span",{class:"n"}, String(i+1)), tx,
        el("button",{class:"btn",type:"button","aria-label":"Quitar producto "+(i+1),onclick:()=>{ D.items.splice(i,1); guardarDict(); pintarDict(); }},"✕")));
    });
    if(D.items.length) card.append(el("strong",null, D.items.length===1 ? "1 producto dictado" : `${D.items.length} productos dictados`), lista);
    const seguir = el("button",{class:"btn primary",type:"button",disabled:!!D.finalizando,onclick:async()=>{
      if(D.finalizando) return;
      D.finalizando = true; seguir.disabled = true;
      try {
      if(rec) await rec.finalizar();
      D.escuchando = false; D.interino = "";
      if(D.buffer.trim()) cerrarProductoActual();
      D.items = D.items.filter(Boolean);
      if(!D.items.length){ toast("Dicta o escribe al menos un producto"); return; }
      seguir.textContent = "Entendiendo…";
      D.datos = await entenderDictado(D.items);
      D.paso = "revisar";
      } catch(e) { toast(e.message || "No se pudo terminar el dictado. Intenta nuevamente."); }
      finally { D.finalizando = false; pintarDict(); }
    }}, "Continuar");
    card.append(el("div",{class:"send"}, seguir,
      D.items.length ? (()=>{ const b = el("button",{class:"btn",type:"button"},"Empezar de nuevo"); b.onclick = ()=>{ if(b.dataset.seguro){ D.items=[]; D.buffer=""; guardarDict(); pintarDict(); } else { b.dataset.seguro="1"; b.textContent="¿Borrar todo? Toca otra vez"; } }; return b; })() : null),
      el("p",{class:"note",style:"margin:0"},"Lo que dictas queda guardado en este celular aunque cierres la ventana."));
  }
  // Marcas frecuentes (respaldo sin IA), con lo que suele escribir el reconocimiento de voz.
  const MARCAS_VOZ = [[/\bcoach\b|\bcouch\b/i,"Coach"],[/\bgues+\b/i,"Guess"],[/\bmich?ael cors?\b|\bmaicol cors?\b|\bmichael kors\b/i,"Michael Kors"],[/\bnike\b|\bnaik\b/i,"Nike"],[/\badidas\b/i,"Adidas"],[/\bvictoria'?s secret\b/i,"Victoria's Secret"],[/\bbath (?:and|&|an) body works\b/i,"Bath & Body Works"],[/\btommy(?: hilfiger)?\b/i,"Tommy Hilfiger"],[/\bcalvin klein\b/i,"Calvin Klein"],[/\bralph lauren\b|\bpolo ralph\b/i,"Ralph Lauren"],[/\blevi'?s\b/i,"Levi's"],[/\bcarter'?s\b/i,"Carter's"],[/\bgap\b/i,"Gap"],[/\bzara\b/i,"Zara"],[/\bfossil\b/i,"Fossil"],[/\bpuma\b/i,"Puma"],[/\bunder armou?r\b/i,"Under Armour"],[/\bold navy\b/i,"Old Navy"],[/\bh ?& ?m\b/i,"H&M"],[/\bkate spade\b/i,"Kate Spade"],[/\bnew balance\b/i,"New Balance"],[/\bskechers\b/i,"Skechers"],[/\bcrocs\b/i,"Crocs"],[/\bdisney\b/i,"Disney"],[/\blego\b/i,"Lego"]];
  // Respaldo sin IA: saca precio, cantidad, talla y condición con reglas simples.
  function parsearLocal(t){
    const s = " " + t + " ", lo = s.toLowerCase(), r = { nombre:"" };
    const num = x => parseFloat(String(x).replace(",", "."));
    let m;
    if((m = lo.match(/(?:me cost[oó]|cost[oó]|la etiqueta dice|etiqueta de)\s*\$?\s*(\d+(?:[.,]\d+)?)/))) r.costo = num(m[1]);
    if((m = lo.match(/s\/\.?\s*(\d+(?:[.,]\d+)?)/) || lo.match(/(\d+(?:[.,]\d+)?)\s*(soles?|lucas)\b/))){ r.precio = num(m[1]); r.moneda = "PEN"; }
    else if((m = lo.match(/(?:a|en|precio)\s+(\d+(?:[.,]\d+)?)\s*(d[oó]lares|usd|bucks)\b/) || lo.match(/(\d+(?:[.,]\d+)?)\s*(d[oó]lares|usd|bucks)\b/))){ if(!r.costo || num(m[1])!==r.costo){ r.precio = num(m[1]); r.moneda = "USD"; } }
    else if((m = lo.match(/\$\s*(\d+(?:[.,]\d+)?)/))){ r.precio = num(m[1]); }
    if((m = lo.match(/(?:tengo|son|quedan|hay|me quedan)\s+(\d+)/) || lo.match(/(\d+)\s+(?:unidades|piezas|pares)/))) r.stock = parseInt(m[1],10);
    if((m = lo.match(/talla\s+([a-z0-9][a-z0-9.\/-]{0,7})/))) r.talla = m[1].toUpperCase();
    r.condicion = /con etiqueta/.test(lo) ? "nuevo_etiqueta" : /caja abierta/.test(lo) ? "caja_abierta" : /como nuev/.test(lo) ? "como_nuevo" : /usad/.test(lo) ? "usado" : /\bnuev[oa]s?\b/.test(lo) ? "nuevo" : "";
    const marca = MARCAS_VOZ.find(([re])=>re.test(t)); if(marca) r.marca = marca[1];
    // "marca Lumina": la palabra (o dos) que sigue a "marca", aunque no sea una marca conocida
    else if((m = t.match(/\bmarca\s+([A-Za-zÁÉÍÓÚÑáéíóúñ&'.]+(?:\s+(?!talla|nuev|usad|caja|con|de|a|en|precio|tengo|son|\d)[A-Za-zÁÉÍÓÚÑáéíóúñ&'.]+)?)/i))){ r.marca = m[1].replace(/\b\w/g, c=>c.toUpperCase()); r.marcaTexto = m[0]; }
    // Nombre: lo dictado sin marca, precio, cantidades, talla ni condición; solo la primera frase.
    let n = t.replace(/(?:me cost[oó]|cost[oó]|la etiqueta dice|etiqueta de)\s*\$?\s*\d+(?:[.,]\d+)?\s*(?:d[oó]lares|usd)?/gi," ")
      .replace(/s\/\.?\s*\d+(?:[.,]\d+)?|\$\s*\d+(?:[.,]\d+)?|\b(?:a|en|precio)?\s*\d+(?:[.,]\d+)?\s*(?:soles?|lucas|d[oó]lares|usd|bucks)\b/gi," ")
      .replace(/\b(?:tengo|son|quedan|hay|me quedan)\s+\d+\b|\b\d+\s+(?:unidades|piezas|pares)\b|\btalla\s+\S+/gi," ")
      .replace(/\b(nuev[oa]s?|usad[oa]s?|con etiqueta|caja abierta|como nuev[oa])\b/gi," ");
    if(marca) n = n.replace(marca[0], " ");
    if(r.marcaTexto){ n = n.replace(r.marcaTexto, " "); delete r.marcaTexto; }
    n = n.split(/[,.;]/).map(x=>x.replace(/\s+/g," ").trim()).find(Boolean) || "";
    r.nombre = (n.charAt(0).toUpperCase() + n.slice(1)).slice(0,80) || "Producto nuevo";
    return r;
  }
  async function entenderDictado(textos){
    const moneda = enSoles() ? "PEN" : "USD";
    const { resultados: ia, pendientes } = await interpretarPorLotes(textos,
      lote => interpretarDictado(lote, esUS() ? "en" : "es", moneda, rubroActual()));
    D.pendientesIA = pendientes;
    return textos.map((t, i)=>{
      const a = (Array.isArray(ia) && (ia.find(x=>x && Number(x.i)===i))) || {}, b = parsearLocal(t);
      // Tipo y marca: lo que dijo la IA o, si no respondió, lo que se reconoce en las palabras (vestido, Zara…)
      const tipo = categoriaDeTipo(a.tipo) ? a.tipo : tipoDeTexto(t, rubroActual());
      const d = { texto:t, tipo, nombre: a.nombre || b.nombre, marca: a.marca || b.marca || marcaDeTexto(t) || "", precio: a.precio ?? b.precio ?? null, moneda: a.moneda || b.moneda || null, costo: a.costo ?? b.costo ?? null,
        stock: a.stock ?? b.stock ?? null, talla: a.talla || b.talla || "", condicion: CLAVES_COND.includes(a.condicion) ? a.condicion : (b.condicion || ""), categoria: categoriaDeTipo(tipo) || (CATS.includes(a.categoria) ? a.categoria : ""), publico: PUBLICOS.includes(a.publico) ? a.publico : "", descripcion: a.descripcion || "" };
      // Si dijo el precio en otra moneda que la de la tienda, se convierte con el tipo de cambio.
      const tc = tipoCambio();
      if(d.precio!=null && d.moneda && d.moneda!==moneda && tc){ d.precio = moneda==="PEN" ? Math.round(d.precio*tc) : Math.round(d.precio/tc*100)/100; }
      return d;
    });
  }
  function pasoRevisar(card){
    card.append(el("p",{class:"note",style:"margin:0"},"Corrige lo que haga falta. En el siguiente paso eliges las fotos en el mismo orden en que dictaste."));
    if(D.pendientesIA?.length) card.append(el("p",{role:"alert",class:"note"},
      `La IA no pudo completar los productos ${D.pendientesIA.join(", ")}. Se usaron reglas básicas: revisa sus datos antes de continuar.`));
    const tabla = el("div",{class:"dict-tabla"});
    D.datos.forEach((d,i)=>{
      const inp = (k, label, extra={}) => { const x = el("input",{value: d[k]==null ? "" : String(d[k]), ...extra}); x.onchange = ()=>{ d[k] = extra.inputmode==="decimal" ? parsePrice(x.value) : extra.inputmode==="numeric" ? parseStock(x.value) : x.value.trim(); }; return el("label",{class:"f"},label,x); };
      const cond = el("select",null); opcionesCond("—").forEach(([k,l])=>cond.append(el("option",{value:k},l))); cond.value = d.condicion||""; cond.onchange = ()=>{ d.condicion = cond.value; };
      tabla.append(el("div",{class:"dict-fila"},
        el("strong",null, `${i+1}.`), el("span",{class:"orig"}, "“"+d.texto+"”"),
        el("div",{class:"dict-campos"}, inp("nombre","Nombre",{maxlength:"80"}),
          (()=>{ const s = el("select",{"aria-label":"Tipo"}); s.append(el("option",{value:""},"—")); tiposDe(rubroActual()).forEach(([t])=>s.append(el("option",{value:t},t))); s.value = d.tipo||""; s.onchange = ()=>{ d.tipo = s.value; d.categoria = categoriaDeTipo(s.value) || d.categoria; }; return el("label",{class:"f"},"Tipo",s); })(),
          inp("marca","Marca",{maxlength:"40",list:"marcaList"}), inp("precio",`Precio (${simbolo()})`,{inputmode:"decimal"}), inp("stock","Cantidad",{inputmode:"numeric",placeholder:"—"}), inp("talla","Talla",{maxlength:"12"}), el("label",{class:"f"},"Condición",cond))));
    });
    card.append(tabla, el("div",{class:"send"},
      el("button",{class:"btn primary",type:"button",onclick:()=>{ D.fotos = []; D.paso="fotos"; pintarDict(); }},"Elegir las fotos"),
      el("button",{class:"btn",type:"button",onclick:()=>{ D.paso="dictar"; pintarDict(); }},"Volver a dictar")));
  }
  function pasoFotos(card){
    const input = el("input",{type:"file",accept:"image/*",multiple:"",hidden:""});
    input.onchange = ()=>{
      // Orden en que se tomaron (hora de la foto); si es igual, por nombre del archivo.
      const files = [...input.files].filter(f=>f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name)).sort((a,b)=>(a.lastModified-b.lastModified) || a.name.localeCompare(b.name, undefined, {numeric:true}));
      D.fotos.forEach(f=>{ if(f && f.url) URL.revokeObjectURL(f.url); });
      D.fotos = files.map(f=>({ file:f, url:URL.createObjectURL(f) }));
      pintarDict();
    };
    const n = D.datos.length, m = D.fotos.length;
    card.append(el("p",{class:"note",style:"margin:0"}, `Elige las ${n} fotos de estos productos, en el mismo orden en que los dictaste. Las ordenamos por la hora en que las tomaste. Si alguna quedó en otro lugar, muévela con las flechas.`),
      el("div",{style:"display:flex;gap:8px;flex-wrap:wrap"}, el("button",{class:"btn primary",type:"button",onclick:()=>input.click()}, m ? "Elegir otras fotos" : `Elegir ${n} fotos`), input));
    if(m && m!==n) card.append(el("p",{class:"note",style:"margin:0;color:var(--hold);font-weight:600"}, m<n ? `Dictaste ${n} productos y elegiste ${m} ${m===1?"foto":"fotos"}: ${n-m===1 ? "1 producto quedará" : (n-m)+" productos quedarán"} sin foto. Revisa que cada foto esté junto a su producto.` : `Elegiste ${m} fotos para ${n} ${n===1?"producto":"productos"}: ${m-n===1 ? "la última no se usará" : "las "+(m-n)+" últimas no se usarán"}. Revisa que cada foto esté junto a su producto.`));
    const lista = el("div",{class:"rv-list"});
    const mover = (i, j)=>{ if(j<0 || j>=Math.max(n,m)) return; const a = D.fotos[i], b = D.fotos[j]; D.fotos[i]=b; D.fotos[j]=a; pintarDict(); };
    for(let i=0; i<Math.max(n, m); i++){
      const d = D.datos[i], f = D.fotos[i];
      lista.append(el("div",{class:"par-item"}, el("span",{class:"n"}, String(i+1)),
        f ? el("img",{src:f.url,alt:"Foto "+(i+1)}) : el("span",{class:"noimg"},"Sin foto"),
        el("span",{class:"t"}, d ? el("strong",null,d.nombre) : el("strong",{style:"color:var(--muted)"},"Foto de más (no se usará)"), d ? el("small",null,[d.marca, d.precio!=null ? money(d.precio) : "", condTxt(d.condicion)].filter(Boolean).join(" · ")) : null),
        el("span",{class:"mov"},
          el("button",{class:"btn",type:"button","aria-label":"Subir foto "+(i+1),disabled: i===0 ? "" : false,onclick:()=>mover(i,i-1)},"↑"),
          el("button",{class:"btn",type:"button","aria-label":"Bajar foto "+(i+1),disabled: i>=Math.max(n,m)-1 ? "" : false,onclick:()=>mover(i,i+1)},"↓"))));
    }
    if(m) card.append(lista);
    card.append(el("div",{class:"send"},
      el("button",{class:"btn primary",type:"button",disabled: m ? false : "",onclick:prepararVistaPrevia},"Ver vista previa"),
      el("button",{class:"btn",type:"button",onclick:()=>{ D.paso="revisar"; pintarDict(); }},"Volver")),
      el("p",{class:"note",style:"margin:0"},"Todavía no se publica nada: primero verás cómo quedan."));
  }
  let avanceDict = { hechos:0, total:0, texto:"" };
  function pasoSubiendo(card){
    const bar = el("div",{class:"meter"}), i = el("i"); i.style.width = (avanceDict.total ? avanceDict.hechos/avanceDict.total*100 : 0) + "%"; bar.append(i);
    card.append(el("p",{class:"note",style:"margin:0"}, avanceDict.texto || "Subiendo fotos…"), bar, el("span",{class:"note",style:"margin:0"}, `${avanceDict.hechos} de ${avanceDict.total}`));
  }
  async function prepararVistaPrevia(){
    const n = D.datos.length, modo = modoGuardado() || "mejorar";
    avanceDict = { hechos:0, total:n, texto:"Subiendo fotos y preparando tus productos (todavía ocultos)…" };
    D.paso = "subiendo"; pintarDict();
    const col = S.db.collection("productos"), base = Date.now(), ids = new Array(n), paraIA = [];
    let k = 0, fallos = 0;
    async function worker(){
      while(k < n){
        const i = k++, d = D.datos[i], f = D.fotos[i];
        try{
          let ph = null, blob = null;
          if(f){ ph = await processPhoto(f.file, modo); blob = ph.full; delete ph._blob; }
          const ref = col.doc();
          await ref.set({ nombre: d.nombre || "Producto nuevo", tipo: d.tipo || "", marca: d.marca || "", precio: d.precio, stock: d.stock, costo: d.costo, talla: d.talla || "", condicion: d.condicion || "", categoria: d.categoria || "", publico: d.publico || "", descripcion: d.descripcion || "", estado:"oculto", fotos: ph ? [ph] : [], creado: base + (n-i) });
          ids[i] = ref.id;
          if(ph && S.ai) paraIA.push({ id:ref.id, blob, name:false, tipo:!d.tipo, cat:!d.categoria, marca:!d.marca, cond:!d.condicion, desc:!d.descripcion, talla:!d.talla, pub:!d.publico, costo: d.costo==null, check: d.categoria || "" });
        }catch(e){ fallos++; console.warn("Detalle técnico:", e); }
        avanceDict.hechos++; if(D.paso==="subiendo") pintarDict();
      }
    }
    await Promise.all(Array.from({length:Math.min(4,n)}, worker));
    D.ids = ids.filter(Boolean); D.items = []; D.buffer = ""; guardarDict();
    S.noCoinciden = new Set();
    if(paraIA.length){ avanceDict.texto = "La IA está revisando las fotos…"; if(D.paso==="subiendo") pintarDict(); try{ await classify(paraIA); }catch(e){ console.warn("Detalle técnico:", e); } }
    D.alertas = [...S.noCoinciden]; S.noCoinciden = null;
    if(fallos) toast(`${fallos} producto(s) no se pudieron preparar. Revisa tu conexión.`);
    D.paso = "previa";
    if(dictAbierto()) pintarDict(); else { toast("Tu vista previa está lista"); abrirDictado(); }
  }
  function pasoPrevia(card){
    const prods = D.ids.map(id=>S.products.find(p=>p.id===id)).filter(Boolean);
    const pendientes = prods.filter(p=>p.estado==="oculto");
    if(!prods.length){ card.append(el("p",{class:"note",style:"margin:0"},"Cargando tus productos…")); setTimeout(()=>{ if(dictAbierto() && D.paso==="previa") pintarDict(); }, 800); return; }
    const alertas = new Set(D.alertas || []);
    card.append(el("p",{class:"note",style:"margin:0"}, "Así los verán tus clientes. Todavía están ", el("strong",null,"ocultos"), ": corrige lo que haga falta y toca Publicar."));
    if(prods.some(p=>alertas.has(p.id))) card.append(el("p",{class:"note",style:"margin:0;color:var(--hold);font-weight:600"},"⚠️ Revisa los marcados: la foto parece de otro tipo de producto que lo que dictaste. Cámbiala si no es la correcta."));
    const grid = el("div",{class:"prev-grid"});
    for(const p of prods){
      const cover = p.fotos && p.fotos[0], alerta = alertas.has(p.id);
      const nombre = el("input",{value:p.nombre||"","aria-label":"Nombre"});
      const precio = el("input",{value:p.precio==null?"":String(p.precio),inputmode:"decimal",placeholder:"Precio "+simbolo(),"aria-label":"Precio"});
      const cond = el("select",{"aria-label":"Condición"}); opcionesCond("Condición…").forEach(([k,l])=>cond.append(el("option",{value:k},l))); cond.value = p.condicion||"";
      const guardar = async patch=>{ try{ await S.db.doc("productos/"+p.id).update(patch); }catch(e){ toast("No se pudo guardar. Intenta de nuevo."); } };
      nombre.onchange = ()=>guardar({ nombre: nombre.value.trim() || "Producto nuevo" });
      precio.onchange = ()=>guardar({ precio: parsePrice(precio.value) });
      cond.onchange = ()=>guardar({ condicion: cond.value });
      const nueva = el("input",{type:"file",accept:"image/*",hidden:""});
      nueva.onchange = async ()=>{ const f = nueva.files[0]; if(!f) return; toast("Cambiando la foto…"); try{ const ph = await processPhoto(f, modoGuardado()||"mejorar"); delete ph._blob; await S.db.doc("productos/"+p.id).update({ fotos:[ph] }); deletePhotos(p.fotos||[]); D.alertas = (D.alertas||[]).filter(x=>x!==p.id); toast("Foto cambiada"); }catch(e){ toast("No se pudo cambiar la foto: " + errText(e)); } };
      grid.append(el("div",{class:"prev-card"+(alerta?" alerta":"")},
        el("div",{class:"ph"}, cover ? el("img",{src:src(cover.thumb||cover.full),alt:""}) : el("span",{class:"sinfoto"},"Sin foto: toca Cambiar foto"), el("span",{class:"price"+(p.precio==null?" none":"")}, p.precio==null ? "Consultar" : money(p.precio))),
        el("div",{class:"body"},
          alerta ? el("span",{class:"aviso"},"⚠️ ¿Esta foto es de este producto?") : null,
          p.marca ? el("span",{class:"marca-tag"},p.marca) : null,
          nombre, precio, cond,
          p.estado!=="oculto" ? el("span",{class:"conf-tag"},"Publicado") : null,
          el("div",{style:"display:flex;gap:6px;flex-wrap:wrap"},
            el("button",{class:"btn",type:"button",onclick:()=>nueva.click()}, cover ? "Cambiar foto" : "Poner foto"), nueva,
            el("button",{class:"btn danger",type:"button",onclick:async()=>{ try{ await S.db.doc("productos/"+p.id).delete(); deletePhotos(p.fotos||[]); D.ids = D.ids.filter(x=>x!==p.id); guardarDict(); pintarDict(); }catch(e){ toast("No se pudo quitar"); } }},"Quitar")))));
    }
    const publicar = el("button",{class:"btn primary",type:"button",disabled: pendientes.length ? false : ""}, pendientes.length ? `Publicar ${pendientes.length}` : "Todo publicado");
    publicar.onclick = async ()=>{
      const libres = usoPlan().libres, lista = pendientes.slice(0, libres===Infinity ? pendientes.length : libres);
      if(!lista.length){ toast("Llegaste al límite de tu plan"); abrirPlanes(); return; }
      publicar.disabled = true; publicar.textContent = "Publicando…";
      const fails = await runPool(lista.map(p=>p.id), id=>S.db.doc("productos/"+id).update({ estado:"disponible" }));
      const quedan = pendientes.length - lista.length + fails;
      toast(quedan ? `Publicados ${lista.length-fails}. ${quedan} siguen ocultos${lista.length<pendientes.length ? " porque superan tu plan" : ""}.` : `¡Listo! ${lista.length} producto(s) publicados`);
      if(!quedan){ D.ids = []; D.alertas = []; guardarDict(); cerrarDictado(); } else pintarDict();
    };
    card.append(grid, el("div",{class:"send"}, publicar, el("button",{class:"btn",type:"button",onclick:cerrarDictado},"Publicar después")),
      el("p",{class:"note",style:"margin:0"},"Si publicas después, los encuentras ocultos en tu tienda; vuelve aquí con “Dictar productos”."));
  }

  // ----- Tiendas de confianza -----
  // Una vendedora comparte productos con sus tiendas de confianza; la otra los agrega a su tienda (copias)
  // y los vende como suyos. La foto y la cantidad salen del original; el precio lo pone la revendedora.
  const esCopia = p => !!(p && p.origenId);
  const infoCopia = p => (S.conf && S.conf.copias && S.conf.copias[p.id]) || null;
  const sumaPend = l => (l||[]).filter(r=>r.estado==="debe").reduce((t,r)=>t+(Number(r.monto)||0),0);
  // Separados: lo que una revendedora guardó para su clienta y todavía no confirma como venta.
  const separadosMios = () => S.conf ? S.conf.meDeben.filter(r=>r.estado==="separado") : [];   // de mis productos
  const misSeparados = () => S.conf ? S.conf.debo.filter(r=>r.estado==="separado") : [];       // los que separé yo
  const vencido = r => r.hasta && r.hasta < Date.now();
  const fechaCorta = ms => new Date(ms).toLocaleDateString("es-PE",{ day:"numeric", month:"short" });
  let avisoWa = null;   // tras separar: enlace para avisar a la dueña por WhatsApp
  // Precio para revendedoras: en soles se redondea al sol; en dólares, a centavos.
  const redondeoRev = n => enSoles() ? Math.max(1, Math.round(n)) : Math.max(0.5, Math.round(n*100)/100);
  function etiquetaConf(p){
    if(esCopia(p)){
      const i = infoCopia(p), sep = misSeparados().filter(r=>r.copiaId===p.id);
      if(sep.length) return el("span",{class:"conf-tag"+(sep.some(vencido)?" off":"")}, `Separado (${sep.reduce((t,r)=>t+(r.q||1),0)})` + (sep.some(vencido) ? " · vencido" : ""));
      if(i && !i.disponible) return el("span",{class:"conf-tag off"},"Ya no disponible");
      return el("span",{class:"conf-tag"}, i ? "De " + i.tiendaNombre : "De confianza");
    }
    const sep = separadosMios().filter(r=>r.productoId===p.id);
    if(sep.length) return el("span",{class:"conf-tag"+(sep.some(vencido)?" off":"")}, `Separado por ${sep[0].tiendaNombre}` + (sep.length>1 ? ` y ${sep.length-1} más` : "") + (sep.some(vencido) ? " · vencido" : ""));
    return p.compartido ? el("span",{class:"conf-tag"},"Compartido") : null;
  }
  function msgConf(e){
    const m = String((e && e.message) || "");
    return !m || m.length > 160 || /lambda|exception|unauthor|timeout|network|graphql|dynamo/i.test(m) ? "No se pudo completar. Revisa tu conexión e intenta de nuevo." : m;
  }
  async function cargarConfianza(){
    try{ S.conf = await confianza("listar"); }catch(e){ console.warn("Detalle técnico:", e); return; }
    pintarConfBox(); render(); if(openId) drawSheet();
    if(confAbierto()) pintarConfianza();
  }
  async function accionConf(btn, accion, datos, ok){
    if(btn) btn.disabled = true;
    try{
      const r = await confianza(accion, datos);
      if(ok) toast(typeof ok==="function" ? ok(r) : ok);
      await cargarConfianza();
      return r || {};
    }catch(e){ console.warn("Detalle técnico:", e); toast(msgConf(e)); return null; }
    finally{ if(btn) btn.disabled = false; }
  }
  function pintarConfBox(){
    if(!S.canEdit || !$("panel").hidden){ show("confBox", false); return; }
    show("confBox", true);
    const c = S.conf; let txt = "Comparte productos con vendedoras de confianza y revende los suyos como tuyos.";
    let urgente = false;
    if(c){
      const act = c.relaciones.filter(r=>r.estado==="aceptada").length, inv = c.relaciones.filter(r=>r.estado==="pendiente" && !r.invitaYo).length;
      const nuevos = c.compartidos.filter(x=>!x.yaAgregado).length, meDeben = sumaPend(c.meDeben), debo = sumaPend(c.debo);
      const partes = [];
      if(inv){ partes.push(inv===1 ? "Tienes 1 invitación por responder" : `Tienes ${inv} invitaciones por responder`); urgente = true; }
      if(act) partes.push(act===1 ? "1 tienda de confianza" : `${act} tiendas de confianza`);
      if(nuevos) partes.push(nuevos===1 ? "1 producto para revender" : `${nuevos} productos para revender`);
      const sep = separadosMios(), venc = sep.filter(vencido).length + misSeparados().filter(vencido).length;
      if(sep.length) partes.push(sep.length===1 ? `${sep[0].tiendaNombre} separó 1 de tus productos` : `${sep.length} de tus productos están separados`);
      if(venc){ partes.push(venc===1 ? "1 separado vencido" : `${venc} separados vencidos`); urgente = true; }
      if(meDeben) partes.push(`te deben ${money(meDeben)}`);
      if(debo) partes.push(`debes ${money(debo)}`);
      if(partes.length) txt = partes.join(" · ");
    }
    $("confText").textContent = txt;
    { const inv = c ? c.relaciones.filter(r=>r.estado==="pendiente" && !r.invitaYo).length : 0, venc = c ? separadosMios().filter(vencido).length + misSeparados().filter(vencido).length : 0; marcarTab("confianza", inv + venc, urgente); }
    $("confBtn").className = "btn" + (urgente ? " tag" : "");
    const hayInv = !!(c && c.relaciones.some(r=>r.estado==="pendiente" && !r.invitaYo));
    const nuevosRev = c ? c.compartidos.filter(x=>!x.yaAgregado).length : 0;
    // El botón dice qué va a pasar (antes decía solo "Abrir" y no se entendía que ahí estaban los productos).
    $("confBtn").textContent = hayInv ? "Ver invitación" : urgente ? "Revisar" : nuevosRev ? `Ver ${nuevosRev} para revender` : (c && c.relaciones.some(r=>r.estado==="aceptada")) ? "Ver mis tiendas" : "Invitar tiendas";
    if(nuevosRev && !hayInv && !urgente) $("confBtn").className = "btn primary";
    $("confBtn").onclick = ()=>abrirConfianza(hayInv ? "tiendas" : urgente ? "cuentas" : nuevosRev ? "revender" : "tiendas");
    pintarAvisoCompartidos();
  }
  // En Productos: aviso con las fotos de lo que te compartieron y un botón para agregarlos.
  function pintarAvisoCompartidos(){
    const box = $("compAviso"); if(!box) return;
    const c = S.conf, lista = c && S.canEdit ? c.compartidos.filter(x=>!x.yaAgregado) : [];
    let oculto = ""; try{ oculto = localStorage.getItem("vitrina-comp-visto-"+(S.config&&S.config.id||"")) || ""; }catch(e){}
    const firma = lista.map(x=>x.id).sort().join(",");
    box.textContent = ""; box.hidden = !lista.length || firma === oculto;
    if(box.hidden) return;
    const tiendas = [...new Set(lista.map(x=>x.tiendaNombre).filter(Boolean))];
    const quien = tiendas.length===1 ? tiendas[0] : `${tiendas.length} tiendas de confianza`;
    const fotos = el("div",{class:"comp-fotos"}, ...lista.slice(0,4).map(x=>{ const f = x.fotosThumb && x.fotosThumb[0]; return f ? el("img",{src:src(f),alt:"",loading:"lazy"}) : el("span",{class:"noimg"}); }), lista.length>4 ? el("span",{class:"comp-mas"},"+"+(lista.length-4)) : null);
    box.append(el("div",{class:"comp-txt"}, el("strong",null, `🤝 ${quien} ${tiendas.length===1?"te compartió":"te compartieron"} ${lista.length===1?"1 producto":lista.length+" productos"}`),
        el("span",null,"Puedes venderlos en tu tienda como tuyos, con tu precio. Elige cuáles quieres.")),
      fotos,
      el("div",{class:"comp-botones"},
        el("button",{class:"btn primary",type:"button",onclick:()=>abrirConfianza("revender")},"Ver y agregar a mi tienda"),
        el("button",{class:"btn",type:"button",onclick:()=>{ try{ localStorage.setItem("vitrina-comp-visto-"+(S.config&&S.config.id||""), firma); }catch(e){} box.hidden = true; }},"Ahora no")));
  }
  let confTab = "tiendas";
  const confAbierto = () => !$("planOverlay").hidden && $("planOverlay").dataset.conf === "1";
  function abrirConfianza(tab){
    if(tab) confTab = tab;
    const ov=$("planOverlay"); ov.hidden=false; ov.dataset.conf="1";
    ov.onclick = e=>{ if(e.target===ov) cerrarConfianza(); };
    pintarConfianza();
    if(!S.conf) cargarConfianza();
  }
  function cerrarConfianza(){ const ov=$("planOverlay"); ov.hidden=true; ov.textContent=""; delete ov.dataset.conf; }
  function pintarConfianza(){
    const ov=$("planOverlay"), c = S.conf; ov.textContent="";
    const card = el("div",{class:"cart",role:"dialog","aria-modal":"true","aria-label":"Tiendas de confianza",style:"width:min(680px,100%)"},
      el("div",{class:"cart-head"}, el("h2",null,"Tiendas de confianza"), el("button",{class:"btn",type:"button",onclick:cerrarConfianza},"Cerrar")));
    const pend = c ? c.relaciones.filter(r=>r.estado==="pendiente" && !r.invitaYo).length : 0;
    const nuevos = c ? c.compartidos.filter(x=>!x.yaAgregado).length : 0;
    const tabs = el("div",{class:"conf-tabs"});
    [["tiendas","Tiendas",pend],["revender","Para revender",nuevos],["cuentas","Cuentas",0]].forEach(([k,l,n])=>
      tabs.append(el("button",{class:"chip",type:"button","aria-pressed":String(confTab===k),onclick:()=>{ confTab=k; pintarConfianza(); }}, l, n ? el("span",{class:"cn"}," "+n) : null)));
    card.append(tabs);
    if(!c){ card.append(el("p",{class:"note",style:"margin:0"},"Cargando…")); ov.append(card); return; }
    const sec = el("div",{class:"conf-sec"});
    if(confTab==="tiendas") tabTiendas(sec, c); else if(confTab==="revender") tabRevender(sec, c); else tabCuentas(sec, c);
    card.append(sec); ov.append(card);
  }
  function tabTiendas(sec, c){
    // Buscar la tienda por su nombre o su código (también se puede pegar el enlace completo).
    const inp = el("input",{type:"search",placeholder:"Nombre o código de su tienda",autocapitalize:"off",spellcheck:"false","aria-label":"Buscar la tienda que quieres invitar",class:"conf-buscar"});
    const res = el("div",{class:"conf-resultados","aria-live":"polite"});
    let reloj = null, ultima = "";
    const invitar = (slug, btn)=>accionConf(btn,"invitar",{slug}, r=>r && r.estado==="aceptada" ? "¡Listo! Ya son tiendas de confianza" : "Invitación enviada. Le avisamos por correo.");
    const buscar = async ()=>{
      const q = inp.value.trim(); ultima = q; res.textContent = "";
      if(q.length < 2) return;
      // Enlace pegado: se invita directo, sin buscar.
      if(/showroomcito\.com|[?&]tienda=/i.test(q)){ const b = el("button",{class:"btn primary",type:"button"},"Invitar esta tienda"); b.onclick = ()=>invitar(q, b); res.append(el("div",{class:"conf-tienda"}, el("span",null,"Enlace pegado"), b)); return; }
      res.append(el("p",{class:"note",style:"margin:0"},"Buscando…"));
      try{
        const r = await confianza("buscar",{q}); if(ultima !== q) return;
        res.textContent = "";
        const lista = (r && r.tiendas) || [];
        if(!lista.length){ res.append(el("p",{class:"note",style:"margin:0"},`No encontramos tiendas con "${q}". Pídele el código de su tienda: es lo que va al final de su enlace (por ejemplo, maria-importados).`)); return; }
        for(const t of lista){
          const ya = c.relaciones.find(x=>x.tienda===t.slug);
          const b = el("button",{class:"btn primary",type:"button",disabled:!!ya}, ya ? (ya.estado==="aceptada" ? "Ya conectadas" : ya.invitaYo ? "Invitación enviada" : "Te invitó: acepta abajo") : "Invitar");
          b.onclick = ()=>invitar(t.slug, b);
          res.append(el("div",{class:"conf-tienda"},
            t.portada ? el("img",{src:src(t.portada),alt:""}) : el("span",{class:"conf-tienda-ini","aria-hidden":"true"}, String(t.nombre||"?").charAt(0).toUpperCase()),
            el("div",null, el("strong",null,t.nombre), el("span",{class:"note",style:"margin:0"}, "Código: "+t.slug)), b));
        }
      }catch(e){ if(ultima===q){ res.textContent=""; res.append(el("p",{class:"note",style:"margin:0"}, msgConf(e))); } }
    };
    inp.oninput = ()=>{ clearTimeout(reloj); reloj = setTimeout(buscar, 400); };
    inp.onkeydown = e=>{ if(e.key==="Enter"){ e.preventDefault(); clearTimeout(reloj); buscar(); } };
    sec.append(
      el("p",{class:"note",style:"margin:0"},"Conéctate con vendedoras en quienes confías. Cada una elige qué productos comparte, y la otra los puede vender en su tienda como suyos, con su propio precio. Sus clientes nunca ven de qué tienda vienen."),
      el("strong",null,"Invitar a una tienda"),
      inp, res,
      el("span",{class:"note",style:"margin:0"},`Escribe el nombre de su tienda o su código. El código de tu tienda es ${S.config&&S.config.id||""}: compártelo para que te encuentren. Solo entre tiendas que usan la misma moneda.`));
    if(!c.relaciones.length) sec.append(el("p",{class:"note",style:"margin:0"},"Todavía no tienes tiendas de confianza."));
    const grupos = [["Te invitaron", r=>r.estado==="pendiente" && !r.invitaYo],["Tus tiendas de confianza", r=>r.estado==="aceptada"],["Invitaciones que enviaste", r=>r.estado==="pendiente" && r.invitaYo]];
    for(const [titulo, f] of grupos){
      const lista = c.relaciones.filter(f); if(!lista.length) continue;
      sec.append(el("strong",null,titulo));
      for(const r of lista){
        const acts = el("div",{style:"display:flex;gap:6px;flex-wrap:wrap;align-items:center"});
        if(r.estado==="pendiente" && !r.invitaYo){
          const a = el("button",{class:"btn primary",type:"button"},"Aceptar"); a.onclick = ()=>accionConf(a,"aceptar",{slug:r.tienda},"¡Listo! Ya son tiendas de confianza");
          const n = el("button",{class:"btn",type:"button"},"Rechazar"); n.onclick = ()=>accionConf(n,"cortar",{slug:r.tienda},"Invitación rechazada");
          acts.append(a, n);
        } else if(r.estado==="pendiente"){
          const n = el("button",{class:"btn",type:"button"},"Cancelar invitación"); n.onclick = ()=>accionConf(n,"cortar",{slug:r.tienda},"Invitación cancelada");
          acts.append(el("span",{class:"note",style:"margin:0"},"Esperando que acepte"), n);
        } else {
          const si = el("button",{class:"btn danger",type:"button"},"Sí, dejar");
          const conf = el("span",{class:"confirm",hidden:""},"Se quitarán de las dos tiendas los productos que revenden de la otra. ¿Seguir?", si, el("button",{class:"btn",type:"button",onclick:()=>{ conf.hidden=true; }},"No"));
          si.onclick = async ()=>{ const res = await accionConf(si,"cortar",{slug:r.tienda},"Ya no son tiendas de confianza"); if(res) refrescarProductos(); };
          acts.append(el("button",{class:"btn",type:"button",onclick:()=>{ conf.hidden=false; }},"Dejar de ser de confianza"), conf);
        }
        sec.append(el("div",{class:"conf-row"}, el("div",{class:"who"}, el("strong",null,r.nombre||r.tienda), el("small",null,"?tienda="+r.tienda)), acts));
      }
    }
    sec.append(el("p",{class:"note",style:"margin:0"}, c.compartidosPorMi ? `Compartes ${c.compartidosPorMi} producto(s). ` : "Todavía no compartes productos. ", "Para compartir: toca ", el("strong",null,"Editar varios"), ", marca los productos y toca ", el("strong",null,"Compartir"), "."));
  }
  function tabRevender(sec, c){
    if(!c.relaciones.some(r=>r.estado==="aceptada")){ sec.append(el("p",{class:"note",style:"margin:0"},"Primero conéctate con una tienda de confianza en la pestaña Tiendas.")); return; }
    const lista = c.compartidos;
    if(!lista.length){ sec.append(el("p",{class:"note",style:"margin:0"},"Tus tiendas de confianza todavía no comparten productos. Cuando lo hagan, aparecerán aquí.")); return; }
    const elegidos = new Set(), cajas = [];
    const listEl = el("div",{class:"rv-list"});
    for(const x of lista){
      const ya = !!x.yaAgregado;
      const cb = el("input",{type:"checkbox","aria-label":"Elegir "+x.nombre, disabled: ya ? "" : false});
      cb.onchange = ()=>{ cb.checked ? elegidos.add(x.id) : elegidos.delete(x.id); pie(); };
      if(!ya) cajas.push([x, cb]);
      const foto = x.fotosThumb && x.fotosThumb[0];
      const extra = [x.tiendaNombre, typeof x.stock==="number" ? `${x.stock} disponibles` : "", x.estado==="apartado" ? "apartado" : "", ya ? "ya está en tu tienda" : ""].filter(Boolean).join(" · ");
      listEl.append(el("label",{class:"rv-item"+(ya?" ya":"")}, cb,
        foto ? el("img",{src:src(foto),alt:"",loading:"lazy"}) : el("span",{class:"noimg"}),
        el("span",{class:"t"}, el("strong",null,x.nombre||"Producto"),
          el("small",null,[x.marca, x.talla ? "Talla "+x.talla : "", condTxt(x.condicion)].filter(Boolean).join(" · ") || " "),
          el("span",null, x.precioReventa!=null ? `Te cuesta ${money(x.precioReventa)}` : "Precio a consultar", el("small",null," · "+extra)))));
    }
    const margen = el("input",{inputmode:"decimal",value:"25",style:"width:80px","aria-label":"Tu ganancia en porcentaje"});
    const ej = el("span",{class:"note",style:"margin:0"});
    const add = el("button",{class:"btn primary",type:"button"},"Agregar a mi tienda");
    const todos = el("button",{class:"btn",type:"button"},"Elegir todos");
    todos.onclick = ()=>{ const marcar = cajas.some(([,cb])=>!cb.checked); cajas.forEach(([x,cb])=>{ cb.checked = marcar; marcar ? elegidos.add(x.id) : elegidos.delete(x.id); }); pie(); };
    function pie(){
      add.textContent = elegidos.size ? `Agregar ${elegidos.size} a mi tienda` : "Agregar a mi tienda"; add.disabled = !elegidos.size;
      todos.textContent = cajas.length && cajas.every(([,cb])=>cb.checked) ? "Quitar todos" : "Elegir todos"; todos.hidden = !cajas.length;
      const m = parseMargen(margen.value) ?? 0, x = lista.find(y=>elegidos.has(y.id) && y.precioReventa!=null) || lista.find(y=>y.precioReventa!=null);
      ej.textContent = x ? `Ej.: te cuesta ${money(x.precioReventa)} y lo vendes a ${money(Math.max(1, Math.ceil(x.precioReventa*(1+m/100))))}. Luego puedes cambiar cada precio.` : "";
    }
    margen.oninput = pie;
    add.onclick = async ()=>{
      const libres = usoPlan().libres;
      if(elegidos.size > libres){ toast(libres>0 ? `Tu plan permite ${libres} producto(s) más` : "Llegaste al límite de tu plan"); if(libres<=0) abrirPlanes(); return; }
      const r = await accionConf(add,"agregar",{ ids:[...elegidos], margen: parseMargen(margen.value) ?? 0 }, r=>r && r.creados ? `${r.creados} producto(s) agregados a tu tienda` : "No se agregó ninguno: ya no están disponibles");
      if(r) refrescarProductos();
    };
    sec.append(el("ol",{class:"rv-pasos"},
        el("li",null, el("b",null,"Marca"), " los productos que quieres vender."),
        el("li",null, "Pon ", el("b",null,"tu ganancia"), " (se suma a lo que te cuesta)."),
        el("li",null, "Toca ", el("b",null,"Agregar a mi tienda"), ". Aparecen en tus Productos con la etiqueta \"De …\" y tus clientes los ven como tuyos.")),
      el("p",{class:"note",style:"margin:0"},"Cuando vendas uno, le pagas a la otra tienda lo que te cuesta (lo ves en Cuentas)."),
      listEl,
      el("div",{class:"rv-foot"}, el("label",{class:"f"},"Tu ganancia %", margen), el("div",{style:"flex:1;min-width:160px"}, ej), todos, add));
    pie();
  }
  function tabCuentas(sec, c){
    sec.append(el("div",{class:"sumas"},
      el("div",null, el("small",null,"Te deben"), el("b",null, money(sumaPend(c.meDeben))), el("small",null,"Por tus productos que vendieron otras tiendas")),
      el("div",null, el("small",null,"Debes"), el("b",null, money(sumaPend(c.debo))), el("small",null,"Por productos de otras tiendas que vendiste"))));
    const VIA = { tarjeta:"pagó con tarjeta", yape:"pagó con Yape", manual:"venta registrada a mano" };
    // Separados: arriba de todo, porque bloquean unidades hasta que se confirmen o se liberen.
    const filaSep = (r, mia) => {
      const acts = el("div",{style:"display:flex;gap:6px;align-items:center;flex-wrap:wrap"},
        el("span",{class:"pill "+(vencido(r)?"cancelado":"por_confirmar")}, vencido(r) ? "Vencido" : "Separado"));
      if(!mia){
        const v = el("button",{class:"btn primary",type:"button"},"Se vendió"); v.onclick = ()=>accionConf(v,"confirmar",{ reventaId:r.id }, x=>`Venta confirmada. Le debes ${money(Number(x && x.monto)||0)} a ${r.tiendaNombre}.`);
        const l = el("button",{class:"btn",type:"button"},"Liberar"); l.onclick = ()=>accionConf(l,"liberar",{ reventaId:r.id },"Liberado: vuelve a estar disponible");
        acts.append(v, l);
      } else if(vencido(r)){
        const l = el("button",{class:"btn",type:"button"},"Liberar"); l.onclick = ()=>accionConf(l,"liberar",{ reventaId:r.id },"Liberado: vuelve a estar disponible");
        acts.append(l);
      }
      return el("div",{class:"conf-row"},
        el("div",{class:"who"}, el("strong",null,`${r.nombre||"Producto"}${r.q>1?" × "+r.q:""}`),
          el("small",null,[mia ? `Lo separó ${r.tiendaNombre}` : `De ${r.tiendaNombre}`, r.cliente ? "para "+r.cliente : "", r.hasta ? (vencido(r) ? "venció el " : "hasta el ") + fechaCorta(r.hasta) : ""].filter(Boolean).join(" · "))),
        el("strong",{style:"font-family:var(--mono);font-variant-numeric:tabular-nums"}, money(Number(r.monto)||0)), acts);
    };
    const sepMios = separadosMios(), misSep = misSeparados();
    if(sepMios.length){ sec.append(el("strong",null,"Separaron de tus productos"), el("span",{class:"note",style:"margin:0"},`Nadie más los puede vender mientras estén separados. Si vence el plazo (${c.diasSeparado||7} días, lo cambias en Datos de la tienda), puedes liberarlos.`)); sepMios.forEach(r=>sec.append(filaSep(r, true))); }
    if(misSep.length){ sec.append(el("strong",null,"Tus separados"), el("span",{class:"note",style:"margin:0"},"Cuando tu clienta pague, toca “Se vendió”. Si no compra, toca “Liberar”.")); misSep.forEach(r=>sec.append(filaSep(r, false))); }
    const fila = (r, mia) => {
      const acts = el("div",{style:"display:flex;gap:6px;align-items:center;flex-wrap:wrap"},
        el("span",{class:"pill "+(r.estado==="pagado"?"pagado":"pendiente")}, r.estado==="pagado" ? "Pagado" : "Por pagar"));
      if(mia){
        const b = el("button",{class:"btn"+(r.estado==="pagado"?"":" primary"),type:"button"}, r.estado==="pagado" ? "Deshacer" : "Ya me pagó");
        b.onclick = ()=>accionConf(b,"saldar",{ reventaId:r.id, estado: r.estado==="pagado" ? "debe" : "pagado" }, r.estado==="pagado" ? "Marcado como pendiente" : "Marcado como pagado");
        acts.append(b);
      }
      return el("div",{class:"conf-row"},
        el("div",{class:"who"}, el("strong",null,`${r.nombre||"Producto"}${r.q>1?" × "+r.q:""}`),
          el("small",null,[mia ? `Lo vendió ${r.tiendaNombre}` : `De ${r.tiendaNombre}`, r.creado ? new Date(r.creado).toLocaleDateString("es-PE") : "", VIA[r.via]||""].filter(Boolean).join(" · "))),
        el("strong",{style:"font-family:var(--mono);font-variant-numeric:tabular-nums"}, money(Number(r.monto)||0)), acts);
    };
    const cerradas = r => r.estado==="debe" || r.estado==="pagado";
    c = { ...c, meDeben: c.meDeben.filter(cerradas), debo: c.debo.filter(cerradas) };
    if(c.meDeben.length){ sec.append(el("strong",null,"Te deben"), el("span",{class:"note",style:"margin:0"},"Coordina la entrega del producto con la otra tienda. Cuando te pague, toca “Ya me pagó”.")); c.meDeben.forEach(r=>sec.append(fila(r, true))); }
    if(c.debo.length){ sec.append(el("strong",null,"Debes")); c.debo.forEach(r=>sec.append(fila(r, false))); }
    if(!c.meDeben.length && !c.debo.length && !sepMios.length && !misSep.length) sec.append(el("p",{class:"note",style:"margin:0"},"Aquí verás lo que te deben y lo que debes por los productos que se revenden. Por ahora no hay ventas."));
  }
  // Compartir varios productos a la vez (desde "Editar varios")
  function abrirCompartir(ids){
    const propios = ids.map(id=>S.products.find(x=>x.id===id)).filter(p=>p && !esCopia(p));
    if(!propios.length){ toast("Solo puedes compartir tus propios productos"); return; }
    const ov=$("planOverlay"); ov.textContent=""; ov.hidden=false; delete ov.dataset.conf;
    const cerrar = ()=>{ ov.hidden=true; ov.textContent=""; };
    ov.onclick = e=>{ if(e.target===ov) cerrar(); };
    // Sin tiendas de confianza todavía: primero hay que invitar a una (antes se compartía igual y el aviso llegaba después).
    if(S.conf && !S.conf.relaciones.some(r=>r.estado==="aceptada")){
      ov.append(el("div",{class:"cart",role:"dialog","aria-modal":"true","aria-label":"Compartir con tiendas de confianza"},
        el("div",{class:"cart-head"}, el("h2",null,"Primero invita a una tienda"), el("button",{class:"btn",type:"button",onclick:cerrar},"Cerrar")),
        el("p",{style:"margin:0"}, "Compartir sirve para que otras vendedoras de confianza revendan tus productos. Todavía no tienes ninguna conectada."),
        el("button",{class:"btn primary",type:"button",onclick:()=>{ cerrar(); abrirConfianza("tiendas"); }},"Buscar e invitar una tienda")));
      return;
    }
    const desc = el("input",{inputmode:"decimal",value:"15",style:"width:80px","aria-label":"Descuento para revendedoras en porcentaje"});
    const ej = el("span",{class:"note",style:"margin:0"});
    const conPrecio = propios.filter(p=>p.precio!=null);
    const pinta = ()=>{ const d = parseMargen(desc.value) ?? 0, x = conPrecio[0]; ej.textContent = x ? `Ej.: "${x.nombre}" lo vendes a ${money(x.precio)}; tus tiendas de confianza te pagan ${money(redondeoRev(x.precio*(1-Math.min(90,d)/100)))} por unidad.` : ""; };
    desc.oninput = pinta;
    const ok = el("button",{class:"btn primary",type:"button"}, `Compartir ${conPrecio.length}`);
    ok.disabled = !conPrecio.length;
    ok.onclick = async ()=>{
      const d = Math.min(90, parseMargen(desc.value) ?? 0); ok.disabled = true;
      const fails = await runPool(conPrecio.map(p=>p.id), id=>{ const p=S.products.find(x=>x.id===id); return S.db.doc("productos/"+id).update({ compartido:true, precioReventa: redondeoRev(p.precio*(1-d/100)) }); });
      cerrar();
      toast(fails ? `${conPrecio.length-fails} compartidos; ${fails} fallaron` : `${conPrecio.length} producto(s) compartidos con tus tiendas de confianza`);
      if(conPrecio.length-fails > 0) confianza("avisar",{ n: conPrecio.length-fails }).catch(e=>console.warn("Aviso por correo", e));
      if(S.conf && !S.conf.relaciones.some(r=>r.estado==="aceptada")) setTimeout(()=>toast("Aún no tienes tiendas de confianza: invítalas en Tiendas de confianza"), 3000);
    };
    ov.append(el("div",{class:"cart",role:"dialog","aria-modal":"true","aria-label":"Compartir productos"},
      el("div",{class:"cart-head"}, el("h2",null,"Compartir con tiendas de confianza"), el("button",{class:"btn",type:"button",onclick:cerrar},"Cerrar")),
      el("p",{class:"note",style:"margin:0"},"Tus tiendas de confianza podrán agregarlos a su tienda y venderlos con su propio precio. Cuando vendan uno, te pagan el precio para revendedoras."),
      el("label",{class:"f"},"Precio para revendedoras: % menos que tu precio", desc), ej,
      propios.length > conPrecio.length ? el("span",{class:"note",style:"margin:0;color:var(--hold)"}, `${propios.length-conPrecio.length} producto(s) sin precio no se compartirán. Ponles precio primero.`) : null,
      el("div",{class:"send"}, ok, el("button",{class:"btn",type:"button",onclick:cerrar},"Cancelar"))));
    pinta();
  }
  // Ficha de un producto de confianza (vista de la revendedora)
  function fichaCopia(p, side, keep){
    const v = (id,def)=> keep[id]!==undefined ? keep[id] : def;
    const i = infoCopia(p), off = !!(i && !i.disponible);
    side.append(
      el("div",{class:"conf-box"+(off?" off":"")},
        el("strong",null, i ? `Producto de ${i.tiendaNombre}` : "Producto de una tienda de confianza"),
        el("span",{class:"note",style:"margin:0"}, off ? "Ya no está disponible: la otra tienda lo vendió, lo ocultó o dejó de compartirlo. Tus clientes ya no lo ven." : "Tus clientes lo ven como tuyo. La foto y la cantidad las maneja la otra tienda."),
        i && i.precioReventa!=null ? el("span",null, `Te cuesta ${money(i.precioReventa)}`, p.precio!=null ? ` · ganas ${money(p.precio - i.precioReventa)} por unidad` : "") : null,
        i && typeof i.stock==="number" ? el("span",null, `${i.stock} disponible(s)`) : null),
      el("label",{class:"f"},"Nombre", el("input",{id:"eName",value:v("eName",p.nombre||""),maxlength:"120"})),
      el("div",{class:"row2"},
        el("label",{class:"f"},`Tu precio (${simbolo()})`, el("input",{id:"ePrice",inputmode:"decimal",value:v("ePrice",p.precio==null?"":String(p.precio)),placeholder:"Consultar"})),
        el("label",{class:"f"},"Estado", (()=>{ const sel=el("select",{id:"eStatus"}); [["disponible","Disponible"],["oculto","Oculto (no se muestra en tu tienda)"]].forEach(([k,l])=>sel.append(el("option",{value:k},l))); sel.value=v("eStatus",p.estado==="oculto"?"oculto":"disponible"); return sel; })())),
      (()=>{ const ta=el("textarea",{id:"eDesc",rows:"3"}); ta.value=v("eDesc",p.descripcion||""); return el("label",{class:"f"},"Descripción", ta); })());
    const q = el("input",{id:"eVentaQ",inputmode:"numeric",value:v("eVentaQ","1"),style:"width:72px"});
    const vb = el("button",{class:"btn primary",type:"button",disabled: off ? "" : false},"Registrar venta");
    vb.onclick = async ()=>{
      const n = parseStock(q.value) || 1;
      const r = await accionConf(vb,"vendi",{ copiaId:p.id, q:n }, r=>`Venta registrada. Le debes ${money(Number(r && r.monto)||0)} a ${i ? i.tiendaNombre : "la otra tienda"}.`);
      if(r) closeSheet();
    };
    const quien = el("input",{id:"eSepPara",maxlength:"60",value:v("eSepPara",""),placeholder:"Opcional"});
    const sb = el("button",{class:"btn",type:"button",disabled: off ? "" : false},"Separar");
    sb.onclick = async ()=>{
      const n = parseStock(q.value) || 1;
      const r = await accionConf(sb,"separar",{ copiaId:p.id, q:n, cliente:quien.value.trim() }, r=>`Separado hasta el ${fechaCorta(r.hasta)}: ${r.duenaNombre || "la dueña"} ya no lo puede vender. Avísale por WhatsApp.`);
      if(r){ avisoWa = r.whatsapp ? { copiaId:p.id, url:r.whatsapp, nombre:r.duenaNombre } : null; if(openId) drawSheet(); }
    };
    const sepAqui = misSeparados().filter(r=>r.copiaId===p.id);
    side.append(el("fieldset",{class:"share-set"}, el("legend",null,"¿Lo vendiste o te lo pidieron separar?"),
      el("div",{style:"display:flex;gap:8px;align-items:end;flex-wrap:wrap"}, el("label",{class:"f"},"Unidades", q), el("label",{class:"f",style:"flex:1;min-width:120px"},"Para quién", quien)),
      el("div",{style:"display:flex;gap:8px;flex-wrap:wrap"}, vb, sb),
      el("span",{class:"note",style:"margin:0"},"Registrar venta: ya te pagaron. Separar: tu clienta lo pidió y paga después; nadie más lo puede vender mientras tanto. Lo que tus clientes pagan en la web se registra solo."),
      avisoWa && avisoWa.copiaId===p.id ? el("a",{class:"btn tag",href:avisoWa.url,target:"_blank",rel:"noopener",style:"text-decoration:none;justify-self:start"}, `Avisar a ${avisoWa.nombre || "la dueña"} por WhatsApp`) : null,
      ...sepAqui.map(r=>{
        const vv = el("button",{class:"btn primary",type:"button"},"Se vendió"); vv.onclick = ()=>accionConf(vv,"confirmar",{ reventaId:r.id }, x=>`Venta confirmada. Le debes ${money(Number(x && x.monto)||0)}.`);
        const ll = el("button",{class:"btn",type:"button"},"Liberar"); ll.onclick = ()=>accionConf(ll,"liberar",{ reventaId:r.id },"Liberado");
        return el("div",{class:"conf-row"+(vencido(r)?" off":"")}, el("div",{class:"who"}, el("strong",null,`Separado${r.q>1?" × "+r.q:""}${r.cliente?" para "+r.cliente:""}`), el("small",null,(vencido(r)?"Venció el ":"Hasta el ")+fechaCorta(r.hasta))), vv, ll);
      })));
    const conf = el("span",{class:"confirm",hidden:""},"¿Quitarlo de tu tienda?", el("button",{class:"btn danger",type:"button",onclick:async()=>{ try{ await S.db.doc("productos/"+p.id).delete(); closeSheet(); toast("Quitado de tu tienda"); cargarConfianza(); }catch(e){ toast("No se pudo quitar. Intenta de nuevo."); } }},"Sí, quitar"), el("button",{class:"btn",type:"button",onclick:()=>{conf.hidden=true;}},"No"));
    side.append(el("div",{class:"actions"},
      el("button",{class:"btn danger",type:"button",onclick:()=>{conf.hidden=false;}},"Quitar de mi tienda"),
      el("div",{style:"display:flex;gap:8px"}, el("button",{class:"btn",type:"button",onclick:closeSheet},"Cerrar"),
        el("button",{class:"btn primary",type:"button",onclick:async()=>{ const patch={ nombre:$("eName").value.trim()||"Producto", precio:parsePrice($("ePrice").value), estado:$("eStatus").value, descripcion:$("eDesc").value.trim() }; try{ await S.db.doc("productos/"+p.id).update(patch); toast("Guardado"); closeSheet(); }catch(e){ toast("No se pudo guardar. Revisa tu conexión e intenta de nuevo."); } }},"Guardar"))), conf);
  }
  // Panel de la dueña de Showroomcito: todas las relaciones de confianza
  async function cargarPanelConf(){
    const tb=$("panelConfRows"); tb.textContent="";
    let r; try{ r = await confianza("admin_listar"); }catch(e){ console.warn("Detalle técnico:", e); $("panelConfCount").textContent = "no se pudo cargar"; return; }
    const lista = (r.relaciones||[]).sort((a,b)=>String(b.creado||"").localeCompare(String(a.creado||"")));
    $("panelConfCount").textContent = String(lista.length);
    if(!lista.length){ tb.append(el("tr",null, el("td",{colspan:"5",style:"color:var(--muted)"},"Todavía no hay tiendas de confianza."))); return; }
    const nombre = id => (tiendasCache.find(t=>t.id===id)||{}).nombre || id;
    for(const x of lista){
      const b = el("button",{class:"btn danger",type:"button"},"Cortar");
      b.onclick = async ()=>{ b.disabled=true; try{ await confianza("admin_cortar",{ id:x.id }); toast("Relación cortada"); cargarPanelConf(); }catch(e){ toast("No se pudo cortar"); b.disabled=false; } };
      tb.append(el("tr",null,
        el("td",null, el("strong",null,nombre(x.tiendaA)), " ↔ ", el("strong",null,nombre(x.tiendaB))),
        el("td",null, nombre(x.invita)),
        el("td",null, el("span",{class:"pill "+(x.estado==="aceptada"?"aprobada":"pendiente")}, x.estado==="aceptada" ? "Aceptada" : "Pendiente")),
        el("td",null, el("small",null, x.creado ? new Date(x.creado).toLocaleDateString("es-PE") : "")),
        el("td",null, el("div",{class:"acts"}, b))));
    }
  }

  // ----- Pedidos pagados (vendedora) -----
  const PEDIDO_TXT = { pendiente:"Pago pendiente", por_confirmar:"Por confirmar", pagado:"Pagado", entregado:"Entregado", cancelado:"Cancelado" };
  const montoTxt = (n, moneda) => (moneda==="pen" ? "S/ " : "$") + (n/100).toLocaleString("es-PE",{minimumFractionDigits: n%100?2:0, maximumFractionDigits:2});
  async function descontarStockLocal(items, pedidoId){
    let deConfianza = false;
    for(const it of items){
      const prod = S.products.find(x=>x.id===it.id);
      // De una tienda de confianza: se descuenta del original y se anota lo que le debes a la dueña.
      if(prod && esCopia(prod)){ deConfianza = true; try{ await confianza("vendi", { copiaId:prod.id, q:Number(it.q)||1, via:"yape", pedidoId }); }catch(e){ console.warn("Detalle técnico:", e); } continue; }
      if(!prod || typeof prod.stock!=="number") continue;
      try{ await S.db.doc("productos/"+prod.id).update({ stock: Math.max(0, prod.stock - (Number(it.q)||1)) }); }catch(e){}
    }
    if(deConfianza) cargarConfianza();
  }
  // ---------- Mis clientes: se arma sola con los pedidos y con quienes entraron a "Mis pedidos" ----------
  async function cargarClientes(pedidos){
    let regs = []; try{ regs = await listarClientes(); }catch(e){ console.warn("Detalle técnico:", e); }
    const norm = s=>String(s||"").trim().toLowerCase();
    const mapa = new Map();
    const de = k=>{ if(!mapa.has(k)) mapa.set(k, { nombre:"", email:"", telefono:"", pedidos:0, total:0, moneda:"", ultima:"", sigue:false, verificado:false }); return mapa.get(k); };
    for(const p of pedidos || []){
      if(p.estado==="pendiente" || p.estado==="cancelado") continue;
      const k = norm(p.email) || norm(p.telefono) || ("n:"+norm(p.cliente)); if(k==="n:") continue;
      const c = de(k); c.nombre = c.nombre || p.cliente || ""; c.email = c.email || norm(p.email); c.telefono = c.telefono || p.telefono || "";
      c.pedidos++; c.total += p.total||0; c.moneda = p.moneda || c.moneda; if(String(p.createdAt) > c.ultima) c.ultima = String(p.createdAt);
    }
    for(const r of regs){
      const k = norm(r.email); if(!k) continue;
      if(!r.verificado && !mapa.has(k)) continue;   // pidió código pero nunca entró
      const c = de(k); c.email = k; c.nombre = r.nombre || c.nombre; c.telefono = r.telefono || c.telefono; c.sigue = !!r.sigue; c.verificado = !!r.verificado;
      if(!c.ultima) c.ultima = String(r.ultimaVez || r.createdAt || "");
    }
    S.clientes = [...mapa.values()].sort((a,b)=> b.ultima.localeCompare(a.ultima));
    pintarClientes();
  }
  function pintarClientes(){
    const lista = S.clientes || [], box = $("clientesLista"); if(!box) return;
    marcarTab("clientes", lista.length, false);
    const filtro = $("clientesFiltro").value, q = $("clientesQ").value.trim().toLowerCase();
    const ver = lista.filter(c=> (filtro!=="sigue" || c.sigue) && (filtro!=="frecuentes" || c.pedidos>=2) && (!q || (c.nombre+" "+c.email+" "+c.telefono).toLowerCase().includes(q)));
    const siguen = lista.filter(c=>c.sigue).length, frec = lista.filter(c=>c.pedidos>=2).length;
    $("clientesResumen").textContent = lista.length ? [`${lista.length} ${lista.length===1?"cliente":"clientes"}`, frec ? `${frec} ${frec===1?"compra":"compran"} seguido` : "", siguen ? `${siguen} ${siguen===1?"quiere":"quieren"} ofertas` : ""].filter(Boolean).join(" · ") : "";
    show("clientesVacio", !lista.length); show("clientesTools", lista.length > 0);
    box.textContent = "";
    for(const c of ver){
      const wa = String(c.telefono||"").replace(/\D/g,"");
      const waUrl = wa ? `https://wa.me/${wa.length===9 ? "51"+wa : wa}?text=${encodeURIComponent(`Hola${c.nombre?" "+c.nombre.split(" ")[0]:""}, te escribo de ${S.config.nombre||"la tienda"} 😊`)}` : "";
      box.append(el("div",{class:"cliente-row"},
        el("div",{class:"cl-who"}, el("strong",null, c.nombre || c.email || c.telefono),
          el("small",null, [c.email, c.telefono].filter(Boolean).join(" · ")),
          el("span",{class:"cl-tags"}, c.pedidos>=2 ? el("span",{class:"cl-tag frec"},"Compra seguido") : null, c.sigue ? el("span",{class:"cl-tag sigue"},"Quiere ofertas") : null, c.verificado ? el("span",{class:"cl-tag"},"Tiene cuenta") : null)),
        el("div",{class:"cl-num"}, el("strong",null, c.pedidos ? `${c.pedidos} ${c.pedidos===1?"pedido":"pedidos"}` : "Sin pedidos aún"), c.pedidos ? el("small",null, montoTxt(c.total, c.moneda) + (c.ultima ? " · último " + new Date(c.ultima).toLocaleDateString("es-PE",{day:"numeric",month:"short"}) : "")) : null),
        el("div",{class:"cl-acts"}, waUrl ? el("a",{class:"btn tag",href:waUrl,target:"_blank",rel:"noopener",style:"text-decoration:none"},"WhatsApp") : null,
          c.email ? el("a",{class:"btn",href:"mailto:"+c.email,style:"text-decoration:none"},"Correo") : null)));
    }
    if(lista.length && !ver.length) box.append(el("p",{class:"note"},"Nadie coincide con ese filtro."));
  }
  $("clientesFiltro").onchange = pintarClientes; $("clientesQ").addEventListener("input", pintarClientes);
  $("clientesCopiar").onclick = async ()=>{
    const correos = (S.clientes||[]).filter(c=>c.sigue && c.email).map(c=>c.email);
    if(!correos.length){ toast("Todavía nadie marcó que quiere ofertas"); return; }
    try{ await navigator.clipboard.writeText(correos.join(", ")); toast(`${correos.length} correos copiados`); }catch(e){ toast(correos.join(", ")); }
  };

  async function cargarPedidos(){
    let lista = [];
    try{ lista = await listarPedidos(); }catch(e){ return; }
    cargarClientes(lista);
    show("pedidosBox", lista.length > 0 && $("panel").hidden);
    show("pedidosVacio", !lista.length && $("panel").hidden);
    const pagados = lista.filter(p=>p.estado==="pagado").length, porConfirmar = lista.filter(p=>p.estado==="por_confirmar").length;
    marcarTab("pedidos", porConfirmar + pagados, porConfirmar > 0);
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
          if(estado==="pagado" && p.metodo==="yape") await descontarStockLocal(items, p.id);
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
        el("h2",null,"¡Pago recibido! / Payment received!"),
        el("p",{style:"margin:0"}, `Tu pedido ${num ? "N.° "+num+" " : ""}está pagado. La tienda se pondrá en contacto contigo para coordinar la entrega.`));
      $("vitrina").prepend(aviso);
      // El texto se ajusta al idioma cuando ya cargó la tienda
      setTimeout(()=>{
        aviso.querySelector("h2").textContent = tx("¡Pago recibido!","Payment received!");
        aviso.querySelector("p").textContent = tx(`Tu pedido ${num ? "N.° "+num+" " : ""}está pagado. La tienda se pondrá en contacto contigo para coordinar la entrega.`, `Your order ${num ? "#"+num+" " : ""}is paid. The store will contact you about delivery.`);
        const wa = waDigits(); if(wa) aviso.append(el("a",{class:"btn tag",href:`https://wa.me/${wa}?text=${encodeURIComponent(tx(`Hola, acabo de pagar mi pedido ${num} en la web.`,`Hi, I just paid for order #${num} on your website.`))}`,target:"_blank",rel:"noopener",style:"justify-self:start;text-decoration:none"},tx("Avisar por WhatsApp","Let the store know on WhatsApp")));
      }, 1500);
    }
    if(pago==="cancelado") setTimeout(()=>toast(tx("No se realizó el pago. Tu pedido sigue guardado.","Payment not completed. Your order is still saved.")), 1200);
    limpiarParams("pago","pedido");
  }

  // ---------- Asistente de la vendedora ----------
  // Conversa con Claude (en AWS) que consulta la tienda con herramientas.
  // Los cambios llegan como propuesta: solo se aplican si la vendedora toca "Aplicar".
  const ASIS_KEY = () => "vitrina-asistente-" + (S.config && S.config.id || "");
  let asisLog = [], asisOcupado = false;
  const AYUDA_ORDENES = `**Órdenes rápidas** (dilas o escríbelas así; se entienden al instante):

| Dices | Qué hace |
|---|---|
| CAR-002 precio 120 | Cambia el precio |
| car 2 stock 3 | Cambia la cantidad |
| CAR-002 nombre Cartera Guess | Cambia el nombre |
| CAR-002 quita la palabra con cadena | Quita palabras del nombre |
| CAR-002 no poner bolso sino cartera | Cambia una palabra del nombre |
| CAR-002 descripción cuero, correa larga | Cambia la descripción |
| CAR-002 marca Guess talla M | Marca y talla |
| CAR-002 condición usado como nuevo | Condición |
| CAR-002 categoría accesorios para mujer | Categoría y para quién |
| ZAP-003 vendido · ocultar · publicar · agotado | Estado |
| todos los zapatos 15 % de descuento hoy | Oferta que vence sola |
| las carteras oferta 20 % hasta el domingo | Oferta con fecha |
| marca Guess baja el precio 10 % | Baja o sube el precio |
| los marcados quitar oferta | Termina la oferta |

Puedes juntar varias: "CAR-002 precio 120 y stock 1". Siempre te muestro los cambios y tú tocas **Aplicar**.`;
  const SUGERENCIAS = [
    "Órdenes rápidas",
    "¿Qué me falta completar en mi tienda?",
    "Escribe descripciones para los productos sin descripción",
    "Pon precio con 60 % de margen a los que tienen costo y no tienen precio",
    "¿Qué pedidos tengo por confirmar?",
    "¿Cuánto vendí esta semana?",
  ];
  const ETIQUETA_CAMPO = { publico:"Para", precio:"Precio", costo:"Costo", stock:"Cantidad", descripcion:"Descripción", marca:"Marca", nombre:"Nombre", talla:"Talla", categoria:"Categoría", estado:"Estado", condicion:"Condición", precioOferta:"Precio de oferta", ofertaHasta:"Oferta hasta" };
  const ESTADO_PED = { por_confirmar:"Por confirmar", pagado:"Pagado", entregado:"Entregado", cancelado:"Cancelado", pendiente:"Pago pendiente" };
  function guardarAsis(){ try{ localStorage.setItem(ASIS_KEY(), JSON.stringify(asisLog.slice(-40))); }catch(e){} }
  function cargarAsis(){ try{ asisLog = JSON.parse(localStorage.getItem(ASIS_KEY()) || "[]"); }catch(e){ asisLog = []; } }
  const valorCampo = (k, v) => v==null || v==="" ? "—" : (k==="precio" || k==="precioOferta") ? money(Number(v)) : k==="costo" ? usd(Number(v)) : k==="ofertaHasta" ? new Date(Number(v)).toLocaleString("es-PE",{ weekday:"short", day:"numeric", month:"short", hour:"2-digit", minute:"2-digit" }) : k==="condicion" ? condTxt(v) : String(v);

  function tarjetaPropuesta(m){
    const p = m.propuesta, total = p.productos.length + p.pedidos.length;
    const card = el("div",{class:"propuesta" + (m.estado==="aplicada" ? " hecha" : m.estado==="descartada" ? " descartada" : "")});
    card.append(el("h3",null, p.resumen || `${total} cambio${total===1?"":"s"} propuesto${total===1?"":"s"}`));
    const tb = el("tbody");
    p.productos.forEach(c=>Object.keys(c.campos).forEach(k=>tb.append(el("tr",null,
      el("td",null, c.nombre || "Producto"), el("td",null, ETIQUETA_CAMPO[k] || k),
      el("td",null, el("span",{class:"antes"}, valorCampo(k, c.antes[k])), " → ", el("span",{class:"despues"}, valorCampo(k, c.campos[k])))))));
    p.pedidos.forEach(c=>tb.append(el("tr",null,
      el("td",null, "Pedido de " + (c.cliente || "cliente")), el("td",null,"Estado"),
      el("td",null, el("span",{class:"antes"}, ESTADO_PED[c.antes]||c.antes), " → ", el("span",{class:"despues"}, ESTADO_PED[c.estado]||c.estado)))));
    card.append(el("div",{class:"tablewrap"}, el("table",null, el("thead",null, el("tr",null, el("th",null,"Qué"), el("th",null,"Campo"), el("th",null,"Cambio"))), tb)));
    if(m.estado==="aplicada") card.append(el("span",{class:"note",style:"margin:0;color:var(--ok)"},"✓ Aplicado"));
    else if(m.estado==="descartada") card.append(el("span",{class:"note",style:"margin:0"},"Descartado"));
    else {
      const aplicar = el("button",{class:"btn primary",type:"button"}, `Aplicar ${total} cambio${total===1?"":"s"}`);
      aplicar.onclick = async ()=>{
        aplicar.disabled = true; aplicar.textContent = "Aplicando…";
        let fallos = await runPool(p.productos.map(c=>c.id), id=>S.db.doc("productos/"+id).update(p.productos.find(c=>c.id===id).campos));
        if(p.pedidos.length){
          let lista = []; try{ lista = await listarPedidos(); }catch(e){}
          for(const c of p.pedidos){
            try{
              await cambiarEstadoPedido(c.id, c.estado);
              const ped = lista.find(x=>x.id===c.id);
              if(c.estado==="pagado" && ped && ped.metodo==="yape"){ let items=[]; try{ items = JSON.parse(ped.items||"[]"); }catch(e){} await descontarStockLocal(items); }
            }catch(e){ fallos++; }
          }
          cargarPedidos();
        }
        m.estado = "aplicada"; asisLog.push({ role:"nota", text: fallos ? `Se aplicaron ${total-fallos} de ${total} cambios.` : `Aplicaste ${total} cambio${total===1?"":"s"}.` });
        guardarAsis(); pintarAsis();
      };
      const descartar = el("button",{class:"btn",type:"button",onclick:()=>{ m.estado="descartada"; asisLog.push({ role:"nota", text:"Descartaste la propuesta." }); guardarAsis(); pintarAsis(); }},"Descartar");
      card.append(el("div",{class:"acciones"}, aplicar, descartar));
    }
    return card;
  }
  // Le dice a la vendedora con qué productos marcados va a trabajar el asistente
  function pintarAsisSel(){
    const box = $("asisSel"); if(!box) return; box.textContent = "";
    const n = S.sel.size;
    if(n){
      box.append(el("b",null, `${n} producto${n===1?"":"s"} marcado${n===1?"":"s"}`), " · puedes decirle \"estos\"",
        el("button",{type:"button",onclick:()=>{ S.selecting=false; S.juntando=false; S.sel.clear(); render(); }},"Quitar"));
    } else {
      box.append("Para hablar de productos en particular, toca ",
        el("button",{type:"button",onclick:()=>{ S.selecting=true; S.juntando=false; S.sel.clear(); render(); $("bulk").scrollIntoView({block:"nearest"}); }},"Editar varios"),
        " y toca cada producto.");
    }
  }
  function pintarAsis(){
    pintarAsisSel();
    const log = $("asisLog"); log.textContent = "";
    if(!asisLog.length) log.append(el("div",{class:"burbuja assistant"}, `Hola${S.config && S.config.nombre ? ", " + S.config.nombre : ""}. Puedo revisar tu tienda, escribir descripciones, poner precios con margen o ayudarte con tus pedidos. ¿Qué necesitas?`));
    for(const m of asisLog){
      if(m.text){ const b = el("div",{class:"burbuja " + m.role}); if(m.role === "assistant") b.append(...textoAsis(m.text)); else b.textContent = m.text; log.append(b); }
      if(m.propuesta && (m.propuesta.productos.length || m.propuesta.pedidos.length)) log.append(tarjetaPropuesta(m));
    }
    if(asisOcupado) log.append(el("div",{class:"pensando"},"Revisando tu tienda…"));
    const sug = $("asisSug"); sug.textContent = "";
    if(!asisLog.length) SUGERENCIAS.forEach(t=>sug.append(el("button",{type:"button",onclick:()=>enviarAsis(t)}, t)));
    log.scrollTop = log.scrollHeight;
  }
  async function enviarAsis(texto){
    texto = String(texto||"").trim(); if(asisOcupado) return;
    if(asisFotosPendientes.length){
      if(!S.canEdit)return;
      const fotos=[...asisFotosPendientes];
      asisLog.push({role:'user',text:`${texto||'Crear productos a partir de estas fotos'} · ${fotos.length} fotos adjuntas`},
        {role:'assistant',text:/internet|\bweb\b|google|en l[ií]nea|busca|investiga/i.test(texto||'') && S.buscarInternet
          ? 'Voy a preparar grupos con tus fotos. Primero leo cada foto y con esa marca y modelo busco la descripción en internet. Los productos se crean ocultos para que los revises; no invento precio ni stock.'
          : 'Voy a preparar grupos con tus fotos. Revisa los grupos y sus datos antes de guardar. Los productos se crean ocultos; no invento precio ni stock. Si quieres que complete la descripción con internet, dímelo al enviar las fotos.'});
      limpiarAsisInput(texto);guardarAsis();pintarAsis();cerrarAsis();
      asisFotosPendientes=[];pintarAdjuntosAsis();
      abrirOrganizadorFotos(fotos,{asistente:true,texto});return;
    }
    if(!texto)return;
    // Órdenes rápidas (palabras clave): se entienden sin IA, al instante y siempre igual.
    if(/^(ordenes rapidas|ordenes|comandos|ayuda)\.?$/i.test(texto.normalize("NFD").replace(/[\u0300-\u036f]/g,""))){
      asisLog.push({ role:"user", text:texto }, { role:"assistant", text: AYUDA_ORDENES }); limpiarAsisInput(texto); guardarAsis(); pintarAsis(); return;
    }
    let orden = null;
    try{ orden = interpretarComando(texto, { productos:S.products, seleccion:[...S.sel], codigoDe, enSoles:enSoles(), esCopia, money, tipoDe: w=>tipoDeTexto(w, "variado") }); }catch(e){ console.warn("Orden rápida:", e); }
    if(orden){
      asisLog.push({ role:"user", text:texto }, orden.error ? { role:"assistant", text:orden.error } : { role:"assistant", text:orden.texto, propuesta:orden.propuesta });
      limpiarAsisInput(texto); guardarAsis(); pintarAsis(); return;
    }
    asisLog.push({ role:"user", text:texto }); asisOcupado = true; guardarAsis(); pintarAsis();
    limpiarAsisInput(texto); $("asisEnviar").disabled = true;
    try{
      const conversacion = asisLog.filter(m=>m.role==="user"||m.role==="assistant").map(m=>({ role:m.role, text:m.text }));
      const r = await S.asistente(conversacion, [...S.sel]);
      asisLog.push({ role:"assistant", text: r.texto || "", propuesta: r.propuesta || null });
    }catch(e){
      asisLog.push({ role:"error", text: (e && e.message) || "No pude responder ahora. Intenta de nuevo en un momento." });
    }finally{
      asisOcupado = false; $("asisEnviar").disabled = false; guardarAsis(); pintarAsis(); $("asisInput").focus();
    }
  }
  // Vacía la caja al enviar. Antes se apaga el micrófono (si no, sigue escribiendo lo que escuchó) y se
  // suelta el foco: el dictado del teclado del celular vuelve a pegar el texto si la caja sigue activa.
  function limpiarAsisInput(enviado){
    if(asisRec){ const r = asisRec; asisRec = null; r.pausar(); $("asisMic").classList.remove("on"); $("asisMic").setAttribute("aria-label","Hablar con el asistente"); }
    const inp = $("asisInput"); inp.blur(); inp.value = ""; inp.dispatchEvent(new Event("input"));
    setTimeout(()=>{ if(inp.value.trim() === enviado){ inp.value = ""; inp.dispatchEvent(new Event("input")); } }, 150);
  }
  // Negritas (**texto**) y saltos de línea en las respuestas del asistente, sin usar innerHTML.
  // Las tablas Markdown (| a | b |) se muestran como tabla, igual que la tarjeta de cambios.
  function negritas(t){
    const out = [];
    // Enlaces (las fuentes de las búsquedas en internet) se abren en otra pestaña.
    const conEnlaces = txt => String(txt).split(/(https?:\/\/[^\s<>()"]+[^\s<>()".,;:!?])/).map((p, j)=> j % 2
      ? el("a",{href:p, target:"_blank", rel:"noopener noreferrer"}, (()=>{ try{ const u = new URL(p); return u.hostname.replace(/^www\./,"") + (u.pathname.length > 1 ? u.pathname.slice(0, 40) + (u.pathname.length > 40 ? "…" : "") : ""); }catch(e){ return p; } })())
      : document.createTextNode(p));
    String(t).replace(/<br\s*\/?>/gi, "\n").split(/\*\*(.+?)\*\*/s).forEach((parte, i)=>{ if(parte) out.push(...(i % 2 ? [el("strong",{}, parte)] : conEnlaces(parte))); });
    return out;
  }
  function textoAsis(t){
    const out = [], lineas = String(t).split("\n"), celdas = l => l.trim().replace(/^\||\|$/g,"").split("|").map(c=>c.trim());
    const esFila = l => /^\s*\|.*\|\s*$/.test(l), esSep = l => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
    let texto = [];
    const soltar = ()=>{ const s = texto.join("\n").replace(/^\n+|\n+$/g,""); if(s) out.push(...negritas(s)); texto = []; };
    for(let i = 0; i < lineas.length; i++){
      if(esFila(lineas[i]) && i + 1 < lineas.length && esSep(lineas[i+1])){
        soltar();
        const cab = celdas(lineas[i]), filas = []; i += 2;
        while(i < lineas.length && esFila(lineas[i])) filas.push(celdas(lineas[i++]));
        i--;
        const num = c => /^(S\/|\$|US\$)?\s?-?[\d.,]+\s?%?$/.test(c);
        out.push(el("div",{class:"tablewrap asis-tabla"}, el("table",null,
          el("thead",null, el("tr",null, ...cab.map(c=>el("th",null, ...negritas(c))))),
          el("tbody",null, ...filas.map(f=>el("tr",null, ...cab.map((_,j)=>el("td", num(f[j]||"") ? {class:"num"} : null, ...negritas(f[j]||"")))))))));
      } else texto.push(lineas[i]);
    }
    soltar();
    return out;
  }
  function abrirAsis(){ cargarAsis(); $("asis").hidden = false; $("asisBtn").hidden = true; pintarAsis(); $("asisInput").focus(); }
  function cerrarAsis(){ $("asis").hidden = true; $("asisBtn").hidden = !S.canEdit; }
  $("asisBtn").onclick = abrirAsis;
  $("asisCerrar").onclick = cerrarAsis;
  $("asisNuevo").onclick = ()=>{ asisLog = []; asisFotosPendientes=[];pintarAdjuntosAsis(); guardarAsis(); pintarAsis(); };
  let asisFotosPendientes=[], asisFotosUrls=[];
  function pintarAdjuntosAsis(){
    asisFotosUrls.forEach(u=>URL.revokeObjectURL(u));asisFotosUrls=[];
    const zona=$('asisAdjuntos');zona.textContent='';zona.hidden=!asisFotosPendientes.length;
    asisFotosPendientes.forEach((f,i)=>{
      const url=URL.createObjectURL(f);asisFotosUrls.push(url);
      zona.append(el('div',{class:'asis-adjunto'},el('img',{src:url,alt:f.name}),el('button',{type:'button',class:'btn','aria-label':'Quitar foto '+(i+1),onclick:()=>{asisFotosPendientes.splice(i,1);pintarAdjuntosAsis();}},'Quitar')));
    });
    if(asisFotosPendientes.length)zona.append(el('p',{class:'note'},`${asisFotosPendientes.length} fotos · escribe o dicta las indicaciones y toca Enviar`));
  }
  $('asisAdjuntar').onclick=()=>{if(S.canEdit&&!asisOcupado)$('asisFotos').click();};
  $('asisFotos').onchange=async e=>{
    if(!S.canEdit)return;
    const lista=[...e.target.files]; e.target.value='';
    const r=await leerFotos(lista);
    asisFotosPendientes.push(...r.fotos);
    pintarAdjuntosAsis();
  };
  $("asisForm").addEventListener("submit", e=>{ e.preventDefault(); enviarAsis($("asisInput").value); });
  // Hablarle al asistente para actualizar la tienda ("bájale 10 soles a las carteras"). El texto queda
  // en la caja para revisarlo; el asistente igual muestra los cambios y la vendedora los confirma.
  let asisRec = null;
  if(SR){
    $("asisMic").hidden = false;
    $("asisMic").onclick = ()=>{
      if(asisRec){ const r = asisRec; asisRec = null; r.pausar(); return; }
      const inp = $("asisInput"), antes = inp.value ? inp.value.trim() + " " : "";
      // Los códigos dichos ("rop cero cero tres") se escriben como en la tienda (ROP-003)
      const prefijos = [...new Set((S.products||[]).map(p=>(codigoDe(p)||"").split("-")[0]).filter(Boolean))];
      let fin = "";
      const poner = inter=>{ inp.value = (antes + codigosDichos(fin + inter, prefijos)).trimStart(); inp.dispatchEvent(new Event("input")); };
      const r = escucha(SR, { lang: esUS() ? "en-US" : "es-PE", vocab: vocabTienda(),
        alTexto: t=>{ fin += t; poner(""); }, alInterino: t=>poner(t),
        alEstado: (estado, det)=>{
          if(estado==="error" && /not-allowed|audio-capture/.test(det||"")) toast("Permite el micrófono para hablarle al asistente");
          if(estado==="escuchando"){ $("asisMic").classList.add("on"); $("asisMic").setAttribute("aria-label","Dejar de escuchar"); }
          else { if(asisRec === r) asisRec = null; $("asisMic").classList.remove("on"); $("asisMic").setAttribute("aria-label","Hablar con el asistente"); if(estado!=="pausa") inp.focus(); }
        } });
      asisRec = r; if(!r.iniciar()) asisRec = null;
    };
  }
  $("asisInput").addEventListener("keydown", e=>{ if(e.key==="Enter" && !e.shiftKey){ e.preventDefault(); enviarAsis($("asisInput").value); } });
  if(SR){
    $("cliMic").hidden = false;
    $("cliMic").onclick = ()=>{
      if(cliRec){ const r = cliRec; cliRec = null; r.pausar(); return; }
      const inp = $("cliInput"); let fin = "";
      const r = escucha(SR, { lang: EN() ? "en-US" : "es-PE", vocab: vocabTienda(), unaFrase: true,
        alTexto: t=>{ fin += t; inp.value = fin.trim(); }, alInterino: t=>{ inp.value = (fin + t).trim(); },
        alEstado: estado=>{ if(estado==="escuchando") $("cliMic").classList.add("on"); else { if(cliRec === r) cliRec = null; $("cliMic").classList.remove("on"); if(estado!=="pausa") inp.focus(); } } });
      cliRec = r; if(!r.iniciar()) cliRec = null;
    };
  }
  $("asisInput").addEventListener("input", e=>{ e.target.style.height = "auto"; e.target.style.height = Math.min(140, e.target.scrollHeight) + "px"; });
  document.addEventListener("keydown", e=>{ if(e.key==="Escape" && !$("asis").hidden) cerrarAsis(); });

  // ----- Arranque -----
  (async ()=>{
    // Regreso desde Google con error. La primera vez que alguien entra con Google y ya tenía
    // cuenta con ese correo, Cognito enlaza las dos cuentas pero responde con un error:
    // se reintenta una sola vez y ya entra a su cuenta de siempre.
    if(params.has("error_description") || params.has("error")){
      const detalle = String(params.get("error_description") || params.get("error") || "");
      history.replaceState(null, "", location.pathname);
      let reintentado = false; try{ reintentado = sessionStorage.getItem("google-reintento") === "1"; }catch(e){}
      if(/already found an entry|presignup|pre ?sign ?up/i.test(detalle) && !reintentado){
        try{ sessionStorage.setItem("google-reintento", "1"); }catch(e){}
        toast(ti("Uniendo tu cuenta de Google con tu cuenta de Showroomcito…","Linking your Google account to your Showroomcito account…"));
        try{ await entrarConGoogle(); return; }catch(e){}
      }
      try{ sessionStorage.removeItem("google-reintento"); }catch(e){}
      console.warn("Google:", detalle);
      setTimeout(()=>toast(ti("No se pudo entrar con Google. Intenta de nuevo o entra con tu correo.","Couldn't sign in with Google. Try again or use your email.")), 600);
    }
    // Regreso desde Google: esperar a que Amplify termine de abrir la sesión.
    if(params.has("code") && params.has("state")){
      try{ sessionStorage.removeItem("google-reintento"); }catch(e){}
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
    if(!ses.logged){ show("landing", true); show("vitrina", false); show("langBtn", true); aplicarIdiomaInicio(); pintarPlanesLanding(monedaLanding); { const st = document.querySelector(".brand .stamp"); if(st) st.hidden = true; } if(location.hash==="#entrar") abrirAuth("login"); return; }

    let tienda = null;
    try{ tienda = await miTienda(ses.sub, ses.usuario, ses.superadmin); }catch(e){
      // Antes solo salía un aviso y la página quedaba en blanco: ahora el motivo queda a la vista con un botón para reintentar.
      show("vitrina", true); show("upload", false); show("empty", true);
      $("emptyTitle").textContent = "No se pudo cargar tu cuenta";
      $("emptyText").textContent = "Si acabas de actualizar la app en AWS, espera un par de minutos y vuelve a intentar." + (e && e.message ? " Detalle: " + String(e.message).slice(0, 200) : "");
      $("emptyText").append(el("br"), el("button",{class:"btn primary",type:"button",style:"margin-top:12px",onclick:()=>location.reload()},"Reintentar"));
      return;
    }
    if(location.hash==="#panel" && ses.superadmin && !tienda){ abrirPanel(); return; }
    if(!tienda){
      if(ses.superadmin){ abrirPanel(); return; }
      show("onboard", true); $("obName").focus();
      // ¿Qué vendes? Botones grandes en la misma pantalla (ya viene marcado Ropa y moda)
      const rb = $("obRubros"); rb.textContent = "";
      RUBROS.forEach((r,i)=>{ const b = el("button",{type:"button",class:"rubro","data-rubro":r.id,"aria-pressed":String(i===0),onclick:()=>{ rb.querySelectorAll(".rubro").forEach(x=>x.setAttribute("aria-pressed", String(x===b))); }}, el("b",null,r.nombre), el("span",null,r.detalle)); rb.append(b); });
      $("onboard").addEventListener("submit", async e=>{
        e.preventDefault(); const er=$("obErr"); er.hidden=true;
        const nombre=$("obName").value.trim(), slug=limpiarSlug($("obSlug").value), whatsapp=$("obWa").value.trim(), pais=$("obPais").value==="US"?"US":"PE";
        const fallo = m=>{ er.textContent=m; er.hidden=false; er.scrollIntoView({block:"center"}); toast(m); };
        if(!nombre){ fallo("Escribe el nombre de tu tienda"); $("obName").focus(); return; }
        if(!SLUG_RE.test(slug)){ fallo("El enlace debe tener entre 3 y 40 letras, números o guiones"); $("obSlug").focus(); return; }
        $("obBtn").disabled=true; $("obBtn").textContent="Creando tu vitrina…";
        const rubro = ($("obRubros").querySelector('[aria-pressed="true"]')||{}).dataset?.rubro || "moda";
        try{ await crearTienda({ slug, nombre, whatsapp, email: ses.email, pais, moneda: pais==="US" ? "USD" : "PEN", rubro }); toast("¡Vitrina creada!"); location.reload(); return; }
        catch(err){ console.warn("Crear vitrina:", err); fallo(err && err.code==="exists" ? "Ese enlace ya lo usa otra tienda. Prueba con otro." : err && err.code==="invalid" ? "Ese enlace no está permitido. Prueba con otro." : "No se pudo crear la vitrina: "+((err&&err.message)||"intenta de nuevo")); }
        $("obBtn").disabled=false; $("obBtn").textContent="Crear vitrina";
      });
      return;
    }

    // Vitrina de la vendedora: solo sus productos y sus fotos
    usarModoVendedora(tienda.id);
    S.db = db; S.assets = assets; S.ai = ai; S.aiMax = 8; S.canEdit = true; S.quitarFondo = quitarFondo; S.asistente = asistente; S.buscarInternet = typeof buscarInternet === 'function' ? buscarInternet : null;
    show("asisBtn", true);
    pintarModoFoto();
    $("modoFotoCambiar").onclick = ()=>{ try{ localStorage.removeItem(MODO_KEY); }catch(e){} pintarModoFoto(); toast("Te preguntaremos en la próxima subida"); };
    show("upload", true); show("settingsBtn", true); show("aiRow", true); show("bulkAI", true);
    show("myStoreBtn", !!ses.superadmin);
    $("myStoreBtn").onclick = ()=>{ location.hash=""; location.reload(); };
    bannerVendedora(tienda);
    activarTabs();
    S.config = tienda; actualizarPlan(); pintarCobros(); cargarPedidos(); pintarConfBox(); cargarConfianza();
    if(tienda.stripeAccountId && !tienda.cobrosActivos && !params.get("cobros")){
      estadoCobros().then(r=>{ if(r.cobrosActivos){ S.config = { ...S.config, cobrosActivos:true }; pintarCobros(); } }).catch(()=>{});
    }
    retornoVendedora();
    if(location.hash==="#panel" && ses.superadmin){ abrirPanel(); return; }
    iniciarVitrina();
  })();
