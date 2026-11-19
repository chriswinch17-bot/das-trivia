"""Send Das Grids' database file (data/private/grids_setup.sql, made by build_grids.py) to Supabase, so the
roster history behind Das Grids stays up to date without pasting it by hand.

Needs a Supabase "personal access token" in the environment variable SUPABASE_ACCESS_TOKEN (on GitHub it's a
repository secret with that name). Without it this does nothing and says so. The file only refreshes the roster
history and puzzles; everyone's picks and results are kept (see the comment at the top of the file).
"""

import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SQL = ROOT / "data" / "private" / "grids_setup.sql"


def main():
    token = os.environ.get("SUPABASE_ACCESS_TOKEN", "").strip()
    if not token:
        print("Das Grids: no SUPABASE_ACCESS_TOKEN, so the database wasn't updated (paste data/private/grids_setup.sql by hand).")
        return 0
    cfg = (ROOT / "site" / "js" / "config.js").read_text(encoding="utf-8")
    ref = re.search(r"https://([a-z0-9]+)\.supabase\.co", cfg)
    if not ref or not SQL.exists():
        print("Das Grids: project address or database file missing.")
        return 1
    req = urllib.request.Request(f"https://api.supabase.com/v1/projects/{ref.group(1)}/database/query",
                                 data=json.dumps({"query": SQL.read_text(encoding="utf-8")}).encode("utf-8"),
                                 headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json",
                                          "User-Agent": "das-trivia-nightly"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            print(f"Das Grids: database updated ({r.status}).")
            return 0
    except urllib.error.HTTPError as e:
        print(f"Das Grids: Supabase said {e.code}: {e.read().decode('utf-8', 'replace')[:300]}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
