#!/usr/bin/env node
/* Thu he lam mat be phong — chay bang node, khong can trinh duyet. */
const F = require(__dirname + '/../game/flight.js');
const dt = 0.02;

/* Do cao day ten lua theo thoi gian ke tu T-0, lay tu chinh lo bay. */
function climb() {
  const st = F.makeState(), h = [];
  for (let i = 0; i < 3000 && st.alive; i++) {
    F.step(st, dt);
    const t = F.telemetry(st);
    h.push({ t: st.t, alt: t.alt, thr: t.thrust / 74.4e6 });
    if (t.alt > 600) break;
  }
  return h;
}
const TRACE = climb();
const at = tt => {
  if (tt < 0) return { alt: 0, thr: 0 };
  const k = Math.min(TRACE.length - 1, Math.round(tt / dt));
  return TRACE[k];
};

/* tOn = giay mo van so voi T-0 (am = mo truoc khi danh lua). null = khong mo. */
function run(tOn, label) {
  const d = F.makeDeluge();
  let ev = [], t = Math.min(-12, tOn === null ? 0 : tOn) - 2;
  const nStep = Math.round((26 - t) / dt);
  for (let i = 0; i < nStep; i++, t += dt) {
    if (tOn !== null && !d.on && t >= tOn) { d.on = true; d.tOn = t; }
    const a = at(t);
    const e = F.delugeStep(d, dt, a.alt, a.thr);
    if (e) ev.push(`hu ${(e.level * 100).toFixed(0)}% @${e.T}K`);
    if (t > 26) break;
  }
  return { label, pkT: Math.round(d.pkT), dmg: +(d.dmg * 100).toFixed(0),
           nuoc: +(d.used).toFixed(0), con: +(d.w / F.DEL.W0 * 100).toFixed(0),
           soiMang: d.film ? 'CO' : '-', canh: d.dry ? 'CAN' : '-', ev: ev.join(' ') };
}

const P = F.DEL, mdot = 33 * 2.30e6 / (347 * 9.80665), ve = 347 * 9.80665;
console.log('--- can bang cong suat ---');
console.log(`  luong khi 33 Raptor : ${(0.5 * mdot * ve * ve / 1e9).toFixed(0)} GW  (mdot ${Math.round(mdot)} kg/s, ve ${Math.round(ve)} m/s)`);
console.log(`  nuoc ${P.Q0} m3/s toan tam: ${(P.Q0 * 1000 * P.HW / 1e9).toFixed(0)} GW`);
console.log(`  rot vao vung dap    : ${(P.Q0 * 1000 * (P.A_IMP / P.A_PLATE) * P.HW / 1e9).toFixed(1)} GW`);
console.log(`  nhiet vao tam @h=0  : ${(P.QDOT * P.A_IMP / 1e9).toFixed(2)} GW`);
const C = P.A_IMP * P.SKIN * P.RHO * P.CP;
console.log(`  nhiet dung lop mat  : ${(C / 1e6).toFixed(2)} MJ/K  -> khong nuoc: ${Math.round(P.QDOT * P.A_IMP / C)} K/s`);
console.log(`  du nuoc chay het     : ${(P.W0 / P.Q0).toFixed(0)} s o luu luong dinh muc\n`);

console.log('kich ban                     dinh nhiet  hu hai  nuoc dung  con lai  soi mang  can  su kien');
const cases = [[null, 'khong mo van'], [0, 'mo dung T-0'], [1.5, 'mo tre 1.5 s'],
               [-5, 'mo T-5 s (chuan)'], [-40, 'mo T-40 s (som qua)']];
for (const [tOn, lb] of cases) {
  const r = run(tOn, lb);
  console.log(`${lb.padEnd(28)} ${(r.pkT + ' K').padStart(9)} ${(r.dmg + '%').padStart(7)} ${(r.nuoc + ' m3').padStart(10)} ${(r.con + '%').padStart(8)} ${r.soiMang.padStart(9)} ${r.canh.padStart(4)}  ${r.ev}`);
}
