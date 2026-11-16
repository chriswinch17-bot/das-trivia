"""EquipoGPT Analytics: Future Pick Ledger and weekly matchup odds (called by build_analytics.py).

PICK LEDGER: Sleeper's traded_picks.json (current season) lists every future rookie pick that changed
hands; every other pick still belongs to its original team. Years = the next 3 rookie drafts.

MATCHUP ODDS (just for fun, no real money): each team's projected score for a week is
  60% its points per week so far this season + 40% its roster strength (the 10 best players on the
  current roster, by points per week this season), scaled to the league's scoring level.
The chance of winning comes from a normal curve: the projected gap divided by how much weekly scores
swing (the spread of last season's weekly scores around each team's average). Moneylines carry a small
house edge like a real sportsbook; spreads and totals are rounded to half points.
"Season record" re-runs the same model before every finished week using only what was known then.
"""

import math
from statistics import pstdev

PPW_WEIGHT, ROSTER_WEIGHT = 0.6, 0.4
ROSTER_CORE = 10
VIG = 0.0225                 # added to each side's chance, like a sportsbook's cut (about -110 on a coin flip)
MIN_SD = 35.0


def american(p):
    p = min(max(p, 0.02), 0.98)
    line = -100 * p / (1 - p) if p >= 0.5 else 100 * (1 - p) / p
    line = int(round(line / 5) * 5)
    return f"{line:+d}" if line > 0 else str(line)


def half(x):
    return math.floor(x) + 0.5


def phi(z):
    return 0.5 * (1 + math.erf(z / math.sqrt(2)))


def swing(matchups, season):
    """How much a team's weekly score typically moves around its own average (one season)."""
    by_team = {}
    for m in matchups:
        if m["season"] != season:
            continue
        by_team.setdefault(m["winner"], []).append(m["winner_points"])
        by_team.setdefault(m["loser"], []).append(m["loser_points"])
    resid = [x - sum(v) / len(v) for v in by_team.values() if len(v) > 1 for x in v]
    return max(MIN_SD, pstdev(resid)) if len(resid) > 10 else None


def build_odds(ctx):
    """ctx: weeks, week_points, player_weeks, lineup, roster_now, schedule, regular_last, ids, names,
    teams, sd, live (week -> {manager: points})."""
    weeks = ctx["weeks"]
    sd = ctx["sd"]

    def project(upto, rosters):
        done = [w for w in weeks if w <= upto]
        if not done:
            return None
        ppw, core = {}, {}
        for mid in ctx["ids"]:
            pts = [ctx["week_points"][(w, mid)] for w in done if (w, mid) in ctx["week_points"]]
            ppw[mid] = sum(pts) / len(pts)
            avgs = []
            for pid in rosters.get(mid, ()):
                s = [p for w, p in ctx["player_weeks"].get(pid, {}).items() if w <= upto and p]
                if s:
                    avgs.append(sum(s) / len(s))
            core[mid] = sum(sorted(avgs, reverse=True)[:ROSTER_CORE])
        scale = (sum(ppw.values()) / len(ppw)) / ((sum(core.values()) / len(core)) or 1)
        return {mid: PPW_WEIGHT * ppw[mid] + ROSTER_WEIGHT * core[mid] * scale for mid in ctx["ids"]}

    def line(a, b, proj, week):
        pa, pb = proj[a], proj[b]
        p = phi((pa - pb) / (sd * math.sqrt(2)))
        fav, dog = (a, b) if pa >= pb else (b, a)
        gap = abs(pa - pb)
        live = ctx["live"].get(week, {})
        return {
            "a": a, "b": b, "a_name": ctx["names"][a], "b_name": ctx["names"][b],
            "a_team": ctx["teams"].get(a, ctx["names"][a]), "b_team": ctx["teams"].get(b, ctx["names"][b]),
            "a_proj": round(pa), "b_proj": round(pb), "a_prob": round(p * 100, 1),
            "a_ml": american(min(p + VIG, 0.98)), "b_ml": american(min(1 - p + VIG, 0.98)),
            "favorite": fav if gap >= 0.5 else None, "spread": half(gap) if gap >= 0.5 else 0,
            "total": half(pa + pb),
            "a_live": live.get(a), "b_live": live.get(b),
        }

    out = {"sd": round(sd, 1), "weeks": [], "vig": VIG, "league_id": ctx["league_id"],
           "roster_manager": {str(k): v for k, v in ctx["roster_manager"].items()}}
    # the week in progress and the one after, regular season only
    # Sleeper's own "current week" (league.json leg); finished weeks may not be scored yet
    current = max(ctx.get("leg") or 0, (weeks[-1] + 1) if weeks else 1)
    proj = project(weeks[-1], ctx["roster_now"]) if weeks else None
    for w in (current, current + 1):
        if w > ctx["regular_last"] or w not in ctx["schedule"] or not proj:
            continue
        out["weeks"].append({"week": w, "in_progress": w == current and bool(ctx["live"].get(w)),
                             "games": [line(a, b, proj, w) for a, b in ctx["schedule"][w]]})

    # how the model would have done this season, using only what was known before each week
    right = wrong = 0
    history = []
    for w in weeks[1:]:
        p = project(w - 1, {mid: ctx["lineup"].get((w, mid), ()) for mid in ctx["ids"]})
        for a, b in ctx["schedule"].get(w, []):
            if abs(p[a] - p[b]) < 0.5 or (w, a) not in ctx["week_points"]:
                continue
            fav = a if p[a] > p[b] else b
            dog = b if fav == a else a
            won = ctx["results"].get((w, fav))
            if won is None:
                continue
            right += won == "W"
            wrong += won == "L"
            history.append({"week": w, "favorite": fav, "underdog": dog, "won": won == "W",
                            "prob": round(phi(abs(p[a] - p[b]) / (sd * math.sqrt(2))) * 100)})
    out["record"] = {"right": right, "wrong": wrong}
    upsets = sorted((h for h in history if not h["won"]), key=lambda h: -h["prob"])[:3]
    out["upsets"] = [{**u, "favorite_name": ctx["names"][u["favorite"]], "underdog_name": ctx["names"][u["underdog"]]} for u in upsets]
    return out


def build_ledger(traded_picks, roster_manager, ids, names, teams, years, rounds, power_rank):
    owner = {}
    for y in years:
        for r in range(1, rounds + 1):
            for rid, mid in roster_manager.items():
                owner[(y, r, mid)] = mid
    for t in traded_picks:
        y = int(t["season"])
        if y in years and t["round"] <= rounds:
            owner[(y, t["round"], roster_manager[t["roster_id"]])] = roster_manager[t["owner_id"]]
    teams_out = []
    for mid in ids:
        mine = {y: sorted(({"round": r, "from": orig, "own": orig == mid} for (yy, r, orig), o in owner.items()
                           if yy == y and o == mid), key=lambda p: (p["round"], not p["own"], names[p["from"]]))
                for y in years}
        count = [sum(1 for y in years for p in mine[y] if p["round"] == r) for r in range(1, rounds + 1)]
        own_firsts_gone = [y for y in years if owner[(y, 1, mid)] != mid]
        teams_out.append({"manager": mid, "name": names[mid], "team": teams.get(mid, names[mid]),
                          "picks": {str(y): mine[y] for y in years}, "count": count,
                          "capital": sum(c * (rounds + 1 - i) for i, c in enumerate(count)),
                          "own_firsts_gone": own_firsts_gone, "power_rank": power_rank.get(mid)})
    teams_out.sort(key=lambda t: (-t["capital"], -t["count"][0], t["name"]))
    for i, t in enumerate(teams_out, 1):
        t["rank"] = i
    most = max(teams_out, key=lambda t: (t["count"][0], t["capital"]))
    fewest = min(teams_out, key=lambda t: (t["count"][0], t["capital"]))
    return {"years": years, "rounds": rounds, "teams": teams_out,
            "headlines": {"hoarder": most["manager"], "sold": fewest["manager"]},
            "traded": sum(1 for (y, r, orig), o in owner.items() if o != orig)}
