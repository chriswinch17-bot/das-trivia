"""Trade Report Cards and Manager Profiles for EquipoGPT Analytics (called by build_analytics.py).

THE ONE RULE: a player is worth the fantasy points he scored FOR THE TEAM THAT GOT HIM, counting only the
weeks he was in that team's starting lineup (bench points don't count in a Das League matchup), from the
week he arrived until he left that roster (traded, dropped, or still there today). Sleeper records every
team's roster, starters and every player's points each week (data/raw/sleeper/<season>/matchups), so this
is exact. (Owner's choice, 2026-11-16: only points that actually counted.)
  - Trades: each side gets the points of the players it received. A traded draft pick is worth the
    points of the player taken with it, if the team that got the pick made the selection. A pick that
    was traded on again counts in that later trade instead; a pick for a draft not yet held is pending.
  - Grade: a side's share of all the points in the trade, compared with an even split.
  - Waiver / free-agent pickups: the same rule from the week of the pickup.
  - Draft picks: points for the team that drafted him, compared with the picks made around the same
    spot in the same draft ("value over slot"): big plus = steal, big minus = bust.
"""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw" / "sleeper"
SITE = ROOT / "site" / "data"

EARLY_WEEKS = 4           # a trade younger than this is "too early to grade"
MIN_POINTS = 200          # fewer points than this changed hands in total: too small to grade
SLOT_WINDOW = 6           # picks either side used for the "expected" value of a draft slot
GRADE_STEPS = [(0.35, "A+"), (0.25, "A"), (0.18, "A-"), (0.11, "B+"), (-0.05, "B"),
               (-0.11, "B-"), (-0.18, "C+"), (-0.25, "C"), (-0.35, "D")]
RANK_GRADES = ["A+", "A", "A-", "B+", "B", "B", "B-", "C+", "C", "C-", "D", "F"]   # 12 managers, best to worst


def load(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def grade_of(edge):
    """edge = share of the trade's points minus an even split (e.g. 0.70 - 0.50 = +0.20)."""
    return next((g for cut, g in GRADE_STEPS if edge >= cut), "F")


def ordinal(n):
    return f"{n}{'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


def round_name(r):
    return ordinal(r)


class League:
    """Every finished week of every season: who was on each roster and what every player scored."""

    def __init__(self, managers_file, matchups):
        by_username = {u.lower(): m["id"] for m in managers_file for u in m["sleeper_usernames"]}
        finished = {}
        for m in matchups:
            finished.setdefault(m["season"], set()).add(m["week"])
        self.timeline = []                  # [(season label, week)] in order
        self.roster = {}                    # (index, manager) -> set of player ids
        self.starters = {}                  # (index, manager) -> the ids in that week's starting lineup
        self.points = {}                    # (index, player id) -> points that week
        self.season_start = {}              # season label -> first index
        self.roster_manager = {}            # season label -> {roster id: manager}
        self.drafts = {}                    # draft year -> details + picks
        self.transactions = {}              # season label -> list
        all_players = load(RAW / "players_nba.json")
        self.name = lambda pid: ((all_players.get(str(pid)) or {}).get("full_name") or f"Player {pid}").replace(" DUPLICATE", "").strip()
        for folder in sorted(p for p in RAW.iterdir() if p.is_dir()):
            league = load(folder / "league.json")
            year = int(league["season"])
            label = f"{year}-{year + 1}"
            users = {u["user_id"]: u["display_name"].lower() for u in load(folder / "users.json")}
            rm = {r["roster_id"]: by_username[users[r["owner_id"]]] for r in load(folder / "rosters.json")}
            self.roster_manager[label] = rm
            weeks = sorted(w for w in finished.get(label, set()))
            # playoff weeks have results too (only matchups.json's regular + playoff weeks are listed there),
            # so also include every later week file that has points, for complete seasons
            if league["status"] == "complete":
                for f in sorted((folder / "matchups").glob("week_*.json")):
                    w = int(f.stem.split("_")[1])
                    if w not in weeks and any((e.get("points") or 0) > 0 for e in load(f)):
                        weeks.append(w)
                weeks.sort()
            for w in weeks:
                f = folder / "matchups" / f"week_{w:02d}.json"
                if not f.exists():
                    continue
                i = len(self.timeline)
                self.timeline.append((label, w))
                self.season_start.setdefault(label, i)
                for e in load(f):
                    mid = rm[e["roster_id"]]
                    self.roster[(i, mid)] = set(e.get("players") or [])
                    self.starters[(i, mid)] = set(e.get("starters") or [])
                    for pid, pts in (e.get("players_points") or {}).items():
                        self.points[(i, pid)] = pts or 0
            for details in (folder / "drafts").glob("*_details.json"):
                d = load(details)
                picks = load(details.with_name(details.name.replace("_details", "_picks")))
                if d.get("status") != "complete" or not picks:
                    continue
                self.drafts[int(d["season"])] = {"label": label, "type": "startup" if year == 2023 else "rookie",
                                                 "slot_to_roster": {int(k): v for k, v in d["slot_to_roster_id"].items() if str(k).isdigit() and v},
                                                 "picks": picks, "roster_manager": rm, "rounds": d["settings"]["rounds"]}
            tx = []
            for f in sorted((folder / "transactions").glob("week_*.json")):
                tx.extend(load(f))
            self.transactions[label] = tx
        self.index = {key: i for i, key in enumerate(self.timeline)}

    def start_index(self, label, week):
        """First finished week on or after (season, week); None if none yet."""
        for i, (s, w) in enumerate(self.timeline):
            if (s > label) or (s == label and w >= week):
                return i
        return None

    def stretch(self, manager, pid, start):
        """Points pid scored for manager from start until he left. -> (points, weeks, still there)."""
        if start is None:
            return 0.0, 0, False
        i, last = start, len(self.timeline) - 1
        while i <= min(start + 2, last) and pid not in self.roster.get((i, manager), ()):
            i += 1                           # he may show up a week or two later (trade made after lineups locked)
        if i > last or pid not in self.roster.get((i, manager), ()):
            return 0.0, 0, False
        pts = weeks = 0
        while i <= last and pid in self.roster.get((i, manager), ()):
            if pid in self.starters.get((i, manager), ()):     # only lineup weeks count
                pts += self.points.get((i, pid), 0)
            weeks += 1
            i += 1
        return round(pts, 1), weeks, i > last


def build_trades(lg, trades, team_name, names):
    raw = {t["transaction_id"]: (season, t) for season, txs in lg.transactions.items() for t in txs if t["type"] == "trade"}
    out = []
    for tr in trades:
        season, t = raw[tr["id"]]
        rm = lg.roster_manager[season]
        start = lg.start_index(season, t.get("leg") or 0)
        age = (len(lg.timeline) - start) if start is not None else 0
        sides = []
        for side in tr["sides"]:
            mid = side["manager"]
            rid = next(r for r, m in rm.items() if m == mid)
            players = []
            for pid, to in (t.get("adds") or {}).items():
                if to != rid:
                    continue
                pts, weeks, kept = lg.stretch(mid, pid, start)
                players.append({"name": lg.name(pid), "pts": pts, "weeks": weeks, "kept": kept})
                # never played a week for them: moved on again (traded or dropped) before the next game
            picks = []
            for p in side["receives_picks"]:
                label = f"{p['draft_year']} {round_name(p['round'])} ({names[p['original_team']]})"
                d = lg.drafts.get(p["draft_year"])
                entry = {"label": label, "pts": 0.0, "status": "pending", "player": None}
                if d:
                    slot = next((s for s, r in d["slot_to_roster"].items() if d["roster_manager"][r] == p["original_team"]), None)
                    made = next((x for x in d["picks"] if x["round"] == p["round"] and x["draft_slot"] == slot), None)
                    if made:
                        entry["player"] = lg.name(made["player_id"])
                        if d["roster_manager"][made["roster_id"]] == mid:
                            pts, weeks, kept = lg.stretch(mid, made["player_id"], lg.season_start.get(d["label"]))
                            entry.update(status="drafted", pts=pts, kept=kept)
                        else:
                            entry["status"] = "flipped"
                picks.append(entry)
            total = round(sum(x["pts"] for x in players) + sum(x["pts"] for x in picks), 1)
            sides.append({"manager": mid, "name": names[mid], "team": team_name(season, mid), "players": sorted(players, key=lambda x: -x["pts"]),
                          "picks": picks, "faab": side["receives_faab"], "total": total,
                          "pending": any(x["status"] == "pending" for x in picks)})
        grand = sum(s["total"] for s in sides)
        even = 1 / len(sides)
        status = "graded"
        if any(s["pending"] for s in sides):
            status = "pending"           # future picks can't be judged yet, so no grade until they are drafted
        elif age < EARLY_WEEKS:
            status = "early"
        elif grand < MIN_POINTS:
            status = "minor"
        for s in sides:
            s["share"] = round(s["total"] / grand, 3) if grand else even
            s["edge"] = round(s["share"] - even, 3)
            s["grade"] = grade_of(s["edge"]) if status == "graded" else None
        best = max(sides, key=lambda s: s["total"])
        worst = min(sides, key=lambda s: s["total"])
        margin = round(best["total"] - worst["total"])
        if status == "early":
            take = "Too early to call. EquipoGPT is watching."
        elif status == "pending":
            take = (f"Waiting on future picks. So far {best['name']} leads by {margin:,} points." if margin
                    else "Waiting on future picks. Ungraded until they are drafted.")
        elif status == "minor":
            take = f"Small potatoes: only {round(grand):,} points changed hands."
        elif abs(best["edge"]) < 0.05:
            take = "Dead even. Everybody wins, nobody brags."
        elif best["edge"] >= 0.35:
            take = f"{best['name']} fleeced {worst['name']} by {margin:,} points."
        elif best["edge"] >= 0.18:
            take = f"Clear win for {best['name']}: {margin:,} points better."
        else:
            take = f"Slight edge {best['name']}, by {margin:,} points."
        out.append({"id": tr["id"], "date": tr["date"], "season": season, "status": status, "sides": sides,
                    "margin": margin, "edge": best["edge"], "take": take,
                    "still_open": any(p.get("kept") for s in sides for p in s["players"] + s["picks"]) or any(s["pending"] for s in sides)})
    out.sort(key=lambda x: (x["date"], x["id"]), reverse=True)
    return out


def build_drafts(lg, names):
    """Every pick of every draft with its value for the team that made it, and its value over slot."""
    rows = []
    for year, d in sorted(lg.drafts.items()):
        picks = sorted(d["picks"], key=lambda x: x["pick_no"])
        vals = []
        for x in picks:
            mid = d["roster_manager"][x["roster_id"]]
            pts, weeks, kept = lg.stretch(mid, x["player_id"], lg.season_start.get(d["label"]))
            vals.append({"draft": f"{year} {'startup' if d['type'] == 'startup' else 'rookie'} draft", "year": year,
                         "manager": mid, "pick": f"{x['round']}.{x['draft_slot']:02d}", "overall": x["pick_no"],
                         "player": lg.name(x["player_id"]), "pts": pts, "kept": kept})
        for i, v in enumerate(vals):
            near = [w["pts"] for w in vals[max(0, i - SLOT_WINDOW):i + SLOT_WINDOW + 1] if w is not v]
            v["expected"] = round(sum(near) / len(near), 1) if near else 0
            v["voe"] = round(v["pts"] - v["expected"], 1)
        rows.extend(vals)
    return rows


def build_managers(lg, managers, seasons, trades, drafts, names, history):
    ids = [m["id"] for m in managers]
    # waiver / free-agent pickups
    pickups = {mid: [] for mid in ids}
    for season, txs in lg.transactions.items():
        rm = lg.roster_manager[season]
        for t in txs:
            if t["type"] not in ("waiver", "free_agent") or t["status"] != "complete":
                continue
            for pid, rid in (t.get("adds") or {}).items():
                mid = rm[rid]
                pts, weeks, kept = lg.stretch(mid, pid, lg.start_index(season, t.get("leg") or 0))
                pickups[mid].append({"player": lg.name(pid), "pts": pts, "weeks": weeks, "season": season})

    # draft grade: total value over slot, ranked against the league
    voe = {mid: sum(p["voe"] for p in drafts if p["manager"] == mid) for mid in ids}
    draft_rank = {mid: i for i, mid in enumerate(sorted(ids, key=lambda m: -voe[m]))}
    # trade standing: net points gained in graded trades
    net = {mid: 0.0 for mid in ids}
    rec = {mid: [0, 0, 0] for mid in ids}
    for t in trades:
        if t["status"] != "graded":
            continue
        avg = sum(s["total"] for s in t["sides"]) / len(t["sides"])
        for s in t["sides"]:
            net[s["manager"]] += s["total"] - avg
            rec[s["manager"]][0 if s["edge"] >= 0.05 else 1 if s["edge"] <= -0.05 else 2] += 1
    trade_rank = {mid: i for i, mid in enumerate(sorted(ids, key=lambda m: -net[m]))}

    profiles, board = [], []
    hist = {h["manager"]: h for h in history}
    for m in managers:
        mid = m["id"]
        rows = [(s, next(t for t in s["standings"] if t["manager"] == mid)) for s in seasons if any(t["manager"] == mid for t in s["standings"])]
        w = sum(r["wins"] for _, r in rows)
        l = sum(r["losses"] for _, r in rows)
        ties = sum(r["ties"] for _, r in rows)
        done = [p for p in hist[mid]["seasons"] if p["final"]]
        best_s = min(done, key=lambda p: (p["finish"], -p["win_pct"])) if done else None
        worst_s = max(done, key=lambda p: (p["finish"], -p["win_pct"])) if done else None
        mine = [t for t in trades if any(s["manager"] == mid for s in t["sides"])]
        partners = {}
        for t in mine:
            for s in t["sides"]:
                if s["manager"] != mid:
                    partners[s["manager"]] = partners.get(s["manager"], 0) + 1
        top_partner = max(partners.items(), key=lambda kv: (kv[1], kv[0])) if partners else None
        graded = [(t, next(s for s in t["sides"] if s["manager"] == mid)) for t in mine if t["status"] == "graded"]
        best_t = max(graded, key=lambda ts: ts[1]["edge"] * 1000 + ts[1]["total"] / 1000) if graded else None
        worst_t = min(graded, key=lambda ts: ts[1]["edge"] * 1000 + ts[1]["total"] / 1000) if graded else None

        def trade_ref(ts):
            if not ts:
                return None
            t, s = ts
            other = [o["name"] for o in t["sides"] if o["manager"] != mid]
            got = [p["name"] for p in s["players"]][:2] + [p["label"] for p in s["picks"]][:max(0, 2 - len(s["players"]))]
            return {"id": t["id"], "date": t["date"], "grade": s["grade"], "with": " & ".join(other), "got": got, "pts": s["total"]}

        picks = [p for p in drafts if p["manager"] == mid]
        steal = max(picks, key=lambda p: p["voe"]) if picks else None
        bust = min((p for p in picks if p["overall"] <= 36), key=lambda p: p["voe"], default=None)
        by_draft = []
        for label in sorted({p["draft"] for p in picks}, key=lambda s: int(s[:4])):
            ps = [p for p in picks if p["draft"] == label]
            by_draft.append({"draft": label, "voe": round(sum(p["voe"] for p in ps)),
                             "picks": [{k: p[k] for k in ("pick", "overall", "player", "pts", "voe", "kept")} for p in ps]})
        best_pick = max(pickups[mid], key=lambda p: p["pts"], default=None)
        titles = [s["season"] for s, _ in rows if s["champion"] == mid]
        runner = [s["season"] for s, _ in rows if s["runner_up"] == mid]
        playoffs = sum(1 for _, r in rows if r["made_playoffs"])
        team_names = []
        for _, r in rows:
            if r["team_name"] not in team_names:
                team_names.append(r["team_name"])
        r_, wl = rec[mid], f"{rec[mid][0]}-{rec[mid][1]}" + (f"-{rec[mid][2]}" if rec[mid][2] else "")

        # EquipoGPT's one-liner: the most notable true thing about this manager
        lines = []
        if titles:
            lines.append(f"{len(titles)}x champion ({', '.join(titles)}).")
        if trade_rank[mid] == 0:
            lines.append("Best trader in Das League by points gained.")
        elif trade_rank[mid] == len(ids) - 1:
            lines.append("Has lost the most points through trades in Das League. Maybe stop answering the phone.")
        if draft_rank[mid] == 0:
            lines.append("Best drafter in the league.")
        elif draft_rank[mid] == len(ids) - 1:
            lines.append("The league's worst draft record so far.")
        if len(mine) == max(sum(1 for t in trades if any(s["manager"] == o for s in t["sides"])) for o in ids):
            lines.append(f"Most trades in the league ({len(mine)}). Can't stop, won't stop.")
        if runner and not titles:
            lines.append(f"Lost the final in {', '.join(runner)}. So close.")
        if draft_rank[mid] in (1, 2):
            lines.append(f"{ordinal(draft_rank[mid] + 1)} best drafter in the league.")
        if trade_rank[mid] in (1, 2):
            lines.append(f"{ordinal(trade_rank[mid] + 1)} best trader by points gained ({wl} in graded trades).")
        if best_pick and best_pick["pts"] == max((p["pts"] for o in ids for p in pickups[o]), default=0):
            lines.append(f"Best waiver pickup in league history: {best_pick['player']}, {best_pick['pts']:,.0f} points.")
        if playoffs == 0 and len(rows) > 1:
            lines.append(f"Still waiting on a first playoff trip, {w}-{l} all time.")
        if not lines:
            lines.append(f"{w}-{l} all time with {playoffs} playoff trip{'s' if playoffs != 1 else ''}.")

        profiles.append({
            "manager": mid, "name": m["name"], "team": hist[mid]["team"], "team_names": team_names,
            "record": f"{w}-{l}" + (f"-{ties}" if ties else ""), "win_pct": round((w + ties / 2) / ((w + l + ties) or 1) * 100, 1),
            "titles": titles, "runner_ups": runner, "playoffs": playoffs, "seasons_played": len(rows),
            "best_season": best_s, "worst_season": worst_s, "seasons": hist[mid]["seasons"],
            "trades": {"count": len(mine), "record": wl, "net": round(net[mid]), "rank": trade_rank[mid] + 1,
                       "partner": {"name": names[top_partner[0]], "count": top_partner[1]} if top_partner else None,
                       "best": trade_ref(best_t), "worst": trade_ref(worst_t) if worst_t and worst_t != best_t else None},
            "waivers": {"count": len(pickups[mid]), "best": best_pick},
            "drafts": {"grade": RANK_GRADES[draft_rank[mid]], "rank": draft_rank[mid] + 1, "voe": round(voe[mid]),
                       "steal": steal, "bust": bust, "by_draft": by_draft},
            "take": " ".join(lines[:2]),
        })
        board.append({"manager": mid, "name": m["name"], "trades": len(mine), "record": wl, "net": round(net[mid]),
                      "rank": trade_rank[mid] + 1})
    board.sort(key=lambda b: b["rank"])
    return profiles, board


def build(managers_file, seasons, matchups, trades, history, team_name):
    lg = League(managers_file, matchups)
    names = {m["id"]: m["name"] for m in managers_file}
    graded = build_trades(lg, trades, team_name, names)
    drafts = build_drafts(lg, names)
    profiles, board = build_managers(lg, managers_file, seasons, graded, drafts, names, history)
    rivalries = build_rivalries(matchups, seasons, managers_file)
    return graded, board, profiles, rivalries, lg


def build_rivalries(matchups, seasons, managers):
    """Every head-to-head pair: official results (regular season), playoff meetings, streaks, blowouts.
    The six games Sleeper flags as "result differs from score" (stat corrections) count for the record but
    are left out of blowout / closest-game picks, as the owner asked for score-based facts."""
    names = {m["id"]: m["name"] for m in managers}
    ids = sorted(names, key=lambda m: names[m])
    order = {s["season"]: i for i, s in enumerate(seasons)}
    pairs = {}

    def pair(a, b):
        key = "|".join(sorted((a, b)))
        if key not in pairs:
            x, y = sorted((a, b))
            pairs[key] = {"a": x, "b": y, "games": [], "playoffs": []}
        return pairs[key]

    for m in sorted(matchups, key=lambda g: (order[g["season"]], g["week"])):
        p = pair(m["winner"], m["loser"])
        pts = {m["winner"]: m["winner_points"], m["loser"]: m["loser_points"]}
        p["games"].append({"season": m["season"], "week": m["week"], "a_pts": pts[p["a"]], "b_pts": pts[p["b"]],
                           "winner": None if m["tie"] else m["winner"], "flagged": m["result_differs_from_score"]})
    for s in seasons:
        for g in s.get("playoffs") or []:
            if not g.get("winner") or not g.get("loser"):
                continue
            p = pair(g["winner"], g["loser"])
            p["playoffs"].append({"season": s["season"], "round": g["round"], "winner": g["winner"],
                                  "winner_points": g["winner_points"], "loser_points": g["loser_points"]})

    out = []
    for key, p in pairs.items():
        a, b, games = p["a"], p["b"], p["games"]
        aw = sum(1 for g in games if g["winner"] == a) + sum(1 for g in p["playoffs"] if g["winner"] == a)
        bw = sum(1 for g in games if g["winner"] == b) + sum(1 for g in p["playoffs"] if g["winner"] == b)
        ties = sum(1 for g in games if g["winner"] is None)
        # current streak, regular season and playoffs in date order (playoffs come after that season's weeks)
        timeline = [(order[g["season"]], g["week"], g["winner"]) for g in games] + \
                   [(order[g["season"]], 99, g["winner"]) for g in p["playoffs"]]
        timeline.sort()
        streak_who, streak = None, 0
        for _, _, w in reversed(timeline):
            if w is None or (streak_who and w != streak_who):
                break
            streak_who, streak = w, streak + 1
        scored = [g for g in games if not g["flagged"]]
        blow = max(scored, key=lambda g: abs(g["a_pts"] - g["b_pts"]), default=None)
        close = min((g for g in scored if g["winner"]), key=lambda g: abs(g["a_pts"] - g["b_pts"]), default=None)
        n = len(games) or 1
        out.append({
            "key": key, "a": a, "b": b, "a_wins": aw, "b_wins": bw, "ties": ties,
            "a_ppg": round(sum(g["a_pts"] for g in games) / n, 1), "b_ppg": round(sum(g["b_pts"] for g in games) / n, 1),
            "streak": {"who": streak_who, "n": streak} if streak_who else None,
            "blowout": blow, "closest": close, "games": games, "playoffs": p["playoffs"],
        })

    # nemesis / victim for every manager (at least 3 meetings)
    def record_vs(me, them):
        r = next(x for x in out if {x["a"], x["b"]} == {me, them})
        w, l = (r["a_wins"], r["b_wins"]) if r["a"] == me else (r["b_wins"], r["a_wins"])
        return w, l, r["ties"]

    people = []
    for me in ids:
        rows = []
        for them in ids:
            if them == me or not any({x["a"], x["b"]} == {me, them} for x in out):
                continue
            w, l, t = record_vs(me, them)
            if w + l + t >= 3:
                rows.append({"vs": them, "w": w, "l": l, "t": t, "pct": (w + t / 2) / (w + l + t)})
        if not rows:
            continue
        nem = min(rows, key=lambda r: (r["pct"], -r["l"]))
        vic = max(rows, key=lambda r: (r["pct"], r["w"]))
        people.append({"manager": me, "nemesis": {k: nem[k] for k in ("vs", "w", "l", "t")},
                       "victim": {k: vic[k] for k in ("vs", "w", "l", "t")}})

    lopsided = max(out, key=lambda r: (abs(r["a_wins"] - r["b_wins"]), r["a_wins"] + r["b_wins"]))
    played = [r for r in out if r["a_wins"] + r["b_wins"] + r["ties"] >= 4]
    even = min(played or out, key=lambda r: (abs(r["a_wins"] - r["b_wins"]), -(r["a_wins"] + r["b_wins"] + r["ties"])))
    blowouts = [(r, r["blowout"]) for r in out if r["blowout"]]
    biggest = max(blowouts, key=lambda rb: abs(rb[1]["a_pts"] - rb[1]["b_pts"]))
    return {"managers": ids, "names": names, "pairs": sorted(out, key=lambda r: r["key"]), "people": people,
            "headlines": {"lopsided": lopsided["key"], "even": even["key"], "blowout": biggest[0]["key"]}}
