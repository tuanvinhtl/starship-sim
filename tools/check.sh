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
node --check /tmp/_hs_check.js && echo "cu phap OK"
python3 "$D/tools/sync-modules.py"
