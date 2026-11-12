# Roadmap

Each phase ends with something you can see and try. Nothing is published until you approve it.

## Phase 0 — Setup (done)
- [x] Check the computer: Git and Python are installed; nothing else is needed yet
- [x] Choose the technology (see CLAUDE.md)
- [x] Create the project folder and structure
- [x] Write CLAUDE.md, this roadmap and the data guide

## Phase 1 — League data
- [x] Download the full league history from Sleeper (`scripts/fetch_sleeper.py`, 4 seasons, 2023–2026)
- [x] Convert it into clean, structured files (`scripts/build_data.py` → `site/data/`)
- [x] Manager real names matched to teams (`data/managers.json`)
- [x] The build script re-checks the data for contradictions every time it runs
- [ ] You confirm the champions and add any nicknames players might type

## Phase 2 — Playable prototype (on your computer only)
- [x] Basketball-themed design that works on phones and desktops
- [x] One full game: 7 questions, 25-second timer, typed answers
- [x] Forgiving answer matching (typos, nicknames, multiple valid answers)
- [x] Stand-in scoring, final score screen, copyable share text
- [x] A first set of 101 questions generated from the data (14 daily games)
- [ ] You play it and review the questions
- [ ] Your images and reactions for right / wrong / out of time (`site/js/effects.js`)

## Phase 3 — Put it online
- [x] GitHub account created (chriswinch17-bot)
- [x] Published at https://chriswinch17-bot.github.io/das-trivia/
- [x] A new game appears automatically each day (17 scheduled from 2026-11-11)
- [ ] A few league members test it on their phones

## Phase 4 — Leaderboard and real rarity scoring
- [ ] Decide how players identify themselves (pick a name vs. name plus PIN)
- [ ] Set up a free Supabase database
- [ ] Record each player's answers and scores
- [ ] Rarity scoring based on what league members actually answered
- [ ] Daily and all-time leaderboards

## Phase 5 — Growth
- [ ] More questions and question types
- [ ] Streaks, personal stats, an archive of past games
- [ ] New game modes
- [ ] An easy routine for adding each new season's data

## Bonus games (built 2026-11-12)
- [x] Papo Trade or NOT (published)
- [ ] What team am I? (built locally, waiting for approval)
- [ ] DAS GRIDS: roster history, 365 daily + 400 unlimited solvable grids, database checking, rarity,
      leaderboard, local admin page, 14 automated tests (built locally, database set up, waiting for approval)

