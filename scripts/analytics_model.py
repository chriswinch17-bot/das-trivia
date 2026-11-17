"""EquipoGPT's matchup model, version 2: games this week + injuries, tested on every past matchup.

PROJECTED WEEK for a team =
  for every day of the fantasy week: the (up to) 10 best players on the roster whose NBA team plays that day,
  each worth his fantasy points per game so far this season (early in the season blended with last season),
  skipping players marked Out or on IR (live weeks only; Sleeper keeps no injury history).
That is then blended with the team's actual points per week (how it has really scored), using the mix
that predicted past Das League matchups best.

GAMES: Sleeper's NBA schedule (data/raw/sleeper/<season>/schedule.json) has every game's date, fantasy week
and teams, plus each team's starters. A player's NBA team on a date = the team he last started for (from the
schedule), else Sleeper's current team. Points per game = his weekly fantasy points / his team's games that
week, over the weeks he scored (bench and injured weeks with 0 points are left out).

BACKTEST: every finished regular-season week of every season (from week 2) is predicted using only what was
known before it, and compared with the real result: share of winners picked, and how sharp the odds were.
"""

import json
import math
from bisect import bisect_right
from pathlib import Path

RAW = Path(__file__).resolve().parent.parent / "data" / "raw" / "sleeper"
STARTERS_PER_DAY = 10
PRIOR_GAMES = 8            # early season: last season's per-game average counts like this many games
BLENDS = [i / 10 for i in range(11)]     # weight on the games model (rest = team's actual points per week)
BENCH = 5                                 # bench spots counted for depth
DEPTHS = [0, 0.1, 0.2, 0.3, 0.4, 0.6, 0.8, 1.0, 1.3]   # share of the bench's level that counts (tuned)


def load(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


class Schedule:
    def __init__(self, lg, all_players):
        self.days = {}        # (season, week) -> {date: set(teams)}
        self.games = {}       # (season, week) -> {team: games}
        self.started = {}     # season -> {pid: ([dates], [teams])}
        self.current_team = {pid: (p.get("team") or None) for pid, p in all_players.items()}
        for folder in sorted(p for p in RAW.iterdir() if p.is_dir()):
            f = folder / "schedule.json"
            if not f.exists():
                continue
            year = int(folder.name.split("_")[0])
            label = f"{year}-{year + 1}"
            seen = {}
            for g in load(f):
                key = (label, g.get("week"))
                for side in ("home", "away"):
                    team = (g.get(side) or {}).get("team")
                    if not team:
                        continue
                    self.days.setdefault(key, {}).setdefault(g["date"], set()).add(team)
                    self.games.setdefault(key, {})[team] = self.games.get(key, {}).get(team, 0) + 1
                    for pid in (g.get(side) or {}).get("starters") or []:
                        seen.setdefault(pid, []).append((g["date"], team))
            self.started[label] = {pid: ([d for d, _ in sorted(v)], [t for _, t in sorted(v)]) for pid, v in seen.items()}

    def team(self, season, pid, date):
        s = self.started.get(season, {}).get(pid)
        if s:
            i = bisect_right(s[0], date)
            return s[1][i - 1] if i else s[1][0]
        return self.current_team.get(pid)

    def last_day(self, season, week):
        days = self.days.get((season, week))
        return max(days) if days else None


class GamesModel:
    def __init__(self, lg, all_players):
        self.lg = lg
        self.sched = Schedule(lg, all_players)
        self.index = {key: i for i, key in enumerate(lg.timeline)}

    def player_values(self, season, upto_week, pids, prev_season=None):
        """{pid: his usual weekly score}: the average of his weeks with points this season up to upto_week,
        blended with last season's early on. (In Das League a player's week = one game, so this is a per-game level.)"""
        out = {}
        for pid in pids:
            cur = [self.lg.points[(i, pid)] for (s, w), i in self.index.items()
                   if s == season and w <= upto_week and self.lg.points.get((i, pid))]
            prev = [self.lg.points[(i, pid)] for (s, w), i in self.index.items()
                    if prev_season and s == prev_season and self.lg.points.get((i, pid))]
            prior = sum(prev) / len(prev) if prev else None
            if cur and prior is not None and len(cur) < PRIOR_GAMES * 2:
                out[pid] = (sum(cur) + prior * PRIOR_GAMES) / (len(cur) + PRIOR_GAMES)
            elif cur:
                out[pid] = sum(cur) / len(cur)
            elif prior is not None:
                out[pid] = prior
        return out

    def games(self, season, week, pid):
        day = self.sched.last_day(season, week)
        if not day:
            return 1
        return self.sched.games.get((season, week), {}).get(self.sched.team(season, pid, day), 0)

    def project_parts(self, season, week, roster, values, unavailable=()):
        """(10 best players with a game this week, the next 5 = bench depth). week None = ignore the schedule."""
        ready = sorted((max(0.0, values.get(pid, 0)) for pid in roster
                        if pid not in unavailable and (week is None or self.games(season, week, pid) > 0)), reverse=True)
        return sum(ready[:STARTERS_PER_DAY]), sum(ready[STARTERS_PER_DAY:STARTERS_PER_DAY + BENCH])

    def project_week(self, season, week, roster, values, unavailable=(), depth=0.0):
        """Projected points: the 10 best players who have a game and aren't injured, plus a share of the bench
        (in a lock-in league a bench player with an early game can be swapped in and locked)."""
        top, bench = self.project_parts(season, week, roster, values, unavailable)
        return top + depth * bench


def phi(z):
    return 0.5 * (1 + math.erf(z / math.sqrt(2)))


def backtest(model, matchups, seasons):
    """Predict every finished regular-season game (week 2 on) with what was known before it.
    Returns rows of (season, week, a, b, games_a, games_b, ppw_a, ppw_b, actual_a, actual_b, a_won)."""
    rows = []
    labels = [s["season"] for s in seasons]
    for si, label in enumerate(labels):
        prev = labels[si - 1] if si else None
        games = [m for m in matchups if m["season"] == label]
        weeks = sorted({m["week"] for m in games})
        pts = {}
        for m in games:
            pts[(m["week"], m["winner"])] = m["winner_points"]
            pts[(m["week"], m["loser"])] = m["loser_points"]
        for w in weeks[1:]:
            i = model.index.get((label, w))
            if i is None:
                continue
            ids = {mid for (wk, mid) in pts if wk == w}
            rosters = {mid: model.lg.roster.get((i, mid), set()) for mid in ids}
            values = model.player_values(label, w - 1, set().union(*rosters.values()), prev)
            proj = {mid: model.project_parts(label, w, rosters[mid], values) for mid in ids}
            ppw = {mid: sum(pts[(x, mid)] for x in weeks if x < w and (x, mid) in pts) /
                        max(1, sum(1 for x in weeks if x < w and (x, mid) in pts)) for mid in ids}
            for m in games:
                if m["week"] != w or m["tie"]:
                    continue
                a, b = sorted((m["winner"], m["loser"]))
                rows.append((label, w, a, b, proj[a], proj[b], ppw[a], ppw[b], pts[(w, a)], pts[(w, b)], m["winner"] == a))
    return rows


def tune(rows):
    """Pick the blend, bench share and spread that predicted best (lowest log loss); report how it did.
    rows hold (top 10, bench) for each team, so the bench share can be tried without re-running the history."""
    def scored(k, d):
        diffs = []
        for _, _, _, _, ga, gb, pa, pb, aa, ab, won in rows:
            g = (ga[0] + d * ga[1]) - (gb[0] + d * gb[1])
            diffs.append((k * g + (1 - k) * (pa - pb), won, aa - ab))
        resid = [actual - x for x, _, actual in diffs]
        sd = max(30.0, math.sqrt(sum(r * r for r in resid) / len(resid)))
        loss = 0.0
        for x, won, _ in diffs:
            p = min(max(phi(x / sd), 1e-4), 1 - 1e-4)
            loss -= math.log(p if won else 1 - p)
        right = sum(1 for x, won, _ in diffs if x != 0 and (x > 0) == won)
        picks = sum(1 for x, _, _ in diffs if x != 0)
        return {"blend": k, "depth": d, "sd_diff": sd, "loss": loss / len(diffs), "right": right, "picks": picks, "diffs": diffs}

    results = [scored(k, d) for k in BLENDS for d in DEPTHS]
    best = min(results, key=lambda r: r["loss"])
    no_bench = min((r for r in results if r["depth"] == 0), key=lambda r: r["loss"])
    best["no_bench"] = {"right": no_bench["right"], "picks": no_bench["picks"], "loss": round(no_bench["loss"], 4), "blend": no_bench["blend"]}
    old = [(pa - pb, won) for _, _, _, _, _, _, pa, pb, _, _, won in rows]
    best["old_right"] = sum(1 for d, won in old if d != 0 and (d > 0) == won)
    best["old_picks"] = sum(1 for d, _ in old if d != 0)
    buckets = {}
    for x, won, _ in best["diffs"]:
        p = phi(abs(x) / best["sd_diff"])
        key = "50-60" if p < .6 else "60-70" if p < .7 else "70-80" if p < .8 else "80+"
        b = buckets.setdefault(key, [0, 0])
        b[0] += (x > 0) == won
        b[1] += 1
    best["calibration"] = {k: {"won": v[0], "games": v[1]} for k, v in sorted(buckets.items())}
    best["games"] = len(rows)
    del best["diffs"]
    return best
