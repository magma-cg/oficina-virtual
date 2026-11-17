// LA OFICINA VIRTUAL: el servidor. Sin dependencias (solo Node 18 o más nuevo).
//
//   node server.mjs                 abre http://127.0.0.1:5250
//   node server.mjs --puerto 8080   en otro puerto
//   node server.mjs estado          dice en la consola lo mismo que la página
//
// Lee oficina.config.json: la marca, las zonas y los agentes. Tiene dos fuentes de datos:
//   · «demo» (la de siempre si no se dice otra): los agentes trabajan, esperan, descansan, se mandan encargos y reciben
//     pedidos tuyos, todo simulado. Sirve para verla viva sin conectar nada.
//   · «claude»: cada agente que tenga «claude» en la configuración lee la sesión más reciente de Claude Code de esa carpeta
//     (~/.claude/projects/<proyecto>) y la oficina enseña lo que de verdad está haciendo: en la terminal, leyendo,
//     escribiendo, en el navegador, pensando o esperándote. Con «"claude": "auto"» toma tus sesiones más recientes.
//
// Solo escucha en 127.0.0.1 y solo lee: no escribe en ningún lado ni despierta a nadie.
import { createServer } from 'node:http';
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const PUBLICO = join(AQUI, 'public');
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const HOST = '127.0.0.1';

// ============================================================================================ la configuración
const rutaConfig = arg('--config') || join(AQUI, existsSync(join(AQUI, 'oficina.config.json')) ? 'oficina.config.json' : 'oficina.config.ejemplo.json');
const config = JSON.parse(readFileSync(rutaConfig, 'utf8'));
const PUERTO = Number(arg('--puerto') || process.env.OFICINA_PUERTO || config.puerto) || 5250;
const FUENTE = arg('--fuente') || config.fuente || 'demo';
const casa = (p) => String(p || '').replace(/^~(?=$|[\\/])/, homedir());

// Los puestos y la simulación del modo demo viven en public/simulacion.js: los usa también la página cuando está publicada
// como sitio estático, sin este servidor.
const { puestosDe, zonasDe, puestoVacio, crearSimulacion, ahoraTexto } = await import(pathToFileURL(join(PUBLICO, 'simulacion.js')).href);
const corto = (s, n = 90) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const simulacion = FUENTE === 'demo' ? crearSimulacion(config) : null;

// ============================================================================================ la fuente «claude»
// Lo que está haciendo cada agente, leído de la cola de su transcripción de Claude Code (los .jsonl de ~/.claude/projects).
const archivo = (r) => (r ? basename(String(r).replace(/\\/g, '/')) : '');
const dominio = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

/** La herramienta abierta: [actividad, frase, detalle]. El comando nunca, solo su descripción. */
function actividadDe(nombre, e = {}) {
  const n = String(nombre || '');
  if (/^(Bash|PowerShell|BashOutput|KillShell|Monitor|TaskOutput|TaskStop)$/.test(n)) return ['terminal', 'En la terminal', e.description || ''];
  if (/^(Read|NotebookRead)$/.test(n)) return ['leyendo', 'Leyendo', archivo(e.file_path || e.notebook_path)];
  if (n === 'Grep') return ['leyendo', 'Buscando en el código', ''];
  if (n === 'Glob') return ['leyendo', 'Buscando archivos', ''];
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(n)) return ['escribiendo', 'Escribiendo', archivo(e.file_path || e.notebook_path)];
  if (n === 'WebSearch') return ['navegador', 'Buscando en la web', e.query || ''];
  if (n === 'WebFetch') return ['navegador', 'En el navegador', dominio(e.url)];
  if (/browser|chrome|computer-use/i.test(n)) return ['navegador', 'En el navegador', dominio(e.url) || ''];
  if (/^(Agent|Task|Workflow)$/.test(n)) return ['equipo', 'Con un subagente', e.description || ''];
  if (/^(SendMessage|ListAgents)$/.test(n)) return ['equipo', 'Con otro agente', ''];
  if (n === 'Skill') return ['leyendo', 'Leyendo', e.skill ? `el skill ${e.skill}` : ''];
  if (/^mcp__/.test(n)) {
    const v = n.split('__').pop();
    if (/(create|update|write|send|reply|append|set|delete|edit|publish|upload|draft|insert|batch)/i.test(v)) return ['escribiendo', 'Escribiendo', ''];
    if (/(read|get|list|search|query|fetch|find|download|export|describe|show)/i.test(v)) return ['leyendo', 'Leyendo', ''];
  }
  return ['pensando', 'Pensando', ''];
}

const PEDAZOS = [256 * 1024, 2 * 1024 * 1024, 8 * 1024 * 1024];
/** Los últimos registros de conversación de un archivo, sin leerlo entero (los hay de cientos de MB). */
function cola(ruta, tam) {
  for (const largo of PEDAZOS) {
    const n = Math.min(largo, tam);
    const b = Buffer.allocUnsafe(n);
    const fd = openSync(ruta, 'r');
    try { readSync(fd, b, 0, n, tam - n); } finally { closeSync(fd); }
    const lineas = b.toString('utf8').split('\n');
    if (n < tam) lineas.shift();
    if (!b.subarray(n - 1).equals(Buffer.from('\n'))) lineas.pop();
    const regs = [];
    for (const l of lineas) {
      if (!l.startsWith('{')) continue;
      try {
        const r = JSON.parse(l);
        if (!r.isSidechain && (r.type === 'assistant' || r.type === 'user' || r.type === 'system')) regs.push(r);
      } catch { /* línea rara */ }
    }
    if (regs.some((r) => r.type === 'assistant') || n >= tam) return regs;
  }
  return [];
}
const textoDe = (r) => {
  const c = r?.message?.content;
  return typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b) => b?.type === 'text').map((b) => b.text || '').join('\n') : '';
};
const esResultado = (r) => Array.isArray(r.message?.content) && r.message.content.some((b) => b?.type === 'tool_result');
const abreTurno = (r) => r.type === 'user' && !r.isMeta && !r.isCompactSummary && !esResultado(r) && textoDe(r).trim()
  && !/^\s*<(command-|local-command|system-reminder|task-notification|bash-|user-prompt-submit)/.test(textoDe(r));
const usos = (r) => (Array.isArray(r.message?.content) ? r.message.content.filter((b) => b?.type === 'tool_use') : []);
const FIN = new Set(['end_turn', 'stop_sequence', 'refusal', 'max_tokens']);
const local = (iso) => (iso ? new Date(iso).toLocaleString('sv').slice(0, 19) : null);

/** { turno, actividad, frase, detalle, desde, espera, pregunta }: si está en medio de un turno, o si lo cerró preguntándote. */
function interpretar(regs, m) {
  const base = { turno: false, actividad: null, frase: null, detalle: '', desde: local(new Date(m).toISOString()), espera: false, pregunta: '' };
  const ruido = (x) => (x.type === 'system' && x.subtype !== 'api_error') || (x.type === 'user' && (x.isMeta || x.isCompactSummary || /^\s*<(command-|local-command)/.test(textoDe(x))));
  let i = regs.length - 1;
  while (i >= 0 && ruido(regs[i])) i--;
  if (i < 0) return base;
  const r = regs[i];
  let inicio = i;
  while (inicio >= 0 && !abreTurno(regs[inicio])) inicio--;
  const turnoDesde = inicio >= 0 ? local(regs[inicio].timestamp) : base.desde;
  if (r.type === 'system') return { ...base, turno: true, actividad: 'pensando', frase: 'Pensando', desde: local(r.timestamp) };
  if (r.type === 'user') {
    if (/^\s*\[Request interrupted/i.test(textoDe(r))) return { ...base, desde: local(r.timestamp) };
    return { ...base, turno: true, actividad: 'pensando', frase: 'Pensando', desde: local(r.timestamp), inicio: turnoDesde };
  }
  const u = usos(r);
  if (u.length && !FIN.has(r.message?.stop_reason)) {
    const t = u[u.length - 1];
    if (t.name === 'AskUserQuestion') return { ...base, espera: true, pregunta: corto(t.input?.questions?.[0]?.question || 'Te hace unas preguntas'), desde: local(r.timestamp) };
    if (t.name === 'ExitPlanMode') return { ...base, espera: true, pregunta: 'Te muestra un plan para aprobar', desde: local(r.timestamp) };
    const [actividad, frase, detalle] = actividadDe(t.name, t.input || {});
    return { ...base, turno: true, actividad, frase, detalle: corto(detalle), desde: local(r.timestamp), inicio: turnoDesde };
  }
  if (!FIN.has(r.message?.stop_reason)) return { ...base, turno: true, actividad: 'pensando', frase: 'Pensando', desde: local(r.timestamp), inicio: turnoDesde };
  const final = textoDe(r).replace(/[*_`#>]/g, '').trim();
  if (/\?\s*$/.test(final)) {
    const frases = final.split(/(?<=[.!?])\s+/);
    return { ...base, espera: true, pregunta: corto(frases[frases.length - 1]), desde: local(r.timestamp) };
  }
  return { ...base, desde: local(r.timestamp) };
}

const lecturas = new Map();
function leerSesion(ruta) {
  let st;
  try { st = statSync(ruta); } catch { return null; }
  const v = lecturas.get(ruta);
  if (v && v.tam === st.size && v.m === st.mtimeMs) return { ...v.e, m: st.mtimeMs };
  const e = interpretar(cola(ruta, st.size), st.mtimeMs);
  lecturas.set(ruta, { tam: st.size, m: st.mtimeMs, e });
  return { ...e, m: st.mtimeMs };
}
/** Los .jsonl de una carpeta de proyecto (o el archivo, si es uno), del más reciente al más viejo. */
function sesionesDe(ruta) {
  const r = casa(ruta);
  try {
    if (statSync(r).isFile()) return [r];
    return readdirSync(r).filter((f) => f.endsWith('.jsonl')).map((f) => join(r, f)).map((f) => ({ f, m: statSync(f).mtimeMs })).sort((a, b) => b.m - a.m).map((x) => x.f);
  } catch { return []; }
}
let autoEn = 0, autoLista = [];
/** «auto»: tus sesiones más recientes de Claude Code, de todas las carpetas, para repartir entre los agentes. */
function sesionesRecientes() {
  if (Date.now() - autoEn < 30e3) return autoLista;
  const raiz = casa(config.carpetaClaude || '~/.claude/projects');
  const todas = [];
  try {
    for (const d of readdirSync(raiz, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      for (const f of readdirSync(join(raiz, d.name))) if (f.endsWith('.jsonl')) { const ruta = join(raiz, d.name, f); todas.push({ ruta, m: statSync(ruta).mtimeMs }); }
    }
  } catch { /* sin carpeta */ }
  autoLista = todas.sort((a, b) => b.m - a.m).map((x) => x.ruta);
  autoEn = Date.now();
  return autoLista;
}
// Cuánto dura cada cosa sin que la sesión se mueva: después de eso se da por terminada.
const MIN = 60e3;
function estadoClaude(p, ruta) {
  const e = ruta && leerSesion(ruta);
  if (!e) return { estado: 'cerrado' };
  const quieta = Date.now() - e.m;
  if (e.turno && quieta < 5 * MIN) return { estado: 'trabajando', actividad: e.actividad, frase: e.frase, detalle: e.detalle, desde: e.desde, inicio: e.inicio };
  if (e.espera && quieta < 120 * MIN) return { estado: 'espera', frase: 'Te espera', detalle: e.pregunta, desde: e.desde };
  if (quieta < 30 * MIN) return { estado: 'libre', desde: e.desde };
  return { estado: 'cerrado', desde: e.desde };
}

// ============================================================================================ la foto de la oficina
function oficina() {
  if (simulacion) return simulacion.foto();
  const lista = puestosDe(config);
  const auto = sesionesRecientes();
  let k = 0;
  const puestos = {};
  for (const p of lista) {
    const s = puestoVacio(p);
    if (!p.persona) {
      const ruta = p.claude === 'auto' ? auto[k++] : p.claude ? sesionesDe(p.claude)[0] : null;
      Object.assign(s, estadoClaude(p, ruta));
    }
    puestos[p.slug] = s;
  }
  puestos.dueno.esperan = Object.values(puestos).filter((s) => s.estado === 'espera').length;
  return { ahora: ahoraTexto(), zonas: zonasDe(config, lista), puestos, encargos: [], pedidos: [] };
}

// ============================================================================================ el servidor
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.json': 'application/json', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };
const SEGURIDAD = {
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'",
};
// Solo este PC: la conexión llega a 127.0.0.1 y el Host es el nuestro (lo segundo frena el reenlace de DNS).
const HOSTS = new Set([`127.0.0.1:${PUERTO}`, `localhost:${PUERTO}`]);

const servidor = createServer((req, res) => {
  const enviar = (codigo, tipo, cuerpo, extra = {}) => { res.writeHead(codigo, { 'Content-Type': tipo, ...SEGURIDAD, ...extra }); res.end(cuerpo); };
  if (!HOSTS.has(String(req.headers.host || '').toLowerCase())) return enviar(403, 'text/plain; charset=utf-8', 'Solo desde este PC.');
  if (req.method !== 'GET' && req.method !== 'HEAD') return enviar(405, 'text/plain; charset=utf-8', 'Solo se lee.');
  const url = new URL(req.url, `http://${HOST}:${PUERTO}`);
  if (url.pathname === '/api/oficina') {
    try { return enviar(200, 'application/json; charset=utf-8', JSON.stringify(oficina()), { 'Cache-Control': 'no-store' }); }
    catch (e) { return enviar(500, 'application/json; charset=utf-8', JSON.stringify({ error: String(e.message || e) })); }
  }
  if (url.pathname === '/api/marca') return enviar(200, 'application/json; charset=utf-8', JSON.stringify(config.marca || {}), { 'Cache-Control': 'no-store' });
  const ruta = resolve(PUBLICO, `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`);
  if (!ruta.startsWith(PUBLICO + sep) || !existsSync(ruta) || !statSync(ruta).isFile()) return enviar(404, 'text/plain; charset=utf-8', 'No existe.');
  enviar(200, TIPOS[extname(ruta)] || 'application/octet-stream', readFileSync(ruta), { 'Cache-Control': 'no-cache' });
});

if (process.argv[2] === 'estado') {
  const f = oficina();
  console.log(`Fuente: ${FUENTE} · configuración: ${basename(rutaConfig)}`);
  for (const z of f.zonas) {
    console.log(`\n${z.nombre}`);
    for (const slug of z.puestos) {
      const s = f.puestos[slug];
      const quien = `${s.alias || s.nombre}${s.alias ? ` (${s.nombre})` : ''}`;
      console.log(`  ${quien.padEnd(28)} ${s.persona ? `te esperan ${s.esperan}` : `${s.estado.padEnd(10)} ${s.frase || ''} ${s.detalle ? `· ${s.detalle}` : ''}`}`);
    }
  }
  process.exit(0);
}

servidor.listen(PUERTO, HOST, () => console.log(`La oficina: http://${HOST}:${PUERTO}  (fuente: ${FUENTE})`));
