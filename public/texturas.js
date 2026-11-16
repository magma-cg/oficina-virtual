// LAS TEXTURAS: el piso de cada sala, el tablero de la ciudad, el cielo, las pantallas, los tableros y el logo, todo pintado
// aquí en lienzos, sin bajar una sola imagen. Así no hay nada que se vea borroso de cerca y la página no pesa.
import * as THREE from './vendor/three.module.min.js';

// Los colores de la marca. Los cuatro primeros hacen el degradado (de oscuro a claro: vino, rojo, naranja, amarillo) que sale
// en la franja de la torre, el muro del comedor, el logo de los ascensores, los cojines y la escultura; se cambian en
// oficina.config.json («marca.colores») sin tocar el código.
export const MARCA = {
  rojo: '#C91F2B', naranja: '#D3592F', amarillo: '#FFD67B', vino: '#450F29',
  azulOscuro: '#0B46AA', azulClaro: '#5AB7F4', negro: '#0B0B0B', gris: '#E3E3E3',
};
export function ponerMarca(c = {}) { for (const k of Object.keys(MARCA)) if (typeof c[k] === 'string') MARCA[k] = c[k]; }
export const TITULAR = '"Archivo", "Archivo Expanded", system-ui, sans-serif';
export const CUERPO = '"Space Grotesk", system-ui, sans-serif';

let ANISO = 8;
export const ponerAnisotropia = (n) => { ANISO = n; };

export function lienzo(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}
export function textura(c, { repetir = false, color = true, mip = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = ANISO;
  if (repetir) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (!mip) { t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; }
  return t;
}

function azar(s) { let x = s >>> 0 || 1; return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; }; }

/** Ruido suave en una rejilla de `paso` píxeles, que empata en los bordes (para que la textura se repita sin costura). */
function ruidoSuave(w, h, paso, r) {
  const gw = Math.ceil(w / paso), gh = Math.ceil(h / paso);
  const g = new Float32Array(gw * gh).map(() => r());
  const v = (i, j) => g[((j % gh + gh) % gh) * gw + ((i % gw + gw) % gw)];
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const fx = x / paso, fy = y / paso, i = Math.floor(fx), j = Math.floor(fy);
    const u = fx - i, t = fy - j, su = u * u * (3 - 2 * u), st = t * t * (3 - 2 * t);
    out[y * w + x] = (v(i, j) * (1 - su) + v(i + 1, j) * su) * (1 - st) + (v(i, j + 1) * (1 - su) + v(i + 1, j + 1) * su) * st;
  }
  return out;
}
function granular(ctx, w, h, fuerza, r, suave = null, fuerzaSuave = 0) {
  const img = ctx.getImageData(0, 0, w, h), d = img.data;
  for (let k = 0, p = 0; k < d.length; k += 4, p++) {
    const n = (r() - 0.5) * fuerza + (suave ? (suave[p] - 0.5) * fuerzaSuave : 0);
    d[k] = Math.max(0, Math.min(255, d[k] + n)); d[k + 1] = Math.max(0, Math.min(255, d[k + 1] + n)); d[k + 2] = Math.max(0, Math.min(255, d[k + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
}

// ============================================================================================ los pisos (en grises: el color lo pone el material)
/** Madera de tablas a lo largo de x. La textura cubre 2,4 m: doce tablas de 20 cm. */
export function madera(semilla = 7) {
  const N = 1024, [c, ctx] = lienzo(N, N), r = azar(semilla);
  const filas = 12, fh = N / filas;
  for (let f = 0; f < filas; f++) {
    let x = -r() * 500;
    while (x < N) {
      const L = (0.9 + r() * 0.8) * (N / 2.4);
      const v = 205 + r() * 38;
      for (const dx of [0, -N, N]) {
        ctx.fillStyle = `rgb(${v},${v},${v})`;
        ctx.fillRect(x + dx, f * fh, L, fh);
        // La veta: líneas finas y onduladas.
        ctx.strokeStyle = `rgba(0,0,0,${0.035 + r() * 0.03})`;
        ctx.lineWidth = 1;
        for (let k = 0; k < 7; k++) {
          const y0 = f * fh + 6 + r() * (fh - 12), a = 1 + r() * 3, fr = 0.004 + r() * 0.01, ph = r() * 6;
          ctx.beginPath();
          for (let s = 0; s <= L; s += 8) ctx.lineTo(x + dx + s, y0 + Math.sin(s * fr + ph) * a);
          ctx.stroke();
        }
        ctx.fillStyle = 'rgba(0,0,0,.26)';
        ctx.fillRect(x + dx + L - 1.5, f * fh, 1.5, fh);
      }
      x += L;
    }
    ctx.fillStyle = 'rgba(0,0,0,.22)';
    ctx.fillRect(0, f * fh, N, 1.5);
  }
  granular(ctx, N, N, 10, r);
  return textura(c, { repetir: true });
}

/** Baldosas de alfombra de 50 cm, cada una con la fibra a un lado. La textura cubre 2 m. */
export function alfombra(semilla = 3) {
  const N = 1024, [c, ctx] = lienzo(N, N), r = azar(semilla), b = N / 4;
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
    const v = 214 + r() * 16;
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(i * b, j * b, b, b);
    ctx.strokeStyle = 'rgba(0,0,0,.045)';
    ctx.lineWidth = 1;
    const vertical = (i + j) % 2 === 0;
    for (let k = 2; k < b; k += 4) {
      ctx.beginPath();
      if (vertical) { ctx.moveTo(i * b + k, j * b); ctx.lineTo(i * b + k, j * b + b); } else { ctx.moveTo(i * b, j * b + k); ctx.lineTo(i * b + b, j * b + k); }
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(0,0,0,.07)';
    ctx.fillRect(i * b, j * b, b, 1); ctx.fillRect(i * b, j * b, 1, b);
  }
  granular(ctx, N, N, 26, r);
  return textura(c, { repetir: true });
}

/** Terrazo: piedritas de varios grises sobre un fondo claro. Cubre 1,6 m. */
export function terrazo(semilla = 11) {
  const N = 1024, [c, ctx] = lienzo(N, N), r = azar(semilla);
  ctx.fillStyle = 'rgb(236,236,236)';
  ctx.fillRect(0, 0, N, N);
  for (let k = 0; k < 5200; k++) {
    const x = r() * N, y = r() * N, rr = 0.8 + r() ** 3 * 5.5, v = 120 + r() * 120, cal = r() < 0.12;
    ctx.fillStyle = cal ? `rgb(${v + 20},${v},${v - 18})` : `rgb(${v},${v},${v})`;
    for (const [dx, dy] of [[0, 0], [N, 0], [-N, 0], [0, N], [0, -N]]) {
      ctx.beginPath(); ctx.ellipse(x + dx, y + dy, rr, rr * (0.6 + r() * 0.4), r() * 3, 0, Math.PI * 2); ctx.fill();
    }
  }
  granular(ctx, N, N, 8, r, ruidoSuave(N, N, 128, r), 14);
  return textura(c, { repetir: true });
}

/** La cubierta de teca de la terraza: tablas a lo largo de y, con su junta. Cubre 2 m. */
export function deck(semilla = 5) {
  const N = 1024, [c, ctx] = lienzo(N, N), r = azar(semilla);
  const cols = 14, cw = N / cols;
  ctx.fillStyle = 'rgb(40,40,40)';
  ctx.fillRect(0, 0, N, N);
  for (let i = 0; i < cols; i++) {
    let y = -r() * 600;
    while (y < N) {
      const L = (1.2 + r() * 1.4) * (N / 2);
      const v = 196 + r() * 44;
      for (const dy of [0, -N, N]) {
        ctx.fillStyle = `rgb(${v},${v},${v})`;
        ctx.fillRect(i * cw + 2, y + dy + 1, cw - 4, L - 2);
        ctx.strokeStyle = 'rgba(0,0,0,.05)';
        for (let k = 0; k < 4; k++) { const x0 = i * cw + 6 + r() * (cw - 12); ctx.beginPath(); ctx.moveTo(x0, y + dy); ctx.lineTo(x0 + (r() - 0.5) * 3, y + dy + L); ctx.stroke(); }
      }
      y += L;
    }
  }
  granular(ctx, N, N, 12, r);
  return textura(c, { repetir: true });
}

/** Pasto corto (el green de golf y las jardineras). Cubre 1 m. */
export function pasto(semilla = 9) {
  const N = 512, [c, ctx] = lienzo(N, N), r = azar(semilla);
  ctx.fillStyle = 'rgb(210,210,210)';
  ctx.fillRect(0, 0, N, N);
  granular(ctx, N, N, 60, r, ruidoSuave(N, N, 64, r), 40);
  return textura(c, { repetir: true });
}

/** Concreto pulido, para la losa y el núcleo. Cubre 3 m. */
export function concreto(semilla = 13) {
  const N = 512, [c, ctx] = lienzo(N, N), r = azar(semilla);
  ctx.fillStyle = 'rgb(222,222,222)';
  ctx.fillRect(0, 0, N, N);
  granular(ctx, N, N, 10, r, ruidoSuave(N, N, 96, r), 26);
  return textura(c, { repetir: true });
}

// ============================================================================================ la ciudad
/** Una manzana con media calle alrededor: el andén, el asfalto, los carriles y las cebras. Se repite por toda la ciudad. */
export function tableroCiudad(C, manzana, noche) {
  const N = 2048, [c, ctx] = lienzo(N, N), s = N / C, r = azar(21);
  const calle = (C - manzana) / 2;
  ctx.fillStyle = noche ? '#16181C' : '#55585E';
  ctx.fillRect(0, 0, N, N);
  // El asfalto, con un poco de mancha.
  granular(ctx, N, N, 10, r, ruidoSuave(N, N, 160, r), 16);
  // El andén.
  const a0 = calle * s, a1 = (C - calle) * s;
  ctx.fillStyle = noche ? '#2A2C30' : '#C9C5BD';
  ctx.fillRect(a0, a0, a1 - a0, a1 - a0);
  ctx.fillStyle = noche ? '#202226' : '#B4AFA6';
  ctx.lineWidth = 0.35 * s;
  ctx.strokeStyle = noche ? '#3A3C40' : '#E2DFD8';
  ctx.strokeRect(a0 + 0.2 * s, a0 + 0.2 * s, a1 - a0 - 0.4 * s, a1 - a0 - 0.4 * s);
  // Las juntas del andén, cada 2 m.
  ctx.strokeStyle = noche ? 'rgba(255,255,255,.03)' : 'rgba(0,0,0,.08)';
  ctx.lineWidth = 1.5;
  for (let k = a0; k <= a1; k += 2 * s) { ctx.beginPath(); ctx.moveTo(k, a0); ctx.lineTo(k, a0 + 4 * s); ctx.moveTo(k, a1 - 4 * s); ctx.lineTo(k, a1); ctx.moveTo(a0, k); ctx.lineTo(a0 + 4 * s, k); ctx.moveTo(a1 - 4 * s, k); ctx.lineTo(a1, k); ctx.stroke(); }
  // Dentro de la manzana, el piso de los edificios.
  ctx.fillStyle = noche ? '#232529' : '#D9D5CD';
  ctx.fillRect(a0 + 4 * s, a0 + 4 * s, a1 - a0 - 8 * s, a1 - a0 - 8 * s);
  // Los carriles: líneas partidas en la mitad de cada calle (los bordes del tablero).
  ctx.fillStyle = noche ? 'rgba(255,255,255,.35)' : 'rgba(255,255,255,.85)';
  const raya = (x, y, w, h) => ctx.fillRect(x, y, w, h);
  for (let k = a0 + 2 * s; k < a1 - 2 * s; k += 6 * s) {
    raya(k, -0.08 * s, 3 * s, 0.16 * s); raya(k, N - 0.08 * s, 3 * s, 0.16 * s);
    raya(-0.08 * s, k, 0.16 * s, 3 * s); raya(N - 0.08 * s, k, 0.16 * s, 3 * s);
  }
  // Las cebras, junto a cada esquina.
  ctx.fillStyle = noche ? 'rgba(255,255,255,.28)' : 'rgba(255,255,255,.9)';
  for (const [x0, vertical] of [[a0 - 0.5 * s, false], [a1 - 3.2 * s, false]]) {
    for (let k = -calle * s + 0.6 * s; k < calle * s - 0.6 * s; k += 1.1 * s) {
      for (const base of [0, N]) {
        if (!vertical) { raya(x0 + 0.5 * s, base + k, 2.6 * s, 0.55 * s); raya(base + k, x0 + 0.5 * s, 0.55 * s, 2.6 * s); }
      }
    }
  }
  const t = textura(c, { repetir: true });
  return t;
}

// ============================================================================================ el cielo
export function cielo(noche) {
  const [c, ctx] = lienzo(4, 1024);
  const g = ctx.createLinearGradient(0, 0, 0, 1024);
  if (noche) {
    g.addColorStop(0, '#02050B'); g.addColorStop(0.5, '#070B16'); g.addColorStop(0.82, '#1A1022'); g.addColorStop(1, '#2C1424');
  } else {
    g.addColorStop(0, '#79B5E6'); g.addColorStop(0.45, '#B9D8F0'); g.addColorStop(0.8, '#E6EEF3'); g.addColorStop(1, '#F3EEE8');
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 1024);
  return textura(c, { mip: false });
}

// ============================================================================================ la luz suave (halos y charcos de luz)
export function halo() {
  const N = 256, [c, ctx] = lienzo(N, N);
  const g = ctx.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.22, 'rgba(255,255,255,.55)'); g.addColorStop(0.55, 'rgba(255,255,255,.14)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, N, N);
  return textura(c, { color: false });
}
/** La sombra de contacto de una persona: un óvalo oscuro que se desvanece. */
export function sombraSuave() {
  const N = 128, [c, ctx] = lienzo(N, N);
  const g = ctx.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
  g.addColorStop(0, 'rgba(0,0,0,.55)'); g.addColorStop(0.5, 'rgba(0,0,0,.28)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, N, N);
  return textura(c, { color: false });
}

// ============================================================================================ el logo
/** Las formas del logo, leídas de su SVG (polígonos y trazos), para pintarlas en un lienzo. */
export function trazosDelLogo(svg) {
  const vb = /viewBox="([^"]+)"/.exec(svg)[1].split(/\s+/).map(Number);
  const formas = [];
  for (const m of svg.matchAll(/<path[^>]*\sd="([^"]+)"/g)) formas.push(new Path2D(m[1]));
  for (const m of svg.matchAll(/<polygon[^>]*\spoints="([^"]+)"/g)) {
    const n = m[1].trim().split(/[\s,]+/).map(Number);
    let d = `M${n[0]},${n[1]}`;
    for (let i = 2; i < n.length; i += 2) d += `L${n[i]},${n[i + 1]}`;
    formas.push(new Path2D(`${d}Z`));
  }
  return { vb, formas };
}
/** El logo pintado: blanco, negro o con el degradado cálido de la marca. */
export function lienzoLogo(logo, alto, relleno = 'blanco', margen = 0) {
  const [x, y, w, h] = logo.vb;
  const k = alto / h;
  const [c, ctx] = lienzo(Math.ceil(w * k + margen * 2), Math.ceil(alto + margen * 2));
  ctx.translate(margen, margen);
  ctx.scale(k, k);
  ctx.translate(-x, -y);
  if (relleno === 'degradado') {
    const g = ctx.createLinearGradient(x, y + h, x + w, y);
    g.addColorStop(0, MARCA.rojo); g.addColorStop(0.45, MARCA.naranja); g.addColorStop(1, MARCA.amarillo);
    ctx.fillStyle = g;
  } else ctx.fillStyle = relleno === 'negro' ? MARCA.negro : '#FFFFFF';
  for (const f of logo.formas) ctx.fill(f);
  return c;
}

// ============================================================================================ letreros en el piso
/** El nombre de una sala, pintado para el piso, en la letra de titulares de la marca. */
export function letreroPiso(texto, color, { alto = 150 } = {}) {
  const [m, mctx] = lienzo(8, 8);
  mctx.font = `600 ${alto}px ${TITULAR}`;
  try { mctx.fontStretch = 'expanded'; } catch { /* navegador viejo */ }
  mctx.letterSpacing = `${alto * 0.08}px`;
  const ancho = Math.ceil(mctx.measureText(texto.toUpperCase()).width + alto * 0.6);
  const [c, ctx] = lienzo(ancho, Math.ceil(alto * 1.5));
  ctx.font = `600 ${alto}px ${TITULAR}`;
  try { ctx.fontStretch = 'expanded'; } catch { /* navegador viejo */ }
  ctx.letterSpacing = `${alto * 0.08}px`;
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.fillText(texto.toUpperCase(), alto * 0.3, alto * 0.78);
  return { lienzo: c, aspecto: c.width / c.height };
}

// ============================================================================================ tableros, pantallas de pie y el mural
export function tablero(tipo, colores = []) {
  const [c, ctx] = lienzo(1024, 512), r = azar(hashTxt(tipo));
  ctx.fillStyle = '#FAFAF8';
  ctx.fillRect(0, 0, 1024, 512);
  ctx.lineCap = 'round';
  const tinta = ['#1F2A44', MARCA.rojo, '#2E7D5B', MARCA.azulOscuro];
  if (tipo === 'it') {
    // Cajas y flechas: un diagrama de la arquitectura.
    const cajas = [[90, 90, 'App'], [400, 90, 'API'], [710, 90, 'Claude'], [250, 300, 'Datos'], [560, 300, 'Agentes']];
    ctx.lineWidth = 5;
    ctx.font = `600 40px ${CUERPO}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const [x, y, t] of cajas) { ctx.strokeStyle = tinta[0]; ctx.strokeRect(x, y, 220, 110); ctx.fillStyle = tinta[0]; ctx.fillText(t, x + 110, y + 55); }
    ctx.strokeStyle = tinta[1];
    for (const [a, b] of [[[310, 145], [400, 145]], [[620, 145], [710, 145]], [[510, 200], [360, 300]], [[510, 200], [670, 300]]]) {
      ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke();
    }
  } else if (tipo === 'marketing') {
    // El calendario de la semana con sus piezas en papelitos.
    ctx.strokeStyle = '#C8C8C8'; ctx.lineWidth = 3;
    for (let i = 0; i <= 7; i++) { ctx.beginPath(); ctx.moveTo(40 + i * 135, 40); ctx.lineTo(40 + i * 135, 470); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(40, 100); ctx.lineTo(985, 100); ctx.stroke();
    const papel = ['#FFD67B', '#FF8DBA', '#9BD7F7', '#B6EFC9', '#FFC2A6'];
    for (let i = 0; i < 7; i++) for (let k = 0; k < 1 + Math.floor(r() * 3); k++) {
      ctx.fillStyle = papel[Math.floor(r() * papel.length)];
      ctx.fillRect(55 + i * 135, 120 + k * 112, 105, 92);
    }
  } else if (tipo === 'comercial') {
    // El pipeline: columnas por etapa.
    ctx.font = `600 30px ${CUERPO}`; ctx.fillStyle = tinta[0];
    ['Nuevo', 'Contacto', 'Propuesta', 'Cierre'].forEach((t, i) => ctx.fillText(t, 60 + i * 240, 70));
    const papel = ['#FFD67B', '#FFB4A8', '#FFE6A8'];
    for (let i = 0; i < 4; i++) for (let k = 0; k < 4 - i; k++) { ctx.fillStyle = papel[(i + k) % 3]; ctx.fillRect(55 + i * 240, 100 + k * 95, 190, 78); }
  } else if (tipo === 'finanzas' || tipo === 'proyectos') {
    ctx.fillStyle = '#0E1116';
    ctx.fillRect(0, 0, 1024, 512);
    if (tipo === 'finanzas') {
      ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.lineWidth = 2;
      for (let k = 0; k < 6; k++) { ctx.beginPath(); ctx.moveTo(60, 80 + k * 70); ctx.lineTo(980, 80 + k * 70); ctx.stroke(); }
      for (let i = 0; i < 12; i++) { const h = 60 + r() * 260; ctx.fillStyle = i === 11 ? MARCA.amarillo : '#3A8DFF'; ctx.fillRect(80 + i * 74, 440 - h, 44, h); }
      ctx.strokeStyle = MARCA.naranja; ctx.lineWidth = 6; ctx.beginPath();
      for (let i = 0; i < 12; i++) ctx.lineTo(102 + i * 74, 330 - i * 16 - r() * 40);
      ctx.stroke();
    } else {
      for (let i = 0; i < 7; i++) {
        const x = 80 + r() * 500, w = 160 + r() * 340;
        ctx.fillStyle = ['#30D158', '#63E6BE', MARCA.amarillo, '#5AB7F4'][i % 4];
        ctx.fillRect(x, 60 + i * 58, w, 34);
      }
      ctx.fillStyle = 'rgba(255,255,255,.12)';
      ctx.fillRect(640, 30, 3, 460);
    }
  }
  return textura(c);
}

/** El muro del comedor: el degradado cálido de la marca con el isotipo en blanco. */
export function mural(isotipo) {
  const [c, ctx] = lienzo(2048, 820);
  const g = ctx.createLinearGradient(0, 820, 2048, 0);
  g.addColorStop(0, MARCA.vino); g.addColorStop(0.35, MARCA.rojo); g.addColorStop(0.7, MARCA.naranja); g.addColorStop(1, MARCA.amarillo);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 2048, 820);
  // Una luz suave arriba, como dice el manual: el degradado se usa como luz.
  const l = ctx.createRadialGradient(1500, 0, 50, 1500, 0, 1200);
  l.addColorStop(0, 'rgba(255,240,210,.35)'); l.addColorStop(1, 'rgba(255,240,210,0)');
  ctx.fillStyle = l;
  ctx.fillRect(0, 0, 2048, 820);
  const logo = lienzoLogo(isotipo, 420);
  ctx.drawImage(logo, 1024 - logo.width / 2, 410 - logo.height / 2);
  return textura(c);
}

// ============================================================================================ las pantallas de los puestos
/** Una textura por cosa que puede estar haciendo un agente. Las que se mueven se desplazan en su eje v. */
export function pantallas(isotipo) {
  const W = 512, H = 300;
  const hacer = (fn, repetir) => { const [c, ctx] = lienzo(W, repetir ? H * 2 : H); fn(ctx, repetir ? H * 2 : H); const t = textura(c, { repetir: !!repetir }); if (repetir) t.repeat.set(1, 0.5); return t; };
  const r = azar(77);
  const lineas = (ctx, h, fondo, colores, ancho = 1) => {
    ctx.fillStyle = fondo; ctx.fillRect(0, 0, W, h);
    for (let y = 16; y < h - 8; y += 15) {
      let x = 22 + Math.floor(r() * 4) * 18;
      const n = 1 + Math.floor(r() * 4);
      for (let k = 0; k < n && x < W - 40; k++) {
        const w = (30 + r() * 120) * ancho;
        ctx.fillStyle = colores[Math.floor(r() * colores.length)];
        ctx.fillRect(x, y, Math.min(w, W - 30 - x), 7);
        x += w + 12;
      }
    }
  };
  return {
    terminal: hacer((ctx, h) => lineas(ctx, h, '#0B0F14', ['#9BE38B', '#E6E6E6', '#7FB8FF', '#FFD67B', '#8A93A0']), true),
    escribiendo: hacer((ctx, h) => { lineas(ctx, h, '#FBFBFA', ['#2B2F36', '#2B2F36', '#8A93A0'], 1.6); ctx.fillStyle = '#E9ECF1'; ctx.fillRect(0, 0, 60, h); }, true),
    leyendo: hacer((ctx, h) => { lineas(ctx, h, '#F4F5F7', ['#555B66', '#9AA1AD'], 1.4); ctx.fillStyle = '#DDE3EC'; ctx.fillRect(W - 90, 0, 90, h); }, true),
    navegador: hacer((ctx, h) => {
      ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, W, h);
      ctx.fillStyle = '#E8EAED'; ctx.fillRect(0, 0, W, 34);
      ctx.fillStyle = '#FFFFFF'; ctx.fillRect(60, 8, 300, 18);
      for (let y = 60; y < h; y += 120) {
        ctx.fillStyle = '#D4E6FA'; ctx.fillRect(28, y, 200, 90);
        ctx.fillStyle = '#B9C1CC'; for (let k = 0; k < 4; k++) ctx.fillRect(250, y + 6 + k * 20, 150 + r() * 80, 8);
      }
    }, true),
    pensando: hacer((ctx, h) => {
      ctx.fillStyle = '#0D1117'; ctx.fillRect(0, 0, W, h);
      for (let k = 0; k < 3; k++) { ctx.fillStyle = `rgba(255,255,255,${0.35 + k * 0.25})`; ctx.beginPath(); ctx.arc(W / 2 - 40 + k * 40, h / 2, 11, 0, Math.PI * 2); ctx.fill(); }
    }),
    espera: hacer((ctx, h) => {
      const g = ctx.createLinearGradient(0, 0, W, h);
      g.addColorStop(0, '#FFB340'); g.addColorStop(1, '#FFD67B');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, h);
      ctx.fillStyle = 'rgba(0,0,0,.78)';
      ctx.font = `600 150px ${TITULAR}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('?', W / 2, h / 2 + 8);
    }),
    libre: hacer((ctx, h) => {
      ctx.fillStyle = '#07090C'; ctx.fillRect(0, 0, W, h);
      const logo = lienzoLogo(isotipo, 92, 'degradado');
      ctx.drawImage(logo, W / 2 - logo.width / 2, h / 2 - logo.height / 2);
    }),
    apagada: hacer((ctx, h) => {
      const g = ctx.createLinearGradient(0, 0, W, h);
      g.addColorStop(0, '#15171B'); g.addColorStop(0.5, '#0B0C0E'); g.addColorStop(1, '#121418');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, h);
    }),
  };
}

/** El televisor con el resumen de la oficina, en la letra de la marca. */
export function pintarResumen(ctx, W, H, resumen, hora, logo) {
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#0B0B0B'); g.addColorStop(1, '#1A0E14');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const l = ctx.createRadialGradient(W * 0.85, 0, 10, W * 0.85, 0, W * 0.8);
  l.addColorStop(0, 'rgba(211,89,47,.45)'); l.addColorStop(1, 'rgba(211,89,47,0)');
  ctx.fillStyle = l; ctx.fillRect(0, 0, W, H);
  const lc = lienzoLogo(logo, H * 0.07);
  ctx.drawImage(lc, W * 0.06, H * 0.09);
  ctx.fillStyle = 'rgba(255,255,255,.6)';
  ctx.font = `500 ${H * 0.07}px ${CUERPO}`;
  ctx.textAlign = 'right'; ctx.textBaseline = 'top';
  ctx.fillText(hora, W * 0.94, H * 0.085);
  const filas = [['trabajando', 'Trabajando'], ['espera', 'Te esperan'], ['libre', 'Libres'], ['cerrado', 'Cerrados']];
  ctx.textAlign = 'left';
  filas.forEach(([k, t], i) => {
    const x = W * 0.06 + i * W * 0.225;
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `600 ${H * 0.3}px ${TITULAR}`;
    try { ctx.fontStretch = 'expanded'; } catch { /* sin ancho */ }
    ctx.fillText(String(resumen?.[k] ?? 0), x, H * 0.36);
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    ctx.font = `500 ${H * 0.065}px ${CUERPO}`;
    try { ctx.fontStretch = 'normal'; } catch { /* sin ancho */ }
    ctx.fillText(t, x + 4, H * 0.74);
  });
}

function hashTxt(t) { let h = 7; for (const ch of t) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; }
