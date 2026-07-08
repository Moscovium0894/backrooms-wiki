#!/usr/bin/env python3
"""Validate the scraped JSON in src/data/ before it is committed.

Errors exit 1; warnings are printed but pass. No third-party deps.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "src" / "data"
PUB = ROOT / "public"

errors: list[str] = []
warnings: list[str] = []


def err(msg: str) -> None:
    errors.append(msg)


def warn(msg: str) -> None:
    warnings.append(msg)


def load(name: str) -> list[dict]:
    path = DATA / f"{name}.json"
    if not path.exists():
        err(f"{name}.json missing")
        return []
    doc = json.loads(path.read_text())
    if "items" not in doc or "$meta" not in doc:
        err(f"{name}.json: missing $meta/items envelope")
        return []
    if doc["$meta"].get("count") != len(doc["items"]):
        err(f"{name}.json: $meta.count != len(items)")
    return doc["items"]


LEAK_RES = {
    "wikitext braces": re.compile(r"\{\{"),
    "unrewritten wiki link": re.compile(r'href="/wiki/'),
    "script tag": re.compile(r"<script", re.I),
    "srcset": re.compile(r"srcset="),
    "css class": re.compile(r'class="'),
    "style attr": re.compile(r'style="'),
}


def html_fields(rec: dict):
    for key in ("leadHtml", "appearanceHtml", "walkthroughHtml"):
        if rec.get(key):
            yield key, rec[key]
    for s in rec.get("sections", []) + rec.get("extraSections", []):
        if s.get("html"):
            yield f'section "{s.get("title")}"', s["html"]


def check_types(name: str, rec: dict, spec: dict) -> None:
    for field, kinds in spec.items():
        if field not in rec:
            err(f"{name} {rec.get('id')}: missing field {field}")
        elif not isinstance(rec[field], kinds):
            err(f"{name} {rec.get('id')}: {field} has type {type(rec[field]).__name__}")


def main() -> int:
    levels = load("levels")
    entities = load("entities")
    items = load("items")
    guides = load("guides")

    none = type(None)
    all_ids: dict[str, str] = {}
    for kind, recs in (("levels", levels), ("entities", entities),
                       ("items", items), ("guides", guides)):
        for r in recs:
            rid = r.get("id")
            if not rid:
                err(f"{kind}: record without id: {str(r)[:80]}")
                continue
            if rid in all_ids:
                err(f"duplicate id across files: {rid} ({all_ids[rid]} + {kind})")
            all_ids[rid] = kind

    level_ids = {r["id"] for r in levels if "id" in r}
    entity_ids = {r["id"] for r in entities if "id" in r}
    item_ids = {r["id"] for r in items if "id" in r}

    # ---- levels
    spec = {"id": str, "name": str, "subtitle": (str, none), "kind": str,
            "order": (int, none), "part": (int, none), "difficulty": (int, none),
            "difficultyLabel": str, "sanity": (str, none), "hazards": list,
            "entities": list, "items": list, "exits": list, "entrances": list,
            "secretParentId": (str, none), "summary": str,
            "walkthroughHtml": (str, none), "images": list, "sourceUrl": str}
    orders = []
    for l in levels:
        check_types("level", l, spec)
        for e in l.get("entities", []):
            if e not in entity_ids:
                err(f"level {l['id']}: unknown entity {e}")
        for i in l.get("items", []):
            if i not in item_ids:
                err(f"level {l['id']}: unknown item {i}")
        for x in l.get("exits", []) + l.get("entrances", []):
            if x not in level_ids:
                err(f"level {l['id']}: unknown exit/entrance {x}")
        sp = l.get("secretParentId")
        if sp and sp not in level_ids:
            err(f"level {l['id']}: unknown secretParentId {sp}")
        if l.get("kind") == "main":
            orders.append(l.get("order"))
            if not l.get("summary"):
                warn(f"main level {l['id']}: empty summary")
            if not l.get("walkthroughHtml"):
                warn(f"main level {l['id']}: no walkthrough section")
            if not l.get("exits") and l.get("order") not in (None, len(orders)):
                pass  # spine edges come from order; exits optional
        if not l.get("sourceUrl", "").startswith("https://escapethebackrooms.fandom.com/"):
            err(f"level {l['id']}: bad sourceUrl")

    if orders:
        expected = list(range(len(orders)))
        if sorted(o for o in orders if o is not None) != expected:
            err(f"main-path orders not contiguous 0..{len(orders) - 1}: {sorted(orders, key=lambda x: (x is None, x))}")

    # ---- entities / items / guides
    for e in entities:
        check_types("entity", e, {"id": str, "name": str, "dangerLabel": str,
                                  "summary": str, "sections": list, "levels": list,
                                  "images": list, "sourceUrl": str})
        for lid in e.get("levels", []):
            if lid not in level_ids:
                err(f"entity {e['id']}: unknown level {lid}")
        if not e.get("summary"):
            warn(f"entity {e['id']}: empty summary")
    for i in items:
        check_types("item", i, {"id": str, "name": str, "rarity": str, "summary": str,
                                "sections": list, "foundInLevels": list,
                                "images": list, "sourceUrl": str})
        for lid in i.get("foundInLevels", []):
            if lid not in level_ids:
                err(f"item {i['id']}: unknown level {lid}")
    for g in guides:
        check_types("guide", g, {"id": str, "title": str, "sections": list,
                                 "relatedLevelIds": list, "sourceUrl": str})
        for lid in g.get("relatedLevelIds", []):
            if lid not in level_ids:
                err(f"guide {g['id']}: unknown level {lid}")

    # ---- images on disk + html leakage
    for kind, recs in (("levels", levels), ("entities", entities),
                       ("items", items), ("guides", guides)):
        for r in recs:
            for img in r.get("images", []):
                p = PUB / "images" / img.get("file", "")
                if not p.exists():
                    err(f"{kind} {r['id']}: image missing on disk: {img.get('file')}")
                elif p.stat().st_size < 1024:
                    warn(f"{kind} {r['id']}: suspiciously small image {img.get('file')}")
                if not img.get("width") or not img.get("height"):
                    err(f"{kind} {r['id']}: image without dimensions: {img.get('file')}")
            for where, html in html_fields(r):
                for label, rx in LEAK_RES.items():
                    if rx.search(html):
                        err(f"{kind} {r['id']} [{where}]: leaked {label}")
                for m in re.finditer(r'src="([^"]+)"', html):
                    src = m.group(1)
                    if not src.startswith("#IMG#/images/"):
                        err(f"{kind} {r['id']} [{where}]: non-local img src {src[:80]}")
                    else:
                        p = PUB / src.replace("#IMG#/", "")
                        if not p.exists():
                            err(f"{kind} {r['id']} [{where}]: body image missing on disk {src}")
                for m in re.finditer(r'href="([^"]+)"', html):
                    href = m.group(1)
                    if not (href.startswith("#APP#/") or href.startswith("http")):
                        err(f"{kind} {r['id']} [{where}]: unexpected href {href[:80]}")

    # ---- floors
    main_count = sum(1 for l in levels if l.get("kind") == "main")
    if main_count < 20:
        err(f"only {main_count} main-path levels (expected >= 20)")
    if len(entities) < 20:
        err(f"only {len(entities)} entities (expected >= 20)")
    if len(items) < 15:
        err(f"only {len(items)} items (expected >= 15)")

    # ---- report
    for w in warnings:
        print(f"WARN  {w}")
    for e in errors:
        print(f"ERROR {e}")
    print(f"\n{len(errors)} errors, {len(warnings)} warnings "
          f"({len(levels)} levels / {len(entities)} entities / {len(items)} items / {len(guides)} guides)")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
