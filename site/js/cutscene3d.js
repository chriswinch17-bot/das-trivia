/* Das Trivia: the 3D cutscenes (owner's request, 2026-11-19).
   Seven moves, one per correct answer: 1 crossover, 2 layup, 3 floater, 4 free throw, 5 three-pointer, 6 dunk,
   7 (a perfect game) a POSTERIZER over two defenders, then a celebration dance, confetti and the crowd going wild.
   Drawn in real 3D with Three.js (free; loaded from cdnjs only on the trivia page). The player is a bobblehead with
   the EquipoGPT host's face; defenders wear red; a crowd fills the stands.
   Smooth by design: poses glide toward their targets instead of snapping, shots leave from the player's real hand,
   and the camera eases between positions.
   If 3D can't run (no WebGL, the library didn't load, reduced motion) the flat cutscene plays instead; ?flat forces it.
   Testing: ?mode=trivia&test&scene=7 plays one scene; add &freeze=2.2 to hold that moment. */
(() => {
  "use strict";

  const THREE_URL = "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js";
  const FACE = { image: "images/host.webp", size: 1254, centerX: 345, centerY: 275, width: 400 };
  const params = new URLSearchParams(location.search);
  const flat = window.Cutscene;
  if (!flat || params.has("flat") || params.get("mode") !== "trivia") return;

  let ready = false, faceCanvas = null;
  const RIM = { x: 6.85, y: 3.05 };

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
      c.width = c.height = 512;
      const x = c.getContext("2d");
      x.beginPath(); x.arc(256, 256, 248, 0, Math.PI * 2); x.closePath(); x.clip();
      const scale = FACE.size / img.naturalWidth;
      x.drawImage(img, (FACE.centerX - FACE.width / 2) / scale, (FACE.centerY - FACE.width / 2) / scale, FACE.width / scale, FACE.width / scale, 0, 0, 512, 512);
      x.lineWidth = 14; x.strokeStyle = "#1d3a8a"; x.stroke();
      faceCanvas = c;
    };
    img.src = FACE.image;
  }

  /* ---------- helpers ---------- */
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);      // smooth start and stop
  const seg = (t, a, b) => clamp((t - a) / (b - a));
  const smooth = (t, a, b) => ease(seg(t, a, b));
  function arc(p, q, h, t) {
    return { x: lerp(p.x, q.x, t), y: lerp(p.y, q.y, t) + h * 4 * t * (1 - t), z: lerp(p.z || 0, q.z || 0, t) };
  }

  /* ---------- the court ---------- */
  function courtTexture() {
    const c = document.createElement("canvas");
    c.width = 2048; c.height = 1024;
    const x = c.getContext("2d");
    for (let i = 0; i < 64; i++) { x.fillStyle = i % 2 ? "#c98d55" : "#d39b63"; x.fillRect(0, i * 16, 2048, 16); }
    for (let i = 0; i < 400; i++) { x.fillStyle = "rgba(90,50,20,.05)"; x.fillRect(Math.random() * 2048, Math.random() * 1024, 60 + Math.random() * 120, 2); }
    x.strokeStyle = "rgba(255,255,255,.92)"; x.lineWidth = 10;
    const u = 2048 / 20, cx = (v) => (v + 6) * u, cz = (v) => 512 + v * u;
    x.fillStyle = "rgba(29,58,138,.6)"; x.fillRect(cx(4.9), cz(-2.45), 600, 4.9 * u);
    x.strokeRect(cx(4.9), cz(-2.45), 600, 4.9 * u);
    x.beginPath(); x.arc(cx(4.9), cz(0), 1.8 * u, Math.PI / 2, -Math.PI / 2); x.stroke();
    x.beginPath(); x.arc(cx(RIM.x), cz(0), 6.75 * u, Math.PI * 0.62, Math.PI * 1.38); x.stroke();
    x.beginPath(); x.arc(cx(-2.2), cz(0), 1.8 * u, 0, Math.PI * 2); x.stroke();
    return c;
  }

  /* ---------- players: a rig whose pose glides toward a target ---------- */
  function makePlayer(THREE, look) {
    const mat = (color, rough = 0.6) => new THREE.MeshStandardMaterial({ color, roughness: rough });
    const skin = mat(look.skin, 0.7), jersey = mat(look.jersey), shorts = mat(look.shorts), shoe = mat(look.shoe, 0.4);
    const cyl = (r1, r2, h, m) => { const g = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, 20), m); g.castShadow = true; return g; };
    const ball = (r, m) => { const g = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 16), m); g.castShadow = true; return g; };
    const root = new THREE.Group();
    const hips = new THREE.Group(); hips.position.y = 0.95; root.add(hips);
    const torso = cyl(0.21, 0.17, 0.62, jersey); torso.position.y = 0.33; hips.add(torso);
    const chest = ball(0.21, jersey); chest.scale.set(1, 0.45, 1); chest.position.y = 0.63; hips.add(chest);
    const short = cyl(0.19, 0.21, 0.26, shorts); short.position.y = 0.01; hips.add(short);
    const neck = new THREE.Group(); neck.position.y = 0.72; hips.add(neck);
    const head = ball(0.15, skin); head.position.y = 0.13; neck.add(head);
    const limb = (z, y, upperLen, lowerLen, m, endMat, endR) => {
      const top = new THREE.Group(); top.position.set(0, y, z);
      const up = cyl(0.068, 0.056, upperLen, m); up.position.y = -upperLen / 2; top.add(up);
      const joint = new THREE.Group(); joint.position.y = -upperLen; top.add(joint);
      const knee = ball(0.058, m); joint.add(knee);
      const low = cyl(0.056, 0.046, lowerLen, m); low.position.y = -lowerLen / 2; joint.add(low);
      const end = ball(endR, endMat); end.position.y = -lowerLen; joint.add(end);
      return { top, joint, end };
    };
    const legs = [-1, 1].map((s) => { const l = limb(s * 0.11, 0, 0.48, 0.47, skin, shoe, 0.07); l.end.scale.set(1.6, 0.7, 1); hips.add(l.top); return l; });
    const arms = [-1, 1].map((s) => { const a = limb(s * 0.27, 0.58, 0.3, 0.28, skin, skin, 0.055); hips.add(a.top); return a; });
    if (look.face && faceCanvas) {
      const tex = new THREE.CanvasTexture(faceCanvas);
      const face = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex }));
      face.scale.set(0.52, 0.52, 1); face.position.y = 0.17; neck.add(face);
      head.visible = false;
    } else {
      const hair = new THREE.Mesh(new THREE.SphereGeometry(0.155, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x1a120c));
      hair.position.y = 0.14; neck.add(hair);
    }
    const p = { root, hips, legs, arms, neck, hand: arms[0].end, phase: 0, now: null, goal: null };
    return p;
  }

  const POSE_KEYS = ["run", "crouch", "armL", "armR", "lean", "kick", "kickR", "side", "turn", "bounce"];
  function pose(p, goal) { p.goal = Object.fromEntries(POSE_KEYS.map((k) => [k, goal[k] || 0])); }
  // glide the pose toward its goal (dt in seconds); "snap" jumps straight there (first frame, frozen test frames)
  function apply(p, dt, snap) {
    if (!p.goal) pose(p, {});
    if (!p.now || snap) p.now = { ...p.goal };
    const k = 1 - Math.exp(-dt * 16);
    for (const key of POSE_KEYS) p.now[key] += (p.goal[key] - p.now[key]) * k;
    const n = p.now;
    p.phase += dt * n.run;                                    // running speed in steps per second, never jumps
    const stride = clamp(n.run / 10) * 0.8;
    const swing = Math.sin(p.phase) * stride;
    p.hips.position.y = 0.95 - n.crouch * 0.28 + Math.abs(Math.sin(p.phase)) * stride * 0.06 + n.bounce;
    p.hips.rotation.z = -n.lean;
    p.hips.rotation.x = n.side;
    p.root.rotation.y = n.turn;
    p.legs[0].top.rotation.z = swing + n.crouch * 0.6 + n.kick;
    p.legs[1].top.rotation.z = -swing + n.crouch * 0.6 + n.kickR;
    p.legs[0].joint.rotation.z = -Math.max(0, -Math.sin(p.phase)) * stride * 1.2 - n.crouch * 1.1 - n.kick * 1.3;
    p.legs[1].joint.rotation.z = -Math.max(0, Math.sin(p.phase)) * stride * 1.2 - n.crouch * 1.1 - n.kickR * 1.3;
    p.arms[0].top.rotation.z = -swing * 0.8 + n.armL * 2.9;
    p.arms[1].top.rotation.z = swing * 0.8 + n.armR * 2.9;
    p.arms[0].joint.rotation.z = lerp(0.65, 0.15, clamp(n.armL));
    p.arms[1].joint.rotation.z = lerp(0.65, 0.15, clamp(n.armR));
  }

  /* ---------- the scenes ---------- */
  function scenes(w) {
    const { THREE, hero, def, def2, ball, rim, net, boom } = w;
    const v = new THREE.Vector3();
    const at = (o, x, y = 0, z = 0) => o.root.position.set(x, y, z);
    const handPos = (o) => { o.hand.getWorldPosition(v); return { x: v.x + 0.07, y: v.y, z: v.z }; };
    const holdBall = (o) => { const h = handPos(o); ball.position.set(h.x, h.y, h.z); w.release = null; };
    // the shot leaves from wherever the hand actually was at release
    const shoot = (o, target, h, t) => {
      if (!w.release) w.release = handPos(o);
      const p = arc(w.release, target, h, t);
      ball.position.set(p.x, p.y, p.z);
      ball.rotation.z -= 0.25;
    };
    const dribble = (o, t, side) => { o.hips.getWorldPosition(v); const h = Math.abs(Math.sin(t * 8)); ball.position.set(v.x + 0.36, 0.12 + h * 0.85, v.z + side * 0.3); };
    const sink = (t) => {
      const d = clamp(t);
      ball.position.set(RIM.x + 0.02 + d * 0.15, lerp(RIM.y - 0.05, 0.12, d * d), 0);
      net.scale.y = 1 + Math.sin(d * Math.PI) * 0.4;
    };
    const RIM_IN = { x: RIM.x, y: RIM.y + 0.06, z: 0 };
    const mix = (a, b, k) => ({ x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), z: lerp(a.z, b.z, k) });
    const handOf = (o, i) => { o.arms[i].end.getWorldPosition(v); return { x: v.x + 0.05, y: v.y - 0.04, z: v.z }; };
    const SLAM_AT = { x: 6.6, y: 1.12 };             // where his hips are when the ball goes down through the rim
    // the dunker: run, take off, fly a curve that ends with his hand over the rim, hang on the rim, drop
    const dunkHero = (s, P) => {
      const run = smooth(s, P.run[0], P.run[1]), u = seg(s, P.fly[0], P.fly[1]);
      let x, y;
      if (s < P.fly[0]) { x = lerp(P.start, P.takeoff, run); y = 0; }
      else if (s < P.fly[1]) {
        const e = 1 - Math.pow(1 - u, 1.6);                        // fast off the floor, floating into the rim
        x = (1 - e) * (1 - e) * P.takeoff + 2 * (1 - e) * e * P.ctrl.x + e * e * SLAM_AT.x;
        y = 2 * (1 - e) * e * P.ctrl.y + e * e * SLAM_AT.y;
      } else if (s < P.hang) { const h = seg(s, P.fly[1], P.hang); x = SLAM_AT.x - h * 0.04; y = SLAM_AT.y - h * 0.2; }
      else { const d = seg(s, P.hang, P.land); x = SLAM_AT.x - 0.04 - d * 0.25; y = (SLAM_AT.y - 0.2) * (1 - d * d); }
      at(hero, x, Math.max(0, y), 0);
      const flying = s >= P.fly[0] && s < P.land;
      if (s < P.fly[0]) pose(hero, { run: 13, armL: 0.15 + run * 0.1, crouch: seg(s, P.fly[0] - 0.15, P.fly[0]) * 0.3 });
      else if (flying) pose(hero, { armL: 1, armR: s > P.fly[1] - 0.25 ? 1 : 0.55, kick: s < P.fly[1] ? 0.9 : 0.3, lean: -0.15 });
      else pose(hero, { crouch: 0.35 * (1 - seg(s, P.land, P.land + 0.35)), armL: 0.3, armR: 0.3 });
      // the rim bends down while he hangs on it, then shakes back
      if (s >= P.fly[1] && s < P.hang) rim.rotation.z = 0.13 * smooth(s, P.fly[1], P.fly[1] + 0.12);
      else if (s >= P.hang) { const wv = seg(s, P.hang, P.hang + 0.8); rim.rotation.z = Math.cos(wv * Math.PI * 5) * 0.13 * (1 - wv); }
      else rim.rotation.z = 0;
    };
    // the ball: in his hand, then pushed down through the rim from above, through the net, onto the floor
    const dunkBall = (s, P) => {
      const top = { x: RIM.x, y: RIM.y + 0.14, z: 0 };
      const push = P.fly[1] - 0.08;
      if (s < push) { const h = handOf(hero, 0); ball.position.set(h.x, h.y + 0.06, h.z); return; }
      if (s < P.fly[1]) { const h = handOf(hero, 0); const k = seg(s, push, P.fly[1]); const p = mix({ x: h.x, y: h.y + 0.06, z: h.z }, top, k); ball.position.set(p.x, p.y, p.z); return; }
      const d = seg(s, P.fly[1], P.fly[1] + 0.5);
      ball.position.set(RIM.x + d * 0.1, lerp(top.y, 0.12, d * d), 0);
      net.scale.y = 1 + Math.sin(clamp(d * 2) * Math.PI) * 0.45;
      if (d >= 1) ball.position.y = 0.12 + Math.abs(Math.sin(seg(s, P.fly[1] + 0.5, P.fly[1] + 1.4) * Math.PI * 2)) * 0.5 * (1 - seg(s, P.fly[1] + 0.5, P.fly[1] + 1.4));
    };
    const camAt = (x, y, z, lx, ly, lz) => w.camGoal(x, y, z, lx, ly, lz);
    const face = (o, deg) => o.root.rotation.y;
    return {
      1: {                                          // a real crossover: hesitation, ball crossed low hand to hand, ankles
        len: 3.3,
        segs: [[0, 0.42, 1, 1], [0.42, 0.84, 1, 1], [0.84, 1.12, 1, 0], [1.12, 1.44, 0, 0], [1.44, 1.8, 0, 0],
               [1.8, 2.16, 0, 0], [2.16, 2.52, 0, 0], [2.52, 2.88, 0, 0], [2.88, 3.3, 0, 0]],
        update(t) {
          const go = smooth(t, 1.1, 3.0), sell = smooth(t, 0.45, 0.8), cross = smooth(t, 0.9, 1.5), fall = smooth(t, 1.25, 1.9);
          at(hero, go * 3.1, 0, 0.12 * sell - 0.62 * cross);
          const d = this.dribbling(t);
          const pump = d ? Math.sin(d.u * Math.PI * 2) * 0.1 : 0;
          pose(hero, {
            run: t > 1.15 ? 12 : 0, crouch: t < 1.1 ? 0.4 : 0.22, lean: go * 0.18,
            side: t < 0.84 ? 0.15 * sell : lerp(0.15, -0.2, cross) * (1 - go * 0.5),
            armR: d && d.hand === 1 ? 0.2 + pump : 0.38, armL: d && d.hand === 0 ? 0.2 + pump : 0.38,
          });
          // the defender bites on the hesitation, then his feet get crossed up and he goes down
          at(def, 1.65 + fall * 0.25, fall * 0.05, 0.3 * sell);
          def.root.rotation.z = -fall * 1.3;         // feet go out from under him: flat on his back
          def.root.rotation.x = fall * 0.25;
          pose(def, { crouch: 0.45 * (1 - fall), armL: 0.3 + fall * 0.5, armR: 0.35, turn: Math.PI,
            kick: fall * 0.6, kickR: -fall * 0.3, side: 0.2 * sell });
          const f = smooth(t, 1.3, 2.8);
          camAt(lerp(2.7, 3.9, f), 1.15, lerp(2.7, 2.3, f), lerp(0.7, 2.6, f), 0.72, lerp(0, -0.35, f));
          if (t > 1.7) boom("ANKLES!");
        },
        // which hand the ball is going to and how far through the bounce it is
        dribbling(t) {
          const s = this.segs.find(([a, b]) => t >= a && t < b) || this.segs[this.segs.length - 1];
          return { from: s[2], hand: s[3], u: clamp((t - s[0]) / (s[1] - s[0])) };
        },
        after(t) {
          const d = this.dribbling(t);
          const P0 = handOf(hero, d.from), P2 = handOf(hero, d.hand);
          hero.hips.getWorldPosition(v);
          const F = { x: v.x + 0.42, y: 0.12, z: d.from !== d.hand ? (P0.z + P2.z) / 2 : P0.z * 0.9 + v.z * 0.1 };
          const p = d.u < 0.45 ? mix(P0, F, Math.pow(d.u / 0.45, 2)) : mix(F, P2, 1 - Math.pow(1 - (d.u - 0.45) / 0.55, 2));
          ball.position.set(p.x, p.y, p.z);
          ball.rotation.z -= 0.3;
        },
      },
      2: { len: 3.1, update(t) {                     // layup
        const run = smooth(t, 0, 1.45), jump = seg(t, 1.4, 2.25), lay = seg(t, 1.75, 2.15);
        at(def, 4.2, 0, 1.15); pose(def, { crouch: 0.3, armL: 0.6, turn: Math.PI * 0.8 });
        at(hero, lerp(1.8, 5.85, run) + ease(jump) * 0.5, Math.sin(jump * Math.PI) * 0.95, 0);
        pose(hero, { run: run < 1 ? 13 : 0, armL: jump > 0 ? 0.95 : 0.1, kick: jump > 0 ? 0.55 : 0 });
        if (lay <= 0) holdBall(hero); else if (lay < 1) shoot(hero, RIM_IN, 0.25, lay); else sink(seg(t, 2.15, 2.65));
        camAt(4.0, 1.9, 4.8, 5.6, 2.0, 0);
        if (t > 2.25) boom("BUCKET");
      } },
      3: { len: 3.1, update(t) {                     // floater over the defender
        const run = smooth(t, 0, 1.15), jump = seg(t, 1.15, 1.95), fly = seg(t, 1.5, 2.4);
        at(def, 5.6, Math.sin(jump * Math.PI) * 0.4, 0.4); pose(def, { crouch: 0.2, armL: Math.sin(jump * Math.PI), armR: 0.4, turn: Math.PI });
        at(hero, lerp(1.6, 4.6, run), Math.sin(jump * Math.PI) * 0.6, 0);
        pose(hero, { run: run < 1 ? 13 : 0, armL: jump > 0 ? 0.92 : 0.1 });
        if (fly <= 0) holdBall(hero); else if (fly < 1) shoot(hero, RIM_IN, 1.5, fly); else sink(seg(t, 2.4, 2.85));
        camAt(3.2, 2.2, 5.0, 5.2, 2.2, 0);
        if (t > 2.45) boom("TEARDROP");
      } },
      4: { len: 3.3, update(t) {                     // free throw
        const set = smooth(t, 1.2, 1.5), fly = seg(t, 1.55, 2.6);
        at(hero, 2.4, Math.sin(seg(t, 1.35, 1.75) * Math.PI) * 0.16, 0);
        at(def, 4.4, 0, 1.6); pose(def, { turn: -Math.PI / 2 });
        pose(hero, { crouch: t < 1.2 ? 0.22 : 0.1 * (1 - set), armL: set });
        if (t < 1.2) dribble(hero, t, 1); else if (fly <= 0) holdBall(hero); else if (fly < 1) shoot(hero, RIM_IN, 1.3, fly); else sink(seg(t, 2.6, 3.0));
        camAt(1.0, 2.0, 3.8, 4.4, 2.2, 0);
        if (t > 2.7) boom("SWISH");
      } },
      5: { len: 3.5, update(t) {                     // three-pointer, the camera follows the ball
        const set = smooth(t, 0.55, 0.95), fly = seg(t, 1.1, 2.65);
        at(hero, 0.1, Math.sin(seg(t, 0.8, 1.25) * Math.PI) * 0.45, 0);
        at(def, 1.3, Math.sin(seg(t, 0.9, 1.4) * Math.PI) * 0.35, 0.1);
        pose(def, { armL: smooth(t, 0.7, 1.1), armR: smooth(t, 0.7, 1.1), turn: Math.PI });
        pose(hero, { crouch: 0.3 * (1 - set), armL: set });
        if (fly <= 0) holdBall(hero); else if (fly < 1) shoot(hero, RIM_IN, 2.3, fly); else sink(seg(t, 2.65, 3.05));
        const f = smooth(t, 1.0, 2.6);
        camAt(lerp(-1.6, 1.6, f), lerp(1.8, 2.8, f), lerp(5.0, 7.2, f), lerp(1.0, ball.position.x, f * 0.8), lerp(1.5, ball.position.y * 0.75 + 0.4, f), 0);
        if (t > 2.75) boom("SPLASH 💦");
      } },
      6: {                                          // dunk: up, hand over the rim, slammed through, hangs on the rim
        len: 4.7,
        time(t) { return t < 1.5 ? t : t < 2.7 ? 1.5 + (t - 1.5) * 0.4 : 1.98 + (t - 2.7); },
        plan: { start: 2.2, takeoff: 4.85, run: [0, 1.15], fly: [1.15, 1.95], ctrl: { x: 6.0, y: 2.3 }, hang: 2.35, land: 2.65 },
        update(t) {
          const s = this.time(t);
          dunkHero(s, this.plan);
          const jumpD = seg(s, 1.2, 1.9), knocked = smooth(s, 2.0, 2.5);
          at(def, 6.05, Math.sin(jumpD * Math.PI) * 0.5, 0.5);
          def.root.rotation.x = knocked * 1.45;
          pose(def, { armL: Math.min(1, jumpD * 2) * (1 - knocked), armR: 0.8 - knocked * 0.5, turn: Math.PI });
          const k = smooth(s, 0.6, 1.95);
          camAt(lerp(3.4, 5.3, k), lerp(1.5, 2.9, k), lerp(4.6, 3.4, k), lerp(4.8, RIM.x - 0.2, k), lerp(1.3, 2.7, k), 0);
          w.shake = s > 1.95 && s < 2.3 ? 0.07 : 0;
          if (s > 1.95) boom("SLAM!", true);
        },
        after(t) { dunkBall(this.time(t), this.plan); },
      },
      7: {                                          // POSTERIZER over two defenders, hang on the rim, then the celebration
        len: 7.4,
        time(t) { return t < 1.4 ? t : t < 2.9 ? 1.4 + (t - 1.4) * 0.35 : 1.925 + (t - 2.9); },
        plan: { start: 1.0, takeoff: 3.9, run: [0, 1.0], fly: [1.0, 1.95], ctrl: { x: 5.25, y: 3.4 }, hang: 2.35, land: 2.65 },
        update(t) {
          const s = this.time(t), P = this.plan;
          const knocked = smooth(s, 1.9, 2.4), party = seg(s, 2.7, 6.2);
          at(def, 5.15, Math.sin(seg(s, 1.0, 1.75) * Math.PI) * 0.5, 0.4);
          at(def2, 5.7, Math.sin(seg(s, 1.08, 1.85) * Math.PI) * 0.55, -0.4);
          def.root.rotation.x = knocked * 1.55; def2.root.rotation.x = -knocked * 1.55;
          pose(def, { armL: (1 - knocked), armR: 0.7, turn: Math.PI });
          pose(def2, { armL: 0.9 - knocked * 0.6, armR: 1 - knocked, turn: Math.PI });
          if (s < 2.85) dunkHero(s, P);
          else {
            // he walks out toward the crowd, turns and dances
            const hx = lerp(6.35, 4.8, smooth(s, 2.85, 3.5));
            at(hero, hx, 0, lerp(0, 0.6, smooth(s, 2.85, 3.5)));
            if (s < 3.5) pose(hero, { run: 9, turn: -Math.PI / 2 * smooth(s, 2.9, 3.4), armL: 0.6, armR: 0.6 });
            else if (s < 5.8) {
              const b = (s - 3.5) * 7.5;
              pose(hero, { turn: -Math.PI / 2, bounce: Math.abs(Math.sin(b)) * 0.06, kick: Math.max(0, Math.sin(b)) * 0.55,
                kickR: Math.max(0, -Math.sin(b)) * 0.55, armL: 0.55 + Math.sin(b) * 0.4, armR: 0.55 - Math.sin(b) * 0.4,
                side: Math.sin(b / 2) * 0.12, crouch: 0.15 });
            } else pose(hero, { turn: -Math.PI / 2, armL: 1, armR: 1, bounce: Math.abs(Math.sin((s - 5.8) * 6)) * 0.35 });
          }
          w.shake = s > 1.95 && s < 2.35 ? 0.11 : 0;
          w.hype = s > 1.95 ? Math.min(1, (s - 1.95) * 3) : 0;
          if (s > 1.95 && !w.confettiOn) { w.confettiOn = true; w.roar(); }
          if (s < 2.75) {
            const k = smooth(s, 0.5, 1.95);
            camAt(lerp(3.0, 5.2, k), lerp(1.6, 3.1, k), lerp(5.2, 3.6, k), lerp(4.2, RIM.x - 0.3, k), lerp(1.2, 2.6, k), 0);
          } else {
            camAt(lerp(5.2, 4.4, party), 1.9, 5.6, hero.root.position.x, 1.25, 0.3);
          }
          if (s > 1.95 && s < 3.5) boom("POSTERIZED!", true);
          if (s >= 3.5) boom("CROWD GOES WILD!", true);
        },
        after(t) { dunkBall(this.time(t), this.plan); },
      },
    };
  }

  /* ---------- the stands, the confetti and the roar ---------- */
  function makeCrowd(THREE, scene) {
    const rows = [], perRow = 40;
    const stand = new THREE.Mesh(new THREE.BoxGeometry(22, 1.8, 3.2), new THREE.MeshStandardMaterial({ color: 0x1a2238, roughness: 0.9 }));
    stand.position.set(3, 0.5, -6.6); stand.rotation.x = 0.0; scene.add(stand);
    const bodies = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.17, 0.2, 0.55, 10), new THREE.MeshStandardMaterial({ roughness: 0.8 }), perRow * 3);
    const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.12, 10, 8), new THREE.MeshStandardMaterial({ roughness: 0.8 }), perRow * 3);
    const shirts = [0x1d3a8a, 0xff7a1a, 0xc93636, 0xf2c14e, 0x2fbf71, 0xffffff, 0x6250d6];
    const skins = [0xe8b990, 0xc8956b, 0x9c6b47, 0x6e4a32];
    const color = new THREE.Color(), m = new THREE.Matrix4();
    for (let r = 0; r < 3; r++) {
      for (let i = 0; i < perRow; i++) {
        const n = r * perRow + i;
        const seat = { x: -6 + i * 0.5 + (r % 2) * 0.25, y: 1.7 + r * 0.42, z: -5.4 - r * 0.55, phase: Math.random() * 6.28, speed: 7 + Math.random() * 5 };
        rows.push(seat);
        bodies.setColorAt(n, color.set(shirts[(i * 7 + r * 3) % shirts.length]));
        heads.setColorAt(n, color.set(skins[(i * 5 + r) % skins.length]));
        m.makeTranslation(seat.x, seat.y, seat.z); bodies.setMatrixAt(n, m);
        m.makeTranslation(seat.x, seat.y + 0.4, seat.z); heads.setMatrixAt(n, m);
      }
    }
    scene.add(bodies, heads);
    // camera flashes in the stands
    const flashes = Array.from({ length: 10 }, () => {
      const f = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 }));
      scene.add(f); return f;
    });
    return {
      update(time, hype) {
        rows.forEach((seat, n) => {
          const jump = Math.abs(Math.sin(time * seat.speed + seat.phase)) * (0.03 + hype * 0.3);
          m.makeTranslation(seat.x, seat.y + jump, seat.z); bodies.setMatrixAt(n, m);
          m.makeTranslation(seat.x, seat.y + 0.4 + jump, seat.z); heads.setMatrixAt(n, m);
        });
        bodies.instanceMatrix.needsUpdate = true; heads.instanceMatrix.needsUpdate = true;
        for (const f of flashes) {
          if (hype > 0.2 && Math.random() < 0.06) { const seat = rows[Math.floor(Math.random() * rows.length)]; f.position.set(seat.x, seat.y + 0.55, seat.z + 0.2); f.material.opacity = 1; }
          f.material.opacity *= 0.82;
        }
      },
    };
  }

  function makeConfetti(THREE, scene) {
    const count = 260;
    const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.07, 0.045), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), count);
    const colors = [0xff7a1a, 0xf2c14e, 0x3987e5, 0x2fbf71, 0xef4b4b, 0xffffff, 0xc77dff];
    const bits = [], color = new THREE.Color(), m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < count; i++) {
      bits.push({ x: 2.5 + Math.random() * 6, z: -1.5 + Math.random() * 4, y: 4 + Math.random() * 4, fall: 0.6 + Math.random() * 0.7,
        drift: Math.random() * 6.28, spin: 2 + Math.random() * 6 });
      mesh.setColorAt(i, color.set(colors[i % colors.length]));
    }
    mesh.visible = false;
    scene.add(mesh);
    return {
      update(time, on, dt) {
        mesh.visible = on;
        if (!on) return;
        bits.forEach((b, i) => {
          b.y -= b.fall * dt;
          if (b.y < 0.03) b.y = 0.03;
          const x = b.x + Math.sin(time * 1.6 + b.drift) * 0.25;
          e.set(time * b.spin, time * b.spin * 0.7, b.drift);
          m.compose(new THREE.Vector3(x, b.y, b.z), q.setFromEuler(e), one);
          mesh.setMatrixAt(i, m);
        });
        mesh.instanceMatrix.needsUpdate = true;
      },
    };
  }

  // the crowd roar: shaped noise made in the browser, no sound file needed
  function roar() {
    try {
      const A = window.AudioContext || window.webkitAudioContext;
      if (!A) return;
      const ctx = new A();
      const len = ctx.sampleRate * 3.2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 + 0.3 * Math.sin(i / 900));
      const src = ctx.createBufferSource(); src.buffer = buf;
      const band = ctx.createBiquadFilter(); band.type = "bandpass"; band.frequency.value = 850; band.Q.value = 0.5;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.45, ctx.currentTime + 0.35);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 3.1);
      src.connect(band).connect(gain).connect(ctx.destination);
      src.start();
      setTimeout(() => ctx.close().catch(() => {}), 3500);
    } catch (e) { /* sound is optional */ }
  }

  function play3D(step, done) {
    const THREE = window.THREE;
    const host = document.getElementById("scene");
    host.innerHTML = "";
    const width = host.clientWidth || 340, height = Math.round(width * 0.66);
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2.5));
    renderer.setSize(width, height);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.className = "scene3d";
    host.append(renderer.domElement);
    const label = document.createElement("div");
    label.className = "boom3d";
    host.append(label);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0c1120);
    scene.fog = new THREE.Fog(0x0c1120, 10, 24);
    scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x3a2410, 0.65));
    const sun = new THREE.DirectionalLight(0xffffff, 1.0);
    sun.position.set(3, 9, 6); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0005; sun.shadow.radius = 3;
    Object.assign(sun.shadow.camera, { left: -6, right: 11, top: 7, bottom: -5 });
    scene.add(sun);
    const rimLight = new THREE.PointLight(0xff9a3d, 0.7, 12); rimLight.position.set(RIM.x, 5, 2); scene.add(rimLight);
    const fill = new THREE.DirectionalLight(0x9cc8ff, 0.35); fill.position.set(-4, 3, -5); scene.add(fill);

    const tex = new THREE.CanvasTexture(courtTexture());
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    tex.encoding = THREE.sRGBEncoding;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 10), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.42, metalness: 0.05 }));
    floor.rotation.x = -Math.PI / 2; floor.position.x = 4; floor.receiveShadow = true; scene.add(floor);
    // the hoop
    const metal = new THREE.MeshStandardMaterial({ color: 0x9aa6c0, metalness: 0.7, roughness: 0.35 });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 3.6, 16), metal); pole.position.set(7.95, 1.8, 0); pole.castShadow = true; scene.add(pole);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.08, 0.08), metal); arm.position.set(7.65, 3.4, 0); scene.add(arm);
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.05, 1.8), new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, roughness: 0.1 }));
    board.position.set(7.3, 3.45, 0); board.castShadow = true; scene.add(board);
    const square = new THREE.Mesh(new THREE.EdgesGeometry(new THREE.PlaneGeometry(0.59, 0.45)), new THREE.LineBasicMaterial({ color: 0xff7a1a }));
    square.rotation.y = -Math.PI / 2; square.position.set(7.27, 3.3, 0); scene.add(square);
    const rim = new THREE.Group(); rim.position.set(7.3, RIM.y, 0); scene.add(rim);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.23, 0.02, 12, 40), new THREE.MeshStandardMaterial({ color: 0xff5a1a, metalness: 0.5, roughness: 0.3 }));
    ring.rotation.x = Math.PI / 2; ring.position.x = RIM.x - 7.3; ring.castShadow = true; rim.add(ring);
    const net = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.14, 0.45, 16, 4, true), new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true }));
    net.geometry.translate(0, -0.225, 0); net.position.x = RIM.x - 7.3; rim.add(net);
    // the ball
    const bc = document.createElement("canvas"); bc.width = 256; bc.height = 128;
    const bx = bc.getContext("2d"); bx.fillStyle = "#e8742a"; bx.fillRect(0, 0, 256, 128);
    bx.strokeStyle = "#2a1608"; bx.lineWidth = 5; bx.beginPath(); bx.moveTo(0, 64); bx.lineTo(256, 64); bx.moveTo(128, 0); bx.lineTo(128, 128);
    bx.moveTo(64, 0); bx.quadraticCurveTo(20, 64, 64, 128); bx.moveTo(192, 0); bx.quadraticCurveTo(236, 64, 192, 128); bx.stroke();
    const btex = new THREE.CanvasTexture(bc); btex.encoding = THREE.sRGBEncoding;
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.12, 32, 24), new THREE.MeshStandardMaterial({ map: btex, roughness: 0.55 }));
    ball.castShadow = true; scene.add(ball);

    const hero = makePlayer(THREE, { face: true, skin: 0xe8b990, jersey: 0x1d3a8a, shorts: 0x16295f, shoe: 0xff7a1a });
    const red = { skin: 0x9c6b47, jersey: 0xc93636, shorts: 0x8f2424, shoe: 0xffffff };
    const def = makePlayer(THREE, red), def2 = makePlayer(THREE, { ...red, skin: 0xc8956b });
    scene.add(hero.root, def.root, def2.root);
    def2.root.visible = step === 7;
    if (step !== 7) def2.root.position.set(-20, 0, 0);
    const crowd = makeCrowd(THREE, scene);
    const confetti = makeConfetti(THREE, scene);

    // colours were picked as on-screen colours: convert them once so the sRGB output shows them as intended
    const fixed = new Set();
    scene.traverse((o) => {
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const mt of mats) if (mt.color && !fixed.has(mt)) { fixed.add(mt); mt.color.convertSRGBToLinear(); }
      if (o.isInstancedMesh && o.instanceColor) {
        const c = new THREE.Color();
        for (let i = 0; i < o.count; i++) { o.getColorAt(i, c); o.setColorAt(i, c.convertSRGBToLinear()); }
        o.instanceColor.needsUpdate = true;
      }
    });
    scene.background.convertSRGBToLinear(); scene.fog.color.convertSRGBToLinear();

    const cam = new THREE.PerspectiveCamera(45, width / height, 0.1, 60);
    const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), goalPos = new THREE.Vector3(), goalLook = new THREE.Vector3();
    let shown = "";
    const w = {
      THREE, hero, def, def2, ball, rim, net, shake: 0, hype: 0, release: null, confettiOn: false, roar,
      boom(text, big) {
        if (shown === text) return;
        shown = text;
        label.textContent = text;
        label.className = "boom3d" + (big ? " big" : "") + (text.length > 12 ? " long" : "");
        void label.offsetWidth;
        label.className += " on";
      },
      camGoal(x, y, z, lx, ly, lz) { goalPos.set(x, y, z); goalLook.set(lx, ly, lz); },
    };
    const all = scenes(w);
    const S = all[step];
    for (const k of Object.keys(all)) { if (all[k].dribbling) all[k].dribbling = all[k].dribbling.bind(all[k]); }

    let start = null, last = null, raf = null, finished = false, first = true;
    const end = () => {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(raf);
      renderer.dispose();
      done();
    };
    const freeze = params.has("test") ? Number(params.get("freeze")) : 0;
    const frame = (now) => {
      if (start == null) { start = now; last = now; }
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = freeze > 0 ? freeze : (now - start) / 1000;
      const snap = first || freeze > 0;
      S.update(Math.min(t, S.len));
      for (const p of [hero, def, def2]) apply(p, dt, snap);
      if (S.after) S.after(Math.min(t, S.len));
      // the camera eases toward where the scene wants it (snaps on the first frame)
      const k = snap ? 1 : 1 - Math.exp(-dt * 5);
      camPos.lerp(goalPos, k); camLook.lerp(goalLook, k);
      cam.position.copy(camPos);
      if (w.shake) cam.position.add(new THREE.Vector3((Math.random() - 0.5) * w.shake, (Math.random() - 0.5) * w.shake, 0));
      cam.lookAt(camLook);
      crowd.update(t, w.hype);
      confetti.update(t, w.confettiOn, freeze > 0 ? 0.6 : dt);
      renderer.render(scene, cam);
      first = false;
      if (freeze > 0 || t < S.len + 0.5) raf = requestAnimationFrame(frame);
      else end();
    };
    raf = requestAnimationFrame(frame);
    document.getElementById("btn-skip").onclick = end;
  }

  window.Cutscene = {
    ...flat,
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
        document.getElementById("cut-step").textContent = `Step ${step} of 7`;
        document.getElementById("cut-title").textContent = flat.names[step - 1];
        document.getElementById("screen-cutscene").classList.toggle("is-dunk", step >= 6);
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
