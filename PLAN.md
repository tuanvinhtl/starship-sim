# StarbaseSim — kế hoạch build

Game giả lập phóng tên lửa Starship / Super Heavy trên Unreal Engine 5, macOS.
Điều khiển thế giới bằng **Unreal MCP** (127 tool) để dựng site Starbase bằng script thay vì kéo thả tay.

---

## Quyết định đã chốt

| | |
|---|---|
| **Độ chân thực** | **Sim bán chân thực** — vật lý và số liệu đúng, nhưng có hỗ trợ lái tự động. Chuẩn tham chiếu: KSP về gameplay, webcast SpaceX về hình ảnh và telemetry. |
| **Nền tảng** | **macOS only.** Không phải lo cross-platform, không cần máy Windows. |

Hệ quả:
- Autopilot là **tính năng first-class**, không phải cheat. Người chơi bật/tắt từng trục
  (pitch program, TVC hold, landing guidance) — giống Flight Assist của Elite Dangerous.
  Cùng bộ điều khiển đó dùng cho AI demo bay, nên không tốn thêm công.
- Bỏ PEG guidance khép kín ở M2 — gravity turn open-loop là đủ. Để dành nếu về sau muốn.
- Không mô phỏng hỏng động cơ / giới hạn kết cấu ở bản đầu. Kiến trúc vẫn chừa chỗ:
  `EngineCluster` đã nhận `n_live`, nên thêm engine-out sau chỉ là gameplay layer.
- M8 chỉ đóng gói bản Mac (arm64) → tiết kiệm ~4 ngày so với ước tính ban đầu.
- Metal render path duy nhất → tune shader một lần, không phải test HLSL/DX12.

---

## 0. Trạng thái hiện tại

| Hạng mục | Trạng thái |
|---|---|
| MCP server (`tools/unreal-mcp`) | ✅ đã clone + build, 127 tool phản hồi |
| `.mcp.json` (project-scoped) | ✅ đã ghi, trỏ sang `ue/StarbaseSim` |
| Prototype flight model (Python) | ✅ chạy được, profile khớp Starship thật |
| Unreal Engine | ❌ **chưa cài** |
| Xcode đầy đủ | ❌ **chưa có** (mới chỉ CommandLineTools) |
| Dung lượng đĩa | ❌ **còn 32 GB — cần ≥120 GB** |

`./tools/doctor.sh` kiểm tra lại bất cứ lúc nào.

---

## 1. Ba blocker phải xử lý trước (việc của mày, tao không làm hộ được)

1. **Dọn đĩa.** UE ~50 GB + Xcode ~20 GB + project/DerivedDataCache ~40 GB. Hiện `~/Library` chiếm 188 GB
   (Caches 17 GB), Downloads 29 GB, Documents 35 GB. Cần giải phóng ~90 GB.
2. **Cài Xcode** (App Store), rồi `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`.
   Bắt buộc cho C++ và đóng gói bản Mac. Có thể hoãn nếu giai đoạn đầu chỉ dùng Blueprint.
3. **Cài Unreal Engine 5.6+** qua Epic Games Launcher.

**Ghi chú nền tảng:** đã chốt Mac-only nên không vướng chuyện cross-compile (Unreal không xuất được
bản Windows từ macOS). M3 16 GB đủ cho phong cách stylized — không đủ cho photoreal Nanite + Lumen full,
và phong cách stylized cũng hợp với hướng bán chân thực hơn.

---

## 2. Kiến trúc — 4 quyết định then chốt

### 2.1 Không dùng Chaos physics cho tên lửa
Chaos không thiết kế cho vật thể 5,000 tấn, lực đẩy 71 MN, khối lượng biến thiên liên tục.
→ Viết **integrator 6-DOF riêng bằng C++**, RK4, sub-step 120–240 Hz, tự set transform của Pawn.
Trạng thái: `position(double3)`, `velocity`, `quaternion`, `angular_velocity`, khối lượng từng thùng.

### 2.2 Vấn đề tỷ lệ & độ chính xác
1 đơn vị UE = 1 cm. Đường Kármán 100 km = 10,000,000 uu. UE5 có **Large World Coordinates**
(transform double) nên toạ độ không tràn — nhưng render vẫn jitter khi xa gốc.
→ **Thế giới hai tầng:**
- `PadRegion` (0–5 km): chi tiết đầy đủ, vật lý theo đơn vị UE.
- `FlightRegion` (>5 km): toán ECEF double trong một `UFlightSubsystem`, Trái Đất render bằng proxy thu nhỏ.
- Kèm **floating origin**: rebase gốc thế giới khi tên lửa vượt 20 km khỏi origin.

### 2.3 Prototype toán ở Python trước, port sang C++ sau
Đã làm: `sim/python/ascent.py`. Debug integrator sai bên trong UE editor cực kỳ khổ.
Mọi thay đổi mô hình bay → sửa Python, verify số, rồi mới port.

### 2.4 Thế giới dựng bằng data + MCP, không kéo thả
`world/starbase_layout.json` mô tả site → `world/build_starbase.py` chạy qua MCP `execute_python`
sinh ra toàn bộ actor. Dựng lại từ đầu bất cứ lúc nào, diff được bằng git.

---

## 3. Mô hình bay — chi tiết kỹ thuật

| Thành phần | Cách làm |
|---|---|
| Khí quyển | US Standard Atmosphere 1976, 7 tầng, 0–86 km → ρ, P, T, tốc độ âm |
| Hấp dẫn | Nghịch bình phương `μ/r²`; J2 tuỳ chọn về sau |
| Lực đẩy | `F = F_vac − A_e·P_amb` mỗi động cơ; trễ spool-up bậc 1 ~0.2 s |
| Mass flow | `ṁ = F_vac/(Isp·g₀)`; CoM dịch khi thùng cạn; tensor quán tính tính lại mỗi tick |
| Khí động | `q = ½ρv²`, Cd tra bảng theo Mach; lift theo AoA cho giai đoạn belly-flop |
| TVC | PID xếp tầng: sai số góc → tốc độ góc mong muốn → góc gimbal. Có rate-limit + giới hạn gimbal |
| Dẫn đường lên | Gravity turn open-loop: thẳng đứng → pitch kick 3° ở ~60 m/s → bám prograde (đã chốt, bỏ PEG) |
| Giới hạn | Throttle-down qua max-Q (~30 kPa); tắt bớt động cơ để giữ ≤3.5 g |

**Kết quả prototype hiện tại** (`python3 sim/python/ascent.py`):

```
TWR cất cánh 1.40 · Max-Q 29.8 kPa @ T+55s · MECO/hot-stage T+148s @ 77.5 km, 2028 m/s
SECO T+486s @ 294.7 km, 7801 m/s · dư 141 t (9%) ≈ 2,894 m/s delta-v
```
So với Starship thật: max-Q ~30–35 kPa @ T+55–70s, hot-stage ~T+165s @ ~70 km. Sai số chấp nhận được.

---

## 4. Hạ cánh & bắt bằng tháp — phần khó nhất

**Super Heavy:** boostback burn → entry burn → landing burn.
Điểm đánh lửa hạ cánh giải từ `h = v²/(2(T/m − g))` (suicide burn), rồi PD controller bám vị trí ngang.
Grid fin làm mặt điều khiển khí động ở tầng cao.

**Bắt bằng chopstick (Mechazilla):** định nghĩa capture volume + dung sai —
lệch ngang < 1 m, vận tốc đứng < 2 m/s, nghiêng < 2°. Đạt thì pin lên load pin, không đạt thì RUD.

**Ship reentry:** belly-flop AoA ~70°, 4 flap làm cơ cấu điều khiển
(vi sai = roll, đối xứng = pitch) → flip: gập flap, đánh lửa 3 Raptor SL, xoay 90° trong ~4 s, triệt tiêu vận tốc.

Lộ trình: PD + suicide burn trước → nâng lên bám quỹ đạo tham chiếu tính sẵn. G-FOLD là thừa cho game.

---

## 5. Dùng MCP để làm gì (đây là chỗ MCP ăn tiền)

| Tool MCP | Việc |
|---|---|
| `execute_python` | Chạy script dựng cả site Starbase, deterministic, chạy lại được |
| `spawn_actor` / `set_actor_transform` | Đặt 20 hold-down clamp đúng bán kính, 7 bồn GSE, các tầng tháp |
| `create_blueprint` / `add_component_to_blueprint` | Sinh khung BP cho vehicle, tháp, HUD |
| `create_material` | Vật liệu thép không gỉ, bê tông, kim loại cháy xém |
| `set_viewport_camera` + `take_screenshot` | Tao tự kiểm tra hình ảnh mà không cần mày nhìn hộ |
| `build_project` / `compile_blueprint` | Build C++ và bắt lỗi biên dịch trực tiếp |
| `run_tests` | Automation test cho flight model |
| `create_niagara_system` | Khung VFX luồng phụt |

---

## 6. Mốc thời gian (solo, full-time)

| Mốc | Nội dung | Ước tính |
|---|---|---|
| **M0** | Dọn đĩa, cài UE + Xcode, tạo project, thông MCP, smoke test | 1 ngày |
| **M1** | Vertical slice "nó bay": bệ phẳng, tên lửa hình trụ, đẩy lên, gimbal, HUD | 1 tuần |
| **M2** | Port flight model sang C++, TVC PID, gravity turn, max-Q, khung autopilot | 2 tuần |
| **M3** | Vehicle 2 tầng, hot-staging, grid fin, flap | 1.5 tuần |
| **M4** | Hạ cánh booster + bắt bằng tháp, ship flip & land | 3 tuần ⚠️ khó nhất |
| **M5** | Dựng site Starbase qua MCP: OLM, tháp, tank farm, địa hình | 1.5 tuần |
| **M6** | VFX Niagara (luồng phụt, Mach diamond, deluge, plasma) + âm thanh | 2 tuần |
| **M7** | Lớp game: nhiệm vụ, telemetry HUD kiểu webcast, replay đa camera, chấm điểm | 2 tuần |
| **M8** | Tối ưu, settings, đóng gói bản Mac arm64 | 1 tuần |

**Tổng ≈ 3.5 tháng full-time.** Làm buổi tối/cuối tuần thì nhân 3.

---

## 7. Nhiệm vụ trong game

1. **Hop test** — bay lên 10 km rồi hạ cánh tại chỗ
2. **Full stack to orbit** — phóng đủ hai tầng lên quỹ đạo
3. **Booster catch** — boostback + bắt bằng chopstick
4. **Ship reentry** — belly-flop, flip, hạ cánh
5. **Sandbox** — bay tự do, chỉnh tham số vehicle

Chấm điểm: độ chính xác điểm hạ, nhiên liệu còn lại, sống sót max-Q, tải trọng kết cấu.

---

## 8. Cấu trúc repo

```
engine-object/
├── PLAN.md                     ← file này
├── .mcp.json                   ← config MCP server (project-scoped)
├── docs/00-setup.md            ← các bước cài đặt
├── sim/
│   ├── reference/vehicle_starship.json   ← số liệu vehicle
│   └── python/ascent.py                  ← prototype 3-DOF ✅ chạy được
├── world/
│   ├── starbase_layout.json    ← mô tả site dạng data
│   └── build_starbase.py       ← dựng site qua MCP execute_python
├── tools/
│   ├── unreal-mcp/             ← MCP server ✅ đã build
│   └── doctor.sh               ← kiểm tra môi trường
└── ue/StarbaseSim/             ← UE project (tạo ở M0)
    └── Source/StarbaseSim/
        ├── Flight/             ← FlightIntegrator, Atmosphere, Propulsion,
        │                          Aerodynamics, GuidanceComputer, VehicleConfig
        ├── Gameplay/
        └── UI/
```

---

## 9. Rủi ro

| Rủi ro | Giảm thiểu |
|---|---|
| Đĩa 32 GB — **blocker cứng** | Dọn ~90 GB trước khi làm gì khác |
| RAM 16 GB, UE editor ngốn RAM | Scene budget chặt, landscape 4K, tắt Lumen HW-RT, đóng app khác |
| Autopilot làm mất cảm giác thử thách | Cho bật/tắt từng trục; chấm điểm cộng thêm khi lái tay |
| Bắt bằng tháp khó tune | Dựng test harness headless, chạy 1000 lần hạ cánh qua `run_tests` |
| Niagara 33 luồng phụt nặng trên M3 | LOD theo khoảng cách, gộp thành ít emitter, fake bằng mesh + panner ở xa |
