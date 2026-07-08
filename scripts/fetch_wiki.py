#!/usr/bin/env python3
"""Scrape the Escape the Backrooms Fandom wiki into clean JSON + local images.

Usage:
    python3 scripts/fetch_wiki.py [--only levels,entities] [--no-images] [--refresh]

Decoupled from the app: the site only ever reads src/data/*.json and
public/images/. Re-running this script updates content without touching code.
All API hits go through a polite client (1 req/s, descriptive User-Agent) with
a sha1-keyed disk cache in scripts/.cache/ so development re-runs are instant.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import re
import sys
import time
import unicodedata
from pathlib import Path
from urllib.parse import urlencode, unquote

import requests
import mwparserfromhell

from wiki_html import sanitize_html, split_sections, strip_tags

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "src" / "data"
IMG_DIR = ROOT / "public" / "images"
CACHE_DIR = Path(__file__).resolve().parent / ".cache"

WIKI = "https://escapethebackrooms.fandom.com"
API = f"{WIKI}/api.php"
USER_AGENT = "backrooms-field-manual/1.0 (+https://github.com/moscovium0894/backrooms-wiki)"

HERO_W, MAP_W, BODY_W, THUMB_W = 800, 800, 640, 320
MAX_BODY_IMAGES = 6
MAX_GALLERY_IMAGES = 3

DANGER_CATS = ["Harmless", "Friendly", "Cannot Harm You", "Moderate",
               "Dangerous", "Deadly", "Very Deadly", "Boss Entities", "Unknown"]
WALKTHROUGH_HEADINGS = {"objective", "objectives", "walkthrough", "guide",
                        "how to escape", "escaping", "how to beat"}

# Guide pages fetched in addition to the Guides / Level Guides categories.
# "Full Game Guide" is trimmed to its general-tactics intro (per-level content
# already lives on the level pages).
EXTRA_GUIDE_TITLES = ["Endings", "Achievements", "Full Game Guide",
                      "Sanity", "Gamemodes", "Controls"]


class WikiClient:
    def __init__(self, refresh: bool = False):
        self.session = requests.Session()
        self.session.headers["User-Agent"] = USER_AGENT
        self.refresh = refresh
        self.requests_made = 0
        CACHE_DIR.mkdir(exist_ok=True)

    def _cached(self, key: str, fetch, binary=False):
        path = CACHE_DIR / (hashlib.sha1(key.encode()).hexdigest() + (".bin" if binary else ".json"))
        if path.exists() and not self.refresh:
            return path.read_bytes() if binary else json.loads(path.read_text())
        data = fetch()
        if binary:
            path.write_bytes(data)
        else:
            path.write_text(json.dumps(data))
        return data

    def get(self, **params) -> dict:
        params.setdefault("format", "json")
        params.setdefault("formatversion", "2")
        key = API + "?" + urlencode(sorted(params.items()))

        def fetch():
            self._throttle()
            r = self._retrying(lambda: self.session.get(API, params=params, timeout=30))
            return r.json()

        return self._cached(key, fetch)

    def download(self, url: str, dest: Path) -> bool:
        if dest.exists() and dest.stat().st_size > 0:
            return True

        def fetch():
            self._throttle()
            r = self._retrying(lambda: self.session.get(url, timeout=60))
            return r.content

        try:
            data = self._cached(url, fetch, binary=True)
        except Exception as e:  # noqa: BLE001
            print(f"  !! download failed {url}: {e}")
            return False
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
        return True

    def _throttle(self):
        time.sleep(1.0)
        self.requests_made += 1

    @staticmethod
    def _retrying(fn):
        delay = 2.0
        for attempt in range(4):
            r = fn()
            if r.status_code in (429, 500, 502, 503, 504) and attempt < 3:
                time.sleep(delay)
                delay *= 2
                continue
            r.raise_for_status()
            return r
        raise RuntimeError("unreachable")


# ---------------------------------------------------------------- utilities

def normalize_title(t: str) -> str:
    t = t.replace("_", " ").replace("\ufe0f", "").strip()
    t = re.sub(r"\s+", " ", t)
    return t[:1].upper() + t[1:] if t else t


def slugify(title: str) -> str:
    title = title.replace("\ufe0f", "").replace("+", "-plus-").lower()
    out = []
    for ch in title:
        if ch.isascii() and ch.isalnum():
            out.append(ch)
        elif ch in " -_./&":
            out.append("-")
        else:
            try:
                out.append("-" + unicodedata.name(ch).lower().replace(" ", "-").replace("-mark", "") + "-")
            except ValueError:
                out.append("-")
    slug = re.sub(r"-{2,}", "-", "".join(out)).strip("-")
    return slug or "p-" + hashlib.sha1(title.encode()).hexdigest()[:6]


def sentence_trim(text: str, limit: int = 400) -> str:
    text = text.strip()
    if len(text) <= limit:
        return text
    cut = text[:limit]
    for stop in (". ", "! ", "? "):
        idx = cut.rfind(stop)
        if idx > limit // 3:
            return cut[: idx + 1].strip()
    return cut.rsplit(" ", 1)[0].strip() + "…"


def get_param(tpl, name: str):
    if tpl is None:
        return None
    try:
        if tpl.has(name):
            v = str(tpl.get(name).value).strip()
            return v or None
    except ValueError:
        pass
    return None


def param_text(tpl, name: str):
    v = get_param(tpl, name)
    if v is None:
        return None
    v = re.sub(r"</?br\s*/?>", " / ", v, flags=re.I)
    return strip_tags(str(mwparserfromhell.parse(v).strip_code())) or None


def param_links(tpl, name: str) -> list[str]:
    v = get_param(tpl, name)
    if not v:
        return []
    return [normalize_title(str(l.title).split("#")[0])
            for l in mwparserfromhell.parse(v).filter_wikilinks()]


def gallery_files(raw: str) -> list[tuple[str, str]]:
    """Parse <gallery>File.png|Caption ...</gallery> content -> [(file, caption)]."""
    m = re.search(r"<gallery[^>]*>(.*?)</gallery>", raw, re.S | re.I)
    body = m.group(1) if m else raw
    files = []
    for line in body.splitlines():
        line = line.strip()
        if not line or "." not in line:
            continue
        parts = line.split("|", 1)
        fname = normalize_title(re.sub(r"^file:", "", parts[0].strip(), flags=re.I))
        caption = strip_tags(parts[1]) if len(parts) > 1 else ""
        if re.search(r"\.(png|jpe?g|gif|webp)$", fname, re.I):
            files.append((fname, caption))
    return files


def scaled_url(orig_url: str, orig_w: int, want_w: int) -> str:
    """Build a Fandom scale-to-width-down thumbnail URL from the original."""
    if orig_w and orig_w <= want_w:
        return orig_url
    base, _, query = orig_url.partition("?")
    m = re.match(r"(.*/revision/latest)", base)
    if not m:
        return orig_url
    url = f"{m.group(1)}/scale-to-width-down/{want_w}"
    return url + ("?" + query if query else "")


def scaled_dims(w: int, h: int, want_w: int) -> tuple[int, int]:
    if not w or not h or w <= want_w:
        return w or want_w, h or want_w
    return want_w, max(1, round(h * want_w / w))


def ext_of(file_title: str) -> str:
    ext = file_title.rsplit(".", 1)[-1].lower()
    return "jpg" if ext == "jpeg" else ext


# ---------------------------------------------------------------- wiki steps

def category_members(client: WikiClient, cat: str) -> list[str]:
    members, cont = [], {}
    while True:
        d = client.get(action="query", list="categorymembers",
                       cmtitle=f"Category:{cat}", cmlimit="500", cmtype="page", **cont)
        members += [m["title"] for m in d["query"]["categorymembers"]]
        if "continue" in d:
            cont = d["continue"]
        else:
            return members


def parse_page(client: WikiClient, title: str) -> dict | None:
    try:
        d1 = client.get(action="parse", page=title,
                        prop="wikitext|categories|displaytitle|images", redirects="1")
        d2 = client.get(action="parse", page=title, prop="text",
                        disableeditsection="1", disabletoc="1", redirects="1")
    except requests.HTTPError as e:
        print(f"  !! cannot fetch {title}: {e}")
        return None
    if "parse" not in d1 or "parse" not in d2:
        return None
    p1, p2 = d1["parse"], d2["parse"]
    return {
        "title": p1["title"],
        "wikitext": p1["wikitext"],
        "categories": [normalize_title(c["category"]) for c in p1.get("categories", [])],
        "displaytitle": strip_tags(p1.get("displaytitle") or p1["title"]),
        "files": [normalize_title(f) for f in p1.get("images", [])],
        "html": p2["text"],
    }


def parse_levels_page(client: WikiClient) -> dict[str, list[str]]:
    """Bucket level titles by the Levels page homepage sections, in order."""
    d = client.get(action="parse", page="Levels", prop="wikitext")
    text = d["parse"]["wikitext"]
    bucket_names = {
        "Main Levels": "main", "Secret Levels": "secret", "Upcoming Levels": "upcoming",
        "Areas": "area", "Bases": "base", "Non-Playable Levels": "nonplayable",
        "Joke Levels": "joke",
    }
    buckets: dict[str, list[str]] = {v: [] for v in bucket_names.values()}
    current = None
    for token in re.split(r'(homepage-header">[^<]+<)', text):
        m = re.match(r'homepage-header">([^<]+)<', token)
        if m:
            current = bucket_names.get(m.group(1).strip())
            continue
        if current:
            for box in re.finditer(r"\{\{ETB Box\|([^}]*)\}\}", token):
                params = dict(p.split("=", 1) for p in box.group(1).split("|") if "=" in p)
                link = normalize_title(params.get("link", ""))
                if link and "#" not in link and link not in buckets[current]:
                    buckets[current].append(link)
    return buckets


def resolve_redirects(client: WikiClient, titles: list[str]) -> dict[str, str]:
    """Map redirect titles -> canonical target titles."""
    out: dict[str, str] = {}
    titles = list(dict.fromkeys(titles))
    for i in range(0, len(titles), 50):
        batch = titles[i:i + 50]
        d = client.get(action="query", titles="|".join(batch), redirects="1")
        for r in d.get("query", {}).get("redirects", []):
            out[normalize_title(r["from"])] = normalize_title(r["to"])
        for n in d.get("query", {}).get("normalized", []):
            src, target = normalize_title(n["from"]), normalize_title(n["to"])
            if src != target:
                out[src] = target
    return out


# ---------------------------------------------------------------- image plan

class ImagePlan:
    """Per-page plan of which files to download, at what widths/roles."""

    def __init__(self):
        self.wanted: list[dict] = []   # {file, role, width, caption}
        self.seen: set[tuple[str, str]] = set()

    def add(self, file_title: str | None, role: str, width: int, caption: str = ""):
        if not file_title:
            return
        file_title = normalize_title(re.sub(r"^file:", "", file_title, flags=re.I))
        if not re.search(r"\.(png|jpe?g|gif|webp)$", file_title, re.I):
            return
        key = (file_title, role)
        if key in self.seen:
            return
        self.seen.add(key)
        self.wanted.append({"file": file_title, "role": role, "width": width, "caption": caption})


def fetch_imageinfo(client: WikiClient, files: list[str]) -> dict[str, dict]:
    """File title -> {url, width, height} for original files."""
    info: dict[str, dict] = {}
    files = list(dict.fromkeys(files))
    for i in range(0, len(files), 50):
        batch = [f"File:{f}" for f in files[i:i + 50]]
        d = client.get(action="query", titles="|".join(batch),
                       prop="imageinfo", iiprop="url|size|mime")
        for page in d.get("query", {}).get("pages", []):
            ii = (page.get("imageinfo") or [None])[0]
            if not ii:
                continue
            t = normalize_title(re.sub(r"^File:", "", page["title"]))
            info[t] = {"url": ii["url"], "width": ii.get("width", 0), "height": ii.get("height", 0)}
    return info


# ---------------------------------------------------------------- records

def build_link_resolver(title_map: dict[str, tuple[str, str]], redirects: dict[str, str]):
    def resolve(title: str):
        t = normalize_title(title)
        t = redirects.get(t, t)
        hit = title_map.get(t)
        if not hit:
            return None
        kind, slug = hit
        return f"#APP#/{kind}/{slug}/"
    return resolve


ROLE_NAMES = {"hero": "hero", "thumb": "thumb", "map": "map", "gallery": "gallery", "body": "body"}


def plan_images_for(page: dict, kind: str, slug: str, infobox, is_level: bool) -> ImagePlan:
    plan = ImagePlan()
    if infobox is not None:
        hero_raw = get_param(infobox, "Image") or get_param(infobox, "image1") or get_param(infobox, "Image1")
        if hero_raw:
            gf = gallery_files(hero_raw)
            if gf:
                plan.add(gf[0][0], "hero", HERO_W, gf[0][1])
                plan.add(gf[0][0], "thumb", THUMB_W)
                for f, cap in gf[1:1 + MAX_GALLERY_IMAGES]:
                    plan.add(f, "gallery", BODY_W, cap)
        if is_level:
            for n in range(1, 6):
                mp = get_param(infobox, f"Map{n}")
                if mp:
                    for f, cap in gallery_files(mp) or [(mp, get_param(infobox, f"caption-Map{n}") or "")]:
                        plan.add(f, "map", MAP_W, cap)
    if not any(w["role"] == "hero" for w in plan.wanted):
        # fall back to the first page file that isn't an icon-ish name
        for f in page["files"]:
            if re.search(r"\.(png|jpe?g|webp)$", f, re.I) and not re.search(r"icon|logo|site-", f, re.I):
                plan.add(f, "hero", HERO_W)
                plan.add(f, "thumb", THUMB_W)
                break
    return plan


def download_scaled(client: WikiClient, fi: dict, want_w: int, dest: Path) -> bool:
    """Download a scaled thumbnail, falling back to the original file."""
    url = scaled_url(fi["url"], fi["width"], want_w)
    if client.download(url, dest):
        return True
    return url != fi["url"] and client.download(fi["url"], dest)


def download_planned(client: WikiClient, plan: ImagePlan, iinfo: dict, kind: str,
                     slug: str, no_images: bool) -> tuple[list[dict], dict]:
    """Download files; return (json image records, file-title -> (path,w,h) map for body resolver)."""
    records, counters = [], {}
    resolver_map = {}
    for w in plan.wanted:
        fi = iinfo.get(w["file"])
        if not fi or not fi.get("url"):
            continue
        role = w["role"]
        n = counters.get(role, 0) + 1
        counters[role] = n
        ext = ext_of(w["file"])
        name = role if role in ("hero", "thumb") else f"{role}-{n}"
        rel = f"{kind}/{slug}/{name}.{ext}"
        dest = IMG_DIR / rel
        if not no_images and not download_scaled(client, fi, w["width"], dest):
            continue
        dw, dh = scaled_dims(fi["width"], fi["height"], w["width"])
        rec = {"file": rel, "width": dw, "height": dh, "role": role, "sourceFile": f"File:{w['file']}"}
        if w["caption"]:
            rec["caption"] = w["caption"]
        records.append(rec)
        if role != "thumb":
            resolver_map[w["file"]] = (f"#IMG#/images/{rel}", dw, dh)
    return records, resolver_map


def make_image_resolver(page: dict, iinfo: dict, kind: str, slug: str,
                        already: dict, body_budget: list):
    """Resolver used during HTML sanitization; registers body images lazily."""
    pending: list[dict] = []

    def resolve(file_title: str):
        t = normalize_title(file_title)
        if t in already:
            return already[t]
        fi = iinfo.get(t)
        if not fi or not fi.get("url") or body_budget[0] <= 0:
            return None
        body_budget[0] -= 1
        n = len(pending) + 1
        rel = f"{kind}/{slug}/body-{n}.{ext_of(t)}"
        dw, dh = scaled_dims(fi["width"], fi["height"], BODY_W)
        entry = (f"#IMG#/images/{rel}", dw, dh)
        already[t] = entry
        pending.append({"file": t, "rel": rel, "w": dw, "h": dh})
        return entry

    return resolve, pending


def first_template(wikicode, name_prefix: str):
    for t in wikicode.filter_templates():
        if str(t.name).strip().lower().startswith(name_prefix.lower()):
            return t
    return None


def class_banner_hazards(wikicode) -> list[str]:
    for t in wikicode.filter_templates():
        n = str(t.name).strip().lower()
        if n.startswith("class "):
            vals = [param_text(t, p) for p in ("entity", "sanity", "safety")]
            return [v for v in vals if v]
    return []


def difficulty_from_categories(cats: list[str], infobox) -> tuple[int | None, str]:
    for c in cats:
        m = re.match(r"^Class (\d)$", c)
        if m:
            return int(m.group(1)), f"Class {m.group(1)}"
    for c in cats:
        if c in ("Class Deadzone", "Class Habitable", "Class Variable", "Class Unknown", "Class Upcoming"):
            return None, c.replace("Class ", "")
    sd = param_text(infobox, "SurvivalDifficulty") if infobox is not None else None
    if sd:
        m = re.search(r"Class\s*(\d)", sd)
        if m:
            return int(m.group(1)), f"Class {m.group(1)}"
        return None, sentence_trim(sd, 40)
    return None, "Unknown"


def first_good_paragraph(sections: list[dict], min_len: int = 40) -> str:
    """First real descriptive paragraph: skips infobox residue like
    'Danger Level: Moderate'. Prefers the lead, then Appearance/Description."""
    preferred = ("appearance", "description")
    ordered = [s for s in sections if s["title"] is None]
    ordered += [s for s in sections if (s["title"] or "").lower() in preferred]
    ordered += [s for s in sections if s not in ordered]
    for s in ordered:
        for chunk in s["html"].split("</p>"):
            txt = strip_tags(chunk)
            if (
                len(txt) >= min_len
                and not re.match(r"(?i)\s*(danger\s*level|rarity|found\s*in)\s*:", txt)
                and not re.search(r"(?i)this (page|article) (discusses|is about|describes)", txt)
            ):
                return txt
    return ""


def extract_survival(sections: list[dict], max_each: int = 3) -> dict | None:
    """Pull the first Do's / Don'ts bullet lists into a survival card."""
    joined = "\n".join(s["html"] for s in sections)

    def bullets_after(heading_re: str) -> list[str]:
        m = re.search(heading_re + r".{0,200}?<ul>(.*?)</ul>", joined, re.S | re.I)
        if not m:
            return []
        items = re.findall(r"<li>(.*?)</li>", m.group(1), re.S)
        out = []
        for it in items[:max_each]:
            txt = strip_tags(it)
            if txt:
                out.append(sentence_trim(txt, 160))
        return out

    apo = "['’ʼ]?"
    dos = bullets_after(rf"<h[34]>\s*Do{apo}s\s*:?\s*</h[34]>")
    donts = bullets_after(rf"<h[34]>\s*Don{apo}ts?\s*:?\s*</h[34]>")
    if not dos and not donts:
        return None
    return {"dos": dos, "donts": donts}


def is_junk_section(title: str | None) -> bool:
    """Navboxes, galleries, and template-doc noise that shouldn't ship."""
    if title is None:
        return False
    t = title.strip().lower()
    return (
        t in ("gallery", "references", "site navigation", "level information",
              "entity information", "item information")
        or t.endswith("navigation")
    )


def section_bundle(page_html: str, link_resolver, image_resolver) -> list[dict]:
    out = []
    for heading, chunk in split_sections(page_html):
        clean = sanitize_html(chunk, link_resolver, image_resolver)
        if clean and strip_tags(clean):
            out.append({"title": heading, "html": clean})
    return out


# ---------------------------------------------------------------- main build

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="", help="comma list: levels,entities,items,guides")
    ap.add_argument("--no-images", action="store_true")
    ap.add_argument("--refresh", action="store_true", help="bypass the disk cache")
    args = ap.parse_args()
    only = {s.strip() for s in args.only.split(",") if s.strip()}

    client = WikiClient(refresh=args.refresh)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    IMG_DIR.mkdir(parents=True, exist_ok=True)

    print("== enumerating categories")
    level_titles = [normalize_title(t) for t in category_members(client, "Levels")]
    secret_cat = {normalize_title(t) for t in category_members(client, "Secret Levels")}
    entity_titles = [normalize_title(t) for t in category_members(client, "Entities")]
    item_titles = [normalize_title(t) for t in category_members(client, "Items")]
    guide_titles = [normalize_title(t) for t in
                    category_members(client, "Guides") + category_members(client, "Level Guides")]
    guide_titles += [t for t in EXTRA_GUIDE_TITLES if t not in guide_titles]

    buckets = parse_levels_page(client)
    # areas/bases listed on the Levels page but missing from Category:Levels
    # (e.g. The M.E.G. Base, Abandoned Outpost) still deserve files
    known = set(level_titles)
    for t in buckets["base"] + buckets["area"]:
        if t not in known:
            level_titles.append(t)
            known.add(t)
    main_order = [t for t in buckets["main"] if t in known]
    print(f"   levels={len(level_titles)} (main path {len(main_order)}), "
          f"entities={len(entity_titles)}, items={len(item_titles)}, guides={len(guide_titles)}")

    # global title -> (route-kind, slug)
    title_map: dict[str, tuple[str, str]] = {}
    slugs_seen: set[str] = set()

    def register(title: str, kind: str) -> str:
        slug = slugify(title)
        while slug in slugs_seen:
            slug += "-2"
        slugs_seen.add(slug)
        title_map[normalize_title(title)] = (kind, slug)
        return slug

    level_ids = {t: register(t, "levels") for t in level_titles}
    entity_ids = {t: register(t, "entities") for t in entity_titles}
    item_ids = {t: register(t, "items") for t in item_titles}
    guide_ids = {t: register(t, "guides") for t in guide_titles}

    print("== fetching pages")
    pages: dict[str, dict] = {}
    for t in level_titles + entity_titles + item_titles + guide_titles:
        p = parse_page(client, t)
        if p:
            pages[t] = p
        else:
            print(f"  !! skipping unfetchable page {t}")

    print("== resolving redirect links")
    link_titles: set[str] = set()
    for p in pages.values():
        for l in mwparserfromhell.parse(p["wikitext"]).filter_wikilinks():
            t = normalize_title(str(l.title).split("#")[0])
            if t and t not in title_map and not t.lower().startswith(("file:", "category:")):
                link_titles.add(t)
    redirects = resolve_redirects(client, sorted(link_titles))
    link_resolver = build_link_resolver(title_map, redirects)

    def link_targets(wikicode) -> dict[str, list[str]]:
        """Bucket resolvable wikilink targets by kind, first-appearance order."""
        found: dict[str, list[str]] = {"levels": [], "entities": [], "items": [], "guides": []}
        for l in wikicode.filter_wikilinks():
            t = normalize_title(str(l.title).split("#")[0])
            t = redirects.get(t, t)
            hit = title_map.get(t)
            if hit and hit[1] not in found[hit[0]]:
                found[hit[0]].append(hit[1])
        return found

    print("== collecting image info")
    all_files: list[str] = []
    for p in pages.values():
        all_files += p["files"]
    iinfo = fetch_imageinfo(client, all_files)

    # ---------------- levels
    levels = []
    if not only or "levels" in only:
        print("== building levels")
        for t in level_titles:
            p = pages.get(t)
            if not p:
                continue
            slug = level_ids[t]
            wc = mwparserfromhell.parse(p["wikitext"])
            infobox = first_template(wc, "Level Template")
            cats = p["categories"]

            if t in buckets["joke"]:
                kind = "joke"
            elif t in main_order:
                kind = "main"
            elif t in secret_cat or t in buckets["secret"]:
                kind = "secret"
            elif t in buckets["upcoming"] or "Class Upcoming" in cats or "Upcoming" in cats:
                kind = "upcoming"
            elif t in buckets["area"] or t in buckets["base"]:
                kind = "area"
            elif t in buckets["nonplayable"]:
                kind = "nonplayable"
            else:
                kind = "other"
            if kind in ("upcoming", "nonplayable") or len(p["wikitext"]) < 300:
                if kind == "main":
                    print(f"  ?? main-path level {t} looks empty, keeping anyway")
                elif kind not in ("joke",):
                    kind = "upcoming" if kind in ("upcoming", "other", "nonplayable") else kind

            difficulty, diff_label = difficulty_from_categories(cats, infobox)
            name = t
            display = p["displaytitle"]
            subtitle = param_text(infobox, "SubName")
            if not subtitle and " - " in display:
                subtitle = display.split(" - ", 1)[1].strip()
            if subtitle and (subtitle.lower() == name.lower()
                             or subtitle.lower() in ("n/a", "na", "none", "-", "unknown", "tba")):
                subtitle = None

            part = None
            added_in = param_text(infobox, "AddedIn")
            if added_in:
                m = re.search(r"Part\s*(\d)", added_in)
                if m:
                    part = int(m.group(1))

            plan = plan_images_for(p, "levels", slug, infobox, is_level=True)
            img_records, resolver_map = download_planned(client, plan, iinfo, "levels", slug, args.no_images)
            budget = [0 if args.no_images else MAX_BODY_IMAGES]
            image_resolver, pending_body = make_image_resolver(p, iinfo, "levels", slug, resolver_map, budget)

            sections = section_bundle(p["html"], link_resolver, image_resolver)
            appearance = walkthrough = None
            extra = []
            lead = None
            for s in sections:
                title_l = (s["title"] or "").strip().lower()
                if s["title"] is None:
                    lead = s["html"]
                elif title_l == "appearance" and not appearance:
                    appearance = s["html"]
                elif title_l in WALKTHROUGH_HEADINGS and not walkthrough:
                    walkthrough = s["html"]
                elif is_junk_section(s["title"]):
                    continue
                else:
                    extra.append(s)
            # only keep body images that appear in HTML we actually ship
            # (lead is summary-source only — the page never renders it)
            kept_html = "".join(filter(None, [appearance, walkthrough]))
            kept_html += "".join(s["html"] for s in extra)
            for b in pending_body:
                if b["rel"] not in kept_html:
                    continue
                dest = IMG_DIR / "levels" / slug / Path(b["rel"]).name
                fi = iinfo.get(b["file"])
                if fi and (args.no_images or download_scaled(client, fi, BODY_W, dest)):
                    img_records.append({"file": b["rel"], "width": b["w"], "height": b["h"],
                                        "role": "body", "sourceFile": f"File:{b['file']}"})

            summary_src = param_text(infobox, "Description")
            if not summary_src and appearance:
                summary_src = strip_tags(appearance.split("</p>")[0])
            if not summary_src and lead:
                summary_src = strip_tags(lead.split("</p>")[0])
            summary = sentence_trim(summary_src or "", 400)

            refs = link_targets(wc)
            exits = [title_map[redirects.get(x, x)][1] for x in param_links(infobox, "NextLevel")
                     if title_map.get(redirects.get(x, x), ("", ""))[0] == "levels"] if infobox is not None else []
            entrances = [title_map[redirects.get(x, x)][1] for x in param_links(infobox, "PreviousLevel")
                         if title_map.get(redirects.get(x, x), ("", ""))[0] == "levels"] if infobox is not None else []

            levels.append({
                "id": slug,
                "name": name,
                "subtitle": subtitle,
                "kind": kind,                      # main | secret | area | joke | upcoming | nonplayable | other
                "order": main_order.index(t) if t in main_order else None,
                "part": part,                      # major update ("Part N") that added it
                "difficulty": difficulty,
                "difficultyLabel": diff_label,
                "sanity": param_text(infobox, "SanityDanger"),
                "hazards": class_banner_hazards(wc),
                "entities": [e for e in refs["entities"]],
                "items": [i for i in refs["items"]],
                "exits": exits,
                "entrances": entrances,
                "exitsRaw": param_text(infobox, "NextLevel"),
                "secretParentId": entrances[0] if entrances else None,
                "summary": summary,
                # lead is unrendered (summary source only); drop its images so
                # they can be pruned from disk
                "leadHtml": re.sub(r"<figure>.*?</figure>|<img[^>]*>", "", lead, flags=re.S) if lead else None,
                "appearanceHtml": appearance,
                "walkthroughHtml": walkthrough,
                "extraSections": extra,
                "images": img_records,
                "sourceUrl": f"{WIKI}/wiki/{t.replace(' ', '_')}",
            })

        # derive entrances from exits (union)
        by_id = {l["id"]: l for l in levels}
        for l in levels:
            for x in l["exits"]:
                tgt = by_id.get(x)
                if tgt is not None and l["id"] not in tgt["entrances"]:
                    tgt["entrances"].append(l["id"])
        for l in levels:
            if l["kind"] == "secret" and not l["secretParentId"] and l["entrances"]:
                l["secretParentId"] = l["entrances"][0]

    # ---------------- entities
    entities = []
    if not only or "entities" in only:
        print("== building entities")
        for t in entity_titles:
            p = pages.get(t)
            if not p:
                continue
            slug = entity_ids[t]
            wc = mwparserfromhell.parse(p["wikitext"])
            info = first_template(wc, "EntityInfo")
            infobox = first_template(wc, "Entity Template")
            danger = param_text(info, "danger") if info is not None else None
            if not danger:
                cat_hit = [c for c in p["categories"] if c in DANGER_CATS]
                danger = cat_hit[0] if cat_hit else "Unknown"

            plan = plan_images_for(p, "entities", slug, infobox, is_level=False)
            img_records, resolver_map = download_planned(client, plan, iinfo, "entities", slug, args.no_images)
            budget = [0 if args.no_images else 4]
            image_resolver, pending_body = make_image_resolver(p, iinfo, "entities", slug, resolver_map, budget)
            sections = section_bundle(p["html"], link_resolver, image_resolver)
            kept_sections = [s for s in sections
                             if s["title"] is not None and not is_junk_section(s["title"])]
            kept_html = "".join(s["html"] for s in kept_sections)
            for b in pending_body:
                if b["rel"] not in kept_html:
                    continue
                dest = IMG_DIR / "entities" / slug / Path(b["rel"]).name
                fi = iinfo.get(b["file"])
                if fi and (args.no_images or download_scaled(client, fi, BODY_W, dest)):
                    img_records.append({"file": b["rel"], "width": b["w"], "height": b["h"],
                                        "role": "body", "sourceFile": f"File:{b['file']}"})

            summary = sentence_trim(first_good_paragraph(sections), 320)

            entities.append({
                "id": slug,
                "name": t,
                "dangerLabel": danger,
                "survival": extract_survival(sections),
                "species": param_text(infobox, "Species"),
                "summary": summary,
                "sections": kept_sections,
                "levels": [],  # filled below from level records
                "images": img_records,
                "sourceUrl": f"{WIKI}/wiki/{t.replace(' ', '_')}",
            })

        ent_by_id = {e["id"]: e for e in entities}
        for l in levels:
            for eid in l["entities"]:
                e = ent_by_id.get(eid)
                if e is not None and l["id"] not in e["levels"]:
                    e["levels"].append(l["id"])

    # ---------------- items
    items = []
    if not only or "items" in only:
        print("== building items")
        for t in item_titles:
            p = pages.get(t)
            if not p:
                continue
            slug = item_ids[t]
            wc = mwparserfromhell.parse(p["wikitext"])
            info = first_template(wc, "ItemInfo")
            infobox = first_template(wc, "Items")
            rarity = (param_text(info, "rarity") if info is not None else None) or "Unknown"

            plan = plan_images_for(p, "items", slug, infobox, is_level=False)
            img_records, resolver_map = download_planned(client, plan, iinfo, "items", slug, args.no_images)
            budget = [0 if args.no_images else 3]
            image_resolver, pending_body = make_image_resolver(p, iinfo, "items", slug, resolver_map, budget)
            sections = section_bundle(p["html"], link_resolver, image_resolver)
            kept_sections = [s for s in sections
                             if s["title"] is not None and not is_junk_section(s["title"])]
            kept_html = "".join(s["html"] for s in kept_sections)
            for b in pending_body:
                if b["rel"] not in kept_html:
                    continue
                dest = IMG_DIR / "items" / slug / Path(b["rel"]).name
                fi = iinfo.get(b["file"])
                if fi and (args.no_images or download_scaled(client, fi, BODY_W, dest)):
                    img_records.append({"file": b["rel"], "width": b["w"], "height": b["h"],
                                        "role": "body", "sourceFile": f"File:{b['file']}"})

            desc = param_text(infobox, "ItemDescription")
            summary = sentence_trim(desc or first_good_paragraph(sections), 320)
            refs = link_targets(wc)

            items.append({
                "id": slug,
                "name": t,
                "rarity": rarity,
                "summary": summary,
                "sections": kept_sections,
                "foundInLevels": refs["levels"],
                "images": img_records,
                "sourceUrl": f"{WIKI}/wiki/{t.replace(' ', '_')}",
            })

    # ---------------- guides
    guides = []
    if not only or "guides" in only:
        print("== building guides")
        for t in guide_titles:
            p = pages.get(t)
            if not p:
                continue
            slug = guide_ids[t]
            wc = mwparserfromhell.parse(p["wikitext"])
            budget = [0 if args.no_images else 4]
            plan = plan_images_for(p, "guides", slug, None, is_level=False)
            img_records, resolver_map = download_planned(client, plan, iinfo, "guides", slug, args.no_images)
            image_resolver, pending_body = make_image_resolver(p, iinfo, "guides", slug, resolver_map, budget)
            sections = section_bundle(p["html"], link_resolver, image_resolver)
            title = t
            if t == "Full Game Guide":
                # keep only the general-tactics intro; the per-level guide
                # content duplicates the level pages
                cut = next((i for i, s in enumerate(sections)
                            if (s["title"] or "").strip().lower() in ("levels", "level 0")), None)
                if cut is not None:
                    sections = sections[:cut]
                title = "Field Tactics"

            kept_sections = [s for s in sections if not is_junk_section(s["title"])]
            kept_html = "".join(s["html"] for s in kept_sections)
            for b in pending_body:
                if b["rel"] not in kept_html:
                    continue
                dest = IMG_DIR / "guides" / slug / Path(b["rel"]).name
                fi = iinfo.get(b["file"])
                if fi and (args.no_images or download_scaled(client, fi, BODY_W, dest)):
                    img_records.append({"file": b["rel"], "width": b["w"], "height": b["h"],
                                        "role": "body", "sourceFile": f"File:{b['file']}"})

            lead = next((s["html"] for s in sections if s["title"] is None), None)
            refs = link_targets(wc)
            guides.append({
                "id": slug,
                "title": title,
                "summary": sentence_trim(strip_tags((lead or "").split("</p>")[0]) or "", 300),
                "sections": kept_sections,
                "relatedLevelIds": refs["levels"],
                "images": img_records,
                "sourceUrl": f"{WIKI}/wiki/{t.replace(' ', '_')}",
            })

    # ---------------- write
    def dump(name: str, records: list[dict]):
        payload = {
            "$meta": {
                "fetchedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
                "source": WIKI,
                "license": "CC BY-SA 3.0",
                "count": len(records),
            },
            "items": records,
        }
        (DATA_DIR / f"{name}.json").write_text(
            json.dumps(payload, indent=1, ensure_ascii=False, sort_keys=True) + "\n")
        print(f"   wrote src/data/{name}.json ({len(records)} records)")

    kind_rank = {"main": 0, "secret": 1, "area": 2, "joke": 3, "other": 4, "nonplayable": 5, "upcoming": 6}
    levels.sort(key=lambda l: (kind_rank.get(l["kind"], 9),
                               l["order"] if l["order"] is not None else 999, l["id"]))
    entities.sort(key=lambda e: e["name"])
    items.sort(key=lambda i: i["name"])

    if not only or "levels" in only:
        dump("levels", levels)
    if not only or "entities" in only:
        dump("entities", entities)
    if not only or "items" in only:
        dump("items", items)
    if not only or "guides" in only:
        dump("guides", guides)
    (DATA_DIR / "meta.json").write_text(json.dumps({
        "fetchedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "source": WIKI,
        "sourceName": "Escape the Backrooms Wiki",
        "license": "CC BY-SA 3.0",
        "licenseUrl": "https://creativecommons.org/licenses/by-sa/3.0/",
        "counts": {"levels": len(levels), "entities": len(entities),
                   "items": len(items), "guides": len(guides)},
    }, indent=1) + "\n")
    print(f"== done ({client.requests_made} network requests this run)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
