// LA SIMULACIÓN DEL MODO DEMO, y cómo se arman los puestos a partir de oficina.config.json.
//
// Corre igual en el servidor (server.mjs la importa) y en el navegador (cuando la página está publicada como sitio estático,
// sin servidor, por ejemplo en GitHub Pages). No usa nada de Node ni del navegador: solo JavaScript.

// Los colores de las esferas (y de las camisas) por nombre; también vale un color en hexadecimal.
export const PALETAS = {
  marca: ['#FF5A1F', '#FFA51F', '#E0262E', '#FFE9A3'],
  rojo: ['#F2262E', '#FF6B6B', '#A50F1A', '#FFE0E0'],
  azul: ['#0A84FF', '#5AC8FA', '#3A3FD8', '#E6F6FF'],
  turquesa: ['#00C7BE', '#6EE7DF', '#00777A', '#E2FFFC'],
  indigo: ['#5E5CE6', '#A3A1FF', '#2F2BA0', '#EDECFF'],
  titanio: ['#8E8E93', '#D1D1D6', '#3A3A3C', '#FFFFFF'],
  morado: ['#AF52DE', '#D79CFF', '#5E1FA8', '#F6E8FF'],
  rosado: ['#FF2D78', '#FF8DBA', '#B0115A', '#FFE3F0'],
  verde: ['#30D158', '#63E6BE', '#0FA36B', '#EAFFF1'],
  naranja: ['#FF9F0A', '#FFC56E', '#B86E00', '#FFF2DE'],
};
export const paleta = (c) => (Array.isArray(c) ? c : PALETAS[c] || (/^#[0-9a-f]{6}$/i.test(c || '') ? [c, c, c, '#FFFFFF'] : PALETAS.titanio));

/** Los puestos: el dueño y la recepción en Dirección, y cada agente en su zona. */
export function puestosDe(config) {
  const lista = [];
  const dueno = config.dueno || { nombre: 'Tú' };
  lista.push({ slug: 'dueno', zona: 'direccion', persona: true, nombre: dueno.nombre || 'Tú', cargo: '', genero: dueno.genero, camisa: dueno.camisa });
  if (config.recepcion !== false) {
    const r = config.recepcion || {};
    lista.push({ slug: 'recepcion', zona: 'direccion', nombre: 'Recepción', alias: r.nombre || 'Recepción', genero: r.genero || 'f', paleta: paleta(r.color || 'marca'), claude: r.claude });
  }
  for (const z of config.zonas || []) {
    for (const a of z.agentes || []) {
      lista.push({ slug: a.id, zona: z.clave, nombre: a.cargo || a.nombre, alias: a.cargo ? a.nombre : null, genero: a.genero, paleta: paleta(a.color || z.color), claude: a.claude });
    }
  }
  return lista;
}
export function zonasDe(config, lista) {
  return [{ clave: 'direccion', nombre: config.direccion || 'Dirección' }, ...(config.zonas || []).map((z) => ({ clave: z.clave, nombre: z.nombre }))]
    .map((z) => ({ ...z, puestos: lista.filter((p) => p.zona === z.clave).map((p) => p.slug) }))
    .filter((z) => z.puestos.length);
}
/** El puesto como lo pide la página, sin estado todavía. */
export function puestoVacio(p) {
  if (p.persona) return { nombre: p.nombre, zona: p.zona, persona: true, genero: p.genero, camisa: p.camisa };
  return { nombre: p.nombre, alias: p.alias, genero: p.genero, zona: p.zona, paleta: p.paleta, estado: 'cerrado', actividad: null, frase: null, detalle: '', desde: null, bandeja: 0 };
}

export const ahoraTexto = (t = Date.now()) => {
  const d = new Date(t);
  const dos = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())} ${dos(d.getHours())}:${dos(d.getMinutes())}:${dos(d.getSeconds())}`;
};
const azar = (a) => a[Math.floor(Math.random() * a.length)];
const entre = (a, b) => a + Math.random() * (b - a);

const FRASES = {
  terminal: ['En la terminal', ['Corre las pruebas', 'Instala las dependencias', 'Revisa el despliegue', 'Compila el proyecto', 'Mira los registros']],
  leyendo: ['Leyendo', ['propuesta.md', 'informe-mensual.pdf', 'README.md', 'clientes.csv', 'guia-de-marca.pdf']],
  escribiendo: ['Escribiendo', ['landing.html', 'campana-noviembre.md', 'contrato.docx', 'api.ts', 'guion-del-video.md']],
  navegador: ['En el navegador', ['google.com', 'linkedin.com', 'docs.anthropic.com', 'github.com', 'instagram.com']],
  pensando: ['Pensando', ['']],
  equipo: ['Con un subagente', ['Revisa el código', 'Investiga a la competencia']],
};
const PREGUNTAS = ['¿Lo publico así o le cambio algo?', '¿Te mando la propuesta para revisarla?', '¿Cuál de las dos versiones prefieres?', 'Necesito tu aprobación para seguir'];
const ENCARGOS = ['Revisa el texto de la página nueva', 'Prepara los números del mes', 'Diseña la portada del video', 'Necesito el contrato firmado',
  'Arma la propuesta para el cliente', 'Revisa la campaña de correo', 'Sube la nueva versión', 'Hazme el resumen de la reunión', 'Mira este error en producción'];
const PEDIDOS = ['¿Cómo vamos con lo de esta semana?', 'Prepárame un resumen para mañana', 'Revisa los correos de hoy', 'Arma el reporte de ventas'];

function cambiarActividad(a, t) {
  a.actividad = azar(['terminal', 'terminal', 'leyendo', 'escribiendo', 'escribiendo', 'navegador', 'pensando', 'equipo']);
  const [frase, detalles] = FRASES[a.actividad];
  a.frase = frase;
  a.detalle = azar(detalles);
  a.otra = t + entre(6e3, 18e3);
}

/**
 * La oficina simulada: los agentes trabajan, esperan, descansan y a ratos se van; cada 12 a 35 s uno le manda un encargo a
 * otro (que se responde entre 30 s y 2 min después), y cada 40 a 90 s le haces un pedido a alguno, que te contesta luego.
 * `foto()` devuelve lo mismo que /api/oficina.
 */
export function crearSimulacion(config) {
  const lista = puestosDe(config);
  const zonas = zonasDe(config, lista);
  const sim = { agentes: new Map(), encargos: [], pedidos: [], pendientes: [], id: 1, proximoEncargo: Date.now() + 4e3, proximoPedido: Date.now() + 12e3 };
  const agentes = lista.filter((p) => !p.persona);

  function avanzar() {
    const t = Date.now();
    for (const p of agentes) {
      let a = sim.agentes.get(p.slug);
      if (!a) {
        // Al arrancar, cada uno en un estado al azar (casi todos presentes, para que se vea viva).
        a = { estado: azar(['trabajando', 'trabajando', 'trabajando', 'libre', 'libre', 'espera', 'cerrado']), hasta: t + entre(5e3, 60e3), desde: t, bandeja: Math.floor(entre(0, 6)) };
        if (p.slug === 'recepcion') a.estado = 'libre';
        sim.agentes.set(p.slug, a);
        cambiarActividad(a, t);
      }
      if (a.estado === 'trabajando' && t > a.otra) cambiarActividad(a, t);
      if (t > a.hasta) {
        const r = Math.random();
        a.estado = p.slug === 'recepcion' ? (r < 0.5 ? 'trabajando' : 'libre') : r < 0.5 ? 'trabajando' : r < 0.74 ? 'libre' : r < 0.86 ? 'espera' : 'cerrado';
        a.desde = t;
        a.hasta = t + (a.estado === 'cerrado' ? entre(60e3, 180e3) : a.estado === 'espera' ? entre(15e3, 45e3) : entre(25e3, 110e3));
        if (a.estado === 'trabajando') cambiarActividad(a, t);
        if (a.estado === 'espera') a.pregunta = azar(PREGUNTAS);
      }
    }
    const presentes = agentes.filter((p) => sim.agentes.get(p.slug)?.estado !== 'cerrado' && p.slug !== 'recepcion');
    if (t > sim.proximoEncargo && presentes.length > 1) {
      const de = azar(presentes);
      const para = azar(agentes.filter((p) => p.slug !== de.slug && p.slug !== 'recepcion'));
      sim.encargos.unshift({ id: sim.id++, de: de.slug, para: para.slug, titulo: azar(ENCARGOS), estado: 'nuevo', creado: ahoraTexto(t), cerrado: null, responder: t + entre(30e3, 120e3) });
      sim.encargos.length = Math.min(sim.encargos.length, 40);
      sim.proximoEncargo = t + entre(12e3, 35e3);
    }
    for (const e of sim.encargos) if (e.estado === 'nuevo' && t > e.responder) { e.estado = 'respondido'; e.cerrado = ahoraTexto(t); }
    if (t > sim.proximoPedido && agentes.length) {
      const para = azar(agentes);
      const id = `p${sim.id++}`;
      sim.pedidos.unshift({ id, de: 'dueno', para: para.slug, tipo: 'voz', cuando: ahoraTexto(t), texto: azar(PEDIDOS) });
      const a = sim.agentes.get(para.slug);
      if (a) { a.estado = 'trabajando'; a.desde = t; a.hasta = t + entre(25e3, 60e3); cambiarActividad(a, t); }
      sim.pendientes.push({ id: `${id}r`, de: para.slug, para: 'dueno', tipo: 'voz-respuesta', texto: 'Listo, ya quedó.', cuando: t + entre(20e3, 50e3) });
      sim.proximoPedido = t + entre(40e3, 90e3);
    }
    for (let i = sim.pendientes.length - 1; i >= 0; i--) {
      const r = sim.pendientes[i];
      if (t > r.cuando) { sim.pendientes.splice(i, 1); sim.pedidos.unshift({ ...r, cuando: ahoraTexto(t) }); }
    }
    sim.pedidos.length = Math.min(sim.pedidos.length, 30);
  }

  return {
    lista,
    zonas,
    foto() {
      avanzar();
      const puestos = {};
      for (const p of lista) {
        const s = puestoVacio(p);
        if (!p.persona) {
          const a = sim.agentes.get(p.slug);
          Object.assign(s, { estado: a.estado, desde: ahoraTexto(a.desde), bandeja: a.bandeja + sim.encargos.filter((e) => e.para === p.slug && e.estado === 'nuevo').length });
          if (a.estado === 'trabajando') Object.assign(s, { actividad: a.actividad, frase: a.frase, detalle: a.detalle, inicio: ahoraTexto(a.desde) });
          if (a.estado === 'espera') Object.assign(s, { frase: 'Te espera', detalle: a.pregunta });
        }
        puestos[p.slug] = s;
      }
      puestos.dueno.esperan = Object.values(puestos).filter((s) => s.estado === 'espera').length;
      return { ahora: ahoraTexto(), zonas, puestos, encargos: sim.encargos.map(({ responder, ...e }) => e), pedidos: sim.pedidos };
    },
  };
}
