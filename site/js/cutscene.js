/* Das Trivia: the little cutscene between questions.
   Each correct answer moves the player up one step, and the robot baller does that step's move:
   1 grab the ball, 2 dribble, 3 layup, 4 floater, 5 free throw, 6 three-pointer, 7 slam dunk.
   Use: Cutscene.play(step, onDone). */
(() => {
  "use strict";

  const NAMES = ["Grab the ball", "Dribble", "Layup", "Floater", "Free throw", "Three-pointer", "SLAM DUNK!"];
  const GROUND = 170, RIM_X = 309, RIM_Y = 84;
  const FT_X = 213, THREE_X = 100;      // where the player stands for a free throw and a three

  let anims = [], timer = null, onDone = null;

  const $ = (id) => document.getElementById(id);
  const q = (selector) => document.querySelector("#scene " + selector);
  const T = (x, y) => `translate(${x}px, ${y}px)`;
  const R = (deg) => `rotate(${deg}deg)`;

  function sceneMarkup() {
    return `
<svg viewBox="0 0 360 210" role="img" aria-label="A robot basketball player on a court">
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

    <g class="baller">
      <ellipse cx="0" cy="1" rx="13" ry="3" fill="#000" opacity=".28"/>
      <g class="leg leg-a"><path d="M-4 -22 L-6 0" stroke="#cfd6e4" stroke-width="5" stroke-linecap="round"/><rect x="-10" y="-3" width="10" height="4" rx="2" fill="#ff7a1a"/></g>
      <g class="leg leg-b"><path d="M4 -22 L6 0" stroke="#cfd6e4" stroke-width="5" stroke-linecap="round"/><rect x="2" y="-3" width="10" height="4" rx="2" fill="#ff7a1a"/></g>
      <rect x="-9" y="-46" width="18" height="26" rx="5" fill="#ff7a1a"/>
      <rect x="-9" y="-36" width="18" height="3" fill="#fff" opacity=".85"/>
      <path d="M0 -64 V-71" stroke="#cfd6e4" stroke-width="2"/><circle cx="0" cy="-72" r="2.2" fill="#38bdf8"/>
      <rect x="-9" y="-64" width="18" height="16" rx="5" fill="#cfd6e4"/>
      <rect x="-2" y="-59" width="11" height="5" rx="2.5" fill="#38bdf8"/>
      <g class="arm"><path d="M2 -42 L14 -30" stroke="#cfd6e4" stroke-width="4.5" stroke-linecap="round"/><circle cx="14" cy="-30" r="3" fill="#aab3c5"/></g>
    </g>

    <g class="ball-x"><g class="ball-y">
      <circle r="6" fill="#ff7a1a" stroke="#7a2d00" stroke-width="1"/>
      <path d="M-6 0 H6 M0 -6 V6" stroke="#7a2d00" stroke-width=".8"/>
    </g></g>

    <g class="confetti"></g>
    <rect class="flash" width="360" height="210" fill="#fff" opacity="0"/>
    <text class="boom" x="150" y="70" text-anchor="middle" opacity="0">SLAM DUNK!</text>
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

  function run(total, from, to) {            // swing the legs while running
    const a = [], b = [];
    for (let t = from, i = 0; t <= to; t += 110, i++) { a.push([t, R(i % 2 ? 30 : -30)]); b.push([t, R(i % 2 ? -30 : 30)]); }
    a.push([to + 80, R(0)]); b.push([to + 80, R(0)]);
    track(q(".leg-a"), total, a); track(q(".leg-b"), total, b);
  }

  // The ball leaves the hands at t0, arcs up to peakY, drops through the rim, and bounces.
  function shot(total, t0, fromX, fromY, peakY, flight, beforeX = [], beforeY = []) {
    const made = t0 + flight;
    track(q(".ball-x"), total, [...beforeX, [t0, T(fromX, 0)], [made, T(RIM_X, 0)], [made + 700, T(RIM_X - 8, 0)]]);
    track(q(".ball-y"), total, [...beforeY, [t0, T(0, fromY), "ease-out"], [t0 + flight * 0.5, T(0, peakY), "ease-in"],
      [made, T(0, RIM_Y), "ease-in"], [made + 280, T(0, GROUND - 6), "ease-out"], [made + 430, T(0, GROUND - 20), "ease-in"], [made + 580, T(0, GROUND - 6)]]);
    track(q(".net"), total, [[made, "scaleY(1)"], [made + 120, "scaleY(1.4)"], [made + 340, "scaleY(1)"]]);
  }

  const stand = (x, y = GROUND, squash = 1) => `${T(x, y)} scale(1, ${squash})`;

  const SCENES = {
    1() {   // the ball rolls in and gets picked up
      const total = 2500, x = 150;
      track(q(".baller"), total, [[900, stand(x)], [1200, stand(x, GROUND, 0.82)], [1500, stand(x)], [1750, stand(x, GROUND - 9), "ease-out"], [2000, stand(x)]]);
      track(q(".arm"), total, [[950, R(0)], [1200, R(45)], [1500, R(0)], [1750, R(-125)]]);
      track(q(".ball-x"), total, [[0, T(350, 0), "ease-out"], [1000, T(x + 17, 0)], [1500, T(x + 15, 0)], [1750, T(x + 12, 0)]]);
      track(q(".ball-y"), total, [[1200, T(0, GROUND - 6)], [1500, T(0, GROUND - 30)], [1750, T(0, GROUND - 74), "ease-out"], [2000, T(0, GROUND - 66)]]);
      return total;
    },
    2() {   // dribbling
      const total = 2500, x = 150, hand = GROUND - 30, floor = GROUND - 6;
      const ball = [], arm = [], body = [];
      for (let t = 150, i = 0; i < 5; i++, t += 430) {
        ball.push([t, T(0, hand), "ease-in"], [t + 200, T(0, floor), "ease-out"]);
        arm.push([t, R(-8)], [t + 200, R(22)]);
        body.push([t, stand(x)], [t + 200, stand(x, GROUND, 0.94)]);
      }
      ball.push([total - 150, T(0, hand)]); arm.push([total - 150, R(-8)]); body.push([total - 150, stand(x)]);
      track(q(".ball-x"), total, [[0, T(x + 17, 0)]]);
      track(q(".ball-y"), total, ball); track(q(".arm"), total, arm); track(q(".baller"), total, body);
      return total;
    },
    3() {   // layup
      const total = 2700;
      track(q(".baller"), total, [[0, stand(185)], [900, stand(272), "ease-out"], [1250, stand(286, GROUND - 36), "ease-in"], [1650, stand(291)]]);
      run(total, 0, 900);
      track(q(".arm"), total, [[900, R(0)], [1150, R(-125)], [1600, R(-40)], [1900, R(0)]]);
      shot(total, 1150, 298, 98, 70, 330, [[0, T(200, 0)], [900, T(287, 0)]], [[0, T(0, GROUND - 30)], [900, T(0, GROUND - 30)]]);
      return total;
    },
    4() {   // floater
      const total = 2800;
      track(q(".baller"), total, [[0, stand(185)], [600, stand(236), "ease-out"], [880, stand(242, GROUND - 22), "ease-in"], [1200, stand(246)]]);
      run(total, 0, 600);
      track(q(".arm"), total, [[600, R(0)], [850, R(-120)], [1400, R(-30)], [1700, R(0)]]);
      shot(total, 850, 255, 108, 18, 820, [[0, T(200, 0)], [600, T(251, 0)]], [[0, T(0, GROUND - 30)], [600, T(0, GROUND - 30)]]);
      return total;
    },
    5() {   // free throw
      const total = 2700, x = FT_X;
      track(q(".baller"), total, [[250, stand(x)], [550, stand(x, GROUND, 0.86)], [800, stand(x, GROUND - 5), "ease-out"], [1050, stand(x)]]);
      track(q(".arm"), total, [[550, R(-20)], [800, R(-125)], [1500, R(-110)], [1900, R(0)]]);
      shot(total, 800, x + 12, 104, 36, 760, [[0, T(x + 15, 0)]], [[0, T(0, GROUND - 30)], [550, T(0, GROUND - 26)]]);
      return total;
    },
    6() {   // three-pointer
      const total = 3100, x = THREE_X;
      track(q(".baller"), total, [[250, stand(x)], [550, stand(x, GROUND, 0.84)], [800, stand(x, GROUND - 16), "ease-out"], [1100, stand(x)]]);
      track(q(".arm"), total, [[550, R(-20)], [800, R(-125)], [1700, R(-110)], [2100, R(0)]]);
      shot(total, 800, x + 12, 94, 4, 1180, [[0, T(x + 15, 0)]], [[0, T(0, GROUND - 30)], [550, T(0, GROUND - 26)]]);
      return total;
    },
    7() {   // slam dunk, with the works
      const total = 3900, slam = 1400;
      track(q(".baller"), total, [[0, stand(105)], [1000, stand(262), "ease-out"], [slam, stand(296, 114)], [1800, stand(296, 114), "ease-in"], [2100, stand(288)],
        [2300, stand(288, GROUND - 12), "ease-out"], [2500, stand(288)], [2700, stand(288, GROUND - 12), "ease-out"], [2900, stand(288)]]);
      run(total, 0, 1000);
      track(q(".arm"), total, [[1000, R(0)], [1300, R(-150)], [slam + 30, R(-55)], [1800, R(-95)], [2100, R(-125)]]);
      track(q(".ball-x"), total, [[0, T(120, 0)], [1000, T(277, 0)], [slam, T(RIM_X, 0)], [slam + 900, T(RIM_X - 10, 0)]]);
      track(q(".ball-y"), total, [[0, T(0, GROUND - 30)], [1000, T(0, GROUND - 30), "ease-out"], [1300, T(0, 52), "ease-in"], [slam, T(0, RIM_Y - 4), "ease-in"],
        [slam + 200, T(0, GROUND - 6), "ease-out"], [slam + 380, T(0, GROUND - 34), "ease-in"], [slam + 560, T(0, GROUND - 6), "ease-out"], [slam + 680, T(0, GROUND - 16), "ease-in"], [slam + 800, T(0, GROUND - 6)]]);
      track(q(".net"), total, [[slam, "scaleY(1)"], [slam + 100, "scaleY(1.6)"], [slam + 400, "scaleY(1)"]]);
      track(q(".hoop"), total, [[slam, R(0)], [slam + 70, R(5)], [slam + 150, R(-4)], [slam + 230, R(3)], [slam + 320, R(-1.5)], [slam + 420, R(0)]]);
      track(q(".shake"), total, [[slam, T(0, 0)], [slam + 50, T(-4, 3)], [slam + 100, T(4, -2)], [slam + 150, T(-3, 2)], [slam + 200, T(2, -1)], [slam + 260, T(0, 0)]]);
      track(q(".flash"), total, [[slam, 0], [slam + 40, 0.85], [slam + 320, 0]], "opacity");
      track(q(".boom"), total, [[slam, 0], [slam + 60, 1]], "opacity");
      track(q(".boom"), total, [[slam, "scale(.2)"], [slam + 220, "scale(1.18)", "ease-out"], [slam + 360, "scale(1)"], [3300, "scale(1.06)"], [3600, "scale(1)"]]);
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
      // no motion wanted: show the player holding the ball for a moment
      q(".baller").style.transform = stand(150);
      q(".ball-x").style.transform = T(165, GROUND - 30);
      timer = setTimeout(finish, 1400);
      return;
    }
    const total = SCENES[step]();
    timer = setTimeout(finish, total + 450);
  }

  window.Cutscene = { play, names: NAMES };
})();
