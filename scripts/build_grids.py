"""DAS GRIDS: build the puzzles, the database file and the local admin page.

Usage:
    python scripts/build_grids.py        (run build_data.py first)

Writes
  site/data/grids.json            public: puzzles (teams only, never answers) and player names for search
  data/private/grids_setup.sql    paste into the Supabase SQL editor: tables, checking functions,
                                  roster history and puzzles. Safe to paste again after every rebuild.
  admin/grids.html                local admin page: every team's history, intersections, upcoming grids
Both private files are kept out of the public repository (.gitignore).

Every puzzle is checked before it is used: each of the 9 squares has at least MIN_ANSWERS valid players,
and a matching finds 9 different players that fill the whole grid. Daily puzzles also need at least one
hard square and one easy square, and never repeat a set of teams within REPEAT_WINDOW days.
Puzzles already in grids.json keep their teams, except future daily puzzles set in data/grids_custom.json.
"""

import html
import itertools
import json
import random
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from grids_history import DEEP_CUT_WEEKS, answers_for, build_history, is_deep_cut  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT_PUBLIC = ROOT / "site" / "data" / "grids.json"
OUT_SQL = ROOT / "data" / "private" / "grids_setup.sql"
OUT_ADMIN = ROOT / "admin" / "grids.html"
CUSTOM = ROOT / "data" / "grids_custom.json"

START_DATE = "2026-11-12"   # DAS GRIDS daily #1. A new daily grid starts at midnight Eastern (was 8 PM until 2026-11-14).
DAILY_COUNT = 365
UNLIMITED_COUNT = 400
MIN_ANSWERS = 2
LEAGUE_SIZE = 12            # rarity is "share of the league": picks / max(people who answered, LEAGUE_SIZE)
REPEAT_WINDOW = 60
TEST_PUZZLE = "T1"          # used only by the automated live check; never shown in the game


def matching(squares):
    """squares: list of 9 answer sets. True if 9 different players can fill them (augmenting paths)."""
    owner = {}

    def place(i, seen):
        for pid in squares[i]:
            if pid in seen:
                continue
            seen.add(pid)
            if pid not in owner or place(owner[pid], seen):
                owner[pid] = i
                return True
        return False

    return all(place(i, set()) for i in range(len(squares)))


def main():
    links, managers, names = build_history()
    ids = list(managers)
    pair = {}
    for a, b in itertools.combinations(ids, 2):
        pair[(a, b)] = pair[(b, a)] = answers_for(links, a, b)
    sizes = sorted(len(v) for k, v in pair.items() if k[0] < k[1])
    hard, easy = sizes[len(sizes) // 4], sizes[3 * len(sizes) // 4]

    def check(rows, cols):
        if len(set(rows) | set(cols)) != 6:
            return "a team appears twice"
        squares = [pair[(r, c)] for r in rows for c in cols]
        if min(map(len, squares)) < MIN_ANSWERS:
            return "a square has fewer than %d answers" % MIN_ANSWERS
        if not matching(squares):
            return "9 different players can't fill it"
        return None

    def key(rows, cols):
        return (frozenset(rows), frozenset(cols))

    rng = random.Random(2023)

    def generate(daily, recent):
        while True:
            six = rng.sample(ids, 6)
            rows, cols = six[:3], six[3:]
            if check(rows, cols) or key(rows, cols) in recent or (cols and key(cols, rows) in recent):
                continue
            counts = [len(pair[(r, c)]) for r in rows for c in cols]
            if daily and not (min(counts) <= hard and max(counts) >= easy):
                continue
            return rows, cols

    old = json.loads(OUT_PUBLIC.read_text(encoding="utf-8")) if OUT_PUBLIC.exists() else {"daily": [], "unlimited": []}
    custom = json.loads(CUSTOM.read_text(encoding="utf-8")).get("daily", {}) if CUSTOM.exists() else {}

    daily, recent_keys = [], []
    for n in range(1, DAILY_COUNT + 1):
        wanted = custom.get(str(n))
        previous = old["daily"][n - 1] if n - 1 < len(old["daily"]) else None
        if wanted:
            rows, cols = wanted["rows"], wanted["cols"]
            problem = check(rows, cols)
            if problem:
                sys.exit(f"Custom grid for daily #{n} can't be used: {problem}.")
        elif previous and not check(previous["rows"], previous["cols"]):
            rows, cols = previous["rows"], previous["cols"]
        else:
            rows, cols = generate(True, set(recent_keys[-REPEAT_WINDOW:]))
        recent_keys.append(key(rows, cols))
        daily.append({"id": f"D{n}", "rows": rows, "cols": cols})

    unlimited, seen = [], set(recent_keys)
    for n in range(1, UNLIMITED_COUNT + 1):
        previous = old["unlimited"][n - 1] if n - 1 < len(old["unlimited"]) else None
        if previous and not check(previous["rows"], previous["cols"]):
            rows, cols = previous["rows"], previous["cols"]
        else:
            rows, cols = generate(False, seen)
        seen.add(key(rows, cols))
        unlimited.append({"id": f"U{n}", "rows": rows, "cols": cols})

    # ---------- public file: teams and search names only ----------
    rostered = sorted({pid for (_, pid) in links})
    others = sorted(set(names) - set(rostered))
    teams = {m: {"name": managers[m]["name"], "team": current_team(m)} for m in ids}
    OUT_PUBLIC.write_text(json.dumps({
        "title": "DAS GRIDS",
        "start_date": START_DATE,
        "reset_hour_et": 24,      # midnight, like every other game
        "teams": teams,
        "daily": daily,
        "unlimited": unlimited,
        # every NBA player Sleeper knows, so the search list never hints at who is a right answer
        "search": [[pid, names[pid]] for pid in rostered + others],
        "players": [{"id": m, "name": managers[m]["name"]} for m in ids],
        "deep_cut_weeks": DEEP_CUT_WEEKS,
        "league_size": LEAGUE_SIZE,
    }, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    # ---------- the database file ----------
    OUT_SQL.parent.mkdir(exist_ok=True)
    history_rows = ",\n".join(f"('{mid}','{pid}',{len(link['weeks'])})" for (mid, pid), link in sorted(links.items()))
    puzzles = daily + unlimited + [{"id": TEST_PUZZLE, "rows": daily[0]["rows"], "cols": daily[0]["cols"]}]
    puzzle_rows = ",\n".join(
        "('%s',array[%s],array[%s])" % (p["id"], ",".join(f"'{t}'" for t in p["rows"]), ",".join(f"'{t}'" for t in p["cols"]))
        for p in puzzles)
    OUT_SQL.write_text(SQL_TEMPLATE.replace("{{HISTORY}}", history_rows).replace("{{PUZZLES}}", puzzle_rows)
                       .replace("{{DEEP}}", str(DEEP_CUT_WEEKS)).replace("{{LEAGUE}}", str(LEAGUE_SIZE))
                       .replace("{{START}}", START_DATE), encoding="utf-8")

    # ---------- the local admin page ----------
    OUT_ADMIN.parent.mkdir(exist_ok=True)
    OUT_ADMIN.write_text(admin_page(links, managers, names, pair, daily, unlimited, teams), encoding="utf-8")

    print(f"{len(links)} roster links, {len(rostered)} different players, {len(ids)} franchises.")
    print(f"Pair answers: fewest {sizes[0]}, most {sizes[-1]}; hard <= {hard}, easy >= {easy}.")
    print(f"{len(daily)} daily grids and {len(unlimited)} unlimited grids, all solvable.")
    print(f"Database file: {OUT_SQL.relative_to(ROOT)} ({OUT_SQL.stat().st_size // 1024} KB). Admin page: {OUT_ADMIN.relative_to(ROOT)}")


def current_team(mid):
    managers = json.loads((ROOT / "site" / "data" / "managers.json").read_text(encoding="utf-8"))
    return next(m["current_team_name"] for m in managers if m["id"] == mid)


def admin_page(links, managers, names, pair, daily, unlimited, teams):
    def team_label(m):
        return html.escape(f"{teams[m]['team']} ({teams[m]['name']})")

    first = date.fromisoformat(START_DATE)
    out = ["<!doctype html><meta charset='utf-8'><title>DAS GRIDS admin</title>",
           "<style>body{font:14px system-ui;margin:24px;max-width:1100px}table{border-collapse:collapse}"
           "td,th{border:1px solid #ccc;padding:4px 8px;vertical-align:top}th{background:#eee}details{margin:6px 0}"
           ".dc{color:#7a3fd0;font-weight:600}.small{color:#666;font-size:12px}</style>",
           "<h1>DAS GRIDS admin (on this computer only, never published)</h1>",
           "<p>Rebuild with <code>python scripts/build_grids.py</code>. Fix the history in "
           "<code>data/grids_corrections.json</code>; set a custom daily grid in <code>data/grids_custom.json</code>. "
           "Submissions and rarity: Supabase Table Editor, tables <code>grid_picks</code> and <code>grid_results</code>.</p>",
           "<h2>Answers per intersection</h2><table><tr><th></th>"]
    ids = list(managers)
    out += [f"<th>{html.escape(managers[m]['name'])}</th>" for m in ids] + ["</tr>"]
    for a in ids:
        out.append(f"<tr><th>{html.escape(managers[a]['name'])}</th>")
        out += [f"<td>{'—' if a == b else len(pair[(a, b)])}</td>" for b in ids]
        out.append("</tr>")
    out.append("</table>")

    out.append("<h2>Upcoming daily grids</h2>")
    for p in daily[:21]:
        n = int(p["id"][1:])
        day = first + timedelta(days=n - 1)
        out.append(f"<details><summary><b>Daily #{n}</b> ({day:%a %b %d}, opens at midnight ET): "
                   f"rows {', '.join(teams[m]['name'] for m in p['rows'])} · columns {', '.join(teams[m]['name'] for m in p['cols'])}"
                   "</summary><table>")
        for r in p["rows"]:
            out.append(f"<tr><th>{team_label(r)}</th>")
            for c in p["cols"]:
                players = sorted(pair[(r, c)], key=lambda pid: names[pid])
                cell = ", ".join((f"<span class='dc'>{html.escape(names[pid])}</span>" if is_deep_cut(links, r, c, pid)
                                  else html.escape(names[pid])) for pid in players)
                out.append(f"<td><b>{len(players)}</b> with {html.escape(teams[c]['name'])}<br><span class='small'>{cell}</span></td>")
            out.append("</tr>")
        out.append("</table></details>")
    out.append("<p class='small'>Purple names are Deep Cuts.</p>")

    out.append("<h2>Every franchise's roster history</h2>")
    for m in ids:
        mine = sorted(((pid, link) for (mid, pid), link in links.items() if mid == m), key=lambda x: names[x[0]])
        out.append(f"<details><summary><b>{team_label(m)}</b>: {len(mine)} players</summary><table>"
                   "<tr><th>Player</th><th>Weekly lineups</th><th>Seasons</th><th>Found in</th></tr>")
        for pid, link in mine:
            out.append(f"<tr><td>{html.escape(names[pid])}</td><td>{len(link['weeks'])}</td>"
                       f"<td>{', '.join(sorted(link['seasons']))}</td><td>{', '.join(sorted(link['sources']))}</td></tr>")
        out.append("</table></details>")
    out.append(f"<p class='small'>{len(unlimited)} unlimited grids are also stored (U1–U{len(unlimited)}).</p>")
    return "\n".join(out)


SQL_TEMPLATE = """-- DAS GRIDS database setup. Paste the WHOLE file into the Supabase SQL editor and press Run.
-- Safe to run again: it refreshes the roster history and puzzles and keeps everyone's picks and results.

create table if not exists public.grid_history (
  manager   text not null,
  player_id text not null,
  weeks     int  not null default 0,          -- weekly lineups he was in for this franchise
  primary key (manager, player_id)
);
create table if not exists public.grid_puzzles (
  id        text primary key,
  row_teams text[] not null,
  col_teams text[] not null
);
create table if not exists public.grid_picks (
  puzzle_id  text not null,
  square     int  not null check (square between 0 and 8),
  player     text not null check (char_length(player) between 1 and 20),
  nba_player text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (puzzle_id, square, player)     -- one vote per person per square; a change replaces it
);
create table if not exists public.grid_results (
  puzzle_id    text not null,
  player       text not null,
  score        numeric(8,2) not null,
  completed    int  not null,
  seconds      int,
  boxes        text,
  completed_at timestamptz not null default now(),
  primary key (puzzle_id, player)            -- the first finished score is the one that counts
);

-- Nobody can read the history, the puzzles' answers or other people's picks directly.
-- The game only talks to the functions below. Finished results are public for the leaderboard.
alter table public.grid_history enable row level security;
alter table public.grid_puzzles enable row level security;
alter table public.grid_picks   enable row level security;
alter table public.grid_results enable row level security;
drop policy if exists "read grid results" on public.grid_results;
create policy "read grid results" on public.grid_results for select using (true);

-- A daily grid is open for its whole day (midnight to midnight Eastern); after that it's an archive grid and picks
-- no longer count, so the day's final scores never change. Unlimited grids never close.
create or replace function public.grid_open(p_puzzle text)
returns boolean language sql stable as $$
  select case when p_puzzle ~ '^D[0-9]+$' then
    now() < ((date '{{START}}' + substring(p_puzzle from 2)::int)::timestamp) at time zone 'America/New_York'
  else true end;
$$;

-- Rarity for a {{LEAGUE}}-person league: the share of the league that picked the same player for that square,
-- i.e. picks / greatest(people who answered the square, {{LEAGUE}}). A first answer is 1 of {{LEAGUE}}, not 100%.
create or replace function public.grid_pct(cnt bigint, total bigint)
returns numeric language sql immutable as $$ select round(100.0 * cnt / greatest(total, {{LEAGUE}}), 2) $$;

-- Check a guess. With p_save it also records the vote (one per person per square).
create or replace function public.grid_guess(p_puzzle text, p_square int, p_player text, p_nba text, p_save boolean default true)
returns json language plpgsql security definer set search_path = public as $$
declare a text; b text; wa int; wb int; total int; cnt int; is_first boolean; is_open boolean;
begin
  p_player := trim(coalesce(p_player, ''));
  if p_square is null or p_square < 0 or p_square > 8 or char_length(p_player) not between 1 and 20 then
    return json_build_object('ok', false, 'reason', 'bad');
  end if;
  select row_teams[p_square / 3 + 1], col_teams[p_square % 3 + 1] into a, b from grid_puzzles where id = p_puzzle;
  if a is null then return json_build_object('ok', false, 'reason', 'puzzle'); end if;
  select weeks into wa from grid_history where manager = a and player_id = p_nba;
  select weeks into wb from grid_history where manager = b and player_id = p_nba;
  if wa is null or wb is null then
    return json_build_object('ok', false, 'reason', 'not', 'on_row', wa is not null, 'on_col', wb is not null);
  end if;
  if exists (select 1 from grid_picks where puzzle_id = p_puzzle and player = p_player and nba_player = p_nba and square <> p_square) then
    return json_build_object('ok', false, 'reason', 'used');
  end if;
  is_first := not exists (select 1 from grid_picks where puzzle_id = p_puzzle and square = p_square and nba_player = p_nba and player <> p_player);
  is_open := grid_open(p_puzzle);
  if p_save and is_open then
    insert into grid_picks (puzzle_id, square, player, nba_player) values (p_puzzle, p_square, p_player, p_nba)
    on conflict (puzzle_id, square, player) do update set nba_player = excluded.nba_player, updated_at = now();
  end if;
  select count(*) into total from grid_picks where puzzle_id = p_puzzle and square = p_square and player <> p_player;
  select count(*) into cnt   from grid_picks where puzzle_id = p_puzzle and square = p_square and player <> p_player and nba_player = p_nba;
  total := total + 1; cnt := cnt + 1;       -- this person's own pick, counted once
  return json_build_object('ok', true, 'count', cnt, 'total', total, 'pct', grid_pct(cnt, total),
                           'first', is_first, 'deep_cut', (wa + wb) <= {{DEEP}}, 'open', is_open);
end $$;

-- Current crowd rarity of each of one person's picks.
create or replace function public.grid_rarity(p_puzzle text, p_player text)
returns json language sql security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object(
    'square', m.square, 'nba', m.nba_player,
    'count', (select count(*) from grid_picks x where x.puzzle_id = m.puzzle_id and x.square = m.square and x.nba_player = m.nba_player),
    'total', (select count(*) from grid_picks y where y.puzzle_id = m.puzzle_id and y.square = m.square))), '[]'::json)
  from grid_picks m where m.puzzle_id = p_puzzle and m.player = trim(p_player);
$$;

-- Record when someone finishes (for the time on the leaderboard). Scores themselves stay live until the
-- grid closes: see grid_board. Worked out here from the saved picks, never sent by the phone.
create or replace function public.grid_finish(p_puzzle text, p_player text, p_seconds int, p_boxes text)
returns json language plpgsql security definer set search_path = public as $$
declare n int; total_score numeric; existing grid_results;
begin
  p_player := trim(coalesce(p_player, ''));
  select * into existing from grid_results where puzzle_id = p_puzzle and player = p_player;
  if found then return row_to_json(existing); end if;
  if not grid_open(p_puzzle) then return json_build_object('ok', false, 'reason', 'closed'); end if;
  select count(*) into n from grid_picks where puzzle_id = p_puzzle and player = p_player;
  if n < 9 then return json_build_object('ok', false, 'reason', 'not finished'); end if;
  select sum(grid_pct((select count(*) from grid_picks x where x.puzzle_id = m.puzzle_id and x.square = m.square and x.nba_player = m.nba_player),
                      (select count(*) from grid_picks y where y.puzzle_id = m.puzzle_id and y.square = m.square)))
    into total_score from grid_picks m where m.puzzle_id = p_puzzle and m.player = p_player;
  insert into grid_results (puzzle_id, player, score, completed, seconds, boxes)
  values (p_puzzle, p_player, round(total_score, 2), 9, greatest(0, least(p_seconds, 864000)), left(coalesce(p_boxes, ''), 60))
  on conflict (puzzle_id, player) do nothing;
  select * into existing from grid_results where puzzle_id = p_puzzle and player = p_player;
  return row_to_json(existing);
end $$;

-- The leaderboard: everyone who has played a grid, with their live score (final once a daily grid closes).
-- Shows names and totals only, never anyone's answers.
create or replace function public.grid_board(p_puzzle text)
returns json language sql security definer set search_path = public as $$
  select coalesce(json_agg(r order by r.completed desc, r.score asc, r.finished_at asc nulls last), '[]'::json) from (
    select m.player,
           count(*) as completed,
           sum(grid_pct((select count(*) from grid_picks x where x.puzzle_id = m.puzzle_id and x.square = m.square and x.nba_player = m.nba_player),
                        (select count(*) from grid_picks y where y.puzzle_id = m.puzzle_id and y.square = m.square))) as score,
           max(res.seconds) as seconds, max(res.completed_at) as finished_at, not grid_open(p_puzzle) as final
    from grid_picks m left join grid_results res on res.puzzle_id = m.puzzle_id and res.player = m.player
    where m.puzzle_id = p_puzzle group by m.player
  ) r;
$$;

-- Roster history and puzzles (refreshed every time this file runs).
delete from public.grid_history;
insert into public.grid_history (manager, player_id, weeks) values
{{HISTORY}};
insert into public.grid_puzzles (id, row_teams, col_teams) values
{{PUZZLES}}
on conflict (id) do update set row_teams = excluded.row_teams, col_teams = excluded.col_teams;
"""


if __name__ == "__main__":
    main()
