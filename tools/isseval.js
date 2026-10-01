/* Cham CA CHUYEN ISS bang node — phong, duoi pha, chuyen quy dao, tiep can, cap.
   Chay dung trinh tu ma lop game goi, tren dung hai lo vat ly that (flight.js +
   dock.js da trich tu hotstage.html), khong can trinh duyet, khong can GPU.

   node tools/isseval.js sweep [--n 12] [--crew 1] [--quiet]
     -> boc N goc pha dau (tuc N GIO PHONG khac nhau) roi bay tron tung chuyen.
        In bang: doi bao lau, ton bao nhieu, cap duoc khong, sai so bat mem.
   node tools/isseval.js one <gocPhaDo> [--crew 1]
     -> mot chuyen, in tung moc.

   BUOC THOI GIAN: doan duoi pha va chuyen quy dao la bay hai-the thuan tuy nen
   buoc 1 s (sai so RK4 o do khong dang ke va nhanh gap 50 lan); tu luc tiep can
   tro di ve dung DT 0.02 cua game, vi luc do co dieu khien va dung sai la 10 cm.  */
'use strict';
const path = require('path');
const G = path.join(__dirname, '..', 'game');
const F = require(path.join(G, 'flight.js'));
const D = require(path.join(G, 'dock.js'));

const ISS_ALT = 420e3, BELOW = 2000, DT = 0.02;
const CREW = [{ crew: 4, cargo: 5e3 }, { crew: 7, cargo: 10e3 }, { crew: 12, cargo: 20e3 }];
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };

/* Phong len quy dao bang chinh bo tich phan cua game. */
function ascend(payKg) {
  F.setPayload(payKg);
  const st = F.makeState();
  let t = 0;
  while (st.alive && st.stage === 1 && t < 400) { F.step(st, DT, { throttle: 1 }); t += DT; }
  while (st.alive && st.prop2 > 0 && t < 900) { F.step(st, DT, { throttle: 1 }); t += DT; }
  return st;
}

function fly(leadDeg, crewIdx, trace) {
  const C = CREW[crewIdx];
  const st = ascend(C.crew * 500 + C.cargo);
  const secoAlt = Math.hypot(st.x, st.y) - F.RE, propSeco = st.prop2;
  const circ = F.circularize(st);
  if (!circ.ok) return { ok: false, vi: 'khong tron duoc quy dao', can: circ.need, con: circ.have };

  const d = D.make(F, st, { alt: ISS_ALT, lead0: leadDeg * Math.PI / 180 });
  d.phase = 'PHASING';
  const rTgt = F.RE + ISS_ALT - BELOW;
  const w0 = D.windowIn(F, st, d.stn, rTgt);
  const log = m => { if (trace) console.log('   ' + m); };
  log(`SECO ${(secoAlt / 1000).toFixed(1)} km, binh chinh ${(propSeco / 1000).toFixed(1)} t`);
  log(`tron quy dao ${circ.dv.toFixed(0)} m/s het ${circ.used.toFixed(1)} t -> con ${(st.prop2 / 1000).toFixed(1)} t`);
  log(`duoi pha ${(w0.wait / 3600).toFixed(2)} gio = ${w0.orbits.toFixed(2)} vong`);

  // --- duoi pha (buoc tho) ---
  let guard = 0;
  while (guard++ < 2e5) {
    const w = D.windowIn(F, st, d.stn, rTgt);
    if (w.wait <= 1.0) break;
    D.step(d, Math.min(1, Math.max(0.02, w.wait)));
  }
  const h = D.hohmann(F, Math.hypot(st.x, st.y), rTgt);
  const b1 = D.burn(F, st, h.dv1);
  if (!b1.ok) return { ok: false, vi: 'thieu nhien lieu doi quy dao', can: b1.need, con: b1.have };
  d.phase = 'TRANSFER';
  log(`dot chuyen tiep ${h.dv1.toFixed(1)} m/s het ${b1.used.toFixed(2)} t, bay ${(h.t / 60).toFixed(0)} phut`);
  const tArr = st.t + h.t;
  while (st.t < tArr) D.step(d, Math.min(1, tArr - st.t));
  const b2 = D.burn(F, st, h.dv2);
  if (!b2.ok) return { ok: false, vi: 'thieu nhien lieu tron quy dao tren', can: b2.need, con: b2.have };
  d.phase = 'COELLIP';
  const tc = D.tel(d);
  log(`toi noi: ${(-tc.R).toFixed(0)} m duoi tram, lech doc ${tc.V.toFixed(0)} m, binh chinh ${(st.prop2 / 1000).toFixed(1)} t`);

  // --- tiep can (buoc that) ---
  d.phase = 'APPROACH';
  const tA = st.t;
  let n = 0;
  while (n < 3e7 && d.phase !== 'DOCKED' && d.tries < 6) { D.step(d, DT); n++; }
  const t = D.tel(d);
  return {
    ok: d.phase === 'DOCKED',
    doiGio: +(w0.wait / 3600).toFixed(2), vong: +w0.orbits.toFixed(2),
    tiepCanPhut: +((st.t - tA) / 60).toFixed(1),
    caGioPhut: +(st.t / 60).toFixed(0),
    binhChinh: +(st.prop2 / 1000).toFixed(1),
    rcsKg: +(D.RCS.TANK - st.rcs).toFixed(0),
    khep: +t.closing.toFixed(4), lech: +t.lat.toFixed(4), goc: +(t.ang / D.DEG).toFixed(2),
    truot: d.tries, vi: d.why,
  };
}

const mode = process.argv[2] || 'sweep';
const crewIdx = +arg('--crew', 1);
if (mode === 'one') {
  const r = fly(+process.argv[3], crewIdx, true);
  console.log(JSON.stringify(r, null, 1));
} else {
  const N = +arg('--n', 12);
  console.log(`goc pha dau | doi (gio) | vong | tiep can (ph) | ca chuyen (ph) | binh chinh (t) | RCS (kg) | khep | lech (m) | goc | truot`);
  let ok = 0;
  for (let i = 0; i < N; i++) {
    const g = -180 + 360 * i / N;
    const r = fly(g, crewIdx, false);
    if (r.ok) ok++;
    console.log(
      String(g.toFixed(0)).padStart(11) + ' | ' +
      (r.ok ? String(r.doiGio).padStart(9) + ' | ' + String(r.vong).padStart(4) + ' | ' +
              String(r.tiepCanPhut).padStart(13) + ' | ' + String(r.caGioPhut).padStart(14) + ' | ' +
              String(r.binhChinh).padStart(14) + ' | ' + String(r.rcsKg).padStart(8) + ' | ' +
              String(r.khep).padStart(6) + ' | ' + String(r.lech).padStart(8) + ' | ' +
              String(r.goc).padStart(5) + ' | ' + r.truot
            : 'HONG: ' + r.vi));
  }
  console.log(`\nCAP DUOC ${ok}/${N}`);
}
