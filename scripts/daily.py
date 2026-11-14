"""Shared helpers for the daily games: Eastern time, and keeping every schedule topped up.

extend_schedule() is what makes the games run forever: it appends new days until there are AHEAD
days after today. New days use the questions that haven't been asked for the longest time (never-used
ones first), so a question only comes back after everything else has had a turn.
"""

import random
from datetime import date, datetime, timedelta, timezone
from datetime import time as clock

AHEAD = 21   # always keep at least three weeks of games ready


def eastern_now():
    """The time in New York without a time-zone database: EDT (-4) from the 2nd Sunday of March to the
    1st Sunday of November, otherwise EST (-5)."""
    utc = datetime.now(timezone.utc)

    def nth_sunday(month, n):
        d = date(utc.year, month, 1)
        d += timedelta(days=(6 - d.weekday()) % 7)
        return d + timedelta(weeks=n - 1)

    dst = (datetime.combine(nth_sunday(3, 2), clock(7), timezone.utc) <= utc
           < datetime.combine(nth_sunday(11, 1), clock(6), timezone.utc))
    return utc + timedelta(hours=-4 if dst else -5), ("EDT" if dst else "EST")


def today_number(start_date):
    """Which game number is today's (Game #1 on start_date)."""
    return (eastern_now()[0].date() - date.fromisoformat(start_date)).days + 1


def extend_schedule(days, pool, per_day, start_date, seed, fits=None):
    """Append days until AHEAD days after today exist.

    days      the schedule so far (list of lists of questions); existing days are never changed
    pool      every question available today (dicts with an "id")
    fits      optional check fits(day_so_far, question) -> bool, e.g. one team per day
    """
    target = today_number(start_date) + AHEAD
    if len(days) >= target or len(pool) < per_day:
        return days
    rng = random.Random(f"{seed}-{len(days)}")
    by_id = {q["id"]: q for q in pool}
    last_used = {}
    for i, day in enumerate(days):
        for q in day or []:
            last_used[q["id"]] = i
    while len(days) < target:
        # least recently used first; ties broken by a fixed shuffle so it isn't alphabetical
        order = sorted(by_id.values(), key=lambda q: (last_used.get(q["id"], -1), rng.random()))
        day = []
        for q in order:
            if len(day) == per_day:
                break
            if any(q["id"] == d["id"] for d in day) or (fits and not fits(day, q)):
                continue
            day.append(q)
        if len(day) < per_day:
            break
        rng.shuffle(day)
        for q in day:
            last_used[q["id"]] = len(days)
        days.append(day)
    return days


def fill_missing(days, pool, per_day, fits=None, seed="fill"):
    """Top up any day that lost a question (a question reworded or removed after new data), in place,
    so game numbers never shift. Uses the least recently used questions."""
    by_id = {q["id"]: q for q in pool}
    rng = random.Random(seed)
    for i, day in enumerate(days):
        if len(day) >= per_day:
            continue
        last_used = {}
        for j, other in enumerate(days):
            for q in other:
                last_used[q["id"]] = j if j != i else last_used.get(q["id"], -1)
        for q in sorted(by_id.values(), key=lambda q: (last_used.get(q["id"], -1), rng.random())):
            if len(day) == per_day:
                break
            if any(q["id"] == d["id"] for d in day) or (fits and not fits(day, q)):
                continue
            day.append(q)
    return days
