"""Write the daily "Papo Trade or NOT" games: 5 yes-or-no questions a day.

Usage:
    python scripts/build_papo.py      (run build_data.py first)

Reads   site/data/trades.json, managers.json, seasons.json  (made by build_data.py)
Writes  site/data/papo.json

Each question shows one real trade with the teams hidden, and the player says whether Papo was in it.
Draft picks and FAAB count. Trades undone the same day are already left out by build_data.py.
Days already in papo.json keep their questions on every rebuild; new trades only add days at the end.
"""

import json
import random
from datetime import datetime
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from daily import extend_schedule, fill_missing  # noqa: E402

DATA = Path(__file__).resolve().parent.parent / "site" / "data"
START_DATE = "2026-11-12"   # the day Papo Trade or NOT #1 is played
PER_DAY = 5
MAX_ITEMS = 10              # skip giant trades: too much to read in 25 seconds
TARGET = "papo"


def load(name):
    return json.loads((DATA / f"{name}.json").read_text(encoding="utf-8"))


def ordinal(n):
    return f"{n}{'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


def nice_date(iso):
    d = datetime.strptime(iso, "%Y-%m-%d")
    return f"{d.strftime('%B')} {d.day}, {d.year}"


def joined(items):
    if not items:
        return "nothing"
    return items[0] if len(items) == 1 else ", ".join(items[:-1]) + " and " + items[-1]


def main():
    managers = {m["id"]: m for m in load("managers")}
    seasons = load("seasons")
    team = {(s["season"], r["manager"]): r["team_name"] for s in seasons for r in s["standings"]}
    trades = load("trades")

    def show(mid, season):
        return f"{team.get((season, mid), managers[mid]['current_team_name'])} ({managers[mid]['name']})"

    def items(side):
        return (side["receives_players"]
                + [f"{p['draft_year']} {ordinal(p['round'])}-round pick"
                   for p in sorted(side["receives_picks"], key=lambda p: (p["draft_year"], p["round"]))]
                + ([f"${side['receives_faab']} FAAB"] if side["receives_faab"] else []))

    questions = []
    for t in trades:
        sides = [items(s) for s in t["sides"]]
        size = sum(len(x) for x in sides)
        if size == 0 or size > MAX_ITEMS:
            continue
        yes = TARGET in t["managers"]
        questions.append({
            "id": t["id"],
            "text": "Was Papo in this trade?",
            "kind": "yesno",
            "yes": yes,
            "date": nice_date(t["date"]),
            "sides": sides,
            "recap": f"{nice_date(t['date'])}: " + " for ".join(joined(x) for x in sides),
            "answers": [{
                "display": "YES, Papo was in it" if yes else "NO, Papo wasn't in it",
                "accept": ["yes" if yes else "no"],
                "detail": " ".join(f"{show(s['manager'], t['season'])} got {joined(x)}." for s, x in zip(t["sides"], sides)),
            }],
            "note": None,
            "about": [TARGET] if yes else list(t["managers"]),
            "sources": ["trades.json"],
        })

    # keep the games already scheduled exactly as they are
    out = DATA / "papo.json"
    scheduled = [[q["id"] for q in day] for day in json.loads(out.read_text(encoding="utf-8"))["days"]] if out.exists() else []
    by_id = {q["id"]: q for q in questions}
    days = [[by_id[i] for i in day if i in by_id] for day in scheduled]   # never dropped: numbers never shift
    used = {q["id"] for day in days for q in day}

    # new days: 2 or 3 Papo trades in each, so "yes" is never a safe guess
    rng = random.Random(2023 + len(days))
    yes_pool = [q for q in questions if q["yes"] and q["id"] not in used]
    no_pool = [q for q in questions if not q["yes"] and q["id"] not in used]
    rng.shuffle(yes_pool)
    rng.shuffle(no_pool)
    while True:
        n_yes = rng.choice([2, 3])
        if len(yes_pool) < n_yes or len(no_pool) < PER_DAY - n_yes:
            break
        day = [yes_pool.pop() for _ in range(n_yes)] + [no_pool.pop() for _ in range(PER_DAY - n_yes)]
        rng.shuffle(day)
        days.append(day)

    # 2 or 3 Papo trades a day, also when reusing trades not asked for the longest time
    def balanced(day, q):
        yes = sum(d["yes"] for d in day)
        return not (q["yes"] and yes >= 3) and not (not q["yes"] and len(day) - yes >= 3)

    fill_missing(days, questions, PER_DAY, balanced)
    extend_schedule(days, questions, PER_DAY, START_DATE, "papo", balanced)

    out.write_text(json.dumps({
        "title": "Papo Trade or NOT",
        "start_date": START_DATE,
        "days": days,
        "players": [{"id": m["id"], "name": m["name"]} for m in managers.values()],
    }, indent=1, ensure_ascii=False), encoding="utf-8")

    papo_total = sum(TARGET in t["managers"] for t in trades)
    print(f"{len(trades)} real trades ({papo_total} with Papo). {len(questions)} usable as questions; "
          f"{len(days)} daily games of {PER_DAY}. Left over: {len(yes_pool)} Papo, {len(no_pool)} not.")


if __name__ == "__main__":
    main()
