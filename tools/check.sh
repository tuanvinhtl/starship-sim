#!/bin/sh
# Kiem cu phap JS cua hotstage.html BANG NODE, khong can trinh duyet.
# Bat duoc loi cu phap ngay — nhanh hon nhieu so voi mo preview roi doc console.
set -e
D=$(cd "$(dirname "$0")/.." && pwd)
python3 - "$D/game/hotstage.html" <<'PY' > /tmp/_hs_check.js
import sys
s = open(sys.argv[1], encoding='utf-8').read()
a = s.index('<script>', s.index('three.min.js')) + 8
b = s.rindex('</script>')
sys.stdout.write(s[a:b])
PY
node --check /tmp/_hs_check.js && echo "cu phap OK (khoi script chinh)"
python3 "$D/tools/sync-modules.py"

# Kiem cu phap CA BA MO-DUN VAT LY. Khoi `node --check` o tren CHI doc the
# <script> nam sau three.min.js, con Flight/Ship3D/Dock duoc dinh nghia o the
# TRUOC do — nen suot thoi gian qua chung khong he duoc kiem cu phap. Da bi
# dinh mot lan: `(a < b ? x : y) = m` di qua check.sh tron tru roi chet luc
# require() trong node. sync-modules.py vua ghi ra ba file .js, kiem luon.
for m in flight ship3d dock; do
  node --check "$D/game/$m.js" || exit 1
done
echo "cu phap OK (flight / ship3d / dock)"

# Soat uniform cua shader tu viet. node --check khong the bat duoc lop loi nay:
# shader la CHUOI doi voi node, nen quen khai bao mot uniform van qua tron tru
# roi chet luc chay voi "undeclared identifier" va man hinh trang.
python3 "$(dirname "$0")/shadercheck.py" || exit 1
