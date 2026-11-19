"""Write the trivia questions, computing every answer from the league data.

Usage:
    python scripts/build_questions.py      (run build_data.py first)

Reads   site/data/*.json  (made by build_data.py)
Writes  site/data/game.json

Each question is a template whose answers are looked up in the data, so no answer
is ever typed in by hand. To add a new kind of question, add a block in main().
"""

import hashlib
import json
import random
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from daily import fill_missing, today_number  # noqa: E402
from nicknames import load_nicknames  # noqa: E402

DATA = Path(__file__).resolve().parent.parent / "site" / "data"
START_DATE = "2026-11-09"      # the day Game #1 falls on. Moved back a day on 2026-11-11 at the owner's
                               # request, and a second time later the same day, so 2026-11-11 ended on Game #3.
QUESTIONS_PER_DAY = 7
NAME_SUFFIXES = {"jr", "jr.", "sr", "sr.", "ii", "iii", "iv"}


AHEAD_DAYS = 21                 # days scheduled after today
MIN_PLAYS_FOR_DIFFICULTY = 4    # answers needed before real results decide a question's difficulty


def played_difficulty():
    """{question text: (right, attempts)} from the shared leaderboard's saved answers (Das Trivia only).
    Uses the public read key in site/js/config.js; returns {} if the leaderboard can't be reached."""
    import re
    import urllib.request
    cfg = (DATA.parent / "js" / "config.js").read_text(encoding="utf-8")
    url = re.search(r'supabaseUrl:\s*"([^"]+)"', cfg)
    key = re.search(r'supabaseKey:\s*"([^"]+)"', cfg)
    if not url or not key:
        return {}
    rates = {}
    try:
        req = urllib.request.Request(f"{url.group(1)}/rest/v1/scores?game=lt.50000&select=answers&limit=5000",
                                     headers={"apikey": key.group(1), "Authorization": f"Bearer {key.group(1)}"})
        with urllib.request.urlopen(req, timeout=20) as r:
            rows = json.loads(r.read().decode("utf-8"))
    except Exception as error:      # offline: keep the guesses
        print(f"  (difficulty: leaderboard not reachable, using guesses: {error})")
        return {}
    for row in rows:
        for a in row.get("answers") or []:
            q = a.get("q")
            if not q:
                continue
            right, total = rates.get(q, (0, 0))
            rates[q] = (right + (a.get("r") == "correct"), total + 1)
    return rates


def load(name):
    return json.loads((DATA / f"{name}.json").read_text(encoding="utf-8"))


def main():
    managers = {m["id"]: m for m in load("managers")}
    seasons, drafts, trades, matchups = load("seasons"), load("drafts"), load("trades"), load("matchups")
    players = load("players")
    done = [s for s in seasons if s["status"] == "complete"]
    team = {(s["season"], r["manager"]): r["team_name"] for s in seasons for r in s["standings"]}

    first_names = Counter(p["name"].split()[0].lower() for p in players.values())

    def show(mid, season=None):
        """Team name followed by the manager's real name, e.g. 'Equipo Winchenzo (Winch)'."""
        name = team[(season, mid)] if season else managers[mid]["current_team_name"]
        return f"{name} ({managers[mid]['name']})"

    # ---------- one-sentence facts shown under the answer, all worked out from the data ----------
    def ordinal(n):
        return f"{n}{'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"

    def plural(n, word):
        return f"{n} {word}" if n == 1 else f"{n} {word}s"

    def nice_date(iso):
        d = datetime.strptime(iso, "%Y-%m-%d")
        return f"{d.strftime('%B')} {d.day}, {d.year}"

    row_of = {(s["season"], r["manager"]): r for s in seasons for r in s["standings"]}
    season_of = {s["season"]: s for s in seasons}
    traded = Counter(name for t in trades for side in t["sides"] for name in side["receives_players"])
    trade_count = Counter(m for t in trades for m in t["managers"])
    drafted = {}
    for d in drafts:
        for p in d["picks"]:
            drafted.setdefault(p["player"], (d, p))

    def season_fact(mid, y):
        r = row_of[(y, mid)]
        record = f"{r['wins']}-{r['losses']}" + (f"-{r['ties']}" if r["ties"] else "")
        base = (f"{managers[mid]['name']} went {record} in the {y} regular season "
                f"({ordinal(r['regular_season_rank'])} of {len(season_of[y]['standings'])}) with {r['points_for']:,.0f} points")
        if season_of[y]["status"] != "complete":
            return base + " so far."
        if not r["made_playoffs"]:
            return base + " and missed the playoffs."
        ending = {1: "won the championship", 2: "lost in the final", 3: "finished third",
                  4: "finished fourth"}.get(r["playoff_finish"], "lost in the first round of the playoffs")
        return f"{base}, then {ending}."

    def career_fact(mid):
        rows = [row_of[(s["season"], mid)] for s in done]
        wins, losses = sum(r["wins"] for r in rows), sum(r["losses"] for r in rows)
        return (f"Through {done[-1]['season']}, {managers[mid]['name']} is {wins}-{losses} in the regular season with "
                f"{plural(sum(1 for r in rows if r['made_playoffs']), 'playoff trip')} and "
                f"{plural(len(managers[mid]['championships']), 'title')}. "
                f"{managers[mid]['name']} has made {plural(trade_count[mid], 'trade')} in all.")

    def player_fact(name):
        parts = []
        if name in drafted:
            d, p = drafted[name]
            parts.append(f"Taken {ordinal(p['pick'])} overall by {show(p['manager'], d['season'])} "
                         f"in the {d['season'][:4]} {d['kind']} draft.")
        if traded[name]:
            parts.append(f"Traded {plural(traded[name], 'time')} in Das League.")
        elif parts:
            parts.append("Never traded in Das League.")
        return " ".join(parts)

    def manager_answer(mid, season=None):
        m = managers[mid]
        accept = {m["name"], *m["aliases"], *m["sleeper_usernames"], *m["team_names"]}
        return {"display": show(mid, season), "accept": sorted(accept), "manager": mid,
                "detail": season_fact(mid, season) if season else career_fact(mid)}

    nicknames = load_nicknames({p["name"] for p in players.values()})

    def player_answer(name):
        parts = name.split()
        while len(parts) > 1 and parts[-1].lower() in NAME_SUFFIXES:
            parts.pop()
        accept = {name, " ".join(parts)}
        if len(parts) > 1:
            accept.add(parts[-1])                       # last name alone counts
            accept.add(parts[0])                        # so does first name alone (owner wants lenient matching)
            for piece in parts[-1].split("-"):          # and either half of a double-barrelled last name
                if len(piece) >= 4:
                    accept.add(piece)
        accept.update(nicknames.get(name, []))          # e.g. "Wemby" (data/player_nicknames.json)
        return {"display": name, "accept": sorted(accept), "detail": player_fact(name)}

    groups = defaultdict(list)

    def guess_difficulty(group, kind, answers):
        """A first guess from the question's shape; replaced by how league members actually did once enough
        people have played it (see played_difficulty)."""
        if kind == "number":
            return "hard" if group == "trades" else "medium"
        if kind == "manager":                       # 12 managers: always a fair shot
            return "easy" if len(answers) >= 3 else "medium"
        if len(answers) >= 5:
            return "easy"
        return "medium" if len(answers) >= 2 else "hard"

    def ask(group, text, kind, answers, sources, note=None):
        answers = list(answers)
        if not answers:
            return
        # which managers the question or its note mentions, so the site can show that manager's pictures
        mentioned = f"{text} {note or ''} {answers[0].get('detail', '') if len(answers) == 1 else ''}"
        about = [mid for mid, m in managers.items() if f"({m['name']})" in mentioned]
        groups[group].append({
            "id": hashlib.md5(text.encode("utf-8")).hexdigest()[:8],
            "text": text, "kind": kind, "answers": answers, "note": note, "about": about, "sources": sources,
            "group": group, "difficulty": guess_difficulty(group, kind, answers),
        })

    def managers_q(group, text, ids, sources, season=None, note=None):
        ask(group, text, "manager", [manager_answer(i, season) for i in ids], sources, note)

    def players_q(group, text, names, sources, note=None, detail=None):
        answers = [player_answer(n) for n in sorted(set(names))]
        if detail:                      # a fact specific to this question instead of the general one
            for a in answers:
                a["detail"] = detail(a["display"])
        ask(group, text, "player", answers, sources, note)

    # ---------- championships and playoffs ----------
    S = ["seasons.json"]
    managers_q("titles", "Name a manager who has won a Das League championship.",
               sorted({s["champion"] for s in done}), S)
    finalists = sorted({s[k] for s in done for k in ("champion", "runner_up")})
    managers_q("titles", "Name a manager who has played in a championship final.", finalists, S)
    managers_q("titles", "Name a manager who has lost a championship final.",
               sorted({s["runner_up"] for s in done}), S)
    playoff_count = Counter(r["manager"] for s in done for r in s["standings"] if r["made_playoffs"])
    managers_q("titles", "Name a manager who has made the playoffs in every completed season.",
               [m for m in managers if playoff_count[m] == len(done)], S)
    managers_q("titles", "Name a manager who has never made the playoffs.",
               [m for m in managers if playoff_count[m] == 0], S,
               note=f"Through {done[-1]['season']}.")
    managers_q("titles", "Name a manager who has reached the playoffs but never played in a final.",
               [m for m in managers if playoff_count[m] and m not in finalists], S)

    for s in done:
        y, rows = s["season"], s["standings"]
        managers_q("titles", f"Who won the {y} championship?", [s["champion"]], S, y)
        managers_q("titles", f"Who lost in the {y} championship final?", [s["runner_up"]], S, y)
        managers_q("titles", f"Name a team that made the {y} playoffs.",
                   [r["manager"] for r in rows if r["made_playoffs"]], S, y)
        managers_q("titles", f"Name a team that missed the {y} playoffs.",
                   [r["manager"] for r in rows if not r["made_playoffs"]], S, y)
        semis = [g["loser"] for g in s["playoffs"] if g["round"] == "Semifinal"]
        managers_q("titles", f"Name a team that lost in the {y} semifinals.", semis, S, y)

        # ---------- regular-season standings ----------
        top = rows[0]
        managers_q("standings", f"Who finished with the best regular-season record in {y}?", [top["manager"]], S, y)
        last = rows[-1]
        managers_q("standings", f"Who finished last in the {y} regular season?", [last["manager"]], S, y)
        by_points = sorted(rows, key=lambda r: -r["points_for"])
        managers_q("standings", f"Name one of the three highest-scoring teams of the {y} regular season.",
                   [r["manager"] for r in by_points if r["points_for"] >= by_points[2]["points_for"]], S, y)
        managers_q("standings", f"Who scored the fewest points in the {y} regular season?",
                   [r["manager"] for r in by_points if r["points_for"] == by_points[-1]["points_for"]], S, y)
        managers_q("standings", f"Name a team that finished the {y} regular season with a winning record.",
                   [r["manager"] for r in rows if r["wins"] > r["losses"]], S, y)
        champ = next(r for r in rows if r["manager"] == s["champion"])
        ask("standings", f"How many regular-season wins did the {y} champion, {show(s['champion'], y)}, have?",
            "number", [{"display": str(champ["wins"]), "accept": [str(champ["wins"])],
                        "detail": season_fact(s["champion"], y)}], S)

        # highest single-week score (games whose official result disagrees with the score are left out)
        games = [g for g in matchups if g["season"] == y]
        clean = [(g[f"{side}_points"], g[side], g["week"]) for g in games if not g["result_differs_from_score"]
                 for side in ("winner", "loser")]
        flagged_best = max((max(g["winner_points"], g["loser_points"]) for g in games if g["result_differs_from_score"]), default=0)
        best = max(p for p, _, _ in clean)
        if best > flagged_best:
            holders = [(m, w) for p, m, w in clean if p == best]
            managers_q("standings", f"Which team posted the highest single-week score of the {y} regular season?",
                       sorted({m for m, _ in holders}), ["matchups.json"], y,
                       note=f"{best:g} points in week {holders[0][1]}.")

    # ---------- drafts ----------
    DR = ["drafts.json"]
    for d in drafts:
        y, picks = d["season"], d["picks"]
        if d["kind"] == "startup":
            title = f"{y[:4]} startup draft"
            players_q("drafts", f"Name a player taken in the first round of the {title}.",
                      [p["player"] for p in picks if p["round"] == 1], DR)
            players_q("drafts", f"Name a player taken in the second round of the {title}.",
                      [p["player"] for p in picks if p["round"] == 2], DR)
            players_q("drafts", f"Who was the first overall pick of the {title}?", [picks[0]["player"]], DR)
            managers_q("drafts", f"Who made the first overall pick of the {title}?", [picks[0]["manager"]], DR, y,
                       note=f"The pick was {picks[0]['player']}.")
            for mid in managers:
                mine = [p for p in picks if p["manager"] == mid]
                if not mine:
                    continue
                players_q("startup", f"Who did {show(mid, y)} take with their first pick of the {title}?",
                          [mine[0]["player"]], DR)
                players_q("startup", f"Name one of the first five players {show(mid, y)} took in the {title}.",
                          [p["player"] for p in mine[:5]], DR)
        else:
            title = f"{y[:4]} rookie draft"
            players_q("drafts", f"Who was the first overall pick of the {title}?", [picks[0]["player"]], DR)
            managers_q("drafts", f"Who made the first overall pick of the {title}?", [picks[0]["manager"]], DR, y,
                       note=f"The pick was {picks[0]['player']}.")
            players_q("drafts", f"Name a top-five pick of the {title}.", [p["player"] for p in picks[:5]], DR)
            players_q("drafts", f"Name a first-round pick of the {title}.",
                      [p["player"] for p in picks if p["round"] == 1], DR)

    # ---------- trades ----------
    TR = ["trades.json"]
    most = max(traded.values())
    players_q("trades", "Which player has been traded the most times in Das League history?",
              [n for n, c in traded.items() if c == most], TR)
    often = next(n for n in range(2, most + 1) if sum(c >= n for c in traded.values()) <= 15)
    players_q("trades", f"Name a player who has been traded at least {often} times in Das League.",
              [n for n, c in traded.items() if c >= often], TR)
    all_time = Counter(m for t in trades for m in t["managers"])
    ranked = sorted(all_time.values(), reverse=True)
    managers_q("trades", "Name one of the three managers with the most trades in Das League history.",
               [m for m, c in all_time.items() if c >= ranked[2]], TR)
    fewest = min(all_time[m] for m in managers)
    managers_q("trades", "Which manager has made the fewest trades in Das League history?",
               [m for m in managers if all_time[m] == fewest], TR, note=f"{fewest} trades.")
    for s in done:
        y = s["season"]
        per = Counter(m for t in trades if t["season"] == y for m in t["managers"])
        if per:
            top = max(per.values())
            managers_q("trades", f"Which manager made the most trades during the {y} season?",
                       [m for m, c in per.items() if c == top], TR, y, note=f"{top} trades.")
    for mid in managers:
        got = defaultdict(list)
        for t in trades:
            for side in t["sides"]:
                if side["manager"] == mid:
                    for n in side["receives_players"]:
                        got[n].append(t)

        def how(n, mid=mid, got=got):
            first = got[n][0]
            others = " and ".join(managers[m]["name"] for m in first["managers"] if m != mid)
            text = f"{managers[mid]['name']} got {n} in a trade with {others} on {nice_date(first['date'])}."
            if len(got[n]) > 1:
                text += f" {managers[mid]['name']} has traded for {n} {len(got[n])} times in all."
            return text

        players_q("trades", f"Name a player {show(mid)} has acquired in a trade.", got, TR, detail=how)

    # ---------- fun and random ----------
    M = ["matchups.json"]

    def key(name):
        return "".join(ch for ch in name.lower() if ch.isalnum())

    for mid, m in managers.items():
        now = key(m["current_team_name"])
        for old in m["team_names"]:
            if key(old) == now or key(old)[:5] == now[:5]:
                continue                                  # skip names that barely changed
            first = next(s["season"] for s in seasons if team[(s["season"], mid)] == old)
            ask("fun", f"Whose team was once called \"{old}\"?", "manager", [manager_answer(mid)],
                ["managers.json"], note=f"That was the name in {first}.")

    for s in done:
        y = s["season"]
        season_games = [g for g in matchups if g["season"] == y]
        flagged = [g for g in season_games if g["result_differs_from_score"]]
        games = [g for g in season_games if not g["result_differs_from_score"] and not g["tie"]]
        margin = lambda g: round(g["winner_points"] - g["loser_points"], 2)

        scores = [(g[f"{side}_points"], g[side], g["week"]) for g in games for side in ("winner", "loser")]
        low = min(p for p, _, _ in scores)
        if all(min(g["winner_points"], g["loser_points"]) > low for g in flagged):
            holders = [(m, w) for p, m, w in scores if p == low]
            managers_q("fun", f"Which team put up the lowest single-week score of the {y} regular season?",
                       sorted({m for m, _ in holders}), M, y, note=f"Just {low:g} points in week {holders[0][1]}.")

        worst = max(margin(g) for g in games)
        hits = [g for g in games if margin(g) == worst]
        managers_q("fun", f"Which team was on the wrong end of the biggest blowout of the {y} regular season?",
                   sorted({g["loser"] for g in hits}), M, y,
                   note=f"Lost {hits[0]['loser_points']:g}-{hits[0]['winner_points']:g} to {show(hits[0]['winner'], y)} in week {hits[0]['week']}.")

        tight = min(margin(g) for g in games)
        if all(abs(margin(g)) > tight for g in flagged):
            hits = [g for g in games if margin(g) == tight]
            managers_q("fun", f"Which team lost the closest game of the {y} regular season?",
                       sorted({g["loser"] for g in hits}), M, y,
                       note=(f"Lost by {tight:g} to {show(hits[0]['winner'], y)} in week {hits[0]['week']}." if len(hits) == 1
                             else f"{len(hits)} games that season were decided by {tight:g}."))

        most = max(g["loser_points"] for g in games)
        if all(max(g["winner_points"], g["loser_points"]) < most for g in flagged):
            hits = [g for g in games if g["loser_points"] == most]
            managers_q("fun", f"Which team scored the most points in a loss during the {y} regular season?",
                       sorted({g["loser"] for g in hits}), M, y,
                       note=f"{most:g} points in week {hits[0]['week']}, and still lost to {show(hits[0]['winner'], y)}.")

    for losing in (True, False):
        streaks = []
        for s in done:
            for mid in managers:
                run = 0
                mine = sorted((g for g in matchups if g["season"] == s["season"] and mid in (g["winner"], g["loser"])),
                              key=lambda g: g["week"])
                for g in mine:
                    hit = (not g["tie"]) and g["loser" if losing else "winner"] == mid
                    run = run + 1 if hit else 0
                    streaks.append((run, mid, s["season"]))
        top = max(r for r, _, _ in streaks)
        owners = [(m, y) for r, m, y in streaks if r == top]
        word = "losing" if losing else "winning"
        managers_q("fun", f"Which manager owns the longest single-season {word} streak in Das League history?",
                   sorted({m for m, _ in owners}), M,
                   note=f"{top} straight {'losses' if losing else 'wins'}"
                        + (f" in {owners[0][1]}" if len({y for _, y in owners}) == 1 else "") + " (regular season).")

    startup = next(d for d in drafts if d["kind"] == "startup")
    final_pick = startup["picks"][-1]
    players_q("fun", f"Who was the very last pick of the {startup['season'][:4]} startup draft?", [final_pick["player"]], DR,
              note=f"Pick {final_pick['pick']}, taken by {show(final_pick['manager'], startup['season'])}.")

    ties = [g for g in matchups if g["tie"]]
    if len(ties) == 1:
        g = ties[0]
        managers_q("fun", "Only one regular-season game in Das League history has ended in a tie. Name either manager involved.",
                   [g["winner"], g["loser"]], M, g["season"],
                   note=f"{g['winner_points']:g}-{g['loser_points']:g} in week {g['week']} of {g['season']}.")

    repeat = Counter((side["manager"], name) for t in trades for side in t["sides"] for name in side["receives_players"])
    top = max(repeat.values())
    if top >= 2:
        by_player = defaultdict(list)
        for (mid, name), count in repeat.items():
            if count == top:
                by_player[name].append(mid)
        for name, mids in sorted(by_player.items())[:3]:
            managers_q("fun", f"Which manager has traded for {name} {top} separate times?", mids, TR)

    # ---------- more questions (owner asked for many more, 2026-11-19) ----------
    # drafts: who drafted whom, and where
    startup_d = next(d for d in drafts if d["kind"] == "startup")
    sy = startup_d["season"]
    for p in startup_d["picks"][:48]:
        managers_q("startup", f"Which manager drafted {p['player']} in the {sy[:4]} startup draft?", [p["manager"]], DR, sy,
                   note=f"Round {p['round']}, pick {p['pick']} overall.")
    # rounds for players the league knows best (traded the most), from round 2 on
    familiar = sorted((p for p in startup_d["picks"] if p["round"] >= 2 and traded[p["player"]] >= 2),
                      key=lambda p: (-traded[p["player"]], p["pick"]))[:20]
    for p in familiar:
        ask("drafts", f"In which round of the {sy[:4]} startup draft was {p['player']} taken?", "number",
            [{"display": str(p["round"]), "accept": [str(p["round"])],
              "detail": f"Pick {p['pick']} overall, by {show(p['manager'], sy)}."}], DR)
    for d in drafts:
        if d["kind"] != "rookie":
            continue
        y, picks = d["season"], d["picks"]
        title = f"{y[:4]} rookie draft"
        for p in picks[1:6]:
            players_q("drafts", f"Who was pick {p['pick']} of the {title}?", [p["player"]], DR,
                      note=f"Taken by {show(p['manager'], y)}.")
        for p in picks[:12]:
            managers_q("drafts", f"Which manager drafted {p['player']} in the {title}?", [p["manager"]], DR, y,
                       note=f"Pick {p['pick']} overall.")
        players_q("drafts", f"Name a second-round pick of the {title}.", [p["player"] for p in picks if p["round"] == 2], DR)

    # standings: every team's wins, 2nd and 3rd place, 3rd place in the playoffs, points against
    for s in done:
        y, rows = s["season"], s["standings"]
        for r in rows:
            ask("standings", f"How many regular-season wins did {show(r['manager'], y)} have in {y}?", "number",
                [{"display": str(r["wins"]), "accept": [str(r["wins"])], "manager": r["manager"],
                  "detail": season_fact(r["manager"], y)}], S)
        for place, word in ((2, "second"), (3, "third")):
            managers_q("standings", f"Who finished {word} in the {y} regular season?",
                       [r["manager"] for r in rows if r["regular_season_rank"] == place], S, y)
        if s.get("third_place"):
            managers_q("titles", f"Who finished third in the {y} playoffs?", [s["third_place"]], S, y)
        most_against = max(r["points_against"] for r in rows)
        managers_q("fun", f"Which team had the most points scored against it in the {y} regular season?",
                   [r["manager"] for r in rows if r["points_against"] == most_against], S, y,
                   note=f"{most_against:,.0f} points against. Brutal schedule.")
        least_against = min(r["points_against"] for r in rows)
        managers_q("fun", f"Which team had the fewest points scored against it in the {y} regular season?",
                   [r["manager"] for r in rows if r["points_against"] == least_against], S, y,
                   note=f"Just {least_against:,.0f} points against. Cushy schedule.")

    # head to head, completed regular seasons only (so the answers never change)
    done_labels = {s["season"] for s in done}
    span = f"{done[0]['season']} through {done[-1]['season']}"
    h2h = defaultdict(Counter)       # h2h[loser][winner] = wins
    for g in matchups:
        if g["season"] in done_labels and not g["tie"]:
            h2h[g["loser"]][g["winner"]] += 1
    for mid in managers:
        beaten_by = h2h[mid]
        if beaten_by:
            top = max(beaten_by.values())
            managers_q("rivals", f"Which manager has beaten {show(mid)} the most times in the regular season ({span})?",
                       [m for m, c in beaten_by.items() if c == top], M,
                       note=f"{plural(top, 'win')} against {managers[mid]['name']}.")
        beat = Counter({w: h2h[w][mid] for w in managers if h2h[w][mid]})
        if beat:
            top = max(beat.values())
            managers_q("rivals", f"Which manager has {show(mid)} beaten the most times in the regular season ({span})?",
                       [m for m, c in beat.items() if c == top], M,
                       note=f"{managers[mid]['name']} has {plural(top, 'win')} against them.")

    # trades: who sent a well-known player where
    stars = {p["player"] for p in startup_d["picks"] if p["round"] <= 3}
    stars |= {p["player"] for d in drafts if d["kind"] == "rookie" for p in d["picks"] if p["round"] == 1}
    asked = set()
    for t in trades:
        if len(t["managers"]) != 2:
            continue
        for side in t["sides"]:
            other = next(m for m in t["managers"] if m != side["manager"])
            for name in side["receives_players"]:
                if name in stars and name not in asked:
                    asked.add(name)
                    managers_q("trades", f"Who traded {name} to {show(side['manager'], t['season'])} on {nice_date(t['date'])}?",
                               [other], TR, t["season"])
    for s in done:
        y = s["season"]
        per = Counter(m for t in trades if t["season"] == y for m in t["managers"])
        for mid, c in per.items():
            if c >= 3:
                ask("trades", f"How many trades did {show(mid, y)} make during the {y} season?", "number",
                    [{"display": str(c), "accept": [str(c)], "manager": mid, "detail": career_fact(mid)}], TR)

    # all-time records (completed seasons; games whose result disagrees with the score are left out)
    clean_games = [g for g in matchups if g["season"] in done_labels
                   and not g["result_differs_from_score"] and not g.get("estimated")]
    scores_all = [(g[f"{side}_points"], g[side], g["season"], g["week"]) for g in clean_games for side in ("winner", "loser")]
    hi = max(scores_all)
    managers_q("fun", "Which team holds the record for the highest single-week score in Das League history (regular season)?",
               sorted({m for p, m, _, _ in scores_all if p == hi[0]}), M, hi[2], note=f"{hi[0]:g} points in week {hi[3]} of {hi[2]}.")
    lo = min(scores_all)
    managers_q("fun", "Which team holds the record for the lowest single-week score in Das League history (regular season)?",
               sorted({m for p, m, _, _ in scores_all if p == lo[0]}), M, lo[2], note=f"{lo[0]:g} points in week {lo[3]} of {lo[2]}.")
    blow = max(clean_games, key=lambda g: g["winner_points"] - g["loser_points"])
    managers_q("fun", "Which team suffered the biggest blowout loss in Das League history (regular season)?", [blow["loser"]], M,
               blow["season"], note=f"Lost {blow['loser_points']:g}-{blow['winner_points']:g} to {show(blow['winner'], blow['season'])} in week {blow['week']} of {blow['season']}.")

    # ---------- arrange into daily games ----------
    rng = random.Random(2023)
    for items in groups.values():
        rng.shuffle(items)
    order = []
    while any(groups.values()):
        for name in ("titles", "drafts", "fun", "standings", "trades", "startup", "rivals"):
            if groups[name]:
                order.append(groups[name].pop())

    # real difficulty from the leaderboard: how often league members got each question right
    rates = played_difficulty()
    for q in order:
        r = rates.get(q["text"])
        if r and r[1] >= MIN_PLAYS_FOR_DIFFICULTY:
            share = r[0] / r[1]
            q["difficulty"] = "easy" if share >= 0.7 else "medium" if share >= 0.35 else "hard"
            q["played"] = {"right": r[0], "of": r[1]}

    # Days up to and including today keep their questions forever (people may have played them).
    # Days after today are rebuilt every night: questions never asked come first, repeats only once those
    # run out, and every day gets at least one hard question.
    game_file = DATA / "game.json"
    scheduled = [[q["id"] for q in day] for day in json.loads(game_file.read_text(encoding="utf-8"))["days"]] if game_file.exists() else []
    by_id = {q["id"]: q for q in order}
    today_index = today_number(START_DATE) - 1
    days = []
    for ids in scheduled[:today_index + 1]:
        days.append([by_id[qid] for qid in ids if qid in by_id])
    fill_missing(days, order, QUESTIONS_PER_DAY)
    asked = {q["id"] for day in days for q in day}
    fresh = [q for q in order if q["id"] not in asked]
    while len(days) < today_index + 1 + AHEAD_DAYS:
        if len(fresh) < QUESTIONS_PER_DAY:
            # out of new questions: reuse the ones asked longest ago
            last = {}
            for i, day in enumerate(days):
                for q in day:
                    last[q["id"]] = i
            pool_ids = {q["id"] for q in fresh}
            fresh += sorted((q for q in order if q["id"] not in pool_ids), key=lambda q: last.get(q["id"], -1))
        day = fresh[:QUESTIONS_PER_DAY]
        fresh = fresh[QUESTIONS_PER_DAY:]
        if not any(q["difficulty"] == "hard" for q in day):
            swap = next((i for i, q in enumerate(fresh) if q["difficulty"] == "hard"), None)
            if swap is not None:
                hard = fresh.pop(swap)
                fresh.insert(0, day.pop())
                day.append(hard)
        random.Random(f"day-{len(days)}").shuffle(day)
        days.append(day)
    spare = fresh

    # every name the game knows, so a near-miss that is really a different person isn't accepted as a typo
    entities = set()
    for mid in managers:
        entities.update(manager_answer(mid)["accept"])
    for p in players.values():
        entities.update(player_answer(p["name"])["accept"])

    (DATA / "game.json").write_text(json.dumps({
        "title": "Das Trivia",
        "start_date": START_DATE,
        "days": days,
        "players": [{"id": m["id"], "name": m["name"]} for m in managers.values()],   # the name picker
        "entities": sorted(entities),
    }, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {len(order)} questions; {len(days)} daily games of {QUESTIONS_PER_DAY} "
          f"({len(spare)} left over for later).")


if __name__ == "__main__":
    main()
