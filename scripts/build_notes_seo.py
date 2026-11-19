#!/usr/bin/env python3
"""
build_notes_seo.py

Reads the markdown notes from github.com/pxecore/notes and generates, for the
GitHub Pages site:
  notes/<slug>/index.html   static, crawlable page (meta, OG, JSON-LD, full text)
  notes/<slug>/og.png       typographic 1200x630 social card (no imagery)
  sitemap.xml, feed.xml, llms.txt, llms-full.txt

Design rules:
  - Idempotent: unchanged input produces byte-identical output (no empty commits).
  - Fail-safe: any fetch error aborts before anything is written or deleted.
  - Stdlib only; ImageMagick is optional (falls back to media/og.webp).
"""

import base64
import hashlib
import html
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date

OWNER, REPO, POSTS_DIR = "pxecore", "notes", "posts"
SITE = "https://pxecore.github.io"
AUTHOR = "pxecore"

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT = os.path.join(ROOT, "notes")
STATE_PATH = os.path.join(ROOT, "scripts", "notes_state.json")

HEADERS = {"User-Agent": "pxecore-notes-build/2.0", "Accept": "application/vnd.github+json"}
if os.environ.get("GITHUB_TOKEN"):
    HEADERS["Authorization"] = "Bearer " + os.environ["GITHUB_TOKEN"].strip()


# ---------------------------------------------------------------- fetching

def http_get(url, tries=3):
    last = None
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=20) as r:
                return r.read().decode("utf-8")
        except urllib.error.HTTPError as e:
            last = e
            if e.code in (401, 403, 404):
                break
        except Exception as e:  # network hiccup
            last = e
        time.sleep(2 * (attempt + 1))
    raise RuntimeError("GET %s failed: %s" % (url, last))


def fetch_notes():
    tree = json.loads(http_get(
        "https://api.github.com/repos/%s/%s/git/trees/main?recursive=1" % (OWNER, REPO)))
    if tree.get("truncated"):
        raise RuntimeError("repository tree truncated")
    paths = sorted(
        i["path"] for i in tree.get("tree", [])
        if i.get("type") == "blob" and i["path"].startswith(POSTS_DIR + "/") and i["path"].endswith(".md"))
    if not paths:
        raise RuntimeError("no markdown notes found (refusing to wipe existing output)")
    notes = []
    for p in paths:
        raw = http_get("https://raw.githubusercontent.com/%s/%s/main/%s" % (
            OWNER, REPO, urllib.parse.quote(p)))
        notes.append((p, raw))
    return notes


def commit_date(path):
    """Last commit date of a note (only used when the note has no `date:`)."""
    try:
        data = json.loads(http_get(
            "https://api.github.com/repos/%s/%s/commits?path=%s&per_page=1" % (
                OWNER, REPO, urllib.parse.quote(path))))
        return data[0]["commit"]["committer"]["date"][:10]
    except Exception:
        return date.today().isoformat()


# ----------------------------------------------------------------- parsing

def slugify(text):
    s = re.sub(r"[^a-z0-9]+", "-", text.strip().lower()).strip("-")
    return s or "section"


_VALID_META_KEYS = {
    "title", "date", "description", "desc", "summary", "author", "signer",
    "tags", "topics", "category", "cat", "image", "cover", "thumbnail",
    "readtime", "read_time", "read-time", "icon", "logo"
}


def _is_valid_meta_block(raw_meta):
    lines = [l.strip() for l in raw_meta.splitlines() if l.strip()]
    has_key = any(l.split(":", 1)[0].strip().lower() in _VALID_META_KEYS for l in lines if ":" in l)
    has_noise = any(l.startswith(("#", "```", "~~~", ">")) for l in lines)
    return has_key and not has_noise


def _strip_trailing_wrapper_closer(tail, wrapper_char, wrapper_len):
    lines = tail.splitlines()
    in_inner, inner_char, inner_len = False, "", 0
    for i, line in enumerate(lines):
        if in_inner:
            cm = re.match(r"^[ \t]*(`{3,}|~{3,})[ \t]*$", line)
            if cm and cm.group(1)[0] == inner_char and len(cm.group(1)) >= inner_len:
                in_inner = False
            continue
        om = re.match(r"^[ \t]*(`{3,}|~{3,})[ \t]*(\S.*)$", line)
        if om:
            in_inner, inner_char, inner_len = True, om.group(1)[0], len(om.group(1))
            continue
        bm = re.match(r"^[ \t]*(`{3,}|~{3,})[ \t]*$", line)
        if bm:
            if all(not l.strip() for l in lines[i + 1:]) and bm.group(1)[0] == wrapper_char and len(bm.group(1)) >= wrapper_len:
                del lines[i]
                break
            in_inner, inner_char, inner_len = True, bm.group(1)[0], len(bm.group(1))
    return "\n".join(lines)


def _parse_raw_meta(raw_meta):
    meta, tags, list_key = {}, [], False
    for line in raw_meta.splitlines():
        t = line.strip()
        if not t:
            continue
        if t.startswith("- ") and list_key:
            tags.append(t[2:].strip().strip("\"'").lower())
            continue
        if ":" not in line:
            list_key = False
            continue
        key, _, val = line.partition(":")
        key, val = key.strip().lower(), val.strip().strip("\"'")
        if key in ("tags", "topics"):
            list_key = True
            tags += [x.strip().strip("\"'").lower() for x in val.strip("[]").split(",") if x.strip()]
        else:
            list_key = False
            meta[key] = val
    meta["tags"] = list(dict.fromkeys(t for t in tags if t and re.search(r"[a-zA-Z]", t)))
    return meta


def parse_frontmatter(raw):
    raw_clean = re.sub(r"^(?:[ \t]*\r?\n)+", "", raw.replace("\ufeff", ""))
    m = re.match(r"^---[ \t]*\r?\n(.*?)\r?\n---[ \t]*(?:\r?\n|$)", raw_clean, re.S)
    if m and _is_valid_meta_block(m.group(1)):
        return _parse_raw_meta(m.group(1)), raw_clean[m.end():].strip()

    wm = re.search(
        r"^[ \t]*(`{3,}|~{3,})[ \t]*(?:markdown|md)[ \t]*\r?\n---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)",
        raw_clean, re.M)
    if wm and _is_valid_meta_block(wm.group(2)):
        w_char, w_len = wm.group(1)[0], len(wm.group(1))
        prefix = raw_clean[:wm.start()].rstrip()
        suffix = _strip_trailing_wrapper_closer(raw_clean[wm.end():], w_char, w_len).lstrip()
        combined = "\n\n".join(p for p in (prefix, suffix) if p).strip()
        return _parse_raw_meta(wm.group(2)), combined

    return {"tags": []}, raw.strip()


def extract_and_strip_excerpt(body, existing_desc=""):
    lines = body.splitlines()
    in_fence, f_char, f_len = False, "", 0
    q_idx, q_val = -1, None
    c_idx, c_val = -1, None
    for i, line in enumerate(lines):
        fm = re.match(r"^[ \t]*(`{3,}|~{3,})(.*)$", line)
        if fm:
            ch, ln = fm.group(1)[0], len(fm.group(1))
            if not in_fence:
                in_fence, f_char, f_len = True, ch, ln
            elif ch == f_char and ln >= f_len and not fm.group(2).strip():
                in_fence = False
            continue
        if in_fence:
            continue
        if q_idx == -1:
            qm = re.match(r'^[ \t]*["“]([^"”\r\n]{2,800})["”][ \t]*$', line)
            if qm:
                q_idx, q_val = i, qm.group(1).strip()
        if c_idx == -1:
            cm = re.match(r"^[ \t]*\^([^\^\r\n]{2,800})\^[ \t]*$", line)
            if cm:
                c_idx, c_val = i, cm.group(1).strip()

    idx = q_idx if q_idx != -1 else c_idx
    val = q_val if q_idx != -1 else c_val
    if idx == -1 or not val:
        return None, body
    norm = lambda s: " ".join(str(s or "").split()).lower()
    if not existing_desc or norm(val) == norm(existing_desc):
        del lines[idx]
    cleaned = re.sub(r"\n{3,}", "\n\n", "\n".join(lines).lstrip("\n")).strip()
    return (val if not existing_desc else None), cleaned


def strip_markdown(text):
    text = re.sub(r"`+", "", text)
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"[*_~#>^]", "", text)
    return " ".join(text.split())


def clip(text, n):
    if len(text) <= n:
        return text
    return text[:n].rsplit(" ", 1)[0].rstrip(",;:.") + "…"


def strip_fenced_blocks(text):
    """Remove fenced code/math blocks so heading/excerpt scans stay outside code."""
    out, fence, is_md, nested = [], None, False, 0
    for line in text.splitlines():
        m = re.match(r"^[ \t]*(`{3,}|~{3,})(.*)$", line)
        if m:
            tok, info = m.group(1), m.group(2).strip()
            if fence is None:
                fence = tok[0] * len(tok)
                lang = (info.split()[0] if info else "").lower()
                is_md = lang in ("markdown", "md")
                nested = 0
                continue
            if is_md and info:
                nested += 1
                continue
            if not info:
                if is_md and nested > 0:
                    nested -= 1
                    continue
                if tok[0] == fence[0] and len(tok) >= len(fence):
                    fence, is_md, nested = None, False, 0
                    continue
        if fence is None:
            out.append(line)
    return "\n".join(out)


def make_description(meta, body):
    d = meta.get("description") or meta.get("summary") or meta.get("desc")
    if d:
        return clip(" ".join(d.split()), 200)
    plain_body = strip_fenced_blocks(body)
    # same excerpt convention as the in-site reader: "quoted line" or ^caret line^
    q = re.search(r'(?m)^[ \t]*["“]([^"”\r\n]{2,800})["”][ \t]*$', plain_body) or \
        re.search(r"(?m)^[ \t]*\^([^^\r\n]{2,800})\^[ \t]*$", plain_body)
    if q:
        return clip(q.group(1).strip(), 200)
    for chunk in re.split(r"\n{2,}", plain_body):
        if re.match(r"^\s*(#|```|\$\$|[-*+] |\d+\. |>)", chunk):
            continue
        t = strip_markdown(chunk)
        if len(t) > 20:
            return clip(t, 200)
    for chunk in re.split(r"\n{2,}", plain_body):
        if re.match(r"^\s*(#|```|\$\$|[-*+] |\d+\. |>)", chunk):
            continue
        t = strip_markdown(chunk)
        if t:
            return clip(t, 200)
    return ""


def split_tag_lines(body):
    """Trailing '#tag #tag' lines become tags and are removed from the body."""
    lines, found = body.rstrip().splitlines(), []
    while lines and (not lines[-1].strip() or re.fullmatch(r"[.$,;_\-*~]+", lines[-1].strip())):
        lines.pop()
    while lines:
        trimmed = lines[-1].strip()
        if not trimmed:
            lines.pop()
            continue
        if re.fullmatch(r"\s*(?:(?:tags|topics|keywords):?\s*)?(?:#[\w\-/]+(?:\.[\w\-/]+)*[\s,;.]*)+", lines[-1], re.I):
            found = [t for t in re.findall(r"#([\w\-]+)", lines[-1].lower()) if re.search(r"[a-zA-Z]", t)] + found
            lines.pop()
        else:
            break
    return "\n".join(lines).strip(), found


# --------------------------------------------------------------- rendering

def esc_text(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def safe_url(u):
    u = u.strip().replace('"', "%22").replace("'", "%27").replace("<", "%3C").replace(">", "%3E")
    compact = re.sub(r"[\x00-\x20\x7f-\x9f]+", "", u)
    if re.match(r"^(?:javascript|data|vbscript):", compact, re.I):
        return "#"
    if re.match(r"^(https?:|mailto:|#|/|\./|\.\./)", u, re.I) or re.fullmatch(r"[\w\-./%&;=?]+", u):
        return u
    return "#"


def resolve_raw_image_path(path_str, folder=""):
    if not path_str or not isinstance(path_str, str):
        return ""
    clean_raw = path_str.strip()
    compact = re.sub(r"[\x00-\x20\x7f-\x9f]+", "", clean_raw)
    if re.match(r"^(?:javascript|data|vbscript):", compact, re.I):
        return "#"
    if clean_raw.startswith(("http://", "https://")):
        return clean_raw
    had_parent_prefix = clean_raw.startswith("../")
    clean = re.sub(r"^(?:\.\./)+", "", clean_raw)
    clean = re.sub(r"^\.?/", "", clean)
    if not clean:
        return ""
    if clean.startswith(POSTS_DIR + "/"):
        return "https://raw.githubusercontent.com/%s/%s/main/%s" % (OWNER, REPO, clean)
    clean_folder = (folder or "").strip().strip("/")
    if clean_folder and not had_parent_prefix and not clean.startswith(clean_folder + "/") and not clean.startswith("assets/"):
        return "https://raw.githubusercontent.com/%s/%s/main/%s/%s/%s" % (OWNER, REPO, POSTS_DIR, clean_folder, clean)
    return "https://raw.githubusercontent.com/%s/%s/main/%s/%s" % (OWNER, REPO, POSTS_DIR, clean)


def inline(t, folder=""):
    t = re.sub(r"~~([^~]+)~~", r"<del>\1</del>", t)
    t = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", t)
    t = re.sub(r"\*([^*\n]+)\*", r"<em>\1</em>", t)
    t = re.sub(r"!\[([^\]]*)\]\(([^)\s]+)[^)]*\)", lambda m:
               '<img src="%s" alt="%s" loading="lazy" decoding="async" referrerpolicy="no-referrer">' % (
                   safe_url(resolve_raw_image_path(re.sub(r"\x00\d+\x00", "", m.group(2)), folder)),
                   re.sub(r"\x00\d+\x00", "", m.group(1)).replace('"', "&quot;")), t)
    t = re.sub(r"\[([^\]]+)\]\(([^)\s]+)[^)]*\)", lambda m:
               '<a href="%s" rel="noopener noreferrer">%s</a>' % (
                   safe_url(re.sub(r"\x00\d+\x00", "", m.group(2))), m.group(1)), t)
    return t


def _extract_fenced_blocks(text, keep, math_fn):
    """Line-anchored fenced block extractor with CommonMark EOF closure."""
    lines = text.splitlines()
    out = []
    i = 0
    while i < len(lines):
        m = re.match(r"^[ \t]*(`{3,}|~{3,})(.*)$", lines[i])
        if not m:
            out.append(lines[i])
            i += 1
            continue
        fence_char = m.group(1)[0]
        fence_len = len(m.group(1))
        info = m.group(2).strip()
        lang = info.split()[0] if info else ""
        is_md = lang.lower() in ("markdown", "md")
        nested = 0
        buf = []
        j = i + 1
        while j < len(lines):
            cm = re.match(r"^[ \t]*(`{3,}|~{3,})[ \t]*$", lines[j])
            if cm:
                if is_md and nested > 0:
                    nested -= 1
                    buf.append(lines[j])
                    j += 1
                    continue
                if cm.group(1)[0] == fence_char and len(cm.group(1)) >= fence_len:
                    break
            elif is_md and re.match(r"^[ \t]*(`{3,}|~{3,})[ \t]*\S", lines[j]):
                nested += 1
            buf.append(lines[j])
            j += 1
        code = "\n".join(buf).rstrip("\n")
        if lang.lower() == "math":
            token = "\n\n" + math_fn(code, True) + "\n\n"
        else:
            token = "\n\n" + keep('<pre><code class="language-%s">%s</code></pre>' % (
                html.escape(lang, quote=True), html.escape(code))) + "\n\n"
        out.append(token)
        i = j + 1 if j < len(lines) else len(lines)
    return "\n".join(out)


def render(md, folder=""):
    """Markdown -> (html, headings, has_math). Escapes author text; supports the
    same syntax as the in-site reader (headings, lists, quotes, alerts, code,
    $ / $$ / ```math math)."""
    store = []

    def keep(h):
        store.append(h)
        return "\x00%d\x00" % (len(store) - 1)

    def math(code, display):
        c = html.escape(code.strip(), quote=True)
        tag = "div" if display else "span"
        return keep('<%s class="katex-math" data-math="%s" data-display="%s">%s</%s>' % (
            tag, c, "true" if display else "false", c, tag))

    t = md.replace("\x00", "").replace("\r\n", "\n")
    t = _extract_fenced_blocks(t, keep, math)
    t = re.sub(r"``([^\r\n]+?)``", lambda m: keep("<code>%s</code>" % html.escape(m.group(1).strip())), t)
    t = re.sub(r"(?<!`)`([^`\r\n]+)`(?!`)", lambda m: keep("<code>%s</code>" % html.escape(m.group(1))), t)
    t = t.replace("\\$", keep("$"))
    t = re.sub(r"\$\$(.+?)\$\$", lambda m: "\n\n" + math(m.group(1), True) + "\n\n", t, flags=re.S)
    t = re.sub(r"\\\[(.+?)\\\]", lambda m: "\n\n" + math(m.group(1), True) + "\n\n", t, flags=re.S)
    t = re.sub(r"(?<!\\)\$(?!\s)([^$\n]+?)(?<!\s)\$", lambda m: math(m.group(1), False), t)
    t = re.sub(r"\\\((?!\s)(.+?)(?<!\s)\\\)", lambda m: math(m.group(1), False), t)
    has_math = any('class="katex-math"' in s for s in store)
    t = esc_text(t)

    out, headings, used_ids = [], [], set()
    para, lines = [], t.split("\n")

    def flush():
        if para:
            out.append("<p>%s</p>" % "<br>\n".join(inline(p, folder) for p in para))
            para.clear()

    def resolve_plain(fragment):
        resolved = re.sub(r"\x00(\d+)\x00", lambda m: store[int(m.group(1))], fragment)
        resolved = re.sub(r"<[^>]+>", "", resolved)
        return html.unescape(strip_markdown(resolved))

    i = 0
    while i < len(lines):
        line = lines[i]
        s = line.strip()
        if not s:
            flush()
        elif re.fullmatch(r"\x00\d+\x00", s):
            flush()
            out.append(s)
        elif re.fullmatch(r"(-{3,}|\*{3,}|_{3,})", s):
            flush()
            out.append("<hr>")
        elif re.match(r"#{1,4}[ \t]+\S", s):
            flush()
            level = len(s) - len(s.lstrip("#"))
            title = resolve_plain(s[level:])
            hid, n = slugify(title), 2
            base = hid
            while hid in used_ids:
                hid, n = "%s-%d" % (base, n), n + 1
            used_ids.add(hid)
            headings.append((level, title, hid))
            out.append('<h%d id="%s">%s</h%d>' % (level, hid, inline(s[level:].strip(), folder), level))
        elif s.startswith("&gt;"):
            flush()
            block = []
            while i < len(lines) and lines[i].strip().startswith("&gt;"):
                block.append(re.sub(r"^\s*&gt;\s?", "", lines[i]))
                i += 1
            i -= 1
            alert = re.match(r"\[!([A-Za-z]+)\]\s*$", block[0].strip())
            if alert:
                kind = alert.group(1).upper()
                out.append('<blockquote class="alert alert-%s"><strong>%s:</strong> %s</blockquote>' % (
                    kind, kind, inline("<br>".join(b for b in block[1:] if b.strip()), folder)))
            else:
                out.append("<blockquote>%s</blockquote>" % inline("<br>".join(block), folder))
        elif re.match(r"([-*+]|\d+\.)\s+\S", s):
            flush()
            ordered = bool(re.match(r"\d+\.", s))
            item_re = r"\s*\d+\.\s+\S" if ordered else r"\s*[-*+]\s+\S"
            strip_re = r"^\s*\d+\.\s+" if ordered else r"^\s*[-*+]\s+"
            items = []
            while i < len(lines) and re.match(item_re, lines[i]):
                items.append(re.sub(strip_re, "", lines[i]))
                i += 1
            i -= 1
            tag = "ol" if ordered else "ul"
            out.append("<%s>%s</%s>" % (tag, "".join("<li>%s</li>" % inline(x, folder) for x in items), tag))
        elif "|" in s and i + 1 < len(lines) and re.match(r"^\|?[ \t]*:?-{3,}:?[ \t]*(?:\|[ \t]*:?-{3,}:?[ \t]*)*\|?$", lines[i + 1].strip()):
            flush()
            headers = [c.strip() for c in s.strip().strip("|").split("|")]
            th_html = "".join("<th>%s</th>" % inline(h, folder) for h in headers)
            i += 2
            rows_html = []
            while i < len(lines) and "|" in lines[i].strip():
                cells = [c.strip() for c in lines[i].strip().strip("|").split("|")]
                td_html = "".join("<td>%s</td>" % inline(cells[ci] if ci < len(cells) else "", folder) for ci in range(len(headers)))
                rows_html.append("<tr>%s</tr>" % td_html)
                i += 1
            i -= 1
            tbody_html = ("<tbody>%s</tbody>" % "".join(rows_html)) if rows_html else ""
            out.append("<table><thead><tr>%s</tr></thead>%s</table>" % (th_html, tbody_html))
        elif re.fullmatch(r"(https?://[^\s\"'<>]+\.(?:png|jpe?g|webp|gif|svg|avif)(?:\?[^\s\"'<>]*)?|https?://unavatar\.io/[^\s\"'<>]+)", s, re.I):
            flush()
            out.append('<img src="%s" alt="Note image" loading="lazy" decoding="async" referrerpolicy="no-referrer">' % safe_url(s))
        else:
            para.append(s)
        i += 1
    flush()

    result = "\n".join(out)
    result = re.sub(r"<[^>]*>", lambda m: re.sub(r"\x00\d+\x00", "", m.group(0)), result)
    for _ in range(2):  # placeholders may nest (code inside list item etc.)
        result = re.sub(r"\x00(\d+)\x00", lambda m: store[int(m.group(1))] if int(m.group(1)) < len(store) else "", result)
    return result, headings, has_math


# ------------------------------------------------------------------ og card

def wrap(text, width, limit):
    lines, cur = [], ""
    for w in text.split():
        while len(w) > width:  # hard-split unbroken tokens
            if cur:
                lines.append(cur)
                cur = ""
            lines.append(w[:width])
            w = w[width:]
        if len(cur) + len(w) + (1 if cur else 0) > width:
            lines.append(cur)
            cur = w
        else:
            cur = (cur + " " + w).strip()
    if cur:
        lines.append(cur)
    if len(lines) > limit:
        lines = lines[:limit]
        lines[-1] = lines[-1].rstrip(".,;: ")[:max(0, width - 1)] + "…"
    return lines


def tspans(lines, line_height_em):
    return "".join('<tspan x="90" dy="%s">%s</tspan>' % (
        "0" if i == 0 else line_height_em, html.escape(l)) for i, l in enumerate(lines))


def og_svg(n, has_bg=False, has_avatar=False, card_alpha=0.52):
    t_lines = wrap(n["title"], 26, 3)
    size = 58 if len(t_lines) < 3 else 46
    desc_limit = 2 if len(t_lines) >= 3 else 3
    d_lines = wrap(n["description"], 52, desc_limit)
    if not d_lines and n.get("tags"):
        d_lines = wrap("  ".join("#" + t for t in n["tags"][:4]), 52, 2)
    d_y = int(204 + size * 1.24 * (len(t_lines) - 1) + 60)
    font = "DejaVu Sans, Liberation Sans, Arial, sans-serif"
    bg_rect = "" if has_bg else '<rect width="1200" height="630" fill="#0E0D0C"/>'
    card_fill = ("rgba(14,13,12,%.2f)" % card_alpha) if has_bg else "#141312"
    title_spans = tspans(t_lines, "1.22em")

    # Header: avatar ring + site/notes label on left, category pill on right
    brand_x = 144 if has_avatar else 90
    avatar_ring = '<circle cx="110" cy="98" r="21" fill="none" stroke="#E5BF85" stroke-opacity="0.58" stroke-width="1.5"/>' if has_avatar else ""
    cat_label = (n["category"] or "RESEARCH").upper()[:18]
    cat_w = max(76, int(len(cat_label) * 11.2 + 32))
    cat_x = 1110 - cat_w
    cat_pill = (
        '<rect x="%d" y="80" width="%d" height="36" rx="10" fill="#D8B278" fill-opacity="0.18" stroke="#D8B278" stroke-opacity="0.52" stroke-width="1.2"/>'
        '<text x="%d" y="104" text-anchor="middle" fill="#E5BF85" font-family="%s" font-size="16" font-weight="bold">%s</text>'
        % (cat_x, cat_w, cat_x + cat_w // 2, font, html.escape(cat_label))
    )

    # Footer left: calendar icon + date, clock icon + read time (solid filled paths for 100% IM SVG compatibility)
    date_str = n["friendly_date"] or ""
    read_str = n["read_time"] or ""
    cal_svg = (
        '<path fill="#D8B278" d="M93 517h2v2h6v-2h2v2h1.5a2.5 2.5 0 0 1 2.5 2.5v11a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 89 532.5v-11A2.5 2.5 0 0 1 91.5 519H93v-2zm-2 6.5v9a.5.5 0 0 0 .5.5h13a.5.5 0 0 0 .5-.5v-9H91zm.5-2.5a.5.5 0 0 0-.5.5v.5h14v-.5a.5.5 0 0 0-.5-.5h-13z"/>'
    ) if date_str else ""
    date_svg = '<text x="118" y="534" text-anchor="start" fill="#D8CFC2" font-family="%s" font-size="20">%s</text>' % (
        font, html.escape(date_str)) if date_str else ""
    clock_x = (118 + int(len(date_str) * 11.2) + 28) if date_str else 90
    clock_svg = (
        '<path fill="#D8B278" d="M%d 518a9 9 0 1 1 0 18 9 9 0 0 1 0-18zm0 2a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm-.8 2.5h1.6v4.2l3 1.8-.8 1.3-3.8-2.3V522.5z"/>'
        % (clock_x + 9)
    ) if read_str else ""
    read_svg = '<text x="%d" y="534" text-anchor="start" fill="#D8CFC2" font-family="%s" font-size="20">%s</text>' % (
        clock_x + 27, font, html.escape(read_str)) if read_str else ""

    # Footer right: up to 3 #tag pills laid out left-to-right, right-aligned at x=1110
    min_x = clock_x + (27 + int(len(read_str) * 10.6) + 24 if read_str else 0)
    chosen_tags = []
    total_w = 0
    for tag in (n.get("tags") or [])[:3]:
        label = "#" + tag[:16]
        tw = max(64, int(len(label) * 10.2 + 26))
        needed = tw + (10 if chosen_tags else 0)
        if 1110 - (total_w + needed) < max(560, min_x):
            break
        chosen_tags.append((label, tw))
        total_w += needed
    tags_svg = []
    cur_x = 1110 - total_w
    for label, tw in chosen_tags:
        tags_svg.append(
            '<rect x="%d" y="510" width="%d" height="34" rx="10" fill="#F7F3EC" fill-opacity="0.12" stroke="#F7F3EC" stroke-opacity="0.26" stroke-width="1"/>'
            '<text x="%d" y="533" text-anchor="middle" fill="#F2ECE1" font-family="%s" font-size="16" font-weight="bold">%s</text>'
            % (cur_x, tw, cur_x + tw // 2, font, html.escape(label))
        )
        cur_x += tw + 10

    return """<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
{bg}
<rect x="34" y="34" width="1132" height="562" rx="22" fill="{cf}" stroke="#D8B278" stroke-opacity="0.42" stroke-width="1.5"/>
{av_ring}
<text x="{bx}" y="105" text-anchor="start" fill="#F7F3EC" font-family="{f}" font-size="22" font-weight="bold">pxecore.github.io</text>
<text x="{nx}" y="105" text-anchor="start" fill="#E5BF85" font-family="{f}" font-size="22" font-weight="bold">· notes</text>
{cat}
<text x="90" y="207" text-anchor="start" fill="#000000" fill-opacity="0.58" font-family="{f}" font-size="{s}" font-weight="bold">{t}</text>
<text x="90" y="204" text-anchor="start" fill="#F7F3EC" font-family="{f}" font-size="{s}" font-weight="bold">{t}</text>
<text x="90" y="{dy}" text-anchor="start" fill="#DDD5C8" font-family="{f}" font-size="28">{d}</text>
<line x1="90" y1="482" x2="1110" y2="482" stroke="#D8B278" stroke-opacity="0.34" stroke-width="1"/>
{cal}{dt}{clk}{rd}{tags}
</svg>""".format(bg=bg_rect, cf=card_fill, av_ring=avatar_ring, bx=brand_x, nx=brand_x + 206, f=font,
                 cat=cat_pill, s=size, t=title_spans, d=tspans(d_lines, "1.38em"), dy=d_y,
                 cal=cal_svg, dt=date_svg, clk=clock_svg, rd=read_svg, tags="".join(tags_svg))


def bg_og_digest(bg_path):
    if not os.path.exists(bg_path):
        return "solid"
    with open(bg_path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()[:16]


def measure_bg_luminance(bg_path):
    if not os.path.exists(bg_path):
        return 0.25
    for cmd in (["magick", "identify", "-format", "%[fx:mean]", bg_path],
                ["identify", "-format", "%[fx:mean]", bg_path]):
        try:
            out = subprocess.check_output(cmd, stderr=subprocess.DEVNULL, text=True).strip()
            val = float(out)
            if 0.0 <= val <= 1.0:
                return val
        except Exception:
            continue
    return 0.45


def make_og(n, path, state):
    bg_path = os.path.join(ROOT, "media", "og.webp")
    av_path = os.path.join(ROOT, "media", "avatar.webp")
    has_bg = os.path.exists(bg_path)
    has_av = os.path.exists(av_path)
    luma = measure_bg_luminance(bg_path) if has_bg else 0.25
    colorize_pct = int(round(52 + luma * 32))
    card_alpha = round(0.46 + luma * 0.24, 2)
    svg = og_svg(n, has_bg=has_bg, has_avatar=has_av, card_alpha=card_alpha)
    digest = hashlib.sha256((bg_og_digest(bg_path) + bg_og_digest(av_path) + ":v5:" + svg).encode()).hexdigest()[:16]
    if os.path.exists(path) and state["og"].get(n["slug"]) == digest:
        return True
    tmp = path + ".svg"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(svg)
    ok = False
    for tool in (["magick"], ["convert"]):
        try:
            cmd = list(tool)
            if has_bg:
                cmd += [
                    bg_path, "-resize", "1200x630^", "-gravity", "center", "-extent", "1200x630",
                    "-blur", "0x4.5", "-fill", "#0E0D0C", "-colorize", f"{colorize_pct}%",
                    "-gravity", "northwest",
                    "(", "-background", "none", tmp, ")",
                    "-compose", "Over", "-composite",
                ]
            else:
                cmd += ["-background", "none", tmp]
            if has_av:
                cmd += [
                    "(", av_path, "-resize", "40x40^", "-gravity", "center", "-extent", "40x40",
                    "(", "-size", "40x40", "xc:none", "-fill", "white", "-draw", "circle 20,20 20,1", ")",
                    "-alpha", "off", "-compose", "CopyOpacity", "-composite", ")",
                    "-gravity", "northwest", "-geometry", "+90+78", "-compose", "Over", "-composite",
                ]
            cmd += ["-define", "png:exclude-chunks=date,time,tIME", path]
            subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            ok = os.path.getsize(path) > 2000
            if ok:
                break
        except Exception:
            continue
    os.remove(tmp)
    if ok:
        state["og"][n["slug"]] = digest
    elif os.path.exists(path):
        os.remove(path)
    return ok


# --------------------------------------------------------------------- page

NOTE_PAGE_CSP = (
    "default-src 'self' file:; "
    "script-src 'self' file:; "
    "style-src 'self' file: 'unsafe-inline'; "
    "font-src 'self' file: data:; "
    "img-src 'self' file: https: data:; "
    "connect-src 'self' file:; "
    "object-src 'none'; form-action 'none'; base-uri 'self';"
)


def page_html(n, has_og):
    url = "%s/notes/%s/" % (SITE, n["slug"])
    reader_url = "../../#notes?p=%s" % urllib.parse.quote(n["slug"])
    image = "%s/notes/%s/og.png" % (SITE, n["slug"]) if has_og else SITE + "/media/og.webp"
    e = lambda s: html.escape(s, quote=True)
    ld = json.dumps({
        "@context": "https://schema.org", "@type": "TechArticle",
        "headline": n["title"], "description": n["description"], "url": url,
        "mainEntityOfPage": url, "image": image,
        "datePublished": n["iso_date"], "dateModified": n["iso_date"],
        "keywords": ", ".join(n["tags"]), "inLanguage": "en",
        "author": {"@type": "Person", "name": n["author"], "url": SITE + "/"},
        "publisher": {"@type": "Person", "name": AUTHOR, "url": SITE + "/"},
    }, ensure_ascii=False).replace("</", "<\\/")

    meta_bits = [b for b in (e(n["category"]), n["friendly_date"], e(n["read_time"]), "@" + e(n["author"])) if b]

    return """<!DOCTYPE html>
<html lang="en" class="dark" style="background-color:#0E0D0C;color-scheme:dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="referrer" content="strict-origin-when-cross-origin">
<meta http-equiv="X-Content-Type-Options" content="nosniff">
<meta http-equiv="Content-Security-Policy" content="{csp}">
<meta http-equiv="Permissions-Policy" content="camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()">
<title>{title} · pxecore</title>
<meta name="description" content="{desc}">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta name="author" content="{author}">
{kw}<link rel="canonical" href="{url}">
<meta http-equiv="refresh" content="0; url={reader_url}">
<meta name="theme-color" content="#0E0D0C">
<meta property="og:site_name" content="pxecore">
<meta property="og:type" content="article">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{desc}">
<meta property="og:url" content="{url}">
<meta property="og:image" content="{image}">
{og_type}<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="article:published_time" content="{iso}">
<meta property="article:author" content="{author}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{title}">
<meta name="twitter:description" content="{desc}">
<meta name="twitter:image" content="{image}">
<script type="application/ld+json">{ld}</script>
<script src="../../script/note-page.js"></script>
<link rel="icon" href="../../media/avatar.webp" type="image/webp">
</head>
<body style="margin:0;background:#0E0D0C;color:#F7F3EC">
<main hidden>
<article>
<p class="note-crumbs">notes / {cat}</p>
<h1 class="note-title">{title}</h1>
{desc_p}<div class="note-meta"><span>{meta}</span></div>
<div class="notes-reader-body markdown-body">
{body}
</div>
</article>
</main>
</body>
</html>
""".format(csp=NOTE_PAGE_CSP, title=e(n["title"]), desc=e(n["description"]), author=e(n["author"]),
           kw=('<meta name="keywords" content="%s">\n' % e(", ".join(n["tags"]))) if n["tags"] else "",
           url=url, reader_url=e(reader_url), image=image,
           og_type='<meta property="og:image:type" content="image/png">\n' if has_og else "",
           iso=n["iso_date"], ld=ld,
           cat=e(n["category"]),
           desc_p=('<p class="note-desc">%s</p>\n' % e(n["description"])) if n["description"] else "",
           meta=" · ".join(meta_bits), body=n["body_html"])


# ------------------------------------------------------------------ outputs

def write_if_changed(path, text):
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            if f.read() == text:
                return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


def one_line(s):
    return " ".join(s.split())


def build_sitemap(notes):
    latest = max(n["iso_date"] for n in notes)
    urls = [(SITE + "/", latest, "1.0")] + [
        ("%s/notes/%s/" % (SITE, n["slug"]), n["iso_date"], "0.8") for n in notes]
    body = "".join("  <url>\n    <loc>%s</loc>\n    <lastmod>%s</lastmod>\n    <priority>%s</priority>\n  </url>\n" % u
                   for u in urls)
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n%s</urlset>\n' % body)


def build_feed(notes):
    from email.utils import format_datetime
    from datetime import datetime, timezone

    def rfc(d):
        return format_datetime(datetime.strptime(d, "%Y-%m-%d").replace(tzinfo=timezone.utc))

    items = "".join(
        "    <item>\n      <title>%s</title>\n      <link>%s/notes/%s/</link>\n"
        "      <guid isPermaLink=\"true\">%s/notes/%s/</guid>\n      <description>%s</description>\n"
        "      <category>%s</category>\n      <pubDate>%s</pubDate>\n    </item>\n" % (
            html.escape(n["title"]), SITE, n["slug"], SITE, n["slug"], html.escape(n["description"]),
            html.escape(n["category"]), rfc(n["iso_date"])) for n in notes)
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n  <channel>\n'
            "    <title>pxecore · notes</title>\n    <link>%s/</link>\n"
            "    <description>Research notes on systems, reverse engineering and security.</description>\n"
            "    <language>en</language>\n"
            '    <atom:link href="%s/feed.xml" rel="self" type="application/rss+xml"/>\n'
            "    <lastBuildDate>%s</lastBuildDate>\n%s  </channel>\n</rss>\n" % (
                SITE, SITE, rfc(max(n["iso_date"] for n in notes)), items))


def build_llms(notes, full):
    head = [
        "# pxecore", "",
        "> Personal site and research notes of pxecore: student, exploring systems and security.", "",
        "## Pages",
        "- [Home](%s/): bio, contact, links" % SITE,
        "- [Resume](%s/#resume): background, projects, platforms" % SITE,
        "- [Notes](%s/#notes): research notes index" % SITE, "",
        "## Notes",
    ]
    for n in notes:
        head.append("- [%s](%s/notes/%s/): %s" % (
            n["title"], SITE, n["slug"], one_line(n["description"]) or n["category"]))
    head += ["", "## Profiles",
             "- GitHub: https://github.com/pxecore",
             "- X: https://x.com/pxecore",
             "- Identity: %s/ident.txt" % SITE, ""]
    if not full:
        return "\n".join(head)
    parts = ["\n".join(head), "\n---\n"]
    for n in notes:
        parts.append("\n# %s\n\nURL: %s/notes/%s/\nDate: %s\nCategory: %s\n\n%s\n\n---\n" % (
            n["title"], SITE, n["slug"], n["iso_date"], n["category"], n["raw_body"]))
    return "\n".join(parts)


# --------------------------------------------------------------------- main

def main():
    try:
        sources = fetch_notes()
    except Exception as e:
        print("[build_notes_seo] aborted, nothing changed: %s" % e, file=sys.stderr)
        return 1

    state = {"dates": {}, "og": {}}
    if os.path.exists(STATE_PATH):
        try:
            with open(STATE_PATH, encoding="utf-8") as f:
                state.update(json.load(f))
        except Exception:
            pass

    notes, taken = [], set()
    for path, raw in sources:
        parts = path.split("/")
        folder = parts[1] if len(parts) > 2 else None
        filename = parts[-1][:-3]
        meta, body = parse_frontmatter(raw)

        slug = slugify(("%s-%s" % (folder, filename)) if folder else filename)
        base, k = slug, 2
        while slug in taken:
            slug, k = "%s-%d" % (base, k), k + 1
        taken.add(slug)

        existing_desc = meta.get("description") or meta.get("summary") or meta.get("desc") or ""
        extracted_excerpt, body = extract_and_strip_excerpt(body, existing_desc)
        if extracted_excerpt and not existing_desc:
            meta["description"] = extracted_excerpt

        plain_body = strip_fenced_blocks(body)
        h1 = re.search(r"(?m)^#[ \t]+(.+)$", plain_body)
        title = meta.get("title") or (h1.group(1).strip() if h1 else filename.replace("-", " ").replace("_", " ").title())
        norm_title = " ".join(title.split()).lower()
        if h1:
            lines = body.splitlines(keepends=True)
            in_fence, fence_char, fence_len, removed, seen_content = False, "", 0, False, False
            out_lines = []
            for line in lines:
                m_fence = re.match(r"^[ \t]*(`{3,}|~{3,})(.*)$", line.rstrip("\r\n"))
                if m_fence:
                    ch, ln, tail = m_fence.group(1)[0], len(m_fence.group(1)), m_fence.group(2)
                    if not in_fence:
                        in_fence, fence_char, fence_len, seen_content = True, ch, ln, True
                    elif ch == fence_char and ln >= fence_len and not tail.strip():
                        in_fence = False
                elif not in_fence and not removed and re.match(r"^#[ \t]+.+$", line.rstrip("\r\n")):
                    h1_text = " ".join(line.lstrip("#").split()).lower()
                    if not seen_content or (norm_title and h1_text == norm_title):
                        removed = True
                        continue
                    seen_content = True
                elif not in_fence and line.strip():
                    seen_content = True
                out_lines.append(line)
            body = "".join(out_lines)
        body, bottom_tags = split_tag_lines(body)
        tags = list(dict.fromkeys(meta.get("tags", []) + bottom_tags))

        iso = meta.get("date", "")
        valid_date = None
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", iso):
            try:
                valid_date = date.fromisoformat(iso)
            except ValueError:
                valid_date = None
        if valid_date is None:
            cached_iso = state["dates"].get(path, "")
            try:
                valid_date = date.fromisoformat(cached_iso) if re.fullmatch(r"\d{4}-\d{2}-\d{2}", cached_iso) else None
            except ValueError:
                valid_date = None
            if valid_date is None:
                cached_iso = commit_date(path)
                state["dates"][path] = cached_iso
                valid_date = date.fromisoformat(cached_iso)
            iso = valid_date.isoformat()

        body_html, headings, has_math = render(body, folder=folder or "")
        words = len(re.findall(r"\w+", body))
        friendly = valid_date.strftime("%b %d, %Y").replace(" 0", " ")
        notes.append({
            "slug": slug, "title": title, "description": make_description(meta, body),
            "category": meta.get("category") or meta.get("cat") or (folder.upper() if folder else (tags[0].upper() if tags else "Research")),
            "tags": tags, "author": meta.get("author") or AUTHOR, "iso_date": iso,
            "friendly_date": friendly, "read_time": meta.get("readtime") or meta.get("read_time") or
            "%d min read" % max(1, round(words / 200)),
            "headings": headings, "body_html": body_html, "has_math": has_math, "raw_body": body,
        })

    notes.sort(key=lambda n: (n["iso_date"], n["slug"]), reverse=True)

    os.makedirs(OUT, exist_ok=True)
    write_if_changed(os.path.join(OUT, "index.html"),
                     '<!DOCTYPE html>\n<html lang="en"><head><meta charset="UTF-8">'
                     '<meta name="robots" content="noindex">'
                     '<meta http-equiv="refresh" content="0; url=../#notes">'
                     '<link rel="canonical" href="%s/#notes"><title>pxecore · notes</title></head>'
                     '<body><a href="../#notes">pxecore notes</a></body></html>\n' % SITE)

    for n in notes:
        d = os.path.join(OUT, n["slug"])
        os.makedirs(d, exist_ok=True)
        has_og = make_og(n, os.path.join(d, "og.png"), state)
        write_if_changed(os.path.join(d, "index.html"), page_html(n, has_og))

    live = {n["slug"] for n in notes}
    for name in os.listdir(OUT):  # remove pages of deleted notes
        p = os.path.join(OUT, name)
        if os.path.isdir(p) and name not in live:
            shutil.rmtree(p)
    state["dates"] = {k: v for k, v in state["dates"].items() if k in {s[0] for s in sources}}
    state["og"] = {k: v for k, v in state["og"].items() if k in live}

    write_if_changed(os.path.join(ROOT, "sitemap.xml"), build_sitemap(notes))
    write_if_changed(os.path.join(ROOT, "feed.xml"), build_feed(notes))
    write_if_changed(os.path.join(ROOT, "llms.txt"), build_llms(notes, False))
    write_if_changed(os.path.join(ROOT, "llms-full.txt"), build_llms(notes, True))
    write_if_changed(STATE_PATH, json.dumps(state, indent=2, sort_keys=True) + "\n")

    print("[build_notes_seo] %d notes built" % len(notes))
    return 0


if __name__ == "__main__":
    sys.exit(main())
