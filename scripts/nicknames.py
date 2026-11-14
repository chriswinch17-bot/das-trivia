"""NBA player nicknames from data/player_nicknames.json (owner-editable), checked before use."""

import json
import re
import sys
import unicodedata
from pathlib import Path

FILE = Path(__file__).resolve().parent.parent / "data" / "player_nicknames.json"


def _key(text):
    text = unicodedata.normalize("NFD", text)
    return re.sub(r"[^a-z0-9]", "", "".join(c for c in text if not unicodedata.combining(c)).lower())


def load_nicknames(known_names):
    """{player name: [nicknames]} for players in known_names. Stops if two players share a nickname."""
    if not FILE.exists():
        return {}
    raw = json.loads(FILE.read_text(encoding="utf-8")).get("nicknames", {})
    owner = {}
    out = {}
    for name, nicks in raw.items():
        if name not in known_names:
            print(f"  (nickname list: {name} isn't in the league data, skipped)")
            continue
        for nick in nicks:
            k = _key(nick)
            if k == _key(name):
                continue
            if k in owner and owner[k] != name:
                sys.exit(f"NICKNAME PROBLEM: '{nick}' is listed for both {owner[k]} and {name}.")
            owner[k] = name
            out.setdefault(name, []).append(nick)
    return out
