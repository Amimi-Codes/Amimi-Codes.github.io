import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// Loaded by index.html once the puzzle is complete; see the launch order notes there.
const canvas = document.getElementById('scene');
const portal = window.__portal || {};
if (portal.dissolving) await portal.revealed; // arrived late: don't build while the name dissolves
const MOTION = !matchMedia('(prefers-reduced-motion: reduce)').matches;

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (e) {
  canvas.remove(); // CSS gradient behind stays as the fallback
  portal.resolveScene();
  throw e;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const FOG = new THREE.Color('#06374d');
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(FOG, 0.042);

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 400);
const camBase = new THREE.Vector3(0, 1.6, 10);
const camTarget = new THREE.Vector3(0, 0.95, 0);

const uTime = { value: 0 };

/* ---------- noise ---------- */
function hash(x, y) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function noise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, oct = 4) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += a * noise(x * f, y * f); f *= 2.03; a *= 0.5; }
  return s;
}
const rand = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();

/* ---------- caustics patch for lit materials ---------- */
const CAUSTIC_GLSL = `
uniform float uTime; uniform float uCaustic;
varying vec3 vCWorld; varying float vCUp;
float caustic(vec2 uv, float time){
  vec2 p = mod(uv*6.28318, 6.28318) - 250.0;
  vec2 i = p; float c = 1.0; float inten = .005;
  for (int n = 0; n < 4; n++) {
    float t = time * (1.0 - (3.5 / float(n+1)));
    i = p + vec2(cos(t - i.x) + sin(t + i.y), sin(t - i.y) + cos(t + i.x));
    c += 1.0/length(vec2(p.x / (sin(i.x+t)/inten), p.y / (cos(i.y+t)/inten)));
  }
  c /= 4.0; c = 1.17 - pow(c, 1.4);
  return pow(abs(c), 8.0);
}
`;
function withCaustics(mat, strength = 1) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.uniforms.uCaustic = { value: strength };
    sh.vertexShader = 'varying vec3 vCWorld; varying float vCUp;\n' + sh.vertexShader.replace(
      '#include <project_vertex>',
      `#include <project_vertex>
       vCWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
       vCUp = normalize(mat3(modelMatrix) * objectNormal).y;`);
    sh.fragmentShader = CAUSTIC_GLSL + sh.fragmentShader.replace(
      '#include <opaque_fragment>',
      `float cz = caustic(vCWorld.xz*0.16, uTime*0.55) + 0.6*caustic(vCWorld.xz*0.29 + 3.1, uTime*0.4);
       float depthFade = clamp(1.0 - (2.0 - vCWorld.y)*0.08, 0.35, 1.2);
       outgoingLight += diffuseColor.rgb * uCaustic * cz * depthFade * smoothstep(-0.3, 0.9, vCUp) * vec3(0.55, 0.95, 1.0);
       #include <opaque_fragment>`);
  };
  return mat;
}

/* ---------- canvas textures ---------- */
function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
function sandDraw(g, w, h) {
  const img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const n = fbm(x * 0.05, y * 0.05, 3) * 0.6 + hash(x, y) * 0.4;
    const shell = hash(x * 3 + 11, y * 7) > 0.996 ? 60 : 0;
    const v = 120 + n * 90 + shell;
    const i = (y * w + x) * 4;
    img.data[i] = v; img.data[i + 1] = v * 0.94; img.data[i + 2] = v * 0.8; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}
// step: texture pixels per pattern pixel (2 = half resolution, same pattern);
// x0: first pattern column, to draw only the slice a mesh actually shows
function woodDraw(horizontal, stainBottom, step = 1, x0 = 0) {
  return (g, w, h) => {
    const img = g.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const px = (x + x0) * step, py = y * step;
      const a = horizontal ? px : py, b = horizontal ? py : px;
      const grain = Math.sin(b * 0.09 + fbm(a * 0.004, b * 0.03, 4) * 9) * 0.5 + 0.5;
      const fine = hash(a >> 2, b) * 0.25;
      const rot = fbm(a * 0.01 + 40, b * 0.02, 4);
      let v = 0.35 + grain * 0.3 + fine - Math.max(0, rot - 0.55) * 1.4;
      if (stainBottom) v *= 0.45 + 0.55 * Math.min(1, (h - y) / (h * 0.35));
      const i = (y * w + x) * 4;
      img.data[i] = 110 * v; img.data[i + 1] = 78 * v; img.data[i + 2] = 52 * v; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  };
}

/* ---------- sky / water volume ---------- */
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(200, 48, 24),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uTime, uTop: { value: new THREE.Color('#2a9cc0') }, uHorizon: { value: FOG.clone() }, uBottom: { value: new THREE.Color('#010a10') } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `uniform float uTime; uniform vec3 uTop, uHorizon, uBottom; varying vec3 vDir;
      void main(){
        float h = vDir.y;
        vec3 col = mix(uHorizon, uTop, smoothstep(0.02, 0.95, h));
        col = mix(col, uBottom, smoothstep(0.0, -0.35, h));
        float sun = pow(max(dot(vDir, normalize(vec3(0.15, 1.0, -0.35))), 0.0), 10.0);
        col += vec3(0.25, 0.65, 0.75) * sun;
        float rip = sin(vDir.x*70.0 + uTime*0.7 + sin(vDir.z*30.0)) * sin(vDir.z*64.0 - uTime*0.5);
        col += vec3(0.08, 0.22, 0.28) * smoothstep(0.55, 1.0, h) * rip * 0.35;
        gl_FragColor = vec4(col, 1.0);
      }`
  })
);
sky.renderOrder = -1;
scene.add(sky);

/* ---------- lights ---------- */
scene.add(new THREE.HemisphereLight('#5fd0ef', '#04121a', 0.9));
const sun = new THREE.DirectionalLight('#a6ecff', 2.4);
sun.position.set(3.5, 18, 5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 40 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03; sun.shadow.radius = 4;
scene.add(sun);

/* ---------- seabed ---------- */
function groundHeight(x, z) {
  const d = Math.hypot(x, z);
  let h = (fbm(x * 0.05 + 10, z * 0.05, 4) - 0.5) * 1.6;
  h += Math.sin(x * 2.1 + fbm(x * 0.2, z * 0.2) * 4) * 0.025;            // sand ripples
  h += Math.max(0, d - 16) * 0.12 * fbm(x * 0.03, z * 0.03 + 5, 3) * 2;    // far ridges
  h *= THREE.MathUtils.smoothstep(d, 1.5, 7) * 0.8 + 0.2;                   // flatter around the sign
  return h;
}
{
  const geo = new THREE.PlaneGeometry(240, 240, 260, 260);
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, groundHeight(p.getX(i), p.getZ(i)));
  geo.computeVertexNormals();
  const tex = canvasTex(512, 512, sandDraw);
  tex.repeat.set(70, 70);
  const bump = new THREE.CanvasTexture(tex.image); // same pattern, drawn once
  bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
  bump.anisotropy = 8;
  bump.repeat.set(70, 70);
  const sand = new THREE.Mesh(geo, withCaustics(new THREE.MeshStandardMaterial({
    map: tex, bumpMap: bump, bumpScale: 1.2, roughness: 0.96, color: '#a89e86'
  }), 2.4));
  sand.receiveShadow = true;
  scene.add(sand);
}

/* ---------- rocks & distant arches ---------- */
const rockMat = withCaustics(new THREE.MeshStandardMaterial({ color: '#43514f', roughness: 0.92, flatShading: false }), 1.1);
function makeRock(seed, detail = 4) {
  let g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  g = mergeVertices(g);
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = fbm(v.x * 1.6 + seed, v.y * 1.6 + v.z * 1.3 + seed * 2, 5);
    v.multiplyScalar(0.7 + n * 0.75);
    if (v.y < -0.25) v.y = -0.25 + (v.y + 0.25) * 0.2;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, rockMat);
  m.castShadow = m.receiveShadow = true;
  return m;
}
for (let i = 0; i < 34; i++) {
  const ang = rand() * Math.PI * 2, dist = 4.5 + rand() * 22;
  const x = Math.cos(ang) * dist, z = Math.sin(ang) * dist - 4;
  if (z > 1.5 || Math.hypot(x - 3.9, z + 1.2) < 3 || (Math.abs(x) < 3.5 && z > -4)) continue; // keep sign, clam and foreground clear
  const r = makeRock(i * 3.7, dist > 14 ? 3 : 4);
  const s = 0.35 + rand() * (dist > 12 ? 2.4 : 1.1);
  r.scale.set(s * (1 + rand() * 0.6), s * (0.5 + rand() * 0.6), s);
  r.rotation.y = rand() * 6.28;
  r.position.set(x, groundHeight(x, z) - 0.05, z);
  scene.add(r);
}
// distant rock arch + pillars for scale
{
  let g = new THREE.TorusGeometry(7, 1.6, 16, 60, Math.PI);
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  g = mergeVertices(g);
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = fbm(v.x * 0.35, v.y * 0.35 + v.z * 0.4, 4);
    v.addScaledVector(v.clone().setZ(0).normalize(), (n - 0.5) * 1.8);
    v.z += (n - 0.5) * 1.5;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  const arch = new THREE.Mesh(g, rockMat);
  arch.position.set(-9, -1, -24);
  arch.rotation.y = 0.35;
  scene.add(arch);
  [[11, -20, 7], [15, -27, 11], [-21, -16, 6]].forEach(([x, z, h], i) => {
    const r = makeRock(50 + i, 3);
    r.scale.set(1.6, h, 1.8);
    r.position.set(x, groundHeight(x, z) + h * 0.35, z);
    scene.add(r);
  });
}

/* ---------- kelp & algae ---------- */
const kelpMat = new THREE.MeshStandardMaterial({ color: '#4f7a42', roughness: 0.6, side: THREE.DoubleSide, transparent: true, opacity: 0.88 });
kelpMat.onBeforeCompile = (sh) => {
  sh.uniforms.uTime = uTime;
  sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `
    #include <begin_vertex>
    float kh = uv.y;
    vec4 ip = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    float ph = ip.x * 0.7 + ip.z * 0.5;
    transformed.x += sin(uTime * 0.9 + ph + kh * 2.2) * kh * kh * 0.5;
    transformed.z += cos(uTime * 0.7 + ph * 1.3 + kh * 1.6) * kh * kh * 0.3;`);
};
{
  const blade = new THREE.PlaneGeometry(0.16, 1, 1, 24);
  blade.translate(0, 0.5, 0);
  const p = blade.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    p.setX(i, p.getX(i) * (1 - y * 0.55) * (1 + Math.sin(y * 20) * 0.12));
  }
  blade.computeVertexNormals();
  const spots = [];
  const cluster = (cx, cz, n, hMin, hMax, spread) => {
    for (let i = 0; i < n; i++) spots.push([cx + (rand() - 0.5) * spread, cz + (rand() - 0.5) * spread, hMin + rand() * (hMax - hMin)]);
  };
  cluster(-6, -4, 16, 2.5, 6.5, 2.6);
  cluster(-10, -8, 16, 3, 8, 3.5);
  cluster(7.5, -5.5, 14, 2.5, 6, 2.8);
  cluster(11, -11, 14, 3, 8, 3.5);
  cluster(-3.8, -1.2, 6, 1, 2.2, 1.2);
  cluster(0, 0, 14, 0.25, 0.7, 0.7);       // algae at the sign base
  cluster(3.9, -1.2, 8, 0.2, 0.5, 1.8);    // around the clam
  cluster(-2.5, 2.2, 10, 0.3, 0.9, 1.5);
  const kelp = new THREE.InstancedMesh(blade, kelpMat, spots.length);
  const d = new THREE.Object3D();
  spots.forEach(([x, z, h], i) => {
    d.position.set(x, groundHeight(x, z) - 0.05, z);
    d.rotation.set(0, rand() * 6.28, (rand() - 0.5) * 0.15);
    d.scale.set(0.8 + rand() * 0.7, h, 1);
    d.updateMatrix();
    kelp.setMatrixAt(i, d.matrix);
  });
  kelp.castShadow = true;
  scene.add(kelp);
}
// tube sponges
{
  const tube = new THREE.CylinderGeometry(0.07, 0.1, 0.55, 12, 1, true);
  tube.translate(0, 0.27, 0);
  const mat = withCaustics(new THREE.MeshStandardMaterial({ color: '#8a4a5c', roughness: 0.8, side: THREE.DoubleSide, emissive: '#2a0c18', emissiveIntensity: 0.4 }), 0.8);
  [[-3.4, -0.6], [4.8, -1.8], [-6.5, 1], [2.2, -3.5]].forEach(([cx, cz]) => {
    for (let i = 0; i < 5; i++) {
      const m = new THREE.Mesh(tube, mat);
      const x = cx + (rand() - 0.5) * 0.6, z = cz + (rand() - 0.5) * 0.6;
      m.position.set(x, groundHeight(x, z) - 0.03, z);
      m.scale.setScalar(0.6 + rand() * 0.9);
      m.rotation.set((rand() - 0.5) * 0.4, 0, (rand() - 0.5) * 0.4);
      m.castShadow = true;
      scene.add(m);
    }
  });
}

/* ---------- god rays ---------- */
const rayMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
  uniforms: { uTime, uOpacity: { value: 0.16 }, uColor: { value: new THREE.Color('#8cefff') } },
  vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
    void main(){ vUv = uv; vN = normalize(normalMatrix*normal); vec4 mv = modelViewMatrix*vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
  fragmentShader: `uniform float uTime, uOpacity; uniform vec3 uColor; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
    void main(){
      float edge = pow(abs(dot(vN, vV)), 2.0);
      float fade = smoothstep(0.0, 0.55, vUv.y) * smoothstep(1.0, 0.8, vUv.y);
      float streak = 0.55 + 0.45 * sin(vUv.x*38.0 + uTime*0.35) * sin(vUv.x*15.0 - uTime*0.22);
      gl_FragColor = vec4(uColor, uOpacity * edge * fade * streak);
    }`
});
const rays = [];
[[-6, -7, 0.22, 1.0], [-1.5, -4, 0.08, 1.3], [3.5, -6, -0.12, 1.0], [8.5, -10, -0.2, 0.8], [-12, -14, 0.25, 0.7]].forEach(([x, z, tilt, w], i) => {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.5 * w, 2.6 * w, 30, 24, 1, true), rayMat.clone());
  m.material.uniforms.uTime = uTime;
  m.position.set(x, 13.5, z);
  m.rotation.set(0.12, 0, tilt);
  m.userData.phase = i * 1.7;
  rays.push(m);
  scene.add(m);
});

/* ---------- signpost ---------- */
// the post is ~450px tall on screen, so half resolution looks the same
const woodPostTex = canvasTex(128, 512, woodDraw(false, true, 2));
// the planks show columns 102-533 of a 1024-wide pattern: draw just those
const woodPlankTex = canvasTex(432, 256, woodDraw(true, false, 1, 102));
woodPlankTex.repeat.set(430 / 432, 2);
woodPlankTex.offset.set(0.4 / 432, 0.5);
const sign = new THREE.Group();
sign.rotation.z = 0.025;
scene.add(sign);
{
  const post = new THREE.Mesh(
    new THREE.CylinderGeometry(0.13, 0.155, 4.5, 14, 20),
    withCaustics(new THREE.MeshStandardMaterial({ map: woodPostTex, bumpMap: woodPostTex, bumpScale: 2, roughness: 0.9 }), 0.9)
  );
  const p = post.geometry.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const n = 1 + (fbm(p.getY(i) * 1.5, Math.atan2(p.getZ(i), p.getX(i)) * 2) - 0.5) * 0.18;
    p.setX(i, p.getX(i) * n); p.setZ(i, p.getZ(i) * n);
  }
  post.geometry.computeVertexNormals();
  post.position.y = 2.0;
  post.castShadow = post.receiveShadow = true;
  sign.add(post);

  // lamp
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.12, 16), new THREE.MeshStandardMaterial({ color: '#4a4436', metalness: 0.8, roughness: 0.55 }));
  collar.position.y = 4.28;
  sign.add(collar);
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.17, 32, 16), new THREE.MeshStandardMaterial({ color: '#ffcf6b', emissive: '#ffae3d', emissiveIntensity: 5 }));
  orb.position.y = 4.48;
  sign.add(orb);
  // a soft halo instead of a real point light: a light is computed for every lit pixel on
  // screen (the whole seabed), the halo only where it is drawn; bloom makes the orb shine
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: canvasTex(64, 64, (g, w, h) => {
      const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      r.addColorStop(0, 'rgba(255,190,90,0.9)');
      r.addColorStop(0.35, 'rgba(255,170,70,0.35)');
      r.addColorStop(1, 'rgba(255,160,60,0)');
      g.fillStyle = r;
      g.fillRect(0, 0, w, h);
    }),
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true
  }));
  halo.scale.setScalar(2.2);
  halo.position.y = 4.48;
  sign.add(halo);
  sign.userData.halo = halo;
  sign.userData.orb = orb;
}

async function makeLabel(text, w, h, color, font) {
  await document.fonts.load(font).catch(() => {});
  return canvasTex(w, h, (g) => {
    g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = color; g.fillText(text, w / 2, h / 2 + 4);
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 900; i++) { g.globalAlpha = rand() * 0.6; g.fillRect(rand() * w, rand() * h, 1 + rand() * 4, 1 + rand() * 3); }
  });
}

const planks = {};
const pickables = [];
const hullColor = new THREE.Color().setRGB(0.35, 2.4, 2.1); // HDR so it blooms
async function makePlank(choice, label, dir, y, tilt) {
  const L = 2.45, H = 0.5;
  const s = new THREE.Shape();
  s.moveTo(-0.12 * dir, -H / 2);
  s.lineTo((L - 0.38) * dir, -H / 2);
  s.lineTo(L * dir, 0);
  s.lineTo((L - 0.38) * dir, H / 2);
  s.lineTo(-0.12 * dir, H / 2);
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.08, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.015, bevelSegments: 2 });
  const mat = withCaustics(new THREE.MeshStandardMaterial({ map: woodPlankTex, bumpMap: woodPlankTex, bumpScale: 2, roughness: 0.88, emissive: '#000000' }), 0.9);
  const plank = new THREE.Mesh(geo, mat);
  plank.castShadow = plank.receiveShadow = true;

  // outline hull for the holographic highlight
  geo.computeBoundingBox();
  const c = geo.boundingBox.getCenter(new THREE.Vector3());
  const hullGeo = geo.clone().translate(-c.x, -c.y, -c.z).scale(1.035, 1.16, 1.5).translate(c.x, c.y, c.z);
  const hull = new THREE.Mesh(hullGeo, new THREE.MeshBasicMaterial({ color: hullColor, side: THREE.BackSide, transparent: true, opacity: 0, depthWrite: false, fog: false }));

  const tex = await makeLabel(label, 1024, 180, '#fff3da', '700 104px "DM Sans", sans-serif');
  const text = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.35), withCaustics(new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: '#ffffff', emissiveIntensity: 0.22, transparent: true, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2 }), 0.6));
  text.position.set(1.08 * dir, 0, 0.098);

  const g = new THREE.Group();
  g.add(plank, hull, text);
  g.position.set(0, y, 0.15);
  g.rotation.z = tilt;
  sign.add(g);

  [plank, text].forEach((m) => { m.userData.choice = choice; pickables.push(m); });
  planks[choice] = { mat, hull, glow: 0 };
}
await Promise.all([
  makePlank('surface', 'THE SURFACE', 1, 3.45, 0.19),
  makePlank('reef', 'THE REEF', -1, 2.7, -0.02),
  makePlank('abyss', 'THE ABYSS', 1, 1.95, -0.19)
]);

// barnacles on the post and plank roots
{
  const bg = new THREE.CylinderGeometry(0.014, 0.04, 0.035, 8);
  bg.translate(0, 0.017, 0);
  const bm = new THREE.InstancedMesh(bg, new THREE.MeshStandardMaterial({ color: '#8d9188', roughness: 1 }), 60);
  const d = new THREE.Object3D(), out = new THREE.Vector3();
  for (let i = 0; i < 60; i++) {
    const a = -Math.PI * 0.1 + rand() * Math.PI * 1.2;
    const y = Math.pow(rand(), 1.8) * 2.3;
    const r = 0.15;
    d.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
    out.set(Math.cos(a) * 2, y, Math.sin(a) * 2);
    d.lookAt(out);
    d.rotateX(Math.PI / 2);
    d.scale.setScalar(0.4 + rand() * 0.6);
    d.updateMatrix();
    bm.setMatrixAt(i, d.matrix);
  }
  bm.castShadow = true;
  sign.add(bm);
}

/* ---------- clam & pearl ---------- */
const clam = new THREE.Group();
clam.position.set(3.9, groundHeight(3.9, -1.2) + 0.14, -1.2);
clam.rotation.y = -0.5;
clam.scale.setScalar(1.2);
scene.add(clam);
let topShell, pearl, pearlLight;
{
  const shellGeo = (top) => {
    const g = new THREE.SphereGeometry(0.85, 64, 24, 0, Math.PI * 2, top ? 0 : Math.PI / 2, Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const ridge = 1 + Math.abs(Math.sin(Math.atan2(z, x) * 11)) * 0.06 * Math.min(1, Math.abs(y) * 3);
      const scallop = 1 + Math.sin(Math.atan2(z, x) * 11) * 0.03 * (1 - Math.abs(y) / 0.85);
      p.setXYZ(i, x * ridge * scallop, y * 0.42, z * ridge * 0.85);
    }
    g.computeVertexNormals();
    return g;
  };
  const outer = withCaustics(new THREE.MeshStandardMaterial({ color: '#8f645d', roughness: 0.55, bumpMap: woodPostTex, bumpScale: 0.6 }), 1);
  const nacre = new THREE.MeshPhysicalMaterial({ color: '#c9a7a2', roughness: 0.35, iridescence: 0.8, iridescenceIOR: 1.4, side: THREE.BackSide });

  const lower = new THREE.Group();
  const lo = new THREE.Mesh(shellGeo(false), outer);
  const li = new THREE.Mesh(shellGeo(false), nacre); li.scale.setScalar(0.97);
  lo.castShadow = true;
  lower.add(lo, li);
  clam.add(lower);

  topShell = new THREE.Group();
  topShell.position.z = -0.72; // hinge at the back
  const to = new THREE.Mesh(shellGeo(true), outer);
  const ti = new THREE.Mesh(shellGeo(true), nacre); ti.scale.setScalar(0.97);
  to.position.z = ti.position.z = 0.72;
  to.castShadow = true;
  topShell.add(to, ti);
  topShell.rotation.x = -0.95;
  clam.add(topShell);

  pearl = new THREE.Mesh(
    new THREE.SphereGeometry(0.34, 48, 24),
    new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.12, clearcoat: 1, iridescence: 0.7, emissive: '#7fe6ff', emissiveIntensity: 0.8 })
  );
  pearl.position.set(0, 0.3, 0.05);
  clam.add(pearl);
  pearlLight = new THREE.PointLight('#9ff4ff', 2.5, 4, 2);
  pearlLight.position.set(0, 0.5, 0.2);
  clam.add(pearlLight);

  const labelTex = await makeLabel('RESUME', 512, 160, '#06303e', '700 92px "DM Sans", sans-serif');
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTex, transparent: true, depthTest: false }));
  label.scale.set(0.6, 0.19, 1);
  label.renderOrder = 5;
  label.position.set(0, 0.3, 0.4);
  clam.add(label);

  [lo, to, pearl, label].forEach((m) => { m.userData.resume = true; pickables.push(m); });
}

/* ---------- marine snow (3 depth layers, near one as bokeh) ---------- */
function snowLayer(count, box, size, soft, opacity) {
  const pos = new Float32Array(count * 3), seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = box[0] + rand() * (box[1] - box[0]);
    pos[i * 3 + 1] = rand() * 20;
    pos[i * 3 + 2] = box[2] + rand() * (box[3] - box[2]);
    seed[i] = rand();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    uniforms: { uTime, uSize: { value: size }, uPR: { value: renderer.getPixelRatio() }, uSoft: { value: soft }, uOpacity: { value: opacity } },
    vertexShader: `uniform float uTime, uSize, uPR; attribute float aSeed; varying float vA;
      void main(){
        vec3 p = position;
        p.y = mod(p.y - uTime*(0.04 + aSeed*0.07), 20.0) - 5.0;
        p.x += sin(uTime*0.25 + aSeed*30.0) * 0.35;
        p.z += cos(uTime*0.2 + aSeed*17.0) * 0.25;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float d = -mv.z;
        gl_PointSize = uSize * uPR * (0.5 + aSeed) * (10.0 / d);
        vA = exp(-pow(d * 0.045, 2.0)) * smoothstep(0.4, 1.5, d) * (0.4 + 0.6 * aSeed);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform float uSoft, uOpacity; varying float vA;
      void main(){
        float r = length(gl_PointCoord - 0.5);
        float a = 1.0 - smoothstep(0.5 * uSoft, 0.5, r);
        gl_FragColor = vec4(vec3(0.75, 0.95, 1.0), a * vA * uOpacity);
      }`
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  scene.add(pts);
  return m;
}
const snowMats = [
  snowLayer(2200, [-28, 28, -35, 3], 3.2, 0.2, 0.75),
  snowLayer(500, [-9, 9, -1, 6], 5, 0.25, 0.6),
  snowLayer(45, [-5, 5, 6, 8.8], 70, 0.0, 0.07)   // out-of-focus bokeh right in front of the lens
];

/* ---------- something big, far away ---------- */
const giant = new THREE.Group();
{
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(0.004, 0.025, 0.035), transparent: true, opacity: 0.5, fog: false, depthWrite: false });
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), mat); body.scale.set(9, 1.5, 1.7);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(1.1, 9, 12), mat); tail.rotation.z = Math.PI / 2; tail.position.x = -12;
  const fin1 = new THREE.Mesh(new THREE.ConeGeometry(0.8, 4.5, 6), mat); fin1.position.set(1.5, -1.3, 1.2); fin1.rotation.set(0.6, 0, 2.4);
  const fin2 = fin1.clone(); fin2.position.z = -1.2; fin2.rotation.x = -0.6;
  giant.add(body, tail, fin1, fin2);
  giant.position.set(-200, 9, -70);
  giant.renderOrder = 0;
  scene.add(giant);
}

/* ---------- post-processing ---------- */
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.6, 0.55, 0.82);
composer.addPass(bloom);
const lens = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime; uniform vec2 uRes; varying vec2 vUv;
    float rnd(vec2 c){ return fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 d = vUv - 0.5; float r2 = dot(d, d);
      float ca = 0.012 * r2;
      vec3 col = vec3(texture2D(tDiffuse, vUv + d*ca).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - d*ca).b);
      col *= vec3(0.86, 1.0, 1.06);
      col *= mix(1.0, 0.3, smoothstep(0.08, 0.5, r2));
      col += (rnd(vUv * uRes + fract(uTime) * 91.7) - 0.5) * 0.03;
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`
});
composer.addPass(lens);
composer.addPass(new OutputPass());

/* ---------- interaction ---------- */
let selected = 'surface', hovered = null, hoverResume = false;
const mobile = matchMedia('(max-width: 780px)'); // same breakpoint as the stacked cards
const resumeLink = document.querySelector('.resume-skip'), pearlPos = new THREE.Vector3();
portal.onChange = (key) => { selected = key; };
const ray = new THREE.Raycaster(), ptr = new THREE.Vector2(9, 9), look = new THREE.Vector2();
let ptrMoved = true, pickTick = 0;
canvas.addEventListener('pointermove', (e) => {
  ptr.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  look.copy(ptr);
  ptrMoved = true;
});
canvas.addEventListener('pointerleave', () => { ptr.set(9, 9); ptrMoved = true; });
canvas.addEventListener('click', () => {
  if (hovered) portal.selectChoice?.(hovered, true);
  else if (hoverResume) portal.openResume?.();
});
function pick() {
  ray.setFromCamera(ptr, camera);
  const hit = ray.intersectObjects(pickables, false)[0];
  const ch = mobile.matches ? null : hit?.object.userData.choice || null;
  const rs = !!hit?.object.userData.resume;
  if (ch !== hovered && ch) portal.selectChoice?.(ch, false);
  hovered = ch; hoverResume = rs;
  canvas.style.cursor = ch || rs ? 'pointer' : '';
}

/* ---------- resize ---------- */
function resize() {
  const w = innerWidth, h = innerHeight, a = w / h;
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  bloom.setSize(w, h);
  lens.uniforms.uRes.value.set(w, h);
  camera.aspect = a;
  camBase.z = a < 1.35 ? Math.min(22, 10 * 1.35 / a) : 10;
  camTarget.y = a < 0.8 ? -2.8 : 0.95; // portrait: lift the sign above the stacked dialogue cards
  camera.updateProjectionMatrix();
  if (!MOTION && canvas.classList.contains('is-ready')) frame(14);
}
addEventListener('resize', resize);
// with reduced motion there is no render loop: redraw so the pearl reacts to keyboard focus
['focus', 'blur'].forEach((ev) => resumeLink.addEventListener(ev, () => { if (!MOTION) frame(14); }));

/* ---------- loop ---------- */
const clock = new THREE.Clock();
const camLook = new THREE.Vector2();
function frame(t) {
  uTime.value = t;
  lens.uniforms.uTime.value = t;

  camLook.lerp(look, 0.04);
  camera.position.set(
    camBase.x + camLook.x * 0.55 + Math.sin(t * 0.31) * 0.14,
    camBase.y + camLook.y * 0.28 + Math.sin(t * 0.47) * 0.09,
    camBase.z
  );
  camera.lookAt(camTarget.x + camLook.x * 0.2, camTarget.y + Math.sin(t * 0.4) * 0.04, camTarget.z);

  rays.forEach((r) => { r.material.uniforms.uOpacity.value = 0.2 + 0.08 * Math.sin(t * 0.3 + r.userData.phase); });
  sign.visible = !mobile.matches;
  sign.userData.halo.material.opacity = 0.85 + Math.sin(t * 2.1) * 0.15;
  sign.userData.orb.material.emissiveIntensity = 4.5 + Math.sin(t * 2.1) * 1;

  // what's under the pointer: when it moves, and every 10th frame for the camera's sway
  if (ptrMoved || ++pickTick % 10 === 0) { pick(); ptrMoved = false; }
  for (const k in planks) {
    const p = planks[k];
    const target = mobile.matches ? 0 : k === hovered ? 1 : k === selected ? 0.75 : 0;
    p.glow += (target - p.glow) * 0.12;
    p.hull.material.opacity = p.glow * 0.85;
    p.hull.visible = p.glow > 0.01; // invisible outlines still cost a draw: skip them
    p.mat.emissive.setRGB(0.005 * p.glow, 0.05 * p.glow, 0.045 * p.glow);
  }
  // keyboard focus on the resume link opens the clam too, with the focus ring drawn on the pearl
  const resumeFocused = document.activeElement === resumeLink;
  if (resumeFocused) {
    pearl.getWorldPosition(pearlPos).project(camera);
    const onScreen = Math.abs(pearlPos.x) < 1 && Math.abs(pearlPos.y) < 1;
    resumeLink.classList.toggle('on-pearl', onScreen);
    resumeLink.style.setProperty('--px', ((pearlPos.x + 1) / 2) * innerWidth + 'px');
    resumeLink.style.setProperty('--py', ((1 - pearlPos.y) / 2) * innerHeight + 'px');
  }
  const resumeLit = hoverResume || resumeFocused;
  topShell.rotation.x += ((resumeLit ? -1.12 : -0.95) - topShell.rotation.x) * 0.08;
  pearl.material.emissiveIntensity += ((resumeLit ? 1.8 : 0.75 + Math.sin(t * 1.6) * 0.12) - pearl.material.emissiveIntensity) * 0.1;
  pearlLight.intensity = 0.4 + pearl.material.emissiveIntensity * 0.6;

  const cycle = (t % 48) / 30;          // drifts past every 48 s, takes 30 s
  giant.position.x = cycle <= 1 ? -110 + cycle * 220 : -300;
  giant.position.y = 9 + Math.sin(t * 0.15) * 1.5;

  composer.render();
}

resize();
sign.visible = !mobile.matches; // set before compiling so phones compile without the sign's lamp light
await renderer.compileAsync(scene, camera); // compile shaders without freezing the page
frame(MOTION ? 6 : 14); // first frame: uploads textures and sets up the effects, while "AMY CUI" holds still
portal.resolveScene();
canvas.classList.add('is-ready');
await portal.revealed;
if (MOTION) renderer.setAnimationLoop(() => { if (!portal.paused) frame(clock.getElapsedTime() + 6); });

