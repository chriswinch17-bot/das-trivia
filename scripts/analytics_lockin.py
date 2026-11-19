"""EquipoGPT Analytics: the Lock-in report (called by build_analytics.py).

Das League is a lock-in league: each starter counts ONE game a week, the one the manager locks (an unlocked
starter's last game counts). This compares every starter's locked game with his other games that week:
  - lock edge: locked score minus his average game that week (+ = locked a better-than-usual game)
  - best-game rate: share of starter-weeks (with 2+ games to choose from) where the best game was the one counted
Per manager it adds the edge up across the 10 starters: "points a week gained by locking well".
Uses finished seasons only: their saved weekly scores match Sleeper's official totals exactly, and each
player's games come from data/raw/sleeper/<season>/gamelogs.json (scripts/fetch_gamelogs.py).
"""

import json
from pathlib import Path

RAW = Path(__file__).resolve().parent.parent / "data" / "raw" / "sleeper"


def load(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def build(managers_file, team_now):
    by_username = {u.lower(): m["id"] for m in managers_file for u in m["sleeper_usernames"]}
    names = {m["id"]: m["name"] for m in managers_file}
    all_players = load(RAW / "players_nba.json")
    pname = lambda pid: ((all_players.get(str(pid)) or {}).get("full_name") or f"Player {pid}").replace(" DUPLICATE", "").strip()
    per = {}            # manager -> list of dicts
    seasons = []
    matched = total = 0
    for folder in sorted(p for p in RAW.iterdir() if p.is_dir()):
        logs_file = folder / "gamelogs.json"
        league = load(folder / "league.json")
        if league["status"] != "complete" or not logs_file.exists():
            continue
        year = int(league["season"])
        label = f"{year}-{year + 1}"
        seasons.append(label)
        scoring = league["scoring_settings"]
        regular_last = (league["settings"].get("playoff_week_start") or 99) - 1
        users = {u["user_id"]: u["display_name"].lower() for u in load(folder / "users.json")}
        rm = {r["roster_id"]: by_username[users[r["owner_id"]]] for r in load(folder / "rosters.json")}
        logs = load(logs_file)
        for f in sorted((folder / "matchups").glob("week_*.json")):
            week = int(f.stem.split("_")[1])
            if week > regular_last:
                continue
            for e in load(f):
                if not e.get("points"):
                    continue
                mid = rm[e["roster_id"]]
                for pid, locked in zip(e.get("starters") or [], e.get("starters_points") or []):
                    games = [round(sum((st.get(k, 0) or 0) * w for k, w in scoring.items()), 1)
                             for _, st in (logs.get(pid, {}).get(str(week)) or [])]
                    if not games:
                        continue
                    total += 1
                    matched += any(abs(locked - g) < 0.6 for g in games)
                    avg = sum(games) / len(games)
                    per.setdefault(mid, []).append({
                        "season": label, "week": week, "player": pid, "locked": locked, "avg": avg,
                        "best": max(games), "games": len(games),
                    })
    if not per:
        return None

    league_gain = [r["locked"] - r["avg"] for rows in per.values() for r in rows]
    managers = []
    for mid, rows in per.items():
        team_weeks = {(r["season"], r["week"]) for r in rows}
        gain = sum(r["locked"] - r["avg"] for r in rows)
        choice = [r for r in rows if r["games"] >= 2]
        best_hits = sum(1 for r in choice if r["locked"] >= r["best"] - 0.5)
        by_season = {}
        for s in seasons:
            sr = [r for r in rows if r["season"] == s]
            wk = {r["week"] for r in sr}
            if wk:
                by_season[s] = round(sum(r["locked"] - r["avg"] for r in sr) / len(wk), 1)
        top = max(rows, key=lambda r: r["locked"] - r["avg"])
        miss = max(choice or rows, key=lambda r: r["best"] - r["locked"])
        managers.append({
            "manager": mid, "name": names[mid], "team": team_now.get(mid, names[mid]),
            "per_week": round(gain / len(team_weeks), 1), "best_rate": round(best_hits / len(choice) * 100, 1) if choice else None,
            "starter_weeks": len(rows), "weeks": len(team_weeks), "by_season": by_season,
            "best_lock": {"player": pname(top["player"]), "season": top["season"], "week": top["week"],
                          "locked": top["locked"], "avg": round(top["avg"], 1)},
            "worst_miss": {"player": pname(miss["player"]), "season": miss["season"], "week": miss["week"],
                           "locked": miss["locked"], "best": miss["best"]},
        })
    managers.sort(key=lambda m: -m["per_week"])
    for i, m in enumerate(managers, 1):
        m["rank"] = i
    weeks_all = sum(m["weeks"] for m in managers)
    return {
        "seasons": seasons, "managers": managers,
        "league_per_week": round(sum(league_gain) / weeks_all, 1) if weeks_all else 0,
        "league_best_rate": round(sum(1 for rows in per.values() for r in rows if r["games"] >= 2 and r["locked"] >= r["best"] - 0.5)
                                  / max(1, sum(1 for rows in per.values() for r in rows if r["games"] >= 2)) * 100, 1),
        "matched_share": round(matched / total * 100, 1) if total else None,
    }
