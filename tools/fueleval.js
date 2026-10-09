#!/usr/bin/env node
/* Cham CA CHIEN DICH TIEP NHIEN LIEU bang node — khong can trinh duyet.

   node tools/fueleval.js                 -> quet 8 gio phong, ben 300 km
   node tools/fueleval.js --ben 400       -> doi do cao ben (km)
   node tools/fueleval.js --n 12          -> so goc pha dau
   node tools/fueleval.js --boil 1150     -> doi thong luong hap thu (W/m2)
   node tools/fueleval.js --mli 1         -> bo MLI

   Chay dung trinh tu lop game se goi, tren hai lo that (flight.js + dock.js
   trich tu hotstage.html). Khac isseval.js o ba cho: muc tieu la MOT CON TAU
   (212 t) chu khong phai tram 419 t nen co tron dong luong luc bat mem; tam cap
   la 104,2 m chu khong 63,1 m; va co dong ho BAY HOI chay suot ca chien dich. */
'use strict';
const path = require('path');
const G = path.join(__dirname, '..', 'game');
const F = require(path.join(G, 'flight.js'));
const D = require(path.join(G, 'dock.js'));
const DT = 0.02;
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? +process.argv[i + 1] : d; };
const H_BEN = arg('--ben', 300) * 1000;
const N = arg('--n', 8);
if (process.argv.includes('--boil') || process.argv.includes('--mli'))
  F.setBoil(arg('--boil', F.BOIL.q), arg('--mli', F.BOIL.mli));

/* Phong len quy dao roi tron — y nhu isseval. `tanker` chon ban phuong tien. */
function lenQuyDao(tanker) {
  F.setWeather('calm'); F.setPayload(0);
  const st = F.makeState({ tanker });
  let t = 0;
  while (st.alive && st.stage === 1 && t < 400) { F.step(st, DT, { throttle: 1 }); t += DT; }
  while (st.alive && st.prop2 > 0 && t < 900) { F.step(st, DT, { throttle: 1 }); t += DT; }
  const c = F.circularize(st);
  return c.ok ? st : null;
}
/* Du tru ha quy dao: tinh o khoi luong LUC DOT THAT (kho + header), khong o
   khoi luong day — tinh o khoi luong day thi bo lai thua 1 t moi chuyen. */
function duTruVe(st) {
  const r = Math.hypot(st.x, st.y);
  const dv = Math.sqrt(F.MU / r) - Math.sqrt(F.MU * (2 / r - 2 / (r + F.RE + 60e3)));
  const m1 = F.dry2(st) + (st.head || 0);
  return m1 * (Math.exp(dv / (F.VEH.s2.vac.isp * F.G0)) - 1);
}
/* Dua mot tau tu quy dao SECO len ben bang Hohmann. */
function lenBen(st) {
  const r1 = Math.hypot(st.x, st.y), r2 = F.RE + H_BEN;
  const h = D.hohmann(F, r1, r2);
  const b1 = D.burn(F, st, h.dv1);
  if (!b1.ok) return null;
  // bay nua vong chuyen tiep
  let tt = 0; while (tt < h.t) { const s = Math.min(1, h.t - tt); F.orbitStep(st, s); tt += s; }
  const b2 = D.burn(F, st, h.dv2);
  return b2.ok ? { dv: h.dv1 + h.dv2, t: h.t } : null;
}

/* `phaDau` = PHAN chu ky quy dao ma ben da di duoc khi tau cho bat dau len.
   Day moi la bien that cua nguoi choi: ho chon GIO PHONG. `lead0` cua D.make
   khong dung duoc o day vi no chi dat vi tri cua TRAM GIA, con cap tau-voi-tau
   thi muc tieu la mot con tau that da co quy dao rieng. */
function chienDich(phaDau, trace) {
  // --- lan phong 1: BEN CHUA (ban chuan) ---
  const ben = lenQuyDao(false);
  if (!ben) return { ok: false, vi: 'ben khong tron duoc quy dao' };
  if (!lenBen(ben)) return { ok: false, vi: 'ben khong len duoc do cao' };
  ben.m = F.m2(ben);
  { /* nguoi choi cho bao lau truoc khi phong chuyen dau — ben van bay hoi */
    const T = 2 * Math.PI * Math.sqrt(Math.pow(F.RE + H_BEN, 3) / F.MU);
    let tt = 0; const tCho = phaDau * T;
    while (tt < tCho) { const dt = Math.min(1, tCho - tt); F.orbitStep(ben, dt); F.boilStep(ben, dt); tt += dt; }
  }
  const tli0 = F.tliNeed(ben);
  const log = m => { if (trace) console.log('   ' + m); };
  log(`ben len ${(H_BEN / 1000)} km voi ${(ben.prop2 / 1000).toFixed(2)} t`);
  log(`TLI can ${(tli0.need / 1000).toFixed(1)} t (dv ${tli0.dv.toFixed(0)}) -> thieu ${((tli0.need - ben.prop2) / 1000).toFixed(1)} t`);

  let tTong = 0, nChuyen = 0, rcsMin = Infinity, truotTong = 0, lechMax = 0, vRelMax = 0;
  const giaoMoi = [];
  while (nChuyen < 8) {
    nChuyen++;
    // --- lan phong tiep: TAU CHO ---
    const tk = lenQuyDao(true);
    if (!tk) return { ok: false, vi: 'tau cho khong tron duoc quy dao', chuyen: nChuyen };
    tk.m = F.m2(tk);
    /* Duoi pha: dat muc tieu dan truoc mot goc roi doi cua so, y nhu ISS. */
    const d = D.make(F, tk, { tgt: ben, tgtShip: true, alt: H_BEN });
    d.phase = 'PHASING';
    const rTgt = F.RE + H_BEN - 2000;
    const w0 = D.windowIn(F, tk, d.stn, rTgt);
    /* CHOT PHAI LON HON MOT CHU KY HOI QUY. Giua quy dao SECO 186 km va ben
       300 km, hieu toc do goc la 2,98e-5 rad/s nen chu ky hoi quy 2,11e5 s =
       58,6 gio. Chot 2e5 vong x 1 s = 55,6 gio la THIEU — va khi thieu thi
       khong phai no bao loi, no bay Hohmann luc cua so CHUA MO roi doi 4 700 km
       bang RCS cho den can bon. Da dinh dung mot lan. Lay 4e5 cho du bien. */
    let guard = 0, wCuoi = null;
    while (guard++ < 4e5) {
      const w = D.windowIn(F, tk, d.stn, rTgt);
      wCuoi = w;
      if (w.wait <= 1.0) break;
      const dt = Math.min(1, Math.max(0.02, w.wait));
      D.step(d, dt); F.boilStep(ben, dt);
    }
    /* Khong mo duoc cua so thi DUNG, dung bay. Lop game cung phai chan y vay:
       cho dot chuyen tiep luc cua so chua mo la nem ca chuyen hang di. */
    if (!wCuoi || wCuoi.wait > 1.0)
      return { ok: false, vi: `cua so khong mo (con ${(wCuoi ? wCuoi.wait / 3600 : -1).toFixed(1)} h)`, chuyen: nChuyen };
    // --- chuyen quy dao len duoi ben 2 km ---
    const h = D.hohmann(F, Math.hypot(tk.x, tk.y), rTgt);
    if (!D.burn(F, tk, h.dv1).ok) return { ok: false, vi: 'thieu nhien lieu doi quy dao', chuyen: nChuyen };
    d.phase = 'TRANSFER';
    const tArr = tk.t + h.t;
    while (tk.t < tArr) { const dt = Math.min(1, tArr - tk.t); D.step(d, dt); F.boilStep(ben, dt); }
    if (!D.burn(F, tk, h.dv2).ok) return { ok: false, vi: 'thieu nhien lieu tron quy dao tren', chuyen: nChuyen };
    // --- tiep can + bat mem ---
    d.phase = 'APPROACH';
    let n = 0;
    while (n < 3e7 && d.phase !== 'DOCKED' && d.tries < 6) { D.step(d, DT); F.boilStep(ben, DT); n++; }
    if (d.phase !== 'DOCKED') return { ok: false, vi: 'khong cap duoc: ' + d.why, chuyen: nChuyen };
    const tl = D.tel(d);
    rcsMin = Math.min(rcsMin, tk.rcs); truotTong += d.tries;
    /* KHONG doc `tl.closing` o day: luc nay da sang pha DOCKED, hai than da
       duoc tron dong luong nen van toc tuong doi bang 0 — con so se luon la
       0,0000 va khong noi gi. Dai luong co nghia la `d.vKhep`: do lon van toc
       tuong doi DUNG LUC CHAM, ghi lai trong chinh phep tron. Con viec cu cham
       co dat sau nguong IDSS hay khong thi `d.tries` da tra loi: capCheck chay
       truoc khi tron, truot thi lui 40 m lam lai. */
    lechMax = Math.max(lechMax, Math.abs(tl.lat));
    vRelMax = Math.max(vRelMax, d.vKhep || 0);
    // --- TRUYEN: giu lai du tru ha quy dao, con lai sang ben ---
    const giu = duTruVe(tk);
    const coTheGiao = Math.max(0, tk.prop2 - giu);
    const kho = { prop2: coTheGiao, head: tk.head, tanker: true, m: 0 };
    const ss = F.settleNeed(F.RE + H_BEN, D.SHIP.port, tk.m + ben.m);
    let daGiao = 0, tTruyen = 0;
    for (;;) {
      const r = F.transferStep(kho, ben, DT, true);
      if (!(r.moved > 0)) break;
      daGiao += r.moved; tTruyen += DT;
      F.boilStep(ben, DT);
    }
    tk.prop2 = giu + kho.prop2; tk.m = F.m2(tk);
    giaoMoi.push(daGiao / 1000);
    tTong += tk.t;
    const tli = F.tliNeed(ben);
    log(`chuyen ${nChuyen}: doi ${(w0.wait / 3600).toFixed(1)} h, giao ${(daGiao / 1000).toFixed(2)} t trong `
      + `${(tTruyen / 60).toFixed(1)} ph, lang ${ss.F.toFixed(0)} N, khep ${(d.vKhep || 0).toFixed(4)} m/s, `
      + `truot ${d.tries}, RCS con ${tk.rcs.toFixed(0)} kg -> ben ${(ben.prop2 / 1000).toFixed(1)} t, `
      + `TLI ${tli.du >= 0 ? 'DU +' + (tli.du / 1000).toFixed(1) : 'thieu ' + (-tli.du / 1000).toFixed(1)} t`);
    if (tli.du >= 0) break;
  }
  const tli = F.tliNeed(ben);
  return {
    ok: tli.du >= 0, chuyen: nChuyen, phong: nChuyen + 1,
    ngay: +(tTong / 86400).toFixed(2),
    benT: +(ben.prop2 / 1000).toFixed(1), tliCan: +(tli.need / 1000).toFixed(1),
    duT: +(tli.du / 1000).toFixed(1), bayHoiT: +((ben.boiled || 0) / 1000).toFixed(1),
    giaoTb: +(giaoMoi.reduce((a, b) => a + b, 0) / giaoMoi.length).toFixed(2),
    rcsMin: +rcsMin.toFixed(0), truot: truotTong,
    lechMax: +lechMax.toFixed(3), vRelMax: +vRelMax.toFixed(4),
  };
}

if (process.argv.includes('--one')) {
  console.log(JSON.stringify(chienDich(arg('--one', 0), true), null, 1));
} else {
  console.log(`ben ${H_BEN / 1000} km | bay hoi ${F.boilDay().toFixed(3)} t/ngay `
    + `(${F.BOIL.q} W/m2, MLI ${F.BOIL.mli}x) | tam cap ${(2 * D.SHIP.port).toFixed(1)} m`);
  console.log('pha dau | dat | chuyen | phong | ngay | ben t | TLI can | du t | bay hoi t | giao tb | RCS min | truot | lech max | v cham');
  let ok = 0;
  for (let i = 0; i < N; i++) {
    const g = i / N;                       // phan chu ky ben da di khi phong
    const r = chienDich(g, false);
    if (r.ok) ok++;
    console.log(g.toFixed(3).padStart(7) + ' | ' + (r.ok ? ' OK ' : 'HONG') + ' | '
      + String(r.chuyen ?? '-').padStart(6) + ' | ' + String(r.phong ?? '-').padStart(5) + ' | '
      + String(r.ngay ?? '-').padStart(4) + ' | ' + String(r.benT ?? '-').padStart(5) + ' | '
      + String(r.tliCan ?? '-').padStart(7) + ' | ' + String(r.duT ?? '-').padStart(4) + ' | '
      + String(r.bayHoiT ?? '-').padStart(9) + ' | ' + String(r.giaoTb ?? '-').padStart(7) + ' | '
      + String(r.rcsMin ?? '-').padStart(7) + ' | ' + String(r.truot ?? '-').padStart(5) + ' | '
      + String(r.lechMax ?? '-').padStart(8) + ' | ' + String(r.vRelMax ?? '-').padStart(7)
      + (r.vi ? '  <- ' + r.vi : ''));
  }
  console.log(`\nDAT TLI ${ok}/${N}`);
}
