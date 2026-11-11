/* Das Trivia: game logic.
   Add ?test to the address to replay freely (nothing is saved); ?test&day=3 plays Game #3. */
(() => {
  "use strict";

  const SECONDS = 25;
  const BASE_POINTS = 100;        // prototype scoring; replaced by rarity scoring later
  const SPEED_BONUS_PER_SECOND = 2;
  const CLOSE_NUMBER_RANGE = 2;   // number questions: this near the answer counts as "close"
  const CLOSE_SHARE = 0.5;        // a close answer earns this share of the points
  const TIME_ZONE = "America/New_York";
  const MAX_CHIPS = 14;

  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const testMode = params.has("test");

  let game, questions, gameNumber, state, known, timerId = null;

  /* ---------- text matching ---------- */

  // "Dončić" -> "doncic", "LeBong James 👑" -> "lebongjames"
  function normalize(text) {
    return String(text).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
      .replace(/ı/g, "i").replace(/ø/g, "o").replace(/đ/g, "d").replace(/ł/g, "l").replace(/ß/g, "ss")
      .replace(/[^a-z0-9]/g, "");
  }

  function editDistance(a, b) {
    if (Math.abs(a.length - b.length) > 3) return 4;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const row = [i];
      for (let j = 1; j <= b.length; j++) {
        row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = row;
    }
    return prev[b.length];
  }

  // Returns the matching answer, or null.
  // Number questions only: a near-miss earns partial credit (shown in orange).
  // "Close" means within 2 of the answer, or within 10% for big numbers.
  function isCloseNumber(question, typed) {
    if (question.kind !== "number") return false;
    const guess = Number(String(typed).replace(/[^0-9.\-]/g, ""));
    if (!String(typed).match(/[0-9]/) || Number.isNaN(guess)) return false;
    return question.answers.some((a) => {
      const real = Number(a.display);
      return !Number.isNaN(real) && Math.abs(guess - real) <= Math.max(CLOSE_NUMBER_RANGE, Math.abs(real) * 0.1);
    });
  }

  function findAnswer(question, typed) {
    const input = normalize(typed);
    if (!input) return null;
    for (const answer of question.answers) {
      if (answer.accept.some((a) => normalize(a) === input)) return answer;
    }
    // Numbers must be exact. A near-miss that is exactly some other known name is not a typo.
    if (question.kind === "number" || known.has(input)) return null;
    // a decent-sized chunk of the answer counts: "edey and matas" for "The Edey and Matas Show"
    if (input.length >= 5) {
      for (const answer of question.answers) {
        if (answer.accept.some((a) => normalize(a).includes(input))) return answer;
      }
    }
    // how many wrong, missing or extra letters are forgiven, by length of what was typed
    const allowed = input.length >= 11 ? 3 : input.length >= 7 ? 2 : input.length >= 4 ? 1 : 0;
    if (!allowed) return null;
    let best = null, bestDistance = allowed + 1;
    for (const answer of question.answers) {
      for (const a of answer.accept) {
        const target = normalize(a);
        if (target.length < 4) continue;
        const d = editDistance(input, target);
        if (d < bestDistance) { best = answer; bestDistance = d; }
      }
    }
    return best;
  }

  /* ---------- dates and saving ---------- */

  function today() {
    return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  }
  function daysBetween(from, to) {
    const utc = (s) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
    return Math.round((utc(to) - utc(from)) / 86400000);
  }

  const storageKey = () => `das-league-trivia:game:${gameNumber}`;
  function loadState() {
    if (!testMode) {
      try {
        const saved = JSON.parse(localStorage.getItem(storageKey()));
        if (saved && Array.isArray(saved.answers)) return saved;
      } catch (e) { /* no saved game */ }
    }
    return { answers: [], startedAt: null };
  }
  function saveState() {
    if (testMode) return;
    try { localStorage.setItem(storageKey(), JSON.stringify(state)); } catch (e) { /* private browsing */ }
  }

  /* ---------- screens ---------- */

  function show(screen) {
    for (const el of document.querySelectorAll(".screen")) el.hidden = el.id !== `screen-${screen}`;
    window.scrollTo(0, 0);
  }

  function pick(value) {
    if (Array.isArray(value)) return value.length ? value[Math.floor(Math.random() * value.length)] : null;
    return value || null;
  }

  function drawProgress(current) {
    const bar = $("progress");
    bar.replaceChildren();
    questions.forEach((_, i) => {
      const dot = document.createElement("span");
      if (state.answers[i]) dot.className = state.answers[i].result;
      else if (i === current) dot.className = "current";
      bar.append(dot);
    });
  }

  function showQuestion() {
    const index = state.answers.length;
    if (index >= questions.length) return showResults();
    const question = questions[index];

    show("question");
    const card = $("screen-question");
    card.classList.remove("result-correct", "result-close", "result-wrong", "result-timeout");
    $("feedback").hidden = true;
    $("answer-form").hidden = false;
    $("q-count").textContent = `Question ${index + 1} of ${questions.length}`;
    $("q-text").textContent = question.text;
    drawProgress(index);

    const input = $("answer");
    input.value = "";
    input.inputMode = question.kind === "number" ? "numeric" : "text";
    input.focus();

    // The clock keeps running through a page refresh.
    if (!state.startedAt) { state.startedAt = Date.now(); saveState(); }
    const timer = document.querySelector(".timer");
    timer.classList.remove("stopped");
    const tick = () => {
      const left = SECONDS - (Date.now() - state.startedAt) / 1000;
      $("timer-fill").style.transform = `scaleX(${Math.max(0, left / SECONDS)})`;
      $("timer-num").textContent = Math.max(0, Math.ceil(left));
      timer.classList.toggle("low", left <= 5);
      if (left <= 0) finish("timeout", "", null);
    };
    clearInterval(timerId);
    timerId = setInterval(tick, 100);
    tick();
  }

  // After a correct answer, play the cutscene for the step just reached, then carry on.
  function nextStep() {
    const last = state.answers[state.answers.length - 1];
    if (!last || last.result !== "correct" || !window.Cutscene) return showQuestion();
    const step = state.answers.filter((a) => a.result === "correct").length;
    show("cutscene");
    window.Cutscene.play(step, showQuestion);
  }

  function finish(result, typed, answer) {
    clearInterval(timerId);
    const index = state.answers.length;
    const question = questions[index];
    const secondsLeft = Math.max(0, SECONDS - (Date.now() - state.startedAt) / 1000);
    const full = BASE_POINTS + Math.round(secondsLeft * SPEED_BONUS_PER_SECOND);
    const points = result === "correct" ? full : result === "close" ? Math.round(full * CLOSE_SHARE) : 0;

    // the question is saved with the answer, so the recap stays right even if the question list changes later
    state.answers.push({
      result, typed, points,
      matched: answer ? answer.display : null,
      question: question.text,
      answer: question.answers.length === 1 ? question.answers[0].display : null,
    });
    state.startedAt = null;
    saveState();

    // reaction (customise in js/effects.js)
    const fx = (window.EFFECTS || {})[result] || {};
    const fallback = { correct: "Correct!", close: "So close!", wrong: "Wrong!", timeout: "Out of time!" }[result];
    $("verdict").textContent = pick(fx.messages) || fallback;
    // a picture of the manager the question is about beats the general picture
    const gallery = (window.EFFECTS || {}).managers || {};
    const involved = [
      answer && answer.manager,
      question.answers.length === 1 && question.answers[0].manager,
      ...(question.about || []),
    ].filter((id) => id && gallery[id] && gallery[id].length);
    const image = involved.length ? pick(gallery[involved[0]]) : pick(fx.image);
    // swap in a fresh picture element so the previous question's picture can never linger
    const fresh = document.createElement("img");
    fresh.id = "fx-image"; fresh.className = "fx-image"; fresh.alt = ""; fresh.hidden = true;
    $("fx-image").replaceWith(fresh);
    if (image) {
      fresh.onload = () => { fresh.hidden = false; };
      fresh.src = image;
    }
    const sound = pick(fx.sound);
    if (sound) { try { new Audio(sound).play().catch(() => {}); } catch (e) { /* sound is optional */ } }

    const card = $("screen-question");
    card.classList.add(`result-${result}`);
    document.querySelector(".timer").classList.add("stopped");
    drawProgress(-1);

    $("points").textContent = result === "correct" ? `+${points} points`
      : result === "close" ? `+${points} points for being close` : "No points";
    const said = $("you-said");
    said.replaceChildren();
    if (result === "timeout") said.textContent = "You didn't answer in time.";
    else { said.append("You said: "); const b = document.createElement("b"); b.textContent = typed; said.append(b); }

    const total = question.answers.length;
    // The answer in bold, then a sentence or two about it, then any other accepted answers.
    const main = answer || (total === 1 ? question.answers[0] : null);
    $("answers-label").textContent = !main ? `Accepted answers (${total})`
      : answer && total > 1 ? "Your answer" : "The answer";
    $("answer-main").textContent = main ? main.display : "";
    $("answer-main").hidden = !main;
    const facts = [question.note, main && main.detail].filter(Boolean).join(" ");
    $("note").textContent = facts;
    $("note").hidden = !facts;

    const others = question.answers.filter((a) => a !== main);
    $("others-label").textContent = `Other accepted answers (${others.length})`;
    $("others-label").hidden = !main || !others.length;
    const chips = $("answers");
    chips.replaceChildren();
    chips.hidden = !others.length;
    others.slice(0, MAX_CHIPS).forEach((a) => {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = a.display;
      chips.append(chip);
    });
    if (others.length > MAX_CHIPS) {
      const more = document.createElement("span");
      more.className = "chip more";
      more.textContent = `and ${others.length - MAX_CHIPS} more`;
      chips.append(more);
    }

    $("btn-next").textContent = index + 1 < questions.length ? "Next question" : "See my score";
    $("answer-form").hidden = true;
    $("feedback").hidden = false;
    $("btn-next").focus();
  }

  // What gets pasted into the group chat: title, seven green/red boxes, then the score.
  function shareText() {
    const score = state.answers.reduce((sum, a) => sum + a.points, 0);
    const lines = [
      `🏀 ${game.title} #${gameNumber}`,
      state.answers.map((a) => (a.result === "correct" ? "🟩" : a.result === "close" ? "🟧" : "🟥")).join(""),
      `Score: ${score}`,
    ];
    if (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) lines.push(location.origin + location.pathname);
    return lines.join("\n");
  }

  /* ---------- player name and daily leaderboard ---------- */

  const PLAYER_KEY = "das-trivia:player";
  const config = window.DAS_CONFIG || {};
  const online = Boolean(config.supabaseUrl && config.supabaseKey);
  let rememberedName = "", afterName = null;

  function getPlayer() {
    if (rememberedName) return rememberedName;
    try { rememberedName = localStorage.getItem(PLAYER_KEY) || ""; } catch (e) { /* private browsing */ }
    return rememberedName;
  }
  function setPlayer(name) {
    rememberedName = name.trim().slice(0, 20);
    try { localStorage.setItem(PLAYER_KEY, rememberedName); } catch (e) { /* private browsing */ }
    drawPlayer();
  }
  function drawPlayer() {
    $("playing-as").hidden = !getPlayer();
    $("player-name").textContent = getPlayer();
  }

  // Shown after Tip off the first time, or when "change" is tapped.
  function askName(then) {
    afterName = then;
    const box = $("names");
    box.replaceChildren();
    (game.players || []).forEach((p) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "name-btn" + (p.name === getPlayer() ? " picked" : "");
      button.textContent = p.name;
      button.addEventListener("click", () => chooseName(p.name));
      box.append(button);
    });
    $("other-name").value = "";
    show("name");
  }
  function chooseName(name) {
    if (!name.trim()) return;
    setPlayer(name);
    const next = afterName;
    afterName = null;
    if (next) next();
  }
  function tipOff() {
    if (!getPlayer()) return askName(showQuestion);
    showQuestion();
  }

  async function database(path, options = {}) {
    const response = await fetch(`${config.supabaseUrl}/rest/v1/${path}`, {
      ...options,
      headers: { apikey: config.supabaseKey, Authorization: `Bearer ${config.supabaseKey}`, "Content-Type": "application/json", ...(options.headers || {}) },
    });
    if (!response.ok) throw new Error(`leaderboard returned ${response.status}`);
    return response.status === 200 ? response.json() : null;
  }

  // Sends this player's score once, then shows everyone's scores for today's game.
  async function showLeaderboard(score, right) {
    const boxes = state.answers.map((a) => (a.result === "correct" ? "🟩" : a.result === "close" ? "🟧" : "🟥")).join("");
    const mine = { player: getPlayer() || "You", score, correct: right, boxes };
    const list = $("leaders"), status = $("leaders-status");

    const draw = (rows, note) => {
      list.replaceChildren();
      rows.forEach((row, i) => {
        const item = document.createElement("li");
        if (row.player === mine.player) item.className = "me";
        const rank = document.createElement("span"); rank.className = "lr"; rank.textContent = i + 1;
        const name = document.createElement("span"); name.className = "ln"; name.textContent = row.player;
        const marks = document.createElement("span"); marks.className = "lb"; marks.textContent = row.boxes || "";
        const points = document.createElement("span"); points.className = "ls"; points.textContent = row.score;
        item.append(rank, name, marks, points);
        list.append(item);
      });
      status.textContent = note;
      status.hidden = !note;
    };

    if (!online) return draw([mine], "The shared leaderboard isn't connected yet, so only your score shows here.");
    draw([mine], "Loading the leaderboard…");
    try {
      if (!testMode && !state.submitted) {
        await database("scores?on_conflict=game,player", {
          method: "POST",
          headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
          body: JSON.stringify({ game: gameNumber, ...mine }),
        });
        state.submitted = true;
        saveState();
      }
      const rows = await database(`scores?game=eq.${gameNumber}&select=player,score,correct,boxes&order=score.desc,created_at.asc&limit=50`);
      const everyone = testMode && !rows.some((r) => r.player === mine.player) ? [...rows, mine].sort((a, b) => b.score - a.score) : rows;
      draw(everyone, testMode ? "Practice mode: your score isn't saved to the leaderboard." : "First score counts. One game per player per day.");
    } catch (error) {
      draw([mine], "Couldn't reach the leaderboard right now, so only your score shows here.");
    }
  }

  function showResults() {
    show("results");
    const score = state.answers.reduce((sum, a) => sum + a.points, 0);
    const right = state.answers.filter((a) => a.result === "correct").length;
    $("final-score").textContent = score;
    $("final-sub").textContent = `${right} of ${questions.length} correct · Game #${gameNumber}`;

    const grid = $("final-grid");
    grid.replaceChildren();
    const recap = $("recap");
    recap.replaceChildren();
    state.answers.forEach((a, i) => {
      const square = document.createElement("span");
      square.className = a.result;
      grid.append(square);

      const item = document.createElement("li");
      item.className = a.result;
      const pts = document.createElement("span"); pts.className = "rp"; pts.textContent = a.points ? `+${a.points}` : "0";
      const q = document.createElement("div"); q.className = "rq"; q.textContent = a.question || questions[i].text;
      const r = document.createElement("div"); r.className = "ra";
      r.textContent = a.result === "correct" ? `✓ ${a.matched}`
        : a.result === "close" ? `≈ Close! You said "${a.typed}"`
        : a.result === "wrong" ? `✗ You said "${a.typed}"` : "Ran out of time";
      if (a.result !== "correct" && a.answer) r.textContent += ` · Answer: ${a.answer}`;
      item.append(pts, q, r);
      recap.append(item);
    });
    showLeaderboard(score, right);
  }

  async function copyShare() {
    const text = shareText();
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch (e) {
      const box = document.createElement("textarea");
      box.value = text; box.style.position = "fixed"; box.style.opacity = "0";
      document.body.append(box); box.select();
      try { ok = document.execCommand("copy"); } catch (e2) { /* fall through */ }
      box.remove();
    }
    $("share-status").textContent = ok ? "Copied! Paste it into the group chat." : "Couldn't copy automatically: " + text;
    $("btn-share").textContent = ok ? "Copied ✓" : "Share result";
  }

  /* ---------- start ---------- */

  async function start() {
    try {
      const response = await fetch("data/game.json", { cache: "no-cache" });
      if (!response.ok) throw new Error(`data/game.json returned ${response.status}`);
      game = await response.json();
    } catch (error) {
      $("error-text").textContent = "The question file didn't load. " + error.message;
      return show("error");
    }

    let dayIndex = Math.max(0, daysBetween(game.start_date, today()));
    if (testMode && params.get("day")) dayIndex = Math.max(0, Number(params.get("day")) - 1 || 0);
    gameNumber = dayIndex + 1;
    questions = game.days[dayIndex % game.days.length];
    known = new Set(game.entities.map(normalize));
    state = loadState();

    $("game-tag").textContent = `Game #${gameNumber}` + (testMode ? " · test" : "");
    $("start-date").textContent = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, weekday: "long", month: "long", day: "numeric" }).format(new Date());

    $("btn-play").addEventListener("click", tipOff);
    $("change-player").addEventListener("click", (event) => { event.preventDefault(); askName(() => show("start")); });
    $("other-form").addEventListener("submit", (event) => { event.preventDefault(); chooseName($("other-name").value); });
    drawPlayer();
    $("btn-next").addEventListener("click", nextStep);
    $("btn-share").addEventListener("click", copyShare);
    $("answer-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const input = $("answer");
      const typed = input.value.trim();
      if (!typed) {
        input.classList.remove("nudge"); void input.offsetWidth; input.classList.add("nudge");
        return input.focus();
      }
      const answer = findAnswer(questions[state.answers.length], typed);
      const question = questions[state.answers.length];
      finish(answer ? "correct" : isCloseNumber(question, typed) ? "close" : "wrong", typed, answer);
    });

    // testing: ?test&scene=3 plays cutscene 3; ?test&scene=all plays all seven in a row
    if (testMode && params.get("scene") && window.Cutscene) {
      const wanted = params.get("scene") === "all" ? [1, 2, 3, 4, 5, 6, 7] : [Number(params.get("scene")) || 1];
      const playNext = () => {
        if (!wanted.length) return show("start");
        show("cutscene");
        window.Cutscene.play(wanted.shift(), playNext);
      };
      return playNext();
    }

    if (state.answers.length >= questions.length) showResults();
    else if (state.startedAt) showQuestion();   // refreshed mid-question: the clock kept running
    else {
      if (state.answers.length) $("btn-play").textContent = "Resume game";
      show("start");
    }
  }

  start();
})();
