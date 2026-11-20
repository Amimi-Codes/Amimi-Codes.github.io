// The projects page's background: the crossroads' seabed (sky, light rays, caustic sand, rocks,
// arches, marine snow, the big shape far off; this environment code is copied from
// landing-scene.js) with no signpost, clam, bottle or plants, and corals along the edges.
// It runs at half speed, every other frame, at standard resolution: it sits under a dark tint.
import * as THREE from 'three';
import { mergeVertices, mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const canvas = document.getElementById('reef-scene');
const MOTION = !matchMedia('(prefers-reduced-motion: reduce)').matches;
const SPEED = 0.5;

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (e) {
  canvas.remove(); // the still image behind stays as the fallback
  throw e;
}
renderer.setPixelRatio(1);
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
  h *= THREE.MathUtils.smoothstep(d, 1.5, 7) * 0.8 + 0.2;                   // flatter in the middle
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


/* ---------- corals, along the edges of the view ---------- */
// low-poly reef forms: branching staghorn, brain, table, sea fan (sways), finger and mushroom corals
const coralRand = (() => { let s = 4242; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
const coralMats = {};
function coralMat(color) {
  // a little self-glow keeps their colours from washing out to blue in the water
  return (coralMats[color] ||= withCaustics(new THREE.MeshStandardMaterial({ color, roughness: 0.8, flatShading: true, emissive: color, emissiveIntensity: 0.22 }), 0.9));
}
const UP = new THREE.Vector3(0, 1, 0);
// a tapered cylinder from `start` along `dir`
function limb(start, dir, len, r0, r1, segs = 6) {
  const g = new THREE.CylinderGeometry(r1, r0, len, segs, 1);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir));
  g.translate(start.x, start.y, start.z);
  return g;
}
function tilt(dir, maxAngle, inPlane = false) {
  const axis = inPlane ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(coralRand() - 0.5, 0, coralRand() - 0.5).normalize();
  return dir.clone().applyAxisAngle(axis, (coralRand() * 2 - 1) * maxAngle).normalize();
}
function staghorn() {
  const parts = [];
  (function branch(start, dir, len, r, depth) {
    parts.push(limb(start, dir, len, r, r * 0.72));
    const end = start.clone().addScaledVector(dir, len);
    if (depth === 0) { parts.push(new THREE.SphereGeometry(r * 0.75, 6, 4).translate(end.x, end.y, end.z)); return; }
    const n = 2 + (coralRand() > 0.6 ? 1 : 0);
    for (let i = 0; i < n; i++) branch(end, tilt(dir, 0.75), len * (0.68 + coralRand() * 0.2), r * 0.72, depth - 1);
  })(new THREE.Vector3(), UP.clone(), 0.32, 0.075, 4);
  return mergeGeometries(parts);
}
function brain() {
  let g = new THREE.IcosahedronGeometry(0.5, 3);
  g.deleteAttribute('normal'); g.deleteAttribute('uv'); g = mergeVertices(g);
  const p = g.attributes.position, v = new THREE.Vector3(), k = coralRand() * 10;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    const ridge = Math.sin(16 * v.x + 6 * Math.sin(5 * v.z + k)) * Math.sin(14 * v.z + 6 * Math.sin(4 * v.x + k)); // meandering grooves
    v.multiplyScalar(0.5 * (1 + 0.07 * ridge));
    v.y = Math.max(v.y * 0.62, -0.05);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}
function table() {
  const parts = [limb(new THREE.Vector3(), UP, 0.35, 0.07, 0.05)];
  const tiers = 2 + Math.floor(coralRand() * 2);
  for (let t = 0; t < tiers; t++) {
    const r = 0.55 - t * 0.14, y = 0.35 + t * 0.09;
    const disc = new THREE.CylinderGeometry(r, r * 0.92, 0.05, 20, 1);
    const p = disc.attributes.position;
    for (let i = 0; i < p.count; i++) { // a wavy, uneven rim
      const a = Math.atan2(p.getZ(i), p.getX(i)), w = 1 + Math.sin(a * 5 + t) * 0.08 + Math.sin(a * 11) * 0.04;
      p.setX(i, p.getX(i) * w); p.setZ(i, p.getZ(i) * w);
      p.setY(i, p.getY(i) + Math.sin(a * 3 + t) * 0.03);
    }
    disc.computeVertexNormals();
    parts.push(disc.translate(0, y, 0));
  }
  return mergeGeometries(parts);
}
function seaFan() {
  const parts = [];
  (function branch(start, dir, len, r, depth) {
    parts.push(limb(start, dir, len, r, r * 0.8, 4));
    if (depth === 0) return;
    const end = start.clone().addScaledVector(dir, len);
    branch(end, tilt(dir, 0.42, true), len * 0.82, r * 0.8, depth - 1);
    branch(end, tilt(dir, 0.42, true), len * 0.82, r * 0.8, depth - 1);
  })(new THREE.Vector3(), UP.clone(), 0.28, 0.035, 6);
  return mergeGeometries(parts);
}
function finger() {
  const parts = [];
  const n = 7 + Math.floor(coralRand() * 6);
  for (let i = 0; i < n; i++) {
    const a = coralRand() * 6.28, d = coralRand() * 0.25, h = 0.25 + coralRand() * 0.45, r = 0.05 + coralRand() * 0.04;
    const c = new THREE.CapsuleGeometry(r, h, 3, 7);
    c.translate(0, h / 2, 0);
    c.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, tilt(UP, 0.35)));
    parts.push(c.translate(Math.cos(a) * d, 0, Math.sin(a) * d));
  }
  return mergeGeometries(parts);
}
function mushroom() {
  const g = new THREE.SphereGeometry(0.4, 28, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { // radial ridges, flattened dome
    const a = Math.atan2(p.getZ(i), p.getX(i)), ridge = 1 + Math.abs(Math.sin(a * 14)) * 0.06;
    p.setXYZ(i, p.getX(i) * ridge, p.getY(i) * 0.38, p.getZ(i) * ridge);
  }
  g.computeVertexNormals();
  return g;
}
const KINDS = [
  { make: staghorn, colors: ['#ff7a50', '#ff9f43', '#ffcf5c', '#e88ad3'], size: [1.4, 2.3], weight: 3 },
  { make: brain, colors: ['#e8b04a', '#b9d35a', '#e0805a'], size: [1.1, 1.9], weight: 2 },
  { make: table, colors: ['#d77fd0', '#ff9b6a', '#5fd6c2'], size: [1.2, 1.9], weight: 2 },
  { make: seaFan, colors: ['#ff3d7f', '#a855f7', '#ff6b5b'], size: [1.6, 2.6], sways: true, weight: 3 },
  { make: finger, colors: ['#ff9f43', '#ff8fb1', '#f2643d'], size: [1.1, 1.8], weight: 2 },
  { make: mushroom, colors: ['#ffd1e1', '#ffd38a'], size: [0.9, 1.4], weight: 1 },
];
const POOL = KINDS.flatMap((k) => Array(k.weight).fill(k));
const fans = [];
// how wide the view is at depth z (from the camera at z=10, fov 45, 16:9)
const halfWidth = (z) => Math.tan(THREE.MathUtils.degToRad(22.5)) * (10 - z) * 1.78;
for (const side of [-1, 1]) {
  for (let i = 0; i < 30; i++) {
    const z = 5 - Math.pow(coralRand(), 1.6) * 16;                    // crowded in the foreground, thinning out behind
    const edge = 0.42 + Math.pow(coralRand(), 0.6) * 0.6;              // mostly the outer part of the view on each side
    const x = side * halfWidth(z) * edge;
    const kind = POOL[Math.floor(coralRand() * POOL.length)];
    const mesh = new THREE.Mesh(kind.make(), coralMat(kind.colors[Math.floor(coralRand() * kind.colors.length)]));
    const s = kind.size[0] + coralRand() * (kind.size[1] - kind.size[0]);
    mesh.scale.setScalar(s * (z > 2 ? 0.8 : 1));
    mesh.position.set(x, groundHeight(x, z) - 0.04, z);
    mesh.rotation.y = kind.make === seaFan ? side * 0.5 + (coralRand() - 0.5) * 0.6 : coralRand() * 6.28; // fans face the camera
    mesh.castShadow = mesh.receiveShadow = true;
    if (kind.sways) { mesh.userData.phase = coralRand() * 6.28; fans.push(mesh); }
    scene.add(mesh);
  }
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


/* ---------- resize ---------- */
function resize() {
  const w = innerWidth, h = innerHeight, a = w / h;
  renderer.setSize(w, h, false);
  camera.aspect = a;
  // narrow screens: a wider lens instead of backing far off, so the corals stay big at the sides
  camera.fov = a < 1.35 ? Math.min(75, 45 * Math.pow(1.35 / a, 0.55)) : 45;
  camBase.z = a < 1.35 ? Math.min(14, 10 * Math.pow(1.35 / a, 0.35)) : 10;
  camera.updateProjectionMatrix();
  if (!MOTION) frame(14);
}
addEventListener('resize', resize);
const look = new THREE.Vector2();
addEventListener('pointermove', (e) => look.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), { passive: true });

/* ---------- loop ---------- */
const clock = new THREE.Clock();
const camLook = new THREE.Vector2();
function frame(t) {
  uTime.value = t;
  camLook.lerp(look, 0.04);
  camera.position.set(
    camBase.x + camLook.x * 0.55 + Math.sin(t * 0.31) * 0.14,
    camBase.y + camLook.y * 0.28 + Math.sin(t * 0.47) * 0.09,
    camBase.z
  );
  camera.lookAt(camTarget.x + camLook.x * 0.2, camTarget.y + Math.sin(t * 0.4) * 0.04, camTarget.z);
  rays.forEach((r) => { r.material.uniforms.uOpacity.value = 0.2 + 0.08 * Math.sin(t * 0.3 + r.userData.phase); });
  fans.forEach((f) => { f.rotation.z = Math.sin(t * 0.7 + f.userData.phase) * 0.06; }); // sea fans sway in the current
  const cycle = (t % 48) / 30;          // drifts past every 48 s, takes 30 s
  giant.position.x = cycle <= 1 ? -110 + cycle * 220 : -300;
  giant.position.y = 9 + Math.sin(t * 0.15) * 1.5;
  renderer.render(scene, camera);
}

resize();
await renderer.compileAsync(scene, camera);
frame(6);
canvas.classList.add('is-ready');
let odd = false;
if (MOTION) renderer.setAnimationLoop(() => {
  if ((odd = !odd)) return; // every other frame is plenty at half speed under a tint
  frame(clock.getElapsedTime() * SPEED + 6);
});
