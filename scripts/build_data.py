"""Turn the raw Sleeper download into the clean files the website reads.

Usage:
    python scripts/build_data.py

Reads   data/raw/sleeper/   (untouched Sleeper download)
        data/managers.json  (real names supplied by the league owner)
Writes  site/data/*.json

Nothing here is invented: every value is copied or added up from the raw files.
The script stops with an error if the raw data disagrees with itself.
"""

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw" / "sleeper"
OUT = ROOT / "site" / "data"


def load(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def save(name, data):
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"{name}.json").write_text(json.dumps(data, indent=1, ensure_ascii=False), encoding="utf-8")


def fail(message):
    sys.exit(f"DATA PROBLEM: {message}")


def season_label(year):
    return f"{year}-{int(year) + 1}"


def main():
    manager_file = load(ROOT / "data" / "managers.json")["managers"]
    by_username = {u.lower(): m["id"] for m in manager_file for u in m["sleeper_usernames"]}
    all_players = load(RAW / "players_nba.json")
    used_players = {}

    def player(player_id, fallback=None):
        info = all_players.get(str(player_id)) or {}
        name = info.get("full_name") or " ".join(filter(None, [info.get("first_name"), info.get("last_name")]))
        if not name and fallback:
            name = " ".join(filter(None, [fallback.get("first_name"), fallback.get("last_name")]))
        if not name:
            fail(f"no name found for player ID {player_id}")
        name = name.replace(" DUPLICATE", "").strip()   # a label Sleeper left on one of its own records
        used_players[str(player_id)] = {"name": name, "position": info.get("position") or (fallback or {}).get("position")}
        return name

    seasons, matchups, drafts, trades = [], [], [], []
    team_names = {m["id"]: [] for m in manager_file}
    current_team = {}
    seasons_played = {m["id"]: [] for m in manager_file}

    folders = sorted(p for p in RAW.iterdir() if p.is_dir())
    for index, folder in enumerate(folders):
        league = load(folder / "league.json")
        settings = league["settings"]
        year = league["season"]
        label = season_label(year)
        finished = league["status"] == "complete"
        users = {u["user_id"]: u for u in load(folder / "users.json")}

        # --- who ran which team this season ---
        roster_manager, roster_team, standings, official = {}, {}, [], {}
        for roster in load(folder / "rosters.json"):
            user = users.get(roster["owner_id"])
            if not user:
                fail(f"{label}: roster {roster['roster_id']} has no owner")
            manager = by_username.get(user["display_name"].lower())
            if not manager:
                fail(f"{label}: Sleeper user '{user['display_name']}' is not in data/managers.json")
            team = ((user.get("metadata") or {}).get("team_name") or "").strip() or f"Team {user['display_name']}"
            rid = roster["roster_id"]
            roster_manager[rid], roster_team[rid] = manager, team
            official[rid] = (roster.get("metadata") or {}).get("record") or ""
            current_team[manager] = team
            if team not in team_names[manager]:
                team_names[manager].append(team)
            seasons_played[manager].append(label)
            s = roster["settings"]
            standings.append({
                "manager": manager,
                "team_name": team,
                "wins": s.get("wins", 0),
                "losses": s.get("losses", 0),
                "ties": s.get("ties", 0),
                "points_for": s.get("fpts", 0) + s.get("fpts_decimal", 0) / 100,
                "points_against": s.get("fpts_against", 0) + s.get("fpts_against_decimal", 0) / 100,
                "_roster": rid,
            })
        if len(set(roster_manager.values())) != len(roster_manager):
            fail(f"{label}: one manager is linked to two teams")

        def win_pct(row):
            games = row["wins"] + row["losses"] + row["ties"]
            return (row["wins"] + row["ties"] / 2) / games if games else 0

        standings.sort(key=lambda row: (-win_pct(row), -row["points_for"]))
        for rank, row in enumerate(standings, 1):
            row["regular_season_rank"] = rank

        # --- playoffs ---
        start = settings["playoff_week_start"]
        round_type = settings.get("playoff_round_type", 0)   # 0: one week per round, 2: two weeks per round
        bracket = load(folder / "winners_bracket.json") or []
        last_round = max((m["r"] for m in bracket), default=0)

        def round_weeks(r):
            if round_type == 2:
                first = start + (r - 1) * 2
                return [first, first + 1]
            if round_type == 1 and r == last_round:
                return [start + r - 1, start + r]
            return [start + r - 1]

        week_points = {}
        for file in sorted((folder / "matchups").glob("week_*.json")):
            week_points[int(file.stem[5:])] = load(file)

        def total(roster_id, weeks):
            return round(sum(e["points"] or 0 for w in weeks for e in week_points.get(w, []) if e["roster_id"] == roster_id), 2)

        playoffs, places = [], {}
        if finished:
            seeded = {row["_roster"] for row in standings[: settings["playoff_teams"]]}
            in_bracket = {m[k] for m in bracket for k in ("t1", "t2")}
            if seeded != in_bracket:
                fail(f"{label}: playoff teams in the bracket don't match the top of the standings")
            round_names = {last_round: "Final", last_round - 1: "Semifinal", last_round - 2: "Quarterfinal"}
            for game in sorted(bracket, key=lambda m: (m["r"], m["m"])):
                weeks = round_weeks(game["r"])
                w, l = game["w"], game["l"]
                w_pts, l_pts = total(w, weeks), total(l, weeks)
                if w_pts < l_pts:
                    fail(f"{label}: playoff game {game['m']} winner scored less than the loser")
                place = game.get("p")
                kind = {1: "Final", 3: "3rd-place game", 5: "5th-place game"}.get(place) or round_names.get(game["r"], f"Round {game['r']}")
                playoffs.append({
                    "round": kind, "weeks": weeks,
                    "winner": roster_manager[w], "winner_points": w_pts,
                    "loser": roster_manager[l], "loser_points": l_pts,
                })
                if place:
                    places[roster_manager[w]], places[roster_manager[l]] = place, place + 1
            champion_roster = (league.get("metadata") or {}).get("latest_league_winner_roster_id")
            champion = next(m for m, p in places.items() if p == 1)
            if champion_roster and roster_manager[int(champion_roster)] != champion:
                fail(f"{label}: Sleeper's recorded champion doesn't match the bracket")

        for row in standings:
            row["playoff_finish"] = places.get(row["manager"])
            row["made_playoffs"] = (row["regular_season_rank"] <= settings["playoff_teams"]) if finished else None
            del row["_roster"]

        by_place = {p: m for m, p in places.items()}
        seasons.append({
            "season": label,
            "status": "complete" if finished else "in progress",
            "teams": len(standings),
            "regular_season_weeks": start - 1,
            "playoff_teams": settings["playoff_teams"],
            "champion": by_place.get(1), "runner_up": by_place.get(2), "third_place": by_place.get(3),
            "standings": standings,
            "playoffs": playoffs,
        })

        # --- regular-season matchups ---
        last_week = start - 1 if finished else min(start - 1, settings.get("last_scored_leg") or 0)
        for week in range(1, last_week + 1):
            games = {}
            for entry in week_points.get(week, []):
                if entry.get("matchup_id") is not None:
                    games.setdefault(entry["matchup_id"], []).append(entry)
            for pair in games.values():
                if len(pair) != 2:
                    fail(f"{label} week {week}: a matchup doesn't have exactly two teams")
                a, b = sorted(pair, key=lambda e: -(e["points"] or 0))
                # Sleeper's official week-by-week result (W/L/T) decides the winner. It can
                # disagree with the points shown when NBA stats were corrected after the week closed.
                res_a = official[a["roster_id"]][week - 1: week]
                res_b = official[b["roster_id"]][week - 1: week]
                if sorted(res_a + res_b) not in (["L", "W"], ["T", "T"]):
                    fail(f"{label} week {week}: official results for a matchup don't make sense ({res_a}/{res_b})")
                differs = False
                if res_a == "L":
                    a, b, differs = b, a, True
                elif res_a == "T" and a["points"] != b["points"]:
                    differs = True
                matchups.append({
                    "season": label, "week": week,
                    "winner": roster_manager[a["roster_id"]], "winner_points": a["points"],
                    "loser": roster_manager[b["roster_id"]], "loser_points": b["points"],
                    "tie": res_a == "T",
                    "result_differs_from_score": differs,
                })

        # --- drafts ---
        for draft in load(folder / "drafts.json"):
            picks = load(folder / "drafts" / f"{draft['draft_id']}_picks.json") or []
            if not picks:
                continue
            drafts.append({
                "season": label,
                "kind": "startup" if index == 0 else "rookie",
                "rounds": draft["settings"]["rounds"],
                "picks": [{
                    "round": p["round"], "pick": p["pick_no"],
                    "manager": roster_manager[p["roster_id"]],
                    "player": player(p["player_id"], p.get("metadata")),
                    "position": (p.get("metadata") or {}).get("position"),
                    "nba_team": (p.get("metadata") or {}).get("team") or None,
                } for p in sorted(picks, key=lambda p: p["pick_no"])],
            })

        # --- trades ---
        for file in sorted((folder / "transactions").glob("week_*.json")):
            for t in load(file):
                if t["type"] != "trade" or t["status"] != "complete":
                    continue
                sides = []
                for rid in t["roster_ids"]:
                    sides.append({
                        "manager": roster_manager[rid],
                        "receives_players": sorted(player(pid) for pid, to in (t.get("adds") or {}).items() if to == rid),
                        "receives_picks": [{
                            "draft_year": int(pick["season"]), "round": pick["round"],
                            "original_team": roster_manager[pick["roster_id"]],
                        } for pick in (t.get("draft_picks") or []) if pick["owner_id"] == rid],
                        "receives_faab": sum(b["amount"] for b in (t.get("waiver_budget") or []) if b["receiver"] == rid),
                    })
                when = datetime.fromtimestamp(t["status_updated"] / 1000, tz=timezone.utc)
                trades.append({
                    "id": t["transaction_id"], "season": label, "date": when.strftime("%Y-%m-%d"),
                    "managers": [s["manager"] for s in sides], "sides": sides,
                })

    trades.sort(key=lambda t: (t["date"], t["id"]))

    # A trade sent straight back on the same day (the exact same players, picks and FAAB) was not a
    # real trade, so both halves are dropped everywhere. The owner asked for this on 2026-11-12.
    def holdings(t):
        return {s["manager"]: (tuple(s["receives_players"]),
                               tuple(sorted((p["draft_year"], p["round"], p["original_team"]) for p in s["receives_picks"])),
                               s["receives_faab"]) for s in t["sides"]}

    undone = []
    for i, a in enumerate(trades):
        for b in trades[i + 1:]:
            if b["date"] != a["date"] or len(a["managers"]) != 2 or set(b["managers"]) != set(a["managers"]):
                continue
            if any(t in undone for t in (a, b)):
                continue
            first, second = holdings(a), holdings(b)
            m1, m2 = a["managers"]
            if first[m1] == second[m2] and first[m2] == second[m1]:
                undone += [a, b]
    trades = [t for t in trades if t not in undone]
    for t in undone[::2]:
        got = "; ".join(f"{s['manager']} got {', '.join(s['receives_players']) or 'picks/FAAB only'}" for s in t["sides"])
        print(f"  Not counted (undone the same day): {t['date']} {got}")
    managers = [{
        "id": m["id"], "name": m["name"],
        "sleeper_usernames": m["sleeper_usernames"],
        "aliases": m["aliases"],
        "team_names": team_names[m["id"]],
        "current_team_name": current_team[m["id"]],
        "seasons": seasons_played[m["id"]],
        "championships": [s["season"] for s in seasons if s["champion"] == m["id"]],
    } for m in manager_file]

    claimed = {}
    for m in managers:
        for label in {m["name"], *m["aliases"], *m["sleeper_usernames"], *m["team_names"]}:
            key = "".join(ch for ch in label.lower() if ch.isalnum())
            if claimed.setdefault(key, m["id"]) != m["id"]:
                fail(f"the name '{label}' points to two managers: {claimed[key]} and {m['id']}")

    save("managers", managers)
    save("seasons", seasons)
    save("matchups", matchups)
    save("drafts", drafts)
    save("trades", trades)
    save("players", used_players)

    print(f"Built {len(seasons)} seasons, {len(matchups)} regular-season matchups, "
          f"{sum(len(d['picks']) for d in drafts)} draft picks, {len(trades)} trades, "
          f"{len(used_players)} players, {len(managers)} managers.")
    for s in seasons:
        print(f"  {s['season']}: {s['status']}, champion: {s['champion'] or '-'}")


if __name__ == "__main__":
    main()
