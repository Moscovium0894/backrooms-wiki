"""Sanitize and rewrite Fandom-rendered HTML into clean app-ready fragments.

Stdlib-only (html.parser). The sanitizer is an allowlist re-serializer:
unknown tags are unwrapped (children kept), known-junk subtrees are dropped
wholesale, internal wiki links are rewritten to #APP# route placeholders and
images to #IMG# local-path placeholders (both resolved to the site base URL
at render time, keeping the JSON base-path-agnostic).
"""

from __future__ import annotations

import html as htmllib
import re
from html.parser import HTMLParser
from typing import Callable, Optional
from urllib.parse import unquote

ALLOWED_TAGS = {
    "p", "h2", "h3", "h4", "ul", "ol", "li", "b", "strong", "i", "em",
    "a", "img", "figure", "figcaption", "table", "thead", "tbody", "tr",
    "td", "th", "br", "blockquote", "code", "pre", "u", "s", "small",
    "sup", "sub", "dl", "dt", "dd", "caption",
}
VOID_TAGS = {"br", "img"}
# whole subtree removed
DROP_TAGS = {"script", "style", "aside", "nav", "noscript", "iframe",
             "video", "audio", "form", "button", "input", "select", "map"}
DROP_CLASS_RE = re.compile(
    r"(?:^|\s)(?:toc|navbox|mw-editsection|reference|references|noprint|"
    r"portable-infobox|infobox|wikia-gallery|gallery|notice[a-z-]*|mbox|"
    r"hatnote|dablink|mw-empty-elt|cquote|quote|printfooter|catlinks|"
    r"mw-references-wrap|reflist)(?:\s|$)",
    re.I,
)

WIKI_LINK_RE = re.compile(r"^(?:https?://escapethebackrooms\.fandom\.com)?/wiki/([^?]+)$")


def file_name_from_src(src: str) -> Optional[str]:
    """Extract the File title (spaces, no 'File:' prefix) from a static.wikia URL."""
    m = re.search(r"/images/[0-9a-f]/[0-9a-f]{2}/([^/]+)/revision/", src)
    if not m:
        return None
    return unquote(m.group(1)).replace("_", " ")


class _Sanitizer(HTMLParser):
    def __init__(self, link_resolver, image_resolver):
        super().__init__(convert_charrefs=True)
        self.link_resolver = link_resolver      # title -> href placeholder | None
        self.image_resolver = image_resolver    # file name -> (path, w, h) | None
        self.out: list[str] = []
        self.skip_depth = 0
        # stack of (tag, emitted_close_needed)
        self.stack: list[tuple[str, bool]] = []

    # -- helpers -------------------------------------------------------
    def _emit(self, s: str) -> None:
        if self.skip_depth == 0:
            self.out.append(s)

    @staticmethod
    def _attr(attrs, name):
        for k, v in attrs:
            if k == name:
                return v
        return None

    # -- parser hooks --------------------------------------------------
    def handle_starttag(self, tag, attrs):
        if self.skip_depth > 0:
            if tag not in VOID_TAGS:
                self.skip_depth += 1
            return
        cls = self._attr(attrs, "class") or ""
        if tag in DROP_TAGS or DROP_CLASS_RE.search(cls):
            if tag in VOID_TAGS:
                return
            self.skip_depth = 1
            return
        if tag == "img":
            self._handle_img(attrs)
            return
        if tag == "a":
            self._handle_a_start(attrs)
            return
        if tag in ALLOWED_TAGS:
            if tag in VOID_TAGS:
                self._emit(f"<{tag}>")
            else:
                self._emit(f"<{tag}>")
                self.stack.append((tag, True))
        else:
            # unwrap: keep children, no tag emitted
            self.stack.append((tag, False))

    def handle_startendtag(self, tag, attrs):
        if tag == "img":
            self.handle_starttag(tag, attrs)
        elif tag == "br":
            self._emit("<br>")

    def handle_endtag(self, tag):
        if self.skip_depth > 0:
            if tag not in VOID_TAGS:
                self.skip_depth -= 1
            return
        if tag in VOID_TAGS:
            return
        # pop until we find the matching open (tolerates minor misnesting)
        for i in range(len(self.stack) - 1, -1, -1):
            t, emitted = self.stack[i]
            if t == tag:
                for _t, _e in reversed(self.stack[i:]):
                    if _e:
                        self._emit(f"</{_t}>")
                del self.stack[i:]
                return

    def handle_data(self, data):
        if self.skip_depth == 0 and data:
            self._emit(htmllib.escape(data, quote=False))

    # -- element-specific ----------------------------------------------
    def _handle_img(self, attrs):
        src = self._attr(attrs, "data-src") or self._attr(attrs, "src") or ""
        if src.startswith("data:"):
            return
        fname = file_name_from_src(src)
        resolved = self.image_resolver(fname) if fname else None
        if not resolved:
            return
        path, w, h = resolved
        alt = htmllib.escape(self._attr(attrs, "alt") or "", quote=True)
        self._emit(f'<img src="{htmllib.escape(path, quote=True)}" alt="{alt}" width="{w}" height="{h}">')

    def _handle_a_start(self, attrs):
        href = self._attr(attrs, "href") or ""
        cls = self._attr(attrs, "class") or ""
        # anchors wrapping images / file links: unwrap
        if "image" in cls or "/wiki/File:" in href or href.startswith("#"):
            self.stack.append(("a", False))
            return
        m = WIKI_LINK_RE.match(href.split("#")[0]) if href else None
        if m:
            title = unquote(m.group(1)).replace("_", " ")
            target = self.link_resolver(title)
            if target:
                self._emit(f'<a href="{htmllib.escape(target, quote=True)}">')
                self.stack.append(("a", True))
            else:
                self.stack.append(("a", False))  # unresolved internal: plain text
            return
        if href.startswith("http://") or href.startswith("https://"):
            self._emit(f'<a href="{htmllib.escape(href, quote=True)}" rel="noopener nofollow" target="_blank">')
            self.stack.append(("a", True))
            return
        self.stack.append(("a", False))


_EMPTY_P_RE = re.compile(r"<p>(?:\s|<br>)*</p>")
_WS_RE = re.compile(r"\n{3,}")


def sanitize_html(
    raw_html: str,
    link_resolver: Callable[[str], Optional[str]],
    image_resolver: Callable[[str], Optional[tuple[str, int, int]]],
) -> str:
    s = _Sanitizer(link_resolver, image_resolver)
    s.feed(raw_html)
    s.close()
    # close any dangling emitted tags
    for tag, emitted in reversed(s.stack):
        if emitted:
            s.out.append(f"</{tag}>")
    out = "".join(s.out)
    out = _EMPTY_P_RE.sub("", out)
    out = _WS_RE.sub("\n\n", out)
    return out.strip()


_H2_SPLIT_RE = re.compile(r"<h2[^>]*>(.*?)</h2>", re.S)
_TAG_RE = re.compile(r"<[^>]+>")


def split_sections(raw_html: str) -> list[tuple[Optional[str], str]]:
    """Split rendered page HTML on <h2> headings.

    Returns [(heading_text_or_None, html_chunk), ...]; the first chunk is the
    lead (heading None). Heading text has tags stripped.
    """
    sections: list[tuple[Optional[str], str]] = []
    pos = 0
    heading: Optional[str] = None
    for m in _H2_SPLIT_RE.finditer(raw_html):
        sections.append((heading, raw_html[pos:m.start()]))
        heading = htmllib.unescape(_TAG_RE.sub("", m.group(1))).strip()
        pos = m.end()
    sections.append((heading, raw_html[pos:]))
    return sections


def strip_tags(raw_html: str) -> str:
    """Plain text from an HTML fragment (for summaries)."""
    txt = _TAG_RE.sub(" ", raw_html)
    txt = htmllib.unescape(txt)
    return re.sub(r"\s+", " ", txt).strip()
