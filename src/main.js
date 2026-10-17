import * as THREE from 'three';

const $ = (selector) => document.querySelector(selector);
const viewport = $('#viewport');
const loadingNode = $('#renderer-loading');
const readyNode = $('#renderer-ready');
const errorNode = $('#renderer-error');
const statusNode = $('#editor-status');
const timelineInput = $('#timeline-frame');
const angleInput = $('#joint-angle');
const angleReadout = $('#angle-readout');
const frameReadout = $('#frame-readout');
const keyCount = $('#key-count');
const keyframeMarkers = $('#keyframe-markers');
const selectedJointLabel = $('#selected-joint-label');
const playToggle = $('#play-toggle');
const playState = $('#play-state');

const DURATION = 60;
const FPS = 30;
const CHANNELS = ['shoulderL', 'elbowL', 'shoulderR', 'elbowR', 'hipL', 'kneeL', 'hipR', 'kneeR', 'torso', 'head'];
const LABELS = {
  shoulderL: 'Left shoulder', elbowL: 'Left elbow',
  shoulderR: 'Right shoulder', elbowR: 'Right elbow',
  hipL: 'Left hip', kneeL: 'Left knee',
  hipR: 'Right hip', kneeR: 'Right knee',
  torso: 'Torso', head: 'Head'
};
const JOINT_RANGES = Object.fromEntries(CHANNELS.map((channel) => [channel, [-90, 90]]));
let currentPose = Object.fromEntries(CHANNELS.map((channel) => [channel, 0]));
let selectedJoint = 'shoulderL';
let currentFrame = 0;
let keyframes = [];
let playing = false;
let lastTime = 0;
let animationFrameId = 0;
let renderer;
let resizeObserver;
let rig;
let camera;
let scene;
let disposed = false;

function showStatus(message, kind = 'info') {
  statusNode.textContent = message;
  statusNode.dataset.kind = kind;
}

function safeNumber(value, label, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new Error(`${label} must be a finite number between ${min} and ${max}.`);
  }
  return number;
}

function makeMesh(geometry, material, parent, position = [0, 0, 0]) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  parent.add(mesh);
  return mesh;
}

function makeJointMarker(parent, color = 0x88e7bf) {
  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(0.055, 12, 8),
    new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.12 })
  );
  parent.add(marker);
  return marker;
}

function makeLimbSegment(parent, size, position, material) {
  const mesh = makeMesh(new THREE.BoxGeometry(...size), material, parent, position);
  mesh.geometry.computeBoundingSphere();
  return mesh;
}

function buildRig(targetScene) {
  const materials = {
    body: new THREE.MeshStandardMaterial({ color: 0x6f89ac, roughness: 0.68 }),
    accent: new THREE.MeshStandardMaterial({ color: 0x7be4b6, roughness: 0.42, metalness: 0.08 }),
    joint: new THREE.MeshStandardMaterial({ color: 0xe2b68a, roughness: 0.55 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x263343, roughness: 0.85 }),
    head: new THREE.MeshStandardMaterial({ color: 0xe4c2a2, roughness: 0.62 }),
    shoe: new THREE.MeshStandardMaterial({ color: 0x283343, roughness: 0.8 })
  };

  const root = new THREE.Group();
  root.name = 'root';
  targetScene.add(root);

  const hips = new THREE.Group();
  hips.name = 'hips';
  hips.position.set(0, 1.28, 0);
  root.add(hips);

  makeLimbSegment(hips, [0.42, 0.22, 0.24], [0, -0.02, 0], materials.dark);

  const torso = new THREE.Group();
  torso.name = 'torso';
  torso.position.set(0, 0.12, 0);
  hips.add(torso);
  makeLimbSegment(torso, [0.43, 0.58, 0.24], [0, 0.31, 0], materials.body);
  makeLimbSegment(torso, [0.45, 0.1, 0.255], [0, 0.52, 0], materials.accent);

  const neck = new THREE.Group();
  neck.name = 'neck';
  neck.position.set(0, 0.62, 0);
  torso.add(neck);
  makeLimbSegment(neck, [0.13, 0.14, 0.13], [0, 0.03, 0], materials.joint);

  const head = new THREE.Group();
  head.name = 'head';
  head.position.set(0, 0.16, 0);
  neck.add(head);
  makeMesh(new THREE.SphereGeometry(0.19, 20, 16), materials.head, head, [0, 0.08, 0]);
  makeLimbSegment(head, [0.32, 0.07, 0.32], [0, -0.035, 0], materials.dark);
  makeMesh(new THREE.SphereGeometry(0.025, 10, 8), materials.dark, head, [-0.065, 0.095, 0.17]);
  makeMesh(new THREE.SphereGeometry(0.025, 10, 8), materials.dark, head, [0.065, 0.095, 0.17]);

  const pivots = { torso, head };
  const arms = [
    { side: 'L', sign: -1 },
    { side: 'R', sign: 1 }
  ];
  for (const { side, sign } of arms) {
    const shoulder = new THREE.Group();
    shoulder.name = `shoulder${side}`;
    shoulder.position.set(sign * 0.28, 0.5, 0);
    torso.add(shoulder);
    makeJointMarker(shoulder, 0x7be4b6);
    makeLimbSegment(shoulder, [0.15, 0.36, 0.15], [0, -0.18, 0], materials.body);

    const elbow = new THREE.Group();
    elbow.name = `elbow${side}`;
    elbow.position.set(0, -0.35, 0);
    shoulder.add(elbow);
    makeJointMarker(elbow, 0xe8c9a8);
    makeLimbSegment(elbow, [0.12, 0.31, 0.12], [0, -0.155, 0], materials.accent);
    makeMesh(new THREE.SphereGeometry(0.07, 12, 10), materials.head, elbow, [0, -0.33, 0]);
    pivots[`shoulder${side}`] = shoulder;
    pivots[`elbow${side}`] = elbow;
  }

  const legs = [
    { side: 'L', sign: -1 },
    { side: 'R', sign: 1 }
  ];
  for (const { side, sign } of legs) {
    const hip = new THREE.Group();
    hip.name = `hip${side}`;
    hip.position.set(sign * 0.13, -0.13, 0);
    hips.add(hip);
    makeJointMarker(hip, 0x7be4b6);
    makeLimbSegment(hip, [0.18, 0.43, 0.18], [0, -0.215, 0], materials.body);

    const knee = new THREE.Group();
    knee.name = `knee${side}`;
    knee.position.set(0, -0.42, 0);
    hip.add(knee);
    makeJointMarker(knee, 0xe8c9a8);
    makeLimbSegment(knee, [0.145, 0.4, 0.145], [0, -0.2, 0], materials.accent);
    makeLimbSegment(knee, [0.26, 0.12, 0.39], [0, -0.4, 0.08], materials.shoe);
    pivots[`hip${side}`] = hip;
    pivots[`knee${side}`] = knee;
  }

  return { root, pivots };
}

function setJointRotation(channel, degrees) {
  const range = JOINT_RANGES[channel];
  const finite = safeNumber(degrees, LABELS[channel], range[0], range[1]);
  currentPose[channel] = finite;
  const pivot = rig?.pivots[channel];
  if (pivot) pivot.rotation.z = THREE.MathUtils.degToRad(finite);
  const valueNode = document.querySelector(`[data-value-for="${channel}"]`);
  if (valueNode) valueNode.textContent = `${Math.round(finite)}°`;
}

function applyPose(pose) {
  for (const channel of CHANNELS) {
    const value = Number(pose[channel] ?? 0);
    if (!Number.isFinite(value)) throw new Error(`Invalid pose value for ${channel}.`);
    setJointRotation(channel, THREE.MathUtils.clamp(value, ...JOINT_RANGES[channel]));
  }
  updateInspector();
}

function updateInspector() {
  angleInput.value = String(Math.round(currentPose[selectedJoint] ?? 0));
  angleReadout.value = `${Math.round(currentPose[selectedJoint] ?? 0)}°`;
  angleReadout.textContent = angleReadout.value;
  selectedJointLabel.textContent = LABELS[selectedJoint];
}

function selectJoint(channel) {
  if (!CHANNELS.includes(channel)) return;
  selectedJoint = channel;
  document.querySelectorAll('[data-joint]').forEach((button) => {
    const selected = button.dataset.joint === channel;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  updateInspector();
}

function interpolateAngle(from, to, t) {
  const delta = ((to - from + 540) % 360) - 180;
  return from + delta * t;
}

function samplePose(frame) {
  if (keyframes.length === 0) return { ...currentPose };
  const sorted = [...keyframes].sort((a, b) => a.frame - b.frame);
  let before = sorted[0];
  let after = sorted[sorted.length - 1];
  for (const key of sorted) {
    if (key.frame <= frame) before = key;
    if (key.frame >= frame) { after = key; break; }
  }
  if (frame <= sorted[0].frame) return { ...sorted[0].pose };
  if (frame >= sorted[sorted.length - 1].frame) return { ...sorted[sorted.length - 1].pose };
  if (before.frame === after.frame) return { ...before.pose };
  const t = THREE.MathUtils.clamp((frame - before.frame) / (after.frame - before.frame), 0, 1);
  const pose = {};
  for (const channel of CHANNELS) pose[channel] = interpolateAngle(before.pose[channel] ?? 0, after.pose[channel] ?? 0, t);
  return pose;
}

function setFrame(frame, { sample = true } = {}) {
  currentFrame = Math.round(THREE.MathUtils.clamp(Number(frame) || 0, 0, DURATION));
  timelineInput.value = String(currentFrame);
  frameReadout.textContent = `Frame ${currentFrame} / ${DURATION}`;
  if (sample && keyframes.length) applyPose(samplePose(currentFrame));
}

function updateKeyframeUi() {
  const sorted = [...keyframes].sort((a, b) => a.frame - b.frame);
  keyCount.textContent = `${sorted.length} keyframe${sorted.length === 1 ? '' : 's'}`;
  keyframeMarkers.replaceChildren();
  if (!sorted.length) {
    const empty = document.createElement('span');
    empty.className = 'muted';
    empty.textContent = 'No keys yet — set a pose and add a keyframe.';
    keyframeMarkers.append(empty);
    return;
  }
  for (const key of sorted) {
    const marker = document.createElement('button');
    marker.type = 'button';
    marker.className = 'key-marker';
    marker.textContent = `F${key.frame}`;
    marker.setAttribute('aria-label', `Go to keyframe ${key.frame}`);
    marker.addEventListener('click', () => setFrame(key.frame));
    keyframeMarkers.append(marker);
  }
}

function addOrUpdateKeyframe() {
  const frame = safeNumber(currentFrame, 'Frame', 0, DURATION);
  const pose = Object.fromEntries(CHANNELS.map((channel) => [
    channel,
    safeNumber(currentPose[channel] ?? 0, LABELS[channel], ...JOINT_RANGES[channel])
  ]));
  const existing = keyframes.findIndex((key) => key.frame === frame);
  if (existing >= 0) keyframes[existing] = { frame, pose };
  else keyframes.push({ frame, pose });
  keyframes.sort((a, b) => a.frame - b.frame);
  updateKeyframeUi();
  showStatus(existing >= 0 ? `Updated keyframe at frame ${frame}.` : `Added keyframe at frame ${frame}.`, 'success');
}

function createWalkCycle() {
  const makePose = (values) => Object.fromEntries(CHANNELS.map((channel) => [channel, values[channel] ?? 0]));
  const cycle = [
    { frame: 0, pose: makePose({ shoulderL: -25, shoulderR: 25, elbowL: 10, elbowR: 10, hipL: 24, hipR: -24, kneeL: 5, kneeR: 16, torso: -2 }) },
    { frame: 15, pose: makePose({ shoulderL: 0, shoulderR: 0, elbowL: 8, elbowR: 8, hipL: 0, hipR: 0, kneeL: 28, kneeR: 28, torso: 0 }) },
    { frame: 30, pose: makePose({ shoulderL: 25, shoulderR: -25, elbowL: 10, elbowR: 10, hipL: -24, hipR: 24, kneeL: 16, kneeR: 5, torso: 2 }) },
    { frame: 45, pose: makePose({ shoulderL: 0, shoulderR: 0, elbowL: 8, elbowR: 8, hipL: 0, hipR: 0, kneeL: 28, kneeR: 28, torso: 0 }) },
    { frame: 60, pose: makePose({ shoulderL: -25, shoulderR: 25, elbowL: 10, elbowR: 10, hipL: 24, hipR: -24, kneeL: 5, kneeR: 16, torso: -2 }) }
  ];
  keyframes = cycle;
  setFrame(0);
  updateKeyframeUi();
  showStatus('Created a five-key editable walk-cycle preset. Review foot contact before production use.', 'success');
}

function togglePlayback(force) {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (force === true && reducedMotion) {
    showStatus('Reduced-motion preference is enabled; use the timeline to inspect poses or explicitly press Play again.', 'info');
    return;
  }
  playing = typeof force === 'boolean' ? force : !playing;
  playToggle.innerHTML = playing ? 'Ⅱ <span>Pause</span>' : '▶ <span>Play</span>';
  playToggle.setAttribute('aria-label', playing ? 'Pause animation' : 'Play animation');
  playState.textContent = playing ? 'Playing' : 'Paused';
  if (playing && !keyframes.length) createWalkCycle();
  if (playing) showStatus('Playing the current animation clip.', 'info');
}

function normalizeImportedData(data) {
  if (!data || data.schemaVersion !== 1 || !Array.isArray(data.keyframes)) {
    throw new Error('Invalid animation file: expected schemaVersion 1 and a keyframes array.');
  }
  const seenFrames = new Set();
  const imported = data.keyframes.map((key) => {
    const frame = safeNumber(key?.frame, 'Keyframe frame', 0, DURATION);
    if (seenFrames.has(frame)) throw new Error(`Invalid animation file: duplicate frame ${frame}.`);
    seenFrames.add(frame);
    if (!key.pose || typeof key.pose !== 'object') throw new Error(`Invalid animation file: frame ${frame} has no pose.`);
    const pose = {};
    for (const channel of CHANNELS) pose[channel] = safeNumber(key.pose[channel] ?? 0, LABELS[channel], ...JOINT_RANGES[channel]);
    return { frame, pose };
  });
  return imported.sort((a, b) => a.frame - b.frame);
}

function exportAnimation() {
  const data = {
    schemaVersion: 1,
    name: 'RigLab walk / pose clip',
    fps: FPS,
    durationFrames: DURATION,
    rigType: 'procedural-preview-rig',
    interpolation: 'linear-shortest-angle',
    channels: CHANNELS,
    keyframes: [...keyframes].sort((a, b) => a.frame - b.frame)
  };
  const json = JSON.stringify(data, null, 2);
  window.__RIGLAB_LAST_EXPORT__ = data;
  const blobUrl = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = blobUrl;
  anchor.download = 'riglab-animation.json';
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  showStatus('Animation JSON exported.', 'success');
}

function importAnimation(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.addEventListener('load', () => {
    try {
      const parsed = JSON.parse(String(reader.result));
      keyframes = normalizeImportedData(parsed);
      updateKeyframeUi();
      setFrame(keyframes[0]?.frame ?? 0);
      showStatus(`Imported ${keyframes.length} keyframe(s).`, 'success');
    } catch (error) {
      showStatus(error instanceof Error ? error.message : 'Invalid animation file.', 'error');
    }
  }, { once: true });
  reader.addEventListener('error', () => showStatus('Could not read the selected animation file.', 'error'), { once: true });
  reader.readAsText(file);
}

function makeScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x111923);
  scene.fog = new THREE.Fog(0x111923, 7, 19);
  camera = new THREE.PerspectiveCamera(36, 1, 0.1, 60);
  camera.position.set(3.2, 2.1, 6.1);
  camera.lookAt(0, 1.15, 0);

  const ambient = new THREE.HemisphereLight(0xc8e8ff, 0x263342, 2.25);
  scene.add(ambient);
  const keyLight = new THREE.DirectionalLight(0xffe3c8, 2.1);
  keyLight.position.set(3, 5, 4);
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0x75d8c1, 0.65);
  fillLight.position.set(-4, 2, -2);
  scene.add(fillLight);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(100, 100),
    new THREE.MeshStandardMaterial({ color: 0x19232e, roughness: 0.92, metalness: 0 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.02;
  scene.add(floor);
  const grid = new THREE.GridHelper(12, 24, 0x3c5b66, 0x273a48);
  grid.position.y = 0.002;
  scene.add(grid);
  rig = buildRig(scene);
}

function resizeRenderer() {
  if (!renderer || !viewport || disposed) return;
  const width = Math.max(1, viewport.clientWidth);
  const height = Math.max(1, viewport.clientHeight);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function render(now = 0) {
  if (disposed || !renderer) return;
  animationFrameId = window.requestAnimationFrame(render);
  const delta = lastTime ? Math.min((now - lastTime) / 1000, 0.05) : 0;
  lastTime = now;
  if (playing) {
    currentFrame += delta * FPS;
    if (currentFrame >= DURATION) currentFrame = 0;
    setFrame(currentFrame);
  }
  renderer.render(scene, camera);
}

function setupCameraOrbit() {
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let theta = Math.atan2(camera.position.x, camera.position.z);
  let phi = Math.acos(THREE.MathUtils.clamp((camera.position.y - 1.15) / camera.position.distanceTo(new THREE.Vector3(0, 1.15, 0)), -1, 1));
  const target = new THREE.Vector3(0, 1.15, 0);
  const updateCamera = () => {
    const radius = THREE.MathUtils.clamp(camera.position.distanceTo(target), 3.2, 10);
    phi = THREE.MathUtils.clamp(phi, 0.25, Math.PI - 0.25);
    camera.position.set(
      target.x + radius * Math.sin(phi) * Math.sin(theta),
      target.y + radius * Math.cos(phi),
      target.z + radius * Math.sin(phi) * Math.cos(theta)
    );
    camera.lookAt(target);
  };
  viewport.addEventListener('pointerdown', (event) => {
    if (event.target !== renderer.domElement) return;
    dragging = true; lastX = event.clientX; lastY = event.clientY;
    viewport.setPointerCapture?.(event.pointerId);
  });
  viewport.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    theta -= (event.clientX - lastX) * 0.008;
    phi -= (event.clientY - lastY) * 0.008;
    lastX = event.clientX; lastY = event.clientY; updateCamera();
  });
  const endDrag = () => { dragging = false; };
  viewport.addEventListener('pointerup', endDrag);
  viewport.addEventListener('pointercancel', endDrag);
  viewport.addEventListener('wheel', (event) => {
    if (event.target !== renderer.domElement) return;
    const currentRadius = camera.position.distanceTo(target);
    camera.position.sub(target).multiplyScalar(THREE.MathUtils.clamp(1 + event.deltaY * 0.001, 0.88, 1.12)).add(target);
    if (camera.position.distanceTo(target) < 3.2 || camera.position.distanceTo(target) > 10) {
      camera.position.sub(target).normalize().multiplyScalar(THREE.MathUtils.clamp(currentRadius * (1 + event.deltaY * 0.001), 3.2, 10)).add(target);
    }
    camera.lookAt(target);
  }, { passive: true });
}

function initRenderer() {
  try {
    makeScene();
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(Math.max(1, viewport.clientWidth), Math.max(1, viewport.clientHeight), false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.setAttribute('data-testid', 'render-canvas');
    renderer.domElement.setAttribute('aria-label', '3D character viewport');
    renderer.domElement.tabIndex = 0;
    viewport.prepend(renderer.domElement);
    loadingNode.hidden = true;
    errorNode.hidden = true;
    readyNode.hidden = false;
    viewport.dataset.rendererReady = 'true';
    setupCameraOrbit();
    resizeObserver = new ResizeObserver(resizeRenderer);
    resizeObserver.observe(viewport);
    window.addEventListener('resize', resizeRenderer);
    applyPose(currentPose);
    window.__RIGLAB__ = Object.freeze({
      getState: () => ({ rendererReady: Boolean(renderer), selectedJoint, currentFrame, keyframes: keyframes.length, playing }),
      exportAnimation: () => structuredClone(window.__RIGLAB_LAST_EXPORT__ ?? {
        schemaVersion: 1, fps: FPS, durationFrames: DURATION, channels: CHANNELS, keyframes
      })
    });
    render();
  } catch (error) {
    loadingNode.hidden = true;
    readyNode.hidden = true;
    errorNode.hidden = false;
    errorNode.textContent = `3D renderer could not start: ${error instanceof Error ? error.message : String(error)}. Try a browser with WebGL enabled.`;
    viewport.dataset.rendererReady = 'false';
    console.error('RigLab renderer initialization failed:', error);
  }
}

document.querySelectorAll('[data-joint]').forEach((button) => {
  button.addEventListener('click', () => selectJoint(button.dataset.joint));
});
angleInput.addEventListener('input', () => {
  try {
    setJointRotation(selectedJoint, safeNumber(angleInput.value, LABELS[selectedJoint], ...JOINT_RANGES[selectedJoint]));
    updateInspector();
  } catch (error) {
    showStatus(error instanceof Error ? error.message : 'Invalid joint value.', 'error');
  }
});
timelineInput.addEventListener('input', () => {
  playing = false;
  playToggle.innerHTML = '▶ <span>Play</span>';
  playToggle.setAttribute('aria-label', 'Play animation');
  playState.textContent = 'Paused';
  setFrame(timelineInput.value);
});
$('#add-keyframe').addEventListener('click', () => {
  try { addOrUpdateKeyframe(); } catch (error) { showStatus(error.message, 'error'); }
});
$('#walk-preset').addEventListener('click', createWalkCycle);
playToggle.addEventListener('click', () => togglePlayback());
$('#previous-frame').addEventListener('click', () => { playing = false; setFrame(currentFrame - 1); });
$('#next-frame').addEventListener('click', () => { playing = false; setFrame(currentFrame + 1); });
$('#export-json').addEventListener('click', exportAnimation);
$('#import-file').addEventListener('change', (event) => importAnimation(event.target.files?.[0]));

window.addEventListener('pagehide', () => {
  disposed = true;
  if (animationFrameId) window.cancelAnimationFrame(animationFrameId);
  resizeObserver?.disconnect();
  window.removeEventListener('resize', resizeRenderer);
  renderer?.dispose();
}, { once: true });

updateKeyframeUi();
setFrame(0, { sample: false });
initRenderer();
