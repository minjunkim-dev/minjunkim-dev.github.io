"""Run after npm run build: python3 scripts/verify-site.py."""
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit
import re

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"


class Page(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.h1 = 0
        self.ids = set()
        self.links = []
        self.description = False
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        self.h1 += tag == "h1"
        if "id" in attrs:
            assert attrs["id"] not in self.ids, f"Duplicate id: {attrs['id']}"
            self.ids.add(attrs["id"])
        if tag == "meta" and attrs.get("name") == "description":
            self.description = bool(attrs.get("content"))
        for key in ("href", "src"):
            if attrs.get(key):
                self.links.append(attrs[key])


files = sorted(DIST.rglob("*.html"))
assert files, "Build the site first"
pages = {p: Page(p.read_text()) for p in files}
checked_links = 0
for path, page in pages.items():
    html = path.read_text()
    assert page.h1 == 1 and page.description, path
    assert "main-content" in page.ids, path
    assert not re.search(r"010[- ]?\d{4}[- ]?\d{4}|/Users/|atlassian\.net|gitlab\.", html), path
    for href in page.links:
        url = urlsplit(href)
        if url.scheme or url.netloc:
            continue
        target = (DIST / unquote(url.path).lstrip("/")) if url.path.startswith("/") else (path.parent / unquote(url.path))
        if not url.path:
            target = path
        elif target.is_dir():
            target /= "index.html"
        assert target.is_file(), (path, href)
        if url.fragment and target in pages:
            assert unquote(url.fragment) in pages[target].ids, (path, href)
        checked_links += 1

home = (DIST / "index.html").read_text()
assert home.index('id="projects-title"') < home.index('id="experience-title"') < home.index('id="featured-writing"')
for anchor in ("myd", "tbn", "mobile-id"):
    assert f'/about/#{anchor}' in home, anchor
about = (DIST / "about/index.html").read_text()
for required in ["MyD", "TBN교통방송", "담당 범위는 앱 내 모바일 신분증 솔루션", "설계안을 제안", "공동 구현", "마이주식", "fail-open", "87개 버전", "99.8%", "배포 자동화", "단과대학 수석 졸업", "4.42 / 4.5", "2018.03", "2022.06.02"]:
    assert required in about, required
for path in files:
    assert "실패를 설계합니다" not in path.read_text(), path
assert (DIST / "og-default.png").read_bytes() == (ROOT / "public/og-default.png").read_bytes()
print(f"Site checks passed: {len(files)} HTML pages, {checked_links} internal links/assets, career scope and public-data checks.")
