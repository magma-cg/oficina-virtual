// EL MUNDO: la ciudad, la torre y su último piso con todo lo que tiene adentro.
//
// Lo quieto se arma una sola vez y se junta en muy pocas mallas (una por material), así la tarjeta gráfica dibuja la oficina
// entera en unas veinte llamadas. La ciudad es una sola malla de cajas con las ventanas pintadas en el sombreador, así que no
// se ve borrosa de cerca ni pesa de lejos. Lo único que se mueve aquí son los carros, las luces del rack, las puertas del
// ascensor y las paredes de fachada que se bajan cuando la cámara las tiene delante.
import * as THREE from './vendor/three.module.min.js';
import { RoundedBoxGeometry } from './vendor/RoundedBoxGeometry.js';
import { SVGLoader } from './vendor/SVGLoader.js';
import * as TX from './texturas.js';
import { D, SALA, CORREDOR, NUCLEO, HUELLA, azar, hash } from './plano3d.js';

export const ALTURA = 78;              // de la calle al piso de la oficina
const C = 86, MANZANA = 66;            // la ciudad: manzanas de 66 m con calles de 20
const ALTO = 3.3;                      // de piso a techo en la oficina (no hay techo: es una maqueta)
const col = (h) => new THREE.Color(h);

// ============================================================================================ el lote: juntar piezas por material
const BASE = {
  caja: new THREE.BoxGeometry(1, 1, 1).toNonIndexed(),
  cil: new THREE.CylinderGeometry(0.5, 0.5, 1, 14).toNonIndexed(),
  cil8: new THREE.CylinderGeometry(0.5, 0.5, 1, 8).toNonIndexed(),
  cono: new THREE.ConeGeometry(0.5, 1, 14).toNonIndexed(),
  esf: new THREE.SphereGeometry(0.5, 12, 8).toNonIndexed(),
  ico: new THREE.IcosahedronGeometry(0.5, 1).toNonIndexed(),
};
const redondas = new Map();
function redonda(w, h, d, r) {
  const k = `${w.toFixed(3)}|${h.toFixed(3)}|${d.toFixed(3)}|${r.toFixed(3)}`;
  let g = redondas.get(k);
  if (!g) {
    // Las piezas chicas con una sola vuelta de bisel; las grandes, con dos.
    const seg = Math.min(w, h, d) < 0.12 && Math.max(w, h, d) < 1 ? 1 : 2;
    g = new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));
    if (g.index) g = g.toNonIndexed();
    redondas.set(k, g);
  }
  return g;
}

class Lote {
  constructor() { this.cubos = new Map(); }
  meter(clave, geo, m, color, uvMundo = 0) {
    let c = this.cubos.get(clave);
    if (!c) { c = { pos: [], nor: [], col: [], uv: [] }; this.cubos.set(clave, c); }
    const p = geo.attributes.position.array, n = geo.attributes.normal.array, e = m.elements;
    const nm = new THREE.Matrix3().getNormalMatrix(m).elements;
    const esFn = typeof color === 'function';
    const cc = esFn ? null : color;
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i], y = p[i + 1], z = p[i + 2];
      const wx = e[0] * x + e[4] * y + e[8] * z + e[12], wy = e[1] * x + e[5] * y + e[9] * z + e[13], wz = e[2] * x + e[6] * y + e[10] * z + e[14];
      c.pos.push(wx, wy, wz);
      const a = n[i], b = n[i + 1], d = n[i + 2];
      let nx = nm[0] * a + nm[3] * b + nm[6] * d, ny = nm[1] * a + nm[4] * b + nm[7] * d, nz = nm[2] * a + nm[5] * b + nm[8] * d;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      c.nor.push(nx, ny, nz);
      const k = esFn ? color(x, y, z, wx, wy, wz) : cc;
      c.col.push(k.r, k.g, k.b);
      if (uvMundo) c.uv.push(Math.abs(ny) > 0.5 ? wx / uvMundo : (Math.abs(nx) > 0.5 ? wz : wx) / uvMundo, Math.abs(ny) > 0.5 ? wz / uvMundo : wy / uvMundo);
      else c.uv.push(0, 0);
    }
  }
  mallas(materiales, { sombra = true } = {}) {
    const g = new THREE.Group();
    for (const [clave, c] of this.cubos) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(c.pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(c.nor, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(c.col, 3));
      const mat = materiales[clave];
      if (mat?.map) geo.setAttribute('uv', new THREE.Float32BufferAttribute(c.uv, 2));
      geo.computeBoundingSphere();
      if (!mat) { console.warn('sin material', clave); continue; }
      const malla = new THREE.Mesh(geo, mat);
      malla.name = clave;
      const transparente = mat.transparent;
      malla.castShadow = sombra && !transparente && !mat.userData.sinSombra;
      malla.receiveShadow = sombra && !mat.userData.sinRecibir;
      if (transparente) malla.renderOrder = 2;
      g.add(malla);
    }
    return g;
  }
}

/** Arma un mueble con su origen y su giro: las medidas van en metros, con el frente hacia +z. */
class Taller {
  constructor(lote) { this.lote = lote; this.M = new THREE.Matrix4(); this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); }
  en(x, y, rot = 0, h = 0) { this.M.makeRotationY(rot).setPosition(x, h, y); return this; }
  _pieza(mat, geo, cx, cy, cz, sx, sy, sz, color, o) {
    this._e.set(o?.rx || 0, o?.ry || 0, o?.rz || 0);
    this._q.setFromEuler(this._e);
    this._m.compose(new THREE.Vector3(cx, cy, cz), this._q, new THREE.Vector3(sx, sy, sz));
    this._m.premultiply(this.M);
    this.lote.meter(mat, geo, this._m, typeof color === 'string' ? col(color) : color, o?.uv || 0);
  }
  /** Una caja con la base en y0 (o centrada en y0 si o.c). */
  caja(mat, x, y0, z, w, h, d, color, o) { this._pieza(mat, BASE.caja, x, o?.c ? y0 : y0 + h / 2, z, w, h, d, color, o); }
  redonda(mat, x, y0, z, w, h, d, r, color, o) { this._pieza(mat, redonda(w, h, d, r), x, o?.c ? y0 : y0 + h / 2, z, 1, 1, 1, color, o); }
  cil(mat, x, y0, z, r, h, color, o) { this._pieza(mat, o?.lados === 8 ? BASE.cil8 : BASE.cil, x, o?.c ? y0 : y0 + h / 2, z, r * 2, h, (o?.rz2 || r) * 2, color, o); }
  cono(mat, x, y0, z, r, h, color, o) { this._pieza(mat, BASE.cono, x, y0 + h / 2, z, r * 2, h, r * 2, color, o); }
  esf(mat, x, y, z, rx, ry, rz, color, o) { this._pieza(mat, BASE.esf, x, y, z, rx * 2, ry * 2, rz * 2, color, o); }
  ico(mat, x, y, z, rx, ry, rz, color, o) { this._pieza(mat, BASE.ico, x, y, z, rx * 2, ry * 2, rz * 2, color, o); }
  geo(mat, g, x, y, z, s, color, o) { this._pieza(mat, g, x, y, z, s, s, s, color, o); }
}

// ============================================================================================ los materiales
function materiales(texturas) {
  const est = (o) => new THREE.MeshStandardMaterial({ vertexColors: true, fog: false, ...o });
  const M = {
    mate: est({ roughness: 0.84, metalness: 0 }),
    satin: est({ roughness: 0.42, metalness: 0.02 }),
    tela: est({ roughness: 0.96, metalness: 0 }),
    metal: est({ roughness: 0.3, metalness: 0.8 }),
    negro: est({ roughness: 0.22, metalness: 0.1 }),
    luz: new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, toneMapped: false }),
    vidrio: new THREE.MeshStandardMaterial({
      color: '#D9ECF5', transparent: true, opacity: 0.16, roughness: 0.04, metalness: 0.2, depthWrite: false, fog: false,
      side: THREE.DoubleSide, envMapIntensity: 1.6,
    }),
    vidrioAzul: new THREE.MeshStandardMaterial({ color: '#BFD9E8', transparent: true, opacity: 0.24, roughness: 0.03, metalness: 0.3, depthWrite: false, fog: false, side: THREE.DoubleSide, envMapIntensity: 2 }),
    hojas: est({ roughness: 0.75, metalness: 0, flatShading: true }),
    madera: est({ roughness: 0.62, map: texturas.madera }),
    alfombra: est({ roughness: 0.98, map: texturas.alfombra }),
    terrazo: est({ roughness: 0.34, map: texturas.terrazo }),
    deck: est({ roughness: 0.8, map: texturas.deck }),
    pasto: est({ roughness: 0.95, map: texturas.pasto }),
    concreto: est({ roughness: 0.7, map: texturas.concreto }),
    letrero: new THREE.MeshStandardMaterial({ color: '#FFFFFF', roughness: 0.35, metalness: 0.1, emissive: '#FFF4E0', emissiveIntensity: 0, fog: false }),
  };
  M.vidrio.userData.sinSombra = true;
  M.vidrioAzul.userData.sinSombra = true;
  M.luz.userData.sinSombra = true;
  return M;
}

// ============================================================================================ la ciudad (una malla de cajas)
/** Las ventanas se pintan en el sombreador: un patrón por estilo que sale de la posición en el mundo, con su antialias. */
function materialCiudad(uniformes) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: false, roughness: 0.86, metalness: 0, envMapIntensity: 0.9 });
  mat.onBeforeCompile = (s) => {
    s.uniforms.uNoche = uniformes.uNoche;
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aEstilo;\nvarying vec3 vWPos;\nvarying vec3 vWNorm;\nvarying vec4 vEstilo;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 wp4 = vec4(transformed, 1.0);
        vec3 n0 = objectNormal;
        #ifdef USE_INSTANCING
          wp4 = instanceMatrix * wp4;
          n0 = mat3(instanceMatrix) * n0;
        #endif
        wp4 = modelMatrix * wp4;
        vWPos = wp4.xyz;
        vWNorm = normalize(mat3(modelMatrix) * n0);
        vEstilo = aEstilo;`);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uNoche;
        varying vec3 vWPos;
        varying vec3 vWNorm;
        varying vec4 vEstilo;
        float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
        // Una franja suave entre a y b dentro de cada celda, sin dientes.
        float franja(float u, float a, float b) { float w = fwidth(u) * 1.2; return smoothstep(a - w, a + w, u) - smoothstep(b - w, b + w, u); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 Nw = normalize(vWNorm);
        float est = floor(vEstilo.x + 0.5);
        float lado = 1.0 - step(0.6, abs(Nw.y));
        float hh = abs(Nw.x) > 0.5 ? vWPos.z : vWPos.x;
        float piso = est == 4.0 ? 3.8 : (est == 3.0 ? 3.9 : 3.4);
        float ancho = est == 1.0 ? 2.7 : (est == 2.0 ? 1.7 : 1.5);
        float u = hh / ancho, v = vWPos.y / piso;
        float fu = fract(u), fv = fract(v);
        float ventana = 0.0;
        if (est == 1.0) ventana = franja(fu, 0.22, 0.78) * franja(fv, 0.3, 0.86);
        else if (est == 2.0) ventana = franja(fv, 0.34, 0.92) * (1.0 - franja(fu, -0.04, 0.04) - franja(fu, 0.96, 1.04));
        else if (est >= 3.0) ventana = (1.0 - franja(fv, -0.07, 0.07) - franja(fv, 0.93, 1.07)) * (1.0 - franja(fu, -0.035, 0.035) - franja(fu, 0.965, 1.035));
        // Lejos, el patrón se funde en su promedio: nada de moiré.
        float lejos = clamp((max(fwidth(u), fwidth(v)) - 0.25) * 2.5, 0.0, 1.0);
        float media = est == 1.0 ? 0.31 : (est == 2.0 ? 0.52 : 0.8);
        ventana = mix(ventana, media, lejos) * lado * step(0.5, est);
        // El remate de cada edificio no lleva ventanas: los últimos 60 cm.
        ventana *= step(vWPos.y, vEstilo.w - 0.6);
        vec2 celda = vec2(floor(u), floor(v));
        float n = h21(celda + vEstilo.y);
        vec3 cristalDia = mix(vec3(0.12, 0.16, 0.21), vec3(0.42, 0.53, 0.63), clamp(0.35 + 0.45 * n + (vWPos.y + ${ALTURA.toFixed(1)}) / 380.0, 0.0, 1.0));
        vec3 cristal = mix(cristalDia, vec3(0.03, 0.035, 0.05), uNoche);
        diffuseColor.rgb = mix(diffuseColor.rgb * mix(1.0, 0.3, uNoche), cristal, ventana);
        float encendida = step(1.0 - vEstilo.z, h21(celda * 1.7 + vEstilo.y * 3.1)) * ventana;`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.14, ventana);
        metalnessFactor = mix(metalnessFactor, 0.55, ventana * (1.0 - uNoche));`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        reflectedLight.directDiffuse *= mix(1.0, 0.12, uNoche);
        reflectedLight.directSpecular *= mix(1.0, 0.12, uNoche);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        vec3 calida = mix(vec3(1.0, 0.7, 0.4), vec3(0.78, 0.86, 1.0), step(0.78, h21(celda + 9.1)));
        totalEmissiveRadiance += encendida * uNoche * calida * (0.28 + 0.5 * h21(celda * 0.3));`);
  };
  mat.customProgramCacheKey = () => 'ciudad-2';
  return mat;
}

function ciudad(escena, uniformes, rnd, oficina) {
  const cajas = [];   // [x, z, w, d, y0, h, color, estilo, semilla, luz]
  const caja = (x, z, w, d, y0, h, color, estilo, luz = 0.3) => cajas.push([x, z, w, d, y0, h, color, estilo, rnd() * 100, luz]);
  const suelo = -ALTURA;
  const COLORES = {
    claro: ['#E8E3D8', '#DDD6C8', '#EFEBE3', '#D2CCC0'],
    piedra: ['#C4BCAE', '#B6AE9F', '#CFC6B6'],
    ladrillo: ['#B0715A', '#A0644F', '#BC8068'],
    oscuro: ['#4C535C', '#5C636C', '#3F454D'],
    vidrio: ['#2C333B', '#38414B', '#46505C'],
  };
  const elegir = (a) => a[Math.floor(rnd() * a.length)];
  const R = 5;
  const az = 0.62;   // de dónde mira la cámara: los edificios de ese lado no la tapan
  const haciaCam = [Math.sin(az), Math.cos(az)];
  const arboles = [];
  for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) {
    const cx = i * C, cz = j * C;
    const dist = Math.hypot(cx, cz);
    const frente = (cx * haciaCam[0] + cz * haciaCam[1]) / (dist || 1);
    const a0 = -MANZANA / 2 + 4, a1 = MANZANA / 2 - 4;
    // Árboles en el andén.
    if (dist < C * 4.2) for (let k = a0 + 3; k < a1; k += 12 + rnd() * 3) {
      for (const [x, z] of [[k, a0 - 1.6], [k, a1 + 1.6], [a0 - 1.6, k], [a1 + 1.6, k]]) if (rnd() < 0.8) arboles.push([cx + x, cz + z, 0.8 + rnd() * 0.5]);
    }
    if (i === 0 && j === 0) {
      // La manzana de la torre: una plaza con árboles alrededor de la base.
      for (let k = 0; k < 26; k++) {
        const a = rnd() * Math.PI * 2, rr = 30 + rnd() * 2;
        const x = Math.max(a0, Math.min(a1, Math.cos(a) * rr)), z = Math.max(a0, Math.min(a1, Math.sin(a) * rr * 0.9));
        if (Math.abs(x) > oficina.w / 2 + 3 || Math.abs(z) > oficina.d / 2 + 3) arboles.push([x, z, 0.9 + rnd() * 0.5]);
      }
      caja(0, 0, MANZANA - 8, MANZANA - 8, suelo, 0.25, '#CFCAC0', 0);
      continue;
    }
    if (rnd() < 0.09 && dist > C * 1.2) {
      // Un parque.
      caja(cx, cz, MANZANA - 8, MANZANA - 8, suelo, 0.3, '#7FA36A', 0);
      for (let k = 0; k < 30; k++) arboles.push([cx + (rnd() - 0.5) * (MANZANA - 14), cz + (rnd() - 0.5) * (MANZANA - 14), 0.9 + rnd() * 0.8]);
      continue;
    }
    // Lotes: la manzana partida en dos, tres o cuatro.
    const lotes = [];
    const partir = (x0, z0, x1, z1, n) => {
      if (n <= 1 || Math.min(x1 - x0, z1 - z0) < 22) { lotes.push([x0, z0, x1, z1]); return; }
      if ((x1 - x0) > (z1 - z0) ? rnd() < 0.8 : rnd() < 0.2) { const m = x0 + (x1 - x0) * (0.35 + rnd() * 0.3); partir(x0, z0, m, z1, n - 1); partir(m, z0, x1, z1, n - 1); }
      else { const m = z0 + (z1 - z0) * (0.35 + rnd() * 0.3); partir(x0, z0, x1, m, n - 1); partir(x0, m, x1, z1, n - 1); }
    };
    partir(a0, a0, a1, a1, 1 + Math.floor(rnd() * 3));
    for (const [x0, z0, x1, z1] of lotes) {
      const m = 1 + rnd() * 2.5;
      const w = x1 - x0 - m * 2, d = z1 - z0 - m * 2;
      if (w < 8 || d < 8) continue;
      const alto = rnd() < 0.16 && dist > C * 1.4 ? 88 + rnd() * 70 : 14 + rnd() ** 1.4 * 52;
      let h = alto;
      if (frente > 0.25 && dist < C * 3.2) h = Math.min(h, 48);
      // Los vecinos de la torre, bajos: que se lea que la oficina está arriba de todo.
      if (dist < C * 1.6) h = Math.min(h, 22 + rnd() * 14);
      const est = h > 80 ? (rnd() < 0.75 ? 3 : 2) : (rnd() < 0.45 ? 1 : rnd() < 0.7 ? 2 : 3);
      const color = est === 3 ? elegir(COLORES.vidrio) : est === 1 ? elegir(rnd() < 0.35 ? COLORES.ladrillo : COLORES.claro) : elegir(rnd() < 0.5 ? COLORES.piedra : rnd() < 0.5 ? COLORES.oscuro : COLORES.claro);
      const x = cx + (x0 + x1) / 2, z = cz + (z0 + z1) / 2;
      caja(x, z, w, d, suelo, h, color, est, 0.18 + rnd() * 0.35);
      if (h > 60 && rnd() < 0.45) {
        const k = 0.62 + rnd() * 0.2;
        caja(x, z, w * k, d * k, suelo + h, h * (0.12 + rnd() * 0.2), color, est, 0.3);
      } else {
        for (let k = 0; k < 1 + Math.floor(rnd() * 3); k++) caja(x + (rnd() - 0.5) * w * 0.5, z + (rnd() - 0.5) * d * 0.5, 2 + rnd() * 5, 2 + rnd() * 5, suelo + h, 1.5 + rnd() * 2.5, '#9A968F', 0);
      }
    }
  }
  // La torre: una caja más en la ciudad, con su muro cortina.
  caja(0, 0, oficina.w, oficina.d, suelo, ALTURA - 0.36, '#262B31', 4, 0.42);

  const n = cajas.length;
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const estilo = new Float32Array(n * 4);
  const matCiudad = materialCiudad(uniformes);
  const malla = new THREE.InstancedMesh(geo, matCiudad, n);
  const m = new THREE.Matrix4();
  cajas.forEach(([x, z, w, d, y0, h, color, est, sem, luz], k) => {
    m.makeScale(w, h, d).setPosition(x, y0, z);
    malla.setMatrixAt(k, m);
    malla.setColorAt(k, col(color));
    estilo.set([est, sem, luz, y0 + h], k * 4);
  });
  geo.setAttribute('aEstilo', new THREE.InstancedBufferAttribute(estilo, 4));
  malla.instanceMatrix.needsUpdate = true;
  malla.receiveShadow = false;
  malla.castShadow = false;
  escena.add(malla);

  // El suelo con sus calles, del tamaño de 35 manzanas para que el centro de una caiga en el centro.
  const tableroDia = TX.tableroCiudad(C, MANZANA, false), tableroNoche = TX.tableroCiudad(C, MANZANA, true);
  for (const t of [tableroDia, tableroNoche]) t.repeat.set(35, 35);
  const sueloMat = new THREE.MeshStandardMaterial({ map: tableroDia, roughness: 0.92 });
  const piso = new THREE.Mesh(new THREE.PlaneGeometry(C * 35, C * 35), sueloMat);
  piso.rotation.x = -Math.PI / 2;
  piso.position.y = suelo;
  escena.add(piso);

  // Los árboles: tronco y copa, instanciados.
  const tronco = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.18, 0.26, 1, 6).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: '#6B5443', roughness: 0.9 }), arboles.length);
  const copaGeo = new THREE.IcosahedronGeometry(1, 0);
  const copa = new THREE.InstancedMesh(copaGeo, new THREE.MeshStandardMaterial({ roughness: 0.85, flatShading: true }), arboles.length);
  const verdes = ['#5E8C4A', '#6E9A52', '#4F7E43', '#7DA35C', '#5A8650'].map(col);
  arboles.forEach(([x, z, s], k) => {
    m.makeScale(s, 3.2 * s, s).setPosition(x, suelo, z);
    tronco.setMatrixAt(k, m);
    const r = 2.2 * s;
    m.compose(new THREE.Vector3(x, suelo + 3.2 * s + r * 0.7, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd(), rnd() * 6, rnd())), new THREE.Vector3(r, r * (0.9 + rnd() * 0.35), r));
    copa.setMatrixAt(k, m);
    copa.setColorAt(k, verdes[k % verdes.length]);
  });
  escena.add(tronco, copa);

  // Los carros: van y vienen por las calles. Faros y luces de freno, solo de noche.
  const carros = [];
  const carroGeo = (() => {
    const l = new Lote(), t = new Taller(l);
    t.caja('a', 0, 0.3, 0, 1.9, 0.72, 4.4, col('#FFFFFF'));
    t.caja('a', 0, 1.02, -0.25, 1.66, 0.56, 2.2, col('#1A1E24'));
    for (const [x, z] of [[-0.85, 1.4], [0.85, 1.4], [-0.85, -1.4], [0.85, -1.4]]) t.cil('a', x, 0.34, z, 0.34, 0.26, col('#16181B'), { c: true, rz: Math.PI / 2, lados: 8 });
    return l;
  })();
  const geoCarro = cuboAGeo(carroGeo.cubos.get('a'));
  const faros = (() => {
    const l = new Lote(), t = new Taller(l);
    for (const x of [-0.6, 0.6]) { t.caja('a', x, 0.62, 2.21, 0.36, 0.14, 0.04, col('#FFF6DA')); t.caja('a', x, 0.66, -2.21, 0.4, 0.12, 0.04, col('#FF2A2A')); }
    return cuboAGeo(l.cubos.get('a'));
  })();
  const NC = 74;
  const carroMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.45 });
  const mCarros = new THREE.InstancedMesh(geoCarro, carroMat, NC);
  const mFaros = new THREE.InstancedMesh(faros, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), NC);
  const pinturas = ['#F2F2F2', '#1C1F24', '#B8BCC2', '#8A1C24', '#22406E', '#E6E1D6', '#5B6168', '#C9A227', '#0B0B0B'].map(col);
  for (let k = 0; k < NC; k++) {
    const eje = rnd() < 0.5 ? 'x' : 'z';
    const calle = (Math.floor(rnd() * (R * 2)) - R + 0.5) * C;
    const sentido = rnd() < 0.5 ? 1 : -1;
    carros.push({ eje, calle: calle + sentido * 3.3, sentido, vel: 7 + rnd() * 7, s: (rnd() - 0.5) * C * R * 2 });
    mCarros.setColorAt(k, pinturas[k % pinturas.length]);
  }
  mCarros.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mFaros.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  escena.add(mCarros, mFaros);
  const largo = C * R * 2 + C;
  const moverCarros = (dt) => {
    const q = new THREE.Quaternion();
    for (let k = 0; k < NC; k++) {
      const c = carros[k];
      c.s += c.vel * dt * c.sentido;
      if (c.s > largo / 2) c.s -= largo; else if (c.s < -largo / 2) c.s += largo;
      const x = c.eje === 'x' ? c.s : c.calle, z = c.eje === 'x' ? c.calle : c.s;
      const giro = c.eje === 'x' ? (c.sentido > 0 ? Math.PI / 2 : -Math.PI / 2) : (c.sentido > 0 ? 0 : Math.PI);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), giro);
      m.compose(new THREE.Vector3(x, suelo, z), q, new THREE.Vector3(1, 1, 1));
      mCarros.setMatrixAt(k, m);
      mFaros.setMatrixAt(k, m);
    }
    mCarros.instanceMatrix.needsUpdate = true;
    mFaros.instanceMatrix.needsUpdate = true;
  };
  moverCarros(0);

  // Los postes de luz: solo se ven de noche.
  const postes = [];
  for (let i = -R; i < R; i++) for (let s = -R * C; s < R * C; s += 30) {
    const calle = (i + 0.5) * C;
    if (Math.abs(calle) > C * 4 || Math.abs(s) > C * 4) continue;
    postes.push([calle - 9, s], [calle + 9, s + 15], [s, calle - 9], [s + 15, calle + 9]);
  }
  const mPostes = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.5, 0), new THREE.MeshBasicMaterial({ color: '#FFD9A0', toneMapped: false }), postes.length);
  postes.forEach(([x, z], k) => { m.makeTranslation(x, suelo + 7, z); mPostes.setMatrixAt(k, m); });
  escena.add(mPostes);

  return {
    moverCarros,
    noche(n) {
      sueloMat.map = n ? tableroNoche : tableroDia;
      sueloMat.color.set(n ? '#5C667E' : '#FFFFFF');
      sueloMat.needsUpdate = true;
      mFaros.visible = n;
      mPostes.visible = n;
      copa.material.color.set(n ? '#5E6C78' : '#FFFFFF');
      // De noche la ciudad se apaga hacia el azul: la luz cálida es la de la oficina, no la de la calle.
      matCiudad.color.set(n ? '#6C7690' : '#FFFFFF');
      carroMat.color.set(n ? '#5A6070' : '#FFFFFF');
      tronco.material.color.set(n ? '#3A3430' : '#6B5443');
    },
  };
}
function cuboAGeo(c) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(c.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(c.nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(c.col, 3));
  return g;
}

// ============================================================================================ la oficina
export async function crearMundo({ escena, plano, renderer, logoSvg, isotipoSvg, datos }) {
  TX.ponerAnisotropia(Math.min(8, renderer.capabilities.getMaxAnisotropy()));
  const rnd = azar(2026);
  const texturas = { madera: TX.madera(), alfombra: TX.alfombra(), terrazo: TX.terrazo(), deck: TX.deck(), pasto: TX.pasto(), concreto: TX.concreto() };
  const M = materiales(texturas);
  const uniformes = { uNoche: { value: 0 } };
  const logo = TX.trazosDelLogo(logoSvg), isotipo = TX.trazosDelLogo(isotipoSvg);
  const formasLogo = svgAFormas(logoSvg), formasIsotipo = svgAFormas(isotipoSvg);
  const { W, WT } = plano;
  const CX = WT / 2, CY = D / 2;
  const grupo = new THREE.Group();
  grupo.position.set(-CX, 0, -CY);
  escena.add(grupo);
  const losa = { x0: -1.1, x1: WT + 1.1, y0: -1.1, y1: D + 1.1 };

  const urbe = ciudad(escena, uniformes, rnd, { w: losa.x1 - losa.x0, d: losa.y1 - losa.y0 });

  const lote = new Lote();
  const t = new Taller(lote);
  const pisos = new Lote();
  const tp = new Taller(pisos);

  // ---------------------------------------------------------------------------------------------- la losa, los pisos y la corona
  t.en(0, 0);
  t.caja('concreto', (losa.x0 + losa.x1) / 2, -0.36, (losa.y0 + losa.y1) / 2, losa.x1 - losa.x0, 0.36, losa.y1 - losa.y0, col('#E4E1DB'), { uv: 3 });
  // La franja de luz con el degradado de la marca, justo debajo de la losa, alrededor de la torre.
  const grad = (wx) => {
    const u = (wx - losa.x0) / (losa.x1 - losa.x0);
    const a = col(TX.MARCA.rojo), b = col(TX.MARCA.naranja), c = col(TX.MARCA.amarillo);
    return u < 0.5 ? a.clone().lerp(b, u * 2) : b.clone().lerp(c, (u - 0.5) * 2);
  };
  const gradFn = (x, y, z, wx) => grad(wx);
  t.caja('luz', (losa.x0 + losa.x1) / 2, -0.62, losa.y1 + 0.02, losa.x1 - losa.x0 + 0.04, 0.16, 0.04, gradFn);
  t.caja('luz', (losa.x0 + losa.x1) / 2, -0.62, losa.y0 - 0.02, losa.x1 - losa.x0 + 0.04, 0.16, 0.04, gradFn);
  t.caja('luz', losa.x0 - 0.02, -0.62, (losa.y0 + losa.y1) / 2, 0.04, 0.16, losa.y1 - losa.y0, col(TX.MARCA.rojo));
  t.caja('luz', losa.x1 + 0.02, -0.62, (losa.y0 + losa.y1) / 2, 0.04, 0.16, losa.y1 - losa.y0, col(TX.MARCA.amarillo));

  const piso = (mat, x0, y0, x1, y1, color, s, alto = 0.012) => { tp.en(0, 0); tp.caja(mat, (x0 + x1) / 2, 0, (y0 + y1) / 2, x1 - x0, alto, y1 - y0, col(color), { uv: s }); };
  const PISO = {
    direccion: ['madera', '#8C6448', 2.4], it: ['alfombra', '#5A5E66', 2], marketing: ['madera', '#E2C9A6', 2.4], juridico: ['madera', '#B98E66', 2.4],
    comercial: ['alfombra', '#A49C92', 2], finanzas: ['alfombra', '#8E97A3', 2], proyectos: ['madera', '#D8BB92', 2.4], _juntas: ['alfombra', '#6F6A66', 2],
  };
  for (const s of plano.salas) {
    const [mat, color, esc] = PISO[s.clave] || ['madera', '#D6BE9C', 2.4];
    piso(mat, s.x0, s.y0, s.x1, s.y1, color, esc);
  }
  piso('terrazo', 0, SALA, plano.interior, SALA + CORREDOR, '#F1EEE9', 1.6);
  piso('terrazo', plano.interior, 0, W, SALA + CORREDOR, '#F2EEE6', 1.6);
  piso('madera', plano.interior, SALA + CORREDOR, W, D, '#CFAE86', 2.4);
  piso('deck', W, 0, WT, D, '#B07A52', 2);

  // ---------------------------------------------------------------------------------------------- las paredes de adentro
  const BLANCO = '#F3F1EC', MARCO = '#1E2024', ROBLE = '#C39A6B';
  const tabique = (x0, y0, x1, y1) => {
    t.en(0, 0);
    const horizontal = Math.abs(y1 - y0) < 1e-3;
    const L = horizontal ? x1 - x0 : y1 - y0;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    t.caja('mate', cx, 0, cy, horizontal ? L : 0.12, 1.18, horizontal ? 0.12 : L, col(BLANCO));
    t.caja('satin', cx, 1.18, cy, horizontal ? L : 0.16, 0.04, horizontal ? 0.16 : L, col(ROBLE));
  };
  const mampara = (x0, x1, y, huecos = []) => {
    // El vidrio de piso a 1,7 m con su marco negro, y el hueco de la puerta.
    const tramos = [];
    let a = x0;
    for (const [h0, h1] of [...huecos].sort((p, q) => p[0] - q[0])) { if (h0 > a) tramos.push([a, h0]); a = Math.max(a, h1); }
    if (a < x1) tramos.push([a, x1]);
    t.en(0, 0);
    for (const [a0, a1] of tramos) {
      const L = a1 - a0;
      if (L < 0.05) continue;
      t.caja('vidrio', (a0 + a1) / 2, 0.06, y, L, 1.62, 0.02, col('#FFFFFF'));
      t.caja('negro', (a0 + a1) / 2, 0, y, L, 0.06, 0.07, col(MARCO));
      t.caja('negro', (a0 + a1) / 2, 1.68, y, L, 0.045, 0.07, col(MARCO));
      const n = Math.max(1, Math.round(L / 1.55));
      for (let k = 0; k <= n; k++) t.caja('negro', a0 + (L * k) / n, 0, y, 0.045, 1.72, 0.06, col(MARCO));
    }
  };
  for (const s of plano.salas) {
    const desde = s.x0 < plano.nucleo.x1 ? plano.nucleo.x1 : s.x0;
    mampara(desde, s.x1, s.puerta.y, [[s.puerta.x0, s.puerta.x1]]);
    if (s.x0 > 0.01) tabique(s.x0, s.y0, s.x0, s.y1);
  }
  tabique(plano.interior, 0, plano.interior, SALA);
  tabique(plano.interior, SALA + CORREDOR, plano.interior, D);

  // ---------------------------------------------------------------------------------------------- el núcleo: ascensores y el muro del logo
  const nc = plano.nucleo;
  t.en(0, 0);
  t.caja('negro', (nc.x0 + nc.x1) / 2, 0, (nc.y0 + nc.y1) / 2, nc.x1 - nc.x0, ALTO, nc.y1 - nc.y0, col('#141518'));
  for (const a of nc.ascensores) {
    t.caja('metal', a.x + 0.01, 0, a.y, 0.04, 2.3, 1.28, col('#C9CDD2'));
    t.caja('negro', a.x + 0.025, 0, a.y, 0.02, 2.2, 1.12, col('#0E0F11'));
    t.caja('luz', a.x + 0.03, 1.2, a.y + 0.78, 0.01, 0.16, 0.08, col('#FFE9C2'));
  }
  const ascensores = nc.ascensores.map((a) => {
    const hojas = [-1, 1].map((lado) => {
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.03, 2.18, 0.55), new THREE.MeshStandardMaterial({ color: '#B8BDC3', roughness: 0.25, metalness: 0.9, fog: false }));
      h.position.set(a.x + 0.045, 1.09, a.y + lado * 0.28);
      h.castShadow = true;
      grupo.add(h);
      return { malla: h, lado, y: a.y };
    });
    return { ...a, hojas, abierta: 0, hasta: 0 };
  });
  // El logo, en el muro de los ascensores, con el degradado de la marca.
  const logoMuro = TX.textura(TX.lienzoLogo(logo, 300, 'degradado', 20));
  const pLogo = new THREE.Mesh(new THREE.PlaneGeometry(3.3, 3.3 * (logoMuro.image.height / logoMuro.image.width)), new THREE.MeshBasicMaterial({ map: logoMuro, transparent: true, toneMapped: false, fog: false }));
  pLogo.position.set(nc.x1 + 0.012, 2.78, (nc.y0 + nc.y1) / 2);
  pLogo.rotation.y = Math.PI / 2;
  grupo.add(pLogo);

  // ---------------------------------------------------------------------------------------------- las fachadas: altas atrás, bajas adelante
  const fachadas = [];
  const fachada = (lado, x0, y0, x1, y1, huecos = [], muro = null) => {
    const alta = new Lote(), baja = new Lote();
    const ta = new Taller(alta), tb = new Taller(baja);
    const horizontal = Math.abs(y1 - y0) < 1e-3;
    const L = horizontal ? x1 - x0 : y1 - y0;
    const en = (u) => (horizontal ? [x0 + u, y0] : [x0, y0 + u]);
    const tramos = [];
    let a = 0;
    for (const [h0, h1] of huecos) { if (h0 > a) tramos.push([a, h0]); a = Math.max(a, h1); }
    if (a < L) tramos.push([a, L]);
    for (const tt of [ta, tb]) tt.en(0, 0);
    for (const [u0, u1] of tramos) {
      const [cx, cy] = en((u0 + u1) / 2);
      const l = u1 - u0;
      const dim = (g, h, y, color, mat) => g.caja(mat, cx, y, cy, horizontal ? l : 0.14, h, horizontal ? 0.14 : l, col(color));
      for (const g of [ta, tb]) dim(g, 0.32, 0, '#2B2E33', 'mate');
      dim(ta, ALTO - 0.4, 0.32, '#FFFFFF', 'vidrioAzul');
      dim(ta, 0.1, ALTO - 0.1, '#25282D', 'negro');
      const n = Math.max(1, Math.round(l / 1.6));
      for (let k = 0; k <= n; k++) {
        const [mx, my] = en(u0 + (l * k) / n);
        ta.caja('negro', mx, 0.3, my, horizontal ? 0.06 : 0.16, ALTO - 0.3, horizontal ? 0.16 : 0.06, col('#25282D'));
      }
    }
    if (muro) muro(ta);
    const gA = alta.mallas(M), gB = baja.mallas(M);
    grupo.add(gA, gB);
    const normal = { n: [0, -1], s: [0, 1], o: [-1, 0], e: [1, 0] }[lado];
    fachadas.push({ alta: gA, baja: gB, normal });
  };
  const kx = W - 4.4;
  const mesonX0 = kx - 3.3, mesonX1 = kx + 3.3;
  fachada('n', 0, 0, W, 0, [[mesonX0, W]], (g) => {
    // Detrás de la cocina, el muro de la marca: degradado cálido con el isotipo.
    g.caja('mate', (mesonX0 + W) / 2, 0, -0.04, W - mesonX0, ALTO, 0.14, col('#1A1A1C'));
  });
  fachada('s', 0, D, W, D);
  fachada('o', 0, 0, 0, D);
  fachada('e', W, 0, W, D, [[plano.puertaTerraza.y0, plano.puertaTerraza.y1]]);
  const muralTx = TX.mural(isotipo);
  const pMural = new THREE.Mesh(new THREE.PlaneGeometry(W - mesonX0 - 0.1, 1.95), new THREE.MeshBasicMaterial({ map: muralTx, toneMapped: false, fog: false }));
  pMural.position.set((mesonX0 + W) / 2, 0.95 + 1.95 / 2 + 0.12, 0.04);
  grupo.add(pMural);
  const muralAlto = pMural;

  // ---------------------------------------------------------------------------------------------- la terraza: baranda de vidrio
  t.en(0, 0);
  const baranda = (x0, y0, x1, y1) => {
    const horizontal = Math.abs(y1 - y0) < 1e-3;
    const L = horizontal ? x1 - x0 : y1 - y0;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    t.caja('vidrio', cx, 0.05, cy, horizontal ? L : 0.02, 1.0, horizontal ? 0.02 : L, col('#FFFFFF'));
    t.caja('metal', cx, 1.05, cy, horizontal ? L : 0.07, 0.05, horizontal ? 0.07 : L, col('#B9BEC4'));
    t.caja('mate', cx, 0, cy, horizontal ? L : 0.12, 0.08, horizontal ? 0.12 : L, col('#2B2E33'));
  };
  baranda(W, 0.02, WT, 0.02);
  baranda(W, D - 0.02, WT, D - 0.02);
  baranda(WT - 0.02, 0, WT - 0.02, D);
  // Las luces colgantes de la terraza: bombillos en zigzag entre la fachada y unos postes en la baranda. De día son bombillos;
  // de noche, lo que más se ve de la terraza.
  t.en(0, 0);
  const tramos = [[1.2, 4.6], [4.6, 8.4], [11.6, 15.4], [15.4, 18.8]];
  for (const [ya, yb] of tramos) {
    t.cil('metal', WT - 0.14, 0, yb, 0.035, 3.0, '#2B2D31');
    const a = new THREE.Vector3(W + 0.15, 3.05, ya), b = new THREE.Vector3(WT - 0.14, 2.95, yb);
    const L = a.distanceTo(b);
    const n = Math.round(L / 0.42);
    for (let k = 0; k <= n; k++) {
      const u = k / n;
      const p = a.clone().lerp(b, u);
      p.y -= Math.sin(Math.PI * u) * 0.42;
      t.esf('luz', p.x, p.y - 0.06, p.z, 0.045, 0.06, 0.045, '#FFE2A8');
      if (k < n) {
        const q = a.clone().lerp(b, (k + 1) / n);
        q.y -= Math.sin(Math.PI * (k + 1) / n) * 0.42;
        const m = p.clone().add(q).multiplyScalar(0.5);
        const largo = p.distanceTo(q);
        const dir = q.clone().sub(p).normalize();
        t.caja('negro', m.x, m.y, m.z, 0.012, 0.012, largo, '#1E2024', { c: true, ry: Math.atan2(dir.x, dir.z), rx: -Math.asin(dir.y) });
      }
    }
  }

  // ---------------------------------------------------------------------------------------------- los muebles
  const pantallasDe = new Map(), bandejas = new Map(), teles = [], ledsRack = [];
  for (const mu of plano.muebles) mueble(t, mu, { M, pantallasDe, bandejas, teles, ledsRack, rnd, grupo, logo, isotipo, formasIsotipo });

  // Los letreros del piso: el nombre de cada sala junto a su puerta, en la letra de la marca.
  const letreros = [];
  const letrero = (texto, color, x, y, alto, rot = 0) => {
    const { lienzo: c, aspecto } = TX.letreroPiso(texto, color);
    const tx = TX.textura(c);
    const pm = new THREE.Mesh(new THREE.PlaneGeometry(alto * aspecto, alto), new THREE.MeshBasicMaterial({ map: tx, transparent: true, depthWrite: false, fog: false, toneMapped: false }));
    pm.rotation.x = -Math.PI / 2;
    pm.rotation.z = rot;
    pm.position.set(x, 0.016, y);
    pm.renderOrder = 1;
    grupo.add(pm);
    letreros.push(pm);
  };
  const colorZona = (clave) => {
    const z = datos.zonas.find((q) => q.clave === clave);
    const s = z && z.puestos.map((p) => datos.puestos[p]).find((q) => q?.paleta);
    return s ? s.paleta[0] : '#6E6E73';
  };
  for (const s of plano.salas) {
    const y = s.fila === 'n' ? s.puerta.y + 0.62 : s.puerta.y - 0.62;
    letrero(s.nombre, s.tipo === 'juntas' ? '#55585E' : colorZona(s.clave), (s.puerta.x0 + s.puerta.x1) / 2, y, 0.58);
  }
  letrero('Comedor', TX.MARCA.naranja, plano.interior + 6.6, SALA - 0.8, 0.62);
  letrero('Sala', TX.MARCA.vino, plano.interior + 8.3, SALA + CORREDOR + 1.1, 0.62);
  letrero('Terraza', TX.MARCA.naranja, W + 2.6, SALA + CORREDOR / 2, 0.62, Math.PI / 2);

  const quietos = lote.mallas(M);
  const losPisos = pisos.mallas(M, { sombra: true });
  for (const mm of losPisos.children) mm.castShadow = false;
  grupo.add(quietos, losPisos);

  // ---------------------------------------------------------------------------------------------- el letrero de la torre
  const letras = new THREE.Mesh(extruir(formasLogo, 18, 0.32), M.letrero);
  letras.position.set(WT / 2, -3.75, losa.y1 + 0.36);
  letras.castShadow = false;
  grupo.add(letras);

  // Las luces del rack: puntos que titilan.
  let mLeds = null;
  if (ledsRack.length) {
    mLeds = new THREE.InstancedMesh(new THREE.BoxGeometry(0.03, 0.012, 0.01), new THREE.MeshBasicMaterial({ toneMapped: false, fog: false }), ledsRack.length);
    const mm = new THREE.Matrix4();
    ledsRack.forEach((p, k) => { mm.makeTranslation(p.x, p.y, p.z); mLeds.setMatrixAt(k, mm); mLeds.setColorAt(k, col('#3CFF8A')); });
    grupo.add(mLeds);
  }
  const verdeLed = col('#3CFF8A'), azulLed = col('#4FB2FF'), apagadoLed = col('#1A3324');

  // Las pantallas de los puestos: un material por cosa que puede estar haciendo el agente.
  const texPantalla = TX.pantallas(isotipo);
  const matPantalla = Object.fromEntries(Object.entries(texPantalla).map(([k, tx]) => [k, new THREE.MeshBasicMaterial({ map: tx, toneMapped: false, fog: false })]));
  for (const [slug, pm] of pantallasDe) pm.material = slug.startsWith('dueno') ? matPantalla[slug === 'duenoA' ? 'navegador' : 'escribiendo'] : matPantalla.apagada;
  const VEL = { terminal: 0.09, escribiendo: 0.025, leyendo: 0.012, navegador: 0.018 };

  let ultimoLed = 0;
  return {
    grupo, CX, CY, losa, ascensores, pantallasDe, bandejas, teles, fachadas, muralAlto, M, uniformes,
    ponerPantalla(slug, que) { const pm = pantallasDe.get(slug); const mat = matPantalla[que] || matPantalla.apagada; if (pm && pm.material !== mat) pm.material = mat; },
    pintarTeles(resumen, hora) {
      for (const tv of teles) { TX.pintarResumen(tv.ctx, tv.lienzo.width, tv.lienzo.height, resumen, hora, logo); tv.tx.needsUpdate = true; }
    },
    noche(n) {
      uniformes.uNoche.value = n ? 1 : 0;
      urbe.noche(n);
      M.letrero.emissiveIntensity = n ? 1.55 : 0;
      // De noche lo que es luz brilla de verdad (el render fino le pone el resplandor a lo que pasa de cierto brillo).
      M.luz.color.setScalar(n ? 1.9 : 1);
      for (const m of Object.values(matPantalla)) m.color.setScalar(n ? 1.3 : 1);
      M.vidrioAzul.opacity = n ? 0.1 : 0.24;
    },
    actualizar(t, dt, camara) {
      urbe.moverCarros(dt);
      for (const [k, v] of Object.entries(VEL)) texPantalla[k].offset.y = (-(t * v)) % 1;
      if (mLeds && t - ultimoLed > 0.18) {
        ultimoLed = t;
        for (let k = 0; k < ledsRack.length; k++) { const v = Math.sin(t * (3 + (k % 7)) + k * 1.7); mLeds.setColorAt(k, v > 0.3 ? (k % 5 ? verdeLed : azulLed) : apagadoLed); }
        mLeds.instanceColor.needsUpdate = true;
      }
      // Las puertas del ascensor: se abren medio segundo, se quedan y se cierran.
      for (const a of ascensores) {
        const meta = t < a.hasta ? 1 : 0;
        a.abierta += (meta - a.abierta) * Math.min(1, dt * 4);
        for (const h of a.hojas) h.malla.position.z = h.y + h.lado * (0.28 + a.abierta * 0.5);
      }
      // Las fachadas que la cámara tiene delante se bajan a su antepecho.
      const dx = camara.position.x, dz = camara.position.z;
      const l = Math.hypot(dx, dz) || 1;
      for (const f of fachadas) {
        const delante = (dx / l) * f.normal[0] + (dz / l) * f.normal[1] > 0.12;
        f.alta.visible = !delante;
        f.baja.visible = delante;
      }
      muralAlto.visible = fachadas[0].alta.visible;
    },
    abrirAscensor(i, t, dur = 2.6) { const a = ascensores[i]; if (a) a.hasta = Math.max(a.hasta, t + dur); },
  };
}

/** Las formas de un SVG (trazos y polígonos), listas para extruir. */
function svgAFormas(texto) {
  // Sin su <style>: la política de la página no deja aplicar estilos en línea, y para extruir solo hacen falta las formas.
  const datos = new SVGLoader().parse(texto.replace(/<style[\s\S]*?<\/style>/g, ''));
  return datos.paths.flatMap((p) => SVGLoader.createShapes(p));
}
/** El logo en letras de verdad: `ancho` metros, `fondo` de grueso, con la cara al frente (+z) en z = 0 y la base en y = 0. */
function extruir(formas, ancho, fondo) {
  const plano = new THREE.ShapeGeometry(formas);
  plano.computeBoundingBox();
  const esc = ancho / (plano.boundingBox.max.x - plano.boundingBox.min.x);
  const geo = new THREE.ExtrudeGeometry(formas, { depth: fondo / esc, bevelEnabled: true, bevelThickness: 0.012 / esc, bevelSize: 0.01 / esc, bevelSegments: 2, curveSegments: 10 });
  geo.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI));
  geo.computeBoundingBox();
  const b = geo.boundingBox;
  geo.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -b.max.z);
  geo.scale(esc, esc, esc);
  geo.computeVertexNormals();
  return geo.index ? geo.toNonIndexed() : geo;
}

// ============================================================================================ cada mueble
function mueble(t, mu, ctx) {
  const { M, pantallasDe, bandejas, teles, ledsRack, rnd, grupo } = ctx;
  t.en(mu.x, mu.y, mu.rot);
  const NEGRO = '#1B1C1F', GRAFITO = '#2B2D31', METAL = '#A9AEB4';
  const TELAS = { vino: '#5A1631', arena: '#CDBFA8', cuero: '#6B3E26', naranja: '#D3592F', amarillo: '#F2C14E', gris: '#8D9096' };
  const tela = TELAS[mu.tela] || '#8D9096';
  const local = (lx, ly, lz) => new THREE.Vector3(lx, ly, lz).applyMatrix4(t.M);
  switch (mu.tipo) {
    case 'escritorio': {
      const v = mu.variante || 0;
      const tapa = v % 2 ? '#EDEBE6' : '#CFA97E';
      t.caja('satin', 0, 0.705, 0, 1.5, 0.035, 0.74, tapa);
      for (const x of [-0.69, 0.69]) {
        t.caja('negro', x, 0, -0.3, 0.04, 0.705, 0.04, NEGRO);
        t.caja('negro', x, 0, 0.3, 0.04, 0.705, 0.04, NEGRO);
        t.caja('negro', x, 0.0, 0, 0.05, 0.03, 0.68, NEGRO);
        t.caja('negro', x, 0.66, 0, 0.04, 0.04, 0.64, NEGRO);
      }
      t.caja('tela', 0, 0.34, -0.33, 1.3, 0.34, 0.025, '#9A9DA3');
      // El monitor, con su pie.
      t.caja('metal', 0, 0.74, -0.2, 0.24, 0.012, 0.17, METAL);
      t.caja('metal', 0, 0.74, -0.24, 0.045, 0.2, 0.025, METAL);
      t.redonda('negro', 0, 0.92, -0.215, 0.64, 0.39, 0.028, 0.008, NEGRO, { c: true, rx: -0.06 });
      if (v === 1) t.redonda('negro', -0.56, 0.92, -0.16, 0.42, 0.28, 0.024, 0.008, NEGRO, { c: true, ry: 0.42, rx: -0.06 });
      t.caja('satin', 0, 0.74, 0.12, 0.44, 0.014, 0.14, v % 2 ? '#2A2C30' : '#E6E6E4');
      t.redonda('satin', 0.33, 0.74, 0.13, 0.06, 0.022, 0.1, 0.01, '#E6E6E4');
      t.cil('satin', -0.55, 0.74, 0.12, 0.042, 0.095, ['#FFFFFF', TX_MARCA.naranja, '#1F2A44', '#E3E3E3'][v]);
      if (v === 3) { t.cil('mate', -0.6, 0.74, -0.22, 0.07, 0.1, '#D9D3C7'); t.ico('hojas', -0.6, 0.93, -0.22, 0.12, 0.13, 0.12, '#5E8C4A'); }
      if (v === 2) t.caja('satin', -0.42, 0.74, 0.0, 0.34, 0.012, 0.24, '#ECE7DD', { ry: 0.3 });
      // La bandeja de los encargos.
      t.caja('negro', 0.56, 0.74, -0.14, 0.32, 0.03, 0.25, '#2E3034');
      const centro = local(0, 0.92, -0.2 + 0.001);
      const pm = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.35), M.luz);
      pm.position.copy(local(0, 0.92, -0.199));
      pm.rotation.set(-0.06, mu.rot, 0, 'YXZ');
      pm.renderOrder = 1;
      grupo.add(pm);
      pantallasDe.set(mu.slug, pm);
      void centro;
      bandejas.set(mu.slug, { pos: local(0.56, 0.755, -0.14), rot: mu.rot });
      break;
    }
    case 'escritorioDueno': {
      t.caja('satin', 0, 0.71, 0, 2.1, 0.05, 0.95, '#5C3B26');
      t.caja('satin', -1.0, 0, 0, 0.07, 0.71, 0.9, '#4E3220');
      t.caja('satin', 1.0, 0, 0, 0.07, 0.71, 0.9, '#4E3220');
      t.caja('satin', 0, 0.2, -0.38, 1.9, 0.5, 0.04, '#4E3220');
      for (const x of [-0.36, 0.36]) {
        t.caja('metal', x, 0.76, -0.22, 0.24, 0.012, 0.17, METAL);
        t.caja('metal', x, 0.76, -0.25, 0.045, 0.2, 0.025, METAL);
        t.redonda('negro', x, 0.95, -0.235, 0.66, 0.4, 0.028, 0.008, NEGRO, { c: true, ry: x < 0 ? 0.16 : -0.16 });
      }
      for (const x of [-0.36, 0.36]) {
        const pm = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.36), M.luz);
        pm.position.copy(local(x, 0.95, -0.22));
        pm.rotation.set(0, mu.rot + (x < 0 ? 0.16 : -0.16), 0, 'YXZ');
        grupo.add(pm);
        pantallasDe.set(`dueno${x < 0 ? 'A' : 'B'}`, pm);
      }
      t.caja('satin', 0, 0.76, 0.14, 0.44, 0.014, 0.14, '#2A2C30');
      t.cil('metal', 0.82, 0.76, -0.25, 0.08, 0.02, METAL);
      t.cil('metal', 0.82, 0.78, -0.25, 0.012, 0.4, METAL);
      t.cono('luz', 0.82, 1.13, -0.15, 0.09, 0.12, '#FFE6B8');
      t.caja('satin', -0.75, 0.76, 0.12, 0.08, 0.012, 0.16, '#111');
      break;
    }
    case 'recepcion': {
      t.redonda('satin', 0, 0.705, 0.08, 1.5, 0.04, 0.62, 0.02, '#EDEBE6');
      t.redonda('negro', 0, 0, -0.3, 1.6, 1.05, 0.2, 0.05, '#0F1012');
      t.redonda('satin', 0, 1.04, -0.3, 1.66, 0.04, 0.34, 0.02, '#CFA97E');
      t.caja('negro', -0.7, 0, 0.12, 0.05, 0.7, 0.5, NEGRO);
      t.caja('negro', 0.7, 0, 0.12, 0.05, 0.7, 0.5, NEGRO);
      t.caja('metal', 0, 0.745, -0.06, 0.22, 0.012, 0.16, METAL);
      t.caja('metal', 0, 0.745, -0.1, 0.045, 0.2, 0.025, METAL);
      t.redonda('negro', 0, 0.93, -0.08, 0.6, 0.36, 0.028, 0.008, NEGRO, { c: true });
      const pm = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.32), M.luz);
      pm.position.copy(local(0, 0.93, -0.064));
      pm.rotation.set(0, mu.rot, 0, 'YXZ');
      grupo.add(pm);
      pantallasDe.set('recepcion', pm);
      bandejas.set('recepcion', { pos: local(0.52, 0.725, 0.1), rot: mu.rot });
      // El logo blanco en el frente que ven los que llegan.
      const tx = TX.textura(TX.lienzoLogo(ctx.logo, 120, 'blanco', 6));
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(1.05, 1.05 * tx.image.height / tx.image.width), new THREE.MeshBasicMaterial({ map: tx, transparent: true, fog: false }));
      pl.position.copy(local(0, 0.6, -0.405));
      pl.rotation.y = mu.rot + Math.PI;
      grupo.add(pl);
      break;
    }
    case 'silla': {
      if (mu.sencilla) {
        t.redonda('tela', 0, 0.44, 0, 0.46, 0.06, 0.44, 0.02, '#3A3C41');
        t.redonda('tela', 0, 0.5, -0.2, 0.44, 0.4, 0.04, 0.02, '#3A3C41', { rx: -0.1 });
        for (const [x, z] of [[-0.2, -0.18], [0.2, -0.18], [-0.2, 0.18], [0.2, 0.18]]) t.cil('metal', x, 0, z, 0.012, 0.44, METAL);
        break;
      }
      const ej = !!mu.ejecutiva;
      const c = ej ? '#1E1F22' : GRAFITO;
      t.redonda('tela', 0, 0.43, 0.02, 0.5, 0.08, 0.48, 0.035, c);
      t.redonda('tela', 0, 0.55, -0.22, 0.47, ej ? 0.78 : 0.5, 0.06, 0.03, c, { rx: -0.12 });
      for (const x of [-0.26, 0.26]) { t.caja('negro', x, 0.5, 0.02, 0.04, 0.03, 0.3, NEGRO); t.caja('negro', x, 0.43, -0.06, 0.03, 0.08, 0.03, NEGRO); }
      t.cil('metal', 0, 0.12, 0, 0.025, 0.32, METAL);
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        t.caja('negro', Math.sin(a) * 0.15, 0.06, Math.cos(a) * 0.15, 0.04, 0.025, 0.3, NEGRO, { ry: a });
        t.caja('negro', Math.sin(a) * 0.29, 0, Math.cos(a) * 0.29, 0.05, 0.05, 0.05, NEGRO);
      }
      break;
    }
    case 'sillaComedor': {
      const c = mu.exterior ? '#3C3F44' : '#C9A27A';
      t.redonda('satin', 0, 0.44, 0, 0.44, 0.04, 0.42, 0.015, c);
      t.redonda('satin', 0, 0.5, -0.19, 0.42, 0.34, 0.03, 0.012, c, { rx: -0.08 });
      for (const [x, z] of [[-0.18, -0.17], [0.18, -0.17], [-0.18, 0.17], [0.18, 0.17]]) t.cil('negro', x, 0, z, 0.014, 0.44, NEGRO);
      break;
    }
    case 'taburete': {
      t.cil('tela', 0, 0.72, 0, 0.19, 0.06, '#1F2023');
      t.cil('metal', 0, 0, 0, 0.022, 0.72, METAL);
      t.cil('metal', 0, 0, 0, 0.2, 0.02, METAL);
      t.cil('metal', 0, 0.28, 0, 0.17, 0.015, METAL);
      break;
    }
    case 'estanteria':
    case 'biblioteca': {
      const ancho = mu.tipo === 'biblioteca' ? 2.4 : 1.8;
      const alto = mu.tipo === 'biblioteca' ? 2.2 : 1.9;
      const madera = '#3F2B1E';
      t.caja('satin', 0, 0, 0, ancho, 0.06, 0.4, madera);
      t.caja('satin', 0, alto - 0.04, 0, ancho, 0.04, 0.4, madera);
      for (const x of [-ancho / 2, 0, ancho / 2]) t.caja('satin', x, 0, 0, 0.04, alto, 0.4, madera);
      t.caja('satin', 0, 0, -0.18, ancho, alto, 0.02, '#2C1E15');
      const repisas = 4;
      const COLS = ['#1F2A44', '#8A1C24', '#D9CBB0', '#2E4A3A', '#C9A227', '#E3E3E3', '#5B3A29', TX_MARCA.naranja, '#3B3F48'];
      for (let r = 0; r < repisas; r++) {
        const y = 0.06 + r * (alto / repisas);
        if (r) t.caja('satin', 0, y - 0.02, 0, ancho, 0.025, 0.38, madera);
        let x = -ancho / 2 + 0.06;
        while (x < ancho / 2 - 0.1) {
          if (Math.abs(x) < 0.04) { x += 0.06; continue; }
          if (rnd() < 0.16) { x += 0.12 + rnd() * 0.2; continue; }
          const w = 0.03 + rnd() * 0.04, h = (alto / repisas) * (0.55 + rnd() * 0.32);
          t.caja('satin', x + w / 2, y, 0.02, w, h, 0.22 + rnd() * 0.08, COLS[Math.floor(rnd() * COLS.length)], rnd() < 0.12 ? { rz: 0.18 } : undefined);
          x += w + 0.004;
        }
        if (rnd() < 0.4) { t.cil('mate', ancho / 2 - 0.3, y, 0.02, 0.06, 0.12, '#D9D3C7'); t.ico('hojas', ancho / 2 - 0.3, y + 0.2, 0.02, 0.1, 0.1, 0.1, '#5E8C4A'); }
      }
      break;
    }
    case 'sofa3':
    case 'sofa2': {
      const w = mu.tipo === 'sofa3' ? 2.5 : 1.9;
      t.redonda('tela', 0, 0.1, 0.02, w, 0.32, 0.92, 0.06, tela);
      t.redonda('tela', 0, 0.32, -0.36, w, 0.48, 0.24, 0.08, tela);
      for (const x of [-w / 2 + 0.12, w / 2 - 0.12]) t.redonda('tela', x, 0.1, 0.02, 0.24, 0.5, 0.92, 0.08, tela);
      const n = mu.tipo === 'sofa3' ? 3 : 2;
      const ac = (w - 0.48) / n;
      for (let k = 0; k < n; k++) t.redonda('tela', -w / 2 + 0.24 + ac * (k + 0.5), 0.42, 0.06, ac - 0.03, 0.14, 0.66, 0.06, tela);
      t.redonda('tela', -w / 2 + 0.48, 0.55, -0.14, 0.42, 0.36, 0.13, 0.06, TX_MARCA.naranja, { rx: -0.25, rz: 0.12 });
      t.redonda('tela', w / 2 - 0.5, 0.55, -0.14, 0.42, 0.36, 0.13, 0.06, '#F2C14E', { rx: -0.25, rz: -0.1 });
      for (const [x, z] of [[-w / 2 + 0.1, -0.38], [w / 2 - 0.1, -0.38], [-w / 2 + 0.1, 0.42], [w / 2 - 0.1, 0.42]]) t.cil('negro', x, 0, z, 0.02, 0.1, NEGRO);
      break;
    }
    case 'chaise': {
      t.redonda('tela', 0, 0.1, 0, 0.95, 0.32, 1.7, 0.06, tela);
      t.redonda('tela', 0, 0.42, 0.05, 0.9, 0.14, 1.6, 0.06, tela);
      t.redonda('tela', 0, 0.32, -0.74, 0.95, 0.48, 0.24, 0.08, tela);
      break;
    }
    case 'sillon': {
      t.redonda('tela', 0, 0.1, 0.02, 0.9, 0.3, 0.84, 0.08, tela);
      t.redonda('tela', 0, 0.38, 0.06, 0.62, 0.13, 0.66, 0.06, tela);
      t.redonda('tela', 0, 0.3, -0.33, 0.9, 0.56, 0.2, 0.08, tela, { rx: -0.1 });
      for (const x of [-0.37, 0.37]) t.redonda('tela', x, 0.1, 0.02, 0.18, 0.5, 0.84, 0.07, tela);
      for (const [x, z] of [[-0.36, -0.34], [0.36, -0.34], [-0.36, 0.38], [0.36, 0.38]]) t.cil('satin', x, 0, z, 0.022, 0.1, '#3F2B1E');
      break;
    }
    case 'puf': t.redonda('tela', 0, 0, 0, 0.6, 0.42, 0.6, 0.18, tela); break;
    case 'mesaCentro': {
      t.redonda('satin', 0, 0.36, 0, 1.2, 0.05, 0.66, 0.025, '#3F2B1E');
      t.caja('satin', 0, 0.12, 0, 1.1, 0.025, 0.58, '#3F2B1E');
      for (const [x, z] of [[-0.54, -0.27], [0.54, -0.27], [-0.54, 0.27], [0.54, 0.27]]) t.cil('negro', x, 0, z, 0.018, 0.36, NEGRO);
      t.caja('satin', -0.25, 0.41, 0.05, 0.28, 0.03, 0.2, '#E3E3E3', { ry: 0.3 });
      t.cil('satin', 0.3, 0.41, -0.1, 0.05, 0.08, TX_MARCA.naranja);
      break;
    }
    case 'alfombra': {
      const c = { lana: '#E3DCCF', arena: '#CBBBA2', grafito: '#55585E' }[mu.color] || '#D9D2C4';
      t.redonda('tela', 0, 0.012, 0, mu.w, 0.014, mu.d, 0.006, c);
      break;
    }
    case 'consola': {
      t.caja('satin', 0, 0.06, 0, 2.3, 0.42, 0.44, '#2B2116');
      t.caja('negro', 0, 0, 0, 2.2, 0.06, 0.4, NEGRO);
      t.redonda('negro', 0, 1.25, -0.1, 2.0, 1.15, 0.05, 0.01, '#0B0B0C', { c: true });
      t.caja('metal', 0, 0.48, -0.1, 0.12, 0.2, 0.04, METAL);
      const [c, x2] = TX.lienzo(1024, 576);
      const tx = TX.textura(c, { mip: false });
      const pm = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.07), new THREE.MeshBasicMaterial({ map: tx, toneMapped: false, fog: false }));
      pm.position.copy(local(0, 1.25, -0.072));
      pm.rotation.y = mu.rot;
      grupo.add(pm);
      teles.push({ lienzo: c, ctx: x2, tx, malla: pm, tipo: mu.tele });
      t.cil('mate', -0.85, 0.48, 0, 0.07, 0.12, '#D9D3C7');
      t.ico('hojas', -0.85, 0.7, 0, 0.12, 0.14, 0.12, '#5E8C4A');
      break;
    }
    case 'planta':
    case 'plantaGrande': {
      const g = mu.tipo === 'plantaGrande' ? 1.35 : 1;
      const v = mu.var || 1;
      const maceta = ['#E9E4DA', '#2B2D31', '#B9764E'][(v - 1) % 3];
      t.cil('mate', 0, 0, 0, 0.21 * g, 0.42 * g, maceta, { lados: 8 });
      t.cil('mate', 0, 0.4 * g, 0, 0.19 * g, 0.03, '#4A3A2C');
      if (v === 1) {
        // Un árbol pequeño, de copa redonda.
        t.cil('mate', 0, 0.42 * g, 0, 0.025 * g, 0.7 * g, '#6B5443');
        for (let k = 0; k < 5; k++) t.ico('hojas', (rnd() - 0.5) * 0.3 * g, (1.15 + rnd() * 0.35) * g, (rnd() - 0.5) * 0.3 * g, 0.22 * g, 0.2 * g, 0.22 * g, ['#4F7E43', '#5E8C4A', '#6E9A52'][k % 3]);
      } else if (v === 2) {
        // Hojas largas que se abren.
        for (let k = 0; k < 9; k++) {
          const a = (k / 9) * Math.PI * 2 + rnd();
          t.caja('hojas', Math.sin(a) * 0.12 * g, 0.42 * g, Math.cos(a) * 0.12 * g, 0.07 * g, 0.75 * g, 0.012, ['#3F7A4A', '#4F8C55', '#5C9A5E'][k % 3], { ry: a, rx: 0.35 + rnd() * 0.25 });
        }
      } else {
        for (let k = 0; k < 7; k++) t.ico('hojas', (rnd() - 0.5) * 0.36 * g, (0.6 + rnd() * 0.4) * g, (rnd() - 0.5) * 0.36 * g, 0.2 * g, 0.16 * g, 0.2 * g, ['#5E8C4A', '#7DA35C', '#4F7E43'][k % 3]);
      }
      break;
    }
    case 'lampara': {
      t.cil('negro', 0, 0, 0, 0.16, 0.025, NEGRO);
      t.cil('metal', 0, 0.02, 0, 0.012, 1.45, METAL);
      t.cil('luz', 0, 1.42, 0, 0.2, 0.26, '#FFE7C4', { rz2: 0.2 });
      break;
    }
    case 'rack': {
      t.redonda('negro', 0, 0, 0, 0.62, 2.0, 0.98, 0.01, '#141518');
      t.caja('vidrio', 0, 0.06, 0.495, 0.56, 1.88, 0.01, '#FFFFFF');
      for (let k = 0; k < 14; k++) {
        t.caja('negro', 0, 0.12 + k * 0.13, 0.42, 0.52, 0.09, 0.08, '#222428');
        for (let j = 0; j < 4; j++) ledsRack.push(local(-0.2 + j * 0.05 + (k % 2) * 0.02, 0.165 + k * 0.13, 0.465));
      }
      break;
    }
    case 'pizarra':
    case 'pantallaPie': {
      const pie = mu.tipo === 'pantallaPie';
      for (const x of [-0.78, 0.78]) { t.caja('metal', x, 0, 0, 0.035, 1.9, 0.035, METAL); t.caja('metal', x, 0, 0, 0.04, 0.03, 0.5, METAL); }
      t.caja(pie ? 'negro' : 'satin', 0, 0.85, 0, 1.6, 0.95, 0.03, pie ? '#0B0B0C' : '#F5F5F2', { c: false });
      const tx = TX.tablero(mu.dibujo);
      const pm = new THREE.Mesh(new THREE.PlaneGeometry(1.52, 0.86), new THREE.MeshBasicMaterial({ map: tx, toneMapped: pie ? false : true, fog: false }));
      pm.position.copy(local(0, 1.325, 0.017));
      pm.rotation.y = mu.rot;
      grupo.add(pm);
      break;
    }
    case 'tripode': {
      for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI * 2; t.caja('negro', Math.sin(a) * 0.14, 0.7, Math.cos(a) * 0.14, 0.02, 1.4, 0.02, NEGRO, { c: true, rx: Math.cos(a) * 0.2, rz: -Math.sin(a) * 0.2 }); }
      t.redonda('negro', 0, 1.42, 0, 0.16, 0.11, 0.12, 0.02, '#111214');
      t.cil('negro', 0, 1.475, 0.1, 0.04, 0.09, '#0A0A0B', { c: true, rx: Math.PI / 2 });
      t.redonda('satin', 0, 1.62, 0.02, 0.26, 0.16, 0.012, 0.01, '#202226');
      break;
    }
    case 'softbox': {
      t.cil('metal', 0, 0, 0, 0.012, 1.6, METAL);
      for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI * 2; t.caja('metal', Math.sin(a) * 0.18, 0, Math.cos(a) * 0.18, 0.02, 0.02, 0.38, METAL, { ry: a }); }
      t.caja('negro', 0, 1.62, -0.1, 0.62, 0.62, 0.22, '#141518', { c: true });
      t.caja('luz', 0, 1.62, 0.02, 0.58, 0.58, 0.01, '#FFF6E6', { c: true });
      break;
    }
    case 'fondoFoto': {
      for (const x of [-1.35, 1.35]) t.cil('metal', x, 0, 0, 0.015, 2.5, METAL);
      t.cil('negro', 0, 2.45, 0, 0.05, 2.75, '#1A1A1C', { c: true, rz: Math.PI / 2 });
      t.caja('mate', 0, 0, 0.02, 2.6, 2.43, 0.012, TX_MARCA.naranja);
      t.redonda('mate', 0, 0, 0.6, 2.6, 0.012, 1.15, 0.004, TX_MARCA.naranja);
      break;
    }
    case 'archivador': {
      t.redonda('satin', 0, 0, 0, 0.5, 1.3, 0.64, 0.01, '#D5D8DC');
      for (let k = 0; k < 4; k++) { t.caja('satin', 0, 0.06 + k * 0.31, 0.322, 0.46, 0.27, 0.01, '#C8CCD1'); t.caja('metal', 0, 0.24 + k * 0.31, 0.33, 0.16, 0.02, 0.02, METAL); }
      break;
    }
    case 'mesaJuntas': {
      t.redonda('satin', 0, 0.72, 0, 3.6, 0.05, 1.3, 0.05, '#3F2B1E');
      for (const x of [-1.2, 1.2]) t.caja('negro', x, 0, 0, 0.1, 0.72, 0.9, NEGRO);
      for (const x of [-1, 0, 1]) { t.caja('satin', x, 0.77, 0.25, 0.3, 0.01, 0.22, '#F0EDE6'); t.cil('satin', x + 0.3, 0.77, -0.2, 0.035, 0.1, '#FFFFFF'); }
      break;
    }
    case 'cocina': {
      // El mesón de cocina: muebles bajos, la mesa de piedra, el lavaplatos y la repisa. El muro de detrás es de la fachada.
      t.caja('satin', 0, 0.1, 0, 6.4, 0.78, 0.62, '#2A2B2E');
      t.caja('negro', 0, 0, 0.02, 6.36, 0.1, 0.56, '#111');
      t.caja('satin', 0, 0.88, 0.0, 6.5, 0.045, 0.66, '#EDEAE4');
      for (let k = 0; k < 8; k++) t.caja('metal', -2.8 + k * 0.8, 0.8, 0.312, 0.18, 0.018, 0.02, METAL);
      t.caja('negro', 0.6, 0.905, 0.02, 0.62, 0.01, 0.42, '#3A3C40');
      t.cil('metal', 0.6, 0.92, -0.2, 0.02, 0.28, METAL);
      t.caja('satin', 0, 1.78, -0.18, 6.0, 0.04, 0.28, '#3F2B1E');
      for (let k = 0; k < 10; k++) t.cil('satin', -2.6 + k * 0.32, 1.82, -0.18, 0.045, 0.11, k % 3 === 0 ? TX_MARCA.naranja : '#F3F1EC');
      t.redonda('negro', 2.3, 0.925, -0.08, 0.5, 0.32, 0.38, 0.03, '#1C1D20');
      break;
    }
    case 'cafetera': {
      t.en(mu.x, mu.y, mu.rot, 0.925);
      t.redonda('metal', 0, 0, 0, 0.36, 0.42, 0.36, 0.03, '#BFC3C8');
      t.redonda('negro', 0, 0.06, 0.12, 0.26, 0.16, 0.12, 0.02, '#141518');
      t.caja('luz', 0.1, 0.34, 0.182, 0.04, 0.02, 0.005, '#7CFFB0');
      t.cil('satin', -0.05, 0.02, 0.14, 0.035, 0.07, '#FFFFFF');
      break;
    }
    case 'nevera': {
      t.redonda('metal', 0, 0, 0, 0.8, 1.95, 0.72, 0.02, '#C9CDD2');
      t.caja('negro', 0, 1.2, 0.362, 0.78, 0.008, 0.01, '#8A8F95');
      t.caja('metal', 0.32, 1.35, 0.38, 0.025, 0.4, 0.03, '#E6E8EA');
      t.caja('metal', 0.32, 0.6, 0.38, 0.025, 0.4, 0.03, '#E6E8EA');
      break;
    }
    case 'isla': {
      t.caja('satin', 0, 0, 0, 2.7, 0.9, 0.95, '#3F2B1E');
      t.caja('satin', 0, 0.9, 0.05, 2.8, 0.05, 1.05, '#EDEAE4');
      t.cil('satin', -0.8, 0.95, -0.15, 0.16, 0.08, '#E3E3E3');
      for (const [x, c] of [[-0.85, TX_MARCA.naranja], [-0.72, TX_MARCA.amarillo], [-0.9, TX_MARCA.rojo]]) t.esf('satin', x, 1.06, -0.15 + (x + 0.85) * 0.4, 0.045, 0.045, 0.045, c);
      t.cil('satin', 0.7, 0.95, -0.1, 0.04, 0.12, '#FFFFFF');
      t.caja('satin', 0.25, 0.95, 0.2, 0.3, 0.02, 0.4, '#C9A27A');
      break;
    }
    case 'mesaRedonda':
    case 'mesaBistro': {
      const r = mu.tipo === 'mesaBistro' ? 0.36 : 0.55;
      t.cil('satin', 0, 0.71, 0, r, 0.035, mu.tipo === 'mesaBistro' ? '#E9E4DA' : '#F3F1EC');
      t.cil('negro', 0, 0, 0, 0.03, 0.71, NEGRO);
      t.cil('negro', 0, 0, 0, 0.24, 0.02, NEGRO);
      if (mu.tipo === 'mesaRedonda') { t.cil('satin', 0.15, 0.745, 0.1, 0.11, 0.012, '#FFFFFF'); t.cil('satin', -0.18, 0.745, -0.05, 0.04, 0.09, TX_MARCA.naranja); }
      break;
    }
    case 'billar': {
      t.redonda('satin', 0, 0.58, 0, 2.62, 0.2, 1.46, 0.05, '#3F2416');
      t.caja('tela', 0, 0.78, 0, 2.3, 0.01, 1.14, '#1F6B4C');
      for (const [x, z] of [[-1.15, -0.6], [1.15, -0.6], [-1.15, 0.6], [1.15, 0.6]]) t.caja('satin', x, 0, z, 0.16, 0.58, 0.16, '#3F2416');
      const bolas = ['#FFFFFF', '#F2C14E', TX_MARCA.rojo, '#1F2A44', TX_MARCA.naranja, '#2E7D5B', '#111', '#5A1631'];
      bolas.forEach((c, k) => t.esf('satin', -0.5 + (k % 4) * 0.08 + (k > 3 ? 0.04 : 0), 0.82, -0.1 + Math.floor(k / 4) * 0.07, 0.028, 0.028, 0.028, c));
      t.cil('satin', 0.3, 0.79, 0.4, 0.008, 1.4, '#C9A27A', { c: true, rz: Math.PI / 2, ry: 0.3 });
      break;
    }
    case 'tumbona': {
      t.caja('satin', 0, 0.22, 0.25, 0.7, 0.06, 1.4, '#C59A6D');
      t.redonda('tela', 0, 0.28, 0.25, 0.64, 0.08, 1.32, 0.03, '#F3F1EC');
      t.redonda('tela', 0, 0.55, -0.62, 0.64, 0.08, 0.75, 0.03, '#F3F1EC', { c: true, rx: 0.9 });
      for (const [x, z] of [[-0.3, -0.4], [0.3, -0.4], [-0.3, 0.9], [0.3, 0.9]]) t.caja('satin', x, 0, z, 0.05, 0.22, 0.05, '#C59A6D');
      break;
    }
    case 'sombrilla': {
      t.cil('metal', 0, 0, 0, 0.025, 2.5, METAL);
      t.cil('negro', 0, 0, 0, 0.22, 0.08, NEGRO);
      t.cono('tela', 0, 2.2, 0, 1.4, 0.45, TX_MARCA.naranja);
      t.cil('tela', 0, 2.12, 0, 1.4, 0.1, TX_MARCA.rojo, { lados: 8 });
      break;
    }
    case 'jardinera': {
      const L = mu.largo || 3;
      t.caja('mate', 0, 0, 0, L, 0.55, 0.8, '#3A3C40');
      t.caja('pasto', 0, 0.55, 0, L - 0.12, 0.02, 0.68, '#4E6B3B', { uv: 1 });
      for (let k = 0; k < L / 0.7; k++) t.ico('hojas', -L / 2 + 0.35 + k * 0.7, 0.75, (rnd() - 0.5) * 0.3, 0.32, 0.25, 0.3, ['#5E8C4A', '#6E9A52', '#4F7E43'][k % 3]);
      for (let k = 0; k < (mu.arbol || 0); k++) {
        const x = -L / 2 + L * (k + 0.5) / (mu.arbol || 1);
        t.cil('mate', x, 0.55, 0, 0.06, 1.5, '#6B5443');
        for (let j = 0; j < 6; j++) t.ico('hojas', x + (rnd() - 0.5) * 0.6, 2.0 + rnd() * 0.6, (rnd() - 0.5) * 0.6, 0.45, 0.4, 0.45, ['#4F7E43', '#5E8C4A', '#6E9A52'][j % 3]);
      }
      break;
    }
    case 'pergola': {
      for (const [x, z] of [[-2, -1.5], [2, -1.5], [-2, 1.5], [2, 1.5]]) t.caja('satin', x, 0, z, 0.14, 2.6, 0.14, '#2B2D31');
      for (const z of [-1.5, 1.5]) t.caja('satin', 0, 2.55, z, 4.2, 0.14, 0.12, '#2B2D31');
      for (let k = 0; k < 11; k++) t.caja('satin', -2 + k * 0.4, 2.69, 0, 0.06, 0.1, 3.3, '#C59A6D');
      break;
    }
    case 'green': {
      t.redonda('pasto', 0, 0.01, 0, 5.2, 0.03, 2.4, 0.4, '#5FA04A', { uv: 1 });
      t.cil('negro', 1.9, 0.02, 0.2, 0.06, 0.025, '#111');
      t.cil('metal', 1.9, 0.02, 0.2, 0.008, 1.2, '#E6E6E6');
      t.caja('luz', 1.98, 0.98, 0.2, 0.18, 0.12, 0.004, TX_MARCA.rojo);
      t.esf('satin', -1.2, 0.06, -0.3, 0.022, 0.022, 0.022, '#FFFFFF');
      break;
    }
    case 'golf': {
      t.cil('tela', 0, 0, 0, 0.15, 0.85, '#1F2A44', { rx: 0.15 });
      for (let k = 0; k < 4; k++) t.cil('metal', -0.05 + k * 0.035, 0.8, 0.02, 0.01, 0.3, METAL);
      break;
    }
    case 'isotipo': {
      // La escultura de la marca: el isotipo extruido sobre un pedestal, con el degradado cálido de abajo hacia arriba.
      t.caja('mate', 0, 0, 0, 2.6, 0.45, 0.9, '#1A1A1C');
      const geo = extruir(ctx.formasIsotipo, 2.3, 0.34);
      geo.translate(0, 0, 0.17);
      geo.computeBoundingBox();
      const h = geo.boundingBox.max.y;
      const g1 = col(TX_MARCA.rojo), g2 = col(TX_MARCA.naranja), g3 = col(TX_MARCA.amarillo);
      t.geo('satin', geo, 0, 0.45, 0, 1, (x, y) => { const u = Math.max(0, Math.min(1, y / h)); return u < 0.5 ? g1.clone().lerp(g2, u * 2) : g2.clone().lerp(g3, (u - 0.5) * 2); });
      break;
    }
    case 'agua': {
      t.redonda('satin', 0, 0, 0, 0.36, 1.0, 0.36, 0.03, '#E6E8EA');
      t.cil('vidrio', 0, 1.0, 0, 0.14, 0.42, '#FFFFFF');
      t.caja('negro', 0, 0.7, 0.18, 0.14, 0.08, 0.02, '#2B2D31');
      break;
    }
    case 'banca': {
      t.caja('satin', 0, 0.42, 0, 1.6, 0.05, 0.46, '#C39A6B');
      for (const x of [-0.7, 0.7]) t.caja('negro', x, 0, 0, 0.05, 0.42, 0.42, NEGRO);
      break;
    }
    default: break;
  }
}
const TX_MARCA = TX.MARCA;

export { HUELLA };
