#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Gộp study-guide/*.md thành business-result.md + book-data.js."""

import json
import re
from pathlib import Path

ROOT = Path(r"E:\project\business-result")
SG = ROOT / "study-guide"


def slug(text: str) -> str:
    """Bản Python của hàm slug() trong script.js."""
    text = re.sub(r"[*`]", "", text).lower()
    kept = "".join(c for c in text if c.isalnum() or c.isspace() or c == "-")
    return re.sub(r"\s+", "-", kept.strip())


# ── Thứ tự các mục + tiêu đề mục (H1 của file, trừ README) ──────────────
UNITS = [
    ("unit-01-working-life.md", "Unit 1 — Working life"),
    ("unit-02-work-life-balance.md", "Unit 2 — Work–life balance"),
    ("unit-03-projects.md", "Unit 3 — Projects"),
    ("unit-04-services-systems.md", "Unit 4 — Services & systems"),
    ("unit-05-customers.md", "Unit 5 — Customers"),
    ("unit-06-guests-visitors.md", "Unit 6 — Guests & visitors"),
    ("unit-07-working-online.md", "Unit 7 — Working online"),
    ("unit-08-finance.md", "Unit 8 — Finance"),
    ("unit-09-logistics.md", "Unit 9 — Logistics"),
    ("unit-10-facilities.md", "Unit 10 — Facilities"),
    ("unit-11-decisions.md", "Unit 11 — Decisions"),
    ("unit-12-innovation.md", "Unit 12 — Innovation"),
    ("unit-13-breakdowns.md", "Unit 13 — Breakdowns"),
    ("unit-14-processes.md", "Unit 14 — Processes"),
    ("unit-15-performance.md", "Unit 15 — Performance"),
]

ORDER = (
    [("README.md", "Hướng dẫn ôn tập"), ("book-map.md", "Bản đồ toàn sách")]
    + UNITS
    + [
        ("grammar-reference.md", "Ngữ pháp — tra nhanh toàn sách"),
        ("functional-language.md", "Sổ tay mẫu câu theo tình huống"),
        ("vocabulary.md", "Từ vựng theo chủ đề"),
    ]
)

FILE_TO_ID = {name: slug(title) for name, title in ORDER}

FRONT = """# Business Result Intermediate B1

*Ghi chú ôn tập tự soạn theo giáo trình Business Result Intermediate, 2nd edition \
(John Hughes & Jon Naunton · Oxford University Press) — 15 unit, 63 bài nghe.*

> 📒 **Đây là ghi chú ôn tập, không phải bản sao sách.** Mỗi unit gồm tóm tắt chủ đề, bảng từ vựng, \
giải thích ngữ pháp bằng tiếng Việt, sổ tay mẫu câu và bài tự luyện. Bài đọc, bài tập và lời thoại \
gốc vẫn nằm trong sách giấy.

> 🎧 **Audio khớp với sách.** 63 tệp mp3 trong thư mục `audio/` được chia sẵn theo unit — mở một unit \
bất kỳ là thấy danh sách bài nghe của unit đó ngay đầu trang.

> ⌨️ **Phím tắt:** `/` mở ô tìm kiếm · `Space` phát/dừng · `←` `→` tua 5 giây.
"""


def collapse(s: str) -> str:
    """Gộp các gạch nối lặp — để khớp neo kiểu GitHub với slug của script.js."""
    return re.sub(r"-+", "-", s)


def heading_map(raw: str) -> dict:
    """{neo-đã-gộp-gạch: slug thật} cho mọi heading trong một file."""
    out = {}
    for m in re.finditer(r"^#{2,5} (.+)$", raw, flags=re.M):
        s = slug(m.group(1))
        out[collapse(s)] = s
    return out


def clean(raw: str, sec_id: str, heads: dict, all_heads: dict) -> str:
    lines = raw.replace("\r\n", "\n").split("\n")

    # 1. Bỏ dải điều hướng cuối file (← Unit trước · Mục lục · Unit sau →)
    while lines and not lines[-1].strip():
        lines.pop()
    if lines and ("Mục lục](README.md)" in lines[-1] or lines[-1].lstrip().startswith("←")):
        lines.pop()
        while lines and not lines[-1].strip():
            lines.pop()
        if lines and re.fullmatch(r"-{3,}", lines[-1].strip()):
            lines.pop()

    # 2. H1 -> tiêu đề mục; README dùng tiêu đề riêng
    out = []
    for i, line in enumerate(lines):
        if line.startswith("# ") and not out:
            continue  # H1 sẽ được thay bằng '## <title>' ở ngoài
        out.append(line)

    text = "\n".join(out)

    # 3. Hạ một cấp mọi heading còn lại (## -> ###, ### -> ####)
    text = re.sub(r"^(#{2,5})(\s)", lambda m: "#" + m.group(1) + m.group(2), text, flags=re.M)

    # 4. Neo trong cùng một trang: #x  ->  #<sec>/x
    def same(m):
        a = heads.get(collapse(m.group(1)), m.group(1))
        return f"](#{sec_id}/{a})"

    text = re.sub(r"\]\(#([^)/]+)\)", same, text)

    # 5. Liên kết sang file khác: foo.md[#anchor]  ->  #<sec-đích>[/anchor]
    def xfile(m):
        fname = m.group(1) + ".md"
        target = FILE_TO_ID.get(fname)
        if not target:
            return m.group(0)
        anchor = m.group(3)
        if not anchor:
            return f"](#{target})"
        anchor = all_heads.get(fname, {}).get(collapse(anchor), anchor)
        return f"](#{target}/{anchor})"

    text = re.sub(r"\]\(([A-Za-z0-9_-]+)\.md(#([^)]+))?\)", xfile, text)

    return text.strip("\n")


RAW = {name: (SG / name).read_text(encoding="utf-8") for name, _ in ORDER}
ALL_HEADS = {name: heading_map(raw) for name, raw in RAW.items()}

parts = [FRONT.strip("\n")]

for name, title in ORDER:
    body = clean(RAW[name], slug(title), ALL_HEADS[name], ALL_HEADS)
    parts.append(f"## {title}\n\n{body}")

md = "\n\n".join(parts) + "\n"

# ── Ghi business-result.md ──────────────────────────────────────────────
(ROOT / "business-result.md").write_text(md, encoding="utf-8", newline="\n")

# ── Ghi book-data.js (giữ nguyên khối AUDIO_FILES đang có) ─────────────
old = (ROOT / "book-data.js").read_text(encoding="utf-8")
at = old.index("window.AUDIO_FILES")
audio_block = old[at:]

header = (
    "// Tệp này được sinh tự động từ thư mục study-guide/ — đừng sửa tay.\n"
    "// Sinh lại: python build_data.py\n"
    "// (hoặc chạy trang qua http để script.js đọc thẳng business-result.md)\n"
)
js = header + "window.BOOK_MD = " + json.dumps(md, ensure_ascii=False) + ";\n" + audio_block
(ROOT / "book-data.js").write_text(js, encoding="utf-8", newline="\n")

# ── Soát liên kết nội bộ ────────────────────────────────────────────────
sec_heads, cur = {}, None
for line in md.split("\n"):
    m = re.match(r"^## (.+)$", line)
    if m:
        cur = slug(m.group(1))
        sec_heads[cur] = set()
    elif cur:
        m = re.match(r"^#{3,5} (.+)$", line)
        if m:
            sec_heads[cur].add(slug(m.group(1)))

broken = []
for m in re.finditer(r"\]\(#([^)]+)\)", md):
    sec, _, head = m.group(1).partition("/")
    if sec not in sec_heads:
        broken.append(f"mục không có: #{m.group(1)}")
    elif head and head not in sec_heads[sec]:
        broken.append(f"neo không có: #{m.group(1)}")

# ── Báo cáo ─────────────────────────────────────────────────────────────
n_link = len(re.findall(r"\]\(#", md))
n_table = len(re.findall(r"^\s*\|[-\s:|]+\|\s*$", md, flags=re.M))

print(f"Mục      : {len(sec_heads)}  ({len(UNITS)} unit + {len(sec_heads) - len(UNITS)} phần tra cứu)")
print(f"Heading  : {sum(len(v) for v in sec_heads.values())}")
print(f"Bảng     : {n_table}")
print(f"Liên kết : {n_link}  — hỏng: {len(broken)}")
for b in sorted(set(broken)):
    print("   ✗ " + b)
print(f"Markdown : {len(md):,} ký tự · book-data.js: {len(js):,} ký tự")
if broken:
    raise SystemExit("Có liên kết hỏng — sửa study-guide rồi chạy lại.")
