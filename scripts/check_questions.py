"""Checks every Das Trivia question before it goes live (run nightly through the tests, or by hand).

    python scripts/check_questions.py

PROBLEMS (the nightly job stops and nothing is published):
  - a question with no answers, an answer nobody could type, a number question whose answer isn't a number
  - a question without a source file, or pointing at a file that doesn't exist
  - a score question about the season still being played (its scores can still change) or about an
    estimated / stat-corrected game
  - a day with the wrong number of questions or the same question twice
WARNINGS (printed, not blocking): accepted short names that also belong to another player in the league,
e.g. "Williams" accepted for Jalen Williams while Robert Williams exists. The owner wants matching to be
generous, so these stay accepted.
"""

import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site" / "data"
SCORE_WORDS = ("score", "points", "blowout", "closest game", "lost by")


def check(game=None):
    game = game or json.loads((SITE / "game.json").read_text(encoding="utf-8"))
    seasons = json.loads((SITE / "seasons.json").read_text(encoding="utf-8"))
    matchups = json.loads((SITE / "matchups.json").read_text(encoding="utf-8"))
    live = [s["season"] for s in seasons if s["status"] != "complete"]
    shaky = {(g["season"], g["week"]) for g in matchups if g["result_differs_from_score"] or g.get("estimated")}
    problems, warnings = [], []
    texts = {}
    per_day = None
    for n, day in enumerate(game["days"], 1):
        per_day = per_day or len(day)
        if len(day) != per_day:
            problems.append(f"Game #{n} has {len(day)} questions, not {per_day}")
        if len({q["id"] for q in day}) != len(day):
            problems.append(f"Game #{n} asks the same question twice")
        for q in day:
            where = f"Game #{n}: {q['text']}"
            if texts.setdefault(q["id"], q["text"]) != q["text"]:
                problems.append(f"{where}: two different questions share the id {q['id']}")
            if q["kind"] not in ("manager", "player", "number"):
                problems.append(f"{where}: unknown kind {q['kind']}")
            if not q["answers"]:
                problems.append(f"{where}: no answers")
            for a in q["answers"]:
                if not a.get("display") or not any(str(x).strip() for x in a.get("accept", [])):
                    problems.append(f"{where}: an answer nobody could type")
                if q["kind"] == "number" and not str(a["display"]).lstrip("-").replace(".", "", 1).isdigit():
                    problems.append(f"{where}: number answer {a['display']!r} isn't a number")
            if not q.get("sources") or any(not (SITE / f).exists() for f in q["sources"]):
                problems.append(f"{where}: missing or unknown source file")
            about_scores = "matchups.json" in q.get("sources", []) and any(w in q["text"].lower() + " " + (q.get("note") or "").lower() for w in SCORE_WORDS)
            if about_scores and any(y in q["text"] + (q.get("note") or "") for y in live):
                problems.append(f"{where}: a score question about the season still being played")
            if about_scores:
                for (season, week) in shaky:
                    if season in (q.get("note") or "") and f"week {week} " in (q.get("note") or "") + " ":
                        problems.append(f"{where}: its note points at an estimated or stat-corrected game")
    # generous matching: short names shared with other players (warnings only)
    owners = defaultdict(set)
    players = json.loads((SITE / "players.json").read_text(encoding="utf-8"))
    for p in players.values():
        for part in p["name"].replace("-", " ").split():
            if len(part) >= 4:
                owners[part.lower()].add(p["name"])
    shared = sorted(k for k, v in owners.items() if len(v) > 1)
    if shared:
        warnings.append(f"{len(shared)} short names belong to more than one player (accepted for each, as the owner prefers), "
                        f"e.g. {', '.join(shared[:6])}")
    return problems, warnings


if __name__ == "__main__":
    problems, warnings = check()
    for w in warnings:
        print("warning:", w)
    for p in problems:
        print("PROBLEM:", p)
    print(f"{len(problems)} problems." if problems else "All questions OK.")
    raise SystemExit(1 if problems else 0)
