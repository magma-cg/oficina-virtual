// LAS PERSONAS: cada agente es alguien con su camisa del color de su esfera, que camina, se sienta, escribe, espera de pie
// y descansa en el comedor o en la terraza.
//
// Todas se dibujan juntas: cada parte del cuerpo (cabeza, torso, brazos, piernas...) es una malla instanciada, así treinta
// personas cuestan una docena de llamadas a la tarjeta gráfica. El esqueleto de cada una son objetos sin malla que se mueven
// con la matemática de three, y de ahí se copia la posición de cada parte.
import * as THREE from './vendor/three.module.min.js';
import { RoundedBoxGeometry } from './vendor/RoundedBoxGeometry.js';
import { hash } from './plano3d.js';

const PIELES = ['#F1C9A5', '#E0AC86', '#C68A62', '#A26B47', '#7B4B2E', '#EBC1A0', '#D29B74'];
const PELOS = ['#1C1512', '#2E2019', '#4A3225', '#6B4A2F', '#A57A4C', '#141414', '#8C8C8C', '#3B2A20'];
const PANTALONES = ['#1F2A44', '#2B2D31', '#3A3F46', '#55473A', '#1C1C1E', '#4A5563', '#6B5E4E'];
const ZAPATOS = ['#1A1A1C', '#3B2A20', '#E8E6E1', '#2B2D31'];

// Medidas del cuerpo (metros). Un poco caricaturesco: cabeza algo grande, para que se lea de lejos.
const CADERA = 0.955, MUSLO = 0.44, PIERNA = 0.43, TORSO = 0.5, BRAZO = 0.29, ANTEBRAZO = 0.27;

function geometrias() {
  const g = {};
  g.pelvis = new RoundedBoxGeometry(0.36, 0.17, 0.22, 2, 0.06).translate(0, -0.02, 0);
  g.torso = new RoundedBoxGeometry(0.4, TORSO, 0.24, 3, 0.09).translate(0, TORSO / 2 + 0.03, 0);
  // La cabeza con su cuello, sus ojos y su nariz: los ojos se pintan oscuros con el color de vértice.
  {
    const partes = [];
    const cuello = new THREE.CylinderGeometry(0.055, 0.06, 0.12, 10).translate(0, 0.05, 0);
    const cabeza = new THREE.SphereGeometry(0.128, 16, 12).scale(0.94, 1.06, 1).translate(0, 0.21, 0.005);
    const ojoI = new THREE.SphereGeometry(0.016, 8, 6).translate(-0.042, 0.225, 0.112);
    const ojoD = new THREE.SphereGeometry(0.016, 8, 6).translate(0.042, 0.225, 0.112);
    const nariz = new THREE.SphereGeometry(0.02, 8, 6).scale(0.8, 1, 1).translate(0, 0.195, 0.125);
    const orejaI = new THREE.SphereGeometry(0.03, 8, 6).scale(0.5, 1, 0.8).translate(-0.122, 0.205, 0);
    const orejaD = new THREE.SphereGeometry(0.03, 8, 6).scale(0.5, 1, 0.8).translate(0.122, 0.205, 0);
    for (const [geo, c] of [[cuello, 1], [cabeza, 1], [ojoI, 0.08], [ojoD, 0.08], [nariz, 0.94], [orejaI, 0.95], [orejaD, 0.95]]) {
      const gg = geo.toNonIndexed();
      const n = gg.attributes.position.count;
      gg.setAttribute('color', new THREE.Float32BufferAttribute(new Array(n * 3).fill(c), 3));
      gg.deleteAttribute('uv');
      partes.push(gg);
    }
    g.cabeza = juntar(partes);
  }
  // Dos peinados: corto (un casquete) y largo (casquete y melena).
  g.peloCorto = new THREE.SphereGeometry(0.138, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.52).scale(0.96, 1.0, 1.04).translate(0, 0.225, -0.008);
  {
    const casquete = new THREE.SphereGeometry(0.14, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.55).scale(0.97, 1.02, 1.05).translate(0, 0.222, -0.01).toNonIndexed();
    let melena = new RoundedBoxGeometry(0.26, 0.26, 0.11, 2, 0.05).translate(0, 0.12, -0.08);
    if (melena.index) melena = melena.toNonIndexed();
    casquete.deleteAttribute('uv'); melena.deleteAttribute('uv');
    g.peloLargo = juntar([casquete, melena]);
  }
  g.brazo = new THREE.CapsuleGeometry(0.055, BRAZO - 0.08, 3, 8).translate(0, -BRAZO / 2 + 0.02, 0);
  g.antebrazo = new THREE.CapsuleGeometry(0.047, ANTEBRAZO - 0.08, 3, 8).translate(0, -ANTEBRAZO / 2 + 0.02, 0);
  g.mano = new THREE.SphereGeometry(0.045, 8, 6).scale(0.85, 1.1, 0.7).translate(0, -0.03, 0);
  g.muslo = new THREE.CapsuleGeometry(0.075, MUSLO - 0.1, 3, 8).translate(0, -MUSLO / 2 + 0.02, 0);
  g.pierna = new THREE.CapsuleGeometry(0.062, PIERNA - 0.1, 3, 8).translate(0, -PIERNA / 2 + 0.02, 0);
  g.zapato = new RoundedBoxGeometry(0.1, 0.075, 0.24, 2, 0.03).translate(0, -0.035, 0.045);
  // Lo que se lleva en la mano: una carpeta (un encargo) o una esfera de luz (una nota de voz).
  g.carpeta = new RoundedBoxGeometry(0.24, 0.3, 0.03, 2, 0.008).translate(0, -0.12, 0.04);
  g.nota = new THREE.SphereGeometry(0.07, 18, 12).translate(0, -0.04, 0.09);
  g.taza = new THREE.CylinderGeometry(0.04, 0.035, 0.09, 12).translate(0, -0.04, 0.06);
  g.taco = new THREE.CylinderGeometry(0.008, 0.012, 1.45, 6).rotateX(Math.PI / 2).translate(0, -0.04, 0.45);
  g.putter = new THREE.CylinderGeometry(0.008, 0.008, 0.9, 6).translate(0, -0.48, 0.03);
  return g;
}
function juntar(lista) {
  const total = lista.reduce((a, g) => a + g.attributes.position.count, 0);
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), colr = new Float32Array(total * 3);
  let o = 0;
  for (const g of lista) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    colr.set(g.attributes.color ? g.attributes.color.array : new Float32Array(g.attributes.position.count * 3).fill(1), o * 3);
    o += g.attributes.position.count;
  }
  const r = new THREE.BufferGeometry();
  r.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  r.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  r.setAttribute('color', new THREE.BufferAttribute(colr, 3));
  return r;
}

/** Arma a todos: `quienes` es [{ slug, camisa, persona }]. Devuelve la tropa con su `actualizar`. */
export function crearPersonas(grupo, quienes, texSombra, texHalo) {
  const G = geometrias();
  const N = quienes.length;
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.66, metalness: 0, fog: false });
  const matCabeza = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0, vertexColors: true, fog: false });
  const matCosas = new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.05, fog: false });
  const matNota = new THREE.MeshBasicMaterial({ toneMapped: false, fog: false });
  const partes = {};
  const instanciar = (nombre, geo, cuantas, material = mat) => {
    const m = new THREE.InstancedMesh(geo, material, cuantas);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;
    m.castShadow = false;
    m.receiveShadow = true;
    grupo.add(m);
    partes[nombre] = m;
    return m;
  };
  instanciar('pelvis', G.pelvis, N);
  instanciar('torso', G.torso, N);
  instanciar('cabeza', G.cabeza, N, matCabeza);
  instanciar('peloCorto', G.peloCorto, N);
  instanciar('peloLargo', G.peloLargo, N, matCabeza);
  instanciar('brazo', G.brazo, N * 2);
  instanciar('antebrazo', G.antebrazo, N * 2);
  instanciar('mano', G.mano, N * 2);
  instanciar('muslo', G.muslo, N * 2);
  instanciar('pierna', G.pierna, N * 2);
  instanciar('zapato', G.zapato, N * 2);
  instanciar('carpeta', G.carpeta, N, matCosas);
  instanciar('taza', G.taza, N, matCosas);
  instanciar('taco', G.taco, N, matCosas);
  instanciar('putter', G.putter, N, matCosas);
  instanciar('nota', G.nota, N, matNota);
  // La sombra de contacto, en el piso.
  const sombras = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.9, 0.9).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: texSombra, transparent: true, depthWrite: false, color: '#000000', fog: false, opacity: 1 }), N);
  sombras.renderOrder = 1;
  sombras.frustumCulled = false;
  sombras.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  grupo.add(sombras);

  const cero = new THREE.Matrix4().makeScale(0, 0, 0);
  const lista = quienes.map((q, i) => {
    const h = hash(q.slug);
    const r = (k) => ((h >>> (k * 3)) & 0xff) / 255;
    const rig = armar();
    const p = {
      ...q, i, rig,
      piel: new THREE.Color(q.piel || PIELES[h % PIELES.length]),
      pelo: new THREE.Color(q.pelo || PELOS[(h >>> 5) % PELOS.length]),
      largo: q.largo ?? r(2) < 0.42,
      pantalon: new THREE.Color(q.pantalon || PANTALONES[(h >>> 9) % PANTALONES.length]),
      zapato: new THREE.Color(ZAPATOS[(h >>> 13) % ZAPATOS.length]),
      camisa: new THREE.Color(q.camisa),
      fase: r(3) * 10,
      visible: false,
      lleva: null,
    };
    partes.pelvis.setColorAt(i, p.pantalon);
    partes.torso.setColorAt(i, p.camisa);
    partes.cabeza.setColorAt(i, p.piel);
    partes.peloCorto.setColorAt(i, p.pelo);
    partes.peloLargo.setColorAt(i, p.pelo);
    for (const k of [0, 1]) {
      partes.brazo.setColorAt(i * 2 + k, p.camisa);
      partes.antebrazo.setColorAt(i * 2 + k, q.mangaCorta ? p.piel : p.camisa.clone().multiplyScalar(0.92));
      partes.mano.setColorAt(i * 2 + k, p.piel);
      partes.muslo.setColorAt(i * 2 + k, p.pantalon);
      partes.pierna.setColorAt(i * 2 + k, p.pantalon);
      partes.zapato.setColorAt(i * 2 + k, p.zapato);
    }
    partes.carpeta.setColorAt(i, new THREE.Color('#F4F1EA'));
    partes.taza.setColorAt(i, new THREE.Color('#FFFFFF'));
    partes.taco.setColorAt(i, new THREE.Color('#C9A27A'));
    partes.putter.setColorAt(i, new THREE.Color('#B9BEC4'));
    partes.nota.setColorAt(i, new THREE.Color(q.camisa));
    return p;
  });
  for (const m of Object.values(partes)) if (m.instanceColor) m.instanceColor.needsUpdate = true;

  // La esfera de cada uno, sobre la cabeza: el mismo color de su esfera en la app de voz.
  const halos = lista.map((p) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: texHalo, color: p.camisa, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0 }));
    s.scale.set(0.5, 0.5, 1);
    s.renderOrder = 3;
    grupo.add(s);
    const nucleo = new THREE.Mesh(new THREE.SphereGeometry(0.075, 18, 12), new THREE.MeshBasicMaterial({ color: p.camisa, toneMapped: false, fog: false }));
    nucleo.visible = false;
    grupo.add(nucleo);
    return { s, nucleo };
  });

  // El esqueleto no cuelga de la escena: su «mundo» es el plano de la oficina, el mismo de las mallas instanciadas.
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3();
  const copiar = (malla, k, obj) => malla.setMatrixAt(k, obj.matrixWorld);

  return {
    lista,
    porSlug: new Map(lista.map((p) => [p.slug, p])),
    /** Pone la pose de cada uno y copia sus partes a las mallas. `pose(p)` devuelve lo que hace ahora. */
    actualizar(t, poses) {
      for (const p of lista) {
        const pose = poses.get(p.slug);
        const i = p.i;
        const h = halos[i];
        if (!pose || !pose.visible) {
          for (const n of ['pelvis', 'torso', 'cabeza', 'peloCorto', 'peloLargo', 'carpeta', 'taza', 'taco', 'putter', 'nota']) partes[n].setMatrixAt(i, cero);
          for (const n of ['brazo', 'antebrazo', 'mano', 'muslo', 'pierna', 'zapato']) { partes[n].setMatrixAt(i * 2, cero); partes[n].setMatrixAt(i * 2 + 1, cero); }
          sombras.setMatrixAt(i, cero);
          h.s.material.opacity = 0; h.nucleo.visible = false;
          p.oculto = true;
          continue;
        }
        p.oculto = false;
        posar(p.rig, pose, t + p.fase);
        const R = p.rig;
        R.raiz.updateMatrixWorld(true);
        copiar(partes.pelvis, i, R.pelvis);
        copiar(partes.torso, i, R.torso);
        copiar(partes.cabeza, i, R.cabeza);
        if (p.largo) { copiar(partes.peloLargo, i, R.cabeza); partes.peloCorto.setMatrixAt(i, cero); }
        else { copiar(partes.peloCorto, i, R.cabeza); partes.peloLargo.setMatrixAt(i, cero); }
        for (const [k, lado] of [[0, 'I'], [1, 'D']]) {
          copiar(partes.brazo, i * 2 + k, R[`hombro${lado}`]);
          copiar(partes.antebrazo, i * 2 + k, R[`codo${lado}`]);
          copiar(partes.mano, i * 2 + k, R[`mano${lado}`]);
          copiar(partes.muslo, i * 2 + k, R[`cadera${lado}`]);
          copiar(partes.pierna, i * 2 + k, R[`rodilla${lado}`]);
          copiar(partes.zapato, i * 2 + k, R[`tobillo${lado}`]);
        }
        // Lo que lleva en la mano derecha.
        for (const n of ['carpeta', 'taza', 'taco', 'putter', 'nota']) {
          if (pose.lleva === n) copiar(partes[n], i, R.manoD);
          else partes[n].setMatrixAt(i, cero);
        }
        // La sombra, debajo de la cadera.
        const pc = _v.setFromMatrixPosition(R.pelvis.matrixWorld);
        const sentado = pose.que === 'sentado' || pose.que === 'sofa' || pose.que === 'tumbado';
        const es = sentado ? 0.85 : 0.72;
        _m.compose(new THREE.Vector3(pc.x, 0.02, pc.z), _q.identity(), new THREE.Vector3(es, 1, es));
        sombras.setMatrixAt(i, _m);
        // La cabeza, para el rótulo y la esfera.
        const cab = (p.cabezaEn || (p.cabezaEn = new THREE.Vector3())).set(0, 0.25, 0).applyMatrix4(R.cabeza.matrixWorld);
        p.manoEn = (p.manoEn || new THREE.Vector3()).set(0, -0.06, 0.08).applyMatrix4(R.manoD.matrixWorld);
        const brillo = pose.esfera ?? 0;
        if (brillo > 0.01) {
          const y = cab.y + 0.32 + Math.sin(t * 2.1 + p.fase) * 0.025 + (pose.esferaSube || 0);
          h.nucleo.visible = true;
          h.nucleo.position.set(cab.x, y, cab.z);
          h.nucleo.scale.setScalar(0.75 + brillo * 0.35 + (pose.pulso || 0) * 0.4);
          h.s.position.set(cab.x, y, cab.z);
          const s = 0.42 + brillo * 0.34 + (pose.pulso || 0) * 0.9;
          h.s.scale.set(s, s, 1);
          h.s.material.opacity = Math.min(1, 0.35 + brillo * 0.55 + (pose.pulso || 0));
        } else { h.nucleo.visible = false; h.s.material.opacity = 0; }
      }
      for (const m of Object.values(partes)) m.instanceMatrix.needsUpdate = true;
      sombras.instanceMatrix.needsUpdate = true;
    },
  };
}

// ============================================================================================ el esqueleto
function armar() {
  const o = () => new THREE.Object3D();
  const R = { raiz: o(), cuerpo: o(), pelvis: o(), torso: o(), cuello: o(), cabeza: o() };
  R.raiz.add(R.cuerpo);
  R.cuerpo.add(R.pelvis);
  R.pelvis.add(R.torso);
  R.torso.add(R.cuello);
  R.cuello.add(R.cabeza);
  R.cuello.position.y = TORSO + 0.04;
  for (const [lado, s] of [['I', -1], ['D', 1]]) {
    const hombro = o(), codo = o(), mano = o(), cadera = o(), rodilla = o(), tobillo = o();
    hombro.position.set(s * 0.245, TORSO - 0.04, 0);
    codo.position.y = -BRAZO + 0.03;
    mano.position.y = -ANTEBRAZO + 0.04;
    R.torso.add(hombro); hombro.add(codo); codo.add(mano);
    cadera.position.set(s * 0.1, -0.05, 0);
    rodilla.position.y = -MUSLO + 0.02;
    tobillo.position.y = -PIERNA + 0.04;
    R.pelvis.add(cadera); cadera.add(rodilla); rodilla.add(tobillo);
    Object.assign(R, { [`hombro${lado}`]: hombro, [`codo${lado}`]: codo, [`mano${lado}`]: mano, [`cadera${lado}`]: cadera, [`rodilla${lado}`]: rodilla, [`tobillo${lado}`]: tobillo });
  }
  return R;
}

/**
 * La pose: { x, y, rumbo, que, ... } en el plano. `que`:
 *   de_pie · caminar (con `paso`, metros andados) · sentado (en silla, con `manos`: teclear, raton, pensar, quieto)
 *   sofa · tumbado · taburete · espera (de pie, a ratos saluda) · cafe (de pie con la taza) · billar · golf
 */
function posar(R, pose, t) {
  const { x, y, rumbo, que } = pose;
  R.raiz.position.set(x, 0, y);
  R.raiz.rotation.set(0, rumbo, 0);
  const rot = (obj, ax = 0, ay = 0, az = 0) => obj.rotation.set(ax, ay, az);
  // Lo neutro.
  R.cuerpo.position.set(0, 0, 0);
  R.cuerpo.rotation.set(0, 0, 0);
  R.pelvis.position.set(0, CADERA, 0);
  rot(R.pelvis); rot(R.torso); rot(R.cuello); rot(R.cabeza);
  for (const l of ['I', 'D']) { rot(R[`hombro${l}`], 0, 0, l === 'I' ? 0.06 : -0.06); rot(R[`codo${l}`], -0.12); rot(R[`mano${l}`]); rot(R[`cadera${l}`]); rot(R[`rodilla${l}`]); rot(R[`tobillo${l}`]); }
  const respira = Math.sin(t * 1.6) * 0.012;
  R.torso.rotation.x = respira;

  if (que === 'caminar') {
    const f = (pose.paso || 0) / 0.72 * Math.PI;   // una zancada cada 72 cm
    const a = Math.sin(f), b = Math.cos(f);
    R.pelvis.position.y = CADERA + Math.abs(b) * 0.035 - 0.02;
    R.pelvis.rotation.y = a * 0.12;
    R.torso.rotation.y = -a * 0.18;
    R.torso.rotation.x = 0.05;
    rot(R.caderaI, a * 0.52); rot(R.caderaD, -a * 0.52);
    rot(R.rodillaI, Math.max(0, -Math.sin(f + 1.2)) * 0.95); rot(R.rodillaD, Math.max(0, Math.sin(f + 1.2)) * 0.95);
    rot(R.tobilloI, -0.1); rot(R.tobilloD, -0.1);
    const llevaD = !!pose.lleva;
    rot(R.hombroI, -a * 0.5, 0, 0.08); rot(R.codoI, -0.35 - Math.max(0, a) * 0.3);
    if (llevaD) { rot(R.hombroD, -0.55, 0, -0.12); rot(R.codoD, -1.15); }
    else { rot(R.hombroD, a * 0.5, 0, -0.08); rot(R.codoD, -0.35 - Math.max(0, -a) * 0.3); }
    R.cabeza.rotation.x = -0.04;
    return;
  }
  const s = pose.s ?? 1;
  if (que === 'sentado' || que === 'taburete') {
    const alto = que === 'taburete' ? 0.84 : 0.585;
    R.pelvis.position.set(0, CADERA + (alto - CADERA) * s, -0.05 * s);
    rot(R.caderaI, -1.5 * s, 0, 0.04); rot(R.caderaD, -1.5 * s, 0, -0.04);
    rot(R.rodillaI, 1.5 * s); rot(R.rodillaD, 1.5 * s);
    if (que === 'taburete') { rot(R.rodillaI, 1.1 * s); rot(R.rodillaD, 1.25 * s); }
    rot(R.tobilloI, 0.02); rot(R.tobilloD, 0.02);
    const manos = s < 0.98 ? 'quieto' : pose.manos || 'quieto';
    R.torso.rotation.x = (manos === 'pensar' ? -0.12 : manos === 'teclear' ? 0.15 : 0.08) * s + respira;
    if (manos === 'teclear') {
      const k = Math.sin(t * 14) * 0.06, k2 = Math.sin(t * 13 + 1.3) * 0.06;
      rot(R.hombroI, -0.62, 0.16, 0.2); rot(R.codoI, -0.85 + k);
      rot(R.hombroD, -0.62, -0.16, -0.2); rot(R.codoD, -0.85 + k2);
      R.cabeza.rotation.x = 0.1 + Math.sin(t * 0.7) * 0.03;
      R.cuello.rotation.y = Math.sin(t * 0.4) * 0.06;
    } else if (manos === 'raton') {
      rot(R.hombroI, -0.55, 0.1, 0.16); rot(R.codoI, -1.0);
      rot(R.hombroD, -0.7, -0.05, -0.32); rot(R.codoD, -0.9 + Math.sin(t * 2.3) * 0.04);
      R.cabeza.rotation.x = 0.06;
      R.cuello.rotation.y = Math.sin(t * 0.5) * 0.12;
    } else if (manos === 'pensar') {
      rot(R.hombroI, -0.4, 0.2, 0.25); rot(R.codoI, -1.6);
      rot(R.hombroD, -1.0, -0.2, -0.3); rot(R.codoD, -2.2);
      R.cabeza.rotation.x = -0.12;
      R.cuello.rotation.y = Math.sin(t * 0.35) * 0.18;
      R.cuerpo.rotation.y = Math.sin(t * 0.25) * 0.14;
    } else if (manos === 'saludar') {
      // Te espera: girado en la silla y, cada tanto, levanta la mano.
      R.cuerpo.rotation.y = -1.05;
      R.torso.rotation.x = -0.06 + respira;
      const ciclo = (t % 5.5) / 5.5;
      const saludo = ciclo > 0.55 && ciclo < 0.9 ? Math.sin(((ciclo - 0.55) / 0.35) * Math.PI) : 0;
      rot(R.hombroD, -saludo * 2.6, 0, -0.15 - saludo * 0.35); rot(R.codoD, -0.9 + saludo * 0.75 + Math.sin(t * 9) * 0.22 * saludo);
      rot(R.hombroI, -0.3, 0, 0.18); rot(R.codoI, -1.0);
      R.cabeza.rotation.x = -0.06;
      R.cuello.rotation.y = 0.25 + Math.sin(t * 0.5) * 0.12;
    } else if (manos === 'cafe') {
      R.torso.rotation.x = -0.16 + respira;
      R.pelvis.position.z -= 0.03;
      rot(R.hombroI, -0.35, 0, 0.2); rot(R.codoI, -1.1);
      const sorbo = Math.max(0, Math.sin(t * 0.5)) ** 6;
      rot(R.hombroD, -0.45 - sorbo * 0.55, -0.15, -0.2); rot(R.codoD, -1.35 - sorbo * 0.85);
      R.cuello.rotation.y = Math.sin(t * 0.3) * 0.25;
    } else {
      rot(R.hombroI, -0.3, 0, 0.18); rot(R.codoI, -0.95);
      rot(R.hombroD, -0.3, 0, -0.18); rot(R.codoD, -0.95);
      R.cuello.rotation.y = Math.sin(t * 0.3) * 0.2;
    }
    return;
  }
  if (que === 'sofa') {
    const alto = pose.bajo ? 0.46 : 0.55;
    R.pelvis.position.set(0, CADERA + (alto - CADERA) * s, -0.08 * s);
    rot(R.pelvis, -0.18 * s);
    R.torso.rotation.x = -0.12 * s + respira;
    rot(R.caderaI, -1.3 * s, 0, 0.12 * s); rot(R.caderaD, -1.42 * s, 0, -0.06 * s);
    rot(R.rodillaI, 1.35 * s); rot(R.rodillaD, 1.5 * s);
    rot(R.hombroI, -0.3, 0, 0.45); rot(R.codoI, -0.6);
    const sorbo = pose.manos === 'cafe' ? Math.max(0, Math.sin(t * 0.45)) ** 6 : 0;
    rot(R.hombroD, -0.5 - sorbo * 0.5, -0.1, -0.25); rot(R.codoD, -1.2 - sorbo * 0.9);
    R.cuello.rotation.y = Math.sin(t * 0.28) * 0.3;
    R.cabeza.rotation.x = 0.05;
    return;
  }
  if (que === 'tumbado') {
    R.pelvis.position.set(0, CADERA + (0.44 - CADERA) * s, 0.1 * s);
    rot(R.pelvis, -0.95 * s);
    R.torso.rotation.x = -0.1 * s + respira;
    rot(R.caderaI, -0.75 * s, 0, 0.06); rot(R.caderaD, -0.62 * s, 0, -0.08);
    rot(R.rodillaI, 0.3 * s); rot(R.rodillaD, 0.5 * s);
    if (s < 0.98) return;
    rot(R.hombroI, -2.6, 0, 0.5); rot(R.codoI, -2.0);
    rot(R.hombroD, -2.6, 0, -0.5); rot(R.codoD, -2.0);
    R.cabeza.rotation.x = 0.7;
    return;
  }
  // De pie: esperar, el café, el billar, el golf.
  const balanceo = Math.sin(t * 0.9) * 0.025;
  R.pelvis.rotation.z = balanceo;
  R.torso.rotation.z = -balanceo * 0.6;
  rot(R.caderaI, 0, 0, 0.04); rot(R.caderaD, 0, 0, -0.04);
  if (que === 'espera') {
    // Mira hacia la cámara y cada tanto levanta la mano: «te espero».
    const ciclo = (t % 6.5) / 6.5;
    const saludo = ciclo > 0.62 && ciclo < 0.92 ? Math.sin(((ciclo - 0.62) / 0.3) * Math.PI) : 0;
    rot(R.hombroD, -saludo * 2.6, 0, -0.1 - saludo * 0.4); rot(R.codoD, -0.2 - saludo * 0.9 + Math.sin(t * 9) * 0.25 * saludo);
    rot(R.hombroI, 0, 0, 0.1); rot(R.codoI, -0.25);
    R.cabeza.rotation.x = -0.05;
    R.cuello.rotation.y = Math.sin(t * 0.6) * 0.18;
    return;
  }
  if (que === 'cafe') {
    const sorbo = Math.max(0, Math.sin(t * 0.55)) ** 6;
    rot(R.hombroD, -0.5 - sorbo * 0.7, -0.1, -0.18); rot(R.codoD, -1.3 - sorbo * 0.9);
    rot(R.hombroI, 0, 0, 0.1); rot(R.codoI, -0.3);
    R.cuello.rotation.y = Math.sin(t * 0.4) * 0.3;
    return;
  }
  if (que === 'billar') {
    const golpe = Math.sin(t * 0.8);
    R.torso.rotation.x = 0.75;
    R.pelvis.position.y = CADERA - 0.05;
    rot(R.caderaI, -0.25, 0, 0.12); rot(R.caderaD, 0.2, 0, -0.08);
    rot(R.hombroD, -0.9 - golpe * 0.12, 0, -0.2); rot(R.codoD, -1.1 + golpe * 0.4);
    rot(R.hombroI, -1.25, 0.2, 0.15); rot(R.codoI, -0.2);
    R.cabeza.rotation.x = -0.65;
    return;
  }
  if (que === 'golf') {
    const golpe = Math.sin(t * 0.7) * 0.25;
    R.torso.rotation.x = 0.4;
    rot(R.caderaI, -0.12, 0, 0.16); rot(R.caderaD, -0.12, 0, -0.16);
    rot(R.rodillaI, 0.2); rot(R.rodillaD, 0.2);
    rot(R.hombroD, -0.15 + golpe, 0, 0.25); rot(R.codoD, -0.05);
    rot(R.hombroI, -0.15 + golpe, 0, -0.25); rot(R.codoI, -0.05);
    R.cabeza.rotation.x = -0.45;
    return;
  }
  // De pie, quieto.
  rot(R.hombroI, Math.sin(t * 0.7) * 0.03, 0, 0.1); rot(R.codoI, -0.2);
  rot(R.hombroD, -Math.sin(t * 0.7) * 0.03, 0, -0.1); rot(R.codoD, -0.2);
  R.cuello.rotation.y = Math.sin(t * 0.4) * 0.25;
}
