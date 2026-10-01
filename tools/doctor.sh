#!/usr/bin/env bash
# Kiểm tra môi trường build StarbaseSim. Chạy: ./tools/doctor.sh
ok(){ printf "  \033[32m✓\033[0m %s\n" "$1"; }
no(){ printf "  \033[31m✗\033[0m %s\n" "$1"; }
wa(){ printf "  \033[33m!\033[0m %s\n" "$1"; }

echo "── Hardware ──"
echo "  CPU : $(sysctl -n machdep.cpu.brand_string)"
RAM=$(( $(sysctl -n hw.memsize) / 1073741824 )); echo "  RAM : ${RAM} GB"
[ "$RAM" -ge 32 ] && ok "RAM đủ thoải mái" || wa "RAM ${RAM}GB — đóng app khác khi mở UE editor"

FREE=$(df -g / | awk 'NR==2{print $4}')
echo "── Disk ──"
if [ "$FREE" -ge 120 ]; then ok "Trống ${FREE} GB"
elif [ "$FREE" -ge 80 ]; then wa "Trống ${FREE} GB — đủ chật, nên dọn thêm"
else no "Trống ${FREE} GB — CẦN ≥120 GB (UE ~50 + Xcode ~20 + project/DDC ~40)"; fi

echo "── Xcode ──"
if xcodebuild -version >/dev/null 2>&1; then ok "$(xcodebuild -version | head -1)"
else no "Chưa có Xcode đầy đủ (đang là CommandLineTools). Cần cho C++ và packaging Mac."
     echo "      → cài Xcode từ App Store, rồi: sudo xcode-select -s /Applications/Xcode.app/Contents/Developer"; fi

echo "── Unreal Engine ──"
UE=$(ls -d "/Users/Shared/Epic Games"/UE_* 2>/dev/null | tail -1)
if [ -n "$UE" ]; then ok "$UE"
  ED="$UE/Engine/Binaries/Mac/UnrealEditor.app"
  [ -d "$ED" ] && ok "UnrealEditor.app có" || no "Thiếu UnrealEditor.app"
else no "Chưa cài Unreal Engine (cần Epic Games Launcher → Library → UE 5.6+)"; fi

echo "── Node / MCP server ──"
command -v node >/dev/null && ok "node $(node --version)" || no "chưa có node"
BIN="$(cd "$(dirname "$0")/.." && pwd)/tools/unreal-mcp/dist/bin.js"
[ -f "$BIN" ] && ok "unreal-mcp đã build" || no "chưa build: (cd tools/unreal-mcp && npm install && npm run build)"

echo "── Cổng giao tiếp với UE editor ──"
if lsof -nP -i:6776 -i:30010 -i:55557 2>/dev/null | grep -q .; then
  lsof -nP -i:6776 -i:30010 -i:55557 2>/dev/null | awk 'NR>1{print "  \033[32m✓\033[0m "$1" giữ "$9}' | sort -u
else
  wa "chưa cổng nào mở — bình thường khi UE editor chưa chạy"
fi

echo "── Project ──"
UP=$(ls "$(cd "$(dirname "$0")/.." && pwd)"/ue/*/*.uproject 2>/dev/null | head -1)
[ -n "$UP" ] && ok "$UP" || wa "chưa tạo UE project trong ue/ (xem docs/00-setup.md)"
echo
