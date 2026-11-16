"""EquipoGPT Analytics: this season's power rankings and every team's history, year by year.

Run:  python scripts/build_analytics.py      (also part of the nightly job, scripts/nightly.py)
Writes site/data/analytics.json. Reads only files the other scripts already made:
  site/data/matchups.json, seasons.json, managers.json  and the current season's raw Sleeper
  folder (weekly lineups and every player's weekly points).

POWER SCORE (0-100). Every ingredient is scaled so the league's best team that week = 100 and the
worst = 0, then mixed with these weights:
  record 20%           win percentage
  points 20%           points per week
  all-play 20%         record if you played all 11 other teams every week (takes away schedule luck)
  roster 25%           points per week of the team's 10 best players right now (catches trades/injuries)
  form 15%             points per week over the last 2 weeks
Rankings are worked out after every finished week, so the arrows show the move since last week.
(Lineup efficiency was left out: NBA lineups change daily, so weekly totals can't show a "best lineup".)
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site" / "data"
RAW = ROOT / "data" / "raw" / "sleeper"

WEIGHTS = {"record": 0.20, "points": 0.20, "allplay": 0.20, "roster": 0.25, "form": 0.15}
ROSTER_CORE = 10          # starting lineup size (PG SG G SF PF F C UTIL UTIL UTIL)
FORM_WEEKS = 2
TIERS = [(70, "Contenders", "🏆"), (50, "In the Mix", "⚔️"), (30, "Fading", "🫠"), (-1, "Tank Watch", "🗑️")]


def load(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def scale(values):
    """{key: number} -> {key: 0..100}, best = 100."""
    lo, hi = min(values.values()), max(values.values())
    return {k: 50.0 if hi == lo else (v - lo) / (hi - lo) * 100 for k, v in values.items()}


def record_text(w, l, t=0):
    return f"{w}-{l}" + (f"-{t}" if t else "")


def main():
    managers = {m["id"]: m for m in load(SITE / "managers.json")}
    seasons = load(SITE / "seasons.json")
    matchups = load(SITE / "matchups.json")
    current = seasons[-1]
    label = current["season"]
    team_now = {s["manager"]: s["team_name"] for s in current["standings"]}

    # --- the current season's raw Sleeper folder: who owns which roster, every player's weekly points ---
    folder = sorted(p for p in RAW.iterdir() if p.is_dir())[-1]
    year = load(folder / "league.json")["season"]
    if f"{year}-{int(year) + 1}" != label:
        sys.exit(f"DATA PROBLEM: newest raw folder is {year}, but seasons.json ends with {label}")
    by_username = {u.lower(): m["id"] for m in load(ROOT / "data" / "managers.json")["managers"]
                   for u in m["sleeper_usernames"]}
    users = {u["user_id"]: u["display_name"].lower() for u in load(folder / "users.json")}
    roster_manager = {r["roster_id"]: by_username[users[r["owner_id"]]] for r in load(folder / "rosters.json")}
    all_players = load(RAW / "players_nba.json")

    def player_name(pid):
        info = all_players.get(str(pid)) or {}
        return (info.get("full_name") or f"{info.get('first_name', '')} {info.get('last_name', '')}").replace(" DUPLICATE", "").strip()

    games = [m for m in matchups if m["season"] == label]
    weeks = sorted({m["week"] for m in games})
    week_points, week_result = {}, {}     # (week, manager) -> points / "W" "L" "T", opponent
    for m in games:
        for me, them, pts, res in ((m["winner"], m["loser"], m["winner_points"], "T" if m["tie"] else "W"),
                                   (m["loser"], m["winner"], m["loser_points"], "T" if m["tie"] else "L")):
            week_points[(m["week"], me)] = pts
            week_result[(m["week"], me)] = (res, them)

    lineup, player_weeks = {}, {}         # (week, manager) -> player ids; player id -> {week: points}
    for w in weeks:
        for entry in load(folder / "matchups" / f"week_{w:02d}.json"):
            mid = roster_manager[entry["roster_id"]]
            lineup[(w, mid)] = entry.get("players") or []
            for pid, pts in (entry.get("players_points") or {}).items():
                player_weeks.setdefault(pid, {})[w] = pts

    ids = sorted(managers)

    def standing_after(w):
        """Every team's numbers using weeks 1..w."""
        done = [x for x in weeks if x <= w]
        rows = {}
        for mid in ids:
            res = [week_result[(x, mid)][0] for x in done if (x, mid) in week_result]
            pts = [week_points[(x, mid)] for x in done if (x, mid) in week_points]
            beat = sum(sum(1 if week_points[(x, mid)] > week_points[(x, o)] else 0.5 if week_points[(x, mid)] == week_points[(x, o)] else 0
                           for o in ids if o != mid and (x, o) in week_points) for x in done if (x, mid) in week_points)
            played_all = sum(len([o for o in ids if o != mid and (x, o) in week_points]) for x in done if (x, mid) in week_points)
            avg = {}
            for pid in lineup.get((w, mid), []):
                scores = [p for x, p in player_weeks.get(pid, {}).items() if x <= w and p]
                if scores:
                    avg[pid] = sum(scores) / len(scores)
            core = sorted(avg.items(), key=lambda kv: -kv[1])[:ROSTER_CORE]
            wins, losses, ties = res.count("W"), res.count("L"), res.count("T")
            n = len(res) or 1
            rows[mid] = {
                "wins": wins, "losses": losses, "ties": ties,
                "win_pct": (wins + ties / 2) / n,
                "ppw": sum(pts) / (len(pts) or 1),
                "allplay_w": beat, "allplay_l": played_all - beat,
                "allplay_pct": beat / (played_all or 1),
                "form": sum(pts[-FORM_WEEKS:]) / (len(pts[-FORM_WEEKS:]) or 1),
                "roster": sum(v for _, v in core),
                "top": [{"name": player_name(pid), "avg": round(v, 1)} for pid, v in core[:3]],
                "weekly": pts,
                "luck": (wins + ties / 2) - beat / (played_all or 1) * len(res),
                "opponents": [week_result[(x, mid)][1] for x in done if (x, mid) in week_result],
            }
        parts = {
            "record": scale({k: r["win_pct"] for k, r in rows.items()}),
            "points": scale({k: r["ppw"] for k, r in rows.items()}),
            "allplay": scale({k: r["allplay_pct"] for k, r in rows.items()}),
            "roster": scale({k: r["roster"] for k, r in rows.items()}),
            "form": scale({k: r["form"] for k, r in rows.items()}),
        }
        luck = scale({k: r["luck"] for k, r in rows.items()})
        for k, r in rows.items():
            r["score"] = sum(WEIGHTS[p] * parts[p][k] for p in WEIGHTS)
            r["parts"] = {p: round(parts[p][k]) for p in WEIGHTS}
            r["parts"]["luck"] = round(luck[k])
            r["sos"] = sum(rows[o]["ppw"] for o in r["opponents"]) / (len(r["opponents"]) or 1)
        order = sorted(ids, key=lambda k: (-rows[k]["score"], -rows[k]["ppw"]))
        for i, k in enumerate(order, 1):
            rows[k]["rank"] = i
        return rows, order

    rankings = []
    if weeks:
        now, order = standing_after(weeks[-1])
        before = standing_after(weeks[-2])[0] if len(weeks) > 1 else None
        takes = write_takes(now, order, before)
        for k in order:
            r = now[k]
            tier = next(t for t in TIERS if r["score"] >= t[0])
            rankings.append({
                "rank": r["rank"], "prev_rank": before[k]["rank"] if before else None,
                "manager": k, "name": managers[k]["name"], "team": team_now.get(k, managers[k]["name"]),
                "score": round(r["score"], 1), "tier": tier[1], "tier_icon": tier[2],
                "record": record_text(r["wins"], r["losses"], r["ties"]),
                "allplay": record_text(round(r["allplay_w"]), round(r["allplay_l"])),
                "ppw": round(r["ppw"], 1), "form": round(r["form"], 1), "roster": round(r["roster"], 1),
                "luck": round(r["luck"], 1), "sos": round(r["sos"], 1),
                "weekly": r["weekly"], "parts": r["parts"], "top_players": r["top"], "take": takes[k],
            })

    # --- every team, every season: where they finished, win % and points per week ---
    live = {r["manager"]: r["ppw"] for r in rankings}
    history = []
    for mid in ids:
        points = []
        for s in seasons:
            row = next((t for t in s["standings"] if t["manager"] == mid), None)
            if not row:
                continue
            n = (row["wins"] + row["losses"] + row["ties"]) or 1
            final = s["status"] == "complete"
            points.append({
                "season": s["season"], "team": row["team_name"], "final": final,
                "finish": row["playoff_finish"] if final and row["playoff_finish"] else row["regular_season_rank"],
                "record": record_text(row["wins"], row["losses"], row["ties"]),
                "win_pct": round((row["wins"] + row["ties"] / 2) / n * 100, 1),
                "ppw": round(row["points_for"] / n, 1) if final or not live.get(mid) else live[mid],
                "playoffs": row["made_playoffs"], "champion": s["champion"] == mid,
            })
        history.append({"manager": mid, "name": managers[mid]["name"], "team": team_now.get(mid), "seasons": points})

    out = {
        "season": label, "through_week": weeks[-1] if weeks else 0,
        "weights": WEIGHTS, "teams": len(ids),
        "rankings": rankings,
        "history": {"seasons": [s["season"] for s in seasons], "teams": history},
        "sources": ["site/data/matchups.json", "site/data/seasons.json", f"data/raw/sleeper/{folder.name}/matchups"],
    }
    (SITE / "analytics.json").write_text(json.dumps(out, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote analytics: {label} power rankings through week {out['through_week']}, {len(history)} team histories.")


def ordinal(n):
    return f"{n}{'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


def write_takes(rows, order, before):
    """One or two lines of EquipoGPT commentary per team, every one a true statement from the numbers."""
    facts = {k: [] for k in rows}
    n_games = {k: rows[k]["wins"] + rows[k]["losses"] + rows[k]["ties"] for k in rows}

    def best(key, reverse=True):
        vals = sorted(rows, key=lambda k: rows[k][key], reverse=reverse)
        return vals[0] if rows[vals[0]][key] != rows[vals[1]][key] else None

    top = best("ppw")
    if top:
        facts[top].append((9, f"Scoring {rows[top]['ppw']:.0f} a week, the most in Das League."))
    low = best("ppw", reverse=False)
    if low:
        facts[low].append((7, f"{rows[low]['ppw']:.0f} a week is the lowest scoring in the league. Yikes."))
    lucky = best("luck")
    if lucky and rows[lucky]["luck"] >= 0.75:
        facts[lucky].append((8, f"Luckiest team in the league: about {rows[lucky]['luck']:.1f} more wins than their scoring has earned."))
    robbed = best("luck", reverse=False)
    if robbed and rows[robbed]["luck"] <= -0.75:
        r = rows[robbed]
        facts[robbed].append((8, f"Most robbed team in the league: {r['allplay_w']:.0f}-{r['allplay_l']:.0f} against everyone, "
                                 f"but {record_text(r['wins'], r['losses'], r['ties'])} for real."))
    deep = best("roster")
    if deep:
        facts[deep].append((6, f"Best top 10 in the league: their 10 best players put up {rows[deep]['roster']:.0f} a week."))
    hot = best("form")
    if hot and hot != top:
        facts[hot].append((5, f"Hottest team right now: {rows[hot]['form']:.0f} a week over the last {FORM_WEEKS} weeks."))
    tough = best("sos")
    if tough:
        facts[tough].append((4, f"Toughest schedule so far: opponents average {rows[tough]['sos']:.0f} a week."))
    for k, r in rows.items():
        if n_games[k] >= 2 and r["losses"] == 0 and r["ties"] == 0:
            facts[k].append((10, f"Still unbeaten at {r['wins']}-0."))
        if n_games[k] >= 2 and r["wins"] == 0 and r["ties"] == 0:
            facts[k].append((10, f"Still looking for win #1 at 0-{r['losses']}."))
        if before:
            move = before[k]["rank"] - r["rank"]
            if move >= 3:
                facts[k].append((7, f"Up {move} spots this week. Somebody woke up."))
            elif move <= -3:
                facts[k].append((7, f"Down {-move} spots this week. EquipoGPT is concerned."))
        place = 1 + sum(rows[o]["allplay_pct"] > r["allplay_pct"] for o in rows)
        tied = sum(rows[o]["allplay_pct"] == r["allplay_pct"] for o in rows) > 1
        where = ("last in the league" if place == len(rows)
                 else "the best in the league" if place == 1 else f"{'tied ' if tied else ''}{ordinal(place)} best in the league")
        facts[k].append((2, f"Would be {r['allplay_w']:.0f}-{r['allplay_l']:.0f} playing everyone every week, {where}."))
        if r["top"]:
            p = r["top"][0]
            facts[k].append((1, f"Led by {p['name']} at {p['avg']:.0f} a week."))
    return {k: " ".join(text for _, text in sorted(f, key=lambda x: -x[0])[:2]) for k, f in facts.items()}


if __name__ == "__main__":
    main()
