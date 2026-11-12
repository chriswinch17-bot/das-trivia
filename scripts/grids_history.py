"""DAS GRIDS: every NBA player each franchise has ever had on its roster.

Used by build_grids.py and the tests. A player counts for a franchise if ANY of these records shows him there:
  - a weekly lineup (every player on the roster that week, bench, taxi and IR included)
  - an add from free agency, waivers, a trade or a commissioner move (catches pickups of a few days)
  - a draft pick (startup or rookie)
  - an end-of-season roster (players, taxi, IR)
Trades undone the same day (owner's rule) are ignored. Franchises are tracked by manager id, so team
renames never matter. Manual fixes go in data/grids_corrections.json.
"""

import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw" / "sleeper"
DEEP_CUT_WEEKS = 1   # on the two teams for 1 weekly lineup or fewer, combined = a deep cut (about 1 answer in 5)


def load(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def player_names():
    """Sleeper id -> name, for every NBA player Sleeper knows (used for search too)."""
    names = {}
    for pid, info in load(RAW / "players_nba.json").items():
        name = info.get("full_name") or " ".join(filter(None, [info.get("first_name"), info.get("last_name")]))
        name = (name or "").replace(" DUPLICATE", "").strip()
        if name:
            names[pid] = name
    return names


def build_history():
    """Returns (links, managers) where links[(manager_id, player_id)] = {"weeks": set, "sources": set, "seasons": set}."""
    managers = {m["id"]: m for m in load(ROOT / "data" / "managers.json")["managers"]}
    by_username = {u.lower(): m["id"] for m in managers.values() for u in m["sleeper_usernames"]}
    undone_file = ROOT / "data" / "derived" / "undone_trades.json"
    undone = set(load(undone_file)) if undone_file.exists() else set()
    names = player_names()

    links = defaultdict(lambda: {"weeks": set(), "sources": set(), "seasons": set()})

    def add(mid, pid, source, season, week=None):
        pid = str(pid)
        if not pid or pid == "0":
            return
        link = links[(mid, pid)]
        link["sources"].add(source)
        link["seasons"].add(season)
        if week is not None:
            link["weeks"].add((season, week))

    for folder in sorted(p for p in RAW.iterdir() if p.is_dir()):
        league = load(folder / "league.json")
        season = f"{league['season']}-{int(league['season']) + 1}"
        users = {u["user_id"]: u for u in load(folder / "users.json")}
        rosters = load(folder / "rosters.json")
        owner = {r["roster_id"]: by_username[users[r["owner_id"]]["display_name"].lower()] for r in rosters}

        for r in rosters:
            for pid in (r.get("players") or []) + (r.get("taxi") or []) + (r.get("reserve") or []):
                add(owner[r["roster_id"]], pid, "end-of-season roster", season)

        for file in sorted((folder / "matchups").glob("week_*.json")):
            entries = load(file)
            if not any((e.get("points") or 0) > 0 for e in entries):
                continue                      # a week that hasn't been played yet
            week = int(file.stem[5:])
            for e in entries:
                for pid in e.get("players") or []:
                    add(owner[e["roster_id"]], pid, "weekly lineup", season, week)

        for file in sorted((folder / "transactions").glob("week_*.json")):
            for t in load(file):
                if t.get("status") != "complete" or t["transaction_id"] in undone:
                    continue
                label = {"free_agent": "free agent pickup", "waiver": "waiver claim",
                         "trade": "trade", "commissioner": "commissioner move"}.get(t["type"], t["type"])
                for pid, rid in (t.get("adds") or {}).items():
                    add(owner[rid], pid, label, season)
                # being dropped also proves he was on that roster
                for pid, rid in (t.get("drops") or {}).items():
                    add(owner[rid], pid, "dropped", season)

        for draft in load(folder / "drafts.json"):
            for p in load(folder / "drafts" / f"{draft['draft_id']}_picks.json") or []:
                add(owner[p["roster_id"]], p["player_id"], "draft pick", season)

    # the owner's manual fixes
    fixes_file = ROOT / "data" / "grids_corrections.json"
    if fixes_file.exists():
        fixes = load(fixes_file)
        lookup = {n.lower(): pid for pid, n in names.items()}
        for fix in fixes.get("add", []):
            pid = str(fix["player"]) if str(fix["player"]).isdigit() else lookup[fix["player"].lower()]
            add(fix["manager"], pid, "manual correction", fix.get("season", "manual"))
        for fix in fixes.get("remove", []):
            pid = str(fix["player"]) if str(fix["player"]).isdigit() else lookup[fix["player"].lower()]
            links.pop((fix["manager"], pid), None)

    unknown = sorted({pid for (_, pid) in links if pid not in names})
    for pid in unknown:                       # never guess a name; leave such ids out
        for mid in managers:
            links.pop((mid, pid), None)

    # Sleeper lists a few players twice (or three times) under one name, e.g. Matas Buzelis.
    # Treat every id with the same name as one player, so search shows each name once.
    groups = defaultdict(list)
    for pid, name in names.items():
        groups[name].append(pid)
    count = defaultdict(int)
    for (_, pid) in links:
        count[pid] += 1
    for name, ids in groups.items():
        if len(ids) < 2:
            continue
        keep = max(ids, key=lambda pid: (count[pid], -int(pid) if pid.isdigit() else 0))
        for pid in ids:
            if pid == keep:
                continue
            for mid in managers:
                old = links.pop((mid, pid), None)
                if old:
                    merged = links[(mid, keep)]
                    for field in ("weeks", "sources", "seasons"):
                        merged[field] |= old[field]
            names.pop(pid)
    return dict(links), managers, names


def answers_for(links, a, b):
    """Players rostered at some point by both franchises a and b."""
    on_a = {pid for (mid, pid) in links if mid == a}
    return {pid for (mid, pid) in links if mid == b and pid in on_a}


def is_deep_cut(links, a, b, pid):
    return len(links[(a, pid)]["weeks"]) + len(links[(b, pid)]["weeks"]) <= DEEP_CUT_WEEKS
