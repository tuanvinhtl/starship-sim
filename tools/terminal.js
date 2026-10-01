#!/usr/bin/env node
/* Do CHANG CUOI cua tau. Dung:
     node tools/terminal.js N wx1,wx2 [mode] [seed] ['{"SGC":{...},"TWS":{...}}']
   QUIET=1 -> chi in mot dong tong hop (dung khi quet). */
const F = require(__dirname + '/../game/flight.js');
const S3 = require(__dirname + '/../game/ship3d.js');
const dt = 0.02, N = parseInt(process.argv[2] || '6', 10);
const WX = (process.argv[3] || 'calm,rain,gusty').split(',');
if (process.argv[4]) S3.TWS.MODE = process.argv[4];
let _seed = parseInt(process.argv[5] || '12345', 10);
Math.random = () => { _seed = (_seed * 1664525 + 1013904223) >>> 0; return _seed / 4294967296; };
const OV = process.argv[6] ? JSON.parse(process.argv[6]) : {};
if (OV.SGC) Object.assign(S3.SGC, OV.SGC);
if (OV.TWS) Object.assign(S3.TWS, OV.TWS);
if (OV.APR) Object.assign(S3.APR, OV.APR);
const QUIET = process.env.QUIET === '1';

/* Chang phong chi phu thuoc thoi tiet -> tinh mot lan roi dung lai. */
const secoCache = {};
function seco(wx) {
  if (!secoCache[wx]) {
    F.setWeather(wx);
    const st = F.makeState();
    for (let i = 0; i < 400000 && st.alive; i++) F.step(st, dt);
    secoCache[wx] = JSON.stringify(st);
  }
  return JSON.parse(secoCache[wx]);
}
const rows = [];
for (let k = 0; k < N; k++) {
  const wx = WX[k % WX.length];
  const sDr = Math.round((60 + Math.random() * 240) * (Math.random() < .5 ? -1 : 1) * 1000);
  const sCr = Math.round((Math.random() * 36 - 18) * 1000);
  const entryErr = Math.random() * 40 - 20;
  const st = seco(wx); F.setWeather(wx);
  F.setShipTargetDr(sDr);
  const a = sDr / F.RE, c = sCr / F.RE;
  S3.setTarget(S3.vnorm(S3.V(Math.sin(a) * Math.cos(c), Math.cos(a) * Math.cos(c), Math.sin(c))));
  const sh = S3.fromPlan(F.planShipReturn(st), F, sCr / 1000 + entryErr);
  let tLand = null, t200 = null, p200 = null, pLand = null, slow = 0, maxErr = 0, e500 = null, down = null, prevH = null;
  /* Do do "em" cua cu lat: thoi gian, toc do quay dinh, be rong cung (quang
     ngang di trong luc lat), do cao mat, toc do ngang luc bat dau lat. */
  let tFlip = null, flipDur = NaN, wPk = 0, fLat0 = 0, fCr0 = 0, arc = NaN, vh0 = NaN, hLoss = NaN, prevLat = null, prevCr = null;
  for (let i = 0; i < 400000 && sh.alive; i++) {
    const r = S3.step(sh, dt, F);   // step tu goi dan huong 1 lan/buoc nhu game — dung goi them S3.auto
    const t = S3.telemetry(sh, F), h = t.alt - F.CATCH_ALT;
    if (sh.phase === 'FLIP') {
      if (tFlip === null) { tFlip = sh.t; fLat0 = t.lateral; fCr0 = t.cross;
        if (prevLat !== null) vh0 = Math.hypot(t.lateral - prevLat, t.cross - prevCr) / dt; }
      wPk = Math.max(wPk, Math.hypot(sh.w.x, sh.w.z));
    }
    if (sh.phase === 'LAND' && tLand === null) { tLand = sh.t; pLand = sh.prop;
      if (tFlip !== null) { flipDur = sh.t - tFlip; arc = Math.hypot(t.lateral - fLat0, t.cross - fCr0); hLoss = (sh.flipAlt || 0) - t.alt; } }
    prevLat = t.lateral; prevCr = t.cross;
    if (prevH !== null && prevH > 500 && h <= 500 && e500 === null) e500 = Math.hypot(t.lateral, t.cross);
    prevH = h;
    if (tLand !== null && h < 200) {
      if (t200 === null) { t200 = sh.t; p200 = sh.prop; }
      if (Math.abs(t.vspeed) < 1.0) slow += dt;
      maxErr = Math.max(maxErr, Math.hypot(t.lateral, t.cross));
    }
    if (r && (r.type === 'SHIP_DOWN' || r.type === 'BURN_THROUGH')) { down = r; break; }
  }
  rows.push({ wx, kq: down ? (down.outcome || down.type) : 'mat dau', miss: down && down.miss !== undefined ? down.miss : NaN,
    vs: down && down.vs !== undefined ? Math.abs(down.vs) : NaN,
    tLand: tLand !== null ? sh.t - tLand : NaN, t200: t200 !== null ? sh.t - t200 : NaN, slow,
    pLand: pLand !== null ? (pLand - sh.prop) / 1000 : NaN, con: sh.prop / 1000, maxErr,
    e500: e500 === null ? NaN : e500, flipAlt: sh.flipAlt || NaN, twY: down && down.twY !== undefined ? down.twY : NaN,
    flipDur, wPk: wPk * 180 / Math.PI, arc, vh0, hLoss });
}
const avg = k => rows.reduce((s, r) => s + r[k], 0) / rows.length;
const mn = k => Math.min(...rows.map(r => r[k]));
const good = rows.filter(r => r.kq === 'bullseye' || r.kq === 'ontarget').length;
const label = `${S3.APR.MODE} lat+${S3.SGC.FLIP_MARGIN} q${S3.SGC.FLIP_RATE} kep${S3.TWS.MAX}`;
const summary = `${label.padEnd(36)} tot ${good}/${rows.length} | lat@${avg('flipAlt').toFixed(0)}m | lech@500m ${avg('e500').toFixed(0)}m | LAND ${avg('tLand').toFixed(0)}s | cham ${avg('slow').toFixed(0)}s | nl ${avg('pLand').toFixed(1)}t | con tb ${avg('con').toFixed(1)}t min ${mn('con').toFixed(1)}t | lech ${avg('miss').toFixed(2)}m | vs ${avg('vs').toFixed(1)} | kep ${avg('twY').toFixed(0)}m | LAT ${avg('flipDur').toFixed(1)}s dinh ${avg('wPk').toFixed(0)}d/s cung ${avg('arc').toFixed(0)}m mat ${avg('hLoss').toFixed(0)}m vngang ${avg('vh0').toFixed(0)}m/s`;
if (!QUIET) {
  for (const r of rows) console.log(r.wx.padEnd(6), r.kq.padEnd(9), 'lech', r.miss.toFixed(2), 'lat@', r.flipAlt.toFixed(0), 'e500', r.e500.toFixed(0), 'LAND', r.tLand.toFixed(0), 'cham', r.slow.toFixed(0), 'nl', r.pLand.toFixed(1), 'con', r.con.toFixed(1), 'kep', r.twY.toFixed(0), '| lat', r.flipDur.toFixed(1) + 's', r.wPk.toFixed(0) + 'd/s', 'cung', r.arc.toFixed(0), 'mat', r.hLoss.toFixed(0), 'vngang', r.vh0.toFixed(0));
}
console.log(summary);
