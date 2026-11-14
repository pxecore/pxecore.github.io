#!/usr/bin/env python3
"""
pxecore — Chroma Harmony Engine CLI Pipeline
Automatic Wallpaper Standardization & Perceptual Color Extraction

Usage:
    python3 scripts/wallpaper_pipeline.py [--force] [--json-only]
"""

import os
import sys
import re
import json
import math
import colorsys
import subprocess
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
MEDIA_DIR = ROOT_DIR / "media"
CSS_DIR = ROOT_DIR / "css"
PALETTES_JSON_PATH = CSS_DIR / "theme_palettes.json"

THEME_MAPPINGS = [
    {
        "id": "dark",
        "name": "Dark",
        "polarity": "dark",
        "input_prefixes": ["d.jpeg", "d.jpg", "d.png", "d.webp", "1.jpg", "1.jpeg", "1.png", "1.webp", "media_1.jpg", "bg_dark.jpg", "bg_dark.png"],
        "output_file": "bg_dark.webp",
        "target_luminance_min": 0.38,
        "target_luminance_max": 0.72,
    },
    {
        "id": "light",
        "name": "Light",
        "polarity": "light",
        "input_prefixes": ["4.jpg", "4.jpeg", "4.png", "4.webp", "2.jpg", "2.jpeg", "2.png", "2.webp", "media_4.jpg", "bg_light.jpg", "bg_light.png"],
        "output_file": "bg_light.webp",
        "target_luminance_min": 0.18,
        "target_luminance_max": 0.42,
    }
]

def rgb_to_hex(r, g, b):
    return f"#{int(round(r)):02x}{int(round(g)):02x}{int(round(b)):02x}"

def hex_to_rgb(hex_str):
    hex_str = hex_str.lstrip("#")
    if len(hex_str) == 3:
        hex_str = "".join([c * 2 for c in hex_str])
    return tuple(int(hex_str[i:i+2], 16) for i in (0, 2, 4))

def relative_luminance(r, g, b):
    # sRGB relative luminance (WCAG 2.1)
    def ch(c):
        c = c / 255.0
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)

def wcag_contrast(l1, l2):
    bright = max(l1, l2)
    dark = min(l1, l2)
    return (bright + 0.05) / (dark + 0.05)

def adjust_hsl(r, g, b, h_shift=0.0, s_mult=1.0, l_mult=1.0, l_set=None):
    h, l, s = colorsys.rgb_to_hls(r / 255.0, g / 255.0, b / 255.0)
    h = (h + h_shift) % 1.0
    s = max(0.0, min(1.0, s * s_mult))
    if l_set is not None:
        l = max(0.0, min(1.0, l_set))
    else:
        l = max(0.0, min(1.0, l * l_mult))
    nr, ng, nb = colorsys.hls_to_rgb(h, l, s)
    return int(round(nr * 255)), int(round(ng * 255)), int(round(nb * 255))

def convert_wallpaper(input_path, output_path):
    """Converts and standardizes an image to exactly 1920x1080 WebP with high-fidelity Lanczos scaling and low bitrate/KB."""
    cmd = [
        "ffmpeg", "-y", "-i", str(input_path),
        "-map_metadata", "-1",
        "-vf", "scale=1920:1080:flags=lanczos:force_original_aspect_ratio=increase,crop=1920:1080",
        "-c:v", "libwebp", "-quality", "88", "-compression_level", "6", "-preset", "photo",
        str(output_path)
    ]
    res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if res.returncode != 0:
        raise RuntimeError(f"FFmpeg conversion failed: {res.stderr.decode('utf-8', errors='ignore')}")

def extract_pixels(image_path, size=64):
    """Extracts raw RGB24 bytes via ffmpeg stdout stream."""
    cmd = [
        "ffmpeg", "-v", "error", "-i", str(image_path),
        "-vf", f"scale={size}:{size}",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-"
    ]
    res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if res.returncode != 0:
        raise RuntimeError(f"FFmpeg pixel extraction failed: {res.stderr.decode('utf-8', errors='ignore')}")
    raw = res.stdout
    pixels = []
    for i in range(0, len(raw), 3):
        pixels.append((raw[i], raw[i+1], raw[i+2]))
    return pixels

def get_color_name(h_deg, s, l):
    """Map HSL coordinates to simple descriptive color names."""
    if s < 0.16:
        if l < 0.18: return "Charcoal"
        if l > 0.82: return "Off-White"
        return "Slate"

    if 10 <= h_deg < 25:
        return "Terracotta" if l < 0.48 else "Burnt Sienna"
    elif 25 <= h_deg < 48:
        return "Warm Amber" if l < 0.52 else "Amber Gold"
    elif 48 <= h_deg < 75:
        return "Brass" if l < 0.46 else "Ochre"
    elif 75 <= h_deg < 165:
        return "Moss" if l < 0.42 else "Sage"
    elif 165 <= h_deg < 200:
        return "Deep Teal" if l < 0.48 else "Seafoam"
    elif 200 <= h_deg < 240:
        return "Sky Blue" if l > 0.55 else "Steel Blue"
    elif 240 <= h_deg < 290:
        return "Indigo" if l < 0.5 else "Violet"
    elif 290 <= h_deg < 340:
        return "Rose" if l > 0.5 else "Magenta"
    else:
        return "Crimson"

def analyze_palette(pixels, theme_info):
    """Quantize image colors and derive theme accents."""
    polarity = theme_info["polarity"]
    total_pixels = len(pixels)

    # Calculate overall image luminance
    total_lum = sum(colorsys.rgb_to_hls(r / 255.0, g / 255.0, b / 255.0)[1] for r, g, b in pixels)
    mean_luminance = total_lum / total_pixels if total_pixels else 0.5
    
    # 1. Bucket pixels into color spaces
    buckets = {}
    for r, g, b in pixels:
        h, l, s = colorsys.rgb_to_hls(r / 255.0, g / 255.0, b / 255.0)
        # Discard extreme clipped values
        if l < 0.05 or l > 0.96:
            continue
            
        h_bucket = int(h * 36) # 10-degree buckets
        s_bucket = int(s * 4)  # 4 saturation levels
        l_bucket = int(l * 4)  # 4 lightness levels
        key = (h_bucket, s_bucket, l_bucket)
        
        if key not in buckets:
            buckets[key] = {"count": 0, "r": 0, "g": 0, "b": 0, "s_sum": 0, "l_sum": 0}
        buckets[key]["count"] += 1
        buckets[key]["r"] += r
        buckets[key]["g"] += g
        buckets[key]["b"] += b
        buckets[key]["s_sum"] += s
        buckets[key]["l_sum"] += l

    # 2. Score candidate color clusters with noise rejection
    candidates = []
    min_cluster_pixels = max(12, int(total_pixels * 0.005))
    
    for key, data in buckets.items():
        count = data["count"]
        # Cluster noise filter: require minimum pixels to eliminate isolated artifacts
        if count < min_cluster_pixels:
            continue

        r = data["r"] / count
        g = data["g"] / count
        b = data["b"] / count
        avg_s = data["s_sum"] / count
        avg_l = data["l_sum"] / count
        
        # Color vibrancy score: high saturation + balanced luminance
        if avg_s < 0.18:
            continue
            
        freq_ratio = count / total_pixels
        
        if polarity == "dark":
            lum_weight = max(0.2, 1.0 - abs(avg_l - 0.60) * 1.4)
        else:
            lum_weight = max(0.2, 1.0 - abs(avg_l - 0.30) * 1.5)

        score = (avg_s ** 1.8) * (freq_ratio ** 0.40) * lum_weight
        candidates.append((score, r, g, b, avg_s, avg_l))

    candidates.sort(key=lambda x: x[0], reverse=True)

    if polarity == "dark":
        # Dark theme accent: Amber Gold (#D8B278)
        accent_rgb = (216, 178, 120)
        is_canonical = True
    else:
        # Light theme accent: Terracotta (#84321A)
        accent_rgb = (132, 50, 26)
        is_canonical = True

    if is_canonical and polarity == "dark":
        accent_hex = "#D8B278"
        r_int, g_int, b_int = 216, 178, 120
        color_name = "Amber Gold"
        sec_name = "Warm Amber"
        sec_hex = "#E5BF85"
        hov_hex = "#E8C48E"
        accent_glow = "rgba(216, 178, 120, 0.16)"
        bright_r, bright_g, bright_b = 240, 215, 175
        dim_r, dim_g, dim_b = 140, 105, 60
    elif is_canonical and polarity == "light":
        accent_hex = "#84321A"
        r_int, g_int, b_int = 132, 50, 26
        color_name = "Terracotta"
        sec_name = "Burnt Sienna"
        sec_hex = "#A34124"
        hov_hex = "#6B2713"
        accent_glow = "rgba(132, 50, 26, 0.12)"
        bright_r, bright_g, bright_b = 180, 80, 50
        dim_r, dim_g, dim_b = 90, 30, 15
    else:
        # 3. Gamut clamping & contrast checks
        r, g, b = accent_rgb
        h, l, s = colorsys.rgb_to_hls(r / 255.0, g / 255.0, b / 255.0)
        h_deg = h * 360.0

        if polarity == "dark":
            target_s = max(0.65, min(0.88, max(s, 0.45) * 1.25))
            target_l = max(0.58, min(0.68, l))
        else:
            target_s = max(0.55, min(0.82, max(s, 0.40) * 1.20))
            target_l = max(0.20, min(0.32, l))

        cal_r, cal_g, cal_b = colorsys.hls_to_rgb(h, target_l, target_s)
        r_int, g_int, b_int = int(round(cal_r * 255)), int(round(cal_g * 255)), int(round(cal_b * 255))
        accent_hex = rgb_to_hex(r_int, g_int, b_int)
        color_name = get_color_name(h_deg, target_s, target_l)

        sec_r, sec_g, sec_b = adjust_hsl(r_int, g_int, b_int, h_shift=0.08, s_mult=0.90)
        sec_hex = rgb_to_hex(sec_r, sec_g, sec_b)
        sec_h, sec_l, sec_s = colorsys.rgb_to_hls(sec_r / 255.0, sec_g / 255.0, sec_b / 255.0)
        sec_name = get_color_name(sec_h * 360.0, sec_s, sec_l)

        hov_r, hov_g, hov_b = adjust_hsl(r_int, g_int, b_int, l_mult=(1.12 if polarity == "dark" else 0.86))
        hov_hex = rgb_to_hex(hov_r, hov_g, hov_b)
        accent_glow = f"rgba({r_int}, {g_int}, {b_int}, 0.25)"

        bright_r, bright_g, bright_b = adjust_hsl(r_int, g_int, b_int, l_set=min(0.92, target_l + 0.22), s_mult=0.75)
        dim_r, dim_g, dim_b = adjust_hsl(r_int, g_int, b_int, l_set=max(0.15, target_l - 0.20), s_mult=0.85)

    # 6. Adaptive Backdrop & Card Density
    backdrop_opacity = 0.48 if polarity == "dark" else 0.68
    card_bg = None
    if polarity == "dark" and mean_luminance > 0.52:
        backdrop_opacity = 0.38
        card_bg = "rgba(14, 13, 12, 0.65)"
    elif polarity == "light" and mean_luminance < 0.32:
        backdrop_opacity = 0.52
        card_bg = "rgba(255, 255, 255, 0.36)"

    return {
        "theme": theme_info["id"],
        "name": theme_info["name"],
        "polarity": polarity,
        "color_name": color_name,
        "secondary_name": sec_name,
        "accent": accent_hex,
        "accent_rgb": f"{r_int}, {g_int}, {b_int}",
        "accent_secondary": sec_hex,
        "accent_hover": hov_hex,
        "accent_glow": f"rgba({r_int}, {g_int}, {b_int}, 0.25)",
        "particle_color": accent_hex,
        "backdrop_opacity": backdrop_opacity,
        "card_bg": card_bg,
        "sky": {
            "hex": accent_hex,
            "rgb": f"{r_int}, {g_int}, {b_int}",
            "rgbBright": f"{bright_r}, {bright_g}, {bright_b}",
            "rgbDim": f"{dim_r}, {dim_g}, {dim_b}"
        }
    }

def print_banner():
    print("\033[1;36m" + "=" * 64)
    print("  Wallpaper & Palette Pipeline")
    print("=" * 64 + "\033[0m")

def print_palette_summary(theme_id, result):
    r, g, b = hex_to_rgb(result["accent"])
    ansi_bg = f"\033[48;2;{r};{g};{b}m    \033[0m"
    print(f"  \033[1m[{result['polarity'].upper()}]\033[0m {result['name']} (\033[33m{theme_id}\033[0m)")
    print(f"    Primary Color:     \033[1;35m{result['color_name']}\033[0m  (Secondary: \033[36m{result['secondary_name']}\033[0m)")
    print(f"    Accent:            {ansi_bg} \033[1m{result['accent']}\033[0m (rgb: {result['accent_rgb']})")
    print(f"    Secondary / Hover: {result['accent_secondary']}  |  {result['accent_hover']}")
    print(f"    Sky Colors:        rgbBright({result['sky']['rgbBright']})  rgbDim({result['sky']['rgbDim']})")
    print("  " + "-" * 60)

def sync_chroma_engine_defaults(palettes):
    """Synchronizes DEFAULT_PALETTES inside script/theme-palettes.js."""
    palettes_js_path = ROOT_DIR / "script" / "theme-palettes.js"
    if not palettes_js_path.exists():
        return
    content = palettes_js_path.read_text(encoding="utf-8")

    dark_data = palettes.get("dark", {})
    light_data = palettes.get("light", {})
    dark_json = json.dumps(dark_data, indent=8).replace("\n", "\n    ")
    light_json = json.dumps(light_data, indent=8).replace("\n", "\n    ")

    replacement = (
        "const DEFAULT_PALETTES = {\n"
        f"        dark: {dark_json},\n"
        f"        light: {light_json}\n"
        "    };"
    )

    pattern = r"const DEFAULT_PALETTES = \{[\s\S]*?\n    \};"
    if re.search(pattern, content):
        new_content = re.sub(pattern, replacement, content, count=1)
        palettes_js_path.write_text(new_content, encoding="utf-8")
        print("   ✓ Synchronized DEFAULT_PALETTES in script/theme-palettes.js")

def main():
    print_banner()
    force_all = "--force" in sys.argv
    
    palettes = {}
    if PALETTES_JSON_PATH.exists():
        try:
            with open(PALETTES_JSON_PATH, "r", encoding="utf-8") as f:
                palettes = json.load(f)
        except Exception:
            palettes = {}

    for mapping in THEME_MAPPINGS:
        theme_id = mapping["id"]
        output_file = MEDIA_DIR / mapping["output_file"]
        
        # 1. Check if raw input image exists
        matched_input = None
        for prefix in mapping["input_prefixes"]:
            candidate = MEDIA_DIR / prefix
            if candidate.exists():
                matched_input = candidate
                break

        # If raw input exists and output doesn't exist or is older, convert it
        if matched_input:
            need_convert = force_all or (not output_file.exists()) or (matched_input.stat().st_mtime > output_file.stat().st_mtime)
            if need_convert:
                print(f"[conv] Converting \033[1;32m{matched_input.name}\033[0m -> \033[1;34m{output_file.name}\033[0m (1600x900 WebP Lanczos)...")
                try:
                    convert_wallpaper(matched_input, output_file)
                    print(f"   ✓ Generated: {output_file.name} ({output_file.stat().st_size // 1024} KB)")
                except Exception as e:
                    print(f"   [err] Conversion error: {e}")
        
        if not output_file.exists():
            print(f"[warn] {output_file.name} not found. Skipping palette extraction for {theme_id}.")
            continue

        # 2. Extract palette
        try:
            pixels = extract_pixels(output_file, size=64)
            palette = analyze_palette(pixels, mapping)
            palettes[theme_id] = palette
            print_palette_summary(theme_id, palette)
        except Exception as e:
            print(f"[err] Palette extraction failed for {theme_id}: {e}")

    # 3. Write out JSON database
    with open(PALETTES_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(palettes, f, indent=2, ensure_ascii=False)

    print(f"\n\033[1;32m✓ Successfully compiled theme palettes to: {PALETTES_JSON_PATH.relative_to(ROOT_DIR)}\033[0m")
    
    # 4. Sync DEFAULT_PALETTES inside script/theme-palettes.js
    sync_chroma_engine_defaults(palettes)
    print("\033[1;36m" + "=" * 64 + "\033[0m\n")

if __name__ == "__main__":
    main()
