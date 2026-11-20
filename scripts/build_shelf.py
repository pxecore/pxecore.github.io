#!/usr/bin/env python3
"""
Build-time shelf pipeline for pxecore.

Reads data/shelf.json, resolves and caches optimized WebP covers into
media/shelf/<slug>.webp (gitignored, staged into _site/ during CI deploy),
and emits script/shelf-data.js so the site works identically on both
https:// (GitHub Pages) and file:// (local preview) with zero runtime
third-party requests.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_FILE = ROOT / "data" / "shelf.json"
OUT_MEDIA = ROOT / "media" / "shelf"
OUT_JS = ROOT / "script" / "shelf-data.js"

USER_AGENT = "pxecore-shelf-builder/1.0 (+https://pxecore.dev)"
MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024  # 10 MB safety cap
HTTP_TIMEOUT = 20

# Strict allowlist for cover downloads (prevents arbitrary host / SSRF fetches)
ALLOWED_IMAGE_HOSTS = {
    "covers.openlibrary.org",
    "static.tvmaze.com",
    "upload.wikimedia.org",
}


def slugify(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return s or "item"


def find_imagemagick() -> list[str]:
    for binary in ("magick", "convert"):
        path = shutil.which(binary)
        if path:
            return [path]
    raise RuntimeError("ImageMagick ('magick' or 'convert') is required.")


def is_allowed_image_host(hostname: str | None) -> bool:
    if not hostname:
        return False
    host = hostname.lower()
    if host in ALLOWED_IMAGE_HOSTS:
        return True
    return host.endswith(".archive.org")


def http_get_bytes(url: str, check_image_host: bool = False) -> bytes:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https":
        raise ValueError(f"Blocked non-HTTPS URL: {url}")
    if check_image_host and not is_allowed_image_host(parsed.hostname):
        raise ValueError(f"Blocked host '{parsed.hostname}' (not in allowlist)")

    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as resp:
        final_host = urllib.parse.urlparse(resp.geturl()).hostname
        if check_image_host and not is_allowed_image_host(final_host):
            raise ValueError(f"Blocked redirect host '{final_host}'")
        data = resp.read(MAX_DOWNLOAD_BYTES + 1)
        if len(data) > MAX_DOWNLOAD_BYTES:
            raise ValueError(f"Image exceeds {MAX_DOWNLOAD_BYTES} byte limit")
        return data


def http_get_json(url: str) -> dict:
    raw = http_get_bytes(url)
    return json.loads(raw.decode("utf-8"))


def lookup_book_cover(item: dict) -> str | None:
    q = urllib.parse.urlencode({
        "title": item["title"],
        "author": item.get("creator", ""),
        "language": "eng",
        "limit": "5",
    })
    data = http_get_json(f"https://openlibrary.org/search.json?{q}")
    for doc in data.get("docs", []):
        cid = doc.get("cover_i")
        if cid:
            return f"https://covers.openlibrary.org/b/id/{cid}-L.jpg"
    return None


def lookup_series_cover(item: dict) -> str | None:
    q = urllib.parse.urlencode({"q": item["title"]})
    data = http_get_json(f"https://api.tvmaze.com/singlesearch/shows?{q}")
    img = data.get("image") or {}
    return img.get("original") or img.get("medium")


def lookup_film_cover(item: dict) -> str | None:
    candidates: list[str] = []
    if item.get("wiki"):
        candidates.append(item["wiki"])
    else:
        base = item["title"].replace(" ", "_")
        year = str(item.get("year", "")).strip()
        if year:
            candidates.append(f"{base}_({year}_film)")
        candidates.append(f"{base}_(film)")
        candidates.append(base)

    for page in candidates:
        quoted = urllib.parse.quote(page, safe="_()'!-")
        url = f"https://en.wikipedia.org/api/rest_v1/page/summary/{quoted}"
        try:
            data = http_get_json(url)
        except (urllib.error.HTTPError, urllib.error.URLError, ValueError):
            continue
        if data.get("type") == "disambiguation":
            continue
        img = (data.get("originalimage") or data.get("thumbnail") or {}).get("source")
        if img:
            return img
    return None


def resolve_cover_url(item: dict, section: str) -> str | None:
    if item.get("source"):
        return str(item["source"]).strip()
    if section == "books":
        return lookup_book_cover(item)
    if item.get("kind") == "series":
        return lookup_series_cover(item)
    return lookup_film_cover(item)


def convert_to_webp(raw_bytes: bytes, dest: Path, im_cmd: list[str], trim: bool = False) -> None:
    with tempfile.NamedTemporaryFile(delete=False) as tmp:
        tmp.write(raw_bytes)
        tmp_path = Path(tmp.name)
    try:
        cmd = [*im_cmd, str(tmp_path), "-auto-orient", "-strip"]
        if trim:
            cmd += ["-fuzz", "20%", "-trim", "+repage"]
        cmd += ["-resize", "368x528>", "-quality", "84", str(dest)]
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    finally:
        tmp_path.unlink(missing_ok=True)


def cache_key(item: dict, section: str) -> str:
    payload = "|".join([
        section,
        item.get("title", ""),
        item.get("kind", "book"),
        item.get("source", ""),
        item.get("wiki", ""),
        "trim" if item.get("trim") else "",
    ])
    digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()[:12]
    return f"{slugify(item.get('title', 'item'))}-{digest}.webp"


def process_item(
    item: dict,
    section: str,
    cache_dir: Path,
    im_cmd: list[str],
    offline: bool,
) -> dict:
    out_entry = {
        "title": item["title"],
        "creator": item.get("creator", ""),
        "year": str(item.get("year", "")),
        "status": item.get("status", "queued"),
        "color": item.get("color", "#2B241E"),
        "cover": "",
        "note": item.get("note", ""),
    }
    if section == "watchlist":
        out_entry["kind"] = item.get("kind", "film")

    # 1. Explicit local custom cover (e.g. media/shelf-custom/1984.webp)
    custom = item.get("custom_cover")
    if custom:
        src_path = (ROOT / custom).resolve()
        if src_path.is_relative_to(ROOT) and src_path.is_file():
            out_entry["cover"] = custom
            return out_entry
        print(f"[warn] Custom cover missing: {custom}", file=sys.stderr)
        return out_entry

    # 2. Cached or fetched cover -> media/shelf/<slug>.webp
    slug = slugify(item["title"])
    if section == "watchlist" and item.get("kind") == "film":
        slug = f"{slug}-film"
    dest_rel = f"media/shelf/{slug}.webp"
    dest_abs = OUT_MEDIA / f"{slug}.webp"
    cached_file = cache_dir / cache_key(item, section)

    if cached_file.is_file() and cached_file.stat().st_size > 0:
        shutil.copy2(cached_file, dest_abs)
        out_entry["cover"] = dest_rel
        return out_entry

    if offline:
        if dest_abs.is_file() and dest_abs.stat().st_size > 0:
            out_entry["cover"] = dest_rel
        return out_entry

    try:
        url = resolve_cover_url(item, section)
        if not url:
            print(f"[warn] No cover URL found for {item['title']}", file=sys.stderr)
            return out_entry
        raw = http_get_bytes(url, check_image_host=True)
        convert_to_webp(raw, cached_file, im_cmd, trim=bool(item.get("trim")))
        shutil.copy2(cached_file, dest_abs)
        out_entry["cover"] = dest_rel
        print(f"[ok] {item['title']} -> {dest_rel}")
    except Exception as exc:
        print(f"[warn] Cover failed for {item['title']}: {exc}", file=sys.stderr)
        if dest_abs.is_file() and dest_abs.stat().st_size > 0:
            out_entry["cover"] = dest_rel

    return out_entry


def main() -> int:
    parser = argparse.ArgumentParser(description="Build optimized shelf covers and JS data.")
    parser.add_argument(
        "--cache-dir",
        default=str(Path.home() / ".cache" / "pxecore-shelf"),
        help="Persistent cache directory for converted WebP covers",
    )
    parser.add_argument(
        "--offline",
        action="store_true",
        help="Skip network lookups and reuse only cached/existing covers",
    )
    args = parser.parse_args()

    if not DATA_FILE.is_file():
        print(f"[error] Missing {DATA_FILE}", file=sys.stderr)
        return 1

    im_cmd = find_imagemagick()
    cache_dir = Path(args.cache_dir).expanduser()
    cache_dir.mkdir(parents=True, exist_ok=True)
    OUT_MEDIA.mkdir(parents=True, exist_ok=True)

    raw_data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    books = [
        process_item(item, "books", cache_dir, im_cmd, args.offline)
        for item in raw_data.get("books", [])
    ]
    watchlist = [
        process_item(item, "watchlist", cache_dir, im_cmd, args.offline)
        for item in raw_data.get("watchlist", [])
    ]

    # Prune stale generated WebPs in media/shelf/ that are no longer referenced
    active_files = {
        Path(entry["cover"]).name
        for entry in (*books, *watchlist)
        if entry["cover"].startswith("media/shelf/")
    }
    for existing in OUT_MEDIA.glob("*.webp"):
        if existing.name not in active_files:
            existing.unlink(missing_ok=True)

    payload = json.dumps({"books": books, "watchlist": watchlist}, ensure_ascii=False, indent=2)
    OUT_JS.write_text(
        "// Auto-generated by scripts/build_shelf.py from data/shelf.json — do not edit manually.\n"
        f"window.PXECORE_SHELF = {payload};\n",
        encoding="utf-8",
    )
    print(f"Built shelf: {len(books)} books, {len(watchlist)} watchlist items -> {OUT_JS.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
