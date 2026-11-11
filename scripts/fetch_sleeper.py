"""Download a Sleeper league's full history into data/raw/sleeper/.

Usage:
    python scripts/fetch_sleeper.py LEAGUE_ID

Give it the league ID of any season (normally the current one). It follows
Sleeper's "previous season" links back to the league's first year and saves
everything exactly as Sleeper returns it. It only reads from Sleeper's public
API; it never changes anything in the league and needs no login.
"""

import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

API = "https://api.sleeper.app/v1"
OUT = Path(__file__).resolve().parent.parent / "data" / "raw" / "sleeper"
MAX_WEEKS = 30          # more than any NBA fantasy season has
PAUSE_SECONDS = 0.15    # stay far below Sleeper's limit of 1000 requests a minute


def get(path):
    """Fetch one API address. Returns None if Sleeper has nothing there."""
    request = urllib.request.Request(f"{API}{path}", headers={"User-Agent": "league-history-fetch"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                time.sleep(PAUSE_SECONDS)
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            if error.code == 404:
                return None
            if attempt == 3:
                raise
        except (urllib.error.URLError, TimeoutError):
            if attempt == 3:
                raise
        time.sleep(2 * (attempt + 1))


def save(folder, name, data):
    folder.mkdir(parents=True, exist_ok=True)
    (folder / f"{name}.json").write_text(json.dumps(data, indent=1), encoding="utf-8")


def fetch_season(league_id):
    """Download one season. Returns (summary, previous season's league ID)."""
    league = get(f"/league/{league_id}")
    if not league:
        sys.exit(f"Sleeper has no league with ID {league_id}. Check the number and try again.")

    season = league.get("season", "unknown")
    folder = OUT / f"{season}_{league_id}"
    print(f"\nSeason {season}: {league.get('name')}")
    save(folder, "league", league)

    for name in ("users", "rosters", "winners_bracket", "losers_bracket", "traded_picks"):
        save(folder, name, get(f"/league/{league_id}/{name}"))

    weeks_played = 0
    transactions = 0
    for week in range(1, MAX_WEEKS + 1):
        matchups = get(f"/league/{league_id}/matchups/{week}") or []
        if matchups:
            save(folder / "matchups", f"week_{week:02d}", matchups)
            weeks_played += 1
        moves = get(f"/league/{league_id}/transactions/{week}") or []
        if moves:
            save(folder / "transactions", f"week_{week:02d}", moves)
            transactions += len(moves)

    drafts = get(f"/league/{league_id}/drafts") or []
    save(folder, "drafts", drafts)
    for draft in drafts:
        draft_id = draft["draft_id"]
        save(folder / "drafts", f"{draft_id}_details", get(f"/draft/{draft_id}"))
        save(folder / "drafts", f"{draft_id}_picks", get(f"/draft/{draft_id}/picks"))
        save(folder / "drafts", f"{draft_id}_traded_picks", get(f"/draft/{draft_id}/traded_picks"))

    print(f"  {weeks_played} weeks of matchups, {transactions} transactions, {len(drafts)} draft(s)")
    summary = {
        "season": season,
        "league_id": league_id,
        "name": league.get("name"),
        "weeks_with_matchups": weeks_played,
        "transactions": transactions,
        "drafts": len(drafts),
    }
    return summary, league.get("previous_league_id")


def main():
    if len(sys.argv) != 2 or not sys.argv[1].isdigit():
        sys.exit("Usage: python scripts/fetch_sleeper.py LEAGUE_ID   (the long number in the league's URL)")

    seasons = []
    seen = set()
    league_id = sys.argv[1]
    while league_id and league_id != "0" and league_id not in seen:
        seen.add(league_id)
        summary, league_id = fetch_season(league_id)
        seasons.append(summary)

    print("\nDownloading the NBA player list (turns player ID numbers into names)...")
    save(OUT, "players_nba", get("/players/nba"))

    seasons.sort(key=lambda s: s["season"])
    save(OUT, "_summary", {"fetched_at": time.strftime("%Y-%m-%d %H:%M:%S"), "seasons": seasons})
    print(f"\nDone. {len(seasons)} season(s) saved in {OUT}")


if __name__ == "__main__":
    main()
