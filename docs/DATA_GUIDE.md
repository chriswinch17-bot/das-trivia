# How to provide league data

## The short version

Send whatever you already have, in whatever form it's in. Put files in the `data/raw/` folder
(or attach them in the chat) and tell me what each one is. I do the cleaning and organizing.
I will never fill a gap by guessing: if something is missing or contradictory, I'll ask you.

## Formats, best to worst

1. **Spreadsheets** (Excel `.xlsx`, CSV, or a Google Sheet) — best
2. **Exports from your fantasy platform** (ESPN, Yahoo, Sleeper, Fantrax all have history pages
   or export options) — tell me which platform you use and I'll help you get the most out of it
3. **Text you copy and paste** from the league site or a document
4. **Screenshots or PDFs** — usable, but slower and I'll ask you to double-check what I read

## What to send first

The prototype only needs the basics. Start with these three:

| Priority | Data | What I need in it |
|---|---|---|
| 1 | Managers | Each manager's name, team name(s) over the years, years in the league, nicknames |
| 1 | Season results | For each season: final standings, records, champion, runner-up |
| 1 | Playoff results | Who played whom each round, and who won |
| 2 | Drafts | Season, round, pick number, manager, player |
| 2 | Trades | Date or season, managers involved, what each side gave and got |
| 3 | Weekly matchups | Season, week, both teams, scores |
| 3 | Rosters | Who was on which team, by season |
| 3 | Records and lore | Highest scores, streaks, awards, league-specific traditions |

## How I'll organize it

Your original files stay untouched in `data/raw/`. From them I build one clean file per topic:

- `managers` — one entry per person, with a permanent ID, so a team that changed names or a
  manager who goes by a nickname is always recognized as the same person
- `seasons` — standings, champion and runner-up per year
- `playoffs`, `drafts`, `trades`, `matchups`, `rosters` — one row per event, each pointing to
  manager IDs
- `players` — NBA players, with spelling variants so "Giannis" and "Antetokounmpo" both count

Questions are stored separately. Each one lists its accepted answers and which data file they
came from, so any answer can be traced back to something you provided.

## Things to tell me along with the data

- Which fantasy platform the league uses
- How many seasons there are, and the first season
- Managers who left, joined or took over a team partway through
- Team name changes
- Anything in the records that is disputed or that you know is wrong
