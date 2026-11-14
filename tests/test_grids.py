"""Automated checks for DAS GRIDS. Run: python -m unittest discover tests"""

import itertools
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from build_grids import MIN_ANSWERS, REPEAT_WINDOW, matching  # noqa: E402
from grids_history import answers_for, build_history, is_deep_cut  # noqa: E402

LINKS, MANAGERS, NAMES = build_history()
SITE = ROOT / "site" / "data"
TRADES = json.loads((SITE / "trades.json").read_text(encoding="utf-8"))
DRAFTS = json.loads((SITE / "drafts.json").read_text(encoding="utf-8"))
GRIDS = json.loads((SITE / "grids.json").read_text(encoding="utf-8"))
BY_NAME = {name: pid for pid, name in NAMES.items()}   # names are unique after duplicates are merged


def on(manager, player_name):
    return (manager, BY_NAME[player_name]) in LINKS


class History(unittest.TestCase):
    def test_every_traded_player_counts_for_the_team_that_got_him(self):
        for t in TRADES:
            for side in t["sides"]:
                for name in side["receives_players"]:
                    self.assertTrue(on(side["manager"], name), f"{name} -> {side['manager']} ({t['date']})")

    def test_every_drafted_player_counts_for_the_team_that_drafted_him(self):
        for d in DRAFTS:
            for p in d["picks"]:
                self.assertTrue(on(p["manager"], p["player"]), f"{p['player']} drafted by {p['manager']}")

    def test_renamed_team_and_new_account_are_one_franchise(self):
        # Papo played 2023-2024 as papochullo7979 ("Luka Deez Nuts") and later as Papochullo6969.
        first_pick = next(p for p in DRAFTS[0]["picks"] if p["manager"] == "papo")
        self.assertTrue(on("papo", first_pick["player"]))
        later = next(t for t in TRADES if t["season"] == "2025-2026" and "papo" in t["managers"])
        got = next(s for s in later["sides"] if s["manager"] == "papo")["receives_players"]
        self.assertTrue(all(on("papo", n) for n in got))
        self.assertFalse(any(mid not in MANAGERS for mid, _ in LINKS))

    def test_brief_pickups_count(self):
        brief = [k for k, v in LINKS.items() if not v["weeks"] and "free agent pickup" in v["sources"]]
        self.assertGreater(len(brief), 50, "players picked up and dropped between weeks should still count")

    def test_trades_undone_the_same_day_do_not_count(self):
        # Quenton Jackson went from Winch to Papo on 2026-03-02 and straight back the same day.
        link = LINKS.get(("papo", BY_NAME["Quenton Jackson"]))
        self.assertTrue(link is None or link["sources"] != {"trade"})

    def test_players_traded_between_two_teams_are_answers_for_that_pair(self):
        for t in TRADES:
            if len(t["managers"]) != 2:
                continue
            a, b = t["managers"]
            for side in t["sides"]:
                for name in side["receives_players"]:
                    gave = b if side["manager"] == a else a
                    if ("weekly lineup" in LINKS.get((gave, BY_NAME[name]), {}).get("sources", set())
                            or (gave, BY_NAME[name]) in LINKS):
                        self.assertIn(BY_NAME[name], answers_for(LINKS, a, b))

    def test_each_name_appears_once(self):
        self.assertEqual(len(set(NAMES.values())), len(NAMES))
        self.assertEqual(len([n for n in NAMES.values() if n == "Matas Buzelis"]), 1)

    def test_deep_cuts_are_a_minority(self):
        total = cuts = 0
        for a, b in itertools.combinations(MANAGERS, 2):
            for pid in answers_for(LINKS, a, b):
                total += 1
                cuts += is_deep_cut(LINKS, a, b, pid)
        self.assertLess(cuts / total, 0.35)


class Puzzles(unittest.TestCase):
    def check(self, p):
        self.assertEqual(len(set(p["rows"]) | set(p["cols"])), 6, p["id"])
        squares = [answers_for(LINKS, r, c) for r in p["rows"] for c in p["cols"]]
        self.assertGreaterEqual(min(map(len, squares)), MIN_ANSWERS, p["id"])
        self.assertTrue(matching(squares), f"{p['id']} can't be filled with 9 different players")

    def test_every_daily_grid_is_solvable(self):
        for p in GRIDS["daily"]:
            self.check(p)

    def test_every_unlimited_grid_is_solvable(self):
        for p in GRIDS["unlimited"]:
            self.check(p)

    def test_daily_grids_do_not_repeat_soon(self):
        keys = [(frozenset(p["rows"]), frozenset(p["cols"])) for p in GRIDS["daily"]]
        for i, k in enumerate(keys):
            window = keys[max(0, i - REPEAT_WINDOW):i]
            self.assertNotIn(k, window)
            self.assertNotIn((k[1], k[0]), window)

    def test_ids_are_stable_and_unique(self):
        ids = [p["id"] for p in GRIDS["daily"] + GRIDS["unlimited"]]
        self.assertEqual(len(ids), len(set(ids)))

    def test_matching_rejects_impossible_grids(self):
        self.assertFalse(matching([{"x"}] * 9))
        self.assertTrue(matching([{str(i)} for i in range(9)]))

    def test_public_file_holds_no_answers(self):
        self.assertEqual(set(GRIDS), {"title", "start_date", "reset_hour_et", "teams", "daily", "unlimited",
                                      "search", "players", "deep_cut_weeks", "league_size"})
        rostered = {pid for _, pid in LINKS}
        searchable = {row[0] for row in GRIDS["search"]}
        self.assertTrue(rostered < searchable, "search must also list players nobody rostered")


if __name__ == "__main__":
    unittest.main()
