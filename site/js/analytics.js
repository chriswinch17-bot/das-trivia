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

  const pctText = (p) => (p >= 99.5 ? ">99%" : p > 0 && p < 1 ? "<1%" : `${Math.round(p)}%`);
  function renderRankings() {
    const list = $("pr-list");
    $("pr-empty").hidden = data.rankings.length > 0;
    $("an-weights").innerHTML = Object.entries(data.weights).map(([k, w]) => `<li><b>${Math.round(w * 100)}%</b> ${PART_NAMES[k] || k}</li>`).join("");
    const n = data.rankings.length;
    list.innerHTML = data.rankings.map((t, i) => {
      const luck = t.luck > 0.25 ? `+${t.luck} 🍀` : t.luck < -0.25 ? `${t.luck} 😤` : `${t.luck}`;
      return `<li class="pr rank-${t.rank} tier-${t.tier.split(" ")[0].toLowerCase()}${t.fraud ? " is-fraud" : ""}${t.robbed ? " is-robbed" : ""}" id="pr-${t.manager}" style="animation-delay:${(n - 1 - i) * 70}ms">
        ${t.fraud ? '<span class="fraud-stamp" aria-label="Fraud alert">🚨 FRAUD</span>' : ""}
        ${t.robbed ? '<span class="fraud-stamp robbed-stamp" aria-label="Robbed">😤 ROBBED</span>' : ""}
        <button type="button" class="pr-top" aria-expanded="false">
          <span class="pr-rank">${t.rank}</span>
          <span class="pr-main">
            <span class="pr-name">${esc(t.team)} <span class="pr-mgr">(${esc(t.name)})</span></span>
            <span class="pr-meta">${move(t)}<span class="tier">${t.tier_icon} ${esc(t.tier)}</span><span>${esc(t.record)}</span></span>
            <span class="pr-bar"><span style="width:${Math.max(2, t.score)}%"></span></span>
            ${t.playoff_pct != null ? `<span class="pr-odds"><span class="po-pill${t.playoff_pct >= 50 ? " in" : ""}">🎟️ Playoffs <b>${pctText(t.playoff_pct)}</b></span>` +
              `<span>Bye <b>${pctText(t.bye_pct)}</b></span>${t.title_pct != null ? `<span>🏆 Title <b>${pctText(t.title_pct)}</b></span>` : ""}</span>` : ""}
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
    // Fraud Watch: teams winning more than their scoring has earned
    const frauds = data.rankings.filter((t) => t.fraud);
    const robbed = data.rankings.filter((t) => t.robbed);
    const fw = $("fraud-watch");
    fw.hidden = data.through_week < 3;
    const wins = (n) => `${Math.abs(n)} win${Math.abs(n) === 1 ? "" : "s"}`;
    fw.innerHTML = `<div class="fw-title">🚨 Fraud Watch <small>week ${data.through_week}</small></div>` + (frauds.length
      ? frauds.map((t) => `<button type="button" class="fw-row" data-m="${t.manager}"><b>${esc(t.team)} (${esc(t.name)})</b>
          <span>${esc(t.record)} for real, but ${esc(t.allplay)} against everyone. About ${wins(t.luck)} they haven't earned.</span></button>`).join("")
      : `<p class="fw-none">No frauds this week. Suspicious. EquipoGPT is still watching.</p>`) +
      (robbed.length ? `<div class="fw-title robbed">😤 Robbed</div>` + robbed.map((t) => `<button type="button" class="fw-row" data-m="${t.manager}"><b>${esc(t.team)} (${esc(t.name)})</b>
          <span>${esc(t.record)} for real, but ${esc(t.allplay)} against everyone. About ${wins(t.luck)} the schedule stole.</span></button>`).join("") : "");
    for (const b of fw.querySelectorAll(".fw-row")) b.onclick = () => {
      const card = $(`pr-${b.dataset.m}`);
      card.scrollIntoView({ block: "center", behavior: "smooth" });
      card.classList.add("flash"); setTimeout(() => card.classList.remove("flash"), 1600);
    };
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

  /* ---------- rivalries ---------- */
  let rvA = null, rvB = null;
  const rvName = (id) => data.rivalries.names[id] || id;
  const rvShort = (id) => rvName(id).slice(0, 3);
  function rvPair(a, b) {
    return data.rivalries.pairs.find((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a));
  }
  function rvRecord(p, me) {   // -> [wins, losses, ties] from me's side
    return p.a === me ? [p.a_wins, p.b_wins, p.ties] : [p.b_wins, p.a_wins, p.ties];
  }
  const rvText = ([w, l, t]) => `${w}-${l}${t ? `-${t}` : ""}`;

  function renderRivalGrid() {
    const ids = data.rivalries.managers;
    const head = `<thead><tr><th class="corner"></th>${ids.map((c) => `<th scope="col" title="${esc(rvName(c))}">${esc(rvShort(c))}</th>`).join("")}</tr></thead>`;
    const body = ids.map((r) => `<tr><th scope="row">${esc(rvName(r))}</th>${ids.map((c) => {
      if (r === c) return `<td class="self"></td>`;
      const p = rvPair(r, c);
      if (!p) return `<td class="none">–</td>`;
      const rec = rvRecord(p, r), diff = rec[0] - rec[1];
      const cls = diff > 0 ? "lead" : diff < 0 ? "trail" : "even";
      const strength = Math.min(1, Math.abs(diff) / 4);
      const on = (r === rvA && c === rvB) || (r === rvB && c === rvA);
      return `<td class="${cls}${on ? " on" : ""}${rec[2] ? " tie" : ""}" style="--s:${strength.toFixed(2)}"><button type="button" data-a="${r}" data-b="${c}"
        aria-label="${esc(rvName(r))} ${rvText(rec)} against ${esc(rvName(c))}">${rvText(rec)}</button></td>`;
    }).join("")}</tr>`).join("");
    $("rv-grid").innerHTML = head + `<tbody>${body}</tbody>`;
    for (const b of $("rv-grid").querySelectorAll("button")) b.onclick = () => { pickRivalry(b.dataset.a, b.dataset.b); $("rv-detail").scrollIntoView({ block: "start", behavior: "smooth" }); };
  }

  function renderRivalHeads() {
    const h = data.rivalries.headlines;
    const card = (key, label, line) => {
      const p = data.rivalries.pairs.find((x) => x.key === key);
      return p ? `<button type="button" class="rv-head" data-a="${p.a}" data-b="${p.b}"><small>${label}</small><b>${esc(rvName(p.a))} vs ${esc(rvName(p.b))}</b><span>${line(p)}</span></button>` : "";
    };
    $("rv-heads").innerHTML =
      card(h.lopsided, "Most one-sided", (p) => { const lead = p.a_wins >= p.b_wins ? p.a : p.b; return `${esc(rvName(lead))} leads ${rvText(rvRecord(p, lead))}`; }) +
      card(h.even, "Dead even", (p) => `${rvText(rvRecord(p, p.a))} after ${p.a_wins + p.b_wins + p.ties} meetings`) +
      card(h.blowout, "Biggest blowout", (p) => { const g = p.blowout; return `${Math.round(Math.abs(g.a_pts - g.b_pts))} points, ${esc(g.season)} wk ${g.week}`; });
    for (const b of $("rv-heads").querySelectorAll(".rv-head")) b.onclick = () => { pickRivalry(b.dataset.a, b.dataset.b); $("rv-detail").scrollIntoView({ block: "start", behavior: "smooth" }); };
  }

  function pickRivalry(a, b) {
    rvA = a; rvB = b;
    $("rv-a").value = a; $("rv-b").value = b;
    renderRivalGrid();
    renderRivalDetail();
  }

  function renderRivalDetail() {
    const box = $("rv-detail");
    if (!rvA || !rvB || rvA === rvB) { box.innerHTML = '<p class="an-note">Pick two different teams.</p>'; return; }
    const p = rvPair(rvA, rvB);
    if (!p) { box.innerHTML = `<p class="an-note">${esc(rvName(rvA))} and ${esc(rvName(rvB))} have never played.</p>`; return; }
    const A = rvA, B = rvB;
    const [aw, bw, t] = rvRecord(p, A);
    const ppg = (who) => (p.a === who ? p.a_ppg : p.b_ppg);
    const ptsOf = (g, who) => (p.a === who ? g.a_pts : g.b_pts);
    const total = aw + bw + t;
    const lead = aw === bw ? "All square." : `${esc(rvName(aw > bw ? A : B))} owns this one.`;
    const game = (g, label) => g ? `<div class="mg-pick"><small>${label}</small><b>${esc(rvName(g.winner || A))} ${Math.round(Math.max(g.a_pts, g.b_pts))}–${Math.round(Math.min(g.a_pts, g.b_pts))}</b>
      <span>${esc(g.season)}, week ${g.week} · ${Math.round(Math.abs(g.a_pts - g.b_pts))} point${Math.round(Math.abs(g.a_pts - g.b_pts)) === 1 ? "" : "s"}</span></div>` : "";
    const rows = [
      ...p.games.map((g) => ({ when: `${shortSeason(g.season)} · wk ${g.week}`, a: ptsOf(g, A), b: ptsOf(g, B), w: g.winner, flag: g.flagged })),
      ...p.playoffs.map((g) => ({ when: `${shortSeason(g.season)} · ${g.round}`, a: g.winner === A ? g.winner_points : g.loser_points,
        b: g.winner === B ? g.winner_points : g.loser_points, w: g.winner, playoff: true })),
    ];
    box.innerHTML = `
      <div class="rv-score">
        <div class="${aw > bw ? "win" : ""}"><span>${esc(rvName(A))}</span><b>${aw}</b></div>
        <i>${t ? `${t} tie${t > 1 ? "s" : ""}` : "vs"}</i>
        <div class="${bw > aw ? "win" : ""}"><b>${bw}</b><span>${esc(rvName(B))}</span></div>
      </div>
      <div class="tr-share rv-bar" aria-hidden="true"><span style="width:${total ? ((aw + t / 2) / total * 100).toFixed(1) : 50}%"></span></div>
      <p class="pr-take"><img src="images/host.webp" alt="EquipoGPT says">${lead} ${total} meeting${total === 1 ? "" : "s"}${p.playoffs.length ? `, ${p.playoffs.length} in the playoffs` : ""}.
        ${p.streak ? (p.streak.n > 1 ? `${esc(rvName(p.streak.who))} has won the last ${p.streak.n} in a row.` : `${esc(rvName(p.streak.who))} won the last meeting.`) : ""}</p>
      <dl class="pr-stats">
        <div><dt>${esc(rvName(A))} pts / game</dt><dd>${Math.round(ppg(A))}</dd></div>
        <div><dt>${esc(rvName(B))} pts / game</dt><dd>${Math.round(ppg(B))}</dd></div>
        <div><dt>Playoff meetings</dt><dd>${p.playoffs.length}</dd></div>
      </dl>
      <div class="mg-picks rv-games">${game(p.blowout, "Biggest blowout")}${game(p.closest, "Closest game")}</div>
      <table class="hist-table rv-log"><thead><tr><th>When</th><th>${esc(rvShort(A))}</th><th>${esc(rvShort(B))}</th></tr></thead><tbody>
        ${rows.map((r) => `<tr class="${r.playoff ? "po" : ""}"><td>${r.playoff ? "🏆 " : ""}${esc(r.when)}${r.flag ? " *" : ""}</td>
          <td class="${r.w === A ? "won" : ""}">${Math.round(r.a)}</td><td class="${r.w === B ? "won" : ""}">${Math.round(r.b)}</td></tr>`).join("")}
      </tbody></table>
      ${rows.some((r) => r.flag) ? '<p class="an-note small">* Sleeper\'s official result went the other way after a stat correction.</p>' : ""}
      ${rows.some((r) => r.playoff) ? '<p class="an-note small">Playoff rounds before 2025-2026 lasted two weeks, so those scores are two-week totals.</p>' : ""}`;
  }

  function renderRivalPeople() {
    const rec = (x) => rvText([x.w, x.l, x.t]);
    $("rv-people").innerHTML = data.rivalries.people.map((p) => `<div class="rv-person">
      <b>${esc(rvName(p.manager))}</b>
      <button type="button" class="rv-chip bad" data-a="${p.manager}" data-b="${p.nemesis.vs}">😈 ${esc(rvName(p.nemesis.vs))} <i>${rec(p.nemesis)}</i></button>
      <button type="button" class="rv-chip good" data-a="${p.manager}" data-b="${p.victim.vs}">🎯 ${esc(rvName(p.victim.vs))} <i>${rec(p.victim)}</i></button>
    </div>`).join("");
    for (const b of $("rv-people").querySelectorAll("button")) b.onclick = () => { pickRivalry(b.dataset.a, b.dataset.b); $("rv-detail").scrollIntoView({ block: "start", behavior: "smooth" }); };
  }

  function setupRivalries() {
    if (!data.rivalries) return;
    const opts = data.rivalries.managers.map((m) => `<option value="${m}">${esc(rvName(m))}</option>`).join("");
    $("rv-a").innerHTML = opts; $("rv-b").innerHTML = opts;
    $("rv-a").onchange = () => pickRivalry($("rv-a").value, $("rv-b").value);
    $("rv-b").onchange = () => pickRivalry($("rv-a").value, $("rv-b").value);
    renderRivalHeads();
    renderRivalPeople();
    const h = data.rivalries.pairs.find((x) => x.key === data.rivalries.headlines.lopsided);
    pickRivalry(h.a, h.b);
  }

  /* ---------- future pick ledger ---------- */
  function setupLedger() {
    const L = data.ledger;
    if (!L) return;
    const nm = (id) => data.rivalries.names[id] || id;
    const holder = {};   // "year|round|original" -> current owner
    for (const t of L.teams) for (const [y, ps] of Object.entries(t.picks)) for (const p of ps) holder[`${y}|${p.round}|${p.from}`] = t.manager;
    const hoard = L.teams.find((t) => t.manager === L.headlines.hoarder);
    const sold = L.teams.find((t) => t.manager === L.headlines.sold);
    $("pk-note").textContent = `Who owns every rookie pick in the next ${L.years.length} drafts (${L.years.join(", ")}). ` +
      `${L.traded} of ${L.years.length * L.rounds * L.teams.length} picks have already changed hands. Ranked by pick capital (1st = 3, 2nd = 2, 3rd = 1).`;
    $("pk-heads").innerHTML = `
      <div class="rv-head"><small>Pick hoarder</small><b>${esc(hoard.team)} (${esc(hoard.name)})</b><span>${hoard.count[0]} firsts across ${L.years.length} drafts</span></div>
      <div class="rv-head"><small>Sold the future</small><b>${esc(sold.team)} (${esc(sold.name)})</b><span>${sold.count[0] ? `Only ${sold.count[0]} first${sold.count[0] > 1 ? "s" : ""}` : "Zero firsts"} through ${L.years[L.years.length - 1]}</span></div>
      <div class="rv-head"><small>Picks on the move</small><b>${L.traded} traded picks</b><span>${Math.round(L.traded / (L.years.length * L.rounds * L.teams.length) * 100)}% of all future picks</span></div>`;
    const maxCap = Math.max(...L.teams.map((t) => t.capital));
    $("pk-list").innerHTML = L.teams.map((t) => {
      const gone = t.own_firsts_gone.map((y) => `${y} to ${esc(nm(holder[`${y}|1|${t.manager}`]))}`);
      return `<article class="pk-team">
        <header><span class="pr-rank">${t.rank}</span>
          <span class="pk-name"><b>${esc(t.team)}</b> <span class="pr-mgr">(${esc(t.name)})</span>
            <small>${t.count.map((c, i) => `${c} ${["1st", "2nd", "3rd"][i] || `R${i + 1}`}${c === 1 ? "" : "s"}`).join(" · ")}${t.power_rank ? ` · #${t.power_rank} in power rankings` : ""}</small></span>
          <span class="pk-cap"><b>${t.capital}</b><small>capital</small></span></header>
        <span class="pr-bar"><span style="width:${(t.capital / maxCap * 100).toFixed(1)}%"></span></span>
        ${L.years.map((y) => `<div class="pk-year"><span class="pk-y">${y}</span><span class="pk-chips">${(t.picks[y] || []).map((p) =>
          `<span class="pk r${p.round}${p.own ? "" : " got"}" title="${y} round ${p.round}${p.own ? "" : ` from ${esc(nm(p.from))}`}">${p.round}${p.own ? "" : `<i>${esc(nm(p.from).slice(0, 3))}</i>`}</span>`).join("") || '<span class="pk-none">no picks</span>'}</span></div>`).join("")}
        ${gone.length ? `<p class="pk-gone">Own 1st traded away: ${gone.join(" · ")}</p>` : ""}
      </article>`;
    }).join("");
  }

  /* ---------- matchup odds ----------
     "Opening" lines are set before the week (data/analytics.json). "Live" lines are worked out here from the
     live scores, read straight from Sleeper when the page opens (falls back to last night's scores):
     final margin = margin now + projected margin x share of the week still to play, and the uncertainty
     shrinks as the week runs out. The share left is estimated from league-wide points scored vs projected. */
  let oddsWeek = null;
  const liveScores = {};   // week -> {manager: points}
  const liveFetched = {};  // week -> "sleeper" | "nightly"
  const erf = (x) => {     // Abramowitz-Stegun approximation, plenty for odds
    const s = Math.sign(x); x = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * x);
    return s * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x));
  };
  const phiN = (z) => 0.5 * (1 + erf(z / Math.SQRT2));
  const americanOdds = (p) => {
    p = Math.min(Math.max(p, 0.02), 0.98);
    const line = Math.round((p >= 0.5 ? (-100 * p) / (1 - p) : (100 * (1 - p)) / p) / 5) * 5;
    return line > 0 ? `+${line}` : String(line);
  };
  const halfPt = (x) => Math.floor(x) + 0.5;
  const spreadText = (fav, me, n) => (!fav ? "PK" : fav === me ? `-${n}` : `+${n}`);

  let sleeperState = null;   // {week, season_start_date} from Sleeper, or null if it didn't answer
  async function loadState() {
    if (sleeperState !== null) return;
    try {
      const r = await fetch("https://api.sleeper.app/v1/state/nba", { cache: "no-store" });
      sleeperState = r.ok ? await r.json() : false;
    } catch (e) { sleeperState = false; }
  }
  // Sleeper NBA weeks: week 1 = opening night to the first Sunday, then Monday to Sunday (Eastern time)
  function weekPlayed(week) {
    if (!sleeperState || !sleeperState.season_start_date) return null;
    const DAY = 86400000, ET = 5 * 3600000;
    const open = Date.parse(`${sleeperState.season_start_date}T00:00:00Z`) + ET;
    const dow = new Date(open - ET).getUTCDay();            // 0 Sunday ... 6 Saturday
    const firstMonday = open + ((8 - dow) % 7 || 7) * DAY;
    const start = week <= 1 ? open : firstMonday + (week - 2) * 7 * DAY;
    const end = week <= 1 ? firstMonday : start + 7 * DAY;
    return Math.min(1, Math.max(0, (Date.now() - start) / (end - start)));
  }

  async function loadLive(W) {
    if (liveFetched[W.week]) return;
    const O = data.odds;
    try {
      const r = await fetch(`https://api.sleeper.app/v1/league/${O.league_id}/matchups/${W.week}`, { cache: "no-store" });
      if (!r.ok) throw new Error(r.status);
      const rows = await r.json();
      liveScores[W.week] = Object.fromEntries(rows.map((e) => [O.roster_manager[String(e.roster_id)], e.points || 0]));
      liveFetched[W.week] = "sleeper";
    } catch (e) {
      const nightly = {};
      for (const g of W.games) { nightly[g.a] = g.a_live || 0; nightly[g.b] = g.b_live || 0; }
      liveScores[W.week] = nightly;
      liveFetched[W.week] = "nightly";
    }
  }

  function liveLines(W) {
    const pts = liveScores[W.week] || {};
    const scored = Object.values(pts).reduce((a, b) => a + b, 0);
    if (!scored) return null;
    const projected = W.games.reduce((a, g) => a + g.a_proj + g.b_proj, 0);
    const byDate = weekPlayed(W.week);
    const played = byDate != null ? byDate : Math.min(0.99, scored / projected);
    const left = 1 - played;
    const sd = data.odds.sd * Math.SQRT2 * Math.sqrt(left);
    const lines = {};
    for (const g of W.games) {
      const a = pts[g.a] || 0, b = pts[g.b] || 0;
      const margin = a - b + (g.a_proj - g.b_proj) * left;       // projected final margin, A minus B
      const p = Math.min(0.999, Math.max(0.001, phiN(margin / Math.max(sd, 1))));
      const v = data.odds.vig;
      lines[`${g.a}|${g.b}`] = {
        a, b, p, a_ml: americanOdds(Math.min(p + v, 0.98)), b_ml: americanOdds(Math.min(1 - p + v, 0.98)),
        favorite: Math.abs(margin) >= 0.5 ? (margin > 0 ? g.a : g.b) : null, spread: halfPt(Math.abs(margin)),
        total: halfPt(a + b + (g.a_proj + g.b_proj) * left),
      };
    }
    return { lines, played };
  }

  async function setupOdds() {
    const O = data.odds;
    if (!O) return;
    $("od-sd").textContent = Math.round(O.sd);
    const r = O.record;
    $("od-record").innerHTML = r.right + r.wrong ? `<h3 class="an-sub-title">EquipoGPT's picks this season: ${r.right}-${r.wrong}</h3>
      ${O.upsets.length ? `<p class="an-note small">Biggest upsets: ${O.upsets.map((u) => `week ${u.week}, ${esc(u.underdog_name)} beat ${esc(u.favorite_name)} (${u.prob}% favourite)`).join(" · ")}</p>` : ""}` : "";
    if (!O.weeks.length) {
      $("od-weeks").hidden = true;
      $("od-list").innerHTML = '<p class="an-note">No regular-season matchups left to set lines for. Back next season.</p>';
      return;
    }
    await loadState();
    const nowWeek = sleeperState && sleeperState.week ? sleeperState.week : O.weeks[0].week;
    if (oddsWeek === null) oddsWeek = Math.max(0, O.weeks.findIndex((w) => w.week === nowWeek));
    const label = (w) => (w.week < nowWeek ? "final" : w.week === nowWeek ? "live" : "next");
    $("od-weeks").innerHTML = O.weeks.map((w, i) => `<button type="button" data-i="${i}" class="${i === oddsWeek ? "on" : ""}">Week ${w.week} · ${label(w)}</button>`).join("");
    for (const b of $("od-weeks").querySelectorAll("button")) b.onclick = () => { oddsWeek = Number(b.dataset.i); setupOdds(); };
    const W = O.weeks[oddsWeek];
    const state = label(W);
    if (state !== "next") await loadLive(W);
    const live = state !== "next" ? liveLines(W) : null;
    const src = liveFetched[W.week] === "sleeper" ? "Scores straight from Sleeper, refresh the page for the latest." : "Scores as of last night's refresh (Sleeper didn't answer).";
    $("od-live").innerHTML = state === "final" ? `Final scores. ${src}`
      : live ? `<span class="od-dot"></span> Live: about ${Math.round(live.played * 100)}% of the week played. ${src}`
      : state === "live" ? "This week has just started: no points yet, so the live lines match the opening lines."
      : "Opening lines for next week. Live lines appear once it starts.";
    $("od-list").innerHTML = W.games.map((g) => {
      const L = live && live.lines[`${g.a}|${g.b}`];
      const side = (k) => {
        const me = g[k];
        const pre = `<span class="od-cell"><small>Opening</small><b>${spreadText(g.favorite, me, g.spread)}</b><i>${g[`${k}_ml`]}</i></span>`;
        const won = L && (k === "a" ? L.a > L.b : L.b > L.a);
        const now = !L ? "" : state === "final"
          ? `<span class="od-cell live final"><small>Final</small><b>${won ? "W" : "L"}</b><i>${won ? "+" : "−"}${Math.round(Math.abs(L.a - L.b))}</i></span>`
          : `<span class="od-cell live"><small>Live</small><b>${spreadText(L.favorite, me, L.spread)}</b><i>${L[`${k}_ml`]}</i></span>`;
        const fav = (L ? L.favorite : g.favorite) === me;
        return `<div class="od-row${fav ? " fav" : ""}">
          <span class="od-team"><b>${esc(g[`${k}_team`])}</b><small>${esc(g[`${k}_name`])} · proj ${g[`${k}_proj`]}</small></span>
          ${L ? `<span class="od-live">${Math.round(L[k])}</span>` : ""}${pre}${now}
        </div>`;
      };
      const pA = L ? L.p * 100 : g.a_prob;
      return `<article class="od-game">
        ${side("a")}${side("b")}
        <div class="od-foot"><div class="tr-share od-bar" aria-hidden="true"><span style="width:${pA.toFixed(1)}%"></span></div>
          ${state === "final" && L ? `<span>Final: ${esc(L.a > L.b ? g.a_name : g.b_name)} by ${Math.round(Math.abs(L.a - L.b))} · ${(g.favorite === (L.a > L.b ? g.a : g.b)) ? "favourite won" : "upset!"}</span>
          <span>O/U ${g.total} → ${Math.round(L.a + L.b)} (${L.a + L.b > g.total ? "over" : "under"})</span>`
          : `<span>${L ? "Live win chance" : "Win chance"}: ${esc(g.a_name)} ${Math.round(pA)}% · ${esc(g.b_name)} ${Math.round(100 - pA)}%</span>
          <span>O/U ${g.total}${L ? ` → live ${L.total}` : ""}</span>`}
          ${L ? `<span class="od-was">Before the week: ${esc(g.a_name)} ${Math.round(g.a_prob)}%</span>` : ""}</div>
      </article>`;
    }).join("");
  }

  /* ---------- tabs ---------- */
  const TABS = ["power", "seasons", "trades", "managers", "rivals", "picks", "odds", "ask"];
  function openTab(name) {
    if (!TABS.includes(name)) name = "power";
    for (const b of $("an-tabs").querySelectorAll("button")) {
      b.classList.toggle("on", b.dataset.tab === name);
      b.setAttribute("aria-selected", String(b.dataset.tab === name));
    }
    for (const p of document.querySelectorAll("[data-panel]")) p.hidden = p.dataset.panel !== name;
    const url = new URL(location.href);
    url.searchParams.set("tab", name);
    history.replaceState(null, "", url);
    if (name === "seasons") renderChart();   // needs to be visible to measure its width
    if (name === "ask") { const w = $("paywall"); w.classList.remove("shake"); void w.offsetWidth; w.classList.add("shake"); }
  }

  /* ---------- trade report cards ---------- */
  const GRADE_CLASS = (g) => (!g ? "none" : g[0] === "A" ? "a" : g[0] === "B" ? "b" : g[0] === "C" ? "c" : g[0] === "D" ? "d" : "f");
  const STATUS = {
    pending: "⏳ Waiting on future picks",
    early: "🕒 Too early to grade",
    minor: "🤏 Too small to grade",
  };
  const fmtDate = (d) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const pts = (n) => Math.round(n).toLocaleString("en-US");
  let tradeLimit = 20;

  function tradeCard(t) {
    const sides = t.sides.map((s) => {
      const items = [
        ...s.players.map((p) => `<li><span>${esc(p.name)}${p.kept ? " 🔒" : ""}${!p.weeks ? ' <em class="moved">↪ moved on</em>' : ""}</span><b>${pts(p.pts)}</b></li>`),
        ...s.picks.map((p) => `<li><span>${esc(p.label)}${p.player ? ` <em>→ ${esc(p.player)}${p.kept ? " 🔒" : ""}</em>` : ""}` +
          `${p.status === "pending" ? ' <em class="moved">⏳ not drafted yet</em>' : p.status === "flipped" ? ' <em class="moved">↪ traded on</em>' : ""}</span><b>${p.status === "drafted" ? pts(p.pts) : "–"}</b></li>`),
        ...(s.faab ? [`<li><span>$${s.faab} FAAB</span><b>–</b></li>`] : []),
      ];
      if (!items.length) items.push(`<li><span class="moved">Nothing listed</span><b>–</b></li>`);
      return `<div class="tr-side">
        <div class="tr-side-head">
          <span class="grade g-${GRADE_CLASS(s.grade)}">${s.grade || "–"}</span>
          <span><b>${esc(s.team)}</b> <span class="pr-mgr">(${esc(s.name)})</span><small>got · ${pts(s.total)} pts</small></span>
        </div>
        <ul class="tr-items">${items.join("")}</ul>
      </div>`;
    }).join("");
    const share = t.sides.length === 2 && t.sides[0].total + t.sides[1].total > 0
      ? `<div class="tr-share" aria-hidden="true"><span style="width:${(t.sides[0].share * 100).toFixed(1)}%"></span></div>` : "";
    return `<article class="tr-card${t.status === "graded" ? "" : " ungraded"}" id="trade-${t.id}">
      <header><span>${fmtDate(t.date)} · ${esc(t.season)}</span>${STATUS[t.status] ? `<span class="tr-status">${STATUS[t.status]}</span>` : ""}</header>
      <div class="tr-sides">${sides}</div>
      ${share}
      <p class="pr-take"><img src="images/host.webp" alt="EquipoGPT says">${esc(t.take)}</p>
    </article>`;
  }

  function renderTraders() {
    $("traders").innerHTML = data.traders.map((b) => `<li class="${b.net >= 0 ? "plus" : "minus"}">
      <span class="tdr-rank">${b.rank}</span><span class="tdr-name">${esc(b.name)}</span>
      <span class="tdr-rec">${esc(b.record)}<small>${b.trades} trades</small></span>
      <span class="tdr-net">${b.net >= 0 ? "+" : "−"}${pts(Math.abs(b.net))}<small>pts net</small></span></li>`).join("");
  }

  function renderTrades() {
    const season = $("tr-season").value, who = $("tr-manager").value, sort = $("tr-sort").value;
    let list = data.trades.filter((t) => (!season || t.season === season) && (!who || t.sides.some((s) => s.manager === who)));
    if (sort === "fleece") list = list.filter((t) => t.status === "graded").sort((a, b) => b.edge - a.edge || b.margin - a.margin);
    $("tr-count").textContent = `${list.length} trade${list.length === 1 ? "" : "s"}${sort === "fleece" ? " (graded only)" : ""}`;
    $("tr-list").innerHTML = list.slice(0, tradeLimit).map(tradeCard).join("") || '<p class="an-note">No trades match.</p>';
    $("tr-more").hidden = list.length <= tradeLimit;
  }

  function setupTrades() {
    const seasons = [...new Set(data.trades.map((t) => t.season))].sort().reverse();
    $("tr-season").innerHTML = `<option value="">All seasons</option>` + seasons.map((s) => `<option>${s}</option>`).join("");
    $("tr-manager").innerHTML = `<option value="">All managers</option>` +
      data.managers.slice().sort((a, b) => a.name.localeCompare(b.name)).map((m) => `<option value="${m.manager}">${esc(m.name)}</option>`).join("");
    for (const id of ["tr-season", "tr-manager", "tr-sort"]) $(id).onchange = () => { tradeLimit = 20; renderTrades(); };
    $("tr-more").onclick = () => { tradeLimit += 20; renderTrades(); };
    renderTraders();
    renderTrades();
  }

  function showTrade(id) {   // from a manager profile: open that trade in the Trades tab
    $("tr-season").value = ""; $("tr-manager").value = ""; $("tr-sort").value = "new";
    const i = data.trades.findIndex((t) => t.id === id);
    tradeLimit = Math.max(20, i + 1);
    renderTrades();
    openTab("trades");
    const card = $(`trade-${id}`);
    if (card) { card.scrollIntoView({ block: "center" }); card.classList.add("flash"); setTimeout(() => card.classList.remove("flash"), 1600); }
  }

  /* ---------- manager profiles ---------- */
  let manager = null;
  function renderManagerChips() {
    $("mg-chips").innerHTML = data.managers.slice().sort((a, b) => a.name.localeCompare(b.name)).map((m) =>
      `<button type="button" class="chip${m.manager === manager ? " on" : ""}" data-m="${m.manager}" style="--c:#ff7a1a"><span class="dot"></span>${esc(m.name)}</button>`).join("");
    for (const b of $("mg-chips").querySelectorAll(".chip")) b.onclick = () => { manager = b.dataset.m; renderManagerChips(); renderProfile(); };
  }

  function miniPath(seasons) {
    const W = 260, H = 70, n = seasons.length;
    if (!n) return "";
    const x = (i) => 14 + (n === 1 ? 0 : (i / (n - 1)) * (W - 28));
    const y = (f) => 8 + ((f - 1) / 11) * (H - 26);
    const solid = seasons.filter((s) => s.final);
    const line = (arr) => arr.map((s) => `${x(seasons.indexOf(s)).toFixed(1)},${y(s.finish).toFixed(1)}`).join(" ");
    const live = seasons.filter((s) => !s.final);
    return `<svg class="mini-path" viewBox="0 0 ${W} ${H}" role="img" aria-label="Finish by season: ${esc(seasons.map((s) => `${s.season} ${ordinal(s.finish)}`).join(", "))}">
      <line class="pl" x1="6" x2="${W - 6}" y1="${((y(6) + y(7)) / 2).toFixed(1)}" y2="${((y(6) + y(7)) / 2).toFixed(1)}"/>
      ${solid.length > 1 ? `<polyline points="${line(solid)}"/>` : ""}
      ${live.length && solid.length ? `<polyline class="live" points="${line([solid[solid.length - 1], ...live])}"/>` : ""}
      ${seasons.map((s, i) => `${s.champion ? `<circle class="champ" cx="${x(i)}" cy="${y(s.finish)}" r="8"/>` : ""}<circle class="${s.final ? "" : "open"}" cx="${x(i)}" cy="${y(s.finish)}" r="4.5"/>` +
        `<text x="${x(i)}" y="${(y(s.finish) - 9).toFixed(1)}">${ordinal(s.finish)}</text><text class="yr" x="${x(i)}" y="${H - 2}">${shortSeason(s.season)}${s.final ? "" : "*"}</text>`).join("")}
    </svg>`;
  }

  function tradeLink(t, label) {
    if (!t) return "";
    return `<button type="button" class="mg-trade" data-trade="${t.id}"><span class="grade g-${GRADE_CLASS(t.grade)}">${t.grade}</span>
      <span><small>${label} · ${fmtDate(t.date)} with ${esc(t.with)}</small>${esc(t.got.join(", ") || "nothing listed")} · ${pts(t.pts)} pts</span></button>`;
  }

  function renderProfile() {
    const m = data.managers.find((x) => x.manager === manager);
    if (!m) return;
    const tr = m.trades, dr = m.drafts, wv = m.waivers;
    const pick = (p, label) => p ? `<div class="mg-pick"><small>${label}</small><b>${esc(p.player)}</b>
      <span>${esc(p.draft)}, pick ${esc(p.pick)} · ${pts(p.pts)} pts (${p.voe >= 0 ? "+" : "−"}${pts(Math.abs(p.voe))} vs slot)</span></div>` : "";
    $("mg-profile").innerHTML = `
      <div class="mg-head">
        <div><h3>${esc(m.team)} <span class="pr-mgr">(${esc(m.name)})</span></h3>
          <p class="mg-names">${m.team_names.length > 1 ? `Also known as ${m.team_names.filter((n) => n !== m.team).map(esc).join(", ")}` : `${m.seasons_played} seasons in Das League`}</p></div>
        <div class="mg-trophies">${m.titles.map((s) => `<span title="Champion ${s}">🏆</span>`).join("")}${m.runner_ups.map((s) => `<span title="Runner-up ${s}">🥈</span>`).join("")}</div>
      </div>
      <p class="pr-take"><img src="images/host.webp" alt="EquipoGPT says">${esc(m.take)}</p>
      <dl class="pr-stats mg-stats">
        <div><dt>All-time record</dt><dd>${esc(m.record)}</dd></div>
        <div><dt>Win %</dt><dd>${Math.round(m.win_pct)}%</dd></div>
        <div><dt>Playoff trips</dt><dd>${m.playoffs}</dd></div>
        <div><dt>Titles</dt><dd>${m.titles.length}</dd></div>
        <div><dt>Best finish</dt><dd>${m.best_season ? ordinal(m.best_season.finish) : "–"}</dd></div>
        <div><dt>Worst finish</dt><dd>${m.worst_season ? ordinal(m.worst_season.finish) : "–"}</dd></div>
      </dl>
      ${miniPath(m.seasons)}

      <h4 class="mg-h">🔄 Trading <span>#${tr.rank} of ${data.managers.length} by points gained</span></h4>
      <dl class="pr-stats mg-stats">
        <div><dt>Trades</dt><dd>${tr.count}</dd></div>
        <div><dt>Graded W-L</dt><dd>${esc(tr.record)}</dd></div>
        <div><dt>Net points</dt><dd>${tr.net >= 0 ? "+" : "−"}${pts(Math.abs(tr.net))}</dd></div>
      </dl>
      ${tr.partner ? `<p class="mg-line">Favourite trade partner: <b>${esc(tr.partner.name)}</b> (${tr.partner.count} trades)</p>` : ""}
      ${tradeLink(tr.best, "Best trade")}${tradeLink(tr.worst, "Worst trade")}

      <h4 class="mg-h">📋 Waiver wire</h4>
      <p class="mg-line"><b>${wv.count}</b> pickups.${wv.best ? ` Best ever: <b>${esc(wv.best.player)}</b> (${esc(wv.best.season)}), ${pts(wv.best.pts)} points over ${wv.best.weeks} weeks.` : ""}</p>

      <h4 class="mg-h">🎯 Draft grade <span class="grade g-${GRADE_CLASS(dr.grade)}">${dr.grade}</span> <span>#${dr.rank} of ${data.managers.length}</span></h4>
      <div class="mg-picks">${pick(dr.steal, "Biggest steal")}${pick(dr.bust, "Biggest bust (top 36 picks)")}</div>
      ${dr.by_draft.map((d) => `<details class="an-how mg-draft"><summary>${esc(d.draft)} <span class="${d.voe >= 0 ? "pos" : "neg"}">${d.voe >= 0 ? "+" : "−"}${pts(Math.abs(d.voe))} vs slot</span></summary>
        <table class="hist-table"><thead><tr><th>Pick</th><th>Player</th><th>Pts</th><th>vs slot</th></tr></thead><tbody>
        ${d.picks.map((p) => `<tr><td>${esc(p.pick)}</td><td>${esc(p.player)}${p.kept ? " 🔒" : ""}</td><td>${pts(p.pts)}</td>` +
          `<td class="${p.voe >= 0 ? "pos" : "neg"}">${p.voe >= 0 ? "+" : "−"}${pts(Math.abs(p.voe))}</td></tr>`).join("")}
        </tbody></table></details>`).join("")}
      <p class="an-note small">Points = what each player scored for ${esc(m.name)} while on the roster. 🔒 still there. "vs slot" compares a pick with the
        picks made around the same spot in that draft.</p>`;
    for (const b of $("mg-profile").querySelectorAll(".mg-trade")) b.onclick = () => showTrade(b.dataset.trade);
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
    setupTrades();
    setupRivalries();
    setupLedger();
    setupOdds();
    $("ask-form").onsubmit = (event) => {   // the owner's joke: every question hits the paywall
      event.preventDefault();
      openTab("ask");
      $("paywall").scrollIntoView({ block: "center", behavior: "smooth" });
    };
    manager = (data.rankings[0] || data.managers[0]).manager;
    renderManagerChips();
    renderProfile();
    for (const b of $("an-tabs").querySelectorAll("button")) b.onclick = () => openTab(b.dataset.tab);
    openTab(params.get("tab"));
    let wide = window.innerWidth;
    window.addEventListener("resize", () => { if (Math.abs(window.innerWidth - wide) > 30) { wide = window.innerWidth; renderChart(); } });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
