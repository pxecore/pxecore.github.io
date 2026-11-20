#!/usr/bin/env python3
"""
sync_profile.py
Automated sync for Twitter/X Avatar and Banner for pxecore.
Runs server-side via GitHub Actions so visitors never contact X directly.
"""

import os
import sys
import json
import time
import urllib.request
import urllib.parse
import subprocess

ALLOWED_MEDIA_HOSTS = {"pbs.twimg.com", "abs.twimg.com", "unavatar.io"}


def is_trusted_media_url(url):
    if not url or not isinstance(url, str):
        return False
    try:
        parsed = urllib.parse.urlparse(url.strip())
    except Exception:
        return False
    if parsed.scheme != "https" or not parsed.hostname:
        return False
    host = parsed.hostname.lower().rstrip(".")
    return host in ALLOWED_MEDIA_HOSTS or any(host.endswith("." + h) for h in ALLOWED_MEDIA_HOSTS)

HANDLE = "pxecore"
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, ".."))
MEDIA_DIR = os.path.join(PROJECT_ROOT, "media")

AVATAR_WEBP_PATH = os.path.join(MEDIA_DIR, "avatar.webp")
BANNER_WEBP_PATH = os.path.join(MEDIA_DIR, "banner.webp")
STATE_PATH = os.path.join(MEDIA_DIR, ".profile_sync.json")
CHECK_INTERVAL_SECONDS = 86400  # Strict 24-hour check interval

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; PxecoreProfileSync/1.0)"
}

def fetch_json(url):
    if not url or not isinstance(url, str) or urllib.parse.urlparse(url.strip()).scheme != "https":
        return None
    # 1. Prefer curl for HTTP/2 & anti-fingerprint reliability in CI/Linux
    try:
        res = subprocess.run(
            ["curl", "-fsL", "--proto", "=https", "--max-time", "12", "-H", "User-Agent: Mozilla/5.0 (compatible; PxecoreProfileSync/1.0)", "--", url],
            capture_output=True,
            text=True
        )
        if res.returncode == 0 and res.stdout.strip():
            return json.loads(res.stdout)
    except Exception:
        pass

    # 2. Urllib fallback
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=12) as res:
            if res.status == 200:
                return json.loads(res.read().decode('utf-8'))
    except Exception as e:
        print(f"[-] Failed to fetch {url}: {e}")
    return None

def download_file(url, target_path):
    if not is_trusted_media_url(url):
        print(f"[-] Rejected untrusted media URL: {url}")
        return False
    # 1. Prefer curl for robust CDN downloading
    try:
        res = subprocess.run(
            ["curl", "-fsL", "--proto", "=https", "--max-time", "25", "-A", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "-o", target_path, "--", url],
            capture_output=True
        )
        if res.returncode == 0 and os.path.exists(target_path) and os.path.getsize(target_path) > 500:
            return True
    except Exception:
        pass

    # 2. Urllib fallback
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=15) as res:
            if res.status == 200:
                data = res.read()
                with open(target_path, "wb") as f:
                    f.write(data)
                return True
    except Exception as e:
        print(f"[-] Failed to download {url}: {e}")
    return False

def convert_to_webp(src_path, dest_path, quality=82, max_width=None):
    """
    Converts image to WebP with fine-tuned visual fidelity and low byte size:
    - -quality 78-82: Visually identical to high-res source, eliminates macroblocking
    - -compression_level 6: Max search depth for smallest payload
    - -preset photo: Optimized frequency filter matrices for human eyes
    """
    vf_args = ["-vf", f"scale='min({int(max_width)},iw)':-2:flags=lanczos"] if max_width else []

    # 1. Primary: Optimized libwebp
    try:
        cmd = [
            "ffmpeg", "-y", "-i", src_path,
            "-map_metadata", "-1",
            *vf_args,
            "-c:v", "libwebp",
            "-quality", str(quality),
            "-compression_level", "6",
            "-preset", "photo",
            dest_path
        ]
        res = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if res.returncode == 0 and os.path.exists(dest_path) and os.path.getsize(dest_path) > 500:
            return True
    except Exception:
        pass

    # 2. Fallback: Standard ffmpeg libwebp
    try:
        cmd = [
            "ffmpeg", "-y", "-i", src_path,
            "-map_metadata", "-1",
            *vf_args,
            "-c:v", "libwebp",
            "-quality", str(quality),
            dest_path
        ]
        res = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if res.returncode == 0 and os.path.exists(dest_path) and os.path.getsize(dest_path) > 500:
            return True
    except Exception:
        pass

    # 3. Last-ditch: Plain ffmpeg invocation
    try:
        cmd = ["ffmpeg", "-y", "-i", src_path, "-map_metadata", "-1", dest_path]
        res = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return res.returncode == 0 and os.path.exists(dest_path) and os.path.getsize(dest_path) > 500
    except Exception:
        return False

def main():
    print(f"[*] Starting Twitter/X profile sync for @{HANDLE}...")
    os.makedirs(MEDIA_DIR, exist_ok=True)

    saved_state = {}
    if os.path.exists(STATE_PATH):
        try:
            with open(STATE_PATH, "r") as sf:
                saved_state = json.load(sf)
        except Exception:
            saved_state = {}

    force = "--force" in sys.argv
    last_check = saved_state.get("last_check_timestamp", 0)
    time_since_check = time.time() - last_check

    # 24-hour rate limit check guard: do not query remote endpoints if already verified within 24h
    if not force and time_since_check < CHECK_INTERVAL_SECONDS and os.path.exists(AVATAR_WEBP_PATH) and os.path.exists(BANNER_WEBP_PATH):
        hours_left = (CHECK_INTERVAL_SECONDS - time_since_check) / 3600
        print(f"[=] Anti-Ban Guard: Verified within last 24h ({hours_left:.1f}h remaining). Exiting quietly.")
        return

    saved_state["last_check_timestamp"] = int(time.time())

    avatar_url = None
    banner_url = None

    # Try fxtwitter API with retry
    for attempt in range(3):
        data = fetch_json(f"https://api.fxtwitter.com/{HANDLE}")
        if data and data.get("code") == 200 and data.get("user"):
            user = data["user"]
            raw_avatar = user.get("avatar_url")
            if raw_avatar:
                # Request 400x400 instead of 48x48 (_normal)
                avatar_url = raw_avatar.replace("_normal.", "_400x400.")
            raw_banner = user.get("banner_url")
            if raw_banner:
                # Use high-res 1500x500 banner endpoint
                banner_url = f"{raw_banner}/1500x500" if not raw_banner.endswith("/1500x500") else raw_banner
            break
        time.sleep(2)

    # Fallback to vxtwitter if fxtwitter didn't provide avatar
    if not avatar_url:
        vx_data = fetch_json(f"https://api.vxtwitter.com/{HANDLE}")
        if vx_data:
            raw_avatar = vx_data.get("profile_image_url")
            if raw_avatar:
                avatar_url = raw_avatar.replace("_normal.", "_400x400.")

    # Fallback for avatar to unavatar.io ONLY for initial bootstrap (don't clobber good cache on transient API failure)
    if not avatar_url and not os.path.exists(AVATAR_WEBP_PATH):
        avatar_url = f"https://unavatar.io/x/{HANDLE}?size=400"

    avatar_changed = (avatar_url and avatar_url != saved_state.get("avatar_url")) or not os.path.exists(AVATAR_WEBP_PATH)
    banner_changed = (banner_url and banner_url != saved_state.get("banner_url")) or not os.path.exists(BANNER_WEBP_PATH)

    if not avatar_changed and not banner_changed:
        print("[=] Profile assets unchanged on Twitter/X. Zero requests sent to CDN. Exiting quietly.")
        return

    success_count = 0

    # 1. Sync Avatar ONLY if changed
    if avatar_changed and avatar_url:
        print(f"[+] Avatar updated on Twitter! Downloading: {avatar_url}")
        tmp_avatar = os.path.join(MEDIA_DIR, "avatar_tmp.jpg")
        try:
            if download_file(avatar_url, tmp_avatar) and os.path.getsize(tmp_avatar) > 1000:
                if convert_to_webp(tmp_avatar, AVATAR_WEBP_PATH, quality=82, max_width=160):
                    print(f"[✓] Avatar converted to WebP: {AVATAR_WEBP_PATH} ({os.path.getsize(AVATAR_WEBP_PATH)} bytes)")
                    saved_state["avatar_url"] = avatar_url
                    success_count += 1
        finally:
            if os.path.exists(tmp_avatar):
                os.remove(tmp_avatar)
    else:
        print("[=] Avatar is up-to-date.")

    # 2. Sync Banner ONLY if changed
    if banner_changed and banner_url:
        print(f"[+] Banner updated on Twitter! Downloading: {banner_url}")
        tmp_banner = os.path.join(MEDIA_DIR, "banner_tmp.jpg")
        try:
            if download_file(banner_url, tmp_banner) and os.path.getsize(tmp_banner) > 5000:
                if convert_to_webp(tmp_banner, BANNER_WEBP_PATH, quality=78, max_width=720):
                    print(f"[✓] Banner converted to WebP: {BANNER_WEBP_PATH} ({os.path.getsize(BANNER_WEBP_PATH)} bytes)")
                    saved_state["banner_url"] = banner_url
                    success_count += 1
        finally:
            if os.path.exists(tmp_banner):
                os.remove(tmp_banner)
    elif banner_url:
        print("[=] Banner is up-to-date.")

    # Persist updated state ONLY if an asset was actually updated (avoids noisy daily empty commits)
    if success_count > 0:
        try:
            with open(STATE_PATH, "w") as sf:
                json.dump(saved_state, sf, indent=2)
        except Exception as e:
            print(f"[-] Could not save sync state: {e}")

    print(f"[*] Done. {success_count} assets updated.")

if __name__ == "__main__":
    main()
