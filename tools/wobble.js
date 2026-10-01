#!/usr/bin/env node
/* Do DO LAC LU cua tau trong chang lat + ha, chia theo che do (FLIP/APP/PREC/FIN).
     node tools/wobble.js N wx1,wx2 [seed] ['{"APR":{...},"SGC":{...}}']
     TRACE=k : in dien bien moi 0.25 s trong 40 s cuoi cua chuyen k.
   Tach phan DAO DONG khoi phan nghieng co y: hp = x - EMA(x, 2 s).
     lac   : RMS cua hp tren do nghieng THAT (do)       -> than tau lac bao nhieu
     lenh  : RMS cua hp tren do nghieng LENH (do)       -> bo dan huong co ra lenh giat khong
     Hz    : tan so lac (so lan doi dau hp / 2 / thoi gian)
     w     : RMS / max toc do quay pitch-yaw (do/s)
     bam   : RMS sai lech nghieng that - lenh (do)
     rcs   : ti le thoi gian RCS dang lam viec (%) */
const F = require(__dirname + '/../game/flight.js');
const S3 = require(__dirname + '/../game/ship3d.js');
const dt = 0.02, N = parseInt(process.argv[2] || '6', 10);
const WX = (process.argv[3] || 'calm,rain,gusty').split(',');
let _seed = parseInt(process.argv[4] || '777', 10);
Math.random = () => { _seed = (_seed * 1664525 + 1013904223) >>> 0; return _seed / 4294967296; };
const OV = process.argv[5] ? JSON.parse(process.argv[5]) : {};
for (const k of ['SGC', 'TWS', 'APR']) if (OV[k]) Object.assign(S3[k], OV[k]);
const TRACE = parseInt(process.env.TRACE || '0', 10);
const D = 180 / Math.PI, V = S3.V;
const secoCache = {};
function seco(wx) {
  if (!secoCache[wx]) { F.setWeather(wx); const st = F.makeState(); for (let i = 0; i < 400000 && st.alive; i++) F.step(st, dt); secoCache[wx] = JSON.stringify(st); }
  return JSON.parse(secoCache[wx]);
}
const mk = () => ({ n: 0, mA: null, mS: null, cA: null, cS: null, hpA2: 0, hpC2: 0, zc: 0, sgn: 0, w2: 0, wMax: 0, err2: 0, rcs: 0, thr: null, thr2: 0 });
const all = [];
for (let k = 0; k < N; k++) {
  const wx = WX[k % WX.length];
  const sDr = Math.round((60 + Math.random() * 240) * (Math.random() < .5 ? -1 : 1) * 1000);
  const sCr = Math.round((Math.random() * 36 - 18) * 1000);
  const entryErr = Math.random() * 40 - 20;
  const st = seco(wx); F.setWeather(wx);
  F.setShipTargetDr(sDr);
  const a = sDr / F.RE, c = sCr / F.RE;
  S3.setTarget(S3.vnorm(V(Math.sin(a) * Math.cos(c), Math.cos(a) * Math.cos(c), Math.sin(c))));
  const sh = S3.fromPlan(F.planShipReturn(st), F, sCr / 1000 + entryErr);
  const TQi = S3.qconj(S3.qBetween(S3.getTarget(), V(0, 1, 0)));
  const M = {}, ring = []; let down = null, landT = null;
  for (let i = 0; i < 400000 && sh.alive; i++) {
    const r = S3.step(sh, dt, F);   // step tu goi dan huong 1 lan/buoc nhu game — dung goi them S3.auto
    if (sh.phase === 'FLIP' || sh.phase === 'LAND') {
      if (sh.phase === 'LAND' && landT === null) landT = sh.t;
      /* VAO = 6 s dau sau khi dung: qua do cua cu lat, khong phai lac */
      const mode = sh.phase === 'FLIP' ? 'FLIP' : (sh.arc === 'APP' && landT !== null && sh.t - landT < 6) ? 'VAO' : (sh.arc || 'LAND');
      const S = M[mode] || (M[mode] = mk());
      const f = S3.frame(sh, F), tl = S3.telemetry(sh, F);
      const cA = S3.qrot(TQi, V(0, 0, 1)), eA = S3.vnorm(S3.vcross(f.rhat, cA));
      const psi = sh.tw.psiB + sh.tw.psiC, sp = Math.sin(psi), cp = Math.cos(psi);
      const nose = S3.qrot(sh.q, V(0, 1, 0));
      const ne = S3.vdot(nose, eA), nc = S3.vdot(nose, cA);
      const tA = (ne * sp + nc * cp) * D, tS = (ne * cp - nc * sp) * D;          // nghieng THAT theo mieng tay / truc tay
      const g = sh.arcDbg || {}, aTh = Math.max(1, 9.81 + (g.aUp || 0));
      let tx = (g.aD || 0) / aTh, tz = (g.aC || 0) / aTh;
      const cap = sh.arc === 'FIN' ? S3.APR.TILT_FIN : sh.arc === 'PREC' ? S3.APR.TILT_PREC : S3.APR.TILT_APP;
      const tlen = Math.hypot(tx, tz); if (tlen > cap) { tx *= cap / tlen; tz *= cap / tlen; }
      if (g.tx !== undefined) { tx = g.tx; tz = g.tz; }          // lenh nghieng sau loc/gioi han toc do
      const cmdA = (tx * sp + tz * cp) * D, cmdS = (tx * cp - tz * sp) * D;
      const kk = dt / 2;
      if (S.mA === null) { S.mA = tA; S.mS = tS; S.cA = cmdA; S.cS = cmdS; S.thr = sh.throttle; }
      S.mA += (tA - S.mA) * kk; S.mS += (tS - S.mS) * kk; S.cA += (cmdA - S.cA) * kk; S.cS += (cmdS - S.cS) * kk;
      S.thr += (sh.throttle - S.thr) * kk;
      const hpA = tA - S.mA, hpS = tS - S.mS;
      S.hpA2 += hpA * hpA + hpS * hpS;
      S.hpC2 += (cmdA - S.cA) ** 2 + (cmdS - S.cS) ** 2;
      const big = Math.abs(hpA) > Math.abs(hpS) ? hpA : hpS;
      const sg = big > .05 ? 1 : big < -.05 ? -1 : 0;
      if (sg && S.sgn && sg !== S.sgn) S.zc++;
      if (sg) S.sgn = sg;
      const w = Math.hypot(sh.w.x, sh.w.z) * D;
      S.w2 += w * w; S.wMax = Math.max(S.wMax, w);
      if (sh.phase === 'LAND' && sh.arcDbg) S.err2 += (tA - cmdA) ** 2 + (tS - cmdS) ** 2;
      if (sh.eff === 'RCS' || (tl.rcsCmd || 0) > .05 || (sh.rcsT || 0) > .05) S.rcs++;
      S.rcsT = (S.rcsT || 0) + (sh.rcsT || 0);
      S.thr2 += ((sh.throttle - S.thr) * 100) ** 2;
      S.n++;
      if (TRACE === k + 1 && (i % 12) === 0) {
        ring.push(`${String(mode).padEnd(4)} h${(f.alt - F.CATCH_ALT - sh.tw.y).toFixed(0).padStart(5)} d${Math.hypot(f.down, f.cross).toFixed(1).padStart(7)}`
          + ` that(doc ${tA.toFixed(2).padStart(6)} ngang ${tS.toFixed(2).padStart(6)}) lenh(doc ${cmdA.toFixed(2).padStart(6)} ngang ${cmdS.toFixed(2).padStart(6)})`
          + ` w${w.toFixed(2).padStart(6)} ga${(sh.throttle * 100).toFixed(0).padStart(4)}% x${sh.nEng} ${String(sh.eff).padEnd(6)} rcs${(tl.rcsCmd || 0).toFixed(2)}`
          + ` gio${(F.windAt ? F.windAt(tl.alt, sh.t) : 0).toFixed(1).padStart(6)}`);
        if (ring.length > 160) ring.shift();
      }
    }
    if (r && (r.type === 'SHIP_DOWN' || r.type === 'BURN_THROUGH')) { down = r; break; }
  }
  const row = { wx, kq: down ? (down.outcome || down.type) : 'mat dau', tilt: down ? +(down.tilt * D).toFixed(2) : null, M, rcsLeft: sh.rcs, prop: sh.prop / 1000 };
  all.push(row);
  console.log(`\n#${k + 1} ${wx} ${row.kq} | nghieng luc cham ${row.tilt} do | RCS con ${(sh.rcs).toFixed(0)} kg`);
  for (const [m, S] of Object.entries(M)) {
    const n = Math.max(1, S.n), dur = S.n * dt;
    console.log(`  ${m.padEnd(4)} ${dur.toFixed(0).padStart(4)}s | lac ${Math.sqrt(S.hpA2 / n).toFixed(2).padStart(5)} do  lenh ${Math.sqrt(S.hpC2 / n).toFixed(2).padStart(5)} do`
      + `  ${(S.zc / 2 / Math.max(dur, .1)).toFixed(2)} Hz | w rms ${Math.sqrt(S.w2 / n).toFixed(2)} max ${S.wMax.toFixed(1)} do/s | bam ${Math.sqrt(S.err2 / n).toFixed(2)} do`
      + ` | ga dao ${Math.sqrt(S.thr2 / n).toFixed(1)}% | rcs ${(100 * S.rcs / n).toFixed(0)}% day ngang tb ${(100 * (S.rcsT || 0) / n).toFixed(0)}%`);
  }
  if (TRACE === k + 1) { console.log('  --- dien bien 40 s cuoi (0.25 s) ---'); for (const l of ring) console.log('   ' + l); }
}
const agg = (m, key) => { const xs = all.map(r => r.M[m]).filter(Boolean); if (!xs.length) return '-';
  const v = xs.map(S => key === 'lac' ? Math.sqrt(S.hpA2 / Math.max(1, S.n)) : key === 'lenh' ? Math.sqrt(S.hpC2 / Math.max(1, S.n))
    : key === 'w' ? Math.sqrt(S.w2 / Math.max(1, S.n)) : key === 'hz' ? S.zc / 2 / Math.max(.1, S.n * dt) : 0);
  return (v.reduce((a, b) => a + b, 0) / v.length).toFixed(2); };
console.log('\nTONG (trung binh cac chuyen):');
for (const m of ['VAO', 'APP', 'PREC', 'FIN']) console.log(`  ${m.padEnd(4)} lac ${agg(m, 'lac')} do | lenh ${agg(m, 'lenh')} do | ${agg(m, 'hz')} Hz | w rms ${agg(m, 'w')} do/s`);
  const durs = m => (all.reduce((a, r) => a + (r.M[m] ? r.M[m].n * dt : 0), 0) / all.length).toFixed(0);
  console.log(`  nghieng luc cham tb ${(all.reduce((a, r) => a + (r.tilt || 0), 0) / all.length).toFixed(2)} do | tot ${all.filter(r => r.kq === 'bullseye').length}/${N}`
    + ` | thoi gian tb APP ${durs('APP')}s PREC ${durs('PREC')}s FIN ${durs('FIN')}s | RCS binh con tb ${(all.reduce((a, r) => a + r.rcsLeft, 0) / all.length).toFixed(0)} kg | nl con tb ${(all.reduce((a, r) => a + r.prop, 0) / all.length).toFixed(1)} t`);
