/* Shared by every page: who you are, what you've played today, your streak, and the phone menu bar.
   Everything is kept in this browser (localStorage); nothing here is sent anywhere. */
(() => {
  "use strict";

  const PLAYER_KEY = "das-trivia:player";      // the same name every game and Analytics use
  const LOG_KEY = "das-trivia:played";         // { "2026-11-19": { trivia: { score, boxes }, papo: {...} } }
  const TIME_ZONE = "America/New_York";
  const GAMES = [
    { mode: "trivia", name: "Das Trivia", icon: "🏀" },
    { mode: "papo", name: "Papo Trade or NOT", icon: "🔄" },
    { mode: "team", name: "What team am I?", icon: "🕵️" },
    { mode: "rorw", name: "Rostered or Waiver", icon: "🗑️" },
    { mode: "feud", name: "Das Feud", icon: "📋" },
    { mode: "grids", name: "Das Grids", icon: "🔢" },
  ];

  const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch (e) { return fallback; } };
  const write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private browsing */ } };

  function today() {
    return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  }
  function shiftDay(iso, n) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
  }

  function player() { try { return localStorage.getItem(PLAYER_KEY) || ""; } catch (e) { return ""; } }

  // Called when a daily game is finished (not practice mode). Keeps the first result of the day per game.
  function record(mode, score, boxes) {
    const log = read(LOG_KEY, {});
    const day = log[today()] || (log[today()] = {});
    if (!day[mode]) day[mode] = { score: Math.round(score || 0), boxes: boxes || "" };
    // keep about two months
    const cutoff = shiftDay(today(), -60);
    for (const d of Object.keys(log)) if (d < cutoff) delete log[d];
    write(LOG_KEY, log);
  }

  function playedToday() { return read(LOG_KEY, {})[today()] || {}; }

  // Days in a row with at least one game played. Today not played yet doesn't break it.
  function streak() {
    const log = read(LOG_KEY, {});
    let day = today(), count = 0;
    if (!log[day] || !Object.keys(log[day]).length) day = shiftDay(day, -1);
    while (log[day] && Object.keys(log[day]).length) { count += 1; day = shiftDay(day, -1); }
    return count;
  }

  // The scorecard for the group chat: every game played today with its boxes.
  function scorecard() {
    const done = playedToday();
    const lines = [`📅 Das Trivia daily · ${new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, month: "short", day: "numeric" }).format(new Date())}`];
    let total = 0;
    for (const g of GAMES) {
      const r = done[g.mode];
      if (!r) continue;
      total += g.mode === "grids" ? 0 : r.score;
      lines.push(`${g.icon} ${g.name}: ${g.mode === "grids" ? `rarity ${r.score}` : r.score}${r.boxes ? "  " + r.boxes : ""}`);
    }
    lines.push(`Total: ${total}` + (streak() > 1 ? ` · 🔥 ${streak()}-day streak` : ""));
    if (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) lines.push(location.origin + location.pathname);
    return lines.join("\n");
  }

  // Phone menu bar (shown on small screens by the CSS).
  function menuBar() {
    if (document.getElementById("bottom-nav")) return;
    const mode = new URLSearchParams(location.search).get("mode") || "";
    const test = new URLSearchParams(location.search).has("test");
    const link = (q) => (q ? `?${q}` : "./") + (test ? (q ? "&test" : "?test") : "");
    const items = [
      { href: link(""), icon: "🏠", label: "Home", on: !mode },
      { href: link("mode=trivia"), icon: "🏀", label: "Trivia", on: mode === "trivia" },
      { href: link("mode=analytics"), icon: "📊", label: "Analytics", on: mode === "analytics" },
      { href: link("mode=boards"), icon: "🏆", label: "Boards", on: mode === "boards" },
      { href: link("mode=archive"), icon: "📜", label: "Results", on: mode === "archive" },
    ];
    const nav = document.createElement("nav");
    nav.id = "bottom-nav";
    nav.className = "bottom-nav";
    nav.setAttribute("aria-label", "Main menu");
    for (const it of items) {
      const a = document.createElement("a");
      a.href = it.href;
      if (it.on) { a.className = "on"; a.setAttribute("aria-current", "page"); }
      a.innerHTML = `<span aria-hidden="true">${it.icon}</span><b></b>`;
      a.querySelector("b").textContent = it.label;
      nav.append(a);
    }
    document.body.append(nav);
    document.body.classList.add("has-bottom-nav");
  }

  window.DasCommon = { PLAYER_KEY, GAMES, today, shiftDay, player, record, playedToday, streak, scorecard };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", menuBar);
  else menuBar();
})();
