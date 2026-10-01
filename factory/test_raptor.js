#!/usr/bin/env node
/* Bo kiem tra nha may Raptor.  Chay: node factory/test_raptor.js
   1. Neo hieu chuan — mo hinh phai tra ve dung so lieu ma flight.js dang dung.
   2. Bang thong so ba the he.
   3. Quet thiet ke: tang Pc thi cai gi cham tran truoc.
   4. Chay that mot ca san xuat + nghiem thu 60 dong co, thong ke ti le dat.   */
'use strict';
const R = require('./raptor.js');
const P = (...a) => console.log(...a);
const f = (v, n) => Number(v).toFixed(n === undefined ? 1 : n);
let fails = 0;
function check(name, got, want, tol) {
  const ok = Math.abs(got - want) <= tol;
  if (!ok) fails++;
  P((ok ? '  ok  ' : '  FAIL') + '  ' + name.padEnd(30) + f(got, 3).padStart(12)
    + '   (mong đợi ' + want + ' ±' + tol + ')');
}

P('\n=== 1. NEO HIỆU CHUẨN — Raptor 2 mặt đất ===');
P('    flight.js dùng: Fvac 2.30 MN · Isp 347 s · Ae 1.33 m² · tmin 0.40');
const sl = R.datasheet(R.makeDesign('R2', 'sl'));
check('Lực đẩy chân không (MN)', sl.Fvac / 1e6, 2.30, 0.01);
check('Isp chân không (s)', sl.ispVac, 347, 0.5);
check('Diện tích ra Ae (m²)', sl.Ae, 1.33, 0.01);
check('Ga tối thiểu', sl.tmin, 0.40, 0.001);
check('Lưu lượng (kg/s)', sl.mdot, 676, 2);
check('Isp mặt đất (s)', sl.ispSl, 327, 1);

P('\n=== 2. BẢNG THÔNG SỐ ===');
P('  khối   biến thể  F_vac   F_sl   Isp_v  Isp_sl  Ae     ṁ     T_thành  T_tuabin_O  bơm   khối lượng');
for (const b of ['R1', 'R2', 'R3']) {
  for (const v of ['sl', 'vac']) {
    const d = R.makeDesign(b, v), s = R.datasheet(d);
    P('  ' + b.padEnd(6) + R.VARIANTS[v].name.padEnd(10)
      + (f(s.Fvac / 1e6, 2) + ' MN').padStart(8)
      + (s.slSeparated ? '   tách' : (f(s.Fsl / 1e6, 2) + ' MN').padStart(8))
      + f(s.ispVac).padStart(7) + (s.slSeparated ? '      —' : f(s.ispSl).padStart(7))
      + f(s.Ae, 2).padStart(7) + f(s.mdot, 0).padStart(6)
      + (f(s.twall, 0) + '/' + R.LIMITS.twall + 'K').padStart(11)
      + (f(s.titO, 0) + '/' + R.LIMITS.titO + 'K').padStart(12)
      + (f(s.pumpMW, 0) + 'MW').padStart(7) + (f(s.mass, 0) + 'kg').padStart(9));
  }
}

P('\n=== 3. QUÉT ÁP SUẤT BUỒNG (Raptor 2, mặt đất) — cái gì chạm trần trước? ===');
P('   Pc    F_vac    Isp   T_thành  T_tuabin_O  vòng bơm_O   chặn bởi');
for (let pc = 250; pc <= 400; pc += 25) {
  const d = R.makeDesign('R2', 'sl', { pc });
  const o = R.operate(d, { throttle: 1, pAmb: 0 });
  const lim = [];
  if (o.twall > R.LIMITS.twall) lim.push('thành buồng');
  if (o.titO > R.LIMITS.titO) lim.push('tuabin LOX');
  if (o.titF > R.LIMITS.titF) lim.push('tuabin CH4');
  if (o.rpmO > R.LIMITS.rpmO) lim.push('bơm LOX');
  if (o.rpmF > R.LIMITS.rpmF) lim.push('bơm CH4');
  P(('' + pc).padStart(5) + (f(o.F / 1e6, 2) + ' MN').padStart(9) + f(o.isp).padStart(7)
    + (f(o.twall, 0) + ' K').padStart(9) + (f(o.titO, 0) + ' K').padStart(11)
    + f(o.rpmO, 0).padStart(11) + '   ' + (lim.length ? '⚠ ' + lim.join(', ') : 'còn biên'));
}

P('\n=== 4. QUÉT GA — chug bắt đầu ở đâu (Raptor 2) ===');
P('   ga    Pc    độ cứng vòi phun   c*     Isp_sl   trạng thái');
for (const th of [1, .8, .6, .5, .45, .4, .35, .3, .25]) {
  const d = R.makeDesign('R2', 'sl');
  const o = R.operate(d, { throttle: th, pAmb: R.P0 });
  P(f(th * 100, 0).padStart(5) + '%' + f(o.pcBar, 0).padStart(6)
    + f(o.stiff, 3).padStart(12) + f(o.cstar, 0).padStart(11) + f(o.isp).padStart(9)
    + '   ' + (o.chug > 0.55 ? '✖ cháy giật nặng' : o.chug > 0 ? '⚠ chớm chug' : 'ổn định'));
}

P('\n=== 5. MỘT CA SẢN XUẤT THẬT — 60 động cơ qua bài nghiệm thu ===');
const line = R.makeLine(20260909);
const design = R.makeDesign('R2', 'sl');
const stat = {}, found = {}, hidden = {};
let certified = 0, testSec = 0, units = [];
for (let i = 0; i < 60; i++) {
  const u = R.buildUnit(design, line);
  line.built++;
  let T = R.startTest(u, 'accept');
  while (T.state === 'run') T = R.stepTest(T, 0.05);
  testSec += T.fireSec;
  const key = T.pass ? 'ĐẠT' : T.outcome;
  stat[key] = (stat[key] || 0) + 1;
  for (const k of T.found) found[k] = (found[k] || 0) + 1;
  for (const k of u.defects) if (T.found.indexOf(k) < 0) hidden[k] = (hidden[k] || 0) + 1;
  if (T.pass) { certified++; units.push(u); }
}
const rate = R.lineRate(line, 'R2');
P('  Nhịp dây chuyền   : ' + f(rate, 2) + ' động cơ/ngày (trạm chậm nhất)');
P('  Tỉ lệ đạt         : ' + certified + '/60 = ' + f(certified / 60 * 100) + '%');
P('  Giây thử tích luỹ : ' + f(testSec, 0) + ' s');
P('  Kết quả           :');
for (const k in stat) P('      ' + k.padEnd(12) + stat[k]);
P('  Lỗi bị bệ thử lôi ra:');
for (const k in found) P('      ' + (R.DEFECTS[k] ? R.DEFECTS[k].name : k).padEnd(26) + found[k]);
P('  Lỗi vẫn nằm im (lọt lưới):');
const anyHidden = Object.keys(hidden).length;
if (!anyHidden) P('      không có');
for (const k in hidden) P('      ' + (R.DEFECTS[k] ? R.DEFECTS[k].name : k).padEnd(26) + hidden[k]);

P('\n=== 6. BẢNG THÔNG SỐ LÔ ===');
const spec = R.fleetSpec(design, R.makeDesign('R2', 'vac'), units);
P('  s1  : n=33  Fvac ' + f(spec.s1.Fvac / 1e6, 3) + ' MN  isp ' + f(spec.s1.isp)
  + '  Ae ' + f(spec.s1.Ae, 2) + '  tmin ' + spec.s1.tmin);
P('  s2v : n=3   Fvac ' + f(spec.s2vac.Fvac / 1e6, 3) + ' MN  isp ' + f(spec.s2vac.isp)
  + '  Ae ' + f(spec.s2vac.Ae, 2));
P('  đã cấp chứng nhận: ' + spec.certified + ' động cơ\n');

if (fails) { P('❌ ' + fails + ' mốc hiệu chuẩn sai.\n'); process.exit(1); }
P('✅ Mọi mốc hiệu chuẩn khớp.\n');
