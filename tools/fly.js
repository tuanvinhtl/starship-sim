#!/usr/bin/env node
/* Bay hang loat chuyen KHONG CAN TRINH DUYET.
   Dung: node tools/fly.js [soChuyen] [wx1,wx2,...]
   Vi du: node tools/fly.js 6 calm,rain,gusty
   Chi kiem duoc phan VAT LY (ket qua ha, nhien lieu, nhiet). Hinh hoc canh tay,
   thoi gian khung hinh va moi thu can GPU thi van phai mo preview. */
const F = require(__dirname + '/../game/flight.js');
const S3 = require(__dirname + '/../game/ship3d.js');
const dt = 0.02;
const N = parseInt(process.argv[2] || '3', 10);
const WX = (process.argv[3] || 'calm,rain,gusty').split(',');

const rows = [];
for (let k = 0; k < N; k++) {
  const wx = WX[k % WX.length];
  F.setWeather(wx);
  const tower = Math.random() < .4;
  const bDr = tower ? 0 : Math.round((60 + Math.random() * 110) * 1000);
  const sDr = Math.round((60 + Math.random() * 240) * (Math.random() < .5 ? -1 : 1) * 1000);
  const sCr = Math.round((Math.random() * 36 - 18) * 1000);
  F.setBoosterTarget(bDr); F.setShipTargetDr(sDr);
  const a = sDr / F.RE, c = sCr / F.RE;
  S3.setTarget(S3.vnorm(S3.V(Math.sin(a) * Math.cos(c), Math.cos(a) * Math.cos(c), Math.sin(c))));

  // --- phong ---
  const st = F.makeState(); let sep = null, rud = false, maxQA = 0;
  for (let i = 0; i < 400000 && st.alive; i++) {
    for (const e of F.step(st, dt)) {
      if (e.type === 'MECO') sep = { x: st.x, y: st.y, vx: st.vx, vy: st.vy };
      if (e.type === 'RUD') rud = true;
    }
    if (Math.abs(st.qAlpha) > maxQA) maxQA = Math.abs(st.qAlpha);
  }
  if (rud || !sep) { rows.push({ wx, b: 'RUD', s: 'RUD' }); continue; }

  // --- booster ---
  const bo = F.makeBooster(sep); let td = null;
  for (let i = 0; i < 900000 && bo.alive; i++) {
    F.boosterAuto(bo);
    const r = F.boosterStep(bo, dt);
    if (r && r.type === 'TOUCHDOWN') { td = r; break; }
  }
  // --- tau ---
  const shr = S3.fromPlan(F.planShipReturn(st), F, sCr / 1000 + (Math.random() * 40 - 20));
  let sd = null;
  for (let i = 0; i < 400000 && shr.alive; i++) {
    const r = S3.step(shr, dt, F);   // step tu goi dan huong 1 lan/buoc nhu game — dung goi them S3.auto
    if (r && (r.type === 'SHIP_DOWN' || r.type === 'BURN_THROUGH')) { sd = r; break; }
  }
  rows.push({
    wx, dich: bDr === 0 ? 'thap bo' : 'ngoai khoi ' + Math.round(bDr / 1000) + 'km',
    b: td ? `${td.outcome} ${td.lat.toFixed(2)}m ${Math.abs(td.vs).toFixed(1)}m/s` : 'mat dau',
    nl: (bo.prop / 1000).toFixed(1) + 't',
    sDr: Math.round(sDr / 1000) + 'km',
    s: sd ? (sd.type === 'BURN_THROUGH' ? 'chay thung ' + sd.where
      : `${sd.outcome} ${sd.miss.toFixed(2)}m ${Math.abs(sd.vs).toFixed(1)}m/s yaw ${(sd.yaw * 57.3).toFixed(1)}d`) : 'mat dau',
    T: `${Math.round(shr.pkTb || 0)}/${Math.round(shr.pkTl || 0)}/${Math.round(shr.pkTh || 0)}K`,
  });
}
const w = (s, n) => String(s).padEnd(n);
console.log(w('thoi tiet', 9), w('dich booster', 18), w('booster', 26), w('nl', 7), w('tam tau', 8), w('tau', 40), 'bung/lung/ban le');
for (const r of rows) console.log(w(r.wx, 9), w(r.dich || '', 18), w(r.b, 26), w(r.nl || '', 7), w(r.sDr || '', 8), w(r.s, 40), r.T || '');
