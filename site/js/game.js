/* Das Trivia: game logic.
   Add ?test to the address to replay freely (nothing is saved); ?test&day=3 plays Game #3.
   ?mode=papo plays the bonus game "Papo Trade or NOT" (5 yes-or-no trade questions a day). */
(() => {
  "use strict";

  const BASE_POINTS = 100;        // then x difficulty, x hint, and on the leaderboard x rarity (Das Trivia)
  const DIFFICULTY = { easy: { label: "Easy", x: 1 }, medium: { label: "Medium", x: 1.25 }, hard: { label: "Hard", x: 1.5 } };
  const HINT_SHARE = 0.6;         // a hint keeps this share of the points
  const SPEED_BONUS_PER_SECOND = 2;
  const CLOSE_NUMBER_RANGE = 2;   // number questions: this near the answer counts as "close"
  const CLOSE_SHARE = 0.5;        // a close answer earns this share of the points
  const TIME_ZONE = "America/New_York";
  const MAX_CHIPS = 14;

  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const testMode = params.has("test");

  // Each game mode has its own question file, saved progress and leaderboard.
  // Papo Trade or NOT scores are stored as game number 50000 + its day number, so the two never mix.
  // What team am I? scores use 60000 + day.
  // No mode on the address = the home page with the list of games.
  const home = !params.get("mode");
  const mode = ["papo", "team", "rorw"].includes(params.get("mode")) ? params.get("mode") : "trivia";
  const MODES = {
    trivia: { file: "data/game.json", key: "game", board: 0, startScreen: "start", play: "btn-play", label: "Game", tag: "Game", icon: "🏀", seconds: 25 },
    papo: { file: "data/papo.json", key: "papo", board: 50000, startScreen: "papo-start", play: "btn-play-papo", label: "Papo Trade or NOT", tag: "Papo", icon: "🔄", seconds: 25 },
    team: { file: "data/team.json", key: "team", board: 60000, startScreen: "team-start", play: "btn-play-team", label: "What team am I?", tag: "Team", icon: "🕵️", seconds: 40 },
    // Rostered or Waiver: built every morning from Sleeper's live rosters (scripts/build_rorw.py). Scores: 70000 + day.
    rorw: { file: "data/rorw.json", key: "rorw", board: 70000, startScreen: "rorw-start", play: "btn-play-rorw", label: "Rostered or Waiver", tag: "R/W", icon: "🗑️", seconds: 20 },
  };
  const M = MODES[mode];
  const keepTest = (address) => (testMode ? address + (address.includes("?") ? "&" : "?") + "test" : address);

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

  // "Jaren Jackson Jr." -> also try "Jaren Jackson"; "J. Williams" / "J Williams" -> also try "Williams"
  function inputVariants(typed) {
    const words = String(typed).trim().split(/\s+/).filter(Boolean);
    const out = [words.join(" ")];
    const bare = words.filter((w, i) => !(i > 0 && /^(jr|sr|ii|iii|iv)\.?$/i.test(w)));
    if (bare.length !== words.length) out.push(bare.join(" "));
    if (bare.length >= 2 && /^[a-z]\.?$/i.test(bare[0])) out.push(bare.slice(1).join(" "));
    return [...new Set(out.map(normalize))].filter(Boolean);
  }

  function findAnswer(question, typed) {
    for (const input of inputVariants(typed)) {
      const hit = findAnswerFor(question, input);
      if (hit) return hit;
    }
    return null;
  }

  function findAnswerFor(question, input) {
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
    // a typo that is even closer to some OTHER name the game knows is that other name, so it's wrong
    // (ties still count: the owner wants matching to be generous)
    if (best && bestDistance > 0) {
      const mine = new Set(question.answers.flatMap((a) => a.accept.map(normalize)));
      for (const other of known) {
        if (!mine.has(other) && other.length >= 4 && Math.abs(other.length - input.length) < bestDistance
            && editDistance(input, other) < bestDistance) return null;
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

  // Days the owner reset (new questions, scores wiped): browsers forget their saved game for that day.
  // Add  gameNumber: 1  under a mode to reset that day; raise to 2 to reset it again.
  const RESETS = { game: { 6: 1 } };   // "game" = Das Trivia
  const resetTag = () => ((RESETS[M.key] || {})[gameNumber] ? `:r${RESETS[M.key][gameNumber]}` : "");
  const storageKey = () => `das-league-trivia:${M.key}:${gameNumber}${resetTag()}`;
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
    stopSong();
    const clueMode = question.kind === "clues";
    if (clueMode && !state.startedAt) { state.clue = 0; state.guesses = []; }

    show("question");
    const card = $("screen-question");
    card.classList.remove("result-correct", "result-close", "result-wrong", "result-timeout");
    $("feedback").hidden = true;
    const yesno = question.kind === "yesno" || question.kind === "rw";
    $("answer-form").hidden = yesno;
    $("yesno").hidden = !yesno;
    $("trade").hidden = !yesno;
    if (question.kind === "yesno") drawTrade(question);
    if (question.kind === "rw") drawPlayerCard(question);
    $("clues").hidden = !clueMode;
    if (clueMode) drawClues(question);
    $("q-count").textContent = clueMode
      ? `Team ${index + 1} of ${questions.length} · worth ${question.points[state.clue]} points`
      : `Question ${index + 1} of ${questions.length}`;
    $("q-text").textContent = question.text;
    drawProgress(index);
    // Das Trivia: difficulty tag and the hint button
    const level = DIFFICULTY[question.difficulty];
    $("q-level").hidden = !level;
    if (level) {
      $("q-level").textContent = `${level.label} · ×${level.x}`;
      $("q-level").className = `q-level ${question.difficulty}`;
    }
    const canHint = mode === "trivia" && ["manager", "player", "number"].includes(question.kind);
    $("hint-row").hidden = !canHint;
    $("hint-text").hidden = !state.hint;
    $("btn-hint").hidden = Boolean(state.hint);
    if (state.hint) $("hint-text").textContent = hintFor(question);

    const input = $("answer");
    input.value = "";
    input.inputMode = question.kind === "number" ? "numeric" : "text";
    input.placeholder = clueMode ? "Type a manager or team name" : "Type your answer";
    if (!yesno) input.focus();

    // The clock keeps running through a page refresh.
    if (!state.startedAt) { state.startedAt = Date.now(); saveState(); }
    const timer = document.querySelector(".timer");
    timer.classList.remove("stopped");
    const tick = () => {
      const left = M.seconds - (Date.now() - state.startedAt) / 1000;
      $("timer-fill").style.transform = `scaleX(${Math.max(0, left / M.seconds)})`;
      $("timer-num").textContent = Math.max(0, Math.ceil(left));
      timer.classList.toggle("low", left <= 5);
      if (left <= 0) {
        // What team am I?: running out of time on a clue just reveals the next one
        if (clueMode && state.clue < question.clues.length - 1) return nextClue(null);
        finish("timeout", "", null);
      }
    };
    clearInterval(timerId);
    timerId = setInterval(tick, 100);
    tick();
  }

  // A hint costs part of the points. It narrows things down without giving the answer away.
  function hintFor(question) {
    const answers = question.answers;
    const count = answers.length > 1 ? ` (${answers.length} answers accepted)` : "";
    if (question.kind === "number") {
      const v = Number(answers[0].display);
      const low = Math.max(0, Math.floor(v * 0.6) - 1), high = Math.ceil(v * 1.4) + 1;
      return `Somewhere between ${low} and ${high}.`;
    }
    const first = answers[0];
    if (question.kind === "manager") {
      const name = (first.accept.find((a) => a && a[0] === a[0].toUpperCase() && !a.includes(" ")) || first.display);
      const pick = (first.display.match(/\(([^)]+)\)$/) || [])[1] || name;
      return `One answer's manager starts with "${pick[0].toUpperCase()}"${count}.`;
    }
    const initials = first.display.split(/\s+/).filter((w) => !/^(jr|sr|ii|iii|iv)\.?$/i.test(w)).map((w) => w[0].toUpperCase() + ".").join(" ");
    return `One answer's initials: ${initials}${count}.`;
  }

  function useHint() {
    if (state.hint || !state.startedAt) return;
    state.hint = true;
    saveState();
    $("btn-hint").hidden = true;
    $("hint-text").textContent = hintFor(questions[state.answers.length]);
    $("hint-text").hidden = false;
    $("answer").focus();
  }

  // Papo Trade or NOT: the trade, with the teams hidden as Team A and Team B.
  function drawTrade(question) {
    const box = $("trade");
    box.replaceChildren();
    const date = document.createElement("p");
    date.className = "trade-date";
    date.textContent = `Trade · ${question.date}`;
    box.append(date);
    question.sides.forEach((items, i) => {
      if (i) {
        const swap = document.createElement("div");
        swap.className = "trade-swap";
        swap.textContent = "⇅";
        box.append(swap);
      }
      const side = document.createElement("div");
      side.className = "trade-side";
      const who = document.createElement("p");
      who.className = "trade-who";
      who.textContent = `Team ${"ABC"[i]} got`;
      const list = document.createElement("div");
      list.className = "chips";
      (items.length ? items : ["Nothing"]).forEach((text) => {
        const chip = document.createElement("span");
        chip.className = "chip";
        chip.textContent = text;
        list.append(chip);
      });
      side.append(who, list);
      box.append(side);
    });
  }

  // What team am I?: the clue ladder. Revealed clues stay on screen; the rest show a lock.
  function drawClues(question) {
    const box = $("clues");
    box.replaceChildren();
    question.clues.forEach((text, i) => {
      const card = document.createElement("div");
      const open = i <= state.clue;
      card.className = "clue" + (open ? "" : " locked") + (i === state.clue ? " new" : "");
      const label = document.createElement("p");
      label.className = "clue-label";
      label.textContent = `Clue ${i + 1}` + (i === 0 ? " · hardest" : i === question.clues.length - 1 ? " · easiest" : "")
        + ` · ${question.points[i]} pts`;
      card.append(label);
      if (open) {
        const body = document.createElement("p");
        body.className = "clue-text";
        body.textContent = text;
        card.append(body);
      }
      box.append(card);
    });
    if (state.guesses && state.guesses.length) {
      const tried = document.createElement("div");
      tried.className = "chips guesses";
      state.guesses.forEach((g) => {
        const chip = document.createElement("span");
        chip.className = "chip wrong-guess";
        chip.textContent = g || "Time ran out";
        tried.append(chip);
      });
      box.append(tried);
    }
  }

  // A wrong guess (or the clock running out) on a clue that isn't the last: open the next clue.
  function nextClue(guess) {
    clearInterval(timerId);
    state.guesses = [...(state.guesses || []), guess];
    state.clue += 1;
    state.startedAt = Date.now();
    saveState();
    showQuestion();
    const input = $("answer");
    input.classList.remove("nudge"); void input.offsetWidth; input.classList.add("nudge");
    $("clues").querySelector(".clue.new").scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // What team am I?: the song for a correct guess (effects.js teamReveal). Stops on Next.
  let song = null;
  function playSong(setting) {
    stopSong();
    if (!setting) return;
    const file = typeof setting === "string" ? setting : setting.file;
    if (!file) return;
    try {
      song = new Audio(file);
      if (setting.start) song.currentTime = setting.start;
      song.play().catch(() => {});
    } catch (e) { /* the song is optional */ }
  }
  function stopSong() {
    if (song) { song.pause(); song = null; }
  }

  // Rostered or Waiver: the player card (stats only, no team).
  function drawPlayerCard(question) {
    const p = question.player;
    const box = $("trade");
    box.replaceChildren();
    const add = (tag, cls, text) => { const n = document.createElement(tag); n.className = cls; n.textContent = text; box.append(n); return n; };
    add("p", "trade-date", "This season · " + (game.as_of && game.as_of[gameNumber - 1] ? `rosters as of ${game.as_of[gameNumber - 1]}` : ""));
    add("p", "rw-name", p.name);
    add("p", "rw-sub", `${p.pos} · ${p.nba} · ${p.gp} games`);
    const big = add("div", "rw-fpg", "");
    big.append(Object.assign(document.createElement("b"), { textContent: p.fpg.toFixed(1) }),
      Object.assign(document.createElement("span"), { textContent: "fantasy points a game" }));
    add("p", "rw-line", p.line);
    if (p.recent != null) {
      const diff = p.recent - p.fpg;
      const trend = Math.abs(diff) < 2 ? "steady" : diff > 0 ? `up ${diff.toFixed(1)} 🔥` : `down ${(-diff).toFixed(1)} 🧊`;
      add("p", "rw-form", `Last ${p.recent_n} games: ${p.recent.toFixed(1)} a game (${trend})`);
    }
    if (p.injury) add("p", "rw-injury", `🩼 ${p.injury}`);
    add("p", "rw-teams", `Has been on ${p.teams} Das League ${p.teams === 1 ? "team" : "teams"}`);
  }

  // After a correct answer, play the cutscene for the step just reached, then carry on.
  function nextStep() {
    const last = state.answers[state.answers.length - 1];
    if (mode !== "trivia" || !last || last.result !== "correct" || !window.Cutscene) return showQuestion();
    const step = state.answers.filter((a) => a.result === "correct").length;
    show("cutscene");
    window.Cutscene.play(step, showQuestion);
  }

  function finish(result, typed, answer) {
    clearInterval(timerId);
    const index = state.answers.length;
    const question = questions[index];
    const secondsLeft = Math.max(0, M.seconds - (Date.now() - state.startedAt) / 1000);
    const level = DIFFICULTY[question.difficulty];
    const hinted = Boolean(state.hint);
    const raw = question.kind === "clues" ? question.points[state.clue] : BASE_POINTS + Math.round(secondsLeft * SPEED_BONUS_PER_SECOND);
    const full = Math.round(raw * (level ? level.x : 1) * (hinted ? HINT_SHARE : 1));
    const points = result === "correct" ? full : result === "close" ? Math.round(full * CLOSE_SHARE) : 0;

    // the question is saved with the answer, so the recap stays right even if the question list changes later
    state.answers.push({
      result, typed, points,
      matched: answer ? answer.display : null,
      question: question.recap || question.text,
      answer: question.answers.length === 1 ? question.answers[0].display : null,
      clue: question.kind === "clues" ? state.clue + 1 : undefined,
      hint: hinted || undefined,
      level: question.difficulty,
    });
    state.startedAt = null;
    state.hint = false;
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
    // What team am I?: a guessed team can have its own picture and song (effects.js teamReveal)
    const reveal = question.kind === "clues" && result === "correct"
      ? ((window.EFFECTS || {}).teamReveal || {})[question.answers[0].manager] : null;
    const image = reveal && reveal.image ? pick(reveal.image)
      : involved.length ? pick(gallery[involved[0]]) : pick(fx.image);
    // a song tied to the picture (effects.js pictureSongs) plays wherever that picture shows up
    const pictureSong = image && ((window.EFFECTS || {}).pictureSongs || {})[image];
    const songToPlay = (reveal && reveal.song) || pictureSong;
    if (songToPlay) playSong(songToPlay);
    // swap in a fresh picture element so the previous question's picture can never linger
    const fresh = document.createElement("img");
    fresh.id = "fx-image"; fresh.className = "fx-image"; fresh.alt = ""; fresh.hidden = true;
    $("fx-image").replaceWith(fresh);
    if (image) {
      fresh.onload = () => { fresh.hidden = false; };
      fresh.src = image;
    }
    const sound = songToPlay ? null : pick(fx.sound);
    if (sound) { try { new Audio(sound).play().catch(() => {}); } catch (e) { /* sound is optional */ } }

    const card = $("screen-question");
    card.classList.add(`result-${result}`);
    document.querySelector(".timer").classList.add("stopped");
    drawProgress(-1);

    const extras = [level && level.x !== 1 ? `${level.label.toLowerCase()} ×${level.x}` : "", hinted ? "hint used" : ""].filter(Boolean).join(", ");
    $("points").textContent = (result === "correct" ? `+${points} points`
      : result === "close" ? `+${points} points for being close` : "No points") + (extras && points ? ` (${extras})` : "");
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
    $("yesno").hidden = true;
    $("hint-row").hidden = true;
    $("feedback").hidden = false;
    // the trade stays on screen above the answer, so bring the answer into view on phones
    if (["yesno", "clues", "rw"].includes(question.kind)) $("feedback").scrollIntoView({ behavior: "smooth", block: "start" });
    $("btn-next").focus();
  }

  // The boxes for the share text and leaderboard. What team am I? also says which clue cracked it.
  function marks() {
    if (mode === "team") return state.answers.map((a) => (a.result === "correct" ? `🟩 clue ${a.clue}` : "🟥")).join("  ");
    return state.answers.map((a) => (a.result === "correct" ? "🟩" : a.result === "close" ? "🟧" : "🟥")).join("");
  }

  // What gets pasted into the group chat: title, the boxes, then the score.
  function shareText() {
    const score = state.answers.reduce((sum, a) => sum + a.points, 0);
    const hints = state.answers.filter((a) => a.hint).length;
    const lines = [
      `${M.icon} ${game.title} #${gameNumber}`,
      marks() + (hints ? `  💡×${hints}` : ""),
      `Score: ${score}`,
    ];
    if (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) lines.push(location.origin + location.pathname + `?mode=${mode}`);
    return lines.join("\n");
  }

  /* ---------- player name and daily leaderboard ---------- */

  const PLAYER_KEY = "das-trivia:player";
  const config = window.DAS_CONFIG || {};
  const online = Boolean(config.supabaseUrl && config.supabaseKey);
  // The name screen and leaderboard stay switched off until the database is connected.
  // To preview them before that, open the site with ?test&board
  const boardOn = online || (testMode && params.has("board"));
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
    $("playing-as").hidden = !boardOn || !getPlayer();
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
    if (boardOn && !getPlayer()) return askName(showQuestion);
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

  // A leaderboard where tapping a name opens that person's answers for each question.
  function renderBoard(list, rows, me) {
    list.replaceChildren();
    rows.forEach((row, i) => {
      const item = document.createElement("li");
      item.className = "tap";
      if (row.player === me) item.classList.add("me");
      const add = (cls, text) => { const s = document.createElement("span"); s.className = cls; s.textContent = text; item.append(s); };
      add("lr", i + 1); add("ln", row.player); add("lb", row.boxes || ""); add("ls", row.rarity ?? row.score);
      const details = document.createElement("ol");
      details.className = "lans";
      details.hidden = true;
      if (Array.isArray(row.answers) && row.answers.length) {
        row.answers.forEach((a) => {
          const line = document.createElement("li");
          line.className = a.r;
          const q = document.createElement("div"); q.className = "la-q"; q.textContent = a.q;
          const r = document.createElement("div"); r.className = "la-a";
          r.textContent = a.r === "timeout" ? "⏱ Ran out of time" + (a.a ? ` · Answer: ${a.a}` : "")
            : a.r === "correct" ? `✓ ${a.a || a.t}` + (a.c ? ` · on clue ${a.c}` : "") + ` · +${a.p}`
            : (a.r === "close" ? `≈ "${a.t}" · close, +${a.p}` : `✗ "${a.t}"`) + (a.a ? ` · Answer: ${a.a}` : "");
          line.append(q, r);
          details.append(line);
        });
      } else {
        const line = document.createElement("li");
        line.textContent = "Answers weren't saved for this game (it was played before answers were kept).";
        details.append(line);
      }
      item.append(details);
      item.tabIndex = 0;
      item.setAttribute("role", "button");
      item.setAttribute("aria-expanded", "false");
      item.title = "Show answers";
      const toggle = () => {
        details.hidden = !details.hidden;
        item.classList.toggle("open", !details.hidden);
        item.setAttribute("aria-expanded", String(!details.hidden));
      };
      item.addEventListener("click", (event) => { if (!details.contains(event.target)) toggle(); });
      item.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggle(); } });
      list.append(item);
    });
  }

  // Each answer, saved with the score so others can see it on the leaderboard.
  const answersForBoard = () => state.answers.map((a) => ({
    q: a.question, t: a.typed, r: a.result, p: a.points,
    a: a.result === "correct" ? a.matched : a.answer, c: a.clue, h: a.hint ? 1 : undefined,
  }));

  // RARITY (Das Trivia): each question's points count more the fewer people got it.
  // Factor = 1 + share of today's players who missed it, so a question everybody got counts x1 and one only
  // you got counts nearly x2. Worked out from everyone's saved answers, so it updates as more people play.
  function withRarity(rows) {
    const playable = rows.filter((r) => Array.isArray(r.answers) && r.answers.length);
    if (playable.length < 2) return rows.map((r) => ({ ...r, rarity: null }));
    const tally = {};
    for (const r of playable) {
      for (const a of r.answers) {
        const t = tally[a.q] || (tally[a.q] = { right: 0, all: 0 });
        t.all += 1;
        if (a.r === "correct") t.right += 1;
      }
    }
    return rows.map((r) => {
      if (!Array.isArray(r.answers) || !r.answers.length) return { ...r, rarity: null };
      const total = r.answers.reduce((sum, a) => {
        const t = tally[a.q];
        const factor = t && t.all ? 1 + (1 - t.right / t.all) : 1;
        return sum + Math.round((a.p || 0) * factor);
      }, 0);
      return { ...r, rarity: total };
    }).sort((x, y) => (y.rarity ?? y.score) - (x.rarity ?? x.score));
  }

  // Read a leaderboard, with answers if the database keeps them (older setups don't).
  async function boardRows(game) {
    const base = `scores?game=eq.${game}&order=score.desc,created_at.asc&limit=50&select=player,score,correct,boxes`;
    try { return await database(base + ",answers"); } catch (e) { return database(base); }
  }

  // Sends this player's score once, then shows everyone's scores for today's game.
  async function showLeaderboard(score, right) {
    const boxes = marks();
    const mine = { player: getPlayer() || "You", score, correct: right, boxes, answers: answersForBoard() };
    const list = $("leaders"), status = $("leaders-status");
    $("leaders-title").hidden = list.hidden = !boardOn;
    if (!boardOn) { status.hidden = true; return; }

    const draw = (rows, note) => {
      renderBoard(list, rows, mine.player);
      status.textContent = note;
      status.hidden = !note;
    };

    if (!online) return draw([mine], "The shared leaderboard isn't connected yet, so only your score shows here.");
    draw([mine], "Loading the leaderboard…");
    try {
      if (!testMode && !state.submitted) {
        const send = (row) => database("scores?on_conflict=game,player", {
          method: "POST",
          headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
          body: JSON.stringify({ game: M.board + gameNumber, ...row }),
        });
        // if the database doesn't keep answers yet, still save the score
        try { await send(mine); } catch (e) { const { answers, ...scoreOnly } = mine; await send(scoreOnly); }
        state.submitted = true;
        saveState();
      }
      const rows = await boardRows(M.board + gameNumber);
      let everyone = testMode && !rows.some((r) => r.player === mine.player) ? [...rows, mine].sort((a, b) => b.score - a.score) : rows;
      if (mode === "trivia") {
        everyone = withRarity(everyone);
        const me = everyone.find((r) => r.player === mine.player);
        if (me && me.rarity != null) {
          $("final-score").textContent = me.rarity;
          $("final-rarity").textContent = `Rarity score: your ${score} points, boosted for the questions others missed. It updates as more people play.`;
          $("final-rarity").hidden = false;
        }
      }
      annotateRecap(everyone);
      draw(everyone, (testMode ? "Practice mode: your score isn't saved to the leaderboard. " : "")
        + (mode === "trivia" ? "Scores are rarity scores: answers fewer people got count more. " : "")
        + "Tap a name to see their answers." + (testMode ? "" : " First score counts, one game per player per day."));
    } catch (error) {
      draw([mine], "Couldn't reach the leaderboard right now, so only your score shows here.");
    }
  }

  // Under each of your answers: how many of today's players got that question.
  function annotateRecap(rows) {
    const tally = {};
    for (const r of rows) for (const a of r.answers || []) {
      const t = tally[a.q] || (tally[a.q] = { right: 0, all: 0 });
      t.all += 1; if (a.r === "correct") t.right += 1;
    }
    [...$("recap").children].forEach((item, i) => {
      const t = tally[(state.answers[i] || {}).question];
      if (!t || t.all < 2) return;
      let tag = item.querySelector(".rshare");
      if (!tag) { tag = document.createElement("div"); tag.className = "rshare"; item.append(tag); }
      const pct = Math.round(t.right / t.all * 100);
      tag.textContent = `${t.right} of ${t.all} players got this (${pct}%)` + (pct <= 25 && state.answers[i].result === "correct" ? " · rare get! 💎" : "");
    });
  }

  // A picture of your result for the group chat: the boxes, the score and the game.
  async function shareImage() {
    const S = 1080, c = document.createElement("canvas");
    c.width = S; c.height = S;
    const x = c.getContext("2d");
    try { await Promise.all(['800 90px "Barlow Condensed"', '600 34px Inter'].map((f) => document.fonts.load(f))); } catch (e) { /* default fonts */ }
    const bg = x.createLinearGradient(0, 0, S, S);
    bg.addColorStop(0, "#1d2d6e"); bg.addColorStop(0.6, "#0f1420"); bg.addColorStop(1, "#3a1d06");
    x.fillStyle = bg; x.fillRect(0, 0, S, S);
    x.strokeStyle = "#ff7a1a"; x.lineWidth = 8; x.strokeRect(20, 20, S - 40, S - 40);
    x.textAlign = "center";
    x.fillStyle = "#ff7a1a"; x.font = '800 54px "Barlow Condensed", Impact, sans-serif';
    x.fillText("DAS TRIVIA", S / 2, 130);
    x.fillStyle = "#f3f5fa"; x.font = '800 86px "Barlow Condensed", Impact, sans-serif';
    x.fillText(`${M.icon} ${game.title.toUpperCase()} #${gameNumber}`, S / 2, 240);
    const n = state.answers.length, size = Math.min(110, (S - 200) / n - 14), gap = 14;
    const left = (S - (n * size + (n - 1) * gap)) / 2;
    const colors = { correct: "#2fbf71", close: "#ffa51f", wrong: "#ef4b4b", timeout: "#5b6788" };
    state.answers.forEach((a, i) => {
      x.fillStyle = colors[a.result] || "#5b6788";
      const bx = left + i * (size + gap);
      x.beginPath(); x.roundRect ? x.roundRect(bx, 320, size, size, 18) : x.rect(bx, 320, size, size); x.fill();
      if (a.hint) { x.font = `${Math.round(size * 0.45)}px sans-serif`; x.fillText("💡", bx + size / 2, 320 + size * 0.68); }
    });
    const score = $("final-score").textContent;
    x.fillStyle = "#ff7a1a"; x.font = '800 220px "Barlow Condensed", Impact, sans-serif';
    x.fillText(score, S / 2, 700);
    x.fillStyle = "#d5dbea"; x.font = "600 40px Inter, sans-serif";
    x.fillText($("final-sub").textContent, S / 2, 780);
    const streak = window.DasCommon ? window.DasCommon.streak() : 0;
    if (streak > 1) { x.fillStyle = "#ffb36b"; x.fillText(`🔥 ${streak}-day streak`, S / 2, 850); }
    x.fillStyle = "#9aa6c0"; x.font = "600 30px Inter, sans-serif";
    x.fillText(location.host + location.pathname.replace(/\/$/, ""), S / 2, S - 70);
    const blob = await new Promise((r) => c.toBlob(r, "image/png"));
    const file = new File([blob], "das-trivia.png", { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], text: shareText() }); return; } catch (e) { /* closed */ return; }
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "das-trivia.png"; a.click();
    $("share-status").textContent = "Image saved. Send it to the group chat.";
  }

  function showResults() {
    stopSong();
    show("results");
    const score = state.answers.reduce((sum, a) => sum + a.points, 0);
    // today's real game (not practice, not an old day): remembered for the home page, streak and scorecard
    if (!testMode && window.DasCommon && gameNumber === Math.max(0, daysBetween(game.start_date, today())) + 1) {
      window.DasCommon.record(mode, score, marks());
    }
    const right = state.answers.filter((a) => a.result === "correct").length;
    $("final-score").textContent = score;
    $("final-sub").textContent = `${right} of ${questions.length} correct · ${M.label} #${gameNumber}`;
    $("other-mode").href = keepTest(mode === "trivia" ? "?mode=papo" : "?mode=trivia");
    $("other-mode").textContent = mode === "trivia" ? "Play today's Papo Trade or NOT" : "Play today's Das Trivia";

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
      r.textContent = a.result === "correct" ? `✓ ${a.matched}` + (a.clue ? ` · on clue ${a.clue}` : "")
        : a.result === "close" ? `≈ Close! You said "${a.typed}"`
        : a.result === "wrong" ? `✗ You said "${a.typed}"` : "Ran out of time";
      if (a.result !== "correct" && a.answer) r.textContent += ` · Answer: ${a.answer}`;
      item.append(pts, q, r);
      recap.append(item);
    });
    showLeaderboard(score, right);
  }

  // The video from effects.js, shown full screen after Share result is tapped.
  function playShareVideo() {
    const setting = (window.EFFECTS || {}).shareVideo;
    if (!setting || !setting.file || !(setting.modes || ["trivia", "papo"]).includes(mode)) return;
    const video = $("share-video-player");
    if (video.getAttribute("src") !== setting.file) video.src = setting.file;
    video.muted = false;
    $("video-sound").hidden = true;
    $("share-video").hidden = false;
    try { video.currentTime = 0; } catch (e) { /* not loaded yet: it starts at 0 anyway */ }
    // Phones only allow sound right after a tap; if they still refuse, play muted with a "Tap for sound" button.
    const started = video.play();
    if (started) {
      started.catch(() => {
        video.muted = true;
        $("video-sound").hidden = false;
        video.play().catch(() => {});
      });
    }
  }
  function closeShareVideo() {
    $("share-video-player").pause();
    $("share-video").hidden = true;
  }

  async function copyShare() {
    playShareVideo();      // first, while the tap still counts, so the video may play with sound
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

  /* ---------- Past results: every earlier day's leaderboard ---------- */

  async function openArchive() {
    show("archive");
    document.title = "Past results · Das Trivia";
    $("game-tag").textContent = "Past results" + (testMode ? " · test" : "");
    const kinds = ["trivia", "papo", "team", "rorw"];
    const files = {};
    try {
      await Promise.all(kinds.map(async (k) => { files[k] = await (await fetch(MODES[k].file, { cache: "no-cache" })).json(); }));
    } catch (e) {
      $("arc-status").textContent = "Couldn't load the games. Refresh to try again.";
      return;
    }
    const names = { trivia: "Das Trivia", papo: "Papo Trade or NOT", team: "What team am I?", rorw: "Rostered or Waiver" };
    let current = kinds.includes(params.get("game")) ? params.get("game") : "trivia";
    const dateOf = (k, n) => {
      const [y, m, d] = files[k].start_date.split("-").map(Number);
      return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(new Date(Date.UTC(y, m - 1, d + n - 1, 12)));
    };

    async function showDay(n) {
      for (const b of $("arc-days").children) b.classList.toggle("on", Number(b.dataset.n) === n);
      $("arc-title").textContent = `${names[current]} #${n} · ${dateOf(current, n)}`;
      $("arc-leaders").replaceChildren();
      if (!online) { $("arc-status").textContent = "The leaderboard isn't connected."; return; }
      $("arc-status").textContent = "Loading…";
      try {
        const rows = await boardRows(MODES[current].board + n);
        renderBoard($("arc-leaders"), current === "trivia" ? withRarity(rows) : rows, getPlayer());
        $("arc-status").textContent = rows.length ? "Tap a name to see their answers." : "Nobody played this one.";
      } catch (e) {
        $("arc-status").textContent = "Couldn't load that day right now.";
      }
    }

    function showGame(k) {
      current = k;
      for (const b of $("arc-tabs").children) b.classList.toggle("on", b.dataset.k === k);
      const todayN = Math.max(1, daysBetween(files[k].start_date, today()) + 1);
      const box = $("arc-days");
      box.replaceChildren();
      for (let n = todayN - 1; n >= 1; n--) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "arc-day";
        b.dataset.n = n;
        b.innerHTML = `<b>#${n}</b><span></span>`;
        b.querySelector("span").textContent = dateOf(k, n);
        b.addEventListener("click", () => showDay(n));
        box.append(b);
      }
      $("arc-today").textContent = `Today's game (#${todayN}) isn't here until tomorrow, so nobody sees today's answers early.`;
      if (todayN > 1) showDay(todayN - 1);
      else { $("arc-title").textContent = ""; $("arc-leaders").replaceChildren(); $("arc-status").textContent = "No past games yet."; }
    }

    $("arc-tabs").replaceChildren();
    kinds.forEach((k) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tab";
      b.dataset.k = k;
      b.textContent = names[k];
      b.addEventListener("click", () => showGame(k));
      $("arc-tabs").append(b);
    });
    showGame(current);
  }

  // Home: your name, streak, today's progress and a ✅ on every game you've played today.
  function drawHome() {
    const C = window.DasCommon;
    if (!C) return;
    const done = C.playedToday();
    const cards = { trivia: "to-trivia-game", papo: "to-papo", team: "to-team", rorw: "to-rorw", feud: "to-feud", grids: "to-grids" };
    let played = 0, total = 0;
    for (const g of C.GAMES) {
      const card = $(cards[g.mode]);
      if (!card) continue;
      const r = done[g.mode];
      card.classList.toggle("played", Boolean(r));
      let badge = card.querySelector(".played-badge");
      if (r) {
        played += 1;
        if (g.mode !== "grids") total += r.score;
        if (!badge) { badge = document.createElement("span"); badge.className = "played-badge"; card.append(badge); }
        badge.textContent = g.mode === "grids" ? "✅ Done" : `✅ ${r.score}`;
      } else if (badge) badge.remove();
    }
    const count = C.GAMES.filter((g) => $(cards[g.mode])).length;
    $("you-name").textContent = C.player() || "Pick your name";
    $("you-meter-fill").style.width = `${(played / count) * 100}%`;
    $("you-progress").textContent = played === count ? `All ${count} games played today 🎉 · ${total} points`
      : played ? `${played} of ${count} games played today · ${total} points` : `${count} games today. Tip off whenever you're ready.`;
    const streak = C.streak();
    $("you-streak").hidden = streak < 1;
    $("you-streak").textContent = `🔥 ${streak}-day streak`;
    $("you-copy").hidden = !played;
    $("you-copy").onclick = async () => {
      try { await navigator.clipboard.writeText(C.scorecard()); $("you-status").textContent = "Copied! Paste it into the group chat."; }
      catch (e) { $("you-status").textContent = C.scorecard(); }
      $("you-status").hidden = false;
    };
    $("you-boards").href = keepTest("?mode=boards");
    // last night's data check (scripts/nightly.py): a banner if anything looked off
    fetch("data/health.json", { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).then((h) => {
      if (!h || !h.warnings || !h.warnings.length) return;
      $("health").hidden = false;
      $("health").textContent = "⚠️ " + h.warnings.join(" ");
    }).catch(() => {});
    $("you-change").onclick = (event) => {
      event.preventDefault();
      const box = $("you-names");
      box.hidden = !box.hidden;
      if (box.hidden) return;
      box.replaceChildren();
      fetch("data/managers.json").then((r) => r.json()).then((list) => {
        for (const m of list) {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "name-btn" + (m.name === C.player() ? " picked" : "");
          b.textContent = m.name;
          b.onclick = () => { setPlayer(m.name); box.hidden = true; drawHome(); };
          box.append(b);
        }
      }).catch(() => { box.textContent = "Couldn't load the names."; });
    };
  }

  async function start() {
    // the Home button on every game screen; every link back home keeps practice mode on
    for (const a of document.querySelectorAll('a[href="./"]')) a.href = keepTest("./");
    $("home-link").hidden = home;
    if (params.get("mode") === "grids") return;   // DAS GRIDS runs from js/grids.js
    if (params.get("mode") === "analytics") return;   // EquipoGPT Analytics runs from js/analytics.js
    if (params.get("mode") === "boards") return;      // Leaderboards run from js/boards.js
    if (params.get("mode") === "feud") return;        // Das Feud runs from js/feud.js
    if (params.get("mode") === "archive") return openArchive();
    if (home) {
      $("to-archive").href = keepTest("?mode=archive");
      $("home-date").textContent = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, weekday: "long", month: "long", day: "numeric" }).format(new Date());
      $("to-trivia-game").href = keepTest("?mode=trivia");
      for (const [id, m] of [["to-papo", "papo"], ["to-team", "team"], ["to-rorw", "rorw"], ["to-feud", "feud"], ["to-grids", "grids"], ["to-analytics", "analytics"]]) $(id).href = keepTest(`?mode=${m}`);
      drawHome();
      return show("home");
    }
    try {
      const response = await fetch(M.file, { cache: "no-cache" });
      if (!response.ok) throw new Error(`${M.file} returned ${response.status}`);
      game = await response.json();
    } catch (error) {
      $("error-text").textContent = "The question file didn't load. " + error.message;
      return show("error");
    }

    let dayIndex = Math.max(0, daysBetween(game.start_date, today()));
    if (testMode && params.get("day")) dayIndex = Math.max(0, Number(params.get("day")) - 1 || 0);
    if (mode === "rorw" && !game.days[dayIndex]) {
      // today's rosters haven't been downloaded yet (the morning job): show the most recent game
      while (dayIndex > 0 && !game.days[dayIndex]) dayIndex -= 1;
      $("rorw-wait").hidden = false;
    }
    gameNumber = dayIndex + 1;
    questions = game.days[dayIndex % game.days.length];
    known = new Set((game.entities || []).map(normalize));
    state = loadState();

    $("game-tag").textContent = `${M.tag} #${gameNumber}` + (testMode ? " · test" : "");
    const dateText = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, weekday: "long", month: "long", day: "numeric" }).format(new Date());
    $("start-date").textContent = $("papo-date").textContent = $("team-date").textContent = $("rorw-date").textContent = dateText;
    if (mode === "rorw") {
      $("rorw-asof").textContent = game.as_of[gameNumber - 1] || "";
      $("btn-yes").textContent = "Rostered";
      $("btn-no").textContent = "Waiver";
    }
    if (mode !== "trivia") document.title = `${M.label} · Das Trivia`;
    $("team-back").href = keepTest("./");
    $("to-trivia").href = keepTest("./");

    $("btn-play").addEventListener("click", tipOff);
    $("btn-play-papo").addEventListener("click", tipOff);
    $("btn-play-team").addEventListener("click", tipOff);
    $("btn-play-rorw").addEventListener("click", tipOff);
    ["btn-yes", "btn-no"].forEach((id) => $(id).addEventListener("click", () => {
      const question = questions[state.answers.length];
      if (!question || !["yesno", "rw"].includes(question.kind) || !$("feedback").hidden) return;
      const right = (id === "btn-yes") === question.yes;
      finish(right ? "correct" : "wrong", $(id).textContent, right ? question.answers[0] : null);
    }));
    $("change-player").addEventListener("click", (event) => { event.preventDefault(); askName(() => show(M.startScreen)); });
    $("other-form").addEventListener("submit", (event) => { event.preventDefault(); chooseName($("other-name").value); });
    drawPlayer();
    $("btn-next").addEventListener("click", nextStep);
    $("btn-hint").addEventListener("click", useHint);
    $("btn-share").addEventListener("click", copyShare);
    $("btn-share-img").addEventListener("click", shareImage);
    $("video-close").addEventListener("click", closeShareVideo);
    $("share-video-player").addEventListener("ended", closeShareVideo);
    $("share-video").addEventListener("click", (event) => { if (event.target === $("share-video")) closeShareVideo(); });
    $("video-sound").addEventListener("click", () => {
      $("share-video-player").muted = false;
      $("video-sound").hidden = true;
    });
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
      if (question.kind === "clues" && !answer && state.clue < question.clues.length - 1) return nextClue(typed);
      finish(answer ? "correct" : isCloseNumber(question, typed) ? "close" : "wrong", typed, answer);
    });

    // testing: ?test&scene=3 plays cutscene 3; ?test&scene=all plays all seven in a row
    if (mode === "trivia" && testMode && params.get("scene") && window.Cutscene) {
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
      if (state.answers.length) $(M.play).textContent = "Resume game";
      show(M.startScreen);
    }
  }

  start();
})();
