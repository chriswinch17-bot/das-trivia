/* Das Trivia: the 3D cutscenes (owner's request, 2026-11-19).
   The same 7 moves as js/cutscene.js (grab the ball, crossover, layup, floater, free throw, three, poster dunk),
   drawn in real 3D with Three.js (a free 3D library, loaded from cdnjs only on the trivia page). The player is a
   bobblehead with the EquipoGPT host's face; the defender wears red.
   If 3D can't run (old phone, no WebGL, the library didn't load, reduced motion) the flat cutscene plays instead.
   Add ?flat to the address to force the flat version. */
(() => {
  "use strict";

  const THREE_URL = "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js";
  const FACE = { image: "images/host.webp", size: 1254, centerX: 345, centerY: 275, width: 400 };
  const params = new URLSearchParams(location.search);
  const flat = window.Cutscene;
  if (!flat || params.has("flat") || params.get("mode") !== "trivia") return;

  let ready = false, faceCanvas = null;
  const RIM = { x: 6.85, y: 3.05, z: 0 };

  // load the library and the face picture as soon as the trivia page opens, so the first cutscene is instant
  function preload() {
    const test = document.createElement("canvas");
    if (!(test.getContext("webgl") || test.getContext("experimental-webgl"))) return;
    const s = document.createElement("script");
    s.src = THREE_URL;
    s.crossOrigin = "anonymous";
    s.onload = () => { ready = Boolean(window.THREE); };
    document.head.append(s);
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = c.height = 256;
      const x = c.getContext("2d");
      x.beginPath(); x.arc(128, 128, 124, 0, Math.PI * 2); x.closePath(); x.clip();
      const scale = FACE.size / img.naturalWidth;
      x.drawImage(img, (FACE.centerX - FACE.width / 2) / scale, (FACE.centerY - FACE.width / 2) / scale, FACE.width / scale, FACE.width / scale, 0, 0, 256, 256);
      x.lineWidth = 8; x.strokeStyle = "#1d3a8a"; x.stroke();
      faceCanvas = c;
    };
    img.src = FACE.image;
  }

  /* ---------- little helpers ---------- */
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const seg = (t, a, b) => clamp((t - a) / (b - a));
  // a ball flight from p to q with an arc this high above the higher end
  function arc(p, q, h, t) {
    const y = lerp(p.y, q.y, t) + h * 4 * t * (1 - t);
    return { x: lerp(p.x, q.x, t), y, z: lerp(p.z, q.z, t) };
  }

  /* ---------- building the court and the players ---------- */
  function courtTexture() {
    const c = document.createElement("canvas");
    c.width = 1024; c.height = 512;
    const x = c.getContext("2d");
    for (let i = 0; i < 32; i++) { x.fillStyle = i % 2 ? "#c98d55" : "#d29a62"; x.fillRect(0, i * 16, 1024, 16); }
    x.strokeStyle = "rgba(255,255,255,.9)"; x.lineWidth = 6;
    const u = 1024 / 20, cx = (v) => (v + 6) * u, cz = (v) => 256 + v * u;   // world x -6..14, z -5..5
    x.strokeRect(cx(4.9), cz(-2.45), cx(7.6) - cx(4.9) + 300, 4.9 * u);       // the key
    x.beginPath(); x.arc(cx(4.9), cz(0), 1.8 * u, Math.PI / 2, -Math.PI / 2); x.stroke();
    x.beginPath(); x.arc(cx(RIM.x), cz(0), 6.75 * u, Math.PI * 0.62, Math.PI * 1.38); x.stroke();   // three-point line
    x.fillStyle = "rgba(29,58,138,.55)"; x.fillRect(cx(4.9), cz(-2.45), 300, 4.9 * u);
    return c;
  }

  function makePlayer(THREE, hero) {
    const skin = new THREE.MeshStandardMaterial({ color: hero ? 0xe8b990 : 0x9c6b47, roughness: 0.7 });
    const jersey = new THREE.MeshStandardMaterial({ color: hero ? 0x1d3a8a : 0xc93636, roughness: 0.6 });
    const shorts = new THREE.MeshStandardMaterial({ color: hero ? 0x16295f : 0x8f2424, roughness: 0.6 });
    const shoe = new THREE.MeshStandardMaterial({ color: hero ? 0xff7a1a : 0xffffff, roughness: 0.5 });
    const cyl = (r1, r2, h, m) => { const g = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, 12), m); g.castShadow = true; return g; };
    const root = new THREE.Group();            // feet at y = 0
    const hips = new THREE.Group(); hips.position.y = 0.95; root.add(hips);
    const torso = cyl(0.2, 0.17, 0.62, jersey); torso.position.y = 0.33; hips.add(torso);
    const short = cyl(0.19, 0.2, 0.24, shorts); short.position.y = 0.02; hips.add(short);
    const neck = new THREE.Group(); neck.position.y = 0.72; hips.add(neck);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), skin); head.position.y = 0.12; head.castShadow = true; neck.add(head);
    const limb = (side, upperLen, lowerLen, mat, endMat, y, x) => {
      const top = new THREE.Group(); top.position.set(x, y, side * 0.12);
      const up = cyl(0.065, 0.055, upperLen, mat); up.position.y = -upperLen / 2; top.add(up);
      const joint = new THREE.Group(); joint.position.y = -upperLen; top.add(joint);
      const low = cyl(0.055, 0.045, lowerLen, mat); low.position.y = -lowerLen / 2; joint.add(low);
      const end = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), endMat); end.position.y = -lowerLen; end.castShadow = true; joint.add(end);
      return { top, joint, end };
    };
    const legs = [-1, 1].map((s) => { const l = limb(s, 0.48, 0.47, skin, shoe, 0, 0); hips.add(l.top); return l; });
    const arms = [-1, 1].map((s) => { const a = limb(s * 1.75, 0.3, 0.28, skin, skin, 0.58, 0); a.top.position.z = s * 0.25; hips.add(a.top); return a; });
    let face = null;
    if (hero && faceCanvas) {
      const tex = new THREE.CanvasTexture(faceCanvas);
      face = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: true }));
      face.scale.set(0.5, 0.5, 1);                // bobblehead
      face.position.y = 0.16;
      neck.add(face);
      head.visible = false;
    } else if (!hero) {
      const hair = new THREE.Mesh(new THREE.SphereGeometry(0.155, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1a120c }));
      hair.position.y = 0.13; neck.add(hair);
    }
    return { root, hips, legs, arms, neck, hand: arms[0].end };
  }

  // pose a player: running phase, crouch (0..1), arm raise (0..1 each), lean
  function pose(p, { run = null, crouch = 0, armL = 0, armR = 0, lean = 0, kick = 0 } = {}) {
    p.hips.position.y = 0.95 - crouch * 0.28;
    p.hips.rotation.z = -lean;
    const swing = run == null ? 0 : Math.sin(run) * 0.75;
    p.legs[0].top.rotation.z = swing + crouch * 0.6 + kick;
    p.legs[1].top.rotation.z = -swing + crouch * 0.6 - kick * 0.4;
    p.legs[0].joint.rotation.z = -Math.max(0, -Math.sin(run || 0)) * 0.9 - crouch * 1.1 - kick * 1.2;
    p.legs[1].joint.rotation.z = -Math.max(0, Math.sin(run || 0)) * 0.9 - crouch * 1.1;
    p.arms[0].top.rotation.z = -swing * 0.8 + armL * 2.9;
    p.arms[1].top.rotation.z = swing * 0.8 + armR * 2.9;
    p.arms[0].joint.rotation.z = armL > 0.5 ? 0.2 : 0.6;
    p.arms[1].joint.rotation.z = armR > 0.5 ? 0.2 : 0.6;
  }

  /* ---------- the scenes: each returns its length in seconds and an update(t) ---------- */
  function scenes(w) {
    const { hero, def, ball, cam, look, rim, net, boom } = w;
    const at = (o, x, y = 0, z = 0) => o.root.position.set(x, y, z);
    const holdBall = (o) => { const p = new w.THREE.Vector3(); o.hand.getWorldPosition(p); ball.position.set(p.x + 0.06, p.y, p.z); };
    const dribble = (o, t, side = 1) => { const p = new w.THREE.Vector3(); o.hips.getWorldPosition(p); const h = Math.abs(Math.sin(t * 9)); ball.position.set(p.x + 0.35, 0.12 + h * 0.85, side * 0.32); };
    const sink = (t, from) => {                   // through the net and down to the floor
      const drop = clamp(t);
      ball.position.set(RIM.x + 0.02, lerp(RIM.y - 0.05, 0.12, drop * drop), 0);
      net.scale.y = 1 + Math.sin(drop * Math.PI) * 0.35;
      if (from) ball.position.x = lerp(from, RIM.x + 0.25, drop);
    };
    const camAt = (x, y, z, lx, ly, lz) => { cam.position.set(x, y, z); look.set(lx, ly, lz); };
    return {
      1: { len: 2.6, update(t) {                  // grab the ball
        const roll = seg(t, 0, 1.3), pick = seg(t, 1.2, 1.7), lift = seg(t, 1.7, 2.3);
        at(hero, 0, 0, 0); at(def, 2.6, 0, 0.4); def.root.rotation.y = Math.PI;
        pose(def, { crouch: 0.35, armL: 0.25, armR: 0.25 });
        if (pick < 1) { ball.position.set(lerp(-2.5, 0.45, ease(roll)), 0.12, 0); ball.rotation.z = -roll * 12; }
        pose(hero, { crouch: Math.sin(pick * Math.PI) * 0.8, armL: lift * 0.9 + pick * 0.1 });
        if (pick >= 1) holdBall(hero);
        hero.root.rotation.y = 0;
        camAt(lerp(-1.2, 0.8, t / 2.6), 1.6, 4.4, 0.4, 0.9, 0);
        if (t > 1.9) boom("GOT IT");
      } },
      2: { len: 2.9, update(t) {                  // crossover, defender falls
        const go = seg(t, 1.5, 2.3), fall = seg(t, 1.6, 2.4);
        at(hero, lerp(0, 2.6, ease(go)), 0, lerp(0, -0.5, go));
        pose(hero, { run: go > 0 ? t * 14 : null, crouch: 0.25, armL: 0.1, lean: go * 0.25 });
        dribble(hero, t, t < 1.5 ? (Math.sin(t * 4.5) > 0 ? 1 : -1) : -1);
        at(def, 1.4, 0, 0.1); def.root.rotation.y = Math.PI;
        def.root.rotation.x = -fall * 1.45; def.root.position.y = fall * 0.05;
        pose(def, { crouch: 0.4 * (1 - fall), armL: 0.3 + fall * 0.4, armR: 0.3 });
        camAt(0.7, 1.2, 3.6, 1.2, 0.8, 0);
        if (t > 2.0) boom("ANKLES!");
      } },
      3: { len: 3.0, update(t) {                  // layup
        const runT = seg(t, 0, 1.4), jump = seg(t, 1.4, 2.2), lay = seg(t, 1.7, 2.1);
        at(def, 4.2, 0, 1.1); def.root.rotation.y = Math.PI * 0.8; pose(def, { crouch: 0.3, armL: 0.6 });
        const x = lerp(2, 5.9, ease(runT)) + jump * 0.5;
        at(hero, x, Math.sin(jump * Math.PI) * 0.95, 0);
        pose(hero, { run: runT < 1 ? t * 13 : null, armL: jump > 0 ? 0.95 : 0.1, kick: jump > 0 ? 0.5 : 0 });
        if (lay <= 0) holdBall(hero);
        else if (lay < 1) { const s = new w.THREE.Vector3(); hero.hand.getWorldPosition(s); const p = arc(s, { x: RIM.x, y: RIM.y + 0.1, z: 0 }, 0.25, lay); ball.position.set(p.x, p.y, p.z); }
        else sink(seg(t, 2.1, 2.6));
        camAt(4.2, 1.9, 4.6, 5.6, 2.0, 0);
        if (t > 2.2) boom("BUCKET");
      } },
      4: { len: 3.0, update(t) {                  // floater over the defender
        const runT = seg(t, 0, 1.1), jump = seg(t, 1.1, 1.9), fly = seg(t, 1.45, 2.35);
        at(def, 5.6, 0, 0.4); def.root.rotation.y = Math.PI; pose(def, { crouch: 0.2, armL: Math.sin(jump * Math.PI), armR: 0.4 });
        def.root.position.y = Math.sin(jump * Math.PI) * 0.4;
        at(hero, lerp(1.6, 4.6, ease(runT)), Math.sin(jump * Math.PI) * 0.6, 0);
        pose(hero, { run: runT < 1 ? t * 13 : null, armL: jump > 0 ? 0.9 : 0.1 });
        if (fly <= 0) holdBall(hero);
        else if (fly < 1) { const p = arc({ x: 4.7, y: 2.5, z: 0 }, { x: RIM.x, y: RIM.y + 0.05, z: 0 }, 1.5, fly); ball.position.set(p.x, p.y, p.z); }
        else sink(seg(t, 2.35, 2.8));
        camAt(3.2, 2.2, 5.0, 5.2, 2.2, 0);
        if (t > 2.4) boom("TEARDROP");
      } },
      5: { len: 3.2, update(t) {                  // free throw
        const shoot = seg(t, 1.3, 1.6), fly = seg(t, 1.55, 2.6);
        at(hero, 2.4, Math.sin(shoot * Math.PI) * 0.15, 0); at(def, 4.4, 0, 1.6); def.root.rotation.y = -Math.PI / 2; pose(def, {});
        pose(hero, { crouch: t < 1.3 ? 0.2 + Math.abs(Math.sin(t * 6)) * 0.1 : 0.1, armL: shoot > 0 ? 1 : 0.2 });
        if (t < 1.3) dribble(hero, t, 1);
        else if (fly <= 0) holdBall(hero);
        else if (fly < 1) { const p = arc({ x: 2.55, y: 2.45, z: 0 }, { x: RIM.x, y: RIM.y + 0.05, z: 0 }, 1.3, fly); ball.position.set(p.x, p.y, p.z); }
        else sink(seg(t, 2.6, 3.0));
        camAt(1.0, 2.0, 3.8, 4.4, 2.2, 0);
        if (t > 2.7) boom("SWISH");
      } },
      6: { len: 3.4, update(t) {                  // three-pointer
        const shoot = seg(t, 0.8, 1.15), fly = seg(t, 1.1, 2.6);
        at(hero, 0.1, Math.sin(shoot * Math.PI) * 0.45, 0);
        at(def, 1.3, Math.sin(seg(t, 0.9, 1.4) * Math.PI) * 0.35, 0.1); def.root.rotation.y = Math.PI;
        pose(def, { armL: seg(t, 0.8, 1.2), armR: seg(t, 0.8, 1.2) });
        pose(hero, { crouch: t < 0.8 ? 0.3 : 0, armL: shoot > 0 ? 1 : 0.3 });
        if (fly <= 0) holdBall(hero);
        else if (fly < 1) { const p = arc({ x: 0.3, y: 2.6, z: 0 }, { x: RIM.x, y: RIM.y + 0.05, z: 0 }, 2.3, fly); ball.position.set(p.x, p.y, p.z); }
        else sink(seg(t, 2.6, 3.0));
        const follow = clamp((t - 1.1) / 1.5);
        // the camera pulls back and tracks the ball through the air
        camAt(lerp(-1.6, 1.6, ease(follow)), lerp(1.8, 2.8, follow), lerp(5.0, 7.2, follow),
          lerp(1.0, ball.position.x, follow * 0.8), lerp(1.5, ball.position.y * 0.75 + 0.4, follow), 0);
        if (t > 2.7) boom("SPLASH 💦");
      } },
      7: { len: 4.2, update(t) {                  // poster dunk, slow motion at the top
        const slow = t < 1.6 ? t : t < 2.6 ? 1.6 + (t - 1.6) * 0.35 : 1.95 + (t - 2.6);   // game time
        const runT = seg(slow, 0, 1.2), jump = seg(slow, 1.2, 2.25), slam = seg(slow, 1.95, 2.15);
        at(def, 6.0, Math.sin(seg(slow, 1.25, 2.0) * Math.PI) * 0.45, 0.45);   // a step to the side, so the dunk goes over his shoulder
        def.root.rotation.y = Math.PI;
        const knocked = seg(slow, 2.1, 2.6);
        def.root.rotation.x = knocked * 1.5;
        pose(def, { armL: 1 - knocked, armR: 0.8 - knocked * 0.5 });
        const x = lerp(1.6, 5.3, ease(runT)) + jump * 1.35;
        at(hero, x, Math.sin(clamp(jump * 1.15) * Math.PI) * 1.75, 0);
        pose(hero, { run: runT < 1 ? slow * 13 : null, armL: jump > 0 ? 1 : 0.15, kick: jump > 0 ? 0.8 : 0, lean: -jump * 0.2 });
        if (slam < 1) holdBall(hero);
        else sink(seg(slow, 2.15, 2.5));
        rim.rotation.z = slam > 0 && slam < 1 ? 0 : Math.sin(seg(slow, 2.15, 2.9) * Math.PI * 4) * 0.12 * (1 - seg(slow, 2.15, 2.9));
        const shake = slam >= 1 && slow < 2.5 ? (Math.random() - 0.5) * 0.12 : 0;
        camAt(lerp(3.0, 5.0, ease(seg(t, 0, 2.6))) + shake, lerp(1.6, 3.1, seg(t, 0, 2.6)) + shake, lerp(5.0, 3.0, seg(t, 0, 2.6)), lerp(4.5, RIM.x - 0.3, seg(t, 0, 2.6)), lerp(1.2, 2.8, seg(t, 0, 2.6)), 0);
        if (slow > 2.15) boom("POSTERIZED!", true);
      } },
    };
  }

  function play3D(step, done) {
    const THREE = window.THREE;
    const host = document.getElementById("scene");
    host.innerHTML = "";
    const width = host.clientWidth || 340, height = Math.round(width * 0.66);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    renderer.domElement.className = "scene3d";
    host.append(renderer.domElement);
    const label = document.createElement("div");
    label.className = "boom3d";
    host.append(label);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f1420);
    scene.fog = new THREE.Fog(0x0f1420, 9, 22);
    scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x3a2410, 0.75));
    const sun = new THREE.DirectionalLight(0xffffff, 0.9);
    sun.position.set(3, 8, 5); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -8, right: 10, top: 6, bottom: -6 });
    scene.add(sun);
    const spot = new THREE.PointLight(0xff9a3d, 0.6, 12); spot.position.set(RIM.x, 5, 2); scene.add(spot);

    const floorTex = new THREE.CanvasTexture(courtTexture());
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 10), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.55 }));
    floor.rotation.x = -Math.PI / 2; floor.position.x = 4; floor.receiveShadow = true; scene.add(floor);
    // the hoop
    const metal = new THREE.MeshStandardMaterial({ color: 0x9aa6c0, metalness: 0.6, roughness: 0.4 });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 3.6, 10), metal); pole.position.set(7.95, 1.8, 0); scene.add(pole);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.08, 0.08), metal); arm.position.set(7.65, 3.4, 0); scene.add(arm);
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.05, 1.8), new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 }));
    board.position.set(7.3, 3.45, 0); board.castShadow = true; scene.add(board);
    const square = new THREE.Mesh(new THREE.PlaneGeometry(0.59, 0.45), new THREE.MeshBasicMaterial({ color: 0xff7a1a, wireframe: true }));
    square.rotation.y = -Math.PI / 2; square.position.set(7.27, 3.3, 0); scene.add(square);
    const rim = new THREE.Group(); rim.position.set(7.3, RIM.y, 0); scene.add(rim);     // pivots at the board, shakes on the dunk
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.23, 0.02, 8, 24), new THREE.MeshStandardMaterial({ color: 0xff5a1a, metalness: 0.4 }));
    ring.rotation.x = Math.PI / 2; ring.position.x = RIM.x - 7.3; rim.add(ring);
    const net = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.14, 0.45, 12, 3, true), new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true }));
    net.geometry.translate(0, -0.225, 0); net.position.x = RIM.x - 7.3; rim.add(net);
    // the ball: orange with seams
    const bc = document.createElement("canvas"); bc.width = 128; bc.height = 64;
    const bx = bc.getContext("2d"); bx.fillStyle = "#e8742a"; bx.fillRect(0, 0, 128, 64);
    bx.strokeStyle = "#2a1608"; bx.lineWidth = 3; bx.beginPath(); bx.moveTo(0, 32); bx.lineTo(128, 32); bx.moveTo(64, 0); bx.lineTo(64, 64);
    bx.moveTo(32, 0); bx.quadraticCurveTo(10, 32, 32, 64); bx.moveTo(96, 0); bx.quadraticCurveTo(118, 32, 96, 64); bx.stroke();
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.12, 20, 14), new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(bc), roughness: 0.6 }));
    ball.castShadow = true; scene.add(ball);

    const hero = makePlayer(THREE, true), def = makePlayer(THREE, false);
    scene.add(hero.root, def.root);
    const cam = new THREE.PerspectiveCamera(45, width / height, 0.1, 60);
    const look = new THREE.Vector3();
    let shown = "";
    const boom = (text, big) => {
      if (shown === text) return;
      shown = text;
      label.textContent = text;
      label.className = "boom3d on" + (big ? " big" : "");
    };
    const S = scenes({ THREE, hero, def, ball, cam, look, rim, net, boom })[step];

    let start = null, raf = null, finished = false;
    const end = () => {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(raf);
      renderer.dispose();
      done();
    };
    const freeze = params.has("test") ? Number(params.get("freeze")) : 0;   // testing: hold one moment, e.g. &freeze=1.7
    const frame = (now) => {
      if (start == null) start = now;
      const t = freeze > 0 ? freeze : (now - start) / 1000;
      if (freeze > 0) { S.update(t); cam.lookAt(look); renderer.render(scene, cam); raf = requestAnimationFrame(frame); return; }
      S.update(Math.min(t, S.len));
      cam.lookAt(look);
      renderer.render(scene, cam);
      if (t < S.len + 0.6) raf = requestAnimationFrame(frame);
      else end();
    };
    raf = requestAnimationFrame(frame);
    document.getElementById("btn-skip").onclick = end;
  }

  // Take over Cutscene.play: 3D when possible, otherwise the flat version
  window.Cutscene = {
    ...flat,
    // testing (?test&scene=7): wait up to 6 seconds for the 3D library before the first scene
    whenReady(cb) {
      const t0 = Date.now();
      const check = () => (ready && faceCanvas) || Date.now() - t0 > 6000 ? cb() : setTimeout(check, 100);
      check();
    },
    play(step, done) {
      step = Math.max(1, Math.min(7, step));
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!ready || reduce) return flat.play(step, done);
      try {
        // the header (step x of 7, the move's name, the progress pips) is drawn by the flat version's code
        document.getElementById("cut-step").textContent = `Step ${step} of 7`;
        document.getElementById("cut-title").textContent = flat.names[step - 1];
        document.getElementById("screen-cutscene").classList.toggle("is-dunk", step === 7);
        const pips = document.getElementById("cut-steps");
        pips.replaceChildren();
        for (let i = 1; i <= 7; i++) {
          const pip = document.createElement("span");
          pip.className = i < step ? "done" : i === step ? "now" : "";
          pips.append(pip);
        }
        play3D(step, done);
      } catch (e) {
        flat.play(step, done);
      }
    },
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", preload);
  else preload();
})();
