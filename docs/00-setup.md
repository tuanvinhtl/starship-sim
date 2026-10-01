# M0 — Setup

Chạy `./tools/doctor.sh` sau mỗi bước để kiểm tra.

## 1. Dọn đĩa (bắt buộc — hiện chỉ còn 32 GB, cần ≥120 GB)

Chỗ đang chiếm nhiều nhất:

```bash
du -sh ~/Library ~/Downloads ~/Documents ~/Library/Caches
```

Gợi ý an toàn: `~/Library/Caches` (17 GB, xoá được, app tự tạo lại),
`~/Library/Developer/Xcode/DerivedData`, `~/Downloads` (29 GB), simulator runtime cũ,
Docker images (`docker system prune -a`), node_modules của project cũ.

## 2. Xcode

App Store → Xcode → cài (~20 GB). Sau đó:

```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -license accept
```

Cần cho: biên dịch C++ và đóng gói bản Mac. Có thể hoãn nếu M1 chỉ làm Blueprint.

## 3. Unreal Engine

Tải Epic Games Launcher → tab Unreal Engine → Library → cài **UE 5.6+**.
Bỏ chọn các platform không cần (iOS/Android/tvOS) để tiết kiệm ~10 GB.

## 4. Tạo project

Trong Epic Launcher → Launch UE → **Games → Blank → C++**, bật *Starter Content = off*.
- Tên: `StarbaseSim`
- Thư mục: `/Users/tuanvinh/engine-object/ue/`

Kết quả: `ue/StarbaseSim/StarbaseSim.uproject` — khớp đúng đường dẫn trong `.mcp.json`.

## 5. Bật plugin để MCP nói chuyện được với editor

Trong editor: **Edit → Plugins**, bật:

| Plugin | Vì sao |
|---|---|
| **Python Editor Script Plugin** | kênh chính, MCP điều khiển editor qua đây |
| **Editor Scripting Utilities** | mở API spawn/transform actor cho Python |
| **Remote Control API** | kênh phụ, HTTP REST cổng 30010 |

Restart editor. Rồi **Edit → Project Settings → Plugins → Python**:
- ✅ **Enable Remote Execution**
- **Multicast Bind Address** → `0.0.0.0`  *(UE 5.3+ mặc định `127.0.0.1` sẽ không bắt được)*

Restart lần nữa. Kiểm tra:

```bash
lsof -nP -i:6776 -i:30010
```

## 6. Kích hoạt MCP trong Claude Code

`.mcp.json` đã có sẵn ở gốc repo. Mở lại session Claude Code trong thư mục này và
approve server `unreal` khi được hỏi. Kiểm tra thủ công:

```bash
node tools/unreal-mcp/dist/bin.js --project-path ue/StarbaseSim/StarbaseSim.uproject --platform Mac
```

Server phải in `Server started` + danh sách 16 module.

## 7. Smoke test

Với editor đang mở, bảo Claude chạy tuần tự:
1. `get_connection_status` → phải thấy Python Remote Execution connected
2. `execute_python` với `print(unreal.SystemLibrary.get_engine_version())`
3. `spawn_actor` một cube → `take_screenshot` → nhìn thấy cube

Thông cả 3 là M0 xong. Bước tiếp: chạy `world/build_starbase.py` qua `execute_python`
để dựng site (53 actor: bệ phóng, tháp 145.8 m, 20 hold-down clamp, 8 bồn GSE).
