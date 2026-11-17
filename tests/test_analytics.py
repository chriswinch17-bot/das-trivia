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

    def test_fraud_stamp_only_for_teams_winning_beyond_their_scoring(self):
        for r in A["rankings"]:
            self.assertEqual(r["fraud"], A["through_week"] >= 3 and r["luck"] >= 0.75, r["manager"])

    def test_playoff_odds_add_up(self):
        if not A["rankings"] or A["rankings"][0].get("playoff_pct") is None:
            self.skipTest("no playoff odds yet")
        n = next(s for s in SEASONS if s["season"] == A["season"])["playoff_teams"]
        self.assertAlmostEqual(sum(r["playoff_pct"] for r in A["rankings"]), n * 100, delta=1)
        self.assertAlmostEqual(sum(r["title_pct"] for r in A["rankings"]), 100, delta=1)
        for r in A["rankings"]:
            self.assertLessEqual(r["title_pct"], r["playoff_pct"] + 0.1)
            self.assertLessEqual(r["bye_pct"], r["playoff_pct"] + 0.1)

    def test_every_team_has_a_take(self):
        for r in A["rankings"]:
            self.assertTrue(r["take"].strip(), r["manager"])


TRADES = json.loads((SITE / "trades.json").read_text(encoding="utf-8"))


class TradeReportCards(unittest.TestCase):
    def test_every_trade_is_listed_once(self):
        self.assertEqual(sorted(t["id"] for t in A["trades"]), sorted(t["id"] for t in TRADES))

    def test_sides_match_the_trade(self):
        by_id = {t["id"]: t for t in TRADES}
        for t in A["trades"]:
            src = by_id[t["id"]]
            for side in t["sides"]:
                got = next(s for s in src["sides"] if s["manager"] == side["manager"])
                self.assertEqual(sorted(p["name"] for p in side["players"]), sorted(got["receives_players"]), t["id"])
                self.assertEqual(len(side["picks"]), len(got["receives_picks"]), t["id"])
                self.assertAlmostEqual(side["total"], sum(p["pts"] for p in side["players"] + side["picks"]), places=0)

    def test_only_settled_trades_get_grades(self):
        for t in A["trades"]:
            for s in t["sides"]:
                self.assertEqual(s["grade"] is not None, t["status"] == "graded", t["id"])
            if any(p["status"] == "pending" for s in t["sides"] for p in s["picks"]):
                self.assertEqual(t["status"], "pending")

    def test_winner_never_gets_the_worse_grade(self):
        order = ["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "D", "F"]
        for t in A["trades"]:
            if t["status"] != "graded":
                continue
            ranked = sorted(t["sides"], key=lambda s: -s["total"])
            self.assertLessEqual(order.index(ranked[0]["grade"]), order.index(ranked[-1]["grade"]), t["id"])


class ManagerProfiles(unittest.TestCase):
    def test_trade_counts_match(self):
        for m in A["managers"]:
            self.assertEqual(m["trades"]["count"], sum(1 for t in TRADES if m["manager"] in t["managers"]), m["manager"])

    def test_titles_match_seasons(self):
        for m in A["managers"]:
            self.assertEqual(sorted(m["titles"]), sorted(s["season"] for s in SEASONS if s["champion"] == m["manager"]))

    def test_draft_ranks_and_trade_ranks_are_unique(self):
        self.assertEqual(sorted(m["drafts"]["rank"] for m in A["managers"]), list(range(1, A["teams"] + 1)))
        self.assertEqual(sorted(m["trades"]["rank"] for m in A["managers"]), list(range(1, A["teams"] + 1)))


class Rivalries(unittest.TestCase):
    def test_every_game_counted_once(self):
        R = A["rivalries"]
        playoff_games = sum(1 for s in SEASONS for g in s.get("playoffs") or [] if g.get("winner") and g.get("loser"))
        self.assertEqual(sum(len(p["games"]) for p in R["pairs"]), len(MATCHUPS))
        self.assertEqual(sum(len(p["playoffs"]) for p in R["pairs"]), playoff_games)
        self.assertEqual(sum(p["a_wins"] + p["b_wins"] + p["ties"] for p in R["pairs"]), len(MATCHUPS) + playoff_games)

    def test_records_match_official_results(self):
        for p in A["rivalries"]["pairs"]:
            a, b = p["a"], p["b"]
            reg = [m for m in MATCHUPS if {m["winner"], m["loser"]} == {a, b}]
            po = [g for s in SEASONS for g in s.get("playoffs") or [] if {g.get("winner"), g.get("loser")} == {a, b}]
            wins = sum(1 for m in reg if m["winner"] == a and not m["tie"]) + sum(1 for g in po if g["winner"] == a)
            self.assertEqual(p["a_wins"], wins, p["key"])

    def test_blowouts_skip_stat_correction_games(self):
        for p in A["rivalries"]["pairs"]:
            for g in (p["blowout"], p["closest"]):
                self.assertTrue(g is None or not g["flagged"], p["key"])


class PickLedger(unittest.TestCase):
    def test_every_future_pick_has_exactly_one_owner(self):
        L = A["ledger"]
        for y in map(str, L["years"]):
            for r in range(1, L["rounds"] + 1):
                owners = [(t["manager"], p["from"]) for t in L["teams"] for p in t["picks"][y] if p["round"] == r]
                self.assertEqual(sorted(f for _, f in owners), sorted(t["manager"] for t in L["teams"]), f"{y} round {r}")

    def test_counts_match_picks(self):
        for t in A["ledger"]["teams"]:
            for r, c in enumerate(t["count"], 1):
                self.assertEqual(c, sum(1 for ps in t["picks"].values() for p in ps if p["round"] == r))


class MatchupOdds(unittest.TestCase):
    def test_probabilities_and_lines_agree(self):
        for w in A["odds"]["weeks"]:
            seen = set()
            for g in w["games"]:
                self.assertTrue(0 < g["a_prob"] < 100)
                seen |= {g["a"], g["b"]}
                if g["favorite"]:
                    fav_ml = g["a_ml"] if g["favorite"] == g["a"] else g["b_ml"]
                    self.assertTrue(fav_ml.startswith("-"), g)
                    self.assertEqual(g["favorite"] == g["a"], g["a_proj"] >= g["b_proj"])
            self.assertEqual(len(seen), len(w["games"]) * 2, "a team plays twice in one week")


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
