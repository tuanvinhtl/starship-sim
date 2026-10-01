#!/usr/bin/env python3
"""Soat uniform cua cac shader tu viet trong hotstage.html.

LY DO CO FILE NAY: check.sh chi chay `node --check`, tuc chi bat loi CU PHAP
JavaScript. Shader thi la CHUOI doi voi node — mot uniform khai bao ben JS ma
quen khai bao trong GLSL van qua check.sh tron tru, roi chet luc chay:

    ERROR: 0:49: 'phoi' : undeclared identifier
    WebGL: INVALID_OPERATION: useProgram: program not valid   (x256)

Khi do chuong trinh vo hieu va man hinh khong dung duoc gi. Da dinh dung mot
lan. Bo soat nay doi chieu khoa cua doi tuong uniform ben JS voi cac dong
`uniform ... ;` trong GLSL tuong ung.
"""
import re, sys, pathlib

HTML = pathlib.Path(__file__).resolve().parent.parent / 'game' / 'hotstage.html'


def khoi_ngoac(txt, i):
    """Noi dung { ... } can bang, bat dau tu dau '{' o vi tri i."""
    d = 0
    for j in range(i, len(txt)):
        if txt[j] == '{':
            d += 1
        elif txt[j] == '}':
            d -= 1
            if d == 0:
                return txt[i + 1:j]
    return ''


def main():
    s = HTML.read_text(encoding='utf-8')
    loi = []
    n = 0
    for m in re.finditer(r'mat\(\s*(?:LOC\s*\+\s*)?`(.*?)`\s*,\s*(\w+)\s*\)', s, re.S):
        glsl, ten = m.group(1), m.group(2)
        d = re.search(r'const\s+' + ten + r'\s*=\s*\{', s)
        if not d:
            loi.append('%s: khong tim thay doi tuong uniform' % ten)
            continue
        n += 1
        keys = set(re.findall(r'(\w+)\s*:\s*\{\s*value', khoi_ngoac(s, d.end() - 1)))
        khai = set()
        for decl in re.findall(r'uniform\s+\w+\s+([^;]+);', glsl):
            khai |= {x.strip() for x in decl.split(',')}
        thieu = keys - khai
        if thieu:
            loi.append('%s: uniform ben JS nhung KHONG khai bao trong GLSL -> %s'
                       % (ten, ', '.join(sorted(thieu))))

    if loi:
        print('shader: %d loi' % len(loi))
        for x in loi:
            print('  ✗ ' + x)
        return 1
    print('shader: %d khoi, uniform khop het' % n)
    return 0


if __name__ == '__main__':
    sys.exit(main())
