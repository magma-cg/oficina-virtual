// EL PLANO: dónde va cada sala, cada puesto, cada mueble y cada sitio para sentarse, y por dónde se camina.
//
// La oficina es el último piso de una torre, en metros. x crece hacia el oriente, y hacia el sur (la cámara mira desde
// el sureste). Al fondo, la fila norte (Dirección, IT, Marketing, Jurídico); adelante, la fila sur (Comercial, Finanzas,
// Proyectos y la sala de juntas); entre las dos, el corredor, que arranca en los ascensores y la recepción y termina en el
// comedor y la sala, abiertos, y en la terraza. El ancho de cada sala sale de cuántos puestos tiene: si un departamento crece,
// la oficina crece con él.
//
// Convención de giro: un mueble o una persona con giro 0 mira al sur (+y); con PI, al norte; con PI/2, al oriente.

export const SALA = 8;          // fondo de una sala
export const CORREDOR = 4;
export const SOCIAL = 13.5;     // el comedor y la sala, al oriente
export const TERRAZA = 8.5;
export const PASO = 2.3;        // de un puesto al siguiente
export const D = SALA * 2 + CORREDOR;
export const NUCLEO = 3.2;      // los ascensores, al occidente del corredor
const CELDA = 0.2;              // la rejilla por la que se camina
const HOLGURA = 0.26;           // lo que se aparta una persona de un mueble o una pared

const FILA_N = ['direccion', 'it', 'marketing', 'juridico'];
const FILA_S = ['comercial', 'finanzas', 'proyectos'];

/** Lo que ocupa cada mueble en el piso, sin girar: ancho (x) y fondo (y). */
export const HUELLA = {
  escritorio: [1.5, 0.74], escritorioDueno: [2.1, 0.95], recepcion: [1.5, 0.8], silla: [0.6, 0.6],
  estanteria: [1.8, 0.4], biblioteca: [2.4, 0.42], sofa3: [2.5, 0.95], sofa2: [1.9, 0.92], chaise: [0.95, 1.7], sillon: [0.92, 0.88],
  mesaCentro: [1.2, 0.66], consola: [2.3, 0.46], planta: [0.62, 0.62], plantaGrande: [0.86, 0.86], lampara: [0.42, 0.42],
  rack: [0.66, 1.0], pizarra: [1.7, 0.5], tripode: [0.7, 0.7], softbox: [0.8, 0.8], fondoFoto: [2.8, 0.32], archivador: [0.5, 0.66],
  mesaJuntas: [3.6, 1.3], cocina: [6.4, 0.66], nevera: [0.82, 0.76], isla: [2.8, 1.05], taburete: [0.44, 0.44], mesaRedonda: [1.1, 1.1],
  sillaComedor: [0.5, 0.5], billar: [2.62, 1.46], tumbona: [0.76, 2.0], sombrilla: [0.3, 0.3], jardinera: [3, 0.8], pergola: [4.2, 3.2],
  green: [5.2, 2.4], isotipo: [2.6, 0.9], agua: [0.42, 0.42], banca: [1.7, 0.48], golf: [0.36, 0.36], mesaBistro: [0.75, 0.75],
  alfombra: [1, 1], cafetera: [0.5, 0.45], pantallaPie: [1.8, 0.5], puf: [0.6, 0.6],
};
const NO_BLOQUEA = new Set(['alfombra', 'green', 'pergola', 'sombrilla']);

/** Un generador de números pseudoaleatorios estable: la misma oficina cada vez que se abre. */
export function azar(semilla) {
  let s = semilla >>> 0 || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
export function hash(texto) {
  let h = 2166136261;
  for (const ch of String(texto)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** Ancho de una sala según sus puestos (dos filas de escritorios). */
function anchoDe(clave, n) {
  if (clave === 'direccion') return 8.8;
  const cols = Math.max(1, Math.ceil(n / 2));
  return Math.max(clave === 'juridico' ? 6 : 6.2, cols * PASO + 1.9);
}

export function distribuir(zonas, puestosDatos) {
  const zonaDe = new Map(zonas.map((z) => [z.clave, z]));
  const norte = FILA_N.filter((c) => zonaDe.has(c));
  const sur = FILA_S.filter((c) => zonaDe.has(c));
  // Una zona que no esté en ninguna fila va a la que tenga menos ancho.
  for (const z of zonas) if (!norte.includes(z.clave) && !sur.includes(z.clave)) {
    const suma = (f) => f.reduce((a, c) => a + anchoDe(c, zonaDe.get(c).puestos.length), 0);
    (suma(norte) <= suma(sur) + 6.5 ? norte : sur).push(z.clave);
  }
  const ancho = (c) => anchoDe(c, (zonaDe.get(c)?.puestos || []).filter((s) => s !== 'recepcion').length);
  const anchoN = norte.reduce((a, c) => a + ancho(c), 0);
  const anchoS = sur.reduce((a, c) => a + ancho(c), 0) + 6.6;   // más la sala de juntas
  const interior = Math.max(anchoN, anchoS);
  const W = interior + SOCIAL;
  const WT = W + TERRAZA;

  const salas = [];
  const muebles = [];
  const puestos = {};
  const sociales = [];
  const m = (tipo, x, y, rot = 0, extra = {}) => { const o = { tipo, x, y, rot, ...extra }; muebles.push(o); return o; };

  // ---------------------------------------------------------------------------------------------- las dos filas de salas
  const filas = [
    { claves: norte, y0: 0, y1: SALA, fila: 'n' },
    { claves: [...sur, '_juntas'], y0: SALA + CORREDOR, y1: D, fila: 's' },
  ];
  for (const f of filas) {
    let x = 0;
    f.claves.forEach((clave, i) => {
      const ultimo = i === f.claves.length - 1;
      const w = clave === '_juntas' ? 6.6 : ancho(clave);
      const x1 = ultimo ? interior : x + w;
      const z = zonaDe.get(clave);
      const sala = {
        clave, nombre: clave === '_juntas' ? 'Sala de juntas' : z.nombre, tipo: clave === '_juntas' ? 'juntas' : 'depto',
        fila: f.fila, x0: x, x1, y0: f.y0, y1: f.y1,
      };
      // La puerta da al corredor: en la pared sur las de la fila norte, en la norte las de la fila sur.
      const pc = clave === 'direccion' ? x1 - 1.6 : (x + x1) / 2;
      sala.puerta = { x0: pc - 0.8, x1: pc + 0.8, y: f.fila === 'n' ? f.y1 : f.y0 };
      salas.push(sala);
      x = x1;
    });
  }
  const social = { clave: '_social', nombre: 'Comedor', tipo: 'social', x0: interior, x1: W, y0: 0, y1: D };
  const corredor = { x0: NUCLEO, x1: interior, y0: SALA, y1: SALA + CORREDOR };
  const nucleo = { x0: 0, x1: NUCLEO, y0: SALA, y1: SALA + CORREDOR };
  nucleo.ascensores = [{ x: NUCLEO, y: SALA + 0.92 }, { x: NUCLEO, y: SALA + CORREDOR - 0.92 }];
  const terraza = { x0: W, x1: WT, y0: 0, y1: D };
  const puertaTerraza = { x: W, y0: SALA + 0.9, y1: SALA + CORREDOR - 0.9 };

  // ---------------------------------------------------------------------------------------------- los puestos
  const nuevoPuesto = (slug, x, y, yaw, tipo, zona) => {
    // (x, y) es el asiento; `acceso` es donde se para antes de sentarse; `pie`, donde se para si te espera.
    const fx = Math.sin(yaw), fy = Math.cos(yaw);
    const p = {
      slug, tipo, zona, x, y, yaw,
      acceso: { x: x - fx * 0.62, y: y - fy * 0.62 },
      pie: { x: x - fx * 0.34 + fy * 0.62, y: y - fy * 0.34 - fx * 0.62 },
    };
    puestos[slug] = p;
    return p;
  };
  for (const sala of salas) {
    if (sala.tipo !== 'depto') continue;
    const z = zonaDe.get(sala.clave);
    const lista = z.puestos.filter((s) => s !== 'recepcion' && s !== 'dueno');
    const cx = (sala.x0 + sala.x1) / 2;
    if (sala.clave === 'direccion') amueblarDireccion(sala, m, nuevoPuesto, z.puestos.includes('dueno'));
    const filaA = Math.ceil(lista.length / 2);
    lista.forEach((slug, i) => {
      const enA = i < filaA;
      const n = enA ? filaA : lista.length - filaA;
      const k = enA ? i : i - filaA;
      const x = cx + (k - (n - 1) / 2) * PASO;
      // Dos filas que miran al norte: la pantalla queda de frente a la cámara, por encima del hombro de quien trabaja.
      const yEsc = sala.y0 + (enA ? 2.25 : 5.3);
      m('escritorio', x, yEsc, 0, { slug, variante: hash(slug) % 4 });
      m('silla', x, yEsc + 0.66, Math.PI, { slug });
      nuevoPuesto(slug, x, yEsc + 0.66, Math.PI, 'normal', sala.clave);
    });
    amueblarSala(sala, m, lista.length);
  }
  // La recepción, entre los ascensores y el corredor.
  const recep = { x: NUCLEO + 2.35, y: SALA + CORREDOR / 2 };
  m('recepcion', recep.x, recep.y, -Math.PI / 2);
  m('silla', recep.x - 0.82, recep.y, Math.PI / 2, { slug: 'recepcion' });
  if (puestosDatos.recepcion) nuevoPuesto('recepcion', recep.x - 0.82, recep.y, Math.PI / 2, 'recepcion', 'direccion');
  m('planta', NUCLEO + 0.5, SALA + 0.25 + 0.3, 0, { var: 2, bloquea: false });

  const juntas = salas.find((s) => s.tipo === 'juntas');
  if (juntas) amueblarJuntas(juntas, m);
  amueblarSocial(social, m, sociales);
  amueblarTerraza(terraza, m, sociales);
  amueblarCorredor(corredor, m, salas);

  // ---------------------------------------------------------------------------------------------- por dónde se camina
  const nav = rejilla({ W, WT, salas, nucleo, muebles, puertaTerraza, terraza });
  return { W, WT, D, interior, salas, social, corredor, nucleo, terraza, puertaTerraza, recep, puestos, muebles, sociales, nav };
}

// ================================================================================================ cada sala con lo suyo
function amueblarDireccion(s, m, nuevoPuesto, conDueno) {
  // La oficina del dueño: su escritorio de nogal de cara a la puerta, la biblioteca a la espalda, la sala de estar y su golf.
  const x = s.x0 + 3.4, y = s.y0 + 2.7;
  m('alfombra', x, y + 0.2, 0, { w: 4.2, d: 3.0, color: 'lana' });
  m('escritorioDueno', x, y, Math.PI);
  m('silla', x, y - 0.8, 0, { slug: 'dueno', ejecutiva: true });
  if (conDueno) nuevoPuesto('dueno', x, y - 0.8, 0, 'dueno', 'direccion');
  m('biblioteca', x, s.y0 + 0.36, 0);
  m('sofa3', s.x0 + 2.6, s.y1 - 1.1, Math.PI, { tela: 'vino' });
  m('mesaCentro', s.x0 + 2.6, s.y1 - 2.3, 0);
  m('sillon', s.x0 + 0.95, s.y1 - 2.35, Math.PI / 2, { tela: 'arena' });
  m('alfombra', s.x0 + 2.4, s.y1 - 2.0, 0, { w: 3.6, d: 2.6, color: 'arena' });
  m('plantaGrande', s.x1 - 0.7, s.y0 + 0.75, 0, { var: 1 });
  m('plantaGrande', s.x0 + 0.65, s.y0 + 0.7, 0, { var: 3 });
  m('golf', s.x1 - 0.45, s.y1 - 2.3, 0);
  m('lampara', s.x0 + 4.4, s.y1 - 0.7, 0);
  m('archivador', s.x1 - 0.42, s.y0 + 2.3, -Math.PI / 2);
}

function amueblarSala(s, m, n) {
  const ancho = s.x1 - s.x0;
  const esquinas = s.fila === 'n'
    ? [[s.x0 + 0.5, s.y0 + 0.5], [s.x1 - 0.5, s.y0 + 0.5]]
    : [[s.x0 + 0.5, s.y1 - 0.5], [s.x1 - 0.5, s.y1 - 0.5]];
  const fondo = s.fila === 'n' ? s.y0 + 0.38 : s.y1 - 0.38;
  const rotFondo = s.fila === 'n' ? 0 : Math.PI;
  const cx = (s.x0 + s.x1) / 2;
  if (s.clave === 'direccion') return;
  m('planta', esquinas[0][0], esquinas[0][1], 0, { var: hash(s.clave) % 3 + 1 });
  if (s.clave === 'it') {
    m('rack', s.x1 - 0.5, s.y0 + 1.0, -Math.PI / 2);
    m('rack', s.x1 - 0.5, s.y0 + 2.05, -Math.PI / 2);
    m('pizarra', s.x0 + 0.38, s.y0 + 3.7, Math.PI / 2, { dibujo: 'it' });
  } else if (s.clave === 'marketing') {
    // El rincón donde se graba: el fondo de papel naranja, la cámara en su trípode y dos luces.
    m('fondoFoto', s.x1 - 1.75, s.y0 + 0.3, 0);
    m('softbox', s.x1 - 3.2, s.y0 + 1.6, Math.PI * 0.82);
    m('tripode', s.x1 - 1.75, s.y0 + 2.4, Math.PI);
    m('planta', esquinas[1][0] - 0.1, esquinas[1][1] + 1.6, 0, { var: 2 });
    m('pizarra', s.x0 + 0.38, s.y0 + 3.7, Math.PI / 2, { dibujo: 'marketing' });
  } else if (s.clave === 'juridico') {
    m('biblioteca', cx, s.y0 + 0.36, 0, { libros: true });
    m('sillon', s.x1 - 1.0, s.y0 + 1.55, -Math.PI * 0.75, { tela: 'cuero' });
    m('lampara', s.x1 - 0.45, s.y0 + 0.75, 0);
  } else if (s.clave === 'comercial') {
    m('pizarra', s.x0 + 0.38, s.y0 + 3.9, Math.PI / 2, { dibujo: 'comercial' });
    m('planta', esquinas[1][0], esquinas[1][1], 0, { var: 1 });
  } else if (s.clave === 'finanzas') {
    m('archivador', s.x0 + 0.55, fondo - 0.06, rotFondo);
    m('archivador', s.x0 + 1.1, fondo - 0.06, rotFondo);
    m('pantallaPie', s.x0 + 0.38, s.y0 + 4.0, Math.PI / 2, { dibujo: 'finanzas' });
  } else if (s.clave === 'proyectos') {
    m('pantallaPie', s.x0 + 0.38, s.y0 + 4.0, Math.PI / 2, { dibujo: 'proyectos' });
    m('planta', esquinas[1][0], esquinas[1][1], 0, { var: 3 });
  } else {
    m('planta', esquinas[1][0], esquinas[1][1], 0, { var: 1 });
  }
  if (ancho > 9 && s.clave !== 'marketing' && s.clave !== 'it') m('plantaGrande', s.x0 + 0.6, s.fila === 'n' ? s.y1 - 0.75 : s.y0 + 0.75, 0, { var: 2 });
}

function amueblarJuntas(s, m) {
  const cx = (s.x0 + s.x1) / 2, cy = (s.y0 + s.y1) / 2 + 0.3;
  m('alfombra', cx, cy, 0, { w: 5, d: 3.4, color: 'grafito' });
  m('mesaJuntas', cx, cy, 0);
  for (const dx of [-1.25, -0.42, 0.42, 1.25]) {
    m('silla', cx + dx, cy - 0.95, 0, { sencilla: true });
    m('silla', cx + dx, cy + 0.95, Math.PI, { sencilla: true });
  }
  m('consola', s.x0 + 0.3, cy, Math.PI / 2, { tele: 'juntas' });
  m('planta', s.x0 + 0.5, s.y1 - 0.5, 0, { var: 2 });
  m('planta', s.x1 - 0.5, s.y1 - 0.5, 0, { var: 1 });
}

function amueblarSocial(s, m, sociales) {
  // Al norte el comedor (la cocina contra el muro de la marca, la isla y tres mesas); en medio, donde llega el corredor, el
  // billar; al sur la sala, con el sofá grande frente al televisor, los sillones y los pufs.
  const x0 = s.x0, x1 = s.x1;
  const sitio = (x, y, yaw, pose, ax, ay, extra = {}) => sociales.push({ id: sociales.length, x, y, yaw, pose, acceso: { x: ax, y: ay }, ...extra });
  const kx = x1 - 4.4;
  m('cocina', kx, 0.36, 0);
  m('nevera', x1 - 0.55, 0.42, 0);
  m('cafetera', kx - 2.6, 0.38, 0, { sobre: 'cocina' });
  sitio(kx - 2.6, 1.15, Math.PI, 'pie', kx - 2.6, 1.35, { cafe: true });
  sitio(kx + 0.6, 1.2, Math.PI, 'pie', kx + 0.6, 1.4, { cafe: true });
  m('isla', kx, 2.75, 0);
  for (const dx of [-0.95, 0, 0.95]) {
    m('taburete', kx + dx, 3.62, 0);
    sitio(kx + dx, 3.62, Math.PI, 'taburete', kx + dx, 4.25);
  }
  const mesas = [[x0 + 2.0, 2.0], [x0 + 2.0, 5.2], [x0 + 4.9, 5.4]];
  for (const [mx, my] of mesas) {
    m('mesaRedonda', mx, my, 0);
    const lados = [[0, -0.78, 0], [0.78, 0, -Math.PI / 2], [0, 0.78, Math.PI], [-0.78, 0, Math.PI / 2]];
    for (const [dx, dy, r] of lados) {
      m('sillaComedor', mx + dx, my + dy, r);
      sitio(mx + dx, my + dy, r, 'silla', mx + dx * 1.7, my + dy * 1.7);
    }
  }
  m('plantaGrande', x0 + 0.65, 0.65, 0, { var: 1 });
  m('planta', x1 - 0.5, 4.9, 0, { var: 3 });
  // El billar, donde el corredor se abre.
  const bx = x0 + 6.6, by = SALA + CORREDOR / 2;
  m('billar', bx, by, 0);
  sitio(bx - 1.75, by - 0.35, Math.PI / 2, 'billar', bx - 1.75, by - 0.35);
  sitio(bx + 1.75, by + 0.4, -Math.PI / 2, 'billar', bx + 1.75, by + 0.4);
  // La sala.
  const sy = D - 4.2;
  m('alfombra', x0 + 4.6, sy + 0.2, 0, { w: 6.2, d: 4.8, color: 'lana' });
  m('consola', x0 + 0.32, sy, Math.PI / 2, { tele: 'sala' });
  m('sofa3', x0 + 5.0, sy, -Math.PI / 2, { tela: 'vino' });
  for (const dy of [-0.8, 0, 0.8]) sitio(x0 + 4.75, sy + dy, -Math.PI / 2, 'sofa', x0 + 3.95, sy + dy);
  m('chaise', x0 + 4.24, sy + 1.95, Math.PI, { tela: 'vino' });
  sitio(x0 + 4.24, sy + 1.85, Math.PI, 'sofa', x0 + 3.5, sy + 1.6);
  m('mesaCentro', x0 + 2.9, sy, Math.PI / 2);
  m('sillon', x0 + 2.75, sy - 1.95, -Math.PI * 0.3, { tela: 'naranja' });
  sitio(x0 + 2.72, sy - 1.9, -Math.PI * 0.3, 'sillon', x0 + 2.2, sy - 1.3);
  m('puf', x0 + 1.75, sy + 1.85, 0, { tela: 'amarillo' });
  sitio(x0 + 1.75, sy + 1.85, Math.PI * 0.75, 'puf', x0 + 2.2, sy + 1.3);
  m('lampara', x0 + 0.5, sy - 1.95, 0);
  m('plantaGrande', x0 + 0.6, D - 0.6, 0, { var: 2 });
  m('plantaGrande', x0 + 7.6, D - 0.6, 0, { var: 3 });
  m('estanteria', x0 + 9.6, D - 0.3, Math.PI, { libros: true });
  m('sillon', x0 + 9.6, D - 1.6, Math.PI, { tela: 'arena' });
  sitio(x0 + 9.6, D - 1.7, Math.PI, 'sillon', x0 + 9.6, D - 2.4);
  m('agua', x1 - 0.42, SALA + 0.4, 0);
  sitio(x1 - 0.95, SALA + 0.45, Math.PI / 2, 'pie', x1 - 1.1, SALA + 0.6, { cafe: true });
}

function amueblarTerraza(t, m, sociales) {
  const sitio = (x, y, yaw, pose, ax, ay, extra = {}) => sociales.push({ id: sociales.length, x, y, yaw, pose, acceso: { x: ax, y: ay }, terraza: true, ...extra });
  const x0 = t.x0, x1 = t.x1;
  // Jardineras con árboles por el borde, la escultura de la marca en la esquina, las tumbonas con sombrilla, el green de golf
  // y una mesa bajo la pérgola.
  m('jardinera', x1 - 0.5, 2.4, Math.PI / 2, { largo: 4.2, arbol: 2 });
  m('jardinera', x1 - 0.5, D - 2.6, Math.PI / 2, { largo: 4.6, arbol: 2 });
  m('jardinera', x0 + 2.4, 0.5, 0, { largo: 3.4, arbol: 1 });
  m('isotipo', x1 - 2.6, 1.25, 0);
  const ty = SALA + CORREDOR / 2;
  m('pergola', x0 + 4.6, 5.0, 0);
  m('mesaBistro', x0 + 4.0, 4.6, 0);
  m('sillaComedor', x0 + 3.35, 4.6, Math.PI / 2, { exterior: true });
  m('sillaComedor', x0 + 4.65, 4.6, -Math.PI / 2, { exterior: true });
  sitio(x0 + 3.35, 4.6, Math.PI / 2, 'silla', x0 + 3.35, 5.4);
  sitio(x0 + 4.65, 4.6, -Math.PI / 2, 'silla', x0 + 4.65, 5.4);
  for (const [i, dy] of [[0, 0], [1, 2.6]].map(([a, b]) => [a, b])) {
    const ly = ty + 3.2 + dy;
    m('tumbona', x1 - 1.6, ly, -Math.PI / 2);
    sitio(x1 - 1.95, ly, -Math.PI / 2, 'tumbona', x1 - 2.95, ly);
    if (i === 0) m('sombrilla', x1 - 1.6, ly + 1.3, 0, { tela: 'naranja' });
  }
  m('green', x0 + 3.2, D - 1.6, 0);
  sitio(x0 + 1.4, D - 1.65, Math.PI / 2, 'golf', x0 + 1.4, D - 2.6, { golf: true });
  m('planta', x0 + 0.45, ty - 1.7, 0, { var: 1 });
  m('planta', x0 + 0.45, ty + 1.7, 0, { var: 2 });
  sitio(x1 - 0.85, ty - 0.2, Math.PI / 2, 'pie', x1 - 1.4, ty - 0.2, { baranda: true });
}

function amueblarCorredor(c, m, salas) {
  // Plantas y una banca contra las paredes, sin tapar ninguna puerta.
  const puertas = salas.map((s) => s.puerta);
  const libre = (x, y) => puertas.every((p) => Math.abs(p.y - y) > 1.2 || x < p.x0 - 0.7 || x > p.x1 + 0.7);
  let i = 0;
  for (let x = c.x0 + 4.5; x < c.x1 - 1; x += 5.3) {
    const y = i % 2 ? c.y1 - 0.42 : c.y0 + 0.42;
    if (libre(x, y)) m(i % 3 === 1 ? 'banca' : 'planta', x, y, i % 2 ? Math.PI : 0, { var: (i % 3) + 1 });
    i++;
  }
}

// ================================================================================================ la rejilla por la que se camina
function rejilla({ WT, salas, nucleo, muebles, puertaTerraza, W }) {
  const x0 = -0.4, y0 = -0.4;
  const cols = Math.ceil((WT + 0.8) / CELDA), filas = Math.ceil((D + 0.8) / CELDA);
  const bloq = new Uint8Array(cols * filas);
  const marcar = (ax, ay, bx, by, h = HOLGURA) => {
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - h - x0) / CELDA)), i1 = Math.min(cols - 1, Math.ceil((Math.max(ax, bx) + h - x0) / CELDA));
    const j0 = Math.max(0, Math.floor((Math.min(ay, by) - h - y0) / CELDA)), j1 = Math.min(filas - 1, Math.ceil((Math.max(ay, by) + h - y0) / CELDA));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const cx = x0 + (i + 0.5) * CELDA, cy = y0 + (j + 0.5) * CELDA;
      if (cx >= Math.min(ax, bx) - h && cx <= Math.max(ax, bx) + h && cy >= Math.min(ay, by) - h && cy <= Math.max(ay, by) + h) bloq[j * cols + i] = 1;
    }
  };
  // Fuera del edificio y de la terraza no se camina.
  for (let j = 0; j < filas; j++) for (let i = 0; i < cols; i++) {
    const cx = x0 + (i + 0.5) * CELDA, cy = y0 + (j + 0.5) * CELDA;
    if (cx < HOLGURA || cx > WT - HOLGURA - 0.1 || cy < HOLGURA || cy > D - HOLGURA) bloq[j * cols + i] = 1;
  }
  // Las paredes, con sus puertas.
  const pared = (ax, ay, bx, by, huecos = []) => {
    if (ay === by) {
      let a = Math.min(ax, bx);
      const b = Math.max(ax, bx);
      for (const h of [...huecos].sort((p, q) => p[0] - q[0])) { if (h[0] > a) marcar(a, ay, h[0], ay, 0.2); a = Math.max(a, h[1]); }
      if (a < b) marcar(a, ay, b, ay, 0.2);
    } else {
      let a = Math.min(ay, by);
      const b = Math.max(ay, by);
      for (const h of [...huecos].sort((p, q) => p[0] - q[0])) { if (h[0] > a) marcar(ax, a, ax, h[0], 0.2); a = Math.max(a, h[1]); }
      if (a < b) marcar(ax, a, ax, b, 0.2);
    }
  };
  for (const s of salas) {
    pared(s.x0, s.puerta.y, s.x1, s.puerta.y, [[s.puerta.x0, s.puerta.x1]]);
    const vecinoOeste = salas.some((o) => o !== s && o.fila === s.fila && Math.abs(o.x1 - s.x0) < 0.01);
    if (vecinoOeste) pared(s.x0, s.y0, s.x0, s.y1);
  }
  const ultimaN = salas.filter((s) => s.fila === 'n').at(-1), ultimaS = salas.filter((s) => s.fila === 's').at(-1);
  if (ultimaN) pared(ultimaN.x1, 0, ultimaN.x1, SALA);
  if (ultimaS) pared(ultimaS.x1, SALA + CORREDOR, ultimaS.x1, D);
  pared(W, 0, W, D, [[puertaTerraza.y0, puertaTerraza.y1]]);
  marcar(nucleo.x0, nucleo.y0, nucleo.x1, nucleo.y1, 0.24);
  for (const mu of muebles) {
    if (NO_BLOQUEA.has(mu.tipo) || mu.bloquea === false || mu.sobre) continue;
    const [w, d] = mu.tipo === 'alfombra' ? [mu.w, mu.d] : mu.tipo === 'jardinera' ? [mu.largo, 0.8] : HUELLA[mu.tipo] || [0.5, 0.5];
    const c = Math.abs(Math.cos(mu.rot)), s = Math.abs(Math.sin(mu.rot));
    const hw = (w * c + d * s) / 2, hd = (w * s + d * c) / 2;
    marcar(mu.x - hw, mu.y - hd, mu.x + hw, mu.y + hd, mu.tipo === 'silla' || mu.tipo === 'sillaComedor' || mu.tipo === 'taburete' ? 0.1 : HOLGURA);
  }
  return { x0, y0, cols, filas, bloq, celda: CELDA };
}

const libreEn = (nav, i, j) => i >= 0 && j >= 0 && i < nav.cols && j < nav.filas && !nav.bloq[j * nav.cols + i];
const aCelda = (nav, x, y) => [Math.floor((x - nav.x0) / nav.celda), Math.floor((y - nav.y0) / nav.celda)];
const alCentro = (nav, i, j) => ({ x: nav.x0 + (i + 0.5) * nav.celda, y: nav.y0 + (j + 0.5) * nav.celda });

/** La celda libre más cercana (por si el punto cae dentro de un mueble o pegado a una pared). */
function cercana(nav, x, y) {
  const [i0, j0] = aCelda(nav, x, y);
  if (libreEn(nav, i0, j0)) return [i0, j0];
  for (let r = 1; r < 30; r++) {
    let mejor = null, d = Infinity;
    for (let j = j0 - r; j <= j0 + r; j++) for (let i = i0 - r; i <= i0 + r; i++) {
      if (Math.max(Math.abs(i - i0), Math.abs(j - j0)) !== r || !libreEn(nav, i, j)) continue;
      const dd = (i - i0) ** 2 + (j - j0) ** 2;
      if (dd < d) { d = dd; mejor = [i, j]; }
    }
    if (mejor) return mejor;
  }
  return [i0, j0];
}

function hayVista(nav, a, b) {
  const pasos = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (nav.celda * 0.5));
  for (let k = 1; k < pasos; k++) {
    const u = k / pasos;
    const [i, j] = aCelda(nav, a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u);
    if (!libreEn(nav, i, j)) return false;
  }
  return true;
}

/** El camino de a a b esquivando muebles y paredes: A* sobre la rejilla y después en línea recta donde se pueda. */
export function caminoEntre(nav, a, b) {
  const [ia, ja] = cercana(nav, a.x, a.y), [ib, jb] = cercana(nav, b.x, b.y);
  const N = nav.cols * nav.filas;
  const g = new Float32Array(N).fill(Infinity);
  const de = new Int32Array(N).fill(-1);
  const cerrado = new Uint8Array(N);
  const inicio = ja * nav.cols + ia, meta = jb * nav.cols + ib;
  const h = (k) => { const i = k % nav.cols, j = (k / nav.cols) | 0; const dx = Math.abs(i - ib), dy = Math.abs(j - jb); return (dx + dy) + (Math.SQRT2 - 2) * Math.min(dx, dy); };
  // Un montículo binario sencillo.
  const mon = [], prio = [];
  const meter = (k, p) => {
    mon.push(k); prio.push(p);
    let i = mon.length - 1;
    while (i > 0) { const pa = (i - 1) >> 1; if (prio[pa] <= prio[i]) break; [mon[pa], mon[i]] = [mon[i], mon[pa]]; [prio[pa], prio[i]] = [prio[i], prio[pa]]; i = pa; }
  };
  const sacar = () => {
    const top = mon[0];
    const k = mon.pop(), p = prio.pop();
    if (mon.length) {
      mon[0] = k; prio[0] = p;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < mon.length && prio[l] < prio[m]) m = l;
        if (r < mon.length && prio[r] < prio[m]) m = r;
        if (m === i) break;
        [mon[m], mon[i]] = [mon[i], mon[m]]; [prio[m], prio[i]] = [prio[i], prio[m]]; i = m;
      }
    }
    return top;
  };
  g[inicio] = 0;
  meter(inicio, h(inicio));
  const vecinos = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
  let encontrado = false;
  while (mon.length) {
    const k = sacar();
    if (cerrado[k]) continue;
    if (k === meta) { encontrado = true; break; }
    cerrado[k] = 1;
    const i = k % nav.cols, j = (k / nav.cols) | 0;
    for (const [di, dj, c] of vecinos) {
      const ni = i + di, nj = j + dj;
      if (!libreEn(nav, ni, nj)) continue;
      if (di && dj && (!libreEn(nav, i + di, j) || !libreEn(nav, i, j + dj))) continue;   // sin cortar esquinas
      const nk = nj * nav.cols + ni;
      const ng = g[k] + c;
      if (ng < g[nk]) { g[nk] = ng; de[nk] = k; meter(nk, ng + h(nk)); }
    }
  }
  let puntos;
  if (!encontrado) puntos = [a, b];
  else {
    const celdas = [];
    for (let k = meta; k !== -1; k = de[k]) celdas.push(k);
    celdas.reverse();
    const crudo = [a, ...celdas.map((k) => alCentro(nav, k % nav.cols, (k / nav.cols) | 0)), b];
    // Se tira de la cuerda: de cada punto, al más lejano que se vea en línea recta.
    puntos = [crudo[0]];
    let i = 0;
    while (i < crudo.length - 1) {
      let j = crudo.length - 1;
      while (j > i + 1 && !hayVista(nav, crudo[i], crudo[j])) j--;
      puntos.push(crudo[j]);
      i = j;
    }
  }
  const tramos = [];
  let largo = 0;
  for (let k = 1; k < puntos.length; k++) { const l = Math.hypot(puntos[k].x - puntos[k - 1].x, puntos[k].y - puntos[k - 1].y); tramos.push(l); largo += l; }
  return { puntos, tramos, largo };
}

/** El punto y el rumbo a `s` metros del arranque. */
export function enRuta(ruta, s) {
  let resto = Math.max(0, Math.min(ruta.largo, s));
  for (let k = 0; k < ruta.tramos.length; k++) {
    const l = ruta.tramos[k];
    if (resto <= l || k === ruta.tramos.length - 1) {
      const a = ruta.puntos[k], b = ruta.puntos[k + 1];
      const u = l > 1e-6 ? Math.min(1, resto / l) : 1;
      return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, rumbo: Math.atan2(b.x - a.x, b.y - a.y) };
    }
    resto -= l;
  }
  const p = ruta.puntos.at(-1);
  return { x: p.x, y: p.y, rumbo: 0 };
}
