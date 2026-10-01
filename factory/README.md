# Nhà máy Raptor

Nhà máy nằm **dưới lòng đất Starbase**: dây chuyền dựng động cơ, bệ thử static
fire trong buồng bê tông, rồi động cơ nào đạt nghiệm thu mới được xuất xưởng.

| File | Việc |
|---|---|
| [`raptor.js`](raptor.js) | Mô hình động cơ FFSC + dây chuyền + bệ thử. Không phụ thuộc DOM, chạy được cả trên node. |
| [`factory.html`](factory.html) | Nhà máy chơi được. Mở bằng trình duyệt, cần `raptor.js` nằm cạnh. |
| [`test_raptor.js`](test_raptor.js) | Bộ kiểm tra: mốc hiệu chuẩn, bảng thông số, quét thiết kế, một ca sản xuất thật. |

```bash
node factory/test_raptor.js
```

## Mốc hiệu chuẩn

Raptor 2 bản mặt đất ở thông số gốc phải cho ra **đúng** số liệu mà
`sim/python/ascent.py` và `game/flight.js` đang dùng:

```
F_vac 2.30 MN · Isp_vac 347 s · Isp_sl 327 s · Ae 1.33 m² · ṁ 676 kg/s · TWR cất cánh 1.40
```

Không phải trùng hợp — hằng số `CSTAR_PEAK` và đường kính họng `DT_REF` được
giải ngược từ đúng bộ số đó. `test_raptor.js` kiểm lại mỗi lần chạy, nên sửa mô
hình mà lệch khỏi game là biết ngay.

Một hệ quả đáng chú ý: `tmin = 0.40` trong `flight.js` trước đây là con số cho
sẵn. Giờ nó **đo được** — bài thử "ga sâu" quét ga xuống và tìm điểm vòi phun
mềm tới mức cháy giật, và điểm đó rơi đúng vào 40%.

## Mô hình động cơ

Chuỗi tính, mỗi khâu ăn vào khâu sau:

```
ga → Pc → c*(MR,Pc) → lưu lượng → Cf(ε,Pc,Pa) → lực đẩy, Isp
                    ↘ bơm (công suất) → tuabin (nhiệt độ vào)
                    ↘ áo làm mát → nhiệt độ thành buồng
                    ↘ độ cứng vòi phun → ổn định cháy
```

- **Loa phụt**: giải 1-D đẳng nhiệt từ tỉ số giãn nở, γ = 1.15. Có kiểm tra
  **tách dòng** theo tiêu chuẩn Summerfield (Pe < 0.35·Pa) — chính vì vậy động cơ
  chân không (ε = 110) không nghiệm thu được ở mặt đất, còn động cơ mặt đất
  (ε = 32.65) thì đi qua vùng tách trong lúc lên ga rồi thoát.
- **c\***: đỉnh quanh MR 3.55, giảm hai bên; Pc cao thì nhỉnh lên chút.
- **Bơm & tuabin**: công suất bơm giải từ áp xả cần thiết, rồi **giải ngược**
  ra nhiệt độ vào tuabin. Đây là chỗ chặn thật: đẩy Pc từ 300 lên 350 bar thì
  tuabin LOX chạm 801 K, quá giới hạn 780 K của vật liệu.
- **Làm mát**: Bartz rút gọn, q ∝ Pc^0.85; khả năng tải nhiệt ∝ ṁ_CH4^0.8 và tụt
  đi khi Pc cao (methane trong rãnh tiến gần trần nhiệt).
- **Ổn định**: ΔP vòi phun ∝ ṁ², nên ΔP/Pc **tỉ lệ thẳng với ga**. Xuống dưới
  0.080 là chớm cháy giật — đó là toàn bộ lý do có ga tối thiểu.

## Bệ thử — đúng trình tự ngoài đời

```
xả khí trơ → làm lạnh (45 s) → tăng áp thùng → nước dập âm → quay mồi tuabin
→ đánh lửa đuốc → lên ga → chạy bài → cắt máy → xả khí & nội soi
```

Mỗi tick đều đo và so với **redline**: nhiệt thành buồng, nhiệt hai tuabin, vòng
quay hai bơm, rung RMS, áp suất buồng. Chạm redline thì cắt — cắt kịp thì động
cơ còn sửa được, chậm thì hỏng phần cứng, rất chậm thì nổ và hư luôn bệ.

Năm bài thử: **Nghiệm thu** (30 s, bài chuẩn xuất xưởng), **Toàn thời gian**
(160 s đúng chu trình một chuyến booster), **Ga sâu** (dò ngưỡng cháy giật),
**Quá tải** (112%, tìm biên), **Tái kiểm** (động cơ đã bay).

Riêng lúc lên ga và cắt máy thì ngưỡng cháy giật **không** được tính — áp suất
buồng đi qua vùng mềm là chuyện bắt buộc, không phải lỗi động cơ.

## Lỗi tiềm ẩn — lý do phải thử

Dây chuyền gieo lỗi vào từng cá thể mà **giấy tờ không thấy được**: rỗ khí mối
hàn, rạn chân cánh tuabin, lệch lỗ vòi phun, rãnh làm mát hẹp, hở đế van oxy,
đuốc đánh lửa yếu, cảm biến trôi chuẩn. Chỉ bệ thử mới lôi ra, và không phải
lúc nào cũng lôi ra được — chạy 60 động cơ thì vẫn có vài cái lọt lưới mang
lỗi đi bay.

Cảm biến trôi chuẩn là loại khó chịu nhất: nó làm **cắt nhầm một động cơ tốt**.

## Vòng lặp cải tiến

Sáu núm chỉnh: áp suất buồng, tỉ lệ trộn, tỉ số giãn nở, đường kính họng, độ
cứng vòi phun, tỉ số áp tuabin. Sáu hạng mục nghiên cứu mở khoá bằng **giây thử
nghiệm tích luỹ** — muốn tin động cơ thì phải đốt nó thật nhiều, đúng như ngoài
đời.

Kết quả quét Pc (Raptor 2, xem đầy đủ bằng `test_raptor.js`):

| Pc | F_vac | Isp | T thành | T tuabin LOX | Chặn bởi |
|---|---|---|---|---|---|
| 300 | 2.30 MN | 347.0 | 692 K | 686 K | còn biên |
| 325 | 2.49 MN | 347.6 | 706 K | 744 K | còn biên |
| 350 | 2.68 MN | 348.1 | 719 K | **801 K** | tuabin LOX |
| 400 | 3.07 MN | 349.0 | 746 K | **915 K** | tuabin LOX, cả hai bơm |

Tỉ lệ đạt nghiệm thu theo đó: Pc 300 → 98%, Pc 340 → 50%, Pc 360 → 0%.

## Bảng thông số lô

Nút **Xuất thông số lô** tóm tắt lô đang sản xuất — thông số danh định của cả
hai biến thể, số máy đã nghiệm thu, hao mòn trung bình — chép ra clipboard và
in ra console:

```json
{ "block": "R2",
  "s1":    { "n": 33, "Fvac": 2299497, "isp": 347.0, "Ae": 1.330, "tmin": 0.40, "mass": 1607 },
  "s2vac": { "n": 3,  "Fvac": 2435196, "isp": 367.5, "Ae": 4.480, "tmin": 0.40, "mass": 2827 },
  "certified": 6, "wear": 0.011 }
```

Nhà máy **không** tự đẩy số này sang game — đây chỉ là bảng thông số, muốn dùng
thì tự cầm sang.

## Ghi chú: TWR

Bảng thông số hiện luôn **TWR cất cánh** của chồng 5.220 t với 33 máy đó:
Raptor 1 → 1.14, Raptor 2 → 1.40, Raptor 3 → 1.65. Con số 1.40 của Raptor 2
khớp đúng `PLAN.md`. Động cơ mạnh hơn không tự động là tên lửa tốt hơn: bộ lái
lên quỹ đạo được chỉnh theo TWR nào thì phải chỉnh lại theo đó.
