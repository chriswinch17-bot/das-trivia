"""Every Das Trivia question passes scripts/check_questions.py. Run: python -m unittest discover tests"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
from check_questions import check  # noqa: E402


class Questions(unittest.TestCase):
    def test_no_problems(self):
        problems, _ = check()
        self.assertEqual(problems, [], "\n".join(problems[:20]))


if __name__ == "__main__":
    unittest.main()
