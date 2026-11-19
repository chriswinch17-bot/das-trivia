/* Das Feud (?mode=feud): one survey a day, Family-Feud style. Name the top answers (worked out from league data,
   scripts/build_feud.py) before the clock or three strikes run out. Scores go to the shared leaderboard as game
   80000 + day. ?test plays without saving; ?test&day=3 plays day 3. */
(() => {
  "use strict";

  const params = new URLSearchParams(location.search);
  if (params.get("mode") !== "feud") return;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const testMode = params.has("test");
  const config = window.DAS_CONFIG || {};
  const online = Boolean(config.supabaseUrl && config.supabaseKey);
  const C = window.DasCommon;
  const BOARD = 80000;
  const ALL_BONUS = 20;
  let data, survey, day, state, timer = null;

  const normalize = (t) => String(t).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  function distance(a, b) {
    if (Math.abs(a.length - b.length) > 3) return 4;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const row = [i];
      for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = row;
    }
    return prev[b.length];
  }
  // index of the board answer the guess matches, or -1 (forgiving, like the other games)
  function match(typed) {
    const input = normalize(typed);
    if (!input) return -1;
    const answers = survey.answers;
    let i = answers.findIndex((a) => a.accept.some((x) => normalize(x) === input));
    if (i >= 0) return i;
    if (input.length >= 5) {
      i = answers.findIndex((a) => a.accept.some((x) => normalize(x).includes(input)));
      if (i >= 0) return i;
    }
    const allowed = input.length >= 11 ? 3 : input.length >= 7 ? 2 : input.length >= 4 ? 1 : 0;
    let best = -1, bestD = allowed + 1;
    answers.forEach((a, k) => a.accept.forEach((x) => {
      const t = normalize(x);
      if (t.length < 4) return;
      const d = distance(input, t);
      if (d < bestD) { best = k; bestD = d; }
    }));
    return best;
  }

  const key = () => `das-feud:${day}`;
  const load = () => { try { return JSON.parse(localStorage.getItem(key())); } catch (e) { return null; } };
  const save = () => { if (!testMode) try { localStorage.setItem(key(), JSON.stringify(state)); } catch (e) { /* private */ } };

  function show(screen) {
    for (const el of document.querySelectorAll(".screen")) el.hidden = el.id !== `screen-${screen}`;
    window.scrollTo(0, 0);
  }

  function score() {
    const found = state.found.reduce((s, i) => s + survey.answers[i].points, 0);
    return found + (state.found.length === survey.answers.length ? ALL_BONUS : 0);
  }
  function boxes() {
    return survey.answers.map((_, i) => (state.found.includes(i) ? "🟩" : "⬛")).join("") + " " + "❌".repeat(state.strikes);
  }

  let flip = -1;    // only the tile just found flips over
  function drawBoard(reveal) {
    $("fd-board").innerHTML = survey.answers.map((a, i) => {
      const open = state.found.includes(i) || reveal;
      const mine = state.found.includes(i);
      return `<li class="fd-tile${open ? " open" : ""}${open && !mine ? " missed" : ""}${i === flip || (reveal && !mine) ? " flip" : ""}"><span class="fd-n">${i + 1}</span>
        ${open ? `<span class="fd-a">${esc(a.display)}</span><span class="fd-p">${a.points}</span>` : '<span class="fd-a"></span>'}</li>`;
    }).join("");
    $("fd-strikes").innerHTML = [0, 1, 2].map((i) => `<span class="${i < state.strikes ? "on" : ""}">✕</span>`).join("");
    $("fd-score").textContent = score();
  }

  function tick() {
    const left = data.seconds - (Date.now() - state.startedAt) / 1000;
    $("fd-timer").textContent = Math.max(0, Math.ceil(left));
    $("fd-timer").classList.toggle("low", left <= 10);
    if (left <= 0) end("Time's up!");
  }

  function begin() {
    if (!state.startedAt) { state.startedAt = Date.now(); save(); }
    show("feud-play");
    $("fd-prompt").textContent = survey.prompt;
    drawBoard(false);
    $("fd-form").hidden = false;
    $("fd-after").hidden = true;
    clearInterval(timer);
    timer = setInterval(tick, 200);
    tick();
    $("fd-input").focus();
  }

  function guess(event) {
    event.preventDefault();
    const typed = $("fd-input").value.trim();
    if (!typed || state.done) return;
    $("fd-input").value = "";
    const i = match(typed);
    const msg = $("fd-msg");
    if (i >= 0 && state.found.includes(i)) { msg.textContent = `"${typed}" is already on the board.`; msg.className = "fd-msg"; return; }
    state.guesses.push({ t: typed, hit: i });
    if (i >= 0) {
      state.found.push(i);
      flip = i;
      msg.textContent = `✓ ${survey.answers[i].display}: #${i + 1}, ${survey.answers[i].points} points!`;
      msg.className = "fd-msg good";
    } else {
      state.strikes += 1;
      flip = -1;
      msg.textContent = `✕ "${typed}" isn't on the board.`;
      msg.className = "fd-msg bad";
    }
    save();
    drawBoard(false);
    if (state.found.length === survey.answers.length) end("Board cleared! 🎉");
    else if (state.strikes >= data.strikes) end("Three strikes!");
  }

  async function end(why) {
    clearInterval(timer);
    if (!state.done) { state.done = true; state.why = why; save(); }
    $("fd-form").hidden = true;
    $("fd-after").hidden = false;
    $("fd-why").textContent = state.why || why;
    drawBoard(true);
    $("fd-final").textContent = `${score()} points · ${state.found.length} of ${survey.answers.length} found` +
      (state.found.length === survey.answers.length ? ` (+${ALL_BONUS} board-clear bonus)` : "");
    $("fd-details").innerHTML = survey.answers.map((a, i) => `<li class="${state.found.includes(i) ? "correct" : "wrong"}"><b>#${i + 1} ${esc(a.display)}</b> · ${a.points} pts<div class="ra">${esc(a.detail || "")}</div></li>`).join("")
      + (survey.note ? `<li class="fine">${esc(survey.note)}</li>` : "");
    if (!testMode && C && day === todayDay()) C.record("feud", score(), boxes());
    await leaderboard();
  }

  async function leaderboard() {
    const list = $("fd-leaders");
    const me = C ? C.player() : "";
    const mine = { player: me || "You", score: score(), correct: state.found.length, boxes: boxes(),
      answers: [{ q: survey.prompt, t: state.guesses.map((g) => g.t).join(", "), r: state.found.length ? "correct" : "wrong", p: score(),
        a: state.found.map((i) => survey.answers[i].display).join(", ") }] };
    if (!online) { list.innerHTML = ""; return; }
    const db = (path, opts = {}) => fetch(`${config.supabaseUrl}/rest/v1/${path}`, { ...opts,
      headers: { apikey: config.supabaseKey, Authorization: `Bearer ${config.supabaseKey}`, "Content-Type": "application/json", ...(opts.headers || {}) } });
    try {
      if (!testMode && !state.submitted && me) {
        await db("scores?on_conflict=game,player", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
          body: JSON.stringify({ game: BOARD + day, ...mine }) });
        state.submitted = true; save();
      }
      const rows = await (await db(`scores?game=eq.${BOARD + day}&order=score.desc,created_at.asc&limit=50&select=player,score,boxes`)).json();
      const all = testMode && !rows.some((r) => r.player === mine.player) ? [...rows, mine].sort((a, b) => b.score - a.score) : rows;
      list.innerHTML = all.map((r, i) => `<li class="${r.player === mine.player ? "me" : ""}"><span class="lr">${i + 1}</span><span class="ln">${esc(r.player)}</span><span class="lb">${esc(r.boxes || "")}</span><span class="ls">${r.score}</span></li>`).join("");
      $("fd-board-note").textContent = testMode ? "Practice mode: your score isn't saved." : (me ? "" : "Pick your name on the home page to get on the leaderboard.");
    } catch (e) {
      $("fd-board-note").textContent = "Couldn't reach the leaderboard right now.";
    }
  }

  function todayDay() {
    const [y, m, d] = data.start_date.split("-").map(Number);
    const [ty, tm, td] = C.today().split("-").map(Number);
    return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(y, m - 1, d)) / 86400000) + 1;
  }

  async function start() {
    show("feud-start");
    $("game-tag").textContent = "Das Feud" + (testMode ? " · test" : "");
    document.title = "Das Feud · Das Trivia";
    try { data = await (await fetch("data/feud.json", { cache: "no-cache" })).json(); }
    catch (e) { $("fd-intro").textContent = "Today's survey didn't load. Refresh to try again."; return; }
    day = Math.max(1, todayDay());
    if (testMode && params.get("day")) day = Math.max(1, Number(params.get("day")) || 1);
    survey = (data.days[(day - 1) % data.days.length] || [])[0];
    if (!survey) { $("fd-intro").textContent = "No survey today."; return; }
    $("fd-day").textContent = `Das Feud #${day}`;
    state = (!testMode && load()) || { found: [], strikes: 0, guesses: [], startedAt: null };
    $("fd-form").addEventListener("submit", guess);
    $("fd-play").onclick = begin;
    $("fd-share").onclick = async () => {
      const text = `📋 Das Feud #${day}\n${boxes()}\nScore: ${score()}` + (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? "" : `\n${location.origin}${location.pathname}?mode=feud`);
      try { await navigator.clipboard.writeText(text); $("fd-share").textContent = "Copied ✓"; } catch (e) { $("fd-share").textContent = "Couldn't copy"; }
    };
    if (state.done) { show("feud-play"); $("fd-prompt").textContent = survey.prompt; end(state.why); }
    else if (state.startedAt) begin();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
