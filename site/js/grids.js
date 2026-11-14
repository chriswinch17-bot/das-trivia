/* DAS GRIDS: name a player who has been on both teams' rosters at any point in Das League history.
   Opens with ?mode=grids. ?mode=grids&puzzle=U17 opens a specific grid (D = daily, U = unlimited).
   Answers are checked by the database (data/private/grids_setup.sql), never in this file.
   Add &test to try it without your picks counting toward anyone's rarity. */
(() => {
  "use strict";

  const params = new URLSearchParams(location.search);
  if (params.get("mode") !== "grids") return;

  const testMode = params.has("test");
  const $ = (id) => document.getElementById(id);
  const config = window.DAS_CONFIG || {};
  const online = Boolean(config.supabaseUrl && config.supabaseKey);
  const PLAYER_KEY = "das-trivia:player";
  const TIME_ZONE = "America/New_York";

  /*
    RARITY FOR A 12-PERSON LEAGUE (the owner's request)
    The percentage is the share of the LEAGUE that picked the same player for that square:
    picks ÷ the bigger of (people who answered it, 12). A first answer is 1 of 12 = 8.33%, not 100%.
    HoopGrids' tiers (Common above 15% ... Unicorn at 0.05%) can't happen with 12 people, so the tiers
    go by how many people made the same pick. "Only you" gets rarer the more people answered the square.
  */
  const TIERS = {
    unicorn: { name: "Unicorn", cls: "unicorn", box: "🦄" },   // only you, and 9+ people answered the square
    galaxy: { name: "Galaxy", cls: "galaxy", box: "🟪" },      // only you, and 6-8 answered
    blue: { name: "Blue", cls: "blue", box: "🟦" },            // only you so far (fewer than 6 answered)
    gold: { name: "Gold", cls: "gold", box: "🟨" },            // 2 people picked him
    silver: { name: "Silver", cls: "silver", box: "🔘" },      // 3 people
    bronze: { name: "Bronze", cls: "bronze", box: "🟫" },      // 4 or 5 people
    common: { name: "Common", cls: "common", box: "⬜" },      // 6 or more
  };
  function tierOf(pick) {
    if (pick.count <= 1) return pick.total >= 9 ? TIERS.unicorn : pick.total >= 6 ? TIERS.galaxy : TIERS.blue;
    if (pick.count === 2) return TIERS.gold;
    if (pick.count === 3) return TIERS.silver;
    if (pick.count <= 5) return TIERS.bronze;
    return TIERS.common;
  }
  const leagueSize = () => (data && data.league_size) || 12;
  const pctOf = (count, total) => Math.round((10000 * count) / Math.max(total, leagueSize())) / 100;

  let data, puzzle, kind, number, state, search, openSquare = null;

  /* ---------- small helpers ---------- */

  function normalize(text) {
    return String(text).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
      .replace(/ı/g, "i").replace(/ø/g, "o").replace(/đ/g, "d").replace(/ł/g, "l").replace(/ß/g, "ss")
      .replace(/[^a-z0-9 ]/g, "").replace(/\b(jr|sr|ii|iii|iv)\b/g, "").replace(/\s+/g, " ").trim();
  }
  function editDistance(a, b) {
    if (Math.abs(a.length - b.length) > 2) return 3;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const row = [i];
      for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = row;
    }
    return prev[b.length];
  }
  function gridDate() {      // the Eastern date; reset_hour_et 24 = a new grid at midnight ET
    const later = new Date(Date.now() + (24 - data.reset_hour_et) * 3600 * 1000);
    return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(later);
  }
  function daysBetween(from, to) {
    const utc = (s) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
    return Math.round((utc(to) - utc(from)) / 86400000);
  }
  function dateOfDaily(n) {
    const [y, m, d] = data.start_date.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d + n - 1, 12));
  }
  const niceDate = (when) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(when);
  const teamOf = (id) => data.teams[id];
  const fmt = (n) => (Math.round(n * 100) / 100).toFixed(2);
  const show = (screen) => { for (const el of document.querySelectorAll(".screen")) el.hidden = el.id !== `screen-${screen}`; };
  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  /* ---------- player name (shared with the other games) ---------- */

  let playerName = "";
  try { playerName = localStorage.getItem(PLAYER_KEY) || ""; } catch (e) { /* private browsing */ }
  function askName(then) {
    const box = $("names");
    box.replaceChildren();
    data.players.forEach((p) => {
      const b = el("button", "name-btn" + (p.name === playerName ? " picked" : ""), p.name);
      b.type = "button";
      b.addEventListener("click", () => setName(p.name, then));
      box.append(b);
    });
    $("other-name").value = "";
    $("other-form").onsubmit = (event) => { event.preventDefault(); if ($("other-name").value.trim()) setName($("other-name").value, then); };
    show("name");
  }
  function setName(name, then) {
    playerName = name.trim().slice(0, 20);
    try { localStorage.setItem(PLAYER_KEY, playerName); } catch (e) { /* private browsing */ }
    show("grids");
    drawPlayer();
    if (then) then();
  }
  function drawPlayer() {
    $("grid-player").textContent = playerName || "nobody yet";
  }

  /* ---------- saved progress ---------- */

  const storageKey = () => `das-grids:${puzzle.id}`;
  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey()));
      if (saved && saved.picks) return saved;
    } catch (e) { /* nothing saved */ }
    return { picks: {}, startedAt: null, finished: null };
  }
  function saveState() {
    try { localStorage.setItem(storageKey(), JSON.stringify(state)); } catch (e) { /* private browsing */ }
  }

  /* ---------- the database ---------- */

  async function rpc(name, body) {
    const response = await fetch(`${config.supabaseUrl}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: { apikey: config.supabaseKey, Authorization: `Bearer ${config.supabaseKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.status === 404) throw new Error("not set up");
    if (!response.ok) throw new Error(`database said ${response.status}`);
    return response.json();
  }

  /* ---------- drawing the grid ---------- */

  function score() {
    return Object.values(state.picks).reduce((sum, p) => sum + p.pct, 0);
  }

  function teamHeader(id, where) {
    const t = teamOf(id);
    const head = el("div", `grid-head ${where}`);
    const badge = el("span", "grid-badge", t.name.slice(0, 2).toUpperCase());
    badge.style.background = `hsl(${[...id].reduce((h, c) => h + c.charCodeAt(0) * 37, 0) % 360} 70% 42%)`;
    head.append(badge, el("b", null, t.name), el("small", null, t.team));
    return head;
  }

  function draw() {
    const board = $("grid-board");
    board.replaceChildren();
    const corner = el("div", "grid-corner");
    corner.append(el("small", null, kind === "daily" ? "Daily" : "Unlimited"),
      el("b", null, kind === "daily" ? `#${number}` : puzzle.id));
    board.append(corner);
    puzzle.cols.forEach((c) => board.append(teamHeader(c, "top")));
    puzzle.rows.forEach((r, ri) => {
      board.append(teamHeader(r, "left"));
      puzzle.cols.forEach((c, ci) => {
        const sq = ri * 3 + ci;
        const pick = state.picks[sq];
        const button = el("button", "grid-square");
        button.type = "button";
        button.setAttribute("aria-label", pick
          ? `${pick.name}, ${pick.pct}% picked. Change the player for ${teamOf(r).name} and ${teamOf(c).name}`
          : `Pick a player who was on both ${teamOf(r).name}'s and ${teamOf(c).name}'s rosters`);
        if (pick) {
          const tier = tierOf(pick);
          button.classList.add("filled", tier.cls);
          if (pick.justAdded) { button.classList.add("pop"); delete pick.justAdded; }
          button.append(el("span", "sq-name", pick.name));
          const meta = el("span", "sq-meta", `${tier.name} · ${fmt(pick.pct)}%`);
          button.append(meta);
          const badges = el("span", "sq-badges");
          badges.append(el("i", "prov", `${pick.count} of ${pick.total} ${pick.total === 1 ? "answer" : "answers"}`));
          if (pick.first) badges.append(el("i", "first", "First pick"));
          if (pick.deep) badges.append(el("i", "deep", "Deep cut"));
          button.append(badges);
        } else {
          button.append(el("span", "sq-plus", "+"));
        }
        button.addEventListener("click", () => openPicker(sq));
        board.append(button);
      });
    });
    const done = Object.keys(state.picks).length;
    $("grid-score").textContent = fmt(score());
    $("grid-progress").textContent = `${done}/9`;
    $("grid-results").hidden = done < 9;
    if (done === 9) drawResults();
  }

  /* ---------- picking a player ---------- */

  function openPicker(sq) {
    if (!playerName) return askName(() => openPicker(sq));
    if (!state.startedAt) { state.startedAt = Date.now(); saveState(); }
    openSquare = sq;
    const r = puzzle.rows[Math.floor(sq / 3)], c = puzzle.cols[sq % 3];
    $("pick-teams").textContent = `${teamOf(r).team} (${teamOf(r).name})  ×  ${teamOf(c).team} (${teamOf(c).name})`;
    const current = state.picks[sq];
    $("pick-current").hidden = !current;
    $("pick-current").textContent = current ? `Your answer: ${current.name}. Pick someone else to change it.` : "";
    $("pick-error").hidden = true;
    $("pick-input").value = "";
    $("pick-list").replaceChildren();
    $("grid-modal").hidden = false;
    $("pick-input").focus();
  }
  function closePicker() {
    $("grid-modal").hidden = true;
    openSquare = null;
  }

  function suggestions(text) {
    const q = normalize(text);
    if (q.length < 2) return [];
    const found = [];
    for (const p of search) {
      let rank = -1;
      if (p.key.startsWith(q) || p.nicks.some((n) => n.replace(/ /g, "") === q.replace(/ /g, ""))) rank = 0;
      else if (p.words.some((w) => w.startsWith(q))) rank = 1;
      else if (p.key.replace(/ /g, "").includes(q.replace(/ /g, ""))) rank = 2;
      if (rank >= 0) found.push([rank, p]);
    }
    if (!found.length && q.length >= 4) {       // a spelling slip: closest names
      for (const p of search) {
        const d = Math.min(...p.words.map((w) => editDistance(q, w)), editDistance(q, p.key));
        if (d <= 2) found.push([3 + d, p]);
      }
    }
    return found.sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name)).slice(0, 8).map((x) => x[1]);
  }

  function drawSuggestions() {
    const list = $("pick-list");
    list.replaceChildren();
    suggestions($("pick-input").value).forEach((p) => {
      const item = el("button", "pick-option", p.name);
      item.type = "button";
      item.addEventListener("click", () => choose(p));
      list.append(item);
    });
  }

  function pickError(text) {
    const box = $("pick-error");
    box.textContent = text;
    box.hidden = false;
  }

  async function choose(player) {
    const sq = openSquare;
    const r = puzzle.rows[Math.floor(sq / 3)], c = puzzle.cols[sq % 3];
    const usedIn = Object.entries(state.picks).find(([s, p]) => Number(s) !== sq && p.id === player.id);
    if (usedIn) return pickError(`You already used ${player.name} in another square. Each player can be used once per grid.`);
    if (!online) return pickError("DAS GRIDS isn't connected to the database yet.");
    $("pick-list").replaceChildren(el("p", "fine", `Checking ${player.name}…`));
    let reply;
    try {
      reply = await rpc("grid_guess", { p_puzzle: puzzle.id, p_square: sq, p_player: playerName, p_nba: player.id, p_save: !testMode });
    } catch (error) {
      drawSuggestions();
      return pickError(error.message === "not set up"
        ? "DAS GRIDS isn't set up in the database yet."
        : "Couldn't reach the database. Check your connection and try again.");
    }
    if (!reply.ok) {
      drawSuggestions();
      const rt = `${teamOf(r).team} (${teamOf(r).name})`, ct = `${teamOf(c).team} (${teamOf(c).name})`;
      if (reply.reason === "not") {
        return pickError(reply.on_row ? `${player.name} was on ${rt}, but never on ${ct}.`
          : reply.on_col ? `${player.name} was on ${ct}, but never on ${rt}.`
          : `${player.name} was never on ${rt} or ${ct}.`);
      }
      if (reply.reason === "used") return pickError(`You already used ${player.name} in another square.`);
      return pickError("That grid isn't in the database yet.");
    }
    state.picks[sq] = { id: player.id, name: player.name, pct: reply.pct, count: reply.count, total: reply.total,
      first: reply.first, deep: reply.deep_cut, justAdded: true };
    saveState();
    closePicker();
    draw();
    if (Object.keys(state.picks).length === 9) finishGrid();
  }

  /* ---------- results, sharing and leaderboard ---------- */

  function boxes() {
    return [0, 1, 2].map((r) => [0, 1, 2].map((c) => {
      const p = state.picks[r * 3 + c];
      return p ? tierOf(p).box : "⬛";
    }).join("")).join("\n");
  }

  async function finishGrid() {
    if (state.finished) return;
    const seconds = Math.round((Date.now() - (state.startedAt || Date.now())) / 1000);
    if (testMode || !online) return draw();
    try {
      const row = await rpc("grid_finish", { p_puzzle: puzzle.id, p_player: playerName, p_seconds: seconds, p_boxes: boxes().replace(/\n/g, " ") });
      if (row && row.score != null) {
        state.finished = { score: Number(row.score), seconds: row.seconds };
        saveState();
      }
    } catch (e) { /* the leaderboard will try again next visit */ }
    draw();
    loadLeaderboard();
  }

  function title() {
    return kind === "daily" ? `DAS GRIDS · Daily #${number} (${niceDate(dateOfDaily(number))})` : `DAS GRIDS · Grid ${puzzle.id}`;
  }
  function link() {
    return location.origin + location.pathname + `?mode=grids&puzzle=${puzzle.id}`;
  }
  function shareText() {
    const total = score();
    const lines = [`🏀 ${title()}`, boxes(), `${Object.keys(state.picks).length}/9 · Rarity ${fmt(total)} (lower is better)`];
    if (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) lines.push(link());
    return lines.join("\n");
  }

  function drawResults() {
    $("res-title").textContent = title();
    $("res-score").textContent = fmt(score());
    $("res-note").textContent = testMode ? "Practice mode: this grid isn't saved to the leaderboard."
      : closed() ? "This grid is closed. Archive play is practice and doesn't count."
      : kind === "daily" ? "Lower is better. Your score moves as the rest of the league plays, and is final when this grid closes at midnight ET."
      : "Lower is better. Your score moves as more people play this grid.";
    const mini = $("res-grid");
    mini.replaceChildren();
    for (let sq = 0; sq < 9; sq++) {
      const p = state.picks[sq];
      const cell = el("div", `res-cell ${p ? tierOf(p).cls : ""}`);
      if (p) cell.append(el("b", null, p.name), el("small", null, `${tierOf(p).name} · ${fmt(p.pct)}%`));
      mini.append(cell);
    }
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) {
      const box = document.createElement("textarea");
      box.value = text; box.style.position = "fixed"; box.style.opacity = "0";
      document.body.append(box); box.select();
      let ok = false;
      try { ok = document.execCommand("copy"); } catch (e2) { /* fall through */ }
      box.remove();
      return ok;
    }
  }
  async function shareResults() {
    playShareVideo();
    const text = shareText();
    if (navigator.share && /Mobi|Android|iPhone/i.test(navigator.userAgent)) {
      try { await navigator.share({ text }); return; } catch (e) { /* fall back to copying */ }
    }
    $("res-status").textContent = (await copyText(text)) ? "Copied! Paste it into the group chat." : text;
  }
  async function copyResults() {
    playShareVideo();
    $("res-status").textContent = (await copyText(shareText())) ? "Copied! Paste it into the group chat." : shareText();
  }
  function playShareVideo() {   // the owner's video from effects.js, same as the other games
    const setting = (window.EFFECTS || {}).shareVideo;
    if (!setting || !setting.file || !(setting.modes || []).includes("grids")) return;
    const video = $("share-video-player");
    if (video.getAttribute("src") !== setting.file) video.src = setting.file;
    $("share-video").hidden = false;
    video.play().catch(() => { video.muted = true; $("video-sound").hidden = false; video.play().catch(() => {}); });
  }

  const clock = (s) => (s == null ? "—" : s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);

  async function loadLeaderboard() {
    const list = $("grid-leaders"), status = $("grid-leaders-status");
    $("grid-leaders-title").textContent = kind === "daily" ? `Daily leaderboard · #${number}` : `Leaderboard · Grid ${puzzle.id}`;
    list.replaceChildren();
    if (!online) { status.textContent = "The leaderboard isn't connected yet."; return; }
    try {
      const rows = (await rpc("grid_board", { p_puzzle: puzzle.id })).filter((row) => !row.player.startsWith("zz-"));
      rows.forEach((row, i) => {
        const item = el("li", row.player === playerName ? "me" : "");
        item.append(el("span", "lr", i + 1), el("span", "ln", row.player), el("span", "lc", `${row.completed}/9`),
          el("span", "lt", clock(row.seconds)), el("span", "ls", fmt(Number(row.score))));
        list.append(item);
      });
      status.textContent = !rows.length ? "Nobody has played this grid yet."
        : rows[0].final ? "Final. Most squares first, then the lowest rarity score."
        : kind === "daily" ? "Live: scores move as the league plays, and are final at midnight ET. Most squares first, then the lowest score."
        : "Live: most squares first, then the lowest rarity score.";
    } catch (e) {
      status.textContent = "Couldn't load the leaderboard right now.";
    }
  }

  // Crowd rarity changes as more people play, so refresh this person's picks on every visit.
  async function refreshRarity() {
    if (!online || testMode || !playerName || !Object.keys(state.picks).length) return;
    try {
      const rows = await rpc("grid_rarity", { p_puzzle: puzzle.id, p_player: playerName });
      (rows || []).forEach((row) => {
        const pick = state.picks[row.square];
        if (pick && pick.id === row.nba && row.total) {
          pick.count = row.count; pick.total = row.total;
          pick.pct = pctOf(row.count, row.total);
        }
      });
      saveState();
      draw();
    } catch (e) { /* keep the saved numbers */ }
  }

  // a daily grid closes at midnight ET at the end of its day; after that it's archive practice
  function closed() {
    return kind === "daily" && number < Math.max(1, daysBetween(data.start_date, gridDate()) + 1);
  }

  /* ---------- archive and switching grids ---------- */

  function go(id) {
    const address = `?mode=grids&puzzle=${id}` + (testMode ? "&test" : "");
    location.href = address;
  }
  function randomUnlimited() {
    const fresh = data.unlimited.filter((p) => {
      try { const s = JSON.parse(localStorage.getItem(`das-grids:${p.id}`)); return !(s && Object.keys(s.picks || {}).length === 9); } catch (e) { return true; }
    });
    const pool = fresh.length ? fresh : data.unlimited;
    return pool[Math.floor(Math.random() * pool.length)].id;
  }
  function drawArchive(today) {
    const list = $("grid-archive-list");
    list.replaceChildren();
    for (let n = today; n >= 1; n--) {
      const id = `D${n}`;
      let done = 0;
      try { done = Object.keys((JSON.parse(localStorage.getItem(`das-grids:${id}`)) || {}).picks || {}).length; } catch (e) { /* none */ }
      const a = el("a", "archive-item" + (id === puzzle.id ? " current" : ""));
      a.href = `?mode=grids&puzzle=${id}` + (testMode ? "&test" : "");
      a.append(el("b", null, `#${n}`), el("span", null, niceDate(dateOfDaily(n))), el("small", null, done ? `${done}/9` : ""));
      list.append(a);
    }
  }

  /* ---------- start ---------- */

  async function start() {
    show("grids");
    document.title = "DAS GRIDS · Das Trivia";
    try {
      const response = await fetch("data/grids.json", { cache: "no-cache" });
      data = await response.json();
    } catch (e) {
      $("grid-board").replaceChildren(el("p", "fine", "The grids didn't load. Refresh to try again."));
      return;
    }
    search = data.search.map(([id, name, nicknames]) => {
      const key = normalize(name);
      const nicks = (nicknames || []).map(normalize);      // "wemby", "joker", "sga"...
      return { id, name, key, words: key.split(" ").concat(nicks.flatMap((n) => n.split(" "))), nicks };
    });

    const today = Math.min(data.daily.length, Math.max(1, daysBetween(data.start_date, gridDate()) + 1));
    const wanted = params.get("puzzle") || "";
    puzzle = data.daily.find((p) => p.id === wanted && Number(p.id.slice(1)) <= today)
      || data.unlimited.find((p) => p.id === wanted)
      || data.daily[today - 1];
    kind = puzzle.id.startsWith("D") ? "daily" : "unlimited";
    number = kind === "daily" ? Number(puzzle.id.slice(1)) : null;
    if (wanted !== puzzle.id) history.replaceState(null, "", `?mode=grids&puzzle=${puzzle.id}` + (testMode ? "&test" : ""));

    $("game-tag").textContent = (kind === "daily" ? `Grids #${number}` : `Grid ${puzzle.id}`) + (testMode ? " · test" : "");
    $("tab-daily").classList.toggle("on", kind === "daily" && number === today);
    $("tab-unlimited").classList.toggle("on", kind === "unlimited");
    $("tab-daily").textContent = `Daily #${today}`;
    $("tab-daily").onclick = () => go(`D${today}`);
    $("tab-unlimited").onclick = () => go(kind === "unlimited" ? randomUnlimited() : randomUnlimited());
    $("tab-archive").onclick = () => { drawArchive(today); $("grid-archive").hidden = !$("grid-archive").hidden; };
    $("grid-change-player").onclick = (event) => { event.preventDefault(); askName(() => show("grids")); };
    $("pick-close").onclick = closePicker;
    $("grid-modal").onclick = (event) => { if (event.target === $("grid-modal")) closePicker(); };
    $("pick-input").oninput = drawSuggestions;
    $("pick-input").onkeydown = (event) => {
      if (event.key === "Escape") closePicker();
      if (event.key === "Enter") { event.preventDefault(); const first = $("pick-list").querySelector(".pick-option"); if (first) first.click(); }
    };
    $("res-share").onclick = shareResults;
    $("res-copy").onclick = copyResults;
    $("res-again").onclick = () => go(randomUnlimited());
    $("res-board").onclick = () => $("grid-leaders-title").scrollIntoView({ behavior: "smooth" });
    $("grid-test-note").hidden = !(testMode || closed());
    if (closed() && !testMode) $("grid-test-note").textContent = "This daily grid is closed. You can still play it, but it doesn't count toward the leaderboard or anyone's rarity.";
    // the share video's buttons (the other games set these up in game.js, which doesn't run here)
    const closeVideo = () => { $("share-video-player").pause(); $("share-video").hidden = true; };
    $("video-close").onclick = closeVideo;
    $("share-video-player").onended = closeVideo;
    $("share-video").onclick = (event) => { if (event.target === $("share-video")) closeVideo(); };
    $("video-sound").onclick = () => { $("share-video-player").muted = false; $("video-sound").hidden = true; };

    state = loadState();
    drawPlayer();
    draw();
    loadLeaderboard();
    refreshRarity();
    if (Object.keys(state.picks).length === 9 && !state.finished) finishGrid();
  }

  start();
})();
