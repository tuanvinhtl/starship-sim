#!/usr/bin/env python3
"""Tach hai lo vat ly ra khoi hotstage.html thanh module Node chay duoc.

Ca hai khoi trong HTML deu la UMD va tu khai "khong phu thuoc DOM", nen chay
thang duoc bang node — khong can trinh duyet, khong can GPU. Sua HTML xong thi
chay lai script nay de flight.js / ship3d.js khong bi lech.
"""
import re, sys, pathlib

G = pathlib.Path(__file__).resolve().parent.parent / 'game'
html = (G / 'hotstage.html').read_text(encoding='utf-8')

BLOCKS = [
    ('flight.js', '/* Flight model 3-DOF'),
    ('ship3d.js', '/* ============================================================================\n   SHIP 3D'),
    ('dock.js',   '/* ============================================================================\n   GHEP NOI'),
]

for name, marker in BLOCKS:
    a = html.index(marker)
    # ket khoi UMD la dong "});" o dau dong dau tien sau moc
    m = re.compile(r'^\}\);$', re.M).search(html, a)
    if not m:
        sys.exit(f'khong tim thay ket khoi cua {name}')
    body = html[a:m.end()] + '\n'
    out = G / name
    old = out.read_text(encoding='utf-8') if out.exists() else ''
    out.write_text(body, encoding='utf-8')
    print(f'{name}: {body.count(chr(10))} dong  {"(khong doi)" if old == body else "(da cap nhat)"}')
