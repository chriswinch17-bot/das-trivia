"""The nightly refresh, run just after midnight Eastern by .github/workflows/rorw-refresh.yml.

  1. Download this season from Sleeper (results, trades, pickups and drops so far).
  2. Rebuild the league data and top up Das Trivia, Papo Trade or NOT, What team am I? and Das Feud so each
     always has three weeks of games ahead, rebuild Analytics, then run the automated tests (including the
     question checker).
  3. Das Grids: rebuild its roster history and send it to the database (only if the access token is set up).
  4. Build today's Rostered or Waiver from the rosters at this moment.
  5. Write site/data/health.json: anything worth warning about shows as a banner on the home page.

If step 1 or 2 fails (Sleeper down, a data problem, a failing test), their changes are thrown away
and yesterday's files stay, so the games keep working; Rostered or Waiver is still built.
Only on GitHub (where GITHUB_ACTIONS is set) does it throw changes away; on a computer it just reports.
"""

import json
import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from daily import eastern_now  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
LEAGUE_ID = "1344343390740819968"
KNOWN_ESTIMATED = {("2026-2027", 1), ("2026-2027", 2), ("2026-2027", 3)}   # weeks saved before official totals were kept


def run(*args):
    print(f"\n$ {' '.join(args)}", flush=True)
    return subprocess.run([sys.executable, *args], cwd=ROOT).returncode == 0


def health(refreshed, grids_ok, rorw_ok):
    warnings = []
    if not refreshed:
        warnings.append("Last night's update from Sleeper didn't pass its checks, so the games and Analytics are using the day before's data.")
    if not rorw_ok:
        warnings.append("Today's Rostered or Waiver couldn't be built, so it shows the last one.")
    if grids_ok is False:
        warnings.append("Das Grids' roster history couldn't be updated last night.")
    try:
        matchups = json.loads((ROOT / "site" / "data" / "matchups.json").read_text(encoding="utf-8"))
        extra = sorted({(m["season"], m["week"]) for m in matchups if m.get("estimated")} - KNOWN_ESTIMATED)
        if extra:
            warnings.append("Scores for " + ", ".join(f"{s} week {w}" for s, w in extra)
                            + " are estimated: a nightly update was missed when that week finished.")
    except Exception as error:
        warnings.append(f"The league data couldn't be read ({error}).")
    when, zone = eastern_now()
    (ROOT / "site" / "data" / "health.json").write_text(json.dumps({
        "checked": f"{when:%Y-%m-%d %H:%M} {zone}", "refresh_ok": refreshed, "warnings": warnings,
    }, indent=1), encoding="utf-8")
    for w in warnings:
        print("HEALTH:", w)


def main():
    refreshed = (run("scripts/fetch_sleeper.py", LEAGUE_ID, "--current-only")
                 and run("scripts/build_data.py")
                 and run("scripts/build_questions.py")
                 and run("scripts/build_papo.py")
                 and run("scripts/build_team.py")
                 and run("scripts/build_feud.py")
                 and run("scripts/build_analytics.py")
                 and run("-m", "unittest", "discover", "tests"))
    if not refreshed:
        print("\nWARNING: the data refresh failed; keeping yesterday's files for the question games.", flush=True)
        if os.environ.get("GITHUB_ACTIONS"):
            subprocess.run(["git", "checkout", "--", "data", "site/data"], cwd=ROOT)
            subprocess.run(["git", "clean", "-fdq", "data/raw", "site/data"], cwd=ROOT)
    grids_ok = None
    if refreshed and os.environ.get("SUPABASE_ACCESS_TOKEN"):
        grids_ok = run("scripts/build_grids.py") and run("scripts/push_grids_sql.py")
        if not grids_ok and os.environ.get("GITHUB_ACTIONS"):
            subprocess.run(["git", "checkout", "--", "site/data/grids.json"], cwd=ROOT)
    rorw_ok = run("scripts/build_rorw.py")
    health(refreshed, grids_ok, rorw_ok)
    if not rorw_ok:
        sys.exit("Rostered or Waiver couldn't be built.")
    print("\nNightly refresh done." + ("" if refreshed else " (Question games NOT refreshed; see the warning above.)"))


if __name__ == "__main__":
    main()
