"""The nightly refresh, run just after midnight Eastern by .github/workflows/rorw-refresh.yml.

  1. Download this season from Sleeper (results, trades, pickups and drops so far).
  2. Rebuild the league data and top up Das Trivia, Papo Trade or NOT and What team am I? so each
     always has three weeks of games ahead. Then run the automated tests.
  3. Build today's Rostered or Waiver from the rosters at this moment.

If step 1 or 2 fails (Sleeper down, a data problem, a failing test), their changes are thrown away
and yesterday's files stay, so the games keep working; Rostered or Waiver is still built.
Only on GitHub (where GITHUB_ACTIONS is set) does it throw changes away; on a computer it just reports.
"""

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LEAGUE_ID = "1344343390740819968"


def run(*args):
    print(f"\n$ {' '.join(args)}", flush=True)
    return subprocess.run([sys.executable, *args], cwd=ROOT).returncode == 0


def main():
    refreshed = (run("scripts/fetch_sleeper.py", LEAGUE_ID, "--current-only")
                 and run("scripts/build_data.py")
                 and run("scripts/build_questions.py")
                 and run("scripts/build_papo.py")
                 and run("scripts/build_team.py")
                 and run("-m", "unittest", "discover", "tests"))
    if not refreshed:
        print("\nWARNING: the data refresh failed; keeping yesterday's files for the question games.", flush=True)
        if os.environ.get("GITHUB_ACTIONS"):
            subprocess.run(["git", "checkout", "--", "data", "site/data"], cwd=ROOT)
            subprocess.run(["git", "clean", "-fdq", "data/raw", "site/data"], cwd=ROOT)
    if not run("scripts/build_rorw.py"):
        sys.exit("Rostered or Waiver couldn't be built.")
    print("\nNightly refresh done." + ("" if refreshed else " (Question games NOT refreshed; see the warning above.)"))


if __name__ == "__main__":
    main()
