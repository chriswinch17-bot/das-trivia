/* EquipoGPT Analytics (?mode=analytics). Not a game: this season's power rankings and every team's
   history, year by year. Everything comes from data/analytics.json, made by scripts/build_analytics.py
   (rebuilt every night). Nothing here is saved or sent anywhere. */
(() => {
  "use strict";

  const params = new URLSearchParams(location.search);
  if (params.get("mode") !== "analytics") return;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const SVG = "http://www.w3.org/2000/svg";
  const PART_NAMES = { record: "Record", points: "Points per week", allplay: "All-play record", roster: "Roster strength (top 10 players)", form: "Form (last 2 weeks)" };
  // up to 3 highlighted teams; these three colours stay apart for colour-blind eyes too
  const HIGHLIGHT = ["#3987e5", "#d95926", "#199e70"];
  const ordinal = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? "th" : { 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th");
  const shortSeason = (s) => `${s.slice(2, 4)}-${s.slice(7, 9)}`;

  let data;

  function show() {
    for (const el of document.querySelectorAll(".screen")) el.hidden = el.id !== "screen-analytics";
    $("game-tag").textContent = "Analytics";
    document.title = "EquipoGPT Analytics · Das Trivia";
  }

  /* ---------- power rankings ---------- */
  function sparkline(values) {
    if (values.length < 2) return "";
    const w = 64, h = 26, lo = Math.min(...values), hi = Math.max(...values);
    const x = (i) => 2 + (i / (values.length - 1)) * (w - 4);
    const y = (v) => hi === lo ? h / 2 : h - 3 - ((v - lo) / (hi - lo)) * (h - 6);
    const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    const last = values.length - 1;
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${pts}"/>` +
      `<circle cx="${x(last).toFixed(1)}" cy="${y(values[last]).toFixed(1)}" r="2.6"/></svg>`;
  }

  function radar(parts) {
    const axes = [["points", "Points"], ["allplay", "All-play"], ["record", "Record"], ["form", "Form"], ["roster", "Roster"], ["luck", "Luck"]];
    const c = 100, r = 66;
    const at = (i, v) => {
      const a = -Math.PI / 2 + (i / axes.length) * Math.PI * 2;
      return [c + Math.cos(a) * r * v, c + Math.sin(a) * r * v];
    };
    const ring = (v) => axes.map((_, i) => at(i, v).map((n) => n.toFixed(1)).join(",")).join(" ");
    let out = `<svg class="radar" viewBox="0 0 200 200" role="img" aria-label="${esc(axes.map(([k, n]) => `${n} ${parts[k]}`).join(", "))}">`;
    for (const v of [0.25, 0.5, 0.75, 1]) out += `<polygon class="rg" points="${ring(v)}"/>`;
    axes.forEach(([k, name], i) => {
      const [x, y] = at(i, 1), [lx, ly] = at(i, 1.24);
      out += `<line class="rg" x1="${c}" y1="${c}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/>`;
      out += `<text x="${lx.toFixed(1)}" y="${(ly + 4).toFixed(1)}" text-anchor="middle">${name}</text>`;
    });
    out += `<polygon class="rv" points="${axes.map(([k], i) => at(i, Math.max(0.04, parts[k] / 100)).map((n) => n.toFixed(1)).join(",")).join(" ")}"/>`;
    axes.forEach(([k], i) => { const [x, y] = at(i, Math.max(0.04, parts[k] / 100)); out += `<circle class="rd" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5"/>`; });
    return out + "</svg>";
  }

  function move(t) {
    if (t.prev_rank == null) return `<span class="mv same" title="First week">NEW</span>`;
    const d = t.prev_rank - t.rank;
    if (d > 0) return `<span class="mv up" aria-label="Up ${d}">▲${d}</span>`;
    if (d < 0) return `<span class="mv down" aria-label="Down ${-d}">▼${-d}</span>`;
    return `<span class="mv same" aria-label="No change">–</span>`;
  }

  function renderRankings() {
    const list = $("pr-list");
    $("pr-empty").hidden = data.rankings.length > 0;
    $("an-weights").innerHTML = Object.entries(data.weights).map(([k, w]) => `<li><b>${Math.round(w * 100)}%</b> ${PART_NAMES[k] || k}</li>`).join("");
    const n = data.rankings.length;
    list.innerHTML = data.rankings.map((t, i) => {
      const luck = t.luck > 0.25 ? `+${t.luck} 🍀` : t.luck < -0.25 ? `${t.luck} 😤` : `${t.luck}`;
      return `<li class="pr rank-${t.rank} tier-${t.tier.split(" ")[0].toLowerCase()}" style="animation-delay:${(n - 1 - i) * 70}ms">
        <button type="button" class="pr-top" aria-expanded="false">
          <span class="pr-rank">${t.rank}</span>
          <span class="pr-main">
            <span class="pr-name">${esc(t.team)} <span class="pr-mgr">(${esc(t.name)})</span></span>
            <span class="pr-meta">${move(t)}<span class="tier">${t.tier_icon} ${esc(t.tier)}</span><span>${esc(t.record)}</span></span>
            <span class="pr-bar"><span style="width:${Math.max(2, t.score)}%"></span></span>
          </span>
          <span class="pr-right"><b>${Math.round(t.score)}</b>${sparkline(t.weekly)}</span>
        </button>
        <p class="pr-take"><img src="images/host.webp" alt="EquipoGPT says">${esc(t.take)}</p>
        <div class="pr-more" hidden>
          ${radar(t.parts)}
          <dl class="pr-stats">
            <div><dt>Points / week</dt><dd>${Math.round(t.ppw)}</dd></div>
            <div><dt>Last 2 weeks</dt><dd>${Math.round(t.form)}</dd></div>
            <div><dt>All-play</dt><dd>${esc(t.allplay)}</dd></div>
            <div><dt>Luck (wins)</dt><dd>${luck}</dd></div>
            <div><dt>Top 10 / week</dt><dd>${Math.round(t.roster)}</dd></div>
            <div><dt>Opp. points / wk</dt><dd>${Math.round(t.sos)}</dd></div>
          </dl>
          <p class="pr-top3"><span>Best players:</span> ${t.top_players.map((p) => `${esc(p.name)} <i>${Math.round(p.avg)}</i>`).join(" · ")}</p>
        </div>
      </li>`;
    }).join("");
    for (const btn of list.querySelectorAll(".pr-top")) {
      btn.onclick = () => {
        const more = btn.parentElement.querySelector(".pr-more");
        more.hidden = !more.hidden;
        btn.setAttribute("aria-expanded", String(!more.hidden));
        btn.parentElement.classList.toggle("open", !more.hidden);
      };
    }
  }

  /* ---------- season by season ---------- */
  const METRICS = {
    finish: { label: "Finish", invert: true, min: 1, max: 12, ticks: [1, 3, 6, 9, 12], fmt: (v) => ordinal(v) },
    win_pct: { label: "Win %", min: 0, max: 100, ticks: [0, 25, 50, 75, 100], fmt: (v) => `${Math.round(v)}%` },
    ppw: { label: "Points per week", auto: true, fmt: (v) => Math.round(v) },
  };
  let metric = "finish";
  let picked = [];

  function colorOf(manager) {
    const i = picked.indexOf(manager);
    return i < 0 ? null : HIGHLIGHT[i];
  }

  function renderChips() {
    $("hist-chips").innerHTML = data.history.teams.slice().sort((a, b) => a.name.localeCompare(b.name)).map((t) => {
      const c = colorOf(t.manager);
      return `<button type="button" class="chip${c ? " on" : ""}" data-m="${t.manager}" aria-pressed="${!!c}"` +
        `${c ? ` style="--c:${c}"` : ""}><span class="dot"></span>${esc(t.name)}</button>`;
    }).join("");
    for (const b of $("hist-chips").querySelectorAll(".chip")) b.onclick = () => toggle(b.dataset.m);
  }

  function toggle(manager) {
    if (picked.includes(manager)) picked = picked.filter((m) => m !== manager);
    else picked = [...picked.slice(-(HIGHLIGHT.length - 1)), manager];
    renderChips();
    renderChart();
  }

  function el(name, attrs, parent) {
    const node = document.createElementNS(SVG, name);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    if (parent) parent.appendChild(node);
    return node;
  }

  function renderChart() {
    const box = $("hist-chart");
    const M = METRICS[metric];
    const seasons = data.history.seasons;
    const teams = data.history.teams;
    const W = Math.max(300, Math.min(box.clientWidth || 340, 620));
    const H = Math.round(Math.min(380, Math.max(300, W * 0.78)));
    const pad = { l: 36, r: 74, t: 14, b: 30 };
    let lo = M.min, hi = M.max, ticks = M.ticks;
    if (M.auto) {
      const vals = teams.flatMap((t) => t.seasons.map((s) => s[metric]));
      lo = Math.floor(Math.min(...vals) / 50) * 50; hi = Math.ceil(Math.max(...vals) / 50) * 50;
      ticks = [];
      for (let v = lo; v <= hi; v += 50) ticks.push(v);
    }
    const x = (i) => pad.l + (seasons.length === 1 ? 0 : (i / (seasons.length - 1)) * (W - pad.l - pad.r));
    const y = (v) => {
      const f = (v - lo) / (hi - lo || 1);
      return pad.t + (M.invert ? f : 1 - f) * (H - pad.t - pad.b);
    };

    box.innerHTML = "";
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img", "aria-label": `${M.label} by season for every team` }, box);
    const grid = el("g", { class: "grid" }, svg);
    for (const t of ticks) {
      el("line", { x1: pad.l, x2: W - pad.r + 6, y1: y(t), y2: y(t) }, grid);
      el("text", { x: pad.l - 8, y: y(t) + 4, "text-anchor": "end" }, grid).textContent = M.fmt(t);
    }
    if (metric === "finish") {   // the playoff line: top 6 make it
      const py = (y(6) + y(7)) / 2;
      el("line", { class: "playoff", x1: pad.l, x2: W - pad.r + 6, y1: py, y2: py }, svg);
      el("text", { class: "playoff-label", x: pad.l + 4, y: py - 4 }, svg).textContent = "playoff line";
    }
    seasons.forEach((s, i) => {
      const live = teams.some((t) => t.seasons.some((p) => p.season === s && !p.final));
      el("text", { class: "xlab", x: x(i), y: H - 8, "text-anchor": "middle" }, svg).textContent = shortSeason(s) + (live ? "*" : "");
    });

    // grey lines first, highlighted teams on top
    const order = teams.slice().sort((a, b) => (colorOf(a.manager) ? 1 : 0) - (colorOf(b.manager) ? 1 : 0)
      || picked.indexOf(a.manager) - picked.indexOf(b.manager));
    const labels = [];
    const points = [];
    for (const t of order) {
      const c = colorOf(t.manager);
      const g = el("g", { class: `team${c ? " hi" : ""}`, "data-m": t.manager, style: c ? `--c:${c}` : "" }, svg);
      const ps = t.seasons.map((p) => ({ ...p, i: seasons.indexOf(p.season) })).filter((p) => p.i >= 0);
      const solid = ps.filter((p) => p.final), lastFinal = solid[solid.length - 1];
      const path = (arr) => arr.map((p, k) => `${k ? "L" : "M"}${x(p.i).toFixed(1)},${y(p[metric]).toFixed(1)}`).join("");
      if (solid.length > 1) el("path", { class: "ln", d: path(solid) }, g);
      const live = ps.filter((p) => !p.final);
      if (live.length) el("path", { class: "ln live", d: path(lastFinal ? [lastFinal, ...live] : live) }, g);
      el("path", { class: "hit", d: path(ps) }, g);
      for (const p of ps) {
        const cx = x(p.i), cy = y(p[metric]);
        if (p.champion) el("circle", { class: "champ", cx, cy, r: c ? 8 : 6 }, g);
        el("circle", { class: `pt${p.final ? "" : " open"}`, cx, cy, r: c ? 4.5 : 2.6 }, g);
        points.push({ t, p, cx, cy });
      }
      const end = ps[ps.length - 1];
      if (end && (metric === "finish" || c)) labels.push({ t, c, y: y(end[metric]), x: x(end.i) });
      g.addEventListener("click", () => toggle(t.manager));
    }
    // end labels: spread apart so they never sit on top of each other
    labels.sort((a, b) => a.y - b.y);
    for (let k = 1; k < labels.length; k++) labels[k].y = Math.max(labels[k].y, labels[k - 1].y + 12.5);
    const overflow = labels.length ? labels[labels.length - 1].y - (H - pad.b) : 0;
    if (overflow > 0) labels.forEach((l) => { l.y -= overflow; });
    for (const l of labels) {
      el("text", { class: `end${l.c ? " hi" : ""}`, x: l.x + 9, y: l.y + 4, style: l.c ? `--c:${l.c}` : "" }, svg).textContent = l.t.name;
    }

    // tooltip: nearest point to the finger / mouse
    const tip = document.createElement("div");
    tip.className = "hist-tip"; tip.hidden = true; box.appendChild(tip);
    const near = (ev) => {
      const r = svg.getBoundingClientRect();
      const mx = (ev.clientX - r.left) * (W / r.width), my = (ev.clientY - r.top) * (H / r.height);
      let best = null, bd = 22 * 22;
      for (const q of points) {
        const d = (q.cx - mx) ** 2 + (q.cy - my) ** 2;
        if (d < bd || (d === bd && colorOf(q.t.manager))) { bd = d; best = q; }
      }
      return best ? { ...best, sx: best.cx * (r.width / W), sy: best.cy * (r.height / H) } : null;
    };
    const showTip = (ev) => {
      const q = near(ev);
      if (!q) { tip.hidden = true; return; }
      const p = q.p;
      tip.innerHTML = `<b>${esc(p.team)} (${esc(q.t.name)})</b><span>${esc(p.season)}${p.final ? "" : " · so far"}</span>` +
        `<span>${p.champion ? "🏆 Champion" : `Finished ${ordinal(p.finish)}`} · ${esc(p.record)}</span>` +
        `<span>${p.win_pct}% wins · ${Math.round(p.ppw)} pts/week</span>`;
      tip.hidden = false;
      const left = Math.min(Math.max(q.sx - tip.offsetWidth / 2, 0), box.clientWidth - tip.offsetWidth);
      tip.style.left = `${left}px`;
      tip.style.top = `${Math.max(0, q.sy - tip.offsetHeight - 12)}px`;
    };
    svg.addEventListener("pointermove", showTip);
    svg.addEventListener("pointerdown", showTip);   // a tap on a phone
    svg.addEventListener("pointerleave", () => { tip.hidden = true; });

    $("hist-foot").textContent = `* ${data.history.seasons[data.history.seasons.length - 1]} is still being played: dotted line, standings so far. ` +
      `Gold ring = champion. Finish = final place, playoffs included.`;
  }

  function renderTable() {
    const seasons = data.history.seasons;
    const head = `<thead><tr><th>Team</th>${seasons.map((s) => `<th>${shortSeason(s)}</th>`).join("")}</tr></thead>`;
    const rows = data.history.teams.slice().sort((a, b) => a.name.localeCompare(b.name)).map((t) => `<tr><th>${esc(t.name)}</th>${seasons.map((s) => {
      const p = t.seasons.find((q) => q.season === s);
      return `<td>${p ? `${p.champion ? "🏆 " : ""}${ordinal(p.finish)}<small>${esc(p.record)} · ${Math.round(p.ppw)}</small>` : "–"}</td>`;
    }).join("")}</tr>`).join("");
    $("hist-table").innerHTML = head + `<tbody>${rows}</tbody>`;
  }

  async function start() {
    show();
    try {
      const response = await fetch("data/analytics.json", { cache: "no-cache" });
      if (!response.ok) throw new Error(response.status);
      data = await response.json();
    } catch (error) {
      $("an-sub").textContent = "The analytics file didn't load. Try refreshing.";
      return;
    }
    $("an-sub").textContent = data.through_week
      ? `${data.season} · through week ${data.through_week} · updated every night`
      : `${data.season} · updated every night`;
    renderRankings();
    picked = data.rankings.slice(0, 3).map((t) => t.manager);   // start with this week's top 3
    if (!picked.length) picked = data.history.teams.slice(0, 3).map((t) => t.manager);
    renderChips();
    renderChart();
    renderTable();
    for (const b of $("hist-metric").querySelectorAll("button")) {
      b.onclick = () => {
        metric = b.dataset.metric;
        for (const o of $("hist-metric").querySelectorAll("button")) o.classList.toggle("on", o === b);
        renderChart();
      };
    }
    let wide = window.innerWidth;
    window.addEventListener("resize", () => { if (Math.abs(window.innerWidth - wide) > 30) { wide = window.innerWidth; renderChart(); } });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
