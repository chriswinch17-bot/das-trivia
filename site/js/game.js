/* Das Trivia: game logic.
   Add ?test to the address to replay freely (nothing is saved); ?test&day=3 plays Game #3. */
(() => {
  "use strict";

  const SECONDS = 25;
  const BASE_POINTS = 100;        // prototype scoring; replaced by rarity scoring later
  const SPEED_BONUS_PER_SECOND = 2;
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
    if (Math.abs(a.length - b.length) > 2) return 3;
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
  function findAnswer(question, typed) {
    const input = normalize(typed);
    if (!input) return null;
    for (const answer of question.answers) {
      if (answer.accept.some((a) => normalize(a) === input)) return answer;
    }
    // Numbers must be exact. A near-miss that is exactly some other known name is not a typo.
    if (question.kind === "number" || known.has(input)) return null;
    const allowed = input.length >= 8 ? 2 : input.length >= 4 ? 1 : 0;
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
    card.classList.remove("result-correct", "result-wrong", "result-timeout");
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

  function finish(result, typed, answer) {
    clearInterval(timerId);
    const index = state.answers.length;
    const question = questions[index];
    const secondsLeft = Math.max(0, SECONDS - (Date.now() - state.startedAt) / 1000);
    const points = result === "correct" ? BASE_POINTS + Math.round(secondsLeft * SPEED_BONUS_PER_SECOND) : 0;

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
    const fallback = { correct: "Correct!", wrong: "Wrong!", timeout: "Out of time!" }[result];
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

    $("points").textContent = result === "correct" ? `+${points} points` : "No points";
    const said = $("you-said");
    said.replaceChildren();
    if (result === "timeout") said.textContent = "You didn't answer in time.";
    else { said.append("You said: "); const b = document.createElement("b"); b.textContent = typed; said.append(b); }

    const total = question.answers.length;
    $("answers-label").textContent = total === 1 ? "The answer" : `Accepted answers (${total})`;
    const chips = $("answers");
    chips.replaceChildren();
    const ordered = answer ? [answer, ...question.answers.filter((a) => a !== answer)] : question.answers;
    ordered.slice(0, MAX_CHIPS).forEach((a) => {
      const chip = document.createElement("span");
      chip.className = "chip" + (a === answer ? " yours" : "");
      chip.textContent = a.display;
      chips.append(chip);
    });
    if (total > MAX_CHIPS) {
      const more = document.createElement("span");
      more.className = "chip more";
      more.textContent = `and ${total - MAX_CHIPS} more`;
      chips.append(more);
    }
    $("note").textContent = question.note || "";
    $("note").hidden = !question.note;

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
      state.answers.map((a) => (a.result === "correct" ? "🟩" : "🟥")).join(""),
      `Score: ${score}`,
    ];
    if (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) lines.push(location.origin + location.pathname);
    return lines.join("\n");
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
        : a.result === "wrong" ? `✗ You said "${a.typed}"` : "Ran out of time";
      if (a.result !== "correct" && a.answer) r.textContent += ` · Answer: ${a.answer}`;
      item.append(pts, q, r);
      recap.append(item);
    });
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

    $("btn-play").addEventListener("click", showQuestion);
    $("btn-next").addEventListener("click", showQuestion);
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
      finish(answer ? "correct" : "wrong", typed, answer);
    });

    if (state.answers.length >= questions.length) showResults();
    else if (state.startedAt) showQuestion();   // refreshed mid-question: the clock kept running
    else {
      if (state.answers.length) $("btn-play").textContent = "Resume game";
      show("start");
    }
  }

  start();
})();
