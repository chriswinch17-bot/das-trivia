"""Das Feud: one survey-board question a day, Family-Feud style, answered from the league's own history.

Usage:
    python scripts/build_feud.py        (run build_data.py first; part of the nightly job)

Each survey is "Name a ..." with the top 6 answers ranked by the data (most trades, most wins, first picks...).
The board shows 6 hidden slots worth 40 / 25 / 15 / 10 / 6 / 4 points (#1 is the top answer). The player has
60 seconds and 3 strikes. Every answer and its ranking is worked out from site/data (made from data/raw).

Writes site/data/feud.json. Days already scheduled keep their survey; new days are added 3 weeks ahead.
"""

import hashlib
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from daily import extend_schedule, fill_missing  # noqa: E402
from nicknames import load_nicknames  # noqa: E402

DATA = Path(__file__).resolve().parent.parent / "site" / "data"
START_DATE = "2026-11-19"
POINTS = [40, 25, 15, 10, 6, 4]
SUFFIXES = {"jr", "jr.", "sr", "sr.", "ii", "iii", "iv"}


def load(name):
    return json.loads((DATA / f"{name}.json").read_text(encoding="utf-8"))


def main():
    managers = {m["id"]: m for m in load("managers")}
    seasons, drafts, trades, matchups, players = load("seasons"), load("drafts"), load("trades"), load("matchups"), load("players")
    done = [s for s in seasons if s["status"] == "complete"]
    done_labels = {s["season"] for s in done}
    span = f"{done[0]['season']} to {done[-1]['season']}"
    nicknames = load_nicknames({p["name"] for p in players.values()})

    def show(mid):
        return f"{managers[mid]['current_team_name']} ({managers[mid]['name']})"

    def manager_answer(mid, detail):
        m = managers[mid]
        return {"display": show(mid), "accept": sorted({m["name"], *m["aliases"], *m["sleeper_usernames"], *m["team_names"]}),
                "detail": detail, "manager": mid}

    def player_answer(name, detail):
        parts = name.split()
        while len(parts) > 1 and parts[-1].lower() in SUFFIXES:
            parts.pop()
        accept = {name, " ".join(parts)}
        if len(parts) > 1:
            accept.update({parts[-1], parts[0]})
        accept.update(nicknames.get(name, []))
        return {"display": name, "accept": sorted(accept), "detail": detail}

    surveys = []

    def survey(prompt, ranked, sources, note=None):
        """ranked: answers best first (already built). Keeps the top 6 and gives them board points."""
        ranked = ranked[:6]
        if len(ranked) < 4:
            return
        for a, pts in zip(ranked, POINTS):
            a["points"] = pts
        surveys.append({"id": hashlib.md5(prompt.encode("utf-8")).hexdigest()[:8], "prompt": prompt,
                        "answers": ranked, "note": note, "sources": sources})

    def top(counter, n=6):
        return sorted(counter.items(), key=lambda kv: (-kv[1], kv[0]))[:n]

    plural = lambda n, w: f"{n} {w}" if n == 1 else f"{n} {w}s"

    traded = Counter(n for t in trades for s in t["sides"] for n in s["receives_players"])
    trades_by = Counter(m for t in trades for m in t["managers"])
    TR, S, M, D = ["trades.json"], ["seasons.json"], ["matchups.json"], ["drafts.json"]

    survey("Name one of the players traded the most times in Das League.",
           [player_answer(n, f"Traded {plural(c, 'time')}.") for n, c in top(traded)], TR)
    survey("Name one of the managers who has made the most trades.",
           [manager_answer(m, f"{plural(c, 'trade')}.") for m, c in top(trades_by)], TR)
    wins = Counter()
    playoffs = Counter()
    against = Counter()
    for s in done:
        for r in s["standings"]:
            wins[r["manager"]] += r["wins"]
            playoffs[r["manager"]] += bool(r["made_playoffs"])
            against[r["manager"]] += r["points_against"]
    survey(f"Name a manager with the most regular-season wins ({span}).",
           [manager_answer(m, f"{c} wins.") for m, c in top(wins)], S)
    survey(f"Name a manager with the most playoff trips ({span}).",
           [manager_answer(m, f"{plural(c, 'playoff trip')}.") for m, c in top(playoffs)], S)
    survey(f"Name a team that has had the most points scored against it ({span}).",
           [manager_answer(m, f"{c:,.0f} points against.") for m, c in top(against)], S)
    for s in done:
        pf = Counter({r["manager"]: r["points_for"] for r in s["standings"]})
        survey(f"Name one of the top-scoring teams of the {s['season']} regular season.",
               [manager_answer(m, f"{c:,.0f} points.") for m, c in top(pf)], S)
    for d in drafts:
        title = f"{d['season'][:4]} {d['kind']} draft"
        survey(f"Name one of the first six picks of the {title}.",
               [player_answer(p["player"], f"Pick {p['pick']}, by {show(p['manager'])}.") for p in d["picks"][:6]], D)
    papo_partners = Counter(m for t in trades if "papo" in t["managers"] for m in t["managers"] if m != "papo")
    survey("Name one of Papo's favourite trade partners.",
           [manager_answer(m, f"{plural(c, 'trade')} with Papo.") for m, c in top(papo_partners)], TR)
    h2h = defaultdict(Counter)
    for g in matchups:
        if g["season"] in done_labels and not g["tie"]:
            h2h[g["loser"]][g["winner"]] += 1
    for mid in managers:
        got = Counter(n for t in trades for s in t["sides"] if s["manager"] == mid for n in s["receives_players"])
        ranked = sorted(got, key=lambda n: (-got[n], -traded[n], n))
        survey(f"Name a player {show(mid)} has traded for.",
               [player_answer(n, f"Traded for {plural(got[n], 'time')} by {managers[mid]['name']} (traded {plural(traded[n], 'time')} in all).")
                for n in ranked], TR, note="Ranked by how often they traded for him, then how often he's been traded in the league.")
        if h2h[mid]:
            survey(f"Name a manager who has beaten {show(mid)} the most ({span}, regular season).",
                   [manager_answer(m, f"{plural(c, 'win')} against {managers[mid]['name']}.") for m, c in top(h2h[mid])], M)

    # schedule: one survey a day; scheduled days keep theirs
    out = DATA / "feud.json"
    old = json.loads(out.read_text(encoding="utf-8")) if out.exists() else {"days": []}
    by_id = {s["id"]: s for s in surveys}
    days = [[by_id[d[0]["id"]]] if d and d[0]["id"] in by_id else [] for d in old["days"]]
    fill_missing(days, surveys, 1)
    extend_schedule(days, surveys, 1, START_DATE, "feud")
    out.write_text(json.dumps({"title": "Das Feud", "start_date": START_DATE, "points": POINTS, "seconds": 60, "strikes": 3,
                               "days": days}, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote Das Feud: {len(surveys)} surveys, {len(days)} days.")


if __name__ == "__main__":
    main()
