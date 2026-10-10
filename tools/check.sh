#!/bin/sh
# Kiem cu phap JS cua hotstage.html BANG NODE, khong can trinh duyet.
# Bat duoc loi cu phap ngay — nhanh hon nhieu so voi mo preview roi doc console.
set -e
D=$(cd "$(dirname "$0")/.." && pwd)
python3 - "$D/game/hotstage.html" <<'PY' > /tmp/_hs_check.js
import sys
s = open(sys.argv[1], encoding='utf-8').read()
a = s.index('<script>', s.index('three.min.js')) + 8
# CAT O LAN DAU TIEN, khong phai lan cuoi. Bo phan tich HTML ket thuc khoi
# script ngay o chuoi dong-the dau tien trong van ban, du no nam trong chu
# thich hay trong mot chuoi. Ban cu dung rindex() nen no NOI LAI hai nua va
# van phan tich tron tru — tuc bo kiem bao OK trong khi trinh duyet chet voi
# "Invalid or unexpected token". Da dinh that: mot chu thich lo viet chuoi do
# ra lam trang trang hoan toan ma check.sh khong he keu.
b = s.index('</' + 'script>', a)
sys.stdout.write(s[a:b])
PY
node --check /tmp/_hs_check.js && echo "cu phap OK (khoi script chinh)"
python3 "$D/tools/sync-modules.py"

# Kiem cu phap CA BA MO-DUN VAT LY nhu file DOC LAP. Khoi tren kiem ca the
# script, con day kiem dung thu sync-modules.py vua cat ra — bat duoc cai loai
# loi chi lo ra khi doan ma do dung mot minh (moc cat lech, khoi UMD khong
# dong). Da bi dinh mot lan: `(a < b ? x : y) = m` di qua check.sh tron tru
# roi chet luc require() trong node.
for m in flight ship3d dock; do
  node --check "$D/game/$m.js" || exit 1
done
echo "cu phap OK (flight / ship3d / dock)"

# Soat uniform cua shader tu viet. node --check khong the bat duoc lop loi nay:
# shader la CHUOI doi voi node, nen quen khai bao mot uniform van qua tron tru
# roi chet luc chay voi "undeclared identifier" va man hinh trang.
python3 "$(dirname "$0")/shadercheck.py" || exit 1
