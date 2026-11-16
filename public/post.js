// EL RENDER FINO: lo que se le hace a la imagen después de dibujarla.
//
//   · Oclusión ambiental (GTAO): la sombra suave donde las cosas se tocan: la silla con el piso, la persona con el sofá, el
//     libro con la repisa. Es lo que hace que la maqueta deje de verse «flotando». Se recalcula cuando la cámara se mueve; con la
//     cámara quieta, una vez de cada cuatro cuadros (lo que se mueve son personas, y su sombra cambia poco).
//   · Brillo (bloom): de noche las ventanas, el letrero, las luces colgantes y las pantallas se ven encendidas de verdad.
//   · Desenfoque de maqueta (tilt-shift): lo de arriba y lo de abajo de la pantalla se desenfoca un poco, como una foto de una
//     maqueta; se apaga al acercarse.
//
// Tres niveles: «alta» (todo), «media» (sin la oclusión, que es lo más caro) y «baja» (sin nada: el dibujo de siempre). La página
// arranca en alta y baja un nivel si la tarjeta gráfica no alcanza; `?calidad=alta|media|baja` lo fija.
import * as THREE from './vendor/three.module.min.js';
import { EffectComposer } from './vendor/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/postprocessing/RenderPass.js';
import { ShaderPass } from './vendor/postprocessing/ShaderPass.js';
import { OutputPass } from './vendor/postprocessing/OutputPass.js';
import { UnrealBloomPass } from './vendor/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from './vendor/postprocessing/GTAOPass.js';

/** La oclusión, con dos ahorros: sin lo transparente (vidrio, halos, letreros) y sin recalcular si la cámara no se movió. */
class Oclusion extends GTAOPass {
  constructor(...a) {
    super(...a);
    this._cam = new THREE.Matrix4();
    this._proy = new THREE.Matrix4();
    this._n = 0;
    this._listo = false;
    this.escala = 1;
  }
  overrideVisibility() {
    const cache = this._visibilityCache;
    this.scene.traverse((o) => {
      cache.set(o, o.visible);
      if (o.isPoints || o.isLine || o.isSprite || (o.material && (o.material.transparent || o.userData?.sinAO || o.material.userData?.sinAO))) o.visible = false;
    });
  }
  setSize(w, h) { super.setSize(Math.max(2, Math.round(w * this.escala)), Math.max(2, Math.round(h * this.escala))); }
  render(renderer, writeBuffer, readBuffer, dt, mascara) {
    this._n++;
    const quieta = this._cam.equals(this.camera.matrixWorld) && this._proy.equals(this.camera.projectionMatrix);
    if (this._listo && quieta && this._n % 4 !== 0) {
      // Solo se mezcla la oclusión que ya estaba calculada.
      this.copyMaterial.uniforms.tDiffuse.value = readBuffer.texture;
      this.copyMaterial.blending = THREE.NoBlending;
      this.renderPass(renderer, this.copyMaterial, this.renderToScreen ? null : writeBuffer);
      this.blendMaterial.uniforms.intensity.value = this.blendIntensity;
      this.blendMaterial.uniforms.tDiffuse.value = this.pdRenderTarget.texture;
      this.renderPass(renderer, this.blendMaterial, this.renderToScreen ? null : writeBuffer);
      return;
    }
    this._cam.copy(this.camera.matrixWorld);
    this._proy.copy(this.camera.projectionMatrix);
    // Sin el cielo: three dibuja el fondo como un cuadrado de 2 m sin normales en el centro del mundo, y con el material de
    // normales ese cuadrado sale negro en la oclusión (una mancha en el corredor). El cielo ya está en la imagen de color.
    const fondo = this.scene.background;
    this.scene.background = null;
    super.render(renderer, writeBuffer, readBuffer, dt, mascara);
    this.scene.background = fondo;
    this._listo = true;
  }
}

/** El desenfoque de maqueta: una franja nítida en el centro que se abre hacia arriba y hacia abajo. */
const Desenfoque = (vertical) => ({
  uniforms: { tDiffuse: { value: null }, paso: { value: 0 }, centro: { value: 0.52 }, banda: { value: 0.16 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float paso; uniform float centro; uniform float banda; varying vec2 vUv;
    void main() {
      float k = paso * smoothstep(banda, banda + 0.32, abs(vUv.y - centro));
      if (k < 1e-5) { gl_FragColor = texture2D(tDiffuse, vUv); return; }
      vec2 d = ${vertical ? 'vec2(0.0, k)' : 'vec2(k, 0.0)'};
      vec4 s = texture2D(tDiffuse, vUv) * 0.1964825501511404;
      s += texture2D(tDiffuse, vUv + d * 1.411764705882353) * 0.2969069646728344;
      s += texture2D(tDiffuse, vUv - d * 1.411764705882353) * 0.2969069646728344;
      s += texture2D(tDiffuse, vUv + d * 3.2941176470588234) * 0.09447039785044732;
      s += texture2D(tDiffuse, vUv - d * 3.2941176470588234) * 0.09447039785044732;
      s += texture2D(tDiffuse, vUv + d * 5.176470588235294) * 0.010381362401148057;
      s += texture2D(tDiffuse, vUv - d * 5.176470588235294) * 0.010381362401148057;
      gl_FragColor = s;
    }`,
});

export function crearPost(renderer, escena, camara) {
  let nivel = null, compositor = null, oclusion = null, brillo = null, dh = null, dv = null;
  let noche = false;
  const tam = new THREE.Vector2();

  function armar(n) {
    if (compositor) { for (const p of compositor.passes) p.dispose?.(); compositor.dispose(); }
    compositor = null; oclusion = null; brillo = null; dh = null; dv = null;
    nivel = n;
    if (n === 'baja') return;
    renderer.getDrawingBufferSize(tam);
    const pixeles = tam.x * tam.y;
    // Antialias por muestras: cuatro hasta 1080p con escala; a 4K bastan dos (los píxeles ya son muy chicos).
    const rt = new THREE.WebGLRenderTarget(tam.x, tam.y, { type: THREE.HalfFloatType, samples: pixeles > 3.2e6 ? 2 : 4 });
    compositor = new EffectComposer(renderer, rt);
    compositor.addPass(new RenderPass(escena, camara));
    if (n === 'alta') {
      oclusion = new Oclusion(escena, camara, tam.x, tam.y);
      oclusion.escala = pixeles > 3.2e6 ? 0.5 : pixeles > 1.6e6 ? 0.75 : 1;
      oclusion.setSize(tam.x, tam.y);
      oclusion.updateGtaoMaterial({ radius: 0.42, distanceExponent: 1.6, thickness: 0.9, scale: 1.15, samples: 12, distanceFallOff: 1 });
      oclusion.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      oclusion.blendIntensity = 0.92;
      compositor.addPass(oclusion);
    }
    brillo = new UnrealBloomPass(new THREE.Vector2(tam.x / 2, tam.y / 2), 0.2, 0.55, 2.2);
    compositor.addPass(brillo);
    dh = new ShaderPass(Desenfoque(false));
    dv = new ShaderPass(Desenfoque(true));
    compositor.addPass(dh);
    compositor.addPass(dv);
    compositor.addPass(new OutputPass());
    compositor.setPixelRatio(1);
    compositor.setSize(tam.x, tam.y);
    ponerNoche(noche);
  }
  function ponerNoche(n) {
    noche = n;
    if (!brillo) return;
    brillo.threshold = n ? 0.72 : 2.4;
    brillo.strength = n ? 0.62 : 0.16;
    brillo.radius = n ? 0.6 : 0.45;
  }
  return {
    get nivel() { return nivel; },
    get oclusion() { return oclusion; },
    armar,
    ponerNoche,
    /** Cuánto se desenfoca: nada de cerca, lo justo de lejos. */
    enfocar(distancia) {
      if (!dh) return;
      renderer.getDrawingBufferSize(tam);
      const k = THREE.MathUtils.smoothstep(distancia, 30, 85);
      dh.uniforms.paso.value = (1.15 * k) / tam.x * (tam.y / 1080);
      dv.uniforms.paso.value = (1.15 * k) / tam.y * (tam.y / 1080);
    },
    tamano() {
      if (!compositor) return;
      renderer.getDrawingBufferSize(tam);
      compositor.setPixelRatio(1);
      compositor.setSize(tam.x, tam.y);
    },
    dibujar(dt) {
      if (compositor) compositor.render(dt);
      else renderer.render(escena, camara);
    },
  };
}
