"""Make a short cartoon fart sound (site/sounds/fart.wav) from scratch, no recordings needed.

Usage: python scripts/make_fart.py
A low, wobbling buzz: a sawtooth whose pitch drifts and flutters, rough noise mixed in, and a few
"bubbles" in the volume, fading out at the end.
"""

import math
import random
import struct
import wave
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "site" / "sounds" / "fart.wav"
RATE = 22050
SECONDS = 1.3


def main():
    rng = random.Random(69)
    n = int(RATE * SECONDS)
    samples, phase, rough = [], 0.0, 0.0
    for i in range(n):
        t = i / RATE
        pitch = 95 - 35 * (t / SECONDS) + 9 * math.sin(2 * math.pi * 7.5 * t) + rng.uniform(-6, 6)
        phase = (phase + pitch / RATE) % 1.0
        saw = 2 * phase - 1
        rough = 0.85 * rough + 0.15 * rng.uniform(-1, 1)            # low rumbly noise
        bubbles = 0.6 + 0.4 * abs(math.sin(2 * math.pi * 3.2 * t + 0.6 * math.sin(2 * math.pi * 1.1 * t)))
        envelope = min(1.0, t / 0.03) * (1.0 if t < SECONDS - 0.35 else max(0.0, (SECONDS - t) / 0.35))
        value = (0.75 * saw + 0.5 * rough) * bubbles * envelope
        samples.append(max(-1.0, min(1.0, value)))
    OUT.parent.mkdir(exist_ok=True)
    with wave.open(str(OUT), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(b"".join(struct.pack("<h", int(s * 26000)) for s in samples))
    print(f"wrote {OUT.relative_to(OUT.parents[2])} ({OUT.stat().st_size // 1024} KB, {SECONDS} s)")


if __name__ == "__main__":
    main()
