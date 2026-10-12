// Cases about the page around the game: HTML overlays, canvas text, keyboard and mouse input, timers,
// localStorage and Web Audio.

// An HTML panel with a button, a progress bar and live text, and canvas-drawn text on a sprite.
export function ui({THREE, scene}) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x303030, 1.5));
  const panel = document.createElement('div');
  panel.style.cssText = 'position:fixed;right:16px;top:60px;width:260px;padding:12px;background:rgba(20,30,40,0.85);border:1px solid #4b6b7c;font:15px system-ui,sans-serif;color:#e8eef2';
  panel.innerHTML = '<div style="font-weight:600;margin-bottom:8px">Ship status</div><div id="ui-hull">Hull 100%</div><div style="height:10px;background:#203040;margin:8px 0"><div id="ui-bar" style="height:100%;width:100%;background:#40c080"></div></div><button id="ui-repair" style="padding:6px 12px">Repair</button>';
  document.body.append(panel);
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const ctx = c.getContext('2d');
  const label = new THREE.Sprite(new THREE.SpriteMaterial({map: new THREE.CanvasTexture(c)}));
  label.scale.set(4, 1, 1);
  label.position.set(-2, 1.5, 0);
  scene.add(label);
  const ship = new THREE.Mesh(new THREE.ConeGeometry(0.6, 2, 16), new THREE.MeshStandardMaterial({color: 0x80a0c0}));
  ship.rotation.z = -Math.PI / 2; ship.position.set(-2, -0.5, 0);
  scene.add(ship);
  let hull = 100, shown = -1;
  document.getElementById('ui-repair').addEventListener('click', () => { hull = 100; });
  return (dt, time) => {
    hull = Math.max(20, hull - dt * 10);
    const h = Math.round(hull);
    if (h !== shown) {
      shown = h;
      document.getElementById('ui-hull').textContent = `Hull ${h}%`;
      document.getElementById('ui-bar').style.width = `${h}%`;
      ctx.clearRect(0, 0, 256, 64);
      ctx.fillStyle = '#ffffff'; ctx.font = 'bold 36px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(`HULL ${h}`, 128, 32);
      label.material.map.needsUpdate = true;
    }
    ship.rotation.x = time;
  };
}

// Keyboard and mouse: arrow keys move a cube, a click on the canvas changes its colour.
export function input({THREE, scene}) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x303030, 1.5));
  const cube = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.5, 1.5), new THREE.MeshStandardMaterial({color: 0x4080ff}));
  scene.add(cube);
  const keys = new Set();
  addEventListener('keydown', e => { keys.add(e.code); if (e.code === 'ArrowRight' || e.code === 'KeyD') cube.position.x += 0.5; if (e.code === 'ArrowLeft' || e.code === 'KeyA') cube.position.x -= 0.5; });
  addEventListener('keyup', e => keys.delete(e.code));
  const status = document.createElement('div');
  status.id = 'input-status';
  status.style.cssText = 'position:fixed;left:16px;bottom:16px;font:16px monospace;color:#e8eef2';
  document.body.append(status);
  let clicks = 0;
  addEventListener('pointerdown', () => { clicks++; cube.material.color.setHSL((clicks * 0.17) % 1, 0.7, 0.55); });
  return () => {
    status.textContent = `x ${cube.position.x.toFixed(2)}  clicks ${clicks}  keys ${[...keys].join(',')}`;
  };
}

// setTimeout, setInterval and requestAnimationFrame drive what is drawn; localStorage keeps a counter.
export function timers({THREE, scene}) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x303030, 1.5));
  const runs = Number(localStorage.getItem('jsgb-suite-runs') ?? 0) + 1;
  localStorage.setItem('jsgb-suite-runs', String(runs));
  const stored = localStorage.getItem('jsgb-suite-runs') === String(runs);
  const boxes = [];
  for (let i = 0; i < 8; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), new THREE.MeshStandardMaterial({color: 0x404040}));
    b.position.set(-3.5 + i, 0, 0);
    scene.add(b); boxes.push(b);
  }
  let ticks = 0;
  const interval = setInterval(() => { boxes[ticks % 8].material.color.set(0x40c080); ticks++; if (ticks >= 8) clearInterval(interval); }, 250);
  setTimeout(() => { boxes.forEach(b => { b.position.y = 1; }); }, 1500);
  const text = document.createElement('div');
  text.style.cssText = 'position:fixed;left:16px;bottom:16px;font:16px monospace;color:#e8eef2';
  text.textContent = `localStorage ${stored ? 'works' : 'failed'}`;
  document.body.append(text);
  let frames = 0;
  return () => { frames++; boxes[0].rotation.y = frames * 0.02; };
}

// Web Audio: an oscillator through a PannerNode that moves with a sphere, and a gain envelope.
export function audio({THREE, scene, camera}) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x303030, 1.5));
  const listener = new THREE.AudioListener();
  camera.add(listener);
  scene.add(camera);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.6, 24, 12), new THREE.MeshStandardMaterial({color: 0xffa040}));
  scene.add(ball);
  const sound = new THREE.PositionalAudio(listener);
  const osc = listener.context.createOscillator();
  osc.frequency.value = 220;
  sound.setNodeSource(osc);
  sound.setRefDistance(2);
  sound.setVolume(0.2);
  osc.start();
  ball.add(sound);
  const status = document.createElement('div');
  status.style.cssText = 'position:fixed;left:16px;bottom:16px;font:16px monospace;color:#e8eef2';
  document.body.append(status);
  return (dt, time) => {
    ball.position.x = Math.sin(time) * 4;
    status.textContent = `audio ${listener.context.state} at ${ball.position.x.toFixed(1)}`;
  };
}

// Form controls built in code: a <select> filled with add(new Option()), an option put first with options.add(o, 0),
// one removed by index and the value set. The text under it shows what the select reports.
export function forms({THREE, scene}) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x303030, 1.5));
  const panel = document.createElement('div');
  panel.style.cssText = 'position:fixed;left:16px;top:60px;width:360px;padding:12px;background:rgba(20,30,40,0.85);border:1px solid #4b6b7c;font:15px system-ui,sans-serif;color:#e8eef2';
  const select = document.createElement('select');
  select.style.cssText = 'font:15px system-ui,sans-serif;padding:4px;margin-bottom:10px';
  for (const [text, value] of [['Railgun', 'rail'], ['Coilgun', 'coil'], ['Missile', 'missile'], ['Torpedo', 'torpedo']]) select.add(new Option(text, value));
  select.options.add(new Option('Point defence', 'pd'), 0);
  select.remove(4);
  select.value = 'coil';
  const out = document.createElement('div');
  const show = () => {
    const o = select.options[select.selectedIndex];
    out.textContent = `${select.length} options, #${select.selectedIndex} ${select.value} (${o.text}), first ${select.item(0).value}, ${select.type}`;
  };
  select.addEventListener('change', show);
  show();
  panel.append(select, out);
  document.body.append(panel);
  const cube = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.5, 1.5), new THREE.MeshStandardMaterial({color: 0xc08040}));
  cube.position.set(2, 0, 0);
  scene.add(cube);
  return dt => { cube.rotation.y += dt; };
}
