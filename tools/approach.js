#!/usr/bin/env node
/* Do HINH HOC TIEP CAN cua tau so voi thap: tau toi tu huong nao, mui chi dau
   luc lat, lech bao nhieu o tung do cao, treo bao lau.
     node tools/approach.js N wx1,wx2 [seed] ['{"SGC":{...},"TWS":{...}}']
   brg      : phuong vi cua tau nhin tu thap. 0 = tren truc +cross (mieng tay
              khi yaw 0), ±90 = doc truc tam xa, tuc BEN HONG hai canh tay.
   noseTwr  : mui tau (chieu ngang) lech bao nhieu do so voi huong ve thap.
   side     : goc giua duong toi va truc mieng tay (0 = thang vao mieng). */
const F = require(__dirname + '/../game/flight.js');
const S3 = require(__dirname + '/../game/ship3d.js');
const dt = 0.02, N = parseInt(process.argv[2] || '6', 10);
const WX = (process.argv[3] || 'calm,rain,gusty').split(',');
let _seed = parseInt(process.argv[4] || '777', 10);
Math.random = () => { _seed = (_seed * 1664525 + 1013904223) >>> 0; return _seed / 4294967296; };
const OV = process.argv[5] ? JSON.parse(process.argv[5]) : {};
if (OV.SGC) Object.assign(S3.SGC, OV.SGC);
if (OV.TWS) Object.assign(S3.TWS, OV.TWS);
if (OV.APR) Object.assign(S3.APR, OV.APR);
const D = 180 / Math.PI;
const TRACE = (process.env.TRACE || '').split(',').filter(Boolean).map(Number);   // so chuyen can in dien bien
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
function snap(sh, tag) {
  const f = S3.frame(sh, F);
  const TQi = S3.qconj(S3.qBetween(S3.getTarget(), S3.V(0, 1, 0)));
  const cA = S3.qrot(TQi, S3.V(0, 0, 1));
  const east = S3.vnorm(S3.vcross(f.rhat, cA));
  const vD = S3.vdot(sh.v, east), vC = S3.vdot(sh.v, cA);
  const nose = S3.qrot(sh.q, S3.V(0, 1, 0));
  const nD = S3.vdot(nose, east), nC = S3.vdot(nose, cA);
  let dh = (Math.atan2(nD, nC) - Math.atan2(-f.down, -f.cross)) * D;
  while (dh > 180) dh -= 360; while (dh < -180) dh += 360;
  const brg = Math.atan2(f.down, f.cross) * D;
  const side = Math.min(Math.abs(brg), 180 - Math.abs(brg));
  return { tag, t: Math.round(sh.t), h: Math.round(f.alt - F.CATCH_ALT - (sh.tw ? sh.tw.y : 0)),
    down: Math.round(f.down), cross: Math.round(f.cross), dist: Math.round(Math.hypot(f.down, f.cross)),
    brg: Math.round(brg), side: Math.round(side), vH: +Math.hypot(vD, vC).toFixed(1),
    vDir: Math.round(Math.atan2(vD, vC) * D), noseH: +Math.hypot(nD, nC).toFixed(2), noseTwr: Math.round(dh),
    pi: Math.round(sh.pi || 0), yaw: Math.round((sh.yawErr || 0) * D), prop: +(sh.prop / 1000).toFixed(1),
    psiB: Math.round((sh.tw.psiB || 0) * D), psiC: Math.round((sh.tw.psiC || 0) * D),
    offArm: Math.round(((a) => { while (a > 180) a -= 360; while (a < -180) a += 360; return a; })(brg - ((sh.tw.psiB || 0) + (sh.tw.psiC || 0)) * D)) };
}
const all = [];
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
  const M = []; let prevPh = sh.phase, prevH = null, hov = 0, low = 0, down = null, yawOkT = null, landT = null, hovAll = 0;
  for (let i = 0; i < 400000 && sh.alive; i++) {
    const r = S3.step(sh, dt, F);   // step tu goi dan huong 1 lan/buoc nhu game — dung goi them S3.auto
    const tl = S3.telemetry(sh, F), h = tl.alt - F.CATCH_ALT - (sh.tw ? sh.tw.y : 0);
    if (sh.phase !== prevPh) { M.push(snap(sh, sh.phase)); if (sh.phase === 'LAND') landT = sh.t; prevPh = sh.phase; }
    if (prevH !== null) for (const x of [10000, 5000, 2000, 500, 200]) if (prevH > x && h <= x) M.push(snap(sh, 'h' + x));
    prevH = h;
    if (landT !== null && yawOkT === null && (sh.yawErr || 0) < 10 / D) yawOkT = sh.t - landT;
    if (landT !== null && h < 200) { low += dt; if (Math.abs(tl.vspeed) < 1) hov += dt; }
    if (landT !== null && Math.abs(tl.vspeed) < 1) hovAll += dt;
    if (TRACE.includes(k + 1) && landT !== null && (i % 50) === 0) {
      const g = sh.arcDbg || {};
      console.log(`   T t${(sh.t - landT).toFixed(0).padStart(4)} h${h.toFixed(0).padStart(5)} d${(g.d || 0).toFixed(1).padStart(7)} vr${(g.vr || 0).toFixed(1).padStart(6)}`
        + ` vu${tl.vspeed.toFixed(1).padStart(6)} vW${(g.vW || 0).toFixed(1).padStart(6)} ${String(sh.arc || '-').padEnd(4)} nghieng${((g.tilt || 0) * D).toFixed(1).padStart(5)}`
        + ` aD${(g.aD || 0).toFixed(2).padStart(6)} aC${(g.aC || 0).toFixed(2).padStart(6)} ga${(sh.throttle * 100).toFixed(0).padStart(4)}% x${sh.nEng} nl${(sh.prop / 1000).toFixed(1).padStart(5)} kep${sh.tw.y.toFixed(0).padStart(3)}`);
    }
    if (r && (r.type === 'SHIP_DOWN' || r.type === 'BURN_THROUGH')) { down = r; break; }
  }
  M.push(snap(sh, 'END'));
  const row = { wx, kq: down ? (down.outcome || down.type) : 'mat dau', miss: down && down.miss !== undefined ? +down.miss.toFixed(2) : null,
    low: +low.toFixed(0), hov: +hov.toFixed(0), yawOkT: yawOkT === null ? null : +yawOkT.toFixed(1), M,
    landDur: landT === null ? null : +(sh.t - landT).toFixed(0), hovAll: +hovAll.toFixed(0) };
  all.push(row);
  console.log(`\n#${k + 1} ${wx} ${row.kq} lech ${row.miss} | LAND ${row.landDur}s, treo moi do cao ${row.hovAll}s | duoi 200 m ${row.low}s, treo ${row.hov}s | chot thang tay sau ${row.yawOkT}s tu LAND`);
  console.log('  moc     t    h      down  cross  dist  brg side  vH  vDir noseTwr     pi yaw  prop psiB psiC offArm');
  for (const m of M) console.log('  ' + [m.tag.padEnd(5), String(m.t).padStart(5), String(m.h).padStart(6), String(m.down).padStart(7), String(m.cross).padStart(6),
    String(m.dist).padStart(5), String(m.brg).padStart(4), String(m.side).padStart(4), String(m.vH).padStart(5), String(m.vDir).padStart(5),
    String(m.noseTwr).padStart(6), String(m.pi).padStart(7), String(m.yaw).padStart(3), String(m.prop).padStart(5), String(m.psiB).padStart(4), String(m.psiC).padStart(4), String(m.offArm).padStart(6)].join(' '));
}
const pick = (tag, key) => all.map(r => (r.M.find(m => m.tag === tag) || {})[key]).filter(v => v !== undefined);
const av = a => a.length ? (a.reduce((s, v) => s + Math.abs(v), 0) / a.length).toFixed(0) : '-';
console.log(`\nTONG ${N} chuyen: |lech mieng tay| luc lat ${av(pick('FLIP', 'offArm'))} do, 500 m ${av(pick('h500', 'offArm'))} do, 200 m ${av(pick('h200', 'offArm'))} do`
  + ` | cach thap luc lat ${av(pick('FLIP', 'dist'))} m, 500 m ${av(pick('h500', 'dist'))} m, 200 m ${av(pick('h200', 'dist'))} m`
  + ` | LAND ${av(all.map(r => r.landDur))} s, treo moi do cao ${av(all.map(r => r.hovAll))} s`
  + ` | yaw chot luc LAND ${av(pick('LAND', 'yaw'))} do | duoi 200 m ${av(all.map(r => r.low))} s, treo ${av(all.map(r => r.hov))} s | con ${av(pick('END', 'prop'))} t`
  + ` | tot ${all.filter(r => r.kq === 'bullseye').length}/${N}`);
