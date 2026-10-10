#!/usr/bin/env python3
"""Dem nhung chuoi NGUOI CHOI DOC DUOC ma chua di qua bang ngon ngu.

Cach nhan: mot chuoi con sot lai la mot STRING LITERAL trong khoi script chinh
co dau tieng Viet. Chu thich khong tinh (khong phai literal), va bang NGU cung
khong tinh — o tieng Viet cua no PHAI co dau.

Chay: python3 tools/i18n-check.py [--liet-ke]
Ra: so chuoi con lai, tach theo "chuoi thuong" va "template co noi suy".
"""
import io, re, sys, pathlib

G = pathlib.Path(__file__).resolve().parent.parent / 'game'
s = (G / 'hotstage.html').read_text(encoding='utf-8')

a = s.index('<script>', s.index('three.min.js')) + 8
b = s.index('</' + 'script>', a)
js = s[a:b]

# Cat bang NGU ra: no la noi DUY NHAT duoc phep chua cau tieng Viet co dau.
m = re.search(r'\nconst NGU = \{\n', js)
if m:
    d = 0
    i = js.index('{', m.start())
    for k in range(i, len(js)):
        if js[k] == '{': d += 1
        elif js[k] == '}':
            d -= 1
            if d == 0:
                js = js[:i] + js[k + 1:]
                break

V = set('àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ')
V |= {c.upper() for c in V}

# Bo chu thich truoc khi tim literal: chu thich tieng Viet co dau khong phai loi.
js = re.sub(r'/\*.*?\*/', '', js, flags=re.S)
js = re.sub(r'(?m)^\s*//.*$', '', js)

pat = re.compile(r"""'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`""", re.S)
con = [x.group(0) for x in pat.finditer(js) if any(c in V for c in x.group(0))]
tpl = [x for x in con if x.startswith('`')]
thuong = [x for x in con if not x.startswith('`')]

if '--liet-ke' in sys.argv:
    for x in sorted(set(con)):
        print('  ', x[:150])
print('con %d chuoi chua dich (%d thuong, %d template), %d duy nhat'
      % (len(con), len(thuong), len(tpl), len(set(con))))
sys.exit(0)
