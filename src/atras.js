// Botón "atrás" del celular: cierra la pantalla que está encima (organizador, revisión del lote…)
// en vez de salir de la página. Cada pantalla abierta agrega un paso al historial.
//
// const capa = abrirCapa(() => { ...; return true });  // atrás: true = se cerró, false = sigue abierta
// capa.cerrar();                                         // se cerró desde un botón: quita su paso del historial
// capa.pendiente = () => true;                           // hay trabajo sin guardar: el navegador avisa antes de salir del sitio

const capas = [];
let ignorar = 0, porAgregar = 0;
const agregarPaso = () => history.pushState({ ...(history.state || {}), capa: capas.length }, '');

export function abrirCapa(alAtras) {
  const capa = { alAtras, pendiente: () => false, cerrar() {
    const i = capas.indexOf(capa); if (i < 0) return;
    capas.splice(i, 1);
    // Su paso del historial ya no sirve: se retrocede sin avisar a nadie.
    ignorar++; history.back();
  } };
  capas.push(capa);
  // Si todavía hay un retroceso en camino (otra pantalla acaba de cerrarse), el paso se agrega después.
  if (ignorar) porAgregar++; else agregarPaso();
  return capa;
}

window.addEventListener('popstate', () => {
  if (ignorar) { ignorar--; if (!ignorar) for (; porAgregar; porAgregar--) agregarPaso(); return; }
  const capa = capas[capas.length - 1];
  if (!capa) return;
  let cerrada = true;
  try { cerrada = capa.alAtras() !== false; } catch (e) { console.warn(e); }
  if (cerrada) capas.pop();
  // Sigue abierta (por ejemplo, preguntó "¿Salir sin guardar?"): se repone su paso del historial.
  else agregarPaso();
});

window.addEventListener('beforeunload', (e) => {
  if (capas.some((c) => { try { return c.pendiente(); } catch { return false; } })) { e.preventDefault(); e.returnValue = ''; }
});
