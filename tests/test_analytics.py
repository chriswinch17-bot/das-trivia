"""Checks for EquipoGPT Analytics (site/data/analytics.json). Run: python -m unittest discover tests"""

import json
import unittest
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent / "site" / "data"
A = json.loads((SITE / "analytics.json").read_text(encoding="utf-8"))
SEASONS = json.loads((SITE / "seasons.json").read_text(encoding="utf-8"))
MATCHUPS = json.loads((SITE / "matchups.json").read_text(encoding="utf-8"))


class PowerRankings(unittest.TestCase):
    def test_every_team_ranked_once(self):
        if not A["rankings"]:
            self.skipTest("no finished week yet")
        self.assertEqual([r["rank"] for r in A["rankings"]], list(range(1, A["teams"] + 1)))
        self.assertEqual(len({r["manager"] for r in A["rankings"]}), A["teams"])
        scores = [r["score"] for r in A["rankings"]]
        self.assertEqual(scores, sorted(scores, reverse=True))
        self.assertTrue(all(0 <= s <= 100 for s in scores))

    def test_weights_add_up(self):
        self.assertAlmostEqual(sum(A["weights"].values()), 1.0)

    def test_records_match_official_results(self):
        games = [m for m in MATCHUPS if m["season"] == A["season"] and m["week"] <= A["through_week"]]
        for r in A["rankings"]:
            wins = sum(1 for m in games if m["winner"] == r["manager"] and not m["tie"])
            losses = sum(1 for m in games if m["loser"] == r["manager"] and not m["tie"])
            self.assertTrue(r["record"].startswith(f"{wins}-{losses}"), r["manager"])

    def test_points_per_week_match_results(self):
        games = [m for m in MATCHUPS if m["season"] == A["season"] and m["week"] <= A["through_week"]]
        for r in A["rankings"]:
            pts = [m["winner_points"] for m in games if m["winner"] == r["manager"]] + \
                  [m["loser_points"] for m in games if m["loser"] == r["manager"]]
            self.assertAlmostEqual(r["ppw"], round(sum(pts) / len(pts), 1), places=1)
            self.assertEqual(sorted(r["weekly"]), sorted(pts))

    def test_every_team_has_a_take(self):
        for r in A["rankings"]:
            self.assertTrue(r["take"].strip(), r["manager"])


class History(unittest.TestCase):
    def test_champions_match_seasons(self):
        for s in SEASONS:
            champs = [t["manager"] for t in A["history"]["teams"] for p in t["seasons"] if p["season"] == s["season"] and p["champion"]]
            self.assertEqual(champs, [s["champion"]] if s["champion"] else [])

    def test_finishes_are_one_to_twelve_each_season(self):
        for s in SEASONS:
            places = sorted(p["finish"] for t in A["history"]["teams"] for p in t["seasons"] if p["season"] == s["season"])
            self.assertEqual(places, list(range(1, len(s["standings"]) + 1)), s["season"])


if __name__ == "__main__":
    unittest.main()
