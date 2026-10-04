/*
 * stage3d.js — 3D 레이어. three.js(lib/three, r186) 장면을 그려서 stage의 2D 캔버스에 합성한다.
 *
 * 필름 index.html (3D를 쓸 때만):
 *   <script src="../../lib/motion.js"></script>
 *   <script src="../../lib/stage.js"></script>
 *   <script type="importmap">
 *   { "imports": { "three": "../../lib/three/three.module.js", "three/addons/": "../../lib/three/addons/" } }
 *   </script>
 *   <script type="module">
 *   import { THREE, world, phone, screen, text3d, fonts3d, material, set, deg } from '../../lib/stage3d.js';
 *   await fonts3d();                              // 입체 글자를 쓰면 (Geist·Pretendard 700)
 *   const can = await model('refs/can.glb');      // GLB 모델을 쓰면 (여기서 한 번만 불러온다)
 *   Stage.film((film) => {
 *     const W = world({ light: 'studio' });       // 장면·카메라·조명은 반드시 이 함수 안에서 만든다
 *     const ui = screen();                        // 기기 화면 = 2D 캔버스 (기존 2D 코드를 그대로 쓴다)
 *     const p = phone({ screen: ui });  W.add(p);
 *     return { draw(g, t, S) {
 *       if (!S.transparent) { g.fillStyle = film.P.bg; g.fillRect(0, 0, S.W, S.H); }
 *       ui.draw((sg, w, h) => { ... t로 화면 UI를 그린다 ... });
 *       set(p, { rot: [0, track(t, ...), 0] });   // 모든 위치·회전은 매 프레임 t로 다시 정한다
 *       W.fit(S, { width: 4, height: 3.6 });      // 이 크기가 포맷에 상관없이 화면에 들어오게
 *       W.render(g, S);
 *     } };
 *   });
 *   </script>
 *
 * 규칙
 *   - 매 프레임 모든 위치·회전·스케일·카메라를 t로부터 다시 정한다. 이전 프레임 값에 더하지 않는다.
 *   - world(), 재질, 기기, 글자는 Stage.film 함수 안에서 만든다. film.json이 바뀌면 이전 것은 자동으로 정리된다.
 *     폰트·모델처럼 오래 걸리는 것만 밖에서 await 한다.
 *   - 단위: 폰 높이 ≈ 3. 바닥(그림자 받이)은 y = ground (기본 -1.6).
 *   - 2D 캔버스(GPU 없이 그림)와 달리 3D는 GPU로 그린다. 같은 맥에서는 매번 같은 픽셀이다.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { TTFLoader } from 'three/addons/loaders/TTFLoader.js';
import { Font } from 'three/addons/loaders/FontLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

export { THREE };
export const deg = (d) => d * Math.PI / 180;

/* ── 렌더러: 페이지에 하나. 다시 만들면 환경맵 같은 GPU 자원이 함께 사라진다 ─────────── */
let renderer = null;
function getRenderer() {
  if (renderer) return renderer;
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;   // r18x: PCF가 radius로 부드러워진다 (PCFSoft는 없어짐)
  renderer.setClearColor(0x000000, 0);
  return renderer;
}

let envMap = null;
function studioEnvironment() {
  if (!envMap) envMap = new THREE.PMREMGenerator(getRenderer()).fromScene(new RoomEnvironment(), 0.04).texture;
  return envMap;
}

/* ── 조명 프리셋 ─────────────────────────────────────────────────────────────
 * studio  : 고른 반사 + 위에서 오는 키 라이트, 부드러운 그림자 (기본)
 * soft    : 그림자를 더 넓고 옅게 — 밝은 프로덕트 컷
 * dramatic: 어두운 환경 + 옆 키 라이트 + 뒤 림 라이트 — 로고, 타이포 클로즈업
 */
const LIGHTS = {
  studio:   { env: 1.0, key: [[3, 6, 5], 2.0, 6], rim: null, shadow: 0.16 },
  soft:     { env: 1.15, key: [[2, 7, 4], 0.9, 14], rim: null, shadow: 0.1 },
  dramatic: { env: 0.3, key: [[-4, 5, 3], 3.2, 3], rim: [[1, 3, -6], 2.6], shadow: 0.32 },
};

const worlds = [];
// film.json이 바뀌어 Stage.film 함수가 다시 불리기 직전: 이전 장면의 GPU 자원을 정리한다.
if (window.Stage) Stage.hooks.beforeApply.push(() => { for (const w of worlds.splice(0)) w.dispose(); });

export function world({ light = 'studio', shadow = true, ground = -1.6, shadowArea = 6, fov = 30 } = {}) {
  const L = LIGHTS[light];
  if (!L) throw new Error(`[stage3d] light: ${Object.keys(LIGHTS).join(' | ')}`);
  const scene = new THREE.Scene();
  scene.environment = studioEnvironment();
  scene.environmentIntensity = L.env;
  const camera = new THREE.PerspectiveCamera(fov, 1, 0.05, 200);

  const key = new THREE.DirectionalLight(0xffffff, L.key[1]);
  key.position.set(...L.key[0]);
  if (shadow) {
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.radius = L.key[2];
    key.shadow.bias = -0.0004;
    Object.assign(key.shadow.camera, { left: -shadowArea, right: shadowArea, top: shadowArea, bottom: -shadowArea, near: 0.5, far: 40 });
  }
  scene.add(key);
  if (L.rim) {
    const rim = new THREE.DirectionalLight(0xffffff, L.rim[1]);
    rim.position.set(...L.rim[0]);
    scene.add(rim);
  }
  let floor = null;
  if (shadow && ground !== null) {
    floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.ShadowMaterial({ opacity: L.shadow }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = ground;
    floor.receiveShadow = true;
    scene.add(floor);
  }

  const w = {
    scene, camera, key, floor,
    add(...objs) { scene.add(...objs); return w; },
    /** 카메라를 from에 두고 at을 본다. */
    look(from, at = [0, 0, 0], nextFov) {
      if (nextFov) camera.fov = nextFov;
      camera.position.set(...from);
      camera.lookAt(...at);
      camera.updateProjectionMatrix();
      return w;
    },
    /**
     * width × height(월드 단위) 영역이 포맷에 상관없이 화면에 다 들어오도록 카메라 거리를 정한다.
     * dir: at에서 카메라 쪽 방향. margin: 1이면 꽉 차게.
     */
    fit(S, { width, height, at = [0, 0, 0], dir = [0, 0.12, 1], margin = 1.08, fov: f } = {}) {
      if (f) camera.fov = f;
      const aspect = S.W / S.H, half = Math.tan(deg(camera.fov) / 2);
      const dist = Math.max(height / 2 / half, width / 2 / (half * aspect)) * margin;
      const d = new THREE.Vector3(...dir).normalize().multiplyScalar(dist);
      camera.position.set(at[0] + d.x, at[1] + d.y, at[2] + d.z);
      camera.lookAt(...at);
      return dist;
    },
    /** 장면을 그려서 2D 캔버스 g에 얹는다. 배경은 그 전에 2D로 칠한다. */
    render(g, S) {
      const r = getRenderer(), c = r.domElement;
      if (c.width !== S.W || c.height !== S.H) r.setSize(S.W, S.H, false);
      camera.aspect = S.W / S.H;
      camera.updateProjectionMatrix();
      r.render(scene, camera);
      g.drawImage(c, 0, 0, S.W, S.H);
    },
    dispose() { disposeTree(scene); },
  };
  worlds.push(w);
  return w;
}

function disposeTree(o) {
  if (o.userData.stage3dKeep) return;   // model(): 한 번 불러와서 계속 쓴다
  o.geometry?.dispose();
  for (const m of [].concat(o.material || [])) {
    for (const v of Object.values(m)) if (v && v.isTexture && v !== envMap) v.dispose();
    m.dispose();
  }
  for (const c of o.children) disposeTree(c);
}

/** 위치·회전(라디안)·스케일을 한 번에 정한다. 매 프레임 t로 계산한 값을 넣는다. */
export function set(obj, { pos, rot, scale } = {}) {
  if (pos) obj.position.set(...pos);
  if (rot) obj.rotation.set(...rot);
  if (scale !== undefined) typeof scale === 'number' ? obj.scale.setScalar(scale) : obj.scale.set(...scale);
  return obj;
}

/* ── 재질 ─────────────────────────────────────────────────────────────────────
 * plastic(기본) · matte · clay · metal · chrome · glass · pearl
 */
const MATERIALS = {
  plastic: { roughness: 0.35, clearcoat: 0.5, clearcoatRoughness: 0.2 },
  matte:   { roughness: 0.85 },
  clay:    { roughness: 1, metalness: 0 },
  metal:   { metalness: 1, roughness: 0.3 },
  chrome:  { metalness: 1, roughness: 0.06 },
  glass:   { transmission: 1, roughness: 0.04, thickness: 0.6, ior: 1.5 },
  pearl:   { roughness: 0.2, iridescence: 1, iridescenceIOR: 1.6, clearcoat: 1 },
};
export function material(kind = 'plastic', color = '#ffffff', opts = {}) {
  const base = MATERIALS[kind];
  if (!base) throw new Error(`[stage3d] material: ${Object.keys(MATERIALS).join(' | ')}`);
  return new THREE.MeshPhysicalMaterial({ color, ...base, ...opts });
}

/* ── 둥근 사각형 판 (UV 0~1) ─────────────────────────────────────────────────── */
function roundedShape(w, h, r) {
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.absarc(x + w - r, y + r, r, -Math.PI / 2, 0);
  s.lineTo(x + w, y + h - r); s.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2);
  s.lineTo(x + r, y + h); s.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
  s.lineTo(x, y + r); s.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5);
  return s;
}
function roundedPlane(w, h, r) {
  const geo = new THREE.ShapeGeometry(roundedShape(w, h, r), 12);
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / w + 0.5, pos.getY(i) / h + 0.5);
  return geo;
}
/** 둥근 판을 두께 depth로 압출 (모서리도 둥글게). 앞면이 +z, 가운데 정렬. */
function roundedSlab(w, h, depth, r, edge = Math.min(0.03, depth / 3)) {
  const geo = new THREE.ExtrudeGeometry(roundedShape(w - edge * 2, h - edge * 2, Math.max(0.001, r - edge)), {
    depth: depth - edge * 2, bevelEnabled: true, bevelThickness: edge, bevelSize: edge, bevelSegments: 5, curveSegments: 16,
  });
  geo.center();
  return geo;
}

/* ── 기기 화면: 2D 캔버스 텍스처 ───────────────────────────────────────────────── */
export function screen({ width = 780, height = 1688 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const g = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return {
    canvas, g, texture, width, height,
    /** fn(g, w, h)로 화면을 다시 그린다. 매 프레임 t로 그린다. */
    draw(fn) {
      g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, width, height);
      fn(g, width, height);
      g.restore();
      texture.needsUpdate = true;
    },
  };
}

const DEVICE_COLORS = { graphite: '#2a2a2d', silver: '#d8d8da', white: '#f2f1ee', black: '#111113' };
const deviceMaterial = (color) => material('metal', DEVICE_COLORS[color] || color, { roughness: 0.32, clearcoat: 0.6, clearcoatRoughness: 0.18, metalness: 0.65 });
const screenMaterial = (s) => new THREE.MeshBasicMaterial({ map: s.texture, toneMapped: false });

/**
 * 폰 목업. 높이 3.04, 가운데가 원점. 화면 텍스처 비율 = 780:1688 (screen() 기본값).
 * 돌려주는 그룹: .body, .display
 */
export function phone({ screen: s, color = 'graphite' } = {}) {
  const W = 1.48, H = 3.04, D = 0.15, R = 0.24, bezel = 0.055;
  const group = new THREE.Group();
  const body = new THREE.Mesh(roundedSlab(W, H, D, R), deviceMaterial(color));
  body.castShadow = true;
  const display = new THREE.Mesh(roundedPlane(W - bezel * 2, H - bezel * 2, R - bezel),
    s ? screenMaterial(s) : new THREE.MeshBasicMaterial({ color: 0x050505 }));
  display.position.z = D / 2 + 0.002;
  const island = new THREE.Mesh(roundedPlane(0.36, 0.105, 0.0525), new THREE.MeshBasicMaterial({ color: 0x050505 }));
  island.position.set(0, H / 2 - bezel - 0.11, D / 2 + 0.004);
  group.add(body, display, island);
  Object.assign(group, { body, display });
  return group;
}

/**
 * 노트북 목업. 바닥 판 3.0 × 2.0, 경첩이 원점 뒤쪽. 화면 텍스처 비율 = 1440:900 (16:10).
 * laptop.open(p): 0 닫힘 → 1 열림(105°). 매 프레임 t로 부른다.
 */
export function laptop({ screen: s, color = 'silver' } = {}) {
  const BW = 3.0, BD = 2.0, BT = 0.08, LH = 1.96, LT = 0.04;
  const group = new THREE.Group();
  const shell = deviceMaterial(color);
  const base = new THREE.Mesh(roundedSlab(BW, BD, BT, 0.12, 0.02), shell);
  base.rotation.x = -Math.PI / 2;
  base.castShadow = true;
  const deck = new THREE.Mesh(roundedPlane(2.6, 0.95, 0.04), material('matte', '#1c1c1e'));
  deck.rotation.x = -Math.PI / 2; deck.position.set(0, BT / 2 + 0.001, -0.3);
  const pad = new THREE.Mesh(roundedPlane(1.05, 0.62, 0.05), material('matte', DEVICE_COLORS[color] || color, { roughness: 0.55 }));
  pad.rotation.x = -Math.PI / 2; pad.position.set(0, BT / 2 + 0.001, 0.52);

  const lid = new THREE.Group();
  lid.position.set(0, BT / 2, -BD / 2 + 0.02);
  const lidBody = new THREE.Mesh(roundedSlab(BW, LH, LT, 0.12, 0.015), shell);
  lidBody.position.set(0, LH / 2, 0);
  lidBody.castShadow = true;
  const sw = 2.8, sh = sw / 1.6;
  const bezel = new THREE.Mesh(roundedPlane(BW - 0.06, LH - 0.06, 0.1), new THREE.MeshBasicMaterial({ color: 0x050505 }));
  bezel.position.set(0, LH / 2, LT / 2 + 0.001);
  const display = new THREE.Mesh(roundedPlane(sw, sh, 0.02), s ? screenMaterial(s) : new THREE.MeshBasicMaterial({ color: 0x050505 }));
  display.position.set(0, LH / 2 + 0.02, LT / 2 + 0.003);
  lid.add(lidBody, bezel, display);

  group.add(base, deck, pad, lid);
  group.position.y = BT / 2;
  Object.assign(group, {
    base, lid, display,
    open(p) { lid.rotation.x = THREE.MathUtils.lerp(Math.PI / 2, deg(-15), p); return group; },
  });
  group.open(1);
  return group;
}

/* ── 입체 글자 ───────────────────────────────────────────────────────────────── */
const fontFiles = { 'Geist 600': 'Geist-SemiBold', 'Geist 700': 'Geist-Bold', 'Pretendard 600': 'Pretendard-SemiBold', 'Pretendard 700': 'Pretendard-Bold' };
const fonts = {};
/** 입체 글자용 폰트를 불러온다. 기본: Geist 700 + Pretendard 700. 예) await fonts3d('Pretendard 600') */
export async function fonts3d(...specs) {
  if (!specs.length) specs = ['Geist 700', 'Pretendard 700'];
  await Promise.all(specs.map(async (spec) => {
    if (fonts[spec]) return;
    if (!fontFiles[spec]) throw new Error(`[stage3d] fonts3d: ${Object.keys(fontFiles).join(' | ')}`);
    const url = new URL(`../assets/fonts/ttf/${fontFiles[spec]}.ttf`, import.meta.url);
    const buf = await fetch(url).then((r) => { if (!r.ok) throw new Error(`[stage3d] ${url} (${r.status})`); return r.arrayBuffer(); });
    fonts[spec] = new Font(new TTFLoader().parse(buf));
  }));
}

/**
 * 압출한 글자 메시. 한글이 있으면 Pretendard, 없으면 Geist (font로 지정 가능).
 * size = 대문자 높이 정도(월드 단위). align: 'center' | 'left' | 'right' — 기준선 가운데가 원점.
 */
export function text3d(str, { size = 0.6, depth = size * 0.35, weight = 700, font, align = 'center', bevel = true, mat } = {}) {
  const family = font || (/[^\u0000-ɏ]/.test(str) ? 'Pretendard' : 'Geist');
  const f = fonts[`${family} ${weight}`];
  if (!f) throw new Error(`[stage3d] text3d: 먼저 await fonts3d('${family} ${weight}')`);
  const geo = new TextGeometry(str, {
    font: f, size, depth, curveSegments: 10,
    bevelEnabled: bevel, bevelThickness: size * 0.04, bevelSize: size * 0.025, bevelSegments: 4,
  });
  geo.computeBoundingBox();
  const b = geo.boundingBox;
  const x = align === 'left' ? -b.min.x : align === 'right' ? -b.max.x : -(b.min.x + b.max.x) / 2;
  geo.translate(x, 0, -(b.min.z + b.max.z) / 2);
  const mesh = new THREE.Mesh(geo, mat || material('plastic', '#111111'));
  mesh.castShadow = true;
  return mesh;
}

/* ── GLB 모델 ────────────────────────────────────────────────────────────────── */
let gltfLoader = null;
/**
 * GLB/GLTF를 불러온다 (Draco·Meshopt 압축 지원). Stage.film 밖에서 await 한다.
 * size를 주면 가장 긴 변이 size가 되게 맞추고 가운데·바닥을 원점에 둔다.
 * 돌려주는 그룹: .clips(애니메이션 이름 목록), .pose(t, 이름) — 모델 안 애니메이션을 t초 자세로.
 */
export async function model(url, { size } = {}) {
  if (!gltfLoader) {
    const draco = new DRACOLoader().setDecoderPath(new URL('./three/addons/libs/draco/', import.meta.url).href);
    gltfLoader = new GLTFLoader().setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder);
  }
  const gltf = await gltfLoader.loadAsync(new URL(url, location.href).href);
  const root = gltf.scene;
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  const group = new THREE.Group();
  group.add(root);
  if (size) {
    const box = new THREE.Box3().setFromObject(root), dim = box.getSize(new THREE.Vector3());
    const k = size / Math.max(dim.x, dim.y, dim.z);
    root.scale.setScalar(k);
    const c = box.getCenter(new THREE.Vector3());
    root.position.set(-c.x * k, -box.min.y * k, -c.z * k);
  }
  const mixer = new THREE.AnimationMixer(root);
  const actions = Object.fromEntries(gltf.animations.map((clip) => [clip.name, mixer.clipAction(clip)]));
  group.userData.stage3dKeep = true;   // film.json이 바뀌어도 다시 불러오지 않는다
  return Object.assign(group, {
    clips: Object.keys(actions),
    pose(t, name = Object.keys(actions)[0]) {
      const a = actions[name];
      if (!a) return group;
      mixer.stopAllAction(); a.play();
      mixer.setTime(t);
      return group;
    },
  });
}
