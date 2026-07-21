import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

// ---------- renderer / scene ----------
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x262a33);

scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x3a3a3a, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(8, 14, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = sun.shadow.camera.bottom = -20;
sun.shadow.camera.right = sun.shadow.camera.top = 20;
sun.shadow.bias = -0.0004;
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(80, 80),
  new THREE.MeshStandardMaterial({ color: 0x3c414b, roughness: 1 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const grid = new THREE.GridHelper(80, 80, 0x59606e, 0x2e323b);
grid.position.y = 0.001;
scene.add(grid);

// ---------- cameras ----------
const editorCam = new THREE.PerspectiveCamera(55, 1, 0.1, 500);
editorCam.position.set(7, 5, 9);
const orbit = new OrbitControls(editorCam, canvas);
orbit.target.set(0, 1, 0);
orbit.update();

const shotCam = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 500);
shotCam.position.set(0, 1.6, 8);
shotCam.lookAt(0, 1, 0);
shotCam.userData.keys = [];
shotCam.userData.follow = null; // object index the camera auto-aims at (overrides key orientation)
scene.add(shotCam);
// helper on a short-far proxy so the frustum draws as a small cone, not 500u of lines
const vizCam = new THREE.PerspectiveCamera(shotCam.fov, 16 / 9, 0.1, 4);
scene.add(vizCam);
const camHelper = new THREE.CameraHelper(vizCam);
scene.add(camHelper);
function syncViz() {
  vizCam.position.copy(shotCam.position);
  vizCam.quaternion.copy(shotCam.quaternion);
  vizCam.fov = shotCam.fov;
  vizCam.updateProjectionMatrix();
  camHelper.update();
}

// ---------- objects ----------
const objects = [];
const PALETTE = [0xe07a5f, 0x81b29a, 0xf2cc8f, 0x8d99ae, 0xc9ada7, 0x6d9dc5];
let colorIdx = 0;

function makeMesh(kind, color) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
  if (kind === 'person') {
    const g = new THREE.Group();
    const part = (w, h, d, x, y, z, parent = g) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      parent.add(m);
      return m;
    };
    part(0.34, 0.5, 0.18, 0, 1.12, 0);   // torso
    part(0.22, 0.22, 0.22, 0, 1.5, 0);   // head
    // face: eyes + hair so orientation reads and close-ups hold up
    const eyeW = new THREE.MeshStandardMaterial({ color: 0xf5f5f0 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x16161a });
    const eye = (x) => {
      const w = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.055, 0.02), eyeW);
      w.position.set(x, 1.53, 0.115); g.add(w);
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.026, 0.02), dark);
      p.position.set(x, 1.53, 0.127); g.add(p);
    };
    eye(-0.055); eye(0.055);
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.03), mat);
    nose.position.set(0, 1.47, 0.12); g.add(nose);
    const hair = new THREE.Mesh(new THREE.BoxGeometry(0.235, 0.08, 0.235), dark);
    hair.position.set(0, 1.625, -0.005); g.add(hair);
    // limbs pivot at shoulder/hip so they can swing while walking
    const limb = (x, y, len, thick) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, y, 0);
      g.add(pivot);
      part(thick, len, thick, 0, -len / 2, 0, pivot);
      return pivot;
    };
    g.userData.limbs = {
      armL: limb(-0.24, 1.34, 0.45, 0.09),
      armR: limb(0.24, 1.34, 0.45, 0.09),
      legL: limb(-0.09, 0.86, 0.85, 0.12),
      legR: limb(0.09, 0.86, 0.85, 0.12),
    };
    return g;
  }
  const geo = {
    box: [new THREE.BoxGeometry(1, 1, 1), 0.5],
    sphere: [new THREE.SphereGeometry(0.5, 32, 16), 0.5],
    cylinder: [new THREE.CylinderGeometry(0.4, 0.4, 1.5, 24), 0.75],
    cone: [new THREE.ConeGeometry(0.5, 1.2, 24), 0.6],
  }[kind];
  const m = new THREE.Mesh(geo[0], mat);
  m.position.y = geo[1];
  m.castShadow = true;
  return m;
}

function addObject(kind, color) {
  color ??= PALETTE[colorIdx++ % PALETTE.length];
  const obj = makeMesh(kind, color);
  Object.assign(obj.userData, { kind, color, keys: [] }); // assign, not replace — person keeps .limbs
  scene.add(obj);
  objects.push(obj);
  select(obj);
  pushState();
  return obj;
}

// ---------- selection / gizmo ----------
let selected = null;
const tc = new TransformControls(editorCam, canvas);
scene.add(tc);
tc.addEventListener('dragging-changed', (e) => {
  orbit.enabled = !e.value && !viewShot;
  // auto-key: moving an already-animated object updates its key at the playhead
  if (!e.value && selected) { if (selected.userData.keys.length) keyObject(selected); else pushState(); }
});

function select(obj) {
  selected = obj;
  if (obj) tc.attach(obj); else tc.detach();
  renderMarkers();
}

// grab an object's body to slide it on the ground plane; gizmo covers rotate/scale/vertical
const raycaster = new THREE.Raycaster();
let downPos = null;
let dragObj = null;
const dragPlane = new THREE.Plane();
const dragOffset = new THREE.Vector3();
const planeHit = new THREE.Vector3();

function castFromPointer(e) {
  raycaster.setFromCamera(
    new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1),
    editorCam
  );
}

function pickObject(e) {
  castFromPointer(e);
  const hit = raycaster.intersectObjects(objects, true)[0];
  if (!hit) return null;
  let o = hit.object;
  while (o.parent && o.parent !== scene) o = o.parent;
  return { obj: o, point: hit.point };
}

let looking = false;
let lookLast = null;

canvas.addEventListener('pointerdown', (e) => {
  downPos = [e.clientX, e.clientY];
  if (viewShot) {
    if (e.button === 0) { looking = true; lookLast = [e.clientX, e.clientY]; shotCam.userData.follow = null; }
    return;
  }
  if (e.button !== 0 || tc.dragging || tc.axis) return;
  if (annotating) { annotateAt(e); return; }
  const hit = pickObject(e);
  if (!hit) return;
  select(hit.obj);
  if (locked) return; // browse mode: select but never move
  dragObj = hit.obj;
  dragPlane.set(new THREE.Vector3(0, 1, 0), -hit.point.y);
  dragOffset.copy(dragObj.position).sub(hit.point);
  orbit.enabled = false;
});

canvas.addEventListener('pointermove', (e) => {
  if (looking && lookLast) {
    const eu = new THREE.Euler().setFromQuaternion(shotCam.quaternion, 'YXZ');
    eu.y -= (e.clientX - lookLast[0]) * 0.0035;
    eu.x = Math.max(-1.5, Math.min(1.5, eu.x - (e.clientY - lookLast[1]) * 0.0035));
    eu.z = 0;
    shotCam.quaternion.setFromEuler(eu);
    lookLast = [e.clientX, e.clientY];
    return;
  }
  if (!dragObj) return;
  castFromPointer(e);
  if (raycaster.ray.intersectPlane(dragPlane, planeHit)) {
    dragObj.position.x = planeHit.x + dragOffset.x;
    dragObj.position.z = planeHit.z + dragOffset.z;
  }
});

canvas.addEventListener('pointerup', (e) => {
  const moved = downPos ? Math.hypot(e.clientX - downPos[0], e.clientY - downPos[1]) : 0;
  downPos = null;
  if (looking) { looking = false; lookLast = null; return; }
  if (dragObj) {
    if (moved > 4 && dragObj.userData.keys.length) keyObject(dragObj);
    else if (moved > 4) pushState();
    dragObj = null;
    orbit.enabled = !viewShot;
    return;
  }
  if (viewShot || moved > 4 || tc.dragging) return;
  if (!pickObject(e)) select(null);
});

// ---------- keyframes ----------
let duration = 5;
let t = 0;
let playing = false;

function setKey(target, extra = {}) {
  const keys = target.userData.keys;
  const key = {
    t: +t.toFixed(3),
    p: target.position.toArray(),
    q: target.quaternion.toArray(),
    s: target.scale.toArray(),
    ...extra,
  };
  const i = keys.findIndex((k) => Math.abs(k.t - key.t) < 0.05);
  if (i >= 0) keys[i] = key;
  else { keys.push(key); keys.sort((a, b) => a.t - b.t); }
  renderMarkers();
  pushState();
}
const keyObject = (obj) => obj && !locked && setKey(obj);
function keyCameraFromView() {
  if (!viewShot) { // in editor view, snap the shot cam to your current view first
    shotCam.position.copy(editorCam.position);
    shotCam.quaternion.copy(editorCam.quaternion);
  }
  shotCam.userData.follow = null; // manual framing takes over from follow mode
  setKey(shotCam, { fov: shotCam.fov });
}

// ponytail: per-segment smoothstep ease only; add bezier curve editing if motion feel matters
function sample(keys, time) {
  if (!keys.length) return null;
  if (time <= keys[0].t) return keys[0];
  const last = keys[keys.length - 1];
  if (time >= last.t) return last;
  let i = 1;
  while (keys[i].t < time) i++;
  const a = keys[i - 1], b = keys[i];
  let f = (time - a.t) / (b.t - a.t);
  if (!a.lin) f = f * f * (3 - 2 * f); // lin: constant-speed segment (walkers)
  const lerpArr = (u, v) => u.map((x, j) => x + (v[j] - x) * f);
  const q = new THREE.Quaternion().fromArray(a.q).slerp(new THREE.Quaternion().fromArray(b.q), f);
  const out = { p: lerpArr(a.p, b.p), q: q.toArray(), s: lerpArr(a.s, b.s) };
  if (a.fov != null) out.fov = a.fov + (b.fov - a.fov) * f;
  return out;
}

// deterministic walk pose from distance walked along the keyframe polyline (scrub-safe)
function posePerson(obj, time) {
  const limbs = obj.userData.limbs;
  if (!limbs) return;
  const keys = obj.userData.keys;
  let dist = 0;
  let moving = false;
  if (keys.length > 1 && time > keys[0].t && time < keys[keys.length - 1].t + 0.01) {
    let prev = keys[0];
    for (let i = 1; i < keys.length; i++) {
      const k = keys[i];
      if (k.t <= time) {
        dist += Math.hypot(k.p[0] - prev.p[0], k.p[2] - prev.p[2]);
        prev = k;
      } else {
        const partial = Math.hypot(obj.position.x - prev.p[0], obj.position.z - prev.p[2]);
        dist += partial;
        moving = Math.hypot(k.p[0] - prev.p[0], k.p[2] - prev.p[2]) > 0.05;
        break;
      }
    }
  }
  const swing = moving ? Math.sin(dist * 5.7) * 0.55 : 0; // ~1.1m stride
  limbs.legL.rotation.x = swing;
  limbs.legR.rotation.x = -swing;
  limbs.armL.rotation.x = -swing * 0.6;
  limbs.armR.rotation.x = swing * 0.6;
}

function applyTime(time) {
  for (const obj of [...objects, shotCam]) {
    const k = sample(obj.userData.keys, time);
    if (k) {
      obj.position.fromArray(k.p);
      obj.quaternion.fromArray(k.q);
      obj.scale.fromArray(k.s);
      if (k.fov != null) { obj.fov = k.fov; obj.updateProjectionMatrix(); fovInput.value = fovVal.textContent = Math.round(k.fov); }
    }
    if (obj.userData.kind === 'person') posePerson(obj, time);
  }
  const fi = shotCam.userData.follow;
  if (fi != null && objects[fi]) {
    const target = objects[fi];
    shotCam.lookAt(target.position.x, target.position.y + 1.2, target.position.z);
  }
}

function seek(time) {
  t = Math.min(Math.max(time, 0), duration);
  applyTime(t);
  syncUI();
}

// ---------- UI ----------
const $ = (id) => document.getElementById(id);
const scrubEl = $('scrub'), timeLabel = $('timeLabel'), playBtn = $('playBtn');
const fovInput = $('fov'), fovVal = $('fovVal'), markersEl = $('markers');

function syncUI() {
  scrubEl.value = t;
  timeLabel.textContent = `${t.toFixed(2)} / ${duration.toFixed(2)}s`;
}

function renderMarkers() {
  markersEl.innerHTML = '';
  const add = (keys, cls) => {
    for (const k of keys) {
      const m = document.createElement('div');
      m.className = `mk ${cls}`;
      m.style.left = `${(k.t / duration) * 100}%`;
      m.onclick = (e) => {
        if (e.altKey) {
          const arr = cls === 'cam' ? shotCam.userData.keys : selected.userData.keys;
          arr.splice(arr.indexOf(k), 1);
          renderMarkers();
          pushState();
        } else seek(k.t);
      };
      markersEl.append(m);
    }
  };
  add(shotCam.userData.keys, 'cam');
  if (selected) add(selected.userData.keys, 'obj');
}

document.querySelectorAll('[data-add]').forEach((b) =>
  (b.onclick = () => addObject(b.dataset.add)));
$('keyObjBtn').onclick = () => keyObject(selected);
$('keyCamBtn').onclick = keyCameraFromView;
$('delBtn').onclick = deleteSelected;
$('dupBtn').onclick = duplicateSelected;
playBtn.onclick = togglePlay;
$('shotBtn').onclick = toggleShotView;
$('recBtn').onclick = record;
scrubEl.oninput = () => seek(parseFloat(scrubEl.value));
$('durInput').onchange = (e) => {
  duration = Math.min(Math.max(+e.target.value || 5, 1), 60);
  e.target.value = duration;
  scrubEl.max = duration;
  seek(Math.min(t, duration));
  renderMarkers();
  pushState();
};
fovInput.oninput = () => {
  shotCam.fov = +fovInput.value;
  shotCam.updateProjectionMatrix();
  fovVal.textContent = fovInput.value;
};

function deleteSelected() {
  if (!selected || locked) return;
  scene.remove(selected);
  objects.splice(objects.indexOf(selected), 1);
  select(null);
  pushState();
}

function duplicateSelected() {
  if (!selected || locked) return;
  const src = selected;
  const obj = addObject(src.userData.kind, src.userData.color);
  obj.position.copy(src.position).x += 1.2;
  obj.quaternion.copy(src.quaternion);
  obj.scale.copy(src.scale);
  obj.userData.keys = structuredClone(src.userData.keys);
  renderMarkers();
  pushState();
}

function togglePlay() {
  playing = !playing;
  playBtn.textContent = playing ? '⏸ Pause' : '▶ Play';
}

let viewShot = false;
function toggleShotView(force) {
  viewShot = force ?? !viewShot;
  flyKeys.clear();
  orbit.enabled = !viewShot;
  tc.enabled = !viewShot && !locked;
  $('shotBtn').style.borderColor = viewShot ? 'var(--acc)' : '';
}

// shot-view fly cam: WASD dolly/truck, Q/E down/up, drag = pan/tilt, C keys the framing
const flyKeys = new Set();
addEventListener('keyup', (e) => flyKeys.delete(e.key.toLowerCase()));
addEventListener('blur', () => flyKeys.clear());

function flyCam(dt) {
  if (!viewShot || !flyKeys.size) return;
  const step = 4 * dt * (flyKeys.has('shift') ? 3 : 1);
  const dir = new THREE.Vector3(
    (flyKeys.has('d') ? 1 : 0) - (flyKeys.has('a') ? 1 : 0),
    0,
    (flyKeys.has('s') ? 1 : 0) - (flyKeys.has('w') ? 1 : 0)
  );
  if (dir.lengthSq()) shotCam.position.add(dir.normalize().applyQuaternion(shotCam.quaternion).multiplyScalar(step));
  if (flyKeys.has('q')) shotCam.position.y -= step;
  if (flyKeys.has('e')) shotCam.position.y += step;
}

addEventListener('keydown', (e) => {
  if (e.target.matches('input,select,textarea')) return;
  const k = e.key.toLowerCase();
  if (viewShot && ('wasdqe'.includes(k) || k === 'shift') && !e.metaKey && !e.ctrlKey) {
    flyKeys.add(k);
    e.preventDefault();
    return;
  }
  if (k === 'w') tc.setMode('translate');
  else if (k === 'e') tc.setMode('rotate');
  else if (k === 'r') tc.setMode('scale');
  else if (k === 'k') keyObject(selected);
  else if (k === 'l') toggleLock();
  else if (k === 'c') keyCameraFromView();
  else if (k === 'd' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); duplicateSelected(); }
  else if (k === 'delete' || k === 'backspace') deleteSelected();
  else if (k === 'tab') { e.preventDefault(); toggleShotView(); }
  else if (k === ' ') { e.preventDefault(); togglePlay(); }
  else if (k === ',' || k === '.') {
    const ts = [...new Set([...objects, shotCam].flatMap((o) => o.userData.keys.map((key) => key.t)))].sort((a, b) => a - b);
    const next = k === '.' ? ts.find((x) => x > t + 0.001) : ts.reverse().find((x) => x < t - 0.001);
    if (next != null) seek(next);
  }
});

// ---------- save / load ----------
$('saveBtn').onclick = () => {
  const data = {
    duration,
    camera: { keys: shotCam.userData.keys, fov: shotCam.fov, p: shotCam.position.toArray(), q: shotCam.quaternion.toArray() },
    objects: objects.map((o) => ({
      kind: o.userData.kind, color: o.userData.color, keys: o.userData.keys,
      p: o.position.toArray(), q: o.quaternion.toArray(), s: o.scale.toArray(),
    })),
  };
  download('storyboard.json', new Blob([JSON.stringify(data)], { type: 'application/json' }));
};
$('loadBtn').onclick = () => $('loadFile').click();
$('loadFile').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const data = JSON.parse(await file.text());
  for (const o of [...objects]) { scene.remove(o); }
  objects.length = 0;
  select(null);
  for (const od of data.objects) {
    const obj = addObject(od.kind, od.color);
    obj.position.fromArray(od.p);
    obj.quaternion.fromArray(od.q);
    obj.scale.fromArray(od.s);
    obj.userData.keys = od.keys;
  }
  select(null);
  shotCam.userData.keys = data.camera.keys;
  shotCam.position.fromArray(data.camera.p);
  shotCam.quaternion.fromArray(data.camera.q);
  shotCam.fov = data.camera.fov;
  shotCam.updateProjectionMatrix();
  duration = data.duration;
  $('durInput').value = duration;
  scrubEl.max = duration;
  seek(0);
  renderMarkers();
  pushState();
  e.target.value = '';
};

function download(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---------- scene spec (agent interchange format; documented in SKILL.md) ----------
function toSpec() {
  const convKey = (k) => ({
    t: k.t,
    pos: k.p.map((v) => +v.toFixed(2)),
    ry: +((new THREE.Euler().setFromQuaternion(new THREE.Quaternion().fromArray(k.q), 'YXZ').y * 180) / Math.PI).toFixed(1),
    scale: k.s[0] === k.s[1] && k.s[1] === k.s[2] ? +k.s[0].toFixed(2) : k.s.map((v) => +v.toFixed(2)),
  });
  const dir = new THREE.Vector3();
  const camKeys = (shotCam.userData.keys.length
    ? shotCam.userData.keys
    : [{ t: 0, p: shotCam.position.toArray(), q: shotCam.quaternion.toArray(), fov: shotCam.fov }]
  ).map((k) => {
    dir.set(0, 0, -1).applyQuaternion(new THREE.Quaternion().fromArray(k.q));
    const look = new THREE.Vector3().fromArray(k.p).addScaledVector(dir, 5);
    return {
      t: k.t,
      pos: k.p.map((v) => +v.toFixed(2)),
      lookAt: look.toArray().map((v) => +v.toFixed(2)),
      fov: Math.round(k.fov ?? shotCam.fov),
    };
  });
  return {
    duration,
    objects: objects.map((o) => ({
      kind: o.userData.kind,
      color: '#' + new THREE.Color(o.userData.color).getHexString(),
      ...(o.userData.keys[0]?.lin ? { ease: 'linear' } : {}),
      keys: o.userData.keys.length
        ? o.userData.keys.map(convKey)
        : [convKey({ t: 0, p: o.position.toArray(), q: o.quaternion.toArray(), s: o.scale.toArray() })],
    })),
    camera: {
      keys: camKeys,
      ...(shotCam.userData.follow != null ? { follow: shotCam.userData.follow } : {}),
    },
  };
}

function addObjectsFromSpec(list) {
  for (const od of list || []) {
    const obj = addObject(od.kind, od.color ? new THREE.Color(od.color).getHex() : undefined);
    obj.userData.keys = (od.keys || [])
      .map((k) => ({
        t: k.t,
        p: k.pos,
        q: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ((k.ry || 0) * Math.PI) / 180, 0)).toArray(),
        s: Array.isArray(k.scale) ? k.scale : [k.scale ?? 1, k.scale ?? 1, k.scale ?? 1],
        lin: od.ease === 'linear' || undefined,
      }))
      .sort((a, b) => a.t - b.t);
    const first = obj.userData.keys[0];
    if (first) {
      obj.position.fromArray(first.p);
      obj.quaternion.fromArray(first.q);
      obj.scale.fromArray(first.s);
    }
  }
}

function buildFromSpec(spec) {
  for (const o of [...objects]) scene.remove(o);
  objects.length = 0;
  select(null);
  duration = Math.min(Math.max(spec.duration || 5, 1), 60);
  $('durInput').value = duration;
  scrubEl.max = duration;
  addObjectsFromSpec(spec.objects);
  const tmp = new THREE.PerspectiveCamera(); // camera lookAt points -Z at target; plain Object3D points +Z
  shotCam.userData.keys = (spec.camera?.keys || [])
    .map((k) => {
      tmp.position.fromArray(k.pos);
      tmp.lookAt(new THREE.Vector3().fromArray(k.lookAt));
      return { t: k.t, p: k.pos, q: tmp.quaternion.toArray(), s: [1, 1, 1], fov: k.fov ?? 40 };
    })
    .sort((a, b) => a.t - b.t);
  shotCam.userData.follow = Number.isInteger(spec.camera?.follow) ? spec.camera.follow : null;
  const camFirst = shotCam.userData.keys[0];
  if (camFirst) {
    shotCam.position.fromArray(camFirst.p);
    shotCam.quaternion.fromArray(camFirst.q);
    shotCam.fov = camFirst.fov;
    shotCam.updateProjectionMatrix();
    fovInput.value = fovVal.textContent = Math.round(camFirst.fov);
  }
  select(null);
  seek(0);
  renderMarkers();
}

// ---------- recording ----------
let recording = false;
let recorder = null;

function record() {
  if (recording || !('MediaRecorder' in window)) return;
  recording = true;
  toggleShotView(true);
  renderer.setPixelRatio(1);
  renderer.setSize(1280, 720, false);
  $('recbadge').style.display = 'block';
  const mime = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm']
    .find((m) => MediaRecorder.isTypeSupported(m));
  const ext = mime.startsWith('video/mp4') ? 'mp4' : 'webm';
  const chunks = [];
  recorder = new MediaRecorder(canvas.captureStream(30), { mimeType: mime, videoBitsPerSecond: 12_000_000 });
  recorder.ondataavailable = (e) => chunks.push(e.data);
  recorder.onstop = async () => {
    const blob = new Blob(chunks, { type: mime.split(';')[0] });
    const base = ($('shotName').value.trim() || 'export').replace(/[^\w ._-]/g, '');
    const name = `${base} ${new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '')}.${ext}`;
    try {
      await fetch('/assets/' + encodeURIComponent(name), { method: 'POST', body: blob });
      toast('🎞 Export saved to project assets: ' + name, 6000);
      loadAssets();
    } catch {
      download(name, blob); // no bridge — browser download instead
    }
    recording = false;
    $('recbadge').style.display = 'none';
    renderer.setPixelRatio(devicePixelRatio);
    onResize();
    toggleShotView(false);
    seek(0);
  };
  seek(0);
  playing = true;
  playBtn.textContent = '⏸ Pause';
  recorder.start();
}

// ---------- render loop ----------
function onResize() {
  if (recording) return;
  renderer.setSize(innerWidth, innerHeight, false);
  editorCam.aspect = innerWidth / innerHeight;
  editorCam.updateProjectionMatrix();
}
addEventListener('resize', onResize);
onResize();

let last = performance.now();
function animate(now) {
  requestAnimationFrame(animate);
  const dt = (now - last) / 1000;
  last = now;
  if (playing) {
    t += dt;
    if (recording && t >= duration) {
      t = duration;
      applyTime(t);
      playing = false;
      playBtn.textContent = '▶ Play';
      recorder.stop();
    } else {
      t %= duration;
      applyTime(t);
    }
    syncUI();
  }
  flyCam(dt);
  syncViz();
  render();
}

function render() {
  const helpersOn = !viewShot;
  grid.visible = camHelper.visible = helpersOn;
  tc.visible = helpersOn && !!selected && !locked;
  const size = renderer.getSize(new THREE.Vector2());
  if (viewShot) {
    renderer.setScissorTest(false);
    renderer.setClearColor(0x000000);
    renderer.clear();
    const vw = Math.min(size.x, (size.y * 16) / 9);
    const vh = (vw * 9) / 16;
    const x = (size.x - vw) / 2, y = (size.y - vh) / 2;
    renderer.setViewport(x, y, vw, vh);
    renderer.setScissor(x, y, vw, vh);
    renderer.setScissorTest(true);
    renderer.render(scene, shotCam);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, size.x, size.y);
  } else {
    renderer.render(scene, editorCam);
  }
}

// ---------- collaboration bridge (Emulsion server) ----------
// An agent (Claude Code beside this window) POSTs ops to /op; they stream in
// over SSE so the user watches edits land live. The app pushes its own state
// back so the agent sees user edits. ponytail: last-writer-wins, no merge.
let applyingRemote = false;
let lastSeq = 0;

const toastEl = document.createElement('div');
toastEl.id = 'toast';
document.body.append(toastEl);
let toastTimer = null;
function toast(msg, ms = 4500) {
  toastEl.textContent = msg;
  toastEl.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.style.display = 'none'), ms);
}

function applyOp(op) {
  if (op.seq) {
    if (op.seq <= lastSeq) return; // stale/duplicate
    lastSeq = op.seq;
  }
  applyingRemote = true;
  try {
    if (op.type === 'spec') {
      buildFromSpec(op.spec);
      toast(op.note || '🎬 Scene updated by your director');
    } else if (op.type === 'seek') seek(op.t);
    else if (op.type === 'play') { playing = !!op.on; playBtn.textContent = playing ? '⏸ Pause' : '▶ Play'; }
    else if (op.type === 'shotview') toggleShotView(!!op.on);
    else if (op.type === 'say') toast('💬 ' + op.text, 7000);
    else if (op.type === 'assets') loadAssets();
    else if (op.type === 'shots') loadShots();
    else if (op.type === 'sets') loadSets();
    else if (op.type === 'reload') location.reload();
  } finally {
    applyingRemote = false;
  }
}

// short polling instead of SSE: a held-open stream wedges browser tooling and
// navigation-idle waits; a 1.2s poll is imperceptible for watching edits land
async function connectBridge() {
  try {
    const r = await (await fetch('/ops?since=' + lastSeq)).json();
    for (const op of r.ops || []) applyOp(op);
  } catch {
    // plain static host or server restarting — bridge features just stay quiet
  }
  setTimeout(connectBridge, 1200);
}

let pushTimer = null;
function pushState() {
  if (applyingRemote) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    fetch('/state', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(toSpec()),
    }).catch(() => {});
  }, 800);
}

// lock mode: browse without accidentally moving blocking
let locked = false;
function toggleLock() {
  locked = !locked;
  dragObj = null;
  tc.enabled = !locked && !viewShot;
  $('lockBtn').style.borderColor = locked ? 'var(--acc)' : '';
  toast(locked ? '🔒 Objects locked — selection and camera still work' : '🔓 Objects unlocked');
}
$('lockBtn').onclick = toggleLock;

// annotation mode: click something, get a reference token to paste into chat
let annotating = false;
$('annBtn').onclick = () => {
  annotating = !annotating;
  $('annBtn').style.borderColor = annotating ? 'var(--acc)' : '';
  if (annotating) toast('Annotation mode: click an object or spot, then paste the copied token into chat with your note', 6000);
};

function annotateAt(e) {
  const hit = pickObject(e);
  let token;
  if (hit) {
    const i = objects.indexOf(hit.obj);
    const p = hit.obj.position;
    token = `@${hit.obj.userData.kind}#${i} t=${t.toFixed(2)}s pos=(${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)})`;
  } else {
    castFromPointer(e);
    const p = new THREE.Vector3();
    token = raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p)
      ? `@ground t=${t.toFixed(2)}s pos=(${p.x.toFixed(1)},${p.z.toFixed(1)})`
      : `@t=${t.toFixed(2)}s`;
  }
  navigator.clipboard?.writeText(token).catch(() => {});
  fetch('/annotations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, t: +t.toFixed(2) }),
  }).catch(() => {});
  toast(`📍 ${token} — copied; paste in chat and add your note`, 6000);
}

// shot library: each saved layout is one shot; the collection is the storyboard
async function loadShots() {
  try {
    const names = await (await fetch('/shots')).json();
    const el = $('shotList');
    el.innerHTML = '';
    for (const name of names) {
      const a = document.createElement('a');
      a.textContent = '▸ ' + name;
      a.title = 'Load this shot';
      a.onclick = async () => {
        const spec = await (await fetch('/shots/' + encodeURIComponent(name))).json();
        buildFromSpec(spec);
        pushState();
        $('shotName').value = name;
        toast('🎬 Loaded shot: ' + name);
      };
      el.append(a);
    }
  } catch {}
}

$('shotSave').onclick = async () => {
  const name = $('shotName').value.trim() || 'shot ' + new Date().toTimeString().slice(0, 5);
  await fetch('/shots', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, spec: toSpec() }),
  }).catch(() => {});
  toast('💾 Saved shot: ' + name);
  loadShots();
};

// set library: reusable places — static scenery only; loading is ADDITIVE
async function loadSets() {
  try {
    const names = await (await fetch('/sets')).json();
    const el = $('setList');
    el.innerHTML = '';
    for (const name of names) {
      const a = document.createElement('a');
      a.textContent = '▸ ' + name;
      a.title = 'Add this set to the current scene';
      a.onclick = async () => {
        const set = await (await fetch('/sets/' + encodeURIComponent(name))).json();
        addObjectsFromSpec(set.objects);
        select(null);
        seek(t);
        pushState();
        toast('🏞 Added set: ' + name);
      };
      el.append(a);
    }
  } catch {}
}

$('setSave').onclick = async () => {
  const name = $('setName').value.trim() || 'set ' + new Date().toTimeString().slice(0, 5);
  const statics = toSpec().objects.filter((o) => (o.keys || []).length <= 1);
  await fetch('/sets', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, spec: { objects: statics } }),
  }).catch(() => {});
  toast(`💾 Saved set: ${name} (${statics.length} static objects)`);
  loadSets();
};

// asset shelf: reference images & files the director drops into ./assets
async function loadAssets() {
  try {
    const list = await (await fetch('/assets.json')).json();
    const el = $('shelfItems');
    el.innerHTML = '';
    for (const f of list) {
      const row = document.createElement('div');
      row.className = 'assetRow';
      if (/\.(png|jpe?g|webp|gif)$/i.test(f)) {
        const img = document.createElement('img');
        img.src = 'assets/' + f;
        img.title = f;
        img.onclick = () => window.open('assets/' + f);
        row.append(img);
      } else {
        const a = document.createElement('a');
        a.href = 'assets/' + f;
        a.target = '_blank';
        a.textContent = f;
        row.append(a);
      }
      const btn = document.createElement('button');
      btn.className = 'openBtn';
      btn.textContent = '📂';
      btn.title = 'Reveal file in Finder';
      btn.onclick = () => fetch('/open', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: f }) }).catch(() => {});
      row.append(btn);
      el.append(row);
    }
  } catch {}
}

connectBridge();
loadAssets();
loadShots();
loadSets();

window.app = { editorCam, shotCam, orbit, tc, objects, select, seek, toSpec, buildFromSpec, toggleLock }; // QA/debug handle

// starter scene so the canvas isn't empty
addObject('person').position.set(-1, 0, 0);
addObject('box').position.set(1.5, 0.5, -1);
select(null);
syncUI();
renderMarkers();
requestAnimationFrame(animate);
