/* Das Trivia: the little cutscene between questions.
   Each correct answer moves the player up one step. The player (with the EquipoGPT host's face)
   does that step's move against a defender:
   1 grab the ball, 2 crossover, 3 layup, 4 floater, 5 free throw, 6 three-pointer, 7 poster dunk.
   Use: Cutscene.play(step, onDone). */
(() => {
  "use strict";

  const NAMES = ["Grab the ball", "Crossover", "Layup", "Floater", "Free throw", "Three-pointer", "SLAM DUNK!"];
  const GROUND = 170, RIM_X = 309, RIM_Y = 84;
  const FT_X = 213, THREE_X = 100;      // where the player stands for a free throw and a three
  const HOLD = GROUND - 31;             // height of the ball when it is held at the hip

  // Where the host's face sits inside images/host.webp (the picture is 1254 x 1254).
  const FACE = { image: "images/host.webp", size: 1254, centerX: 345, centerY: 275, width: 400 };

  let anims = [], timer = null, onDone = null;

  const $ = (id) => document.getElementById(id);
  const q = (selector) => document.querySelector("#scene " + selector);
  const T = (x, y) => `translate(${x}px, ${y}px)`;
  const R = (deg) => `rotate(${deg}deg)`;
  // Position of a whole figure: where the feet are, how far it has tipped over, and how crouched it is.
  const stand = (x, y = GROUND, squash = 1, tilt = 0) => `${T(x, y)} rotate(${tilt}deg) scale(1, ${squash})`;

  // A basketball player drawn facing right, with the feet at (0, 0).
  function figure(kind) {
    const hero = kind === "baller";
    const skin = hero ? "#e8b990" : "#b9825a";
    const jersey = hero ? "#1d3a8a" : "#c93636";
    const shorts = hero ? "#16296a" : "#8f2323";
    const trim = hero ? "#ffc53d" : "#ffffff";
    const headR = 13, headY = -64;
    const scale = (headR * 2) / FACE.width, img = FACE.size * scale;
    const head = hero
      ? `<clipPath id="cs-face"><circle cx="1" cy="${headY}" r="${headR}"/></clipPath>
         <image href="${FACE.image}" x="${1 - FACE.centerX * scale}" y="${headY - FACE.centerY * scale}" width="${img}" height="${img}" clip-path="url(#cs-face)" preserveAspectRatio="none"/>
         <circle cx="1" cy="${headY}" r="${headR}" fill="none" stroke="${trim}" stroke-width="1.4"/>`
      : `<circle cx="0" cy="-60" r="9" fill="${skin}"/>
         <path d="M-9 -63 H9" stroke="#fff" stroke-width="2.6"/>
         <circle cx="4" cy="-59" r="1.1" fill="#2a1a10"/><path d="M3 -55 h4" stroke="#2a1a10" stroke-width="1" stroke-linecap="round"/>`;
    return `
      <ellipse cx="0" cy="1" rx="13" ry="3" fill="#000" opacity=".28"/>
      <path d="M-2 -45 L-10 -31" stroke="${skin}" stroke-width="4.2" stroke-linecap="round"/>
      <g class="leg leg-a"><path d="M-3 -24 L-5 -3" stroke="${skin}" stroke-width="5.5" stroke-linecap="round"/><rect x="-9" y="-4" width="11" height="5" rx="2.5" fill="#f4f6fb"/></g>
      <g class="leg leg-b"><path d="M3 -24 L5 -3" stroke="${skin}" stroke-width="5.5" stroke-linecap="round"/><rect x="1" y="-4" width="11" height="5" rx="2.5" fill="#f4f6fb"/></g>
      <rect x="-8" y="-29" width="16" height="12" rx="3" fill="${shorts}"/>
      <rect x="-8" y="-49" width="16" height="23" rx="4" fill="${jersey}"/>
      <path d="M-8 -30 H8" stroke="${trim}" stroke-width="1.6"/>
      <text x="0" y="-35" text-anchor="middle" class="cs-num" fill="${trim}">${hero ? "1" : "0"}</text>
      <rect x="-2" y="-53" width="5" height="6" fill="${skin}"/>
      ${head}
      <g class="arm"><path d="M2 -45 L13 -33" stroke="${skin}" stroke-width="4.5" stroke-linecap="round"/><circle cx="13" cy="-33" r="2.8" fill="${skin}"/></g>`;
  }

  function sceneMarkup() {
    return `
<svg viewBox="0 0 360 210" role="img" aria-label="A basketball player with the host's face takes on a defender">
  <defs>
    <linearGradient id="cs-sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0b1020"/><stop offset="1" stop-color="#1b2540"/>
    </linearGradient>
    <linearGradient id="cs-wood" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#d59a57"/><stop offset="1" stop-color="#a86a2e"/>
    </linearGradient>
    <clipPath id="cs-floor"><rect x="0" y="${GROUND}" width="360" height="40"/></clipPath>
  </defs>
  <g class="shake">
    <rect width="360" height="210" fill="url(#cs-sky)"/>
    <g fill="#ffffff" opacity=".07">
      <circle cx="30" cy="150" r="9"/><circle cx="62" cy="146" r="9"/><circle cx="96" cy="151" r="9"/>
      <circle cx="131" cy="147" r="9"/><circle cx="166" cy="151" r="9"/><circle cx="201" cy="146" r="9"/>
      <circle cx="236" cy="150" r="9"/><circle cx="270" cy="147" r="9"/>
    </g>
    <rect x="0" y="${GROUND}" width="360" height="40" fill="url(#cs-wood)"/>
    <g clip-path="url(#cs-floor)" fill="none" stroke="#fff" stroke-opacity=".8" stroke-width="2">
      <ellipse cx="318" cy="${GROUND + 2}" rx="205" ry="30"/>
      <path d="M${FT_X} ${GROUND} l-14 40 M${FT_X} ${GROUND} H360" stroke-opacity=".55"/>
    </g>
    <text x="${THREE_X - 2}" y="204" class="cs-mark">3PT</text>
    <text x="${FT_X - 10}" y="204" class="cs-mark">FT</text>

    <g class="hoop">
      <rect x="336" y="60" width="5" height="${GROUND - 60}" fill="#5b667f"/>
      <rect x="326" y="66" width="12" height="5" fill="#5b667f"/>
      <rect x="321" y="44" width="6" height="50" rx="2" fill="#e9eef8"/>
      <g class="net" stroke="#e9eef8" stroke-width="1.2" stroke-opacity=".85" fill="none">
        <path d="M298 ${RIM_Y} l4 22 M304 ${RIM_Y} l2 22 M309 ${RIM_Y} v22 M314 ${RIM_Y} l-2 22 M320 ${RIM_Y} l-4 22 M300 95 h19 M302 106 h14"/>
      </g>
      <rect x="296" y="${RIM_Y - 2}" width="26" height="4" rx="2" fill="#ff5a1f"/>
    </g>

    <g class="defender"><g transform="scale(-1, 1)">${figure("defender")}</g></g>
    <g class="baller">${figure("baller")}</g>

    <g class="ball-x"><g class="ball-y">
      <circle r="6" fill="#ff7a1a" stroke="#7a2d00" stroke-width="1"/>
      <path d="M-6 0 H6 M0 -6 V6" stroke="#7a2d00" stroke-width=".8"/>
    </g></g>

    <g class="confetti"></g>
    <rect class="flash" width="360" height="210" fill="#fff" opacity="0"/>
    <text class="boom" x="150" y="62" text-anchor="middle" opacity="0"></text>
  </g>
</svg>`;
  }

  // One animation per moving part: a list of [time in ms, value, easing to the next point].
  function track(el, total, points, property = "transform") {
    const frames = points.map(([t, value, easing]) => ({ offset: Math.min(1, t / total), [property]: value, easing: easing || "linear" }));
    if (frames[0].offset > 0) frames.unshift({ offset: 0, [property]: frames[0][property], easing: "linear" });
    if (frames[frames.length - 1].offset < 1) frames.push({ offset: 1, [property]: frames[frames.length - 1][property] });
    anims.push(el.animate(frames, { duration: total, fill: "both" }));
  }

  function run(total, from, to, who = ".baller") {      // swing the legs while running
    const a = [], b = [];
    for (let t = from, i = 0; t <= to; t += 110, i++) { a.push([t, R(i % 2 ? 30 : -30)]); b.push([t, R(i % 2 ? -30 : 30)]); }
    a.push([to + 80, R(0)]); b.push([to + 80, R(0)]);
    track(q(`${who} .leg-a`), total, a); track(q(`${who} .leg-b`), total, b);
  }

  // The ball leaves the hands at t0, arcs up to peakY, drops through the rim, and bounces.
  function shot(total, t0, fromX, fromY, peakY, flight, beforeX = [], beforeY = []) {
    const made = t0 + flight;
    track(q(".ball-x"), total, [...beforeX, [t0, T(fromX, 0)], [made, T(RIM_X, 0)], [made + 700, T(RIM_X - 8, 0)]]);
    track(q(".ball-y"), total, [...beforeY, [t0, T(0, fromY), "ease-out"], [t0 + flight * 0.5, T(0, peakY), "ease-in"],
      [made, T(0, RIM_Y), "ease-in"], [made + 280, T(0, GROUND - 6), "ease-out"], [made + 430, T(0, GROUND - 20), "ease-in"], [made + 580, T(0, GROUND - 6)]]);
    track(q(".net"), total, [[made, "scaleY(1)"], [made + 120, "scaleY(1.4)"], [made + 340, "scaleY(1)"]]);
  }

  function boom(total, at, text, size) {     // big pop-up words
    const el = q(".boom");
    el.textContent = text;
    el.style.fontSize = size + "px";
    track(el, total, [[at, 0], [at + 60, 1]], "opacity");
    track(el, total, [[at, "scale(.2)"], [at + 220, "scale(1.18)", "ease-out"], [at + 360, "scale(1)"]]);
  }

  const baller = () => q(".baller"), arm = () => q(".baller .arm");
  const defender = () => q(".defender"), dArm = () => q(".defender .arm");

  const SCENES = {
    1() {   // loose ball: the player gets there first and holds it out of the defender's reach
      const total = 2800, x = 150;
      track(baller(), total, [[900, stand(x)], [1200, stand(x, GROUND, 0.82)], [1500, stand(x)], [1750, stand(x, GROUND - 9), "ease-out"], [2000, stand(x)]]);
      track(arm(), total, [[950, R(0)], [1200, R(45)], [1500, R(0)], [1750, R(-125)]]);
      track(q(".ball-x"), total, [[0, T(350, 0), "ease-out"], [1000, T(x + 17, 0)], [1500, T(x + 15, 0)], [1750, T(x + 12, 0)]]);
      track(q(".ball-y"), total, [[1200, T(0, GROUND - 6)], [1500, T(0, HOLD)], [1750, T(0, GROUND - 76), "ease-out"], [2000, T(0, GROUND - 68)]]);
      track(defender(), total, [[0, stand(395)], [1150, stand(205), "ease-out"], [1450, stand(190)], [1800, stand(188, GROUND, 0.9)],
        [2000, stand(186, GROUND - 13), "ease-out"], [2200, stand(186)], [2400, stand(186, GROUND - 10), "ease-out"], [2600, stand(186)]]);
      run(total, 0, 1150, ".defender");
      track(dArm(), total, [[1150, R(0)], [1400, R(40)], [1750, R(-115)]]);
      return total;
    },
    2() {   // crossover: left, back right, and the defender's ankles give out
      const total = 3300, x = 150, hand = HOLD, floor = GROUND - 6, low = GROUND - 20;
      track(baller(), total, [[1000, stand(x)], [1200, stand(x - 14, GROUND, 0.9)], [1450, stand(x - 14, GROUND, 0.9)], [1650, stand(x + 18)], [2400, stand(232)]]);
      run(total, 1650, 2400);
      track(arm(), total, [[0, R(-8)], [1000, R(10)], [1200, R(30)], [1650, R(0)], [2400, R(-8)]]);
      track(q(".ball-x"), total, [[1000, T(x + 17, 0)], [1200, T(x - 26, 0)], [1450, T(x - 26, 0)], [1650, T(x + 35, 0)], [2400, T(249, 0)]]);
      track(q(".ball-y"), total, [[100, T(0, hand), "ease-in"], [300, T(0, floor), "ease-out"], [500, T(0, hand), "ease-in"], [700, T(0, floor), "ease-out"],
        [900, T(0, hand), "ease-in"], [1100, T(0, floor), "ease-out"], [1200, T(0, low), "ease-in"], [1325, T(0, floor), "ease-out"], [1450, T(0, low), "ease-in"],
        [1550, T(0, floor), "ease-out"], [1650, T(0, hand), "ease-in"], [1850, T(0, floor), "ease-out"], [2050, T(0, hand), "ease-in"], [2250, T(0, floor), "ease-out"], [2400, T(0, hand)]]);
      track(defender(), total, [[0, stand(194, GROUND, 0.92)], [1000, stand(194, GROUND, 0.92)], [1200, stand(176, GROUND, 0.9)], [1450, stand(170, GROUND, 0.92)],
        [1600, stand(168, GROUND, 1, -28), "ease-in"], [1850, stand(162, GROUND - 4, 1, -90)], [1950, stand(162, GROUND - 9, 1, -90)], [2050, stand(162, GROUND - 4, 1, -90)]]);
      track(dArm(), total, [[0, R(-50)], [1450, R(-50)], [1700, R(-140)], [1900, R(-100)]]);
      boom(total, 1850, "ANKLE BREAKER!", 28);
      return total;
    },
    3() {   // layup over a late contest
      const total = 2800;
      track(baller(), total, [[0, stand(185)], [900, stand(268), "ease-out"], [1250, stand(282, GROUND - 38), "ease-in"], [1650, stand(284)]]);
      run(total, 0, 900);
      track(arm(), total, [[900, R(0)], [1150, R(-125)], [1600, R(-40)], [1900, R(0)]]);
      shot(total, 1150, 294, 96, 68, 330, [[0, T(201, 0)], [900, T(284, 0)]], [[0, T(0, HOLD)], [900, T(0, HOLD)]]);
      track(defender(), total, [[0, stand(326)], [1100, stand(322, GROUND, 0.88)], [1400, stand(322, GROUND - 24), "ease-in"], [1750, stand(324)]]);
      track(dArm(), total, [[1000, R(0)], [1300, R(-125)], [1800, R(0)]]);
      return total;
    },
    4() {   // floater over the big man
      const total = 2900;
      track(baller(), total, [[0, stand(170)], [600, stand(224), "ease-out"], [880, stand(230, GROUND - 22), "ease-in"], [1200, stand(234)]]);
      run(total, 0, 600);
      track(arm(), total, [[600, R(0)], [850, R(-120)], [1400, R(-30)], [1700, R(0)]]);
      shot(total, 850, 243, 106, 14, 840, [[0, T(186, 0)], [600, T(240, 0)]], [[0, T(0, HOLD)], [600, T(0, HOLD)]]);
      track(defender(), total, [[0, stand(280)], [800, stand(276, GROUND, 0.86)], [1050, stand(274, GROUND - 30), "ease-in"], [1400, stand(274)]]);
      track(dArm(), total, [[650, R(0)], [950, R(-130)], [1500, R(-60)], [1900, R(0)]]);
      return total;
    },
    5() {   // free throw, with the defender waiting on the lane for a rebound that never comes
      const total = 2800, x = FT_X;
      track(baller(), total, [[250, stand(x)], [550, stand(x, GROUND, 0.86)], [800, stand(x, GROUND - 5), "ease-out"], [1050, stand(x)]]);
      track(arm(), total, [[550, R(-20)], [800, R(-125)], [1500, R(-110)], [1900, R(0)]]);
      shot(total, 800, x + 12, 102, 34, 760, [[0, T(x + 16, 0)]], [[0, T(0, HOLD)], [550, T(0, HOLD + 4)]]);
      track(defender(), total, [[0, stand(272, GROUND, 0.94)], [1350, stand(272, GROUND, 0.86)], [1560, stand(274, GROUND - 16), "ease-in"], [1800, stand(274)], [2100, stand(274, GROUND, 0.9)]]);
      track(dArm(), total, [[1300, R(0)], [1560, R(-130)], [1900, R(20)]]);
      return total;
    },
    6() {   // three-pointer over a closeout
      const total = 3200, x = THREE_X;
      track(baller(), total, [[250, stand(x)], [550, stand(x, GROUND, 0.84)], [800, stand(x, GROUND - 16), "ease-out"], [1100, stand(x)]]);
      track(arm(), total, [[550, R(-20)], [800, R(-125)], [1700, R(-110)], [2100, R(0)]]);
      shot(total, 800, x + 12, 92, 2, 1180, [[0, T(x + 16, 0)]], [[0, T(0, HOLD)], [550, T(0, HOLD + 4)]]);
      track(defender(), total, [[0, stand(235)], [750, stand(146), "ease-out"], [1000, stand(140, GROUND - 22), "ease-in"], [1300, stand(138)]]);
      run(total, 0, 750, ".defender");
      track(dArm(), total, [[550, R(0)], [850, R(-130)], [1500, R(-40)], [2000, R(0)]]);
      return total;
    },
    7() {   // poster dunk: the defender jumps, gets dunked on, and ends up on the floor
      const total = 4100, slam = 1400;
      track(baller(), total, [[0, stand(100)], [1000, stand(252), "ease-out"], [slam, stand(292, 112)], [1800, stand(292, 112), "ease-in"], [2100, stand(258)],
        [2300, stand(258, GROUND - 13), "ease-out"], [2500, stand(258)], [2700, stand(258, GROUND - 13), "ease-out"], [2900, stand(258)]]);
      run(total, 0, 1000);
      track(arm(), total, [[1000, R(0)], [1300, R(-150)], [slam + 30, R(-55)], [1800, R(-95)], [2100, R(-125)]]);
      track(q(".ball-x"), total, [[0, T(116, 0)], [1000, T(268, 0)], [slam, T(RIM_X, 0)], [slam + 900, T(RIM_X + 6, 0)]]);
      track(q(".ball-y"), total, [[0, T(0, HOLD)], [1000, T(0, HOLD), "ease-out"], [1300, T(0, 50), "ease-in"], [slam, T(0, RIM_Y - 4), "ease-in"],
        [slam + 200, T(0, GROUND - 6), "ease-out"], [slam + 380, T(0, GROUND - 34), "ease-in"], [slam + 560, T(0, GROUND - 6), "ease-out"], [slam + 680, T(0, GROUND - 16), "ease-in"], [slam + 800, T(0, GROUND - 6)]]);
      track(defender(), total, [[0, stand(300)], [1050, stand(298, GROUND, 0.86)], [1330, stand(300, GROUND - 28), "ease-out"], [slam, stand(302, GROUND - 26, 1, 8), "ease-in"],
        [slam + 330, stand(292, GROUND - 4, 1, 90)], [slam + 430, stand(292, GROUND - 10, 1, 90)], [slam + 530, stand(292, GROUND - 4, 1, 90)]]);
      track(dArm(), total, [[1000, R(0)], [1300, R(-130)], [slam + 300, R(-170)]]);
      track(q(".net"), total, [[slam, "scaleY(1)"], [slam + 100, "scaleY(1.6)"], [slam + 400, "scaleY(1)"]]);
      track(q(".hoop"), total, [[slam, R(0)], [slam + 70, R(5)], [slam + 150, R(-4)], [slam + 230, R(3)], [slam + 320, R(-1.5)], [slam + 420, R(0)]]);
      track(q(".shake"), total, [[slam, T(0, 0)], [slam + 50, T(-4, 3)], [slam + 100, T(4, -2)], [slam + 150, T(-3, 2)], [slam + 200, T(2, -1)], [slam + 260, T(0, 0)]]);
      track(q(".flash"), total, [[slam, 0], [slam + 40, 0.85], [slam + 320, 0]], "opacity");
      boom(total, slam + 60, "POSTERIZED!", 40);
      const colors = ["#ff7a1a", "#2fbf71", "#38bdf8", "#ffd23f", "#ef4b4b", "#ffffff"];
      const box = q(".confetti");
      for (let i = 0; i < 40; i++) {
        const piece = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        piece.setAttribute("width", 5); piece.setAttribute("height", 8); piece.setAttribute("fill", colors[i % colors.length]);
        box.append(piece);
        const x = 10 + Math.random() * 340, drift = (Math.random() - 0.5) * 60, spin = (Math.random() - 0.5) * 900;
        anims.push(piece.animate(
          [{ transform: `${T(x, -12)} rotate(0deg)`, opacity: 1 }, { transform: `${T(x + drift, 215)} rotate(${spin}deg)`, opacity: 1 }],
          { duration: 1300 + Math.random() * 900, delay: slam + Math.random() * 700, fill: "both", easing: "ease-in" }));
      }
      return total;
    },
  };

  function finish() {
    clearTimeout(timer);
    anims.forEach((a) => a.cancel());
    anims = [];
    const next = onDone;
    onDone = null;
    if (next) next();
  }

  function play(step, done) {
    step = Math.max(1, Math.min(7, step));
    onDone = done;
    $("cut-step").textContent = `Step ${step} of 7`;
    $("cut-title").textContent = NAMES[step - 1];
    $("screen-cutscene").classList.toggle("is-dunk", step === 7);

    const pips = $("cut-steps");
    pips.replaceChildren();
    for (let i = 1; i <= 7; i++) {
      const pip = document.createElement("span");
      pip.className = i < step ? "done" : i === step ? "now" : "";
      pips.append(pip);
    }

    $("scene").innerHTML = sceneMarkup();
    $("btn-skip").onclick = finish;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // no motion wanted: show the two players standing for a moment
      baller().style.transform = stand(150);
      defender().style.transform = stand(200);
      q(".ball-x").style.transform = T(166, HOLD);
      timer = setTimeout(finish, 1400);
      return;
    }
    const total = SCENES[step]();
    timer = setTimeout(finish, total + 450);
  }

  window.Cutscene = { play, names: NAMES };
})();
