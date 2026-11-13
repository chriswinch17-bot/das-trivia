"""Rostered or Waiver: build today's game from Sleeper's LIVE rosters.

Usage:
    python scripts/build_rorw.py            builds today's game if it doesn't exist yet
    python scripts/build_rorw.py --force    rebuilds today's game from the rosters right now

Runs automatically every morning (.github/workflows/rorw-refresh.yml). It downloads, at that moment:
  the league (for its scoring), its users and rosters, this season's transactions, this season's stats
  for every NBA player, and Sleeper's player list. Today's answers are frozen as of that download, so
  everyone plays the same game all day even while people keep adding and dropping players.
Earlier seasons' history comes from data/raw/sleeper (via grids_history.py).

Writes site/data/rorw.json. Days already built are never changed (unless --force, and only today).
"""

import json
import random
import sys
import time
import urllib.request
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from datetime import time as clock
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from grids_history import build_history  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "site" / "data" / "rorw.json"
API = "https://api.sleeper.app/v1"
LEAGUE_ID = "1344343390740819968"
START_DATE = "2026-11-13"     # Rostered or Waiver #1
PER_DAY = 7
MIN_GAMES = 3                 # only players who have played at least this many games this season
NO_REPEAT_DAYS = 10           # a player isn't used again within this many days


def get(path):
    request = urllib.request.Request(f"{API}{path}", headers={"User-Agent": "league-history-fetch"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                return json.loads(response.read().decode("utf-8"))
        except Exception:
            if attempt == 3:
                raise
            time.sleep(3 * (attempt + 1))


def eastern_now():
    """The time in New York (no time-zone database needed): EDT -4 from the 2nd Sunday of March, else EST -5."""
    utc = datetime.now(timezone.utc)

    def nth_sunday(month, n):
        d = date(utc.year, month, 1)
        d += timedelta(days=(6 - d.weekday()) % 7)
        return d + timedelta(weeks=n - 1)

    dst = datetime.combine(nth_sunday(3, 2), clock(7), timezone.utc) <= utc < datetime.combine(nth_sunday(11, 1), clock(6), timezone.utc)
    return (utc + timedelta(hours=-4 if dst else -5)), ("EDT" if dst else "EST")


def ordinal(n):
    return f"{n}{'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


def plural(n, word):
    return f"{n} {word}" if n == 1 else f"{n} {word}s"


def nice_date(d):
    return f"{d.strftime('%b')} {d.day}"


def main():
    force = "--force" in sys.argv
    now, zone = eastern_now()
    today = now.date().isoformat()
    number = (now.date() - date.fromisoformat(START_DATE)).days + 1
    if number < 1:
        sys.exit("Rostered or Waiver hasn't started yet.")

    game = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    days = game.get("days", [])
    as_of = game.get("as_of", [])
    dates = game.get("dates", [])
    if len(days) >= number and days[number - 1] and not force:
        print(f"Rostered or Waiver #{number} ({today}) already exists; nothing to do. Use --force to rebuild it.")
        return

    # ---------- the live download: this is the moment the answers are frozen ----------
    league = get(f"/league/{LEAGUE_ID}")
    users = {u["user_id"]: u for u in get(f"/league/{LEAGUE_ID}/users")}
    rosters = get(f"/league/{LEAGUE_ID}/rosters")
    stats = get(f"/stats/nba/regular/{league['season']}")
    players = get("/players/nba")
    moves = []
    for week in range(1, 31):
        moves += [t for t in (get(f"/league/{LEAGUE_ID}/transactions/{week}") or []) if t.get("status") == "complete"]
    stamp, stamp_zone = eastern_now()
    as_of_text = f"{stamp.strftime('%a %b')} {stamp.day}, {stamp.strftime('%I:%M %p').lstrip('0')} {stamp_zone}"

    managers = {m["id"]: m for m in json.loads((ROOT / "data" / "managers.json").read_text(encoding="utf-8"))["managers"]}
    by_username = {u.lower(): m["id"] for m in managers.values() for u in m["sleeper_usernames"]}
    owner, team_name = {}, {}
    for r in rosters:
        user = users[r["owner_id"]]
        mid = by_username[user["display_name"].lower()]
        owner[r["roster_id"]] = mid
        team_name[mid] = ((user.get("metadata") or {}).get("team_name") or "").strip() or managers[mid]["name"]

    def show(mid):
        return f"{team_name[mid]} ({managers[mid]['name']})"

    # who has each player right now (bench counts; taxi and IR players are left out of the game)
    holder, main_roster = {}, set()
    for r in rosters:
        for pid in (r.get("players") or []):
            holder[pid] = owner[r["roster_id"]]
        for pid in set(r.get("players") or []) - set(r.get("taxi") or []) - set(r.get("reserve") or []):
            main_roster.add(pid)

    # fantasy points per game with this league's scoring
    scoring = league["scoring_settings"]

    def fpg(pid):
        s = stats.get(pid) or {}
        gp = s.get("gp") or 0
        return (sum(s.get(k, 0) * w for k, w in scoring.items()) / gp) if gp else None

    # Das League history: every franchise that has ever had him (past seasons from the raw files + live moves)
    links, _, _ = build_history()
    teams_had = defaultdict(set)
    for (mid, pid) in links:
        teams_had[pid].add(mid)
    pickups = defaultdict(int)
    last_drop = {}
    since = {}
    for t in sorted(moves, key=lambda t: t.get("status_updated") or 0):
        when = datetime.fromtimestamp((t.get("status_updated") or 0) / 1000, timezone.utc) + timedelta(hours=-5)
        for pid, rid in (t.get("adds") or {}).items():
            teams_had[pid].add(owner[rid])
            since[(owner[rid], pid)] = when.date()
            if t["type"] in ("free_agent", "waiver"):
                pickups[pid] += 1
        for pid, rid in (t.get("drops") or {}).items():
            last_drop[pid] = (owner[rid], when.date())
    for pid, mid in holder.items():
        teams_had[pid].add(mid)
    for (mid, pid), link in links.items():
        if "free agent pickup" in link["sources"] or "waiver claim" in link["sources"]:
            pickups[pid] = max(pickups[pid], 1) if pid not in pickups else pickups[pid]

    def info(pid):
        p = players.get(pid) or {}
        name = (p.get("full_name") or f"{p.get('first_name', '')} {p.get('last_name', '')}").strip()
        return name, p.get("position") or "", p.get("team") or "FA"

    playing = [pid for pid, s in stats.items() if (s.get("gp") or 0) >= MIN_GAMES and pid in players and info(pid)[0]]
    rostered = sorted((pid for pid in playing if pid in main_roster), key=fpg)
    free = [pid for pid in playing if pid not in holder and teams_had[pid]]   # free agents someone has had before
    rank_low = {pid: i + 1 for i, pid in enumerate(rostered)}

    recent = {q["player"]["id"] for day in days[max(0, number - 1 - NO_REPEAT_DAYS):number - 1] if day for q in day}
    rng = random.Random(today)

    def take(pool, n):
        pool = [pid for pid in pool if pid not in recent and pid not in chosen]
        rng.shuffle(pool)
        return pool[:n]

    chosen = []
    stinkers = rostered[:15]                                                    # the worst players on rosters
    churn = sorted(free, key=lambda p: (-len(teams_had[p]), -pickups[p]))[:15]  # passed around, now free
    so_so = rostered[15:50]                                                     # decoys: meh but rostered
    good_free = sorted(free, key=lambda p: -fpg(p))[:25]                         # decoys: decent but free
    n_rostered = rng.choice([3, 4])
    chosen += take(stinkers, 2)
    chosen += take(so_so, n_rostered - 2)
    chosen += take(churn, 2)
    chosen += take(good_free, PER_DAY - len(chosen))
    if len(chosen) < PER_DAY:
        chosen += take(free + rostered, PER_DAY - len(chosen))
    rng.shuffle(chosen)

    questions = []
    for pid in chosen:
        name, pos, nba = info(pid)
        s = stats[pid]
        gp = int(s["gp"])
        per = lambda k: s.get(k, 0) / gp  # noqa: E731
        points = fpg(pid)
        mid = holder.get(pid)
        others = len(teams_had[pid])
        if mid:
            when = since.get((mid, pid))
            got = f"since {nice_date(when)}" if when else "since before this season"
            low = f", the {ordinal(rank_low[pid])} lowest of the {len(rostered)} rostered players who've played" if rank_low.get(pid, 99) <= 30 else ""
            detail = f"{show(mid)} has had him {got}. He's averaging {points:.1f} fantasy points a game{low}."
            display = f"ROSTERED by {show(mid)}"
        else:
            drop = last_drop.get(pid)
            dropped = f" {managers[drop[0]]['name']} dropped him on {nice_date(drop[1])}." if drop else ""
            detail = (f"Nobody has him. He's been on {plural(others, 'Das League team')}.{dropped} "
                      f"He's averaging {points:.1f} fantasy points a game.")
            display = "WAIVER: he's a free agent"
        questions.append({
            "id": f"rw-{today}-{pid}",
            "text": "Rostered or waiver?",
            "kind": "rw",
            "yes": bool(mid),
            "player": {
                "id": pid, "name": name, "pos": pos, "nba": nba, "gp": gp, "fpg": round(points, 1),
                "line": f"{per('pts'):.1f} pts · {per('reb'):.1f} reb · {per('ast'):.1f} ast",
                "teams": others,
            },
            "recap": f"{name} ({pos}, {nba}): rostered or waiver?",
            "answers": [{"display": display, "accept": ["rostered" if mid else "waiver"], "detail": detail}],
            "note": None,
            "about": [mid] if mid else [],
            "sources": ["Sleeper live rosters, transactions and season stats", "data/raw/sleeper"],
        })

    assert len(questions) == PER_DAY and len({q["player"]["id"] for q in questions}) == PER_DAY
    assert 3 <= sum(q["yes"] for q in questions) <= 4

    while len(days) < number:
        days.append(None)
        as_of.append(None)
        dates.append(None)
    days[number - 1] = questions
    as_of[number - 1] = as_of_text
    dates[number - 1] = today
    OUT.write_text(json.dumps({
        "title": "Rostered or Waiver",
        "start_date": START_DATE,
        "days": days,
        "as_of": as_of,
        "dates": dates,
        "players": [{"id": m["id"], "name": m["name"]} for m in managers.values()],
    }, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"Rostered or Waiver #{number} ({today}) built from rosters as of {as_of_text}: "
          f"{sum(q['yes'] for q in questions)} rostered, {PER_DAY - sum(q['yes'] for q in questions)} on waivers.")
    for q in questions:
        print(f"   {'ROSTERED' if q['yes'] else 'waiver  '}  {q['player']['name']:<24} {q['player']['fpg']:>5} fp/g  {q['answers'][0]['detail'][:80]}")


if __name__ == "__main__":
    main()
