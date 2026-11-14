# Das Trivia

The site is named **Das Trivia**, with the tagline "Brought to you by EquipoGPT" under the name
(owner's choice). "Das League" is the league's own name and stays in question wording.

The host character is **EquipoGPT**, the owner as a robot game-show host (`site/images/host.webp`).
It is the link-preview picture (Open Graph tags in `index.html`) and appears on the start screen.
The start screen shows the host in front of a game-show survey board titled "Worst Dynasty Teams" with
number 1 flipped to "Jacobo", then number 2 flips to "Victor", then number 3 to "Richard", then number 4 to "Verdeja"; the rest hidden. That is the owner's joke, not league data.
The site is published at https://chriswinch17-bot.github.io/das-trivia/ from the public GitHub
repository `chriswinch17-bot/das-trivia`; `git push` republishes it automatically (`.github/workflows/publish.yml`).
If the preview picture doesn't show in some chat app, convert it to JPG (needs Pillow, ask first).

A daily trivia website for a dynasty fantasy basketball league, inspired by Krillion.
League members answer questions drawn only from the league's own history.

## The owner

The owner has essentially no coding or web development experience.

- Explain every step in plain language; define any technical term the first time it appears.
- Do the programming, file creation, testing and troubleshooting yourself wherever possible.
- When the owner must do something by hand (create an account, click a button), give numbered steps.
- Ask for approval before installing software, touching anything outside this folder, or deploying.

## Hard rules

1. **Never fabricate league data.** Every question and every accepted answer must trace back to a
   file in `data/raw/` supplied by the owner. If the data doesn't answer something, ask.
2. **Free to run.** No paid services, no purchased domain.
3. **Works on phones and desktops.** Design mobile-first; test at phone width before calling anything done.
4. **Simple over clever.** A working, polished site beats technical sophistication.
5. **Built to grow.** New seasons, question types and game modes must be addable without rewrites.

## The league and its data

- "Das League" on Sleeper, 12 teams, dynasty since the 2023-2024 season. It existed earlier as a
  non-dynasty league; the owner has decided that pre-2023 history is **not** included.
- Seasons are written "2023-2024" (Sleeper calls that season "2023").
- **Naming rule:** whenever a team is shown, write the team name followed by the manager's real
  name in parentheses, e.g. "Equipo Winchenzo (Winch)". Use the team name from the season in question.
- Real names live in `data/managers.json` (owner-supplied; edit by hand to add nicknames to `aliases`).
- Data pipeline, both safe to re-run at any time:
  1. `python scripts/fetch_sleeper.py 1344343390740819968` refreshes `data/raw/sleeper/` (league ID is the current season's).
  2. `python scripts/build_data.py` rebuilds `site/data/` (managers, seasons, matchups, drafts, trades, players)
     and stops with "DATA PROBLEM" if the raw data contradicts itself.
- Matchup winners come from Sleeper's official weekly results. Two games are flagged
  `result_differs_from_score` (official winner had fewer points, apparently stat corrections after
  the week closed). Don't write score-based questions about flagged games without asking the owner.
- Playoff rounds lasted two weeks each in 2023-2024 and 2024-2025, and one week each from 2025-2026.
- Not yet in `site/data/`: waiver/free-agent moves, per-player weekly points, consolation bracket.
  The raw files have them.

## Game design

- One game per day, about 7 questions, the same for every player.
- 25-second timer per question.
- The owner wants matching to be generous: a player's first name alone or last name alone counts,
  and near-misses of either count too. When in doubt, accept.
- Typed text answers, not multiple choice. Matching is forgiving: ignore case, punctuation and
  accents; accept listed aliases and nicknames; tolerate small typos.
- Number questions only: a guess within 2 of the answer (or 10% for big numbers) is "close":
  shown in orange, worth half points, and an orange box in the share text.
- Many questions have several valid answers (e.g. "Name a manager who has won a title").
- Rarity scoring: the fewer players who gave a correct answer that day, the more it scores.
  Until the database exists, the prototype uses a temporary stand-in score, clearly marked as such.
- After each guess the answer is shown in bold with one or two sentences of detail under it.
  Every answer carries a `detail` sentence generated from the data in `build_questions.py`
  (season record and finish, career record, draft slot, trade history); the question's `note` goes first.
- End screen with final score and a copyable, spoiler-free share text.
- Leaderboard comparing league members (how players identify themselves: not yet decided).

## How the prototype works

- `python scripts/build_questions.py` writes `site/data/game.json`: question templates whose answers
  are looked up in `site/data/`, arranged into daily games of 7. Add new question types there.
  Days already in `game.json` keep their questions and order on every rebuild; new questions only
  fill gaps or add days at the end. Delete `game.json` first only if a full reshuffle is wanted.
- `site/js/game.js` is the game: timer, answer matching, saving progress in the browser, results, share text.
  One guess per question. Game #1 is `START_DATE` in `build_questions.py`; days roll over at midnight Eastern.
- `site/js/effects.js` is the owner's customization file: messages, images (`site/images/`) and sounds
  for correct / wrong / out-of-time. The owner wants to add images and reactions here; keep it simple to edit.
- Manager pictures: `EFFECTS.managers` in `effects.js` maps a manager id to images in
  `site/images/managers/<id>/`. One shows whenever a question, its note or its answer involves that
  manager. Victor has four; the owner will send more for other managers. They are joke images among
  friends, and they become publicly reachable once the site is published.
- The owner wants funny, random questions mixed in "every once in a while". These are the `fun` group
  in `build_questions.py` (old team names, blowouts, lowest scores, streaks, etc.), still computed
  from data, roughly one per daily game.
- `index.html` loads the CSS and JS with a `?v=N` tag. Raise N whenever those files change, or
  browsers keep showing the old version.
- `site/js/cutscene.js` is the cutscene shown after each correct answer (never after a wrong, close or
  timed-out one): the player moves up one of 7 steps and a robot baller does that step's move
  (grab ball, crossover that drops the defender, layup, floater, free throw, three-pointer, poster dunk).
  The player is a person with the EquipoGPT host's face (cropped from `images/host.webp` via the
  `FACE` settings); every scene has a red-jersey defender. Drawn in code (SVG), no extra image files. Preview with
  `?test&scene=3` or `?test&scene=all`.
- Daily leaderboard: after Tip off the player picks their name (12 managers, or types one); it is
  remembered on the device. The results screen shows "Today's leaderboard". Scores live in a Supabase
  table `scores` (`docs/leaderboard_setup.sql`); the connection values go in `site/js/config.js`.
  While those are empty the name screen and leaderboard are switched off entirely; preview them with `?test&board`. Practice mode never saves a score.
  It is an honor system: anyone can pick any name, and the first score per name per day counts.
- **Papo Trade or NOT** (bonus mode, `?mode=papo`): 5 yes-or-no questions a day.
  Its theme picture is `site/images/papo-mode.webp` ("Mr. Trade Man"), on its start screen and the bonus banner. Each shows a real
  trade with the teams hidden ("Team A got / Team B got"); the player says whether Papo was in it.
  Picks and FAAB count. `python scripts/build_papo.py` writes `site/data/papo.json` (2 or 3 Papo trades
  per day, trades over 10 items skipped, scheduled days kept). Game #1 was 2026-11-12. Its leaderboard
  rows use game number 50000 + day, so they never mix with the main game. No cutscene in this mode.
- **What team am I?** (bonus mode, `?mode=team`; theme picture `site/images/team-mode.webp`): 2 mystery managers a day, 5 clues each from hardest
  to easiest (late startup pick, a player they alone traded for, a rookie pick, a career line, the team
  name with letters hidden). Typed answers; a wrong guess or the 40-second clock opens the next clue.
  Points 100/80/60/40/20 by clue. `python scripts/build_team.py` writes `site/data/team.json` (3 rounds
  of all 12 managers = 18 days; Game #1 opens with Joey, as the owner asked). Leaderboard game = 60000 + day.
  A correct guess can show a picture and play a song per manager: `teamReveal` in `effects.js`
  Blandon: `site/images/team/blandon.webp` + `site/sounds/blandon.mp3` (Hava Nagila, first 30 s); his song plays
  whenever that picture shows in ANY game (`pictureSongs` in `effects.js`).
  Ricky: `site/images/managers/ricky/1.webp` (Poopy Cup) in every game, with `site/sounds/fart.wav` (made by
  `scripts/make_fart.py`) each time it shows.
  Libguel: `site/images/team/libguel.png` + `site/sounds/libguel.mp3` (0:17 to 1:00 of the owner's MP3), What team am I? only.
  Hand-set days: `data/team_custom.json` (game #3 = Libguel with hard clues 1-2, then Chalela;
  Chalela: `site/images/team/chalela.webp` + `site/sounds/chalela.mp3`, 0:18 to 1:00).
  START_DATE moved to 2026-11-11 on 2026-11-13 so that day became #3 (#2 had already been played).
  (Joey's picture: `site/images/team/joey.webp`, also in his main-game gallery; his song: `site/sounds/joey.mp3`,
  the first 30 s of the owner's MP3, cut with a frame-by-frame copy, no re-encoding). Songs go in `site/sounds/`.
- **DAS GRIDS** (`?mode=grids`, `site/js/grids.js`): HoopGrids-style 3×3 grid of franchises; name a player
  rostered by both at any point. History (`scripts/grids_history.py`) = weekly lineups + every add
  (free agent, waiver, trade, commissioner) and drop + draft picks + end-of-season rosters incl. taxi/IR,
  by manager id; undone trades ignored; fixes in `data/grids_corrections.json`. `python scripts/build_grids.py`
  writes `site/data/grids.json` (puzzles = teams only), `data/private/grids_setup.sql` (paste into Supabase
  after every rebuild: hidden history + puzzles + functions `grid_guess`, `grid_rarity`, `grid_finish`) and
  `admin/grids.html` (local admin page). The private files are gitignored. Answers are checked only by the
  database; picks are hidden; `grid_results` is the public leaderboard (first finish locks the score).
  Daily grid flips at midnight ET like every game (was 8 PM until 2026-11-14; D1 = 2026-11-12); 400 unlimited grids (U1...); custom daily grids in
  `data/grids_custom.json`. Rarity is tuned for the 12-person league (owner's request, 2026-11-12): % = picks /
  max(people answering the square, 12); tiers by how many made the same pick (only you: Blue/Galaxy/Unicorn as
  more people answer; 2 Gold, 3 Silver, 4-5 Bronze, 6+ Common). Scores are live until a daily closes at 8 PM ET
  (`grid_board`), then final; archive dailies don't save picks. (Was: HoopGrids % tiers, lock on finish;
  "Deep cut" = on both rosters for at most 1 weekly lineup combined (separate from rarity).
  Tests: `python -m unittest discover tests`.
- Trades undone the same day (the exact same assets sent straight back) are fake and are dropped in
  `build_data.py`, so they count nowhere (owner's rule, 2026-11-12). There were 5 such pairs.
- Tapping **Share result** copies the score and then plays the owner's video full screen
  (`site/videos/share.mp4`, 30 s, 7.3 MB). Set in `effects.js` (`shareVideo`): file, and which modes
  show it. It loads only when tapped (`preload="none"`), so it costs nothing for players who don't share.
- Leaderboards (trivia, papo, team) save each player's answers in `scores.answers` (jsonb; added by
  `docs/leaderboard_answers.sql`); tapping a name shows them. **Past results** (`?mode=archive`, linked from
  home and results) lists every earlier day's board per game; today's is left out so nobody sees answers early.
- **Rostered or Waiver** (`?mode=rorw`): 7 players a day, 20-second timer, buttons Rostered / Waiver. Each card shows
  name, position, NBA team, games, fantasy points per game (season stats x this league's scoring), a stat line and
  how many Das League teams he's been on; never the team. HARD mix (owner, 2026-11-14): 1 truly awful rostered
  player, the rest picked closest to the "line" where rostered and free-agent fantasy points overlap, favouring
  players passed around many teams; 2-5 rostered, varying daily. `scripts/build_rorw.py` downloads Sleeper LIVE (rosters,
  this season's transactions, stats, players) and freezes today's answers as of that moment ("rosters as of ...").
  `.github/workflows/rorw-refresh.yml` runs it just after midnight ET (05:05 UTC winter / 04:05 UTC summer), commits
  `site/data/rorw.json` and republishes. Before that runs, the game shows the previous day's. Board = 70000 + day.
  **Because that job commits to `main` every morning, always `git pull --rebase` before pushing.**
- **Every game resets at midnight Eastern** (owner's request, 2026-11-14).
- **Nightly automation** (owner's request, 2026-11-14): `.github/workflows/rorw-refresh.yml` runs `scripts/nightly.py`
  just after midnight ET: Sleeper current season (`fetch_sleeper.py --current-only`) -> build_data -> build_questions,
  build_papo, build_team (each tops itself up to 21 days ahead via `scripts/daily.py`, reusing the least recently
  asked questions once new ones run out; days never shift) -> tests -> build_rorw. If the refresh or tests fail, those
  changes are discarded and only Rostered or Waiver is rebuilt. Das Grids is not refreshed nightly (365 grids built;
  its roster history lives in Supabase and needs the SQL file pasted after `build_grids.py`).
- Testing: open the site with `?test` on the address to replay without saving; `?test&day=3` plays Game #3.
- Local preview: `python -m http.server 8123 --bind 127.0.0.1 --directory site`, then http://localhost:8123.
- Scoring is a stand-in (100 + 2 per second left) until rarity scoring arrives in Phase 4.

## Technical decisions

| Area | Decision | Why |
|---|---|---|
| Site | Plain HTML, CSS, JavaScript; no framework, no build step | Nothing to install; easy to host and maintain |
| Data | JSON files generated from the owner's spreadsheets | Human-checkable, versioned with the site |
| Scripts | Python 3.10 (already installed), standard library only | Convert and validate data; no extra installs |
| Local preview | `python -m http.server` from `site/` | Already available |
| Hosting | GitHub Pages (owner has no GitHub account yet) | Free, no domain needed |
| Leaderboard + rarity | Supabase free tier, added in Phase 4 | Free shared database; not needed for the prototype |

The computer has Git and Python but not Node.js. Do not introduce anything that requires Node
without asking first.

Known trade-off: with a static site, the answers ship to the browser, so a determined player could
look them up. Acceptable for a friends' league; revisit if it becomes a problem.

## Folder layout

```
site/            The website itself (this is what gets published)
  index.html
  css/  js/
  data/          Generated JSON the site reads; do not edit by hand
data/
  raw/           The owner's original files, kept untouched
  questions/     Question definitions
scripts/         Python scripts: convert raw data, validate questions
docs/            ROADMAP.md, DATA_GUIDE.md
```

## Working guidelines

- **Show first, publish second.** The site is live and league members play it. Make changes locally,
  show the owner in the Browser pane (local preview), and `git push` only after the owner approves
  that change. Local commits are fine.

- This project must stay out of the Documents folder: on this computer it syncs to a work OneDrive.
- Keep original data files in `data/raw/` unmodified; all cleaning happens in scripts.
- Every question records which data file(s) its answers came from.
- Run the validation script after any data or question change.
- Test in a browser at phone and desktop widths before reporting a feature as finished.
- Commit to Git in small, described steps; only when the owner agrees.
- Keep `docs/ROADMAP.md` current as phases finish.
