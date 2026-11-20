// The contact page's background: Amy's empty bottle and its cork in the sand, with kelp,
// rocks, marine snow and bubbles escaping the bottle's mouth. Drawn behind the page content;
// if WebGL is missing the page's CSS water shows instead.
import * as THREE from 'three';

const canvas = document.getElementById('shore-scene');
const MOTION = !matchMedia('(prefers-reduced-motion: reduce)').matches;

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (e) {
  canvas.remove();
  throw e;
}
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05202a);
scene.fog = new THREE.FogExp2(0x062530, 0.042);
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 120);

// a soft underwater environment for the glass to reflect
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = new THREE.Scene();
  env.background = new THREE.Color(0x062632);
  const plane = (color, y, rx) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(24, 24), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
    m.position.y = y; m.rotation.x = rx; env.add(m);
  };
  plane(0x8be9f5, 10, Math.PI / 2);
  plane(0x1b4649, -8, -Math.PI / 2);
  const ball = (color, x, y, z) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(4, 16, 16), new THREE.MeshBasicMaterial({ color }));
    m.position.set(x, y, z); env.add(m);
  };
  ball(0x186e82, -10, 2, -6);
  ball(0x2aa8b8, 10, 4, 5);
  scene.environment = pmrem.fromScene(env, 0.04).texture;
  scene.environmentIntensity = 0.85;
  pmrem.dispose();
}

/* ---------- textures ---------- */
const seeded = (s) => () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
function sandTextures() {
  const size = 512, rand = seeded(1337);
  const c = document.createElement('canvas'); c.width = c.height = size;
  const b = document.createElement('canvas'); b.width = b.height = size;
  const ci = c.getContext('2d').createImageData(size, size), bi = b.getContext('2d').createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4, nx = (x / size) * Math.PI * 2, ny = (y / size) * Math.PI * 2;
    const ripple = Math.sin(ny * 7 + Math.sin(nx * 2) * 1.1) * 0.5 + Math.sin(ny * 14 + nx * 1.5) * 0.2;
    const h = THREE.MathUtils.clamp(0.5 + ripple * 0.25 + (rand() - 0.5) * 0.35 * 0.25, 0, 1);
    ci.data[i] = 68 + h * 46; ci.data[i + 1] = 86 + h * 52; ci.data[i + 2] = 78 + h * 42; ci.data[i + 3] = 255;
    bi.data[i] = bi.data[i + 1] = bi.data[i + 2] = h * 255; bi.data[i + 3] = 255;
  }
  c.getContext('2d').putImageData(ci, 0, 0);
  b.getContext('2d').putImageData(bi, 0, 0);
  const tex = (cv, srgb) => {
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(9, 9);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  return { map: tex(c, true), bumpMap: tex(b, false) };
}
function corkTexture() {
  const size = 256, r = seeded(4242), c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = '#9c6f44'; g.fillRect(0, 0, size, size);
  for (let i = 0; i < 1600; i++) {
    g.fillStyle = r() > 0.5 ? 'rgba(62, 37, 16, 0.35)' : 'rgba(202, 162, 115, 0.25)';
    g.fillRect(r() * size, r() * size, 1 + r() * 4, 1 + r() * 2.5);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ---------- light & god rays ---------- */
scene.add(new THREE.HemisphereLight(0x6fe3f2, 0x16383d, 1.05));
const sun = new THREE.DirectionalLight(0xb8f5ff, 2.35);
sun.position.set(3.5, 11, 4);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { near: 1, far: 28, left: -7, right: 7, top: 7, bottom: -7 });
sun.shadow.bias = -0.0005;
scene.add(sun);
const rim = new THREE.PointLight(0x4de2f7, 2.5, 12, 1.6); // brings out the glass walls and rim
rim.position.set(-2.2, 1.6, -1.8);
scene.add(rim);

const rayMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0x6be5f5) }, uOpacity: { value: 0.085 } },
  vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
    void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform float uTime; uniform vec3 uColor; uniform float uOpacity; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
    void main(){
      float fade = smoothstep(0.0, 0.35, vUv.y) * smoothstep(1.0, 0.15, vUv.y);
      float edge = pow(abs(dot(vN, vV)), 1.35);
      float shimmer = 0.82 + 0.18 * sin(vUv.x * 18.0 + uTime * 0.7) * cos(vUv.y * 6.0 - uTime * 0.4);
      gl_FragColor = vec4(uColor, fade * edge * shimmer * uOpacity);
    }`
});
const rayCfg = [
  { pos: [-1.1, 4.6, -1.2], rotZ: -0.22, rotX: 0.12, rTop: 0.55, rBot: 2.1, h: 11.5, op: 0.09 },
  { pos: [0.6, 4.9, -0.4], rotZ: -0.18, rotX: 0.08, rTop: 0.7, rBot: 2.6, h: 12.0, op: 0.105 },
  { pos: [2.2, 4.4, -1.6], rotZ: -0.24, rotX: 0.15, rTop: 0.45, rBot: 1.8, h: 11.0, op: 0.075 },
  { pos: [-2.7, 4.2, 0.8], rotZ: -0.15, rotX: -0.05, rTop: 0.4, rBot: 1.6, h: 10.5, op: 0.065 }
];
const rays = rayCfg.map((c) => {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(c.rTop, c.rBot, c.h, 24, 1, true), rayMat.clone());
  m.material.uniforms.uOpacity.value = c.op;
  m.position.set(...c.pos); m.rotation.set(c.rotX, 0, c.rotZ);
  scene.add(m);
  return m;
});

/* ---------- seabed, with a little mound where the bottle settled ---------- */
function seabed(x, z) {
  const dx = x + 0.34, dz = z - 0.1;
  return Math.sin(x * 0.45 + z * 0.25) * 0.14 + Math.cos(x * 0.28 - z * 0.52) * 0.11
    + Math.sin(x * 2.4 + Math.sin(z * 1.8) * 1.4) * 0.025 + Math.exp(-(dx * dx + dz * dz) * 2.3) * 0.13;
}
{
  const geo = new THREE.PlaneGeometry(42, 42, 160, 160);
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, seabed(p.getX(i), p.getZ(i)));
  geo.computeVertexNormals();
  const { map, bumpMap } = sandTextures();
  const sand = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map, bumpMap, bumpScale: 0.045, roughness: 0.92, metalness: 0.02 }));
  sand.receiveShadow = true;
  scene.add(sand);
}

/* ---------- dissolving: pixels burn away along a noise pattern, with a glowing edge ---------- */
const uDissolve = { value: 0 };
function dissolvable(mat) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uDissolve = uDissolve;
    sh.vertexShader = 'varying vec3 vDPos;\n' + sh.vertexShader.replace('#include <project_vertex>',
      '#include <project_vertex>\n vDPos = position * 6.0;');
    sh.fragmentShader = `uniform float uDissolve; varying vec3 vDPos;
      float dHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      float dNoise(vec3 p) {
        vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(dHash(i), dHash(i + vec3(1,0,0)), f.x), mix(dHash(i + vec3(0,1,0)), dHash(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(dHash(i + vec3(0,0,1)), dHash(i + vec3(1,0,1)), f.x), mix(dHash(i + vec3(0,1,1)), dHash(i + vec3(1,1,1)), f.x), f.y), f.z);
      }\n` + sh.fragmentShader.replace('#include <opaque_fragment>', `
      float dn = dNoise(vDPos) * 0.65 + dNoise(vDPos * 2.7) * 0.35;
      if (dn < uDissolve * 1.1 - 0.05) discard;
      outgoingLight += vec3(0.45, 1.0, 0.95) * smoothstep(0.08, 0.0, dn - (uDissolve * 1.1 - 0.05)) * step(0.001, uDissolve) * 2.5;
      #include <opaque_fragment>`);
  };
  return mat;
}

/* ---------- the closed scroll (the message), as designed for the contact page ---------- */
function weatheredPaper(w, h, seed) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#dcc293'; g.fillRect(0, 0, w, h);
  let s = seed; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 90; i++) { // tea stains and lighter worn patches
    const x = r() * w, y = r() * h, rad = 30 + r() * 170;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, r() > 0.35 ? `rgba(140,96,50,${0.12 + r() * 0.2})` : `rgba(240,222,180,${0.12 + r() * 0.15})`);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  for (let i = 0; i < 40; i++) { // foxing: small dark age spots
    g.fillStyle = `rgba(110,70,30,${0.15 + r() * 0.25})`;
    g.beginPath(); g.arc(r() * w, r() * h, 2 + r() * 7, 0, 7); g.fill();
  }
  const edge = g.createLinearGradient(0, 0, 0, h); // darker, aged towards the ends
  edge.addColorStop(0, 'rgba(110,70,32,.45)'); edge.addColorStop(0.12, 'rgba(110,70,32,0)'); edge.addColorStop(0.88, 'rgba(110,70,32,0)'); edge.addColorStop(1, 'rgba(110,70,32,.45)');
  g.fillStyle = edge; g.fillRect(0, 0, w, h);
  const img = g.getImageData(0, 0, w, h); // fibre grain
  for (let i = 0; i < img.data.length; i += 4) { const n = (r() - 0.5) * 18; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n * 0.8; }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function spiralEnd() {
  const N = 256, c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d');
  g.fillStyle = '#cfb281'; g.fillRect(0, 0, N, N);
  g.strokeStyle = 'rgba(80,50,22,.75)'; g.lineWidth = 2;
  g.beginPath();
  for (let a = 0; a < Math.PI * 2 * 6.5; a += 0.02) { const rr = 17 + a * 2.75; const x = N / 2 + Math.cos(a) * rr, y = N / 2 + Math.sin(a) * rr; a ? g.lineTo(x, y) : g.moveTo(x, y); }
  g.stroke();
  const gr = g.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2); gr.addColorStop(0, 'rgba(60,40,20,.65)'); gr.addColorStop(0.14, 'rgba(60,40,20,.2)'); gr.addColorStop(0.15, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(70,50,25,.25)');
  g.fillStyle = gr; g.fillRect(0, 0, N, N);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function closedScroll() {
  const grp = new THREE.Group();
  const paper = dissolvable(new THREE.MeshStandardMaterial({ map: weatheredPaper(512, 512, 3), roughness: 0.92, side: THREE.DoubleSide }));
  const ends = dissolvable(new THREE.MeshStandardMaterial({ map: spiralEnd(), roughness: 0.95 }));
  const cord = dissolvable(new THREE.MeshStandardMaterial({ color: 0x6e5a4e, roughness: 1 }));
  const L = 2.2, pts = [];
  for (let i = 0; i <= 40; i++) { const t = i / 40; pts.push(new THREE.Vector2(0.2 + 0.07 * Math.pow(Math.abs(t - 0.5) * 2, 1.6), (t - 0.5) * L)); }
  grp.add(new THREE.Mesh(new THREE.LatheGeometry(pts, 40), paper));
  for (const end of [-1, 1]) {
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.262, 40), ends);
    face.rotation.x = end * -Math.PI / 2; face.position.y = end * (L / 2 - 0.035); grp.add(face);
    const lip = new THREE.Mesh(new THREE.CylinderGeometry(0.272, 0.27, 0.07, 40, 1, true), paper);
    lip.position.y = end * L / 2; grp.add(lip);
  }
  for (const dy of [-0.025, 0.025]) {
    const loop = new THREE.Mesh(new THREE.TorusGeometry(0.212, 0.016, 8, 40), cord);
    loop.rotation.x = Math.PI / 2; loop.position.y = dy; grp.add(loop);
  }
  grp.scale.setScalar(0.9 / L); // 0.9 units long: contact.html sizes the page's closed scroll to this
  return grp;
}

/* ---------- the empty bottle and its cork ---------- */
const bottle = new THREE.Group();
const mouth = new THREE.Object3D();
const note = new THREE.Group();
{
  // hollow lathe profile: outside wall up to the lip, round the rim, inside wall back down
  const profile = [[0, 0.03], [0.42, 0], [0.49, 0.03], [0.52, 0.11], [0.5, 1.05], [0.47, 1.24], [0.35, 1.38], [0.2, 1.5], [0.17, 1.62], [0.17, 1.95],
    [0.225, 1.99], [0.225, 2.08], [0.18, 2.1], [0.135, 2.09], [0.132, 1.95], [0.135, 1.62], [0.165, 1.48], [0.31, 1.35], [0.43, 1.21],
    [0.455, 1.03], [0.46, 0.14], [0.41, 0.09], [0, 0.1]].map(([x, y]) => new THREE.Vector2(x, y));
  // clear glass by reflection and opacity: the original's transmission glass re-renders the
  // whole scene every frame, which is too heavy for a page background
  const glass = dissolvable(new THREE.MeshPhysicalMaterial({
    color: 0xdff9fc, metalness: 0, roughness: 0.06, transparent: true, opacity: 0.38, clearcoat: 1, clearcoatRoughness: 0.04,
    envMapIntensity: 1.7, side: THREE.DoubleSide, depthWrite: false, emissive: 0x0d4754, emissiveIntensity: 0.15
  }));
  const mesh = new THREE.Mesh(new THREE.LatheGeometry(profile, 64), glass);
  mesh.castShadow = true;
  bottle.add(mesh);
  mouth.position.set(0, 2.06, 0);
  bottle.add(mouth);
  // the rolled message that goes inside when a visitor sends one (hidden until then): the closed
  // scroll from the contact page's design (assets/shore/scroll-closed.webp is a render of this same
  // shape and paper), a waisted tube with spiral ends and a cord, scaled to 0.9 units long
  note.add(closedScroll());
  note.rotation.y = Math.PI; // the paper texture's wrap seam faces away
  note.visible = false;
  bottle.add(note);
  bottle.position.set(-0.34, seabed(-0.34, 0.1) - 0.17, 0.1);
  bottle.rotation.set(0.14, 0.24, -0.7); // base in the sand, open mouth up and to the right
  scene.add(bottle);
}
const cork = new THREE.Mesh(new THREE.CylinderGeometry(0.152, 0.126, 0.35, 32), (() => {
  const t = corkTexture();
  return dissolvable(new THREE.MeshStandardMaterial({ map: t, bumpMap: t, bumpScale: 0.028, roughness: 0.88, metalness: 0.02 }));
})());
cork.castShadow = cork.receiveShadow = true;
cork.position.set(1.08, seabed(1.08, 0.42) + 0.095, 0.42);
cork.rotation.set(Math.PI * 0.48, 0.55, 0.35);
scene.add(cork);

/* ---------- rocks, pebbles, kelp ---------- */
{
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x16343d, roughness: 0.86, metalness: 0.06 });
  [[-2.6, -1.8, [1.1, 0.62, 0.9], [0.2, 0.7, 0.1]], [2.5, -1.4, [1.35, 0.72, 1.05], [-0.1, 1.3, 0.2]], [1.4, -3.2, [0.75, 0.45, 0.68], [0.3, 2.1, -0.1]],
    [-1.7, 2.1, [0.65, 0.34, 0.58], [0, 0.4, 0.15]], [3.8, 1.2, [1.5, 0.85, 1.2], [-0.2, 2.7, 0.1]], [-4.2, -0.6, [1.65, 0.9, 1.3], [0.15, 0.9, -0.15]]]
    .forEach(([x, z, s, r]) => {
      const geo = new THREE.IcosahedronGeometry(0.85, 2), p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i);
        const n = 0.82 + 0.24 * Math.sin(vx * 3.1 + vy * 2.4) * Math.cos(vz * 2.9);
        p.setXYZ(i, vx * n, vy * n * 0.78, vz * n);
      }
      geo.computeVertexNormals();
      const rock = new THREE.Mesh(geo, rockMat);
      rock.position.set(x, seabed(x, z) + s[1] * 0.22, z);
      rock.scale.set(...s); rock.rotation.set(...r);
      rock.castShadow = rock.receiveShadow = true;
      scene.add(rock);
    });
  const N = 65, rand = seeded(7711), d = new THREE.Object3D();
  const pebbles = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.08, 1), new THREE.MeshStandardMaterial({ color: 0x20424a, roughness: 0.82, metalness: 0.05 }), N);
  for (let i = 0; i < N; i++) {
    const a = rand() * Math.PI * 2, r = 0.65 + rand() * 4.8, x = Math.cos(a) * r, z = Math.sin(a) * r;
    const sx = 0.55 + rand() * 1.15, sy = 0.35 + rand() * 0.55, sz = 0.55 + rand() * 1.15;
    d.position.set(x, seabed(x, z) + 0.015 * sy, z);
    d.rotation.set(rand() * 0.4, rand() * Math.PI * 2, rand() * 0.4);
    d.scale.set(sx, sy, sz); d.updateMatrix();
    pebbles.setMatrixAt(i, d.matrix);
  }
  pebbles.castShadow = pebbles.receiveShadow = true;
  scene.add(pebbles);
}
const kelpMat = new THREE.MeshStandardMaterial({ color: 0x154b4a, roughness: 0.65, metalness: 0.04, side: THREE.DoubleSide });
const kelp = [[-1.55, -0.55, 1.35, 0.14, 0.2], [-1.35, -0.75, 0.95, 0.11, 1.1], [-1.75, -0.35, 1.65, 0.15, 2.0], [1.45, -0.65, 1.45, 0.13, 0.7],
  [1.68, -0.45, 1.1, 0.12, 1.8], [-2.9, 1.3, 1.85, 0.16, 2.5], [2.8, 0.9, 1.75, 0.15, 3.3], [0.95, 1.65, 0.75, 0.1, 4.1],
  [-3.6, -2.3, 2.1, 0.17, 1.4], [3.4, -2.5, 1.95, 0.16, 2.8]].map(([x, z, height, width, phase]) => {
  const geo = new THREE.PlaneGeometry(width, height, 2, 10);
  geo.translate(0, height / 2, 0);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) * (1 - (p.getY(i) / height) * 0.72));
  const base = Float32Array.from(p.array);
  const mesh = new THREE.Mesh(geo, kelpMat);
  mesh.position.set(x, seabed(x, z) - 0.04, z);
  mesh.rotation.y = phase * 1.7;
  mesh.castShadow = true;
  scene.add(mesh);
  return { mesh, base, height, phase, amp: 0.08 + (phase % 0.07) };
});

/* ---------- marine snow and bubbles from the bottle's mouth ---------- */
const SNOW = 420;
const snowGeo = new THREE.BufferGeometry();
const snowPos = new Float32Array(SNOW * 3), snowSeed = new Float32Array(SNOW);
for (let i = 0; i < SNOW; i++) {
  snowPos[i * 3] = (Math.random() - 0.5) * 16; snowPos[i * 3 + 1] = Math.random() * 8.5 - 0.4; snowPos[i * 3 + 2] = (Math.random() - 0.5) * 16;
  snowSeed[i] = Math.random() * Math.PI * 2;
}
snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPos, 3));
scene.add(new THREE.Points(snowGeo, new THREE.PointsMaterial({ color: 0xbaf4fc, size: 0.042, transparent: true, opacity: 0.65, blending: THREE.AdditiveBlending, depthWrite: false })));

const BUBBLES = 46, FROM_MOUTH = 26;
const bubbles = new THREE.InstancedMesh(new THREE.SphereGeometry(0.024, 12, 12),
  new THREE.MeshStandardMaterial({ color: 0xd8fbff, roughness: 0.05, transparent: true, opacity: 0.6, envMapIntensity: 1.5 }), BUBBLES);
scene.add(bubbles);
scene.updateMatrixWorld(true);
const mouthAt = mouth.getWorldPosition(new THREE.Vector3());
const bubbleData = Array.from({ length: BUBBLES }, (_, i) => i < FROM_MOUTH
  ? { fromMouth: true, x: mouthAt.x + (Math.random() - 0.5) * 0.08, y: mouthAt.y + Math.random() * 4.5, z: mouthAt.z + (Math.random() - 0.5) * 0.08,
      speed: 0.34 + Math.random() * 0.32, scale: 0.45 + Math.random() * 0.95, phase: i * 0.85, drift: 0.05 + Math.random() * 0.08 }
  : { fromMouth: false, x: (Math.random() - 0.5) * 5.2 - 0.2, y: Math.random() * 5.5, z: (Math.random() - 0.5) * 4.4,
      speed: 0.22 + Math.random() * 0.32, scale: 0.55 + Math.random() * 1.1, phase: i * 0.7 });
const bd = new THREE.Object3D();

// resting poses in the sand, to return to
const restBottle = { pos: bottle.position.clone(), quat: bottle.quaternion.clone() };
const restCork = { pos: cork.position.clone(), quat: cork.quaternion.clone() };

/* ---------- framing ---------- */
// The bottle sits in the gap between the intro and the scroll (centre of the screen on phones);
// the camera drifts a little with the mouse.
const camBase = new THREE.Vector3(), look = new THREE.Vector3(), mouse = new THREE.Vector2(), mouseEased = new THREE.Vector2();
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
let viewW = 1, viewH = 1;
function resize() {
  const w = innerWidth, h = innerHeight, portrait = w / h < 0.9;
  viewW = w; viewH = h;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = portrait ? 50 : 40;
  camBase.set(0.3, portrait ? 3.4 : 3.1, portrait ? 11 : 9.5);
  look.set(0.3, portrait ? 3.0 : 2.5, 0);
  camera.clearViewOffset();
  camera.updateProjectionMatrix();
  // shift the view so the bottle lands in the gap between the two columns
  const intro = document.querySelector('.shore-intro'), spot = document.querySelector('.scroll-spot');
  if (intro && spot && w > 980) {
    camera.position.copy(camBase); camera.lookAt(look); camera.updateMatrixWorld();
    const gapX = (intro.getBoundingClientRect().right + spot.getBoundingClientRect().left) / 2;
    bottle.localToWorld(tmp.set(0, 1, 0)).project(camera);
    camera.setViewOffset(w, h, ((tmp.x + 1) / 2) * w - gapX, 0, w, h);
  }
  if (!MOTION) frame(0, 0);
}
addEventListener('resize', resize);
addEventListener('pointermove', (e) => mouse.set(e.clientX / innerWidth - 0.5, e.clientY / innerHeight - 0.5), { passive: true });

/* ---------- tweens for the message sequence ---------- */
const tweens = [];
const ease = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
const tween = (ms, fn, curve = ease) => new Promise((done) => tweens.push({ t0: performance.now(), ms, fn, curve, done }));
function runTweens(now) {
  for (let i = tweens.length - 1; i >= 0; i--) {
    const tw = tweens[i], p = Math.min(1, (now - tw.t0) / tw.ms);
    tw.fn(tw.curve(p), p);
    if (p === 1) { tweens.splice(i, 1); tw.done(); }
  }
}
let busy = false; // the bottle is in the message sequence: no idle rocking, no bubbles from its mouth

// a point on screen, at a given distance in front of the camera, in world space
function screenToWorld(x, y, dist, out) {
  out.set((x / viewW) * 2 - 1, -(y / viewH) * 2 + 1, 0.5).unproject(camera).sub(camera.position).normalize();
  return out.multiplyScalar(dist).add(camera.position);
}
function toScreen(v) {
  const p = tmp2.copy(v).project(camera);
  return { x: ((p.x + 1) / 2) * viewW, y: ((1 - p.y) / 2) * viewH };
}
function moveObject(obj, toPos, toQuat, ms, lift = 0) {
  const fromPos = obj.position.clone(), fromQuat = obj.quaternion.clone(), mid = new THREE.Vector3();
  return tween(ms, (k) => {
    mid.lerpVectors(fromPos, toPos, k);
    mid.y += Math.sin(k * Math.PI) * lift; // an arc, not a straight line
    obj.position.copy(mid);
    obj.quaternion.slerpQuaternions(fromQuat, toQuat, k);
  });
}
const upright = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.05, 0.5, -0.12));

// what contact.html calls, step by step
window.__shore = {
  // the bottle leaves the sand and stands upright where the scroll was (screen point = its middle)
  async bottleTo(x, y) {
    busy = true;
    const dist = camera.position.distanceTo(bottle.position) * 0.72;
    const target = screenToWorld(x, y, dist, new THREE.Vector3());
    target.sub(tmp.set(0, 1.05, 0).applyQuaternion(upright)); // the bottle's middle on that point
    await moveObject(bottle, target, upright, 1100, 0.6);
  },
  // pixels per world unit where the bottle will stand (so the page can size the closed scroll first)
  unitAt() {
    const dist = camera.position.distanceTo(bottle.position) * 0.72;
    return viewH / (2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  },
  // where the mouth is on screen, the bottle's tilt there, the neck's width and pixels per unit there
  mouth() {
    const m = toScreen(mouth.getWorldPosition(tmp));
    const b = toScreen(bottle.localToWorld(tmp.set(0, 1.0, 0)));
    const l = toScreen(bottle.localToWorld(tmp.set(-0.17, 1.8, 0))), r = toScreen(bottle.localToWorld(tmp.set(0.17, 1.8, 0)));
    return { x: m.x, y: m.y, angle: Math.atan2(m.x - b.x, b.y - m.y), neck: Math.hypot(l.x - r.x, l.y - r.y), unit: Math.hypot(m.x - b.x, m.y - b.y) / 1.06 };
  },
  // the rolled message slides down the neck into the bottle
  async insertNote(ms = 900) {
    note.visible = true;
    note.scale.setScalar(1);
    await tween(ms, (k) => note.position.set(0, 2.5 - 1.88 * k, 0)); // from just above the mouth (as the page's scroll) down inside
  },
  // the cork leaves the sand and seals the mouth
  async cork() {
    const to = bottle.localToWorld(new THREE.Vector3(0, 2.14, 0));
    await moveObject(cork, to, bottle.quaternion.clone(), 800, 0.8);
    bottle.attach(cork);
    await tween(160, (k) => cork.position.set(0, 2.14 - 0.06 * k, 0)); // pressed in
  },
  // the sealed bottle dissolves into the water
  async dissolve() {
    await tween(1300, (k) => (uDissolve.value = k), (p) => p);
    bottle.visible = false;
  },
  // an empty bottle drifts down from the top of the screen and settles in the sand, its cork beside it
  async driftBack() {
    scene.attach(cork);
    note.visible = false;
    const dist = camera.position.distanceTo(restBottle.pos);
    const top = screenToWorld(viewW * 0.5, -viewH * 0.2, dist, new THREE.Vector3());
    bottle.position.set(restBottle.pos.x, top.y, restBottle.pos.z);
    bottle.quaternion.setFromEuler(new THREE.Euler(0.3, 0.4, -1.4));
    cork.position.set(restCork.pos.x + 0.4, top.y + 1.2, restCork.pos.z);
    uDissolve.value = 0;
    bottle.visible = true;
    const sway = (obj, rest, ms, amp) => {
      const from = obj.position.clone(), fromQ = obj.quaternion.clone();
      return tween(ms, (k, p) => {
        obj.position.lerpVectors(from, rest.pos, k);
        obj.position.x += Math.sin(p * Math.PI * 3) * amp * (1 - p); // side to side as it sinks
        obj.quaternion.slerpQuaternions(fromQ, rest.quat, k);
      }, (p) => 1 - Math.pow(1 - p, 2.2));
    };
    await Promise.all([sway(bottle, restBottle, 2600, 0.5), sway(cork, restCork, 2900, 0.35)]);
    busy = false;
  },
  // sending failed: unseal and put everything back
  async abort() {
    scene.attach(cork);
    note.visible = false;
    await Promise.all([moveObject(bottle, restBottle.pos, restBottle.quat, 1000, 0.5), moveObject(cork, restCork.pos, restCork.quat, 1000, 0.4)]);
    busy = false;
  }
};

// arriving from the crossroads' bottle: the camera starts at the bottle and pulls back
const arriveStart = document.documentElement.classList.contains('arrive-shore') && MOTION ? performance.now() : 0;

/* ---------- loop ---------- */
const clock = new THREE.Clock();
function frame(t, dt) {
  runTweens(performance.now());
  mouseEased.lerp(mouse, Math.min(1, dt * 2.5));
  camera.position.set(camBase.x + mouseEased.x * 0.6, camBase.y - mouseEased.y * 0.25, camBase.z);
  tmp.copy(look);
  if (arriveStart) {
    const k = 1 - ease(Math.min(1, (performance.now() - arriveStart) / 1600));
    if (k > 0) {
      bottle.localToWorld(tmp2.set(0, 1.1, 0));
      camera.position.lerp(tmp2.clone().add(new THREE.Vector3(0.4, 0.5, 1.6)), k);
      tmp.lerp(tmp2, k);
    }
  }
  camera.lookAt(tmp);

  rays.forEach((r, i) => { r.material.uniforms.uTime.value = t + i * 1.3; r.rotation.z = rayCfg[i].rotZ + Math.sin(t * 0.25 + i) * 0.025; });
  if (!busy) { // gentle settling in the current
    bottle.rotation.z = -0.7 + Math.sin(t * 0.85) * 0.013;
    bottle.rotation.x = 0.14 + Math.cos(t * 0.65) * 0.008;
    cork.rotation.z = 0.35 + Math.sin(t * 1.1 + 0.8) * 0.018;
  }
  mouth.getWorldPosition(mouthAt);

  kelp.forEach((k) => {
    const p = k.mesh.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const bx = k.base[i * 3], by = k.base[i * 3 + 1], bz = k.base[i * 3 + 2], hf = Math.pow(Math.max(0, by / k.height), 1.5); // base rounding can dip below 0: pow would give NaN
      p.setXYZ(i, bx + Math.sin(t * 1.15 + k.phase + by * 1.4) * k.amp * hf * 3.2, by, bz + Math.cos(t * 0.9 + k.phase * 1.3 + by * 1.1) * k.amp * hf * 2.2);
    }
    p.needsUpdate = true;
  });

  // movement per second (the original moved a fixed step per frame, so it ran twice as fast at 120Hz)
  const sp = snowGeo.attributes.position;
  for (let i = 0; i < SNOW; i++) {
    let y = sp.getY(i) - 0.27 * dt;
    let x = sp.getX(i) + Math.sin(t * 0.5 + snowSeed[i]) * 0.13 * dt;
    let z = sp.getZ(i) + Math.cos(t * 0.4 + snowSeed[i]) * 0.13 * dt;
    if (y < -0.3) { y = 8.2; x = (Math.random() - 0.5) * 16; z = (Math.random() - 0.5) * 16; }
    sp.setXYZ(i, x, y, z);
  }
  sp.needsUpdate = true;

  for (let i = 0; i < BUBBLES; i++) {
    const b = bubbleData[i];
    if (b.fromMouth) {
      // a corked or travelling bottle lets out no bubbles; afterwards they start again, staggered
      if (b.y > 50) {
        if (busy || Math.random() > dt * 1.2) { bd.scale.setScalar(0); bd.updateMatrix(); bubbles.setMatrixAt(i, bd.matrix); continue; }
        b.y = mouthAt.y - 0.03; b.x = mouthAt.x + (Math.random() - 0.5) * 0.06; b.z = mouthAt.z + (Math.random() - 0.5) * 0.06;
      }
      b.y += b.speed * dt;
      b.x += b.drift * 0.27 * dt;
      if (b.y > 5.8) {
        if (busy) b.y = 99;
        else { b.y = mouthAt.y - 0.03; b.x = mouthAt.x + (Math.random() - 0.5) * 0.06; b.z = mouthAt.z + (Math.random() - 0.5) * 0.06; }
      }
      const age = Math.max(0, b.y - mouthAt.y), spread = Math.min(0.24, age * 0.065);
      bd.position.set(b.x + Math.sin(t * 2.6 + b.phase) * spread, b.y, b.z + Math.cos(t * 2.2 + b.phase) * spread);
      bd.scale.setScalar(b.y > 50 ? 0 : b.scale * (1 + age * 0.06));
    } else {
      b.y += b.speed * dt;
      if (b.y > 6.5) b.y = seabed(b.x, b.z) + 0.08;
      bd.position.set(b.x + Math.sin(t * 2.1 + b.phase) * 0.08, b.y, b.z + Math.cos(t * 1.8 + b.phase) * 0.08);
      bd.scale.setScalar(b.scale);
    }
    bd.updateMatrix();
    bubbles.setMatrixAt(i, bd.matrix);
  }
  bubbles.instanceMatrix.needsUpdate = true;

  renderer.render(scene, camera);
}

resize();
canvas.classList.add('is-ready');
if (MOTION) renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  frame(clock.elapsedTime, dt);
});
else frame(0, 0);
