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
goc = js          # giu ban day du de doc danh sach khoa

def cat_khoi(src, moc):
    """Bo mot khoi { ... } can bang ngoac, tinh tu `moc`."""
    m = re.search(moc, src)
    if not m: return src
    d = 0
    i = src.index('{', m.start())
    for k in range(i, len(src)):
        if src[k] == '{': d += 1
        elif src[k] == '}':
            d -= 1
            if d == 0: return src[:i] + src[k + 1:]
    return src

# Ba vung CO Y giu tieng Viet, bo ra khoi phep dem:
#  · bang NGU — o tieng Viet cua no PHAI co dau
#  · WEATHER trong flight.js — `name` o do la nhan goc de doc ma, khong hien ra
#    man hinh (lop hien dich bang khoa 'wx.<k>'); mo-dun nay phai chay duoc
#    bang node cho cac bo cham nen khong duoc dinh gi toi ngon ngu
#  · bang TUNE (phim O) — cong cu chinh hinh giua tao va nguoi dung, khong phai
#    man choi; dich no khong phuc vu ai
js = cat_khoi(js, r'\nconst NGU = \{\n')
js = cat_khoi(js, r'\n  const WEATHER = \{\n')
#  · NHAN trong lop bao loi — no tu mang ban dich rut gon cua chinh no,
#    vi phai noi duoc ca khi khoi script chet luc phan tich
js = cat_khoi(js, r'\n  const NHAN = \{\n')
i = js.find('const TUNE = (() => {')
if i >= 0:
    j = js.find('\n})();', i)
    if j >= 0: js = js[:i] + js[j:]
# ten ngon ngu tu viet bang chinh no
js = js.replace("['vi', 'Tiếng Việt']", '')

V = set('àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ')
V |= {c.upper() for c in V}

# Bo chu thich truoc khi tim literal: chu thich tieng Viet co dau khong phai loi.
js = re.sub(r'/\*.*?\*/', '', js, flags=re.S)
js = re.sub(r'(?m)^\s*//.*$', '', js)

pat = re.compile(r"""'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`""", re.S)
con = [x.group(0) for x in pat.finditer(js) if any(c in V for c in x.group(0))]
tpl = [x for x in con if x.startswith('`')]
thuong = [x for x in con if not x.startswith('`')]

# ---- kiem THU HAI: chuoi khong dau van la chuoi nguoi choi doc ----
# Phep dem o tren nhan chuoi bang DAU tieng Viet, nen "Qua max-Q", "Boostback
# burn", "Belly flop" lot het. Da lot that: sau khi bang dem bao 0, mot chuyen
# bay thu van in ra "Qua max-Q" giua mot nhat ky tieng Anh. Nen soat them theo
# CAU TRUC: moi logLine(...) / setPhase(...) deu phai nhan NG(...) hoac mot
# bien, khong duoc nhan thang mot chuoi.
# setPhase() nhan KHOA (no tu goi NG), logLine() nhan chu da dich. Nen luat
# khac nhau: setPhase duoc phep nhan mot chuoi NEU chuoi do la mot khoa co
# that; logLine thi khong duoc nhan chuoi nao.
KHOA = set(re.findall(r"^    '([^']+)':", bang_en, re.M)) if (bang_en := re.search(
    r"\n  en: \{(.*?)\n  \},", goc, re.S).group(1) if re.search(r"\n  en: \{(.*?)\n  \},", goc, re.S) else '') else set()
tho = []
for m in re.finditer(r'\b(logLine|setPhase)\(\s*', js):
    c = js[m.end()]
    if c not in '\'"`': continue
    j = m.end(); q = c; k = j + 1
    while k < len(js):
        if js[k] == '\\': k += 2; continue
        if js[k] == q: break
        k += 1
    lit = js[j:k + 1]
    noi_dung = lit[1:-1]
    # "T-10" la dong ho dem nguoc, giong nhau trong moi thu tieng.
    if re.match(r"^T(\\u2212|−|-)", noi_dung): continue
    if m.group(1) == 'setPhase' and noi_dung in KHOA: continue
    tho.append(m.group(1) + '(' + lit)

if '--liet-ke' in sys.argv:
    for x in sorted(set(tho)):
        print('  THO:', x[:120])
    for x in sorted(set(con)):
        print('  ', x[:150])
print('con %d chuoi chua dich (%d thuong, %d template), %d duy nhat'
      % (len(con), len(thuong), len(tpl), len(set(con))))
print('logLine/setPhase nhan thang mot chuoi: %d cho' % len(tho))
sys.exit(1 if (con or tho) else 0)
