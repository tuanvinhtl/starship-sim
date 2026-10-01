# StarbaseSim

Game giả lập phóng tên lửa Starship / Super Heavy.

> **Trạng thái:** đã chuyển hướng khỏi Unreal. Bản chơi được là game 3D chạy trong
> trình duyệt: [`game/hotstage.html`](game/hotstage.html) — không cần cài gì.
> [PLAN.md](PLAN.md) và [docs/00-setup.md](docs/00-setup.md) vẫn giữ nguyên kế hoạch
> Unreal đầy đủ, dùng lại được nếu sau này quay lại hướng đó.

## Chơi

Mở [`game/hotstage.html`](game/hotstage.html) bằng trình duyệt bất kỳ.
Toàn bộ vật lý nằm trong [`game/flight.js`](game/flight.js) — port trực tiếp từ
`sim/python/ascent.py`, đã đối chiếu khớp từng con số. Gồm cả pha booster quay về:
boostback, entry burn, divert, suicide burn, và bắt bằng cánh tay tháp.

## Hai nhiệm vụ

**Starlink** — thả vệ tinh rồi đưa tàu về. Chọn 0/20/40/60 con.

**Trạm ISS** — đưa người và hàng lên trạm, ghép nối, rồi về. Đuổi pha thật (trúng
cửa sổ ~2 vòng, trượt thì tới 18 vòng), chuyển quỹ đạo Hohmann lên 418 km, tiếp cận
R-bar nhắm bằng ma trận chuyển trạng thái Clohessy–Wiltshire, và bắt mềm theo đúng
dung sai IDSS: khép 0,05–0,10 m/s, lệch ngang 10 cm, lệch góc 4°. Máy tự cập nhưng
bấm phím là giành lái được. Phi hành đoàn có trần quá tải và dưỡng khí tính bằng
người-giờ, nên chọn đi đông là đánh cược vào cửa sổ phóng.

Phím **X** lúc đang leo là hủy bỏ: tàu tách ra, xả nhiên liệu (không xả thì T/W chỉ
0,43 — không tự nhấc nổi mình) rồi tự hạ cánh. Hủy trong khoảng hai phút đầu là mất
cả đoàn; đó là con số rơi ra từ mô hình, không phải luật chơi đặt ra.

## Chạy được ngay (không cần Unreal)

```bash
python3 sim/python/ascent.py
```

Prototype 3-DOF đầy đủ: khí quyển US-1976, lực đẩy bù áp suất, gravity turn, giới hạn max-Q
và gia tốc dọc trục, hot-staging, cắt động cơ ở vận tốc quỹ đạo. Xuất CSV + đồ thị ASCII.

## Nhà máy Raptor

Nhà máy dưới lòng đất Starbase: dây chuyền 5 trạm dựng động cơ, bệ thử static
fire chạy đúng trình tự ngoài đời (làm lạnh → quay mồi → đánh lửa đuốc → lên ga
→ bài thử → cắt máy), redline tự cắt, và sáu núm để cải tiến thiết kế.

Mở [`factory/factory.html`](factory/factory.html) — `raptor.js` phải nằm cạnh.

```bash
node factory/test_raptor.js
```

Mô hình động cơ được hiệu chuẩn ngược từ chính số liệu của `flight.js`: Raptor 2
mặt đất ở thông số gốc cho ra đúng 2.30 MN / 347 s / Ae 1.33 m². Ngưỡng cháy giật
đo trên bệ rơi đúng 40% — bằng `tmin` mà game đang dùng. Chi tiết:
[`factory/README.md`](factory/README.md).

## Chấm điểm không cần trình duyệt

Sửa `hotstage.html` xong thì chạy `./tools/check.sh` — nó kiểm cú pháp rồi trích lại
ba mô-đun. Lưu ý: nó chỉ bắt lỗi cú pháp, **không** bắt được lỗi tham chiếu hay sai
phạm vi biến.

```bash
node tools/boosteval.js sweep <nhãn>   # 28 chuyến booster vào tháp
node tools/shipeval.js  run   <nhãn>   # tàu tái nhập, nhiều thời tiết và seed
node tools/isseval.js   sweep          # trọn chuyến ISS: đuổi pha, chuyển quỹ đạo, cập
./tools/doctor.sh                      # kiểm môi trường
```

## Cấu trúc

- `sim/` — mô hình bay tham chiếu (Python), số liệu vehicle
- `world/` — bố cục site dạng data + script dựng qua MCP
- `tools/unreal-mcp/` — MCP server (đã build, 127 tool)
- `game/` — **game chơi được**: `hotstage.html` (3D + HUD) là nguồn gốc duy nhất;
  ba mô-đun vật lý được trích thẳng từ nó và chạy được bằng node — `flight.js`
  (bay 3-DOF + booster về), `ship3d.js` (6-DOF cho tàu tái nhập, có roll và bốn
  cánh gió độc lập), `dock.js` (hẹn gặp và ghép nối quỹ đạo)
- `factory/` — **nhà máy chơi được**: `raptor.js` (mô hình động cơ + dây chuyền + bệ thử)
  + `factory.html` (mặt cắt tầng hầm + bảng điều khiển) + `test_raptor.js` (bộ kiểm tra)
- `ue/StarbaseSim/` — project Unreal (chưa tạo, thuộc kế hoạch cũ)

## Giấy phép

[MIT](LICENSE) — dùng, sửa, phát hành lại thoải mái, chỉ cần giữ lại thông báo
bản quyền. Phần mềm cung cấp nguyên trạng, không bảo hành.
