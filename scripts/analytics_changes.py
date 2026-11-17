"""EquipoGPT Analytics: the "What changed since yesterday" banner (called by build_analytics.py).

Every build keeps a small snapshot of the numbers (ranks, playoff odds, stamps, records, trades, pick owners).
The first build of a new day (Eastern time) moves the last snapshot from the day before into "previous", so
however many times the site is rebuilt in one day, the banner always compares with yesterday's last build.
Each change carries a link target (tab + item) so the banner can jump straight to it.
"""

ODDS_MOVE = 5.0     # playoff-odds change (percentage points) worth mentioning
RANK_MOVE = 2       # power-ranking places worth mentioning
MAX_ITEMS = 8


def snapshot(out):
    return {
        "through_week": out["through_week"],
        "teams": {r["manager"]: {"rank": r["rank"], "record": r["record"], "playoff": r.get("playoff_pct"),
                                 "fraud": r.get("fraud", False), "robbed": r.get("robbed", False)}
                  for r in out["rankings"]},
        "trades": {t["id"]: t["status"] for t in out["trades"]},
        "picks": {f"{y}|{p['round']}|{p['from']}": t["manager"]
                  for t in out["ledger"]["teams"] for y, ps in t["picks"].items() for p in ps},
    }


def carry_previous(old, today):
    """-> (previous snapshot, day it was taken) for today's comparison."""
    if not old or "snapshot" not in old:
        return None, None
    if old.get("built_on") == today:
        return old.get("previous"), old.get("previous_on")      # same day: keep comparing with yesterday
    return old["snapshot"], old.get("built_on")                 # new day: yesterday's last build


def changes(prev, now, out):
    if not prev:
        return []
    names = {m["manager"]: m["name"] for m in out["managers"]}
    items = []

    def add(priority, text, tab, item=None):
        items.append({"p": priority, "text": text, "tab": tab, "item": item})

    if now["through_week"] > prev["through_week"]:
        weeks = range(prev["through_week"] + 1, now["through_week"] + 1)
        add(10, f"Week {', '.join(map(str, weeks))} results are in. Rankings, odds and stamps updated.", "power")
    for mid, t in now["teams"].items():
        before = prev["teams"].get(mid)
        if not before:
            continue
        move = before["rank"] - t["rank"]
        d = (t["playoff"] - before["playoff"]) if t["playoff"] is not None and before["playoff"] is not None else 0
        odds = f"playoff odds {'+' if d > 0 else '−'}{abs(d):.0f}% to {t['playoff']:.0f}%" if abs(d) >= ODDS_MOVE else ""
        if abs(move) >= RANK_MOVE:
            add(6 + abs(move) / 10, f"{names[mid]} {'up' if move > 0 else 'down'} {abs(move)} to #{t['rank']} in the power rankings"
                                    + (f", {odds}." if odds else "."), "power", mid)
        elif odds:
            add(5 + abs(d) / 100, f"{names[mid]}'s {odds}.", "power", mid)
        if t["fraud"] and not before["fraud"]:
            add(8, f"🚨 {names[mid]} just got stamped FRAUD ({t['record']}).", "power", mid)
        if before["fraud"] and not t["fraud"]:
            add(7, f"{names[mid]} is no longer a fraud. For now.", "power", mid)
        if t["robbed"] and not before["robbed"]:
            add(7, f"😤 {names[mid]} is officially ROBBED ({t['record']}).", "power", mid)
    trades = {t["id"]: t for t in out["trades"]}
    for tid, status in now["trades"].items():
        t = trades[tid]
        who = " ↔ ".join(s["name"] for s in t["sides"])
        if tid not in prev["trades"]:
            add(9, f"New trade: {who}. Report card is up.", "trades", tid)
        elif status == "graded" and prev["trades"][tid] != "graded":
            best = max(t["sides"], key=lambda s: s["total"])
            add(6, f"Trade {who} just got graded: {best['name']} gets the {best['grade']}.", "trades", tid)
    moved = {}
    for key, owner in now["picks"].items():
        if prev["picks"].get(key) not in (None, owner):
            moved.setdefault(owner, []).append(key)
    for owner, keys in moved.items():
        y, r, orig = keys[0].split("|")
        more = f" (+{len(keys) - 1} more)" if len(keys) > 1 else ""
        add(4, f"{names[owner]} picked up {names.get(orig, orig)}'s {y} round {r} pick{more}.", "picks", owner)
    items.sort(key=lambda i: -i["p"])
    return [{k: v for k, v in i.items() if k != "p"} for i in items[:MAX_ITEMS]]
