"""Write the daily "What team am I?" games: 2 mystery managers a day, 5 clues each, hardest first.

Usage:
    python scripts/build_team.py      (run build_data.py first)

Reads   site/data/managers.json, seasons.json, drafts.json, trades.json  (made by build_data.py)
Writes  site/data/team.json

The answer is a manager's franchise. Every clue is worked out from the data:
  1 deep cut   a late pick they made in the 2023 startup draft
  2 hard       a player they traded for (one nobody else in the league ever traded for, when possible)
  3 medium     a rookie-draft pick
  4 easy       a career line (record and playoff trips / best season / number of trades)
  5 giveaway   their current team name with most letters hidden
Each manager appears once per round; ROUNDS rounds use different clues. Game #1 opens with FIRST.
Days already in team.json keep their teams on every rebuild.
"""

import json
import random
from collections import defaultdict
from datetime import datetime
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "site" / "data"
START_DATE = "2026-11-12"   # the day What team am I? #1 is played
PER_DAY = 2
ROUNDS = 3
FIRST = "joey"              # the owner asked for Joey's team to open the game
POINTS = [100, 80, 60, 40, 20]


def load(name):
    return json.loads((DATA / f"{name}.json").read_text(encoding="utf-8"))


def ordinal(n):
    return f"{n}{'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


def plural(n, word):
    return f"{n} {word}" if n == 1 else f"{n} {word}s"


def nice_date(iso):
    d = datetime.strptime(iso, "%Y-%m-%d")
    return f"{d.strftime('%B')} {d.day}, {d.year}"


def hidden(name):
    """'Fidel's Accumulators' -> 'F____'_ A___________': first letter of each word, the rest blanked."""
    out, start = [], True
    for ch in name:
        if ch.isalnum():
            out.append(ch if start else "_")
            start = False
        else:
            out.append(ch)
            start = ch == " "
    return "".join(out)


def main():
    managers = {m["id"]: m for m in load("managers")}
    seasons = load("seasons")
    done = [s for s in seasons if s["status"] == "complete"]
    drafts, trades = load("drafts"), load("trades")
    row = {(s["season"], r["manager"]): r for s in seasons for r in s["standings"]}
    startup = next(d for d in drafts if d["kind"] == "startup")
    rookies = [d for d in drafts if d["kind"] == "rookie"]

    acquired, takers = defaultdict(list), defaultdict(set)
    trade_count = defaultdict(int)
    for t in trades:
        for m in t["managers"]:
            trade_count[m] += 1
        for side in t["sides"]:
            for p in side["receives_players"]:
                acquired[side["manager"]].append((p, t["date"]))
                takers[p].add(side["manager"])

    def show(mid):
        return f"{managers[mid]['current_team_name']} ({managers[mid]['name']})"

    def career(mid):
        rows = [row[(s["season"], mid)] for s in done]
        wins, losses = sum(r["wins"] for r in rows), sum(r["losses"] for r in rows)
        playoffs = sum(1 for r in rows if r["made_playoffs"])
        return rows, wins, losses, playoffs

    # Each manager's pools of facts, shuffled once so every round uses a different one.
    rng = random.Random(23)
    pools = {}
    for mid in managers:
        late = [p for p in startup["picks"] if p["manager"] == mid and p["round"] >= 8]
        only_them = [(p, d) for p, d in acquired[mid] if takers[p] == {mid}]
        traded_for = only_them if len(only_them) >= ROUNDS else acquired[mid]
        drafted = [(d, p) for d in rookies for p in d["picks"] if p["manager"] == mid]
        for pool in (late, traded_for, drafted):
            rng.shuffle(pool)
        pools[mid] = (late, traded_for, drafted)

    def clues(mid, k):
        m = managers[mid]
        late, traded_for, drafted = pools[mid]
        sp = late[k % len(late)]
        player, date = traded_for[k % len(traded_for)]
        out = [
            f"In the 2023 startup draft, I took {sp['player']} in round {sp['round']} (pick {sp['pick']} overall).",
            f"On {nice_date(date)}, I traded for {player}.",
        ]
        if drafted:
            d, p = drafted[k % len(drafted)]
            out.append(f"In the {d['season'][:4]} rookie draft, I picked {p['player']} ({ordinal(p['pick'])} overall).")
        else:
            other, when = traded_for[(k + 1) % len(traded_for)]
            out.append(f"On {nice_date(when)}, I traded for {other}.")
        rows, wins, losses, playoffs = career(mid)
        best = max(((s["season"], row[(s["season"], mid)]) for s in done),
                   key=lambda x: (x[1]["wins"] - x[1]["losses"], x[1]["points_for"]))
        out.append([
            f"Through {done[-1]['season']}, my regular-season record is {wins}-{losses}, with {plural(playoffs, 'playoff trip')}.",
            f"My best regular season was {best[1]['wins']}-{best[1]['losses']} in {best[0]}, {ordinal(best[1]['regular_season_rank'])} of 12.",
            f"I've made {plural(trade_count[mid], 'trade')} in Das League.",
        ][k % 3])
        out.append(f'My team name today looks like this: "{hidden(m["current_team_name"])}"')
        return [c.replace("..", ".") for c in out]   # "Jr." at the end of a sentence

    def question(mid, k):
        m = managers[mid]
        rows, wins, losses, playoffs = career(mid)
        titles = len(m["championships"])
        return {
            "id": f"team-{mid}-{k + 1}",
            "text": "What team am I?",
            "kind": "clues",
            "clues": clues(mid, k),
            "points": POINTS,
            "recap": f"What team am I? (round {k + 1})",
            "answers": [{
                "display": show(mid),
                "accept": sorted({m["name"], *m["aliases"], *m["sleeper_usernames"], *m["team_names"]}),
                "manager": mid,
                "detail": (f"Through {done[-1]['season']}, {m['name']} is {wins}-{losses} in the regular season with "
                           f"{plural(playoffs, 'playoff trip')}, {plural(titles, 'title')} and {plural(trade_count[mid], 'trade')}."),
            }],
            "note": None,
            "about": [mid],
            "sources": ["drafts.json", "trades.json", "seasons.json", "managers.json"],
        }

    # Round 1 opens with FIRST; every round has each manager once, in a shuffled order.
    order = []
    for k in range(ROUNDS):
        mids = [m for m in managers if not (k == 0 and m == FIRST)]
        rng.shuffle(mids)
        order += [question(m, k) for m in ([FIRST] if k == 0 else []) + mids]

    out = DATA / "team.json"
    scheduled = [[q["id"] for q in day] for day in json.loads(out.read_text(encoding="utf-8"))["days"]] if out.exists() else []
    by_id = {q["id"]: q for q in order}
    days = [[by_id[i] for i in day] for day in scheduled if all(i in by_id for i in day)]
    used = {q["id"] for day in days for q in day}
    spare = [q for q in order if q["id"] not in used]
    while len(spare) >= PER_DAY:
        days.append([spare.pop(0) for _ in range(PER_DAY)])

    entities = sorted({a for q in order for a in q["answers"][0]["accept"]})
    out.write_text(json.dumps({
        "title": "What team am I?",
        "start_date": START_DATE,
        "days": days,
        "players": [{"id": m["id"], "name": m["name"]} for m in managers.values()],
        "entities": entities,
    }, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"{len(order)} mystery teams; {len(days)} daily games of {PER_DAY}.")


if __name__ == "__main__":
    main()
