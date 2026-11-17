// LA OFICINA: los datos, quién está dónde, lo que camina, los rótulos, la cámara y el bucle de dibujo.
//
// Liviana a propósito: a 30 cuadros como mucho, a 60 solo mientras la cámara se mueve, y se detiene del todo, dibujo y
// consultas, mientras la pestaña no se ve. Solo lee lo que le da el servidor (/api/oficina): no escribe nada.
import * as THREE from './vendor/three.module.min.js';
import { OrbitControls } from './vendor/OrbitControls.js';
import { distribuir, caminoEntre, enRuta, hash, D, SALA, CORREDOR } from './plano3d.js';
import { crearMundo, ALTURA } from './mundo.js';
import { crearPersonas } from './personas.js';
import * as TX from './texturas.js';
import { crearPost } from './post.js';

const $ = (s) => document.querySelector(s);
const oficinaEl = $('.oficina');
const lienzo = $('.escena'), capaRotulos = $('.rotulos');
const resumenEl = $('.resumen'), filasEl = $('.filas'), zoomEl = $('.zoom');
const reducido = matchMedia('(prefers-reduced-motion: reduce)');
const params = new URLSearchParams(location.search);

const CONSULTA_MS = 2500;
const PASO = 1.45, PASO_RECADO = 1.95;       // metros por segundo: andando y llevando algo
const ABIERTOS = new Set(['nuevo', 'visto', 'en_curso', 'requiere_ok']);
const TINTA = { dia: ['#3A3A3C', '#8E8E93', '#1C1C1E', '#E5E5EA'], noche: ['#D1D5DB', '#FFFFFF', '#8E96A3', '#FFFFFF'] };
const MANOS = { terminal: 'teclear', escribiendo: 'teclear', equipo: 'teclear', leyendo: 'raton', navegador: 'raton', pensando: 'pensar' };

// ?tema=dia o ?tema=noche fija la luz sin guardarla (para una pantalla en la pared, o una captura).
const temaPedido = params.get('tema');
let tema = (['dia', 'noche'].includes(temaPedido) && temaPedido)
  || (() => { try { return localStorage.getItem('oficina.tema'); } catch { return null; } })()
  || (matchMedia('(prefers-color-scheme: dark)').matches ? 'noche' : 'dia');
if (!['dia', 'noche'].includes(tema)) tema = 'dia';

// ============================================================================================ tiempo y texto
const hhmm = (s) => (s ? String(s).slice(11, 16) : '');
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const hoyTexto = () => new Date().toLocaleString('sv').slice(0, 10);
function cuando(s) {
  if (!s) return '';
  const d = String(s).slice(0, 10);
  const ayer = new Date(Date.now() - 864e5).toLocaleString('sv').slice(0, 10);
  if (d === hoyTexto()) return `hoy, ${hhmm(s)}`;
  if (d === ayer) return `ayer, ${hhmm(s)}`;
  const [, m, dia] = d.split('-').map(Number);
  return `el ${dia} de ${MESES[m - 1]}, ${hhmm(s)}`;
}
const minutosDesde = (s) => (s ? (Date.now() - new Date(String(s).replace(' ', 'T')).getTime()) / 60000 : Infinity);
function hace(s) {
  const m = minutosDesde(s);
  if (!isFinite(m)) return '';
  if (m < 1) return 'hace un momento';
  if (m < 60) return `hace ${Math.round(m)} min`;
  return `desde las ${hhmm(s)}`;
}
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const suave = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
const angulo = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// ============================================================================================ la escena
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas: lienzo, antialias: true, powerPreference: 'high-performance' });
} catch {
  document.body.classList.add('sin-3d');
  throw new Error('Este navegador no dibuja 3D');
}
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;
const escena = new THREE.Scene();
const camara = new THREE.PerspectiveCamera(30, 1, 0.4, 1800);
const controles = new OrbitControls(camara, lienzo);
controles.enableDamping = true;
controles.dampingFactor = 0.09;
controles.zoomToCursor = true;
controles.screenSpacePanning = false;
controles.minDistance = 3.5;
controles.maxDistance = 300;
controles.minPolarAngle = 0.12;
controles.maxPolarAngle = 1.33;
controles.rotateSpeed = 0.55;
controles.panSpeed = 0.9;
controles.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
controles.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
if (params.has('vitrina')) { controles.autoRotate = true; controles.autoRotateSpeed = 0.25; }

const hemi = new THREE.HemisphereLight('#D6E7F6', '#B3A797', 1.1);
const sol = new THREE.DirectionalLight('#FFF2DE', 2.6);
sol.castShadow = true;
sol.shadow.mapSize.set(4096, 4096);
sol.shadow.bias = -0.00035;
sol.shadow.normalBias = 0.025;
sol.shadow.radius = 3;
escena.add(hemi, sol, sol.target);

// El render fino (oclusión, brillo y desenfoque de maqueta). Arranca en alta y baja solo si la gráfica no alcanza.
const post = crearPost(renderer, escena, camara);
const calidadPedida = ['alta', 'media', 'baja'].includes(params.get('calidad')) ? params.get('calidad') : null;
const pmrem = new THREE.PMREMGenerator(renderer);
/** El reflejo del cielo en los vidrios: una esfera con su degradado, del cielo al suelo. */
function entorno(noche) {
  const e = new THREE.Scene();
  const geo = new THREE.SphereGeometry(50, 32, 16);
  const c = [];
  const arriba = new THREE.Color(noche ? '#0B1222' : '#8FC2EC'), horizonte = new THREE.Color(noche ? '#3A1C2C' : '#F1EEE8'), abajo = new THREE.Color(noche ? '#07080A' : '#7A7670');
  for (let i = 0; i < geo.attributes.position.count; i++) {
    const y = geo.attributes.position.getY(i) / 50;
    const k = y > 0 ? horizonte.clone().lerp(arriba, Math.pow(y, 0.6)) : horizonte.clone().lerp(abajo, Math.min(1, -y * 3));
    c.push(k.r, k.g, k.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  e.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  if (!noche) { const s = new THREE.Mesh(new THREE.SphereGeometry(4, 16, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 8.4, 7.6) })); s.position.set(-22, 32, 26); e.add(s); }
  const rt = pmrem.fromScene(e, 0.03);
  geo.dispose();
  return rt.texture;
}

// ============================================================================================ el estado
let datos = null, plano = null, mundo = null, tropa = null, firma = '';
const rotulos = new Map();
const gente = new Map();          // slug -> lo que hace la persona ahora
const vistos = new Map();         // id del encargo -> estado
const pedidosVistos = new Set();
const enCaminoA = new Map();      // slug -> hojas que vienen en camino (todavía no están en su bandeja)
const caidas = new Map();         // slug -> instante en que le cayó una hoja
const pulsos = new Map();         // slug -> instante en que le llegó un pedido de la app
const vuelos = [];                // lo que va por el aire de una mano a una bandeja
let primera = true;
let resumen = null;
let encima = null;
let reloj = 0;

const paletaDe = (slug) => (slug === 'dueno' ? TINTA[tema] : datos?.puestos?.[slug]?.paleta || TINTA[tema]);
/** El nombre de la persona y, al lado, su cargo (los dos salen de oficina.config.json). */
const nombreVisual = (slug) => {
  const s = datos?.puestos?.[slug] || {};
  return { nombre: s.alias || s.nombre || slug, cargo: s.alias ? s.nombre : '', genero: s.genero };
};
const esVoz = (tipo) => tipo === 'voz' || tipo === 'voz-respuesta';

// ============================================================================================ la cámara
let casa = null;            // la vista de toda la oficina
let vuelo = null;
let movidaEn = 0;
const centroOficina = new THREE.Vector3(0, 1.0, 0);

function cajaOficina() {
  const { WT } = plano;
  return new THREE.Box3(new THREE.Vector3(-WT / 2 - 1, -0.6, -D / 2 - 1), new THREE.Vector3(WT / 2 + 1, 3.3, D / 2 + 1));
}
/** Las ocho esquinas de una caja (o de una lista de puntos) caben en el área libre de la pantalla. */
function distanciaQueEncuadra(caja, objetivo, az, polar, aire = 0.9) {
  const puntos = [];
  for (const x of [caja.min.x, caja.max.x]) for (const y of [caja.min.y, caja.max.y]) for (const z of [caja.min.z, caja.max.z]) puntos.push(new THREE.Vector3(x, y, z));
  const area = areaUtil();
  const c = camara.clone();
  let a = 2, b = 900;
  for (let k = 0; k < 32; k++) {
    const d = (a + b) / 2;
    ponerEn(c, objetivo, az, polar, d);
    c.updateMatrixWorld();
    let cabe = true;
    for (const p of puntos) {
      const q = p.clone().project(c);
      const sx = (q.x + 1) / 2 * innerWidth, sy = (1 - q.y) / 2 * innerHeight;
      if (q.z > 1 || sx < area.x0 + area.w * (1 - aire) / 2 || sx > area.x1 - area.w * (1 - aire) / 2 || sy < area.y0 + area.h * (1 - aire) / 2 || sy > area.y1 - area.h * (1 - aire) / 2) { cabe = false; break; }
    }
    if (cabe) b = d; else a = d;
  }
  return b;
}
function areaUtil() {
  const arriba = Math.max($('.cabeza').getBoundingClientRect().bottom + innerHeight * 0.02, innerHeight * 0.12);
  return { x0: innerWidth * 0.02, x1: innerWidth * 0.98, y0: arriba, y1: innerHeight * 0.97, w: innerWidth * 0.96, h: innerHeight * 0.97 - arriba };
}
function ponerEn(c, objetivo, az, polar, d) {
  c.position.set(objetivo.x + d * Math.sin(polar) * Math.sin(az), objetivo.y + d * Math.cos(polar), objetivo.z + d * Math.sin(polar) * Math.cos(az));
  c.lookAt(objetivo);
}
/** La vista en la que la caja queda centrada en el área libre: se corre el objetivo para que no la tape el título. */
function vistaQueEnmarca(caja, az = 0.62, polar = 0.93, aire = 0.92) {
  const objetivo = caja.getCenter(new THREE.Vector3());
  objetivo.y = Math.max(objetivo.y, 0.6);
  const d = distanciaQueEncuadra(caja, objetivo, az, polar, aire);
  // Corrimiento vertical: el centro del área útil no es el centro de la pantalla.
  const area = areaUtil();
  const dy = ((area.y0 + area.y1) / 2 - innerHeight / 2) / innerHeight;   // fracción de la pantalla
  const altoMundo = 2 * d * Math.tan(THREE.MathUtils.degToRad(camara.fov / 2));
  const arribaPantalla = new THREE.Vector3(-Math.cos(polar) * Math.sin(az), Math.sin(polar), -Math.cos(polar) * Math.cos(az));
  objetivo.addScaledVector(arribaPantalla, dy * altoMundo);
  return { objetivo, az, polar, d };
}
const vistaCasa = () => vistaQueEnmarca(cajaOficina());
function vistaDeZona(z) {
  const { CX, CY } = mundo;
  const caja = new THREE.Box3(new THREE.Vector3(z.x0 - CX, 0, z.y0 - CY), new THREE.Vector3(z.x1 - CX, 2.2, z.y1 - CY));
  return vistaQueEnmarca(caja, 0.5, 0.86, 0.9);
}
function vistaDePuesto(slug) {
  const { CX, CY } = mundo;
  const p = plano.puestos[slug];
  const g = gente.get(slug);
  const x = (g?.x ?? p.x) - CX, z = (g?.y ?? p.y) - CY;
  const caja = new THREE.Box3(new THREE.Vector3(x - 1.5, 0, z - 1.6), new THREE.Vector3(x + 1.5, 2.1, z + 1.4));
  return vistaQueEnmarca(caja, 0.42, 0.98, 0.6);
}
function vistaActual() {
  const off = camara.position.clone().sub(controles.target);
  const d = off.length();
  return { objetivo: controles.target.clone(), az: Math.atan2(off.x, off.z), polar: Math.acos(clamp(off.y / d, -1, 1)), d };
}
function volarA(meta, dur = 1100) {
  const a = vistaActual();
  let daz = angulo(meta.az - a.az);
  vuelo = { a, b: { ...meta, az: a.az + daz }, t0: performance.now(), dur: reducido.matches ? 1 : dur };
  controles.enabled = false;
}
function avanzarVuelo(ahora) {
  if (!vuelo) return;
  const u = clamp((ahora - vuelo.t0) / vuelo.dur, 0, 1), e = suave(u);
  const { a, b } = vuelo;
  const objetivo = a.objetivo.clone().lerp(b.objetivo, e);
  const d = Math.exp(Math.log(a.d) + (Math.log(b.d) - Math.log(a.d)) * e);
  controles.target.copy(objetivo);
  ponerEn(camara, objetivo, a.az + (b.az - a.az) * e, a.polar + (b.polar - a.polar) * e, d);
  movidaEn = ahora;
  if (u >= 1) { vuelo = null; controles.enabled = true; controles.update(); }
}
const estaEnCasa = () => {
  if (!casa) return true;
  const v = vistaActual();
  return v.objetivo.distanceTo(casa.objetivo) < 1.2 && Math.abs(v.d / casa.d - 1) < 0.06 && Math.abs(angulo(v.az - casa.az)) < 0.06 && Math.abs(v.polar - casa.polar) < 0.05;
};
controles.addEventListener('change', () => { movidaEn = performance.now(); });

function encuadrar() {
  const dpr = Number(params.get('dpr')) || Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(dpr);
  renderer.setSize(innerWidth, innerHeight, false);
  post.tamano();
  camara.aspect = innerWidth / innerHeight;
  camara.updateProjectionMatrix();
  if (!plano) return;
  const enCasa = !casa || estaEnCasa();
  casa = vistaCasa();
  if (enCasa && !vuelo) { controles.target.copy(casa.objetivo); ponerEn(camara, casa.objetivo, casa.az, casa.polar, casa.d); controles.update(); }
  movidaEn = performance.now();
}
let esperaEncuadre = 0;
window.addEventListener('resize', () => { clearTimeout(esperaEncuadre); esperaEncuadre = setTimeout(encuadrar, 120); });

// ============================================================================================ día y noche
function ponerTema(nuevo, guardar) {
  tema = nuevo;
  const noche = tema === 'noche';
  document.documentElement.dataset.tema = tema;
  for (const b of document.querySelectorAll('.tema button')) b.setAttribute('aria-checked', String(b.dataset.tema === tema));
  if (guardar) { try { localStorage.setItem('oficina.tema', tema); } catch { /* sin almacenamiento */ } }
  const viejo = escena.environment;
  escena.environment = entorno(noche);
  viejo?.dispose?.();
  escena.environmentIntensity = noche ? 0.32 : 0.75;
  if (escena.background?.dispose) escena.background.dispose();
  escena.background = TX.cielo(noche);
  escena.fog = new THREE.FogExp2(noche ? '#1D1220' : '#E9EDF0', noche ? 0.0024 : 0.0019);
  hemi.color.set(noche ? '#4A5878' : '#D6E7F6');
  hemi.groundColor.set(noche ? '#2A1E18' : '#B3A797');
  hemi.intensity = noche ? 0.55 : 1.15;
  // De noche el sol se vuelve la luz del techo: cálida y casi vertical, como las lámparas de una oficina.
  sol.color.set(noche ? '#FFD9A8' : '#FFF2DE');
  sol.intensity = noche ? 1.5 : 2.7;
  const dir = noche ? new THREE.Vector3(-0.18, 1, 0.24) : new THREE.Vector3(-0.62, 1, 0.66);
  sol.position.copy(dir.normalize().multiplyScalar(70));
  renderer.toneMappingExposure = noche ? 1.08 : 1.0;
  mundo?.noche(noche);
  post.ponerNoche(noche);
  renderer.shadowMap.needsUpdate = true;
}
for (const b of document.querySelectorAll('.tema button')) {
  b.addEventListener('click', () => {
    if (b.dataset.tema === tema) return;
    oficinaEl.classList.add('cambiando');
    setTimeout(() => { ponerTema(b.dataset.tema, true); oficinaEl.classList.remove('cambiando'); }, 260);
  });
}

// ============================================================================================ quién está dónde
// Cada uno se queda en su puesto, sentado: trabajando (tecleando, con el ratón o pensando), esperándote (girado en la silla,
// levanta la mano a ratos) o libre (recostado, con un café). Cerrado: la silla queda vacía. Solo se levanta para llevar algo
// (un encargo, un pedido) y vuelve a sentarse.
const SENTADAS = new Set(['sentado', 'sofa', 'taburete', 'tumbado']);

/** El sitio donde debería estar: { tipo, x, y, rumbo, acceso, pose }; o { tipo: 'fuera' } si su chat está cerrado. */
function destinoDe(slug) {
  const s = datos.puestos[slug] || {};
  const p = plano.puestos[slug];
  if (!p) return null;
  const sentado = (manos, extra = {}) => ({ tipo: 'escritorio', x: p.x, y: p.y, rumbo: p.yaw, acceso: p.acceso, pose: { que: 'sentado', manos, ...extra } });
  if (s.persona) return sentado('raton');
  if (s.estado === 'trabajando') return sentado(MANOS[s.actividad] || 'teclear');
  if (s.estado === 'espera') return sentado('saludar');
  if (s.estado === 'libre' || slug === 'recepcion') return sentado('cafe', { lleva: 'taza' });
  return { tipo: 'fuera' };
}

function nuevaPersona(slug) {
  const g = { slug, visible: false, x: 0, y: 0, rumbo: 0, modo: 'quieto', destino: null, recados: [], pose: { que: 'de_pie' }, s: 0, paso: 0 };
  gente.set(slug, g);
  return g;
}

/** Pone a cada uno en su sitio sin caminar (la primera vez que se abre la página). */
function ubicarDeUna() {
  for (const slug of Object.keys(plano.puestos)) {
    const g = gente.get(slug) || nuevaPersona(slug);
    const d = destinoDe(slug);
    g.destino = d;
    if (!d || d.tipo === 'fuera') { g.visible = false; g.modo = 'fuera'; continue; }
    Object.assign(g, { visible: true, x: d.x, y: d.y, rumbo: d.rumbo, modo: 'quieto', s: SENTADAS.has(d.pose.que) ? 1 : 0, pose: d.pose });
  }
}

/** Arranca a caminar hacia `meta` ({x, y}); `luego` se corre al llegar. */
function caminar(g, meta, rapido, luego) {
  const ruta = caminoEntre(plano.nav, { x: g.x, y: g.y }, meta);
  g.modo = 'caminando';
  g.ruta = ruta;
  g.recorrido = 0;
  g.vel = rapido ? PASO_RECADO : PASO;
  g.luego = luego;
}
/** Lo siguiente que hace alguien que está quieto: un recado pendiente, o volver a su silla, o irse. */
function decidir(g, t) {
  if (g.modo === 'caminando' || g.modo === 'levantandose' || g.modo === 'sentandose' || g.modo === 'entregando' || g.modo === 'acercandose') return;
  const recado = g.recados[0];
  const destino = destinoDe(g.slug);
  const p = plano.puestos[g.slug];
  const sentado = g.s > 0.5;
  if (!recado) {
    if (!destino || destino.tipo === 'fuera') {
      // Su chat se cerró: se levanta y la silla queda vacía.
      if (g.visible && sentado) { g.modo = 'levantandose'; g.t0 = t; return; }
      if (g.visible) { g.visible = false; g.modo = 'fuera'; }
      return;
    }
    g.destino = destino;
    if (g.visible && Math.hypot(g.x - destino.x, g.y - destino.y) < 0.05 && sentado) { g.pose = destino.pose; return; }
  }
  if (!g.visible) {
    // Llega: aparece de pie junto a su silla y se sienta (o sale de ahí mismo a llevar lo que tiene).
    Object.assign(g, { visible: true, x: p.acceso.x, y: p.acceso.y, rumbo: p.yaw, s: 0, pose: { que: 'de_pie' } });
    if (!recado) { g.modo = 'acercandose'; g.t0 = t; g.desde = { x: g.x, y: g.y, rumbo: g.rumbo }; }
    return;
  }
  // Sentado y con algo que llevar: primero se levanta.
  if (sentado) { g.modo = 'levantandose'; g.t0 = t; return; }
  if (recado) {
    const B = plano.puestos[recado.para];
    const alDueno = recado.para === 'dueno';
    const meta = alDueno ? { x: B.x + 1.05, y: B.y + 0.95 } : B.tipo === 'recepcion' ? { x: B.x + 2.0, y: B.y } : { x: B.x + 0.85, y: B.y + 0.45 };
    g.pose = { que: 'caminar', lleva: esVoz(recado.tipo) ? 'nota' : 'carpeta' };
    caminar(g, meta, true, () => { g.modo = 'entregando'; g.t0 = reloj; g.rumboMeta = Math.atan2(B.x - g.x, B.y - g.y); });
    return;
  }
  // De pie y sin nada que llevar: de vuelta a su silla.
  if (!destino || destino.tipo === 'fuera') return;
  g.pose = { que: 'caminar' };
  caminar(g, destino.acceso, false, () => { g.modo = 'acercandose'; g.t0 = reloj; g.desde = { x: g.x, y: g.y, rumbo: g.rumbo }; });
}

function simular(t, dt) {
  for (const g of gente.values()) {
    decidir(g, t);
    if (g.modo === 'caminando') {
      g.recorrido += g.vel * dt;
      const p = enRuta(g.ruta, g.recorrido);
      g.x = p.x; g.y = p.y;
      g.rumbo += clamp(angulo(p.rumbo - g.rumbo), -8 * dt, 8 * dt);
      g.paso += g.vel * dt;
      g.pose = { ...g.pose, que: 'caminar', paso: g.paso };
      if (g.recorrido >= g.ruta.largo - 1e-3) { g.modo = 'quieto'; const l = g.luego; g.luego = null; l?.(); }
    } else if (g.modo === 'levantandose') {
      const u = clamp((t - g.t0) / 0.5, 0, 1);
      g.s = 1 - suave(u);
      if (u >= 1) {
        // Se aparta del asiento hasta su punto de acceso.
        const d = plano.puestos[g.slug];
        g.modo = 'quieto';
        g.pose = { que: 'de_pie' };
        if (d?.acceso) { g.x = d.acceso.x; g.y = d.acceso.y; }
        g.s = 0;
      }
    } else if (g.modo === 'acercandose') {
      // Del punto de acceso al asiento, girando hacia donde mira.
      const d = g.destino;
      const u = clamp((t - g.t0) / 0.55, 0, 1), e = suave(u);
      g.x = g.desde.x + (d.x - g.desde.x) * e;
      g.y = g.desde.y + (d.y - g.desde.y) * e;
      g.rumbo = g.desde.rumbo + angulo(d.rumbo - g.desde.rumbo) * e;
      g.pose = SENTADAS.has(d.pose.que) ? { ...d.pose, s: 0 } : d.pose;
      if (u >= 1) {
        if (SENTADAS.has(d.pose.que)) { g.modo = 'sentandose'; g.t0 = t; }
        else { g.modo = 'quieto'; g.pose = d.pose; }
      }
    } else if (g.modo === 'sentandose') {
      const u = clamp((t - g.t0) / 0.55, 0, 1);
      g.s = suave(u);
      g.pose = g.destino.pose;
      if (u >= 1) { g.modo = 'quieto'; g.s = 1; }
    } else if (g.modo === 'entregando') {
      const u = clamp((t - g.t0) / 1.1, 0, 1);
      g.rumbo += clamp(angulo(g.rumboMeta - g.rumbo), -6 * dt, 6 * dt);
      const recado = g.recados[0];
      g.pose = { que: 'de_pie', lleva: u < 0.35 ? (esVoz(recado.tipo) ? 'nota' : 'carpeta') : null };
      if (!g.solto && u >= 0.35) {
        g.solto = true;
        lanzarVuelo(g, recado, t);
      }
      if (u >= 1) { g.recados.shift(); g.solto = false; g.modo = 'quieto'; g.pose = { que: 'de_pie' }; }
    }
  }
}

/** Lo que entrega vuela de la mano a la bandeja (un encargo) o a la esfera de quien lo recibe (una nota de voz). */
function lanzarVuelo(g, recado, t) {
  const B = plano.puestos[recado.para];
  const per = tropa.porSlug.get(g.slug);
  const desde = per?.manoEn ? per.manoEn.clone() : new THREE.Vector3(g.x, 1.0, g.y);
  let hasta;
  const voz = esVoz(recado.tipo);
  if (recado.para === 'dueno') hasta = new THREE.Vector3(B.x + 0.6, 0.8, B.y + 0.25);
  else if (voz) {
    const pr = tropa.porSlug.get(recado.para);
    hasta = pr && !pr.oculto && pr.cabezaEn ? pr.cabezaEn.clone().add(new THREE.Vector3(0, 0.32, 0)) : new THREE.Vector3(B.x, 1.6, B.y);
  } else {
    const b = mundo.bandejas.get(recado.para);
    hasta = b ? b.pos.clone().add(new THREE.Vector3(0, 0.02, 0)) : new THREE.Vector3(B.x, 0.8, B.y - 0.3);
  }
  vuelos.push({ desde, hasta, t0: t, dur: 0.62, voz, para: recado.para, tipo: recado.tipo, color: paletaDe(g.slug)[0] });
}

// ============================================================================================ lo que viene de la base
function lanzar(m) {
  const { de, para, tipo } = m;
  if (!plano?.puestos[de] || !plano?.puestos[para] || de === para) return;
  const g = gente.get(de) || nuevaPersona(de);
  if (tipo === 'encargo') enCaminoA.set(para, (enCaminoA.get(para) || 0) + 1);
  g.recados.push(m);
  // Si se acumulan, solo los últimos tres: la oficina cuenta lo que pasa, no hace fila.
  while (g.recados.length > 3) {
    const fuera = g.recados.splice(g.modo === 'caminando' || g.modo === 'entregando' ? 1 : 0, 1)[0];
    if (fuera?.tipo === 'encargo') enCaminoA.set(fuera.para, Math.max(0, (enCaminoA.get(fuera.para) || 1) - 1));
  }
}
const movEncargo = (e, tipo) => (tipo === 'respuesta'
  ? { de: e.para, para: e.de, tipo, cuando: e.cerrado || e.creado, texto: e.titulo }
  : { de: e.de, para: e.para, tipo, cuando: e.creado, texto: e.titulo });

function procesar(encargos, pedidos) {
  if (primera) {
    for (const e of encargos) vistos.set(e.id, e.estado);
    for (const p of pedidos) pedidosVistos.add(p.id);
    const eventos = [
      ...encargos.flatMap((e) => [movEncargo(e, 'encargo'), ...(!ABIERTOS.has(e.estado) && e.cerrado ? [movEncargo(e, 'respuesta')] : [])]),
      ...pedidos,
    ].sort((a, b) => String(a.cuando).localeCompare(String(b.cuando)));
    for (const ev of eventos.slice(-5)) alRegistro(ev);
    const ultimo = eventos[eventos.length - 1];
    if (ultimo && minutosDesde(ultimo.cuando) < 15) lanzar(ultimo);
    primera = false;
    return;
  }
  const nuevos = [];
  for (const e of encargos) {
    const antes = vistos.get(e.id);
    if (antes === undefined) { vistos.set(e.id, e.estado); nuevos.push(movEncargo(e, 'encargo')); }
    else if (antes !== e.estado) {
      vistos.set(e.id, e.estado);
      if (ABIERTOS.has(antes) && !ABIERTOS.has(e.estado)) nuevos.push(movEncargo(e, 'respuesta'));
    }
  }
  for (const p of pedidos) if (!pedidosVistos.has(p.id)) { pedidosVistos.add(p.id); nuevos.push(p); }
  nuevos.sort((a, b) => String(a.cuando).localeCompare(String(b.cuando)));
  for (const m of nuevos) { lanzar(m); alRegistro(m); }
}

// ============================================================================================ los rótulos
function rotuloDe(slug) {
  let el = rotulos.get(slug);
  if (el) return el;
  el = document.createElement('div');
  el.className = 'rotulo';
  el.setAttribute('role', 'listitem');
  el.innerHTML = '<div class="nombre"><span class="quien"></span><span class="cargo"></span></div><div class="estado"></div><div class="detalle"></div><div class="mas"></div>';
  el.style.setProperty('--i', String(rotulos.size));
  capaRotulos.append(el);
  rotulos.set(slug, el);
  return el;
}
function escribir(el, sel, texto) {
  const n = el.querySelector(sel);
  if (n.textContent !== texto) { n.textContent = texto; el._medida = null; }
}

const estadosAntes = new Map();
function pintarRotulos() {
  for (const [slug, s] of Object.entries(datos.puestos)) {
    if (!plano.puestos[slug]) continue;
    const el = rotuloDe(slug);
    el.style.setProperty('--c', paletaDe(slug)[0]);
    const clave = `${s.estado}|${s.frase}`;
    const cambio = estadosAntes.has(slug) && estadosAntes.get(slug) !== clave;
    estadosAntes.set(slug, clave);
    el.classList.remove('trabajando', 'espera', 'libre', 'cerrado', 'persona', 'cambia');
    el.classList.add(s.persona ? 'persona' : s.estado);
    if (cambio) { void el.offsetWidth; el.classList.add('cambia'); }
    // El nombre de la persona en la maqueta (solo aquí) y, al lado, su cargo de siempre.
    const v = nombreVisual(slug);
    escribir(el, '.quien', v.nombre);
    escribir(el, '.cargo', v.cargo);
    const quien = v.cargo ? `${v.nombre}, ${v.cargo}` : v.nombre;
    if (s.persona) {
      escribir(el, '.estado', s.esperan ? (s.esperan === 1 ? 'Te espera un agente' : `Te esperan ${s.esperan} agentes`) : 'Nadie te espera');
      escribir(el, '.detalle', '');
      escribir(el, '.mas', '');
      el.setAttribute('aria-label', `${quien}: ${el.querySelector('.estado').textContent}`);
      continue;
    }
    const frase = s.estado === 'libre' ? 'Libre' : s.estado === 'cerrado' ? 'Cerrado' : `${s.frase}${s.voz ? ' por voz' : ''}`;
    escribir(el, '.estado', frase);
    escribir(el, '.detalle', s.estado === 'trabajando' || s.estado === 'espera' ? (s.detalle && s.detalle !== 'por voz' ? s.detalle : '') : '');
    const bandejaTxt = s.bandeja ? ` · ${s.bandeja} ${s.bandeja === 1 ? 'encargo' : 'encargos'} en la bandeja` : '';
    const mas = s.estado === 'cerrado' ? `Último turno ${cuando(s.desde)}${bandejaTxt}`
      : s.estado === 'libre' ? `Libre ${s.desde ? `desde ${cuando(s.desde)}` : ''}${bandejaTxt}`
        : `${hace(s.inicio || s.desde)}${bandejaTxt}`;
    escribir(el, '.mas', mas.trim());
    el.setAttribute('aria-label', `${quien}: ${frase}${s.detalle ? `, ${s.detalle}` : ''}`);
  }
  for (const [slug, el] of rotulos) if (!datos.puestos[slug] || !plano.puestos[slug]) { el.remove(); rotulos.delete(slug); }
}

const _v = new THREE.Vector3();
function ubicarRotulos() {
  if (!plano || !mundo) return;
  const H = innerHeight, W = innerWidth;
  const tanF = Math.tan(THREE.MathUtils.degToRad(camara.fov / 2));
  const dObjetivo = camara.position.distanceTo(controles.target);
  capaRotulos.classList.toggle('cerca', dObjetivo < 24);
  const lista = [];
  for (const [slug, el] of rotulos) {
    const g = gente.get(slug);
    const per = tropa?.porSlug.get(slug);
    const p = plano.puestos[slug];
    let x, y, z;
    if (g?.visible && per && !per.oculto && per.cabezaEn) { x = per.cabezaEn.x; y = per.cabezaEn.y + 0.12; z = per.cabezaEn.z; }
    else { x = p.x; y = 1.25; z = p.y; }
    _v.set(x - mundo.CX, y, z - mundo.CY);
    const dist = _v.distanceTo(camara.position);
    _v.project(camara);
    const fuera = _v.z > 1 || _v.x < -1.15 || _v.x > 1.15 || _v.y < -1.2 || _v.y > 1.2;
    const sx = (_v.x + 1) / 2 * W, sy = (1 - _v.y) / 2 * H;
    const ppm = H / (2 * dist * tanF);
    const u = clamp(Math.pow(ppm, 0.56) * 8, 36, 96);
    lista.push({ el, sx, sy, u, dist, fuera, ausente: !g?.visible });
  }
  // Los rótulos que se pisan: el más cercano se queda entero; el de atrás sube encima del otro si cabe cerca de su persona, y si
  // no, se queda solo con el nombre. El tamaño de cada uno se mide de verdad (en unidades de --u) cuando cambia su texto.
  const cerca = capaRotulos.classList.contains('cerca');
  // Primero los que están (su rótulo manda), después las sillas vacías; entre iguales, el más cercano.
  lista.sort((a, b) => (a.ausente - b.ausente) || (a.dist - b.dist));
  const puestos = [];
  const medir = (el, compacto) => {
    const k = `${cerca}|${compacto}`;
    if (el._medida?.k !== k) {
      el.classList.toggle('compacto', compacto);
      const u = parseFloat(el._u) || 40;
      el._medida = { k, w: el.offsetWidth / u, h: el.offsetHeight / u };
    }
    return el._medida;
  };
  for (const r of lista) {
    if (r.fuera) { if (!r.el.classList.contains('oculto')) r.el.classList.add('oculto'); continue; }
    r.el.classList.remove('oculto');
    // La escala va antes de medir: medido con otra, el tamaño sale mal y los rótulos se pisan.
    const us = `${r.u.toFixed(1)}px`;
    if (r.el._u !== us) { r.el.style.setProperty('--u', us); r.el._u = us; }
    const choca = (x, y, w, h) => puestos.find((q) => Math.abs(q.x - x) < (w + q.w) / 2 && y - h < q.y && y > q.y - q.h);
    let compacto = false;
    let m = medir(r.el, false);
    let w = m.w * r.u, h = m.h * r.u, y = r.sy;
    // Una silla vacía no se corre: si su nombre pisa a otro, se calla (sale al pasar el cursor por encima).
    if (r.ausente && !r.el.classList.contains('encima') && choca(r.sx, y, w * 1.06, h)) { r.el.classList.add('oculto'); continue; }
    for (let intento = 0; intento < 4; intento++) {
      const c = choca(r.sx, y, w, h);
      if (!c) break;
      y = c.y - c.h - 3;
    }
    if (r.sy - y > r.u * 1.6 || choca(r.sx, y, w, h)) {
      compacto = true;
      m = medir(r.el, true);
      w = m.w * r.u; h = m.h * r.u; y = r.sy;
      for (let intento = 0; intento < 3; intento++) { const c = choca(r.sx, y, w, h); if (!c) break; y = c.y - c.h - 2; }
    }
    // El nombre de una silla vacía que igual se pisa con otro, se calla (sale al pasar el cursor por encima).
    if (r.ausente && choca(r.sx, y, w, h) && !r.el.classList.contains('encima')) { r.el.classList.add('oculto'); continue; }
    puestos.push({ x: r.sx, y, w, h });
    if (r.el.classList.contains('compacto') !== compacto) r.el.classList.toggle('compacto', compacto);
    const t = `${r.sx.toFixed(1)}px ${y.toFixed(1)}px`;
    if (r.el._t !== t) { r.el.style.translate = t; r.el._t = t; }
    r.el.style.zIndex = String(1000 - Math.round(r.dist));
  }
}

// ============================================================================================ resumen y registro
function pintarResumen() {
  const v = Object.values(datos.puestos).filter((s) => !s.persona);
  const n = (e) => v.filter((s) => s.estado === e).length;
  const d = new Date();
  const partes = [
    `${DIAS[d.getDay()][0].toUpperCase()}${DIAS[d.getDay()].slice(1)} ${d.getDate()} de ${MESES[d.getMonth()]}, ${d.toTimeString().slice(0, 5)}`,
    `<b>${n('trabajando')}</b> trabajando`,
    `<b>${n('espera')}</b> ${n('espera') === 1 ? 'te espera' : 'te esperan'}`,
    `<b>${n('libre')}</b> ${n('libre') === 1 ? 'libre' : 'libres'}`,
    `<b>${n('cerrado')}</b> ${n('cerrado') === 1 ? 'cerrado' : 'cerrados'}`,
  ];
  const html = partes.join('<span class="sep">·</span>');
  if (resumenEl.innerHTML !== html) resumenEl.innerHTML = html;
  const r = { trabajando: n('trabajando'), espera: n('espera'), libre: n('libre'), cerrado: n('cerrado') };
  const hora = d.toTimeString().slice(0, 5);
  const f = JSON.stringify(r) + hora;
  if (f !== resumen) { resumen = f; mundo.pintarTeles(r, hora); }
}
const nombreDe = (slug) => datos?.puestos?.[slug]?.nombre || slug;
function fila(m) {
  const li = document.createElement('li');
  li.className = m.tipo;
  const hora = document.createElement('span'); hora.className = 'hora'; hora.textContent = hhmm(m.cuando);
  const ruta = document.createElement('span'); ruta.className = 'ruta';
  const quien = (slug) => {
    const s = document.createElement('span');
    const v = nombreVisual(slug);
    s.textContent = v.nombre;
    s.style.color = slug === 'dueno' ? 'var(--texto)' : paletaDe(slug)[0];
    if (v.cargo && slug !== 'recepcion') { const c = document.createElement('span'); c.className = 'cargo'; c.textContent = v.cargo; s.append(c); }
    return s;
  };
  const flecha = document.createElement('span'); flecha.className = 'flecha'; flecha.textContent = '→';
  ruta.append(quien(m.de), flecha, quien(m.para));
  const que = document.createElement('span'); que.className = 'que'; que.textContent = m.texto;
  li.append(hora, ruta, que);
  return li;
}
function alRegistro(m) {
  filasEl.prepend(fila(m));
  while (filasEl.children.length > 5) filasEl.lastElementChild.remove();
}

// ============================================================================================ las bandejas y lo que vuela
let mPilas = null, mVuelos = null;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
let slugsBandeja = [];
function crearBandejasYVuelos() {
  slugsBandeja = [...mundo.bandejas.keys()];
  mPilas = new THREE.InstancedMesh(new THREE.BoxGeometry(0.24, 1, 0.19).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: '#F6F3EC', roughness: 0.9, fog: false }), slugsBandeja.length);
  mPilas.castShadow = false; mPilas.receiveShadow = true;
  mundo.grupo.add(mPilas);
  mVuelos = new THREE.InstancedMesh(new THREE.BoxGeometry(0.24, 0.012, 0.3), new THREE.MeshStandardMaterial({ color: '#F6F3EC', roughness: 0.8, fog: false }), 8);
  mVuelos.count = 0;
  mVuelos.frustumCulled = false;
  mundo.grupo.add(mVuelos);
  // La nota de voz que vuela es una esfera de luz.
  mNotas = new THREE.InstancedMesh(new THREE.SphereGeometry(0.07, 16, 10), new THREE.MeshBasicMaterial({ toneMapped: false, fog: false }), 8);
  mNotas.count = 0;
  mNotas.frustumCulled = false;
  mundo.grupo.add(mNotas);
}
let mNotas = null;
function actualizarBandejas(t) {
  slugsBandeja.forEach((slug, k) => {
    const b = mundo.bandejas.get(slug);
    const s = datos.puestos[slug] || {};
    const n = Math.max(0, (s.bandeja || 0) - (enCaminoA.get(slug) || 0));
    const caida = caidas.has(slug) ? Math.max(0, 0.012 * Math.sin(Math.min(1, (t - caidas.get(slug)) / 0.35) * Math.PI)) : 0;
    const alto = n ? Math.min(0.11, 0.008 + Math.min(n, 30) * 0.0034) : 0;
    _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.rot + ((hash(slug) % 7) - 3) * 0.02);
    _m.compose(_p.copy(b.pos).add(new THREE.Vector3(0, caida, 0)), _q, _s.set(1, Math.max(1e-4, alto), 1));
    mPilas.setMatrixAt(k, _m);
  });
  mPilas.instanceMatrix.needsUpdate = true;
  let nv = 0, nn = 0;
  for (let i = vuelos.length - 1; i >= 0; i--) {
    const v = vuelos[i];
    const u = (t - v.t0) / v.dur;
    if (u >= 1) {
      vuelos.splice(i, 1);
      if (v.tipo === 'encargo') { enCaminoA.set(v.para, Math.max(0, (enCaminoA.get(v.para) || 1) - 1)); caidas.set(v.para, t); }
      if (v.voz) pulsos.set(v.para, t);
      continue;
    }
    const e = suave(clamp(u, 0, 1));
    _p.copy(v.desde).lerp(v.hasta, e);
    _p.y += Math.sin(Math.PI * e) * 0.32;
    if (v.voz && nn < 8) {
      _m.compose(_p, _q.identity(), _s.setScalar(1 - e * 0.4));
      mNotas.setMatrixAt(nn, _m);
      mNotas.setColorAt(nn, new THREE.Color(v.color));
      nn++;
    } else if (!v.voz && nv < 8) {
      _q.setFromEuler(new THREE.Euler(0.4 * (1 - e), e * 2, 0));
      _m.compose(_p, _q, _s.set(1, 1, 1));
      mVuelos.setMatrixAt(nv++, _m);
    }
  }
  mVuelos.count = nv; mVuelos.instanceMatrix.needsUpdate = true;
  mNotas.count = nn; mNotas.instanceMatrix.needsUpdate = true;
  if (mNotas.instanceColor) mNotas.instanceColor.needsUpdate = true;
}

// ============================================================================================ los datos
// Con el servidor (node server.mjs), los datos salen de /api/oficina. Publicada como sitio estático (GitHub Pages, Vercel,
// cualquier carpeta servida), no hay /api: la página carga oficina.config.json y corre la simulación del modo demo ella misma.
let estatica = null;
async function configEstatica() {
  for (const u of ['oficina.config.json', 'oficina.config.ejemplo.json']) {
    try { const r = await fetch(u, { cache: 'no-store' }); if (r.ok) return await r.json(); } catch { /* el siguiente */ }
  }
  return null;
}
async function pedirOficina() {
  if (!estatica) {
    try {
      const r = await fetch('/api/oficina', { cache: 'no-store' });
      if (r.ok && (r.headers.get('content-type') || '').includes('json')) return await r.json();
    } catch { /* sin servidor */ }
    const config = await configEstatica();
    if (!config) return null;
    const { crearSimulacion } = await import('./simulacion.js');
    estatica = { config, sim: crearSimulacion(config) };
  }
  return estatica.sim.foto();
}

let consulta = 0;
async function cargar() {
  clearTimeout(consulta);
  try {
    const j = await pedirOficina();
    if (j) {
      datos = j;
      const f = JSON.stringify(j.zonas);
      if (f !== firma) { firma = f; await construir(j); }
      procesar(j.encargos || [], j.pedidos || []);
      pintarRotulos();
      pintarResumen();
      for (const slug of Object.keys(plano.puestos)) {
        const s = j.puestos[slug] || {};
        if (s.persona) continue;
        mundo.ponerPantalla(slug, s.estado === 'trabajando' ? (s.actividad === 'equipo' ? 'terminal' : s.actividad || 'pensando') : s.estado === 'espera' ? 'espera' : s.estado === 'libre' ? 'libre' : 'apagada');
      }
      oficinaEl.setAttribute('aria-busy', 'false');
      if (!oficinaEl.classList.contains('lista')) requestAnimationFrame(() => requestAnimationFrame(() => oficinaEl.classList.add('lista')));
    }
  } catch (e) { if (!mundo) console.error(e); }
  const quieta = performance.now() - ultimo > 5000;
  if (!document.hidden) consulta = setTimeout(cargar, quieta ? 20000 : CONSULTA_MS);
}

let logoSvg = '', isotipoSvg = '';
async function construir(j) {
  // La primera vez: las fuentes de la marca y los logos, antes de pintar letreros.
  if (!logoSvg) {
    await Promise.all([document.fonts.load('600 64px Archivo'), document.fonts.load('500 32px "Space Grotesk"')]).catch(() => {});
    // La marca: el título, los colores y los dos logos, de oficina.config.json.
    const marca = estatica ? (estatica.config.marca || {}) : await fetch('/api/marca', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({}));
    if (marca.colores) TX.ponerMarca(marca.colores);
    if (marca.titulo) { document.title = marca.titulo; $('.cabeza h1').textContent = marca.titulo; }
    if (marca.nombre) oficinaEl.setAttribute('aria-label', `La oficina de ${marca.nombre}`);
    [logoSvg, isotipoSvg] = await Promise.all([marca.logo || 'marca/logo.svg', marca.isotipo || 'marca/isotipo.svg'].map((u) => fetch(u).then((r) => r.text())));
  }
  if (mundo) { escena.remove(mundo.grupo); /* la ciudad se queda: es la misma */ }
  for (const o of [...escena.children]) if (o !== hemi && o !== sol && o !== sol.target) escena.remove(o);
  plano = distribuir(j.zonas, j.puestos);
  mundo = await crearMundo({ escena, plano, renderer, logoSvg, isotipoSvg, datos: j });
  const quienes = Object.keys(plano.puestos).map((slug) => {
    const s = j.puestos[slug] || {};
    if (slug === 'dueno') return { slug, camisa: s.camisa || '#16171A', persona: true, piel: '#E7BF9C', pelo: '#2A1D16', largo: s.genero === 'f', pantalon: '#2B2D31' };
    return { slug, camisa: s.camisa || s.paleta?.[0] || '#8E8E93', largo: s.genero === 'f' };
  });
  tropa = crearPersonas(mundo.grupo, quienes, TX.sombraSuave(), TX.halo());
  crearBandejasYVuelos();
  // Las sombras se pintan una vez, sobre la oficina: el sol mira a su centro y su caja la cubre entera.
  sol.target.position.set(0, 0, 0);
  const lado = Math.max(plano.WT, D) / 2 + 8;
  Object.assign(sol.shadow.camera, { left: -lado, right: lado, top: lado, bottom: -lado, near: 10, far: 170 });
  sol.shadow.camera.updateProjectionMatrix();
  if (!post.nivel) post.armar(calidadPedida || 'alta');
  ponerTema(tema, false);
  ubicarDeUna();
  gente.forEach((g) => { if (!plano.puestos[g.slug]) gente.delete(g.slug); });
  casa = null;
  construidoEn = performance.now();
  encuadrar();
  const pedida = params.get('zona');
  const z = ['comedor', 'social', 'sala'].includes(pedida) ? plano.social : pedida === 'terraza' ? plano.terraza : plano.salas.find((s) => s.clave === pedida);
  if (z) { const v = vistaDeZona(z); controles.target.copy(v.objetivo); ponerEn(camara, v.objetivo, v.az, v.polar, v.d); controles.update(); }
  const p = params.get('puesto');
  if (p && plano.puestos[p]) { const v = vistaDePuesto(p); controles.target.copy(v.objetivo); ponerEn(camara, v.objetivo, v.az, v.polar, v.d); controles.update(); }
}

// ============================================================================================ el cuadro
let cuadro = 0, ultimo = 0, cuadrosSeg = 0, segundoEn = 0, lentos = 0, construidoEn = 0;
const medida = { ms: 0, fps: 0, llamadas: 0, triangulos: 0 };
window.oficinaMedida = medida;
// Para medir y revisar desde la consola; la página no lo usa.
window.oficina3d = { escena, camara, controles, renderer, gente, post, get mundo() { return mundo; }, get plano() { return plano; } };
function bucle(ahora) {
  cuadro = requestAnimationFrame(bucle);
  avanzarVuelo(ahora);
  const moviendo = !!vuelo || ahora - movidaEn < 300;
  const fps = moviendo ? 60 : reducido.matches ? 15 : 30;
  if (ahora - ultimo < 1000 / fps - 1.5) return;
  if (ultimo && ahora - ultimo > 5000) setTimeout(cargar, 0);
  const dt = ultimo ? Math.min(0.1, (ahora - ultimo) / 1000) : 0;
  ultimo = ahora;
  if (!mundo || !datos) return;
  const t0 = performance.now();
  reloj += dt;
  if (!vuelo) controles.update(dt);
  // Que la cámara no se pierda: el objetivo se queda cerca de la torre.
  const tg = controles.target;
  const lim = 240;
  if (Math.abs(tg.x) > lim || Math.abs(tg.z) > lim || tg.y < -ALTURA || tg.y > 12) {
    tg.set(clamp(tg.x, -lim, lim), clamp(tg.y, -ALTURA, 12), clamp(tg.z, -lim, lim));
  }
  simular(reloj, dt);
  const poses = new Map();
  for (const g of gente.values()) {
    if (!g.visible) continue;
    const pulso = pulsos.has(g.slug) ? Math.max(0, 1 - (reloj - pulsos.get(g.slug)) / 1.1) : 0;
    const s = datos.puestos[g.slug] || {};
    const brillo = s.persona ? 0 : s.estado === 'trabajando' ? 1 : s.estado === 'espera' ? 0.75 + Math.sin(reloj * 2.4) * 0.25 : 0.35;
    poses.set(g.slug, { visible: true, x: g.x, y: g.y, rumbo: g.rumbo, ...g.pose, s: g.s, esfera: brillo + pulso, pulso, esferaSube: s.estado === 'espera' ? 0.12 : 0 });
  }
  const t1 = performance.now();
  tropa.actualizar(reloj, poses);
  actualizarBandejas(reloj);
  mundo.actualizar(reloj, reducido.matches ? 0 : dt, camara);
  const t2 = performance.now();
  post.enfocar(camara.position.distanceTo(controles.target));
  post.dibujar(dt);
  const t3 = performance.now();
  ubicarRotulos();
  pintarZoom();
  medida.simular = (medida.simular || 0) * 0.95 + (t1 - t0) * 0.05;
  medida.mover = (medida.mover || 0) * 0.95 + (t2 - t1) * 0.05;
  medida.dibujar = (medida.dibujar || 0) * 0.95 + (t3 - t2) * 0.05;
  medida.rotulos = (medida.rotulos || 0) * 0.95 + (performance.now() - t3) * 0.05;
  medida.ms = medida.ms * 0.95 + (performance.now() - t0) * 0.05;
  // Los cuadros que de verdad salen por segundo (si la tarjeta gráfica no alcanza, aquí se nota).
  cuadrosSeg++;
  if (ahora - segundoEn >= 1000) {
    medida.real = Math.round(cuadrosSeg * 1000 / (ahora - segundoEn));
    cuadrosSeg = 0; segundoEn = ahora;
    // Si la tarjeta gráfica no da los cuadros que se piden, se baja la resolución un escalón (nunca por debajo de 1, ni si la
    // pidió la dirección con ?dpr). Tres segundos seguidos cortos, para no bajar por un tirón.
    const pedidos = moviendo ? 50 : fps;
    // Los primeros segundos no cuentan: ahí se compilan los sombreadores y se suben las texturas, y cualquier tarjeta va lenta.
    const calentando = performance.now() - construidoEn < 8000;
    lentos = !calentando && medida.real < pedidos * 0.72 && !document.hidden ? lentos + 1 : 0;
    // Primero se sueltan los efectos (la oclusión, después el brillo y el desenfoque) y solo después la resolución.
    if (lentos >= 3 && !calidadPedida && post.nivel !== 'baja') {
      post.armar(post.nivel === 'alta' ? 'media' : 'baja');
      post.ponerNoche(tema === 'noche');
      lentos = 0;
      construidoEn = performance.now();   // el cambio también compila: se vuelve a calentar antes de juzgar
    } else if (lentos >= 3 && !params.get('dpr') && renderer.getPixelRatio() > 1.01) {
      renderer.setPixelRatio(Math.max(1, renderer.getPixelRatio() * 0.82));
      renderer.setSize(innerWidth, innerHeight, false);
      post.tamano();
      medida.dpr = +renderer.getPixelRatio().toFixed(2);
      lentos = 0;
      construidoEn = performance.now();
    }
    medida.calidad = post.nivel;
  }
  medida.fps = fps;
  medida.llamadas = renderer.info.render.calls;
  medida.triangulos = renderer.info.render.triangles;
}
function arrancar() {
  cancelAnimationFrame(cuadro);
  ultimo = 0;
  cuadro = requestAnimationFrame(bucle);
  cargar();
}
function parar() {
  cancelAnimationFrame(cuadro);
  clearTimeout(consulta);
}
document.addEventListener('visibilitychange', () => (document.hidden ? parar() : arrancar()));

// ============================================================================================ tocar, pasar el cursor y las teclas
// Arrastrar gira la maqueta (con el botón derecho, o con Shift, se corre); la rueda acerca donde está el cursor. Un toque en
// una sala la enmarca; ya cerca, un toque en una persona la enmarca a ella; fuera de la oficina, vuelve a la vista entera.
const rayo = new THREE.Raycaster();
const pisoPlano = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
function alPiso(cx, cy) {
  const ndc = new THREE.Vector2((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1);
  rayo.setFromCamera(ndc, camara);
  const p = new THREE.Vector3();
  if (!rayo.ray.intersectPlane(pisoPlano, p)) return null;
  return { x: p.x + mundo.CX, y: p.z + mundo.CY };
}
function personaBajo(cx, cy) {
  let mejor = null, d = 46;
  for (const [slug, g] of gente) {
    if (!g.visible) continue;
    const per = tropa.porSlug.get(slug);
    if (!per?.cabezaEn) continue;
    for (const h of [0, -0.55]) {
      _v.set(per.cabezaEn.x - mundo.CX, per.cabezaEn.y + h, per.cabezaEn.z - mundo.CY).project(camara);
      const sx = (_v.x + 1) / 2 * innerWidth, sy = (1 - _v.y) / 2 * innerHeight;
      const dd = Math.hypot(sx - cx, sy - cy);
      if (dd < d) { d = dd; mejor = slug; }
    }
  }
  return mejor;
}
function queHariaUnToque(cx, cy) {
  if (!plano) return null;
  const v = vistaActual();
  const slug = personaBajo(cx, cy);
  const piso = alPiso(cx, cy);
  const zona = piso && plano.salas.find((z) => piso.x >= z.x0 && piso.x <= z.x1 && piso.y >= z.y0 && piso.y <= z.y1);
  if (slug) {
    const vp = vistaDePuesto(slug);
    const vz = zona && vistaDeZona(zona);
    if (vz && v.d > vz.d * 1.15) return vz;
    if (v.d > vp.d * 1.12) return vp;
  }
  if (zona) { const vz = vistaDeZona(zona); if (v.d > vz.d * 1.12) return vz; return null; }
  const dentro = piso && piso.x >= -1 && piso.x <= plano.WT + 1 && piso.y >= -1 && piso.y <= D + 1;
  if (!dentro && !estaEnCasa()) return casa;
  return null;
}
let abajo = null;
lienzo.addEventListener('pointerdown', (ev) => { abajo = { x: ev.clientX, y: ev.clientY, t: performance.now(), b: ev.button }; if (vuelo) { vuelo = null; controles.enabled = true; } });
lienzo.addEventListener('pointerup', (ev) => {
  if (!abajo) return;
  const quieto = Math.hypot(ev.clientX - abajo.x, ev.clientY - abajo.y) < 6 && performance.now() - abajo.t < 900 && abajo.b === 0;
  abajo = null;
  if (!quieto) return;
  const meta = queHariaUnToque(ev.clientX, ev.clientY);
  if (meta) volarA(meta);
});
let ultimoSobre = 0;
lienzo.addEventListener('pointermove', (ev) => {
  if (ev.buttons) { oficinaEl.classList.add('arrastrando'); return; }
  oficinaEl.classList.remove('arrastrando');
  const ahora = performance.now();
  if (ahora - ultimoSobre < 60 || !plano) return;
  ultimoSobre = ahora;
  const slug = personaBajo(ev.clientX, ev.clientY);
  if (slug !== encima) {
    if (encima) rotulos.get(encima)?.classList.remove('encima');
    encima = slug;
    if (encima) rotulos.get(encima)?.classList.add('encima');
  }
  oficinaEl.classList.toggle('acercable', !!queHariaUnToque(ev.clientX, ev.clientY));
});
lienzo.addEventListener('pointerleave', () => { if (encima) rotulos.get(encima)?.classList.remove('encima'); encima = null; oficinaEl.classList.remove('arrastrando'); });
lienzo.addEventListener('contextmenu', (ev) => ev.preventDefault());

function dolly(f) {
  const v = vistaActual();
  volarA({ ...v, d: clamp(v.d * f, controles.minDistance, controles.maxDistance) }, 420);
}
window.addEventListener('keydown', (ev) => {
  if (ev.target.closest?.('button') && ev.key === 'Escape') ev.target.blur();
  const v = vistaActual();
  if (ev.key === '+' || ev.key === '=') dolly(1 / 1.4);
  else if (ev.key === '-' || ev.key === '_') dolly(1.4);
  else if (ev.key === 'Escape' || ev.key === '0') { if (casa) volarA(casa); }
  else if (ev.key === 'ArrowLeft') volarA({ ...v, az: v.az - 0.26 }, 380);
  else if (ev.key === 'ArrowRight') volarA({ ...v, az: v.az + 0.26 }, 380);
  else if (ev.key === 'ArrowUp') volarA({ ...v, polar: clamp(v.polar - 0.12, controles.minPolarAngle, controles.maxPolarAngle) }, 380);
  else if (ev.key === 'ArrowDown') volarA({ ...v, polar: clamp(v.polar + 0.12, controles.minPolarAngle, controles.maxPolarAngle) }, 380);
  else return;
  ev.preventDefault();
});
for (const b of zoomEl.querySelectorAll('button')) {
  b.addEventListener('click', () => {
    if (b.dataset.zoom === 'todo') { if (casa) volarA(casa); return; }
    dolly(b.dataset.zoom === 'mas' ? 1 / 1.6 : 1.6);
  });
}
let zoomAntes = '';
function pintarZoom() {
  const v = vistaActual();
  const lejos = v.d >= controles.maxDistance - 0.5, cerca = v.d <= controles.minDistance + 0.1;
  const f = `${!estaEnCasa()}|${lejos}|${cerca}`;
  if (f === zoomAntes) return;
  zoomAntes = f;
  zoomEl.classList.toggle('acercado', !estaEnCasa());
  document.documentElement.classList.toggle('acercada', !estaEnCasa());
  zoomEl.querySelector('[data-zoom="mas"]').disabled = cerca;
  zoomEl.querySelector('[data-zoom="menos"]').disabled = lejos;
}

document.documentElement.dataset.tema = tema;
for (const b of document.querySelectorAll('.tema button')) b.setAttribute('aria-checked', String(b.dataset.tema === tema));
oficinaEl.setAttribute('aria-busy', 'true');
encuadrar();
arrancar();
