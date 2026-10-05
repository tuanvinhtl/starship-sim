# StarbaseSim

Game giả lập phóng tên lửa Starship / Super Heavy.

> **Chơi ngay:** <https://tuanvinhtl.github.io/starship-sim/> — không cần cài gì.

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

## Hậu kỳ

Bloom và AO tự viết, không nạp thêm module — bản UMD r150 không có sẵn
`EffectComposer`. Cảnh dựng vào bộ đệm nửa chấm động rồi qua chuỗi pass:
lọc sáng có đầu gối mềm, năm mức thu/phóng kiểu Call of Duty, và SSAO nửa phân
giải lấy độ sâu thẳng từ `logarithmicDepthBuffer` (`w = 2^(2d/fc) − 1`) nên
không cần pass pháp tuyến riêng.

AO tự tắt dần khi bán kính lấy mẫu 1,2 m chiếu xuống dưới vài điểm ảnh. Phải có
bước đó: ở xa thì cả 12 mẫu rơi vào cùng một texel nên `wm == w`, trong khi điểm
mẫu vẫn bị đẩy ra dọc pháp tuyến — `dz` ra dương và số hạng che bị kẹp lên 1,0.
Tức ở xa nó cho AO **tối đa** chứ không phải không có AO, và vì độ sâu log lượng
tử hoá thô ở tầm đó, nó thành từng vệt sọc trên địa hình nhìn từ vài km độ cao.
Đo sau khi sửa: ở bệ phóng AO vẫn đổi 8,8 % điểm ảnh, ở 7 km chỉ còn 0,17 %.

Cuối chuỗi là tone mapping ACES. Không có nó thì vùng sáng bị kẹp phẳng thành
trắng bệt — đó mới là nguyên nhân thật của cảm giác "chói mà chán", không phải
thiếu hiệu ứng.

Thép đọc ra thép nhờ hai thứ, không nhờ thêm thư viện nào: một bản đồ môi trường
sinh lúc chạy, và vân thép thủ tục — trường độ cao 512x512 có rãnh hàn cùng gờ nổi
ở mỗi ranh giới vòng thép 1,83 m, từ đó lấy ra roughnessMap và normalMap bằng Sobel.
Không tải về một byte ảnh nào.

Cả ba đường vẽ — một khung, hai khung (phím **5**), và lúc tắt quầng sáng — đều đi
qua pass ghép, nên phơi sáng và ACES giống nhau ở mọi chế độ. Hai đường sau chạy ở
nấc "chỉ tone": không AO, không loé. Phải làm vậy vì đèn nền đã hạ xuống 1/3 và
metalness nâng lên .88 *chính vì* tính là luôn có ACES; đường nào né pass ghép thì
cháy trắng hơn cả bản chưa có hậu kỳ. Loé vẫn không được đi qua chế độ hai khung —
đó là lý do ban đầu người ta né hậu kỳ ở đó — còn tone mapping thì theo từng điểm
ảnh nên không rò qua đường chia.

Hai khung vẽ vào một bộ đệm **không khử răng cưa** riêng, vì nó vẽ hai ô bằng
scissor tức che phủ từng phần: trên bộ đệm đa mẫu thì phép phân giải ra texture
không phủ hết, và ngoài hai ô hiện ra xác của những lần vẽ trước — một con tàu và
một booster lơ lửng giữa nền đen. Đo ba lần không confound: samples 2 thì có,
samples 0 thì không, kể cả sau khi đi vòng qua góc máy khác rồi quay lại. Đánh đổi:
hai khung mất khử răng cưa, đổi lấy đúng tông màu.

Núm **Khử răng cưa** trong bảng chỉnh cho chọn 0 / 2 / 4 mẫu — mặc định 2. Nâng lên
4 làm mượt lưới thép của tháp và cánh gió, thứ 2 mẫu chưa đủ sức. Để người chơi tự
chọn chứ không nâng mặc định, vì giá phụ thuộc máy: trên M3 đo không ra chênh lệch
kể cả ở 4096x3072 (9,4 so với 10,1 ms, cả hai đều còn ghim ở vsync), nhưng máy yếu
thì khác hẳn — và thang hạ cấu hình theo khung hình vẫn kéo về 0 khi cần.

Bấm **P** để bật tắt quầng sáng và bóng khe (tông giữ nguyên), **O** (hoặc **0**) để mở bảng chỉnh: chín núm cho độ
phơi sáng, cường độ loé, bóng khe, vân thép và ba nguồn sáng, kèm ô văn bản in ra
dòng giá trị để dán lại vào mã. Máy yếu thì bộ canh khung hình tự hạ ba nấc: bỏ khử
răng cưa → tắt hậu kỳ → hạ độ phân giải.

## Tách tầng nóng

Hot-staging có đủ trong lò vật lý: 3,2 giây hai tầng cùng cháy, booster hạ còn 3 máy
giữa, và 16% lượng đẩy của tàu đập vào đỉnh booster thành xung 1,84 m/s ngược chiều
bay — đó mới là lý do hai tầng rời nhau nhanh, trước khi chênh lệch lực đẩy kịp ăn.

Phần nhìn thấy khó hơn phần cơ chế. Lò bay là 3-DOF nên cả chồng chỉ có **một** điểm
trạng thái; khi còn dính, lớp vẽ phải đặt đáy tàu cao hơn đáy booster đúng 71 m. Ngay
sau MECO booster khởi hành từ chính điểm đó, nên nếu bỏ phần bù ấy đi thì đúng khoảnh
khắc tách, tàu tụt thẳng 71 m vào lòng booster — cú đẩy biến thành cú giật ngược. Nay
giữ nguyên phần bù tới khi khe thật vượt qua nó rồi mới nhoà dần: đo headless 60 giây
sau MECO, khe vẽ ra khởi hành đúng 71,0 m và tăng ở mọi khung hình.

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

Sửa `hotstage.html` xong thì chạy `./tools/check.sh` — nó kiểm cú pháp, trích lại ba
mô-đun, rồi soát shader. Bộ soát shader có vì một lý do cụ thể: shader là **chuỗi**
đối với `node`, nên một uniform khai báo bên JS mà quên khai báo trong GLSL vẫn qua
`node --check` trơn tru rồi chết lúc chạy, làm chương trình vô hiệu và trắng màn hình.
Nó đối chiếu khoá của đối tượng uniform với các dòng `uniform` trong GLSL tương ứng.

Vẫn còn lớp nó **không** bắt được: lỗi tham chiếu, sai phạm vi biến, và mọi thứ chỉ
hiện ra khi có GPU.

```bash
node tools/boosteval.js sweep <nhãn>   # 28 chuyến booster vào tháp
node tools/shipeval.js  run   <nhãn>   # tàu tái nhập, nhiều thời tiết và seed
node tools/isseval.js   sweep          # trọn chuyến ISS: đuổi pha, chuyển quỹ đạo, cập
```

## Cấu trúc

- `sim/` — mô hình bay tham chiếu (Python), số liệu vehicle
- `world/` — bố cục site Starbase dạng data (toạ độ bệ phóng, tháp, trại bồn)
- `game/` — **game chơi được**: `hotstage.html` (3D + HUD) là nguồn gốc duy nhất;
  ba mô-đun vật lý được trích thẳng từ nó và chạy được bằng node — `flight.js`
  (bay 3-DOF + booster về), `ship3d.js` (6-DOF cho tàu tái nhập, có roll và bốn
  cánh gió độc lập), `dock.js` (hẹn gặp và ghép nối quỹ đạo)
- `factory/` — **nhà máy chơi được**: `raptor.js` (mô hình động cơ + dây chuyền + bệ thử)
  + `factory.html` (mặt cắt tầng hầm + bảng điều khiển) + `test_raptor.js` (bộ kiểm tra)
- `tools/` — bộ chấm điểm chạy headless + script trích mô-đun

## Giấy phép

[MIT](LICENSE) — dùng, sửa, phát hành lại thoải mái, chỉ cần giữ lại thông báo
bản quyền. Phần mềm cung cấp nguyên trạng, không bảo hành.
