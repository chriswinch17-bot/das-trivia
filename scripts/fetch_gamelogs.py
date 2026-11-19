"""Download Sleeper's game-by-game stats for every player who started for a Das League team, for the lock-in report.

Usage:
    python scripts/fetch_gamelogs.py          finished seasons that don't have game logs yet
    python scripts/fetch_gamelogs.py --all    re-download them all

Saves data/raw/sleeper/<season>/gamelogs.json: {player id: {fantasy week: [[date, {stat: value}], ...]}}, keeping
only the stats the league's scoring uses. Finished seasons never change, so this runs once per season.
(The season in progress is left out: Sleeper's per-player weekly scores for it aren't reliable, see official_scores.py.)
"""

import json
import sys
import time
import urllib.request
from pathlib import Path

RAW = Path(__file__).resolve().parent.parent / "data" / "raw" / "sleeper"
PAUSE = 0.15


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "league-history-fetch"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                time.sleep(PAUSE)
                return json.loads(r.read().decode("utf-8"))
        except Exception:
            if attempt == 3:
                return None
            time.sleep(2 * (attempt + 1))


def main():
    redo = "--all" in sys.argv
    for folder in sorted(p for p in RAW.iterdir() if p.is_dir()):
        league = json.loads((folder / "league.json").read_text(encoding="utf-8"))
        out = folder / "gamelogs.json"
        if league["status"] != "complete" or (out.exists() and not redo):
            continue
        keep = set(league["scoring_settings"]) | {"sp"}
        starters = set()
        for f in (folder / "matchups").glob("week_*.json"):
            for e in json.loads(f.read_text(encoding="utf-8")):
                starters.update(e.get("starters") or [])
        logs = {}
        print(f"{league['season']}: {len(starters)} players")
        for n, pid in enumerate(sorted(starters), 1):
            data = get(f"https://api.sleeper.com/stats/nba/player/{pid}?season_type=regular&season={league['season']}&grouping=week") or {}
            weeks = {}
            for week, games in data.items():
                rows = [[g.get("date"), {k: v for k, v in (g.get("stats") or {}).items() if k in keep}]
                        for g in (games or []) if g and (g.get("stats") or {}).get("sp")]
                if rows:
                    weeks[week] = rows
            logs[pid] = weeks
            if n % 50 == 0:
                print(f"  {n}/{len(starters)}")
        out.write_text(json.dumps(logs, separators=(",", ":")), encoding="utf-8")
        print(f"  saved {out}")


if __name__ == "__main__":
    main()
