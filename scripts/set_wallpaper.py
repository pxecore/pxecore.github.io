#!/usr/bin/env python3
"""
Quick wallpaper switcher & converter CLI for pxecore.
Supports any arbitrary image (jpg, jpeg, png, webp) or slug name.

Usage:
    python3 scripts/set_wallpaper.py dark <path_or_slug>
    python3 scripts/set_wallpaper.py light <path_or_slug>
"""

import os
import sys
import shutil
import subprocess
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
MEDIA_DIR = ROOT_DIR / "media"
WALLPAPERS_DIR = MEDIA_DIR / "wallpapers"
ART_DIR = MEDIA_DIR / "art_collection"

def convert_to_webp(input_path, output_path):
    """Converts image to 1920x1080 WebP via ffmpeg Lanczos."""
    cmd = [
        "ffmpeg", "-y", "-i", str(input_path),
        "-vf", "scale=1920:1080:flags=lanczos:force_original_aspect_ratio=increase,crop=1920:1080",
        "-c:v", "libwebp", "-quality", "82", "-compression_level", "6", "-preset", "photo",
        str(output_path)
    ]
    res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if res.returncode != 0:
        raise RuntimeError(f"FFmpeg conversion failed: {res.stderr.decode('utf-8', errors='ignore')}")

def main():
    if len(sys.argv) < 3:
        print("Usage: python3 scripts/set_wallpaper.py [dark|light] [path_or_slug]")
        print("Example: python3 scripts/set_wallpaper.py dark 1.jpeg")
        print("         python3 scripts/set_wallpaper.py light /path/to/art.png")
        sys.exit(1)

    theme = sys.argv[1].lower()
    raw_query = sys.argv[2]

    if theme not in ("dark", "light"):
        print("Error: theme must be 'dark' or 'light'")
        sys.exit(1)

    target_bg = MEDIA_DIR / f"bg_{theme}.webp"

    # Find matching wallpaper
    matched = None
    p_query = Path(raw_query)

    if p_query.is_file():
        matched = p_query.resolve()
    elif (MEDIA_DIR / raw_query).is_file():
        matched = (MEDIA_DIR / raw_query).resolve()
    elif (WALLPAPERS_DIR / raw_query).is_file():
        matched = (WALLPAPERS_DIR / raw_query).resolve()
    elif (ART_DIR / raw_query).is_file():
        matched = (ART_DIR / raw_query).resolve()
    else:
        # Search by partial slug in ART_DIR and WALLPAPERS_DIR
        q_lower = raw_query.lower()
        patterns = [f"**/*{q_lower}*.webp", f"**/*{q_lower}*.jpg", f"**/*{q_lower}*.jpeg", f"**/*{q_lower}*.png"]
        candidates = []
        for pat in patterns:
            candidates.extend(list(MEDIA_DIR.glob(pat)))
            candidates.extend(list(ART_DIR.glob(pat)))
            candidates.extend(list(WALLPAPERS_DIR.glob(pat)))
        
        # Filter out bg_dark.webp and bg_light.webp if query wasn't specifically looking for them
        filtered = [c for c in candidates if c.name not in ("bg_dark.webp", "bg_light.webp")]
        if filtered:
            matched = filtered[0]
        elif candidates:
            matched = candidates[0]

    if not matched or not matched.exists():
        print(f"❌ Error: Could not find wallpaper matching '{raw_query}'")
        sys.exit(1)

    print(f"🖼️ Found source wallpaper: {matched}")
    if matched.suffix.lower() == ".webp" and matched.stat().st_size < 800 * 1024:
        shutil.copy2(matched, target_bg)
        print(f"✓ Copied {matched.name} to {target_bg.name}")
    else:
        print(f"🔄 Standardizing to 1920x1080 Lanczos WebP: {target_bg.name}...")
        convert_to_webp(matched, target_bg)
        print(f"✓ Generated {target_bg.name} ({target_bg.stat().st_size // 1024} KB)")

    # Run chroma pipeline
    pipeline = ROOT_DIR / "scripts" / "wallpaper_pipeline.py"
    if pipeline.exists():
        subprocess.run([sys.executable, str(pipeline), "--force"])
        print("✓ Chroma Harmony Engine synchronized theme palette and engine defaults!")

if __name__ == "__main__":
    main()
