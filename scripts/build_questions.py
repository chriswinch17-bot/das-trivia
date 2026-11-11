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
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "site" / "data"
START_DATE = "2026-11-11"      # the day Game #1 is played
QUESTIONS_PER_DAY = 7
NAME_SUFFIXES = {"jr", "jr.", "sr", "sr.", "ii", "iii", "iv"}


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

    def manager_answer(mid, season=None):
        m = managers[mid]
        accept = {m["name"], *m["aliases"], *m["sleeper_usernames"], *m["team_names"]}
        return {"display": show(mid, season), "accept": sorted(accept), "manager": mid}

    def player_answer(name):
        parts = name.split()
        while len(parts) > 1 and parts[-1].lower() in NAME_SUFFIXES:
            parts.pop()
        accept = {name, " ".join(parts)}
        if len(parts) > 1:
            accept.add(parts[-1])                       # last name
            if first_names[parts[0].lower()] == 1:      # first name, only when no one else shares it
                accept.add(parts[0])
        return {"display": name, "accept": sorted(accept)}

    groups = defaultdict(list)

    def ask(group, text, kind, answers, sources, note=None):
        answers = list(answers)
        if not answers:
            return
        # which managers the question or its note mentions, so the site can show that manager's pictures
        mentioned = f"{text} {note or ''}"
        about = [mid for mid, m in managers.items() if f"({m['name']})" in mentioned]
        groups[group].append({
            "id": hashlib.md5(text.encode("utf-8")).hexdigest()[:8],
            "text": text, "kind": kind, "answers": answers, "note": note, "about": about, "sources": sources,
        })

    def managers_q(group, text, ids, sources, season=None, note=None):
        ask(group, text, "manager", [manager_answer(i, season) for i in ids], sources, note)

    def players_q(group, text, names, sources, note=None):
        ask(group, text, "player", [player_answer(n) for n in sorted(set(names))], sources, note)

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
        managers_q("standings", f"Who finished with the best regular-season record in {y}?", [top["manager"]], S, y,
                   note=f"{top['wins']}-{top['losses']}" + (f"-{top['ties']}" if top["ties"] else ""))
        last = rows[-1]
        managers_q("standings", f"Who finished last in the {y} regular season?", [last["manager"]], S, y,
                   note=f"{last['wins']}-{last['losses']}" + (f"-{last['ties']}" if last["ties"] else ""))
        by_points = sorted(rows, key=lambda r: -r["points_for"])
        managers_q("standings", f"Name one of the three highest-scoring teams of the {y} regular season.",
                   [r["manager"] for r in by_points if r["points_for"] >= by_points[2]["points_for"]], S, y)
        managers_q("standings", f"Who scored the fewest points in the {y} regular season?",
                   [r["manager"] for r in by_points if r["points_for"] == by_points[-1]["points_for"]], S, y)
        managers_q("standings", f"Name a team that finished the {y} regular season with a winning record.",
                   [r["manager"] for r in rows if r["wins"] > r["losses"]], S, y)
        champ = next(r for r in rows if r["manager"] == s["champion"])
        ask("standings", f"How many regular-season wins did the {y} champion, {show(s['champion'], y)}, have?",
            "number", [{"display": str(champ["wins"]), "accept": [str(champ["wins"])]}], S)

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
            players_q("drafts", f"Who was the first overall pick of the {title}?", [picks[0]["player"]], DR,
                      note=f"Taken by {show(picks[0]['manager'], y)}.")
            managers_q("drafts", f"Who made the first overall pick of the {title}?", [picks[0]["manager"]], DR, y,
                       note=f"The pick was {picks[0]['player']}.")
            for mid in managers:
                mine = [p for p in picks if p["manager"] == mid]
                if not mine:
                    continue
                players_q("startup", f"Who did {show(mid, y)} take with their first pick of the {title}?",
                          [mine[0]["player"]], DR, note=f"Round {mine[0]['round']}, pick {mine[0]['pick']} overall.")
                players_q("startup", f"Name one of the first five players {show(mid, y)} took in the {title}.",
                          [p["player"] for p in mine[:5]], DR)
        else:
            title = f"{y[:4]} rookie draft"
            players_q("drafts", f"Who was the first overall pick of the {title}?", [picks[0]["player"]], DR,
                      note=f"Taken by {show(picks[0]['manager'], y)}.")
            managers_q("drafts", f"Who made the first overall pick of the {title}?", [picks[0]["manager"]], DR, y,
                       note=f"The pick was {picks[0]['player']}.")
            players_q("drafts", f"Name a top-five pick of the {title}.", [p["player"] for p in picks[:5]], DR)
            players_q("drafts", f"Name a first-round pick of the {title}.",
                      [p["player"] for p in picks if p["round"] == 1], DR)

    # ---------- trades ----------
    TR = ["trades.json"]
    traded = Counter(name for t in trades for side in t["sides"] for name in side["receives_players"])
    most = max(traded.values())
    players_q("trades", "Which player has been traded the most times in Das League history?",
              [n for n, c in traded.items() if c == most], TR, note=f"Traded {most} times.")
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
        got = {n for t in trades for side in t["sides"] if side["manager"] == mid for n in side["receives_players"]}
        players_q("trades", f"Name a player {show(mid)} has acquired in a trade.", got, TR)

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

    # ---------- arrange into daily games ----------
    rng = random.Random(2023)
    for items in groups.values():
        rng.shuffle(items)
    order = []
    while any(groups.values()):
        for name in ("titles", "drafts", "fun", "standings", "trades", "startup"):
            if groups[name]:
                order.append(groups[name].pop())
    days = [order[i:i + QUESTIONS_PER_DAY] for i in range(0, len(order) - QUESTIONS_PER_DAY + 1, QUESTIONS_PER_DAY)]

    # every name the game knows, so a near-miss that is really a different person isn't accepted as a typo
    entities = set()
    for mid in managers:
        entities.update(manager_answer(mid)["accept"])
    for p in players.values():
        entities.update(player_answer(p["name"])["accept"])

    (DATA / "game.json").write_text(json.dumps({
        "title": "Das League Trivia",
        "start_date": START_DATE,
        "days": days,
        "entities": sorted(entities),
    }, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {len(order)} questions; {len(days)} daily games of {QUESTIONS_PER_DAY} "
          f"({len(order) - len(days) * QUESTIONS_PER_DAY} left over for later).")


if __name__ == "__main__":
    main()
