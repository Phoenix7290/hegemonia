#!/usr/bin/env python3
"""
Hegemonia — Audio Assets Downloader & SFX Processor
Downloads requested historical & Hoi4 soundtracks and military SFX for local testing.
These audio files are ignored by git (.gitignore) to keep the repository clean and legal.
"""

import os
import shutil
import subprocess
import sys

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
MUSIC_DIR = os.path.join(BASE_DIR, "apps/web/public/music")
SFX_DIR = os.path.join(BASE_DIR, "apps/web/public/sfx")
TMP_DIR = "/tmp/hegemonia_audio_tmp"

TRACKS = [
    ("https://youtu.be/A_kGaUY5cUM", "hoi4_axis_theme.mp3"),
    ("https://youtu.be/xSjnN39Qhmc", "hoi4_katyusha.mp3"),
    ("https://www.youtube.com/watch?v=Ee13rPImb1I", "the_second_european_war.mp3"),
    ("https://www.youtube.com/watch?v=JqquBi4X31U", "tno_taboritsky_theme.mp3"),
    ("https://www.youtube.com/watch?v=6PxlJLUqFzY", "hoi4_great_patriotic_war.mp3"),
    ("https://www.youtube.com/watch?v=S0HqDefYnUw", "teufelslied.mp3"),
    ("https://www.youtube.com/watch?v=ZJ26fFLNLB4", "tno_burgundian_lullaby.mp3"),
    ("https://www.youtube.com/watch?v=u-qTuXDEnFo", "hoi4_bella_ciao.mp3"),
]

SFX_ITEMS = [
    ("https://www.youtube.com/watch?v=dEHqgEjNsms", "raw_dice.mp3", "sfx_dice.mp3", "00:00:00", "1.5"),
    ("https://www.youtube.com/watch?v=Lfw33ThIEbs", "raw_artillery.mp3", "sfx_combat.mp3", "00:00:00", "2.0"),
    ("https://www.youtube.com/watch?v=8jytEvJKrY4", "raw_hoi4_war.mp3", "sfx_conquest.mp3", "00:00:00", "3.2"),
    ("https://www.youtube.com/watch?v=vvMK6ThY1Ss", "raw_bell.mp3", "sfx_turn.mp3", "00:00:00", "2.2"),
]


def find_ytdlp():
    candidates = [
        shutil.which("yt-dlp"),
        "/home/ai/.venv_tools/bin/yt-dlp",
        os.path.expanduser("~/.local/bin/yt-dlp"),
    ]
    for c in candidates:
        if c and os.path.exists(c) and os.access(c, os.X_OK):
            return c
    return None


def main():
    os.makedirs(MUSIC_DIR, exist_ok=True)
    os.makedirs(SFX_DIR, exist_ok=True)
    os.makedirs(TMP_DIR, exist_ok=True)

    ytdlp = find_ytdlp()
    if not ytdlp:
        print("ERROR: yt-dlp was not found on your system.")
        print("Install it with: pip install --user yt-dlp (or pacman -S yt-dlp)")
        sys.exit(1)

    if not shutil.which("ffmpeg"):
        print("ERROR: ffmpeg was not found on your system.")
        sys.exit(1)

    print("=== Hegemonia Audio Asset Setup ===")
    print(f"Destination Music: {MUSIC_DIR}")
    print(f"Destination SFX:   {SFX_DIR}\n")

    # 1. Download Music
    for url, filename in TRACKS:
        target = os.path.join(MUSIC_DIR, filename)
        if os.path.exists(target) and os.path.getsize(target) > 100000:
            print(f"[SKIP] Music already present: {filename}")
            continue
        print(f"[MUSIC] Downloading {filename}...")
        subprocess.run([
            ytdlp,
            "--extract-audio",
            "--audio-format", "mp3",
            "--audio-quality", "0",
            "-o", os.path.join(MUSIC_DIR, filename.replace(".mp3", "") + ".%(ext)s"),
            url
        ], check=True)

    # 2. Download and Trim SFX
    for url, raw_name, final_name, start_t, duration in SFX_ITEMS:
        final_path = os.path.join(SFX_DIR, final_name)
        if os.path.exists(final_path) and os.path.getsize(final_path) > 1000:
            print(f"[SKIP] SFX already present: {final_name}")
            continue
        raw_path = os.path.join(TMP_DIR, raw_name)
        print(f"[SFX] Downloading {final_name} source...")
        subprocess.run([
            ytdlp,
            "--extract-audio",
            "--audio-format", "mp3",
            "--audio-quality", "0",
            "-o", os.path.join(TMP_DIR, raw_name.replace(".mp3", "") + ".%(ext)s"),
            url
        ], check=True)

        print(f"[SFX] Processing & Trimming {final_name}...")
        subprocess.run([
            "ffmpeg", "-y",
            "-ss", start_t,
            "-i", raw_path,
            "-t", duration,
            "-c:a", "libmp3lame",
            "-q:a", "2",
            final_path
        ], check=True)

    print("\nAll Hegemonia soundtracks and tactical SFX are ready to play!")


if __name__ == "__main__":
    main()
