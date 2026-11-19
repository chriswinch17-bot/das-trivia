/* Leaderboards (?mode=boards): every game's daily scores added up for this week, this month and all time,
   plus the longest active streaks. Read from the shared scores table (the same one each game saves to).
   Das Trivia days count their rarity score (answers fewer people got count more). Das Grids keeps its own
   board (its score is "lower is better"), so it isn't added in. */
(() => {
  "use strict";

  const params = new URLSearchParams(location.search);
  if (params.get("mode") !== "boards") return;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const config = window.DAS_CONFIG || {};
  const C = window.DasCommon;
  const TIME_ZONE = "America/New_York";
  const KIND = (game) => (game >= 80000 ? "feud" : game >= 70000 ? "rorw" : game >= 60000 ? "team" : game >= 50000 ? "papo" : "trivia");
  const ICON = { trivia: "🏀", papo: "🔄", team: "🕵️", rorw: "🗑️", feud: "📋" };
  let rows = [], tab = params.get("tab") || "week";

  const etDate = (iso) => new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

  function weekStart(day) {                    // Monday of this week (ET), like the fantasy weeks
    const [y, m, d] = day.split("-").map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    return C.shiftDay(day, -((dow + 6) % 7));
  }

  // Das Trivia: the same rarity boost as the daily leaderboard
  function rarityScores(all) {
    const byGame = {};
    for (const r of all) if (KIND(r.game) === "trivia" && Array.isArray(r.answers) && r.answers.length) (byGame[r.game] = byGame[r.game] || []).push(r);
    for (const list of Object.values(byGame)) {
      if (list.length < 2) continue;
      const tally = {};
      for (const r of list) for (const a of r.answers) {
        const t = tally[a.q] || (tally[a.q] = { right: 0, all: 0 });
        t.all += 1; if (a.r === "correct") t.right += 1;
      }
      for (const r of list) r.points = r.answers.reduce((s, a) => s + Math.round((a.p || 0) * (1 + (1 - tally[a.q].right / tally[a.q].all))), 0);
    }
    for (const r of all) if (r.points == null) r.points = r.score;
  }

  function totals(from) {
    const by = {};
    for (const r of rows) {
      if (r.day < from) continue;
      const p = by[r.player] || (by[r.player] = { player: r.player, total: 0, games: 0, kinds: {} });
      p.total += r.points;
      p.games += 1;
      p.kinds[r.kind] = (p.kinds[r.kind] || 0) + r.points;
    }
    return Object.values(by).sort((a, b) => b.total - a.total || b.games - a.games);
  }

  function streaks() {
    const days = {};
    for (const r of rows) (days[r.player] = days[r.player] || new Set()).add(r.day);
    const today = C.today();
    const out = [];
    for (const [player, set] of Object.entries(days)) {
      let d = set.has(today) ? today : C.shiftDay(today, -1), n = 0;
      while (set.has(d)) { n += 1; d = C.shiftDay(d, -1); }
      // best ever
      const sorted = [...set].sort();
      let best = 0, run = 0, prev = null;
      for (const x of sorted) { run = prev && C.shiftDay(prev, 1) === x ? run + 1 : 1; best = Math.max(best, run); prev = x; }
      out.push({ player, now: n, best, days: set.size });
    }
    return out.sort((a, b) => b.now - a.now || b.best - a.best || b.days - a.days);
  }

  function draw() {
    for (const b of $("bd-tabs").querySelectorAll("button")) b.classList.toggle("on", b.dataset.tab === tab);
    const me = C.player();
    const list = $("bd-list");
    const today = C.today();
    if (tab === "streaks") {
      const s = streaks();
      $("bd-note").textContent = "Days in a row with at least one game played. Today not played yet doesn't break it.";
      list.innerHTML = s.map((r, i) => `<li class="${r.player === me ? "me" : ""}"><span class="lr">${i + 1}</span><span class="ln">${esc(r.player)}</span>
        <span class="bd-sub">best ${r.best} · ${r.days} days</span><span class="ls">${r.now ? `🔥 ${r.now}` : "–"}</span></li>`).join("") || "<li>No games yet.</li>";
      return;
    }
    const from = tab === "week" ? weekStart(today) : tab === "month" ? today.slice(0, 8) + "01" : "0000";
    const t = totals(from);
    const label = { week: "this week (Monday to Sunday)", month: "this month", all: "since the site started" }[tab];
    $("bd-note").textContent = `Every daily game's score added up ${label}. Das Trivia counts its rarity score. Das Grids has its own board.`;
    list.innerHTML = t.map((r, i) => `<li class="${r.player === me ? "me" : ""}"><span class="lr">${i === 0 && t.length > 1 ? "👑" : i + 1}</span>
      <span class="ln">${esc(r.player)}</span>
      <span class="bd-sub">${Object.entries(r.kinds).map(([k, v]) => `${ICON[k] || ""}${v}`).join(" ")} · ${r.games} games</span>
      <span class="ls">${r.total.toLocaleString("en-US")}</span></li>`).join("") || "<li>No games yet this period.</li>";
    // last month's champion
    const month = today.slice(0, 8) + "01";
    const lastMonth = C.shiftDay(month, -1).slice(0, 8) + "01";
    const prev = {};
    for (const r of rows) if (r.day >= lastMonth && r.day < month) prev[r.player] = (prev[r.player] || 0) + r.points;
    const champ = Object.entries(prev).sort((a, b) => b[1] - a[1])[0];
    $("bd-champ").hidden = !champ;
    if (champ) $("bd-champ").textContent = `👑 Last month's champion: ${champ[0]} (${champ[1].toLocaleString("en-US")} points)`;
  }

  async function start() {
    for (const el of document.querySelectorAll(".screen")) el.hidden = el.id !== "screen-boards";
    $("game-tag").textContent = "Leaderboards";
    document.title = "Leaderboards · Das Trivia";
    for (const b of $("bd-tabs").querySelectorAll("button")) b.onclick = () => { tab = b.dataset.tab; draw(); };
    if (!config.supabaseUrl) { $("bd-note").textContent = "The leaderboard isn't connected."; return; }
    $("bd-note").textContent = "Loading…";
    try {
      const r = await fetch(`${config.supabaseUrl}/rest/v1/scores?select=game,player,score,created_at,answers&order=created_at.asc&limit=10000`,
        { headers: { apikey: config.supabaseKey, Authorization: `Bearer ${config.supabaseKey}` } });
      if (!r.ok) throw new Error(r.status);
      rows = (await r.json()).filter((x) => !String(x.player).startsWith("zz-"))
        .map((x) => ({ ...x, kind: KIND(x.game), day: etDate(x.created_at) }));
      rarityScores(rows);
      draw();
    } catch (e) {
      $("bd-note").textContent = "Couldn't load the leaderboards right now. Refresh to try again.";
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
