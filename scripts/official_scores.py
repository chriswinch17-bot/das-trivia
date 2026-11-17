"""Official weekly scores for the season in progress (used by build_data.py).

WHY: Das League is a lock-in league. Sleeper's per-week matchup scores for the current season keep changing
between downloads and never add up to its official season totals, but the official totals ("points for" and
"points against" on each roster) are solid and only change when Sleeper finishes a week.

HOW: data/official_scores.json keeps every team's official totals each time a new week is finished
("snapshots", one per finished week we saw). A week's official score = total after it - total before it:
exact whenever we have snapshots on both sides of one week. When several weeks finished between two
snapshots (2026-2027 weeks 1-3: the first snapshot is after week 3), the weeks are ESTIMATED (owner's choice,
2026-11-16): Sleeper's per-week numbers, changed as little as possible so every team's total points for AND
points against over those weeks match the official totals exactly. Estimated weeks are marked.
Finished seasons are not touched (their original files match the official totals exactly).
"""

import json
from pathlib import Path

LEDGER = Path(__file__).resolve().parent.parent / "data" / "official_scores.json"


def load_ledger():
    return json.loads(LEDGER.read_text(encoding="utf-8")) if LEDGER.exists() else {
        "_note": "Sleeper's official season totals per team after each finished week (written by build_data.py; "
                 "do not edit). Weekly scores are worked out from the differences. See scripts/official_scores.py.",
        "seasons": {}}


def record_snapshot(ledger, label, last_scored, totals):
    """totals: {manager: [points_for, points_against]} after week last_scored. Returns True if new."""
    snaps = ledger["seasons"].setdefault(label, {})
    key = str(last_scored)
    if not last_scored or key in snaps:
        return False
    snaps[key] = {m: [round(pf, 2), round(pa, 2)] for m, (pf, pa) in totals.items()}
    return True


def save_ledger(ledger):
    LEDGER.write_text(json.dumps(ledger, indent=1, ensure_ascii=False), encoding="utf-8")


def _solve(matrix, rhs):
    """Solve a small linear system by Gaussian elimination; rows that turn out redundant are skipped."""
    n = len(matrix)
    a = [row[:] + [rhs[i]] for i, row in enumerate(matrix)]
    where = [-1] * n
    row = 0
    for col in range(n):
        pivot = max(range(row, n), key=lambda r: abs(a[r][col]), default=None)
        if pivot is None or abs(a[pivot][col]) < 1e-9:
            continue
        a[row], a[pivot] = a[pivot], a[row]
        for r in range(n):
            if r != row and abs(a[r][col]) > 1e-12:
                f = a[r][col] / a[row][col]
                a[r] = [x - f * y for x, y in zip(a[r], a[row])]
        where[col] = row
        row += 1
    return [a[where[c]][n] / a[where[c]][c] if where[c] >= 0 else 0.0 for c in range(n)]


def official_weeks(ledger, label, api, pairs):
    """api: {(week, manager): Sleeper's per-week points}; pairs: {week: [(a, b), ...]}.
    Returns {(week, manager): (points, estimated)} for every week covered by the snapshots."""
    snaps = ledger["seasons"].get(label) or {}
    if not snaps:
        return {}
    marks = sorted(int(k) for k in snaps)
    teams = list(snaps[str(marks[0])])
    out = {}
    before, start = {m: (0.0, 0.0) for m in teams}, 0
    for mark in marks:
        after = {m: tuple(v) for m, v in snaps[str(mark)].items()}
        weeks = list(range(start + 1, mark + 1))
        if len(weeks) == 1:
            for m in teams:
                out[(weeks[0], m)] = (round(after[m][0] - before[m][0], 2), False)
        else:
            # smallest change to Sleeper's numbers that makes every team's points for and against add up
            cells = [(w, m) for w in weeks for m in teams]
            idx = {c: i for i, c in enumerate(cells)}
            x0 = [float(api.get(c, 0) or 0) for c in cells]
            opp = {}
            for w in weeks:
                for a, b in pairs.get(w, []):
                    opp[(w, a)], opp[(w, b)] = b, a
            rows, rhs = [], []
            for m in teams:
                r = [0.0] * len(cells)
                for w in weeks:
                    r[idx[(w, m)]] = 1.0
                rows.append(r)
                rhs.append(after[m][0] - before[m][0])
            for m in teams[:-1]:                       # the last one follows from the others
                r = [0.0] * len(cells)
                for w in weeks:
                    if (w, m) in opp:
                        r[idx[(w, opp[(w, m)])]] = 1.0
                rows.append(r)
                rhs.append(after[m][1] - before[m][1])
            resid = [b - sum(c * x for c, x in zip(r, x0)) for r, b in zip(rows, rhs)]
            aat = [[sum(p * q for p, q in zip(r1, r2)) for r2 in rows] for r1 in rows]
            y = _solve(aat, resid)
            x = [x0[i] + sum(rows[k][i] * y[k] for k in range(len(rows))) for i in range(len(cells))]
            for c, v in zip(cells, x):
                out[c] = (round(v, 1), True)
        before, start = after, mark
    return out
