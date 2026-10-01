#!/usr/bin/env node
/* Cham DAN HUONG BOOSTER khong can trinh duyet.

   Dung:
     node tools/boosteval.js sweep <nhan> [--out thumuc] [--module duong/dan/flight.js]
       -> quet TAT DINH: thoi tiet x dich x buoc tich phan. Day la truong hop that cua
          game (rollTargets chi chon thoi tiet + dich), nen day moi la bang diem chinh.
     node tools/boosteval.js disp <nhan> [--n 8] [--seeds 777,4242] [...]
       -> them TAN XA THU CONG vao trang thai luc tach tang + sai so gio mo hinh + thieu
          nhien lieu. Pha phong khong co ngau nhien nao (xem ghi chu duoi) nen tan xa
          phai do TOOL bom vao, khong the trong vao hat giong.
     node tools/boosteval.js sum <thumuc> [--base nhan]
       -> bang tong hop; co --base thi so tung chuyen (cung khoa) voi nhan do.

   VI SAO PHAI TU BOM TAN XA: trong game/flight.js, Math.random chi xuat hien o
   randomWeather(). Phong -> MECO la tat dinh hoan toan. Nen moi chuyen vao THAP BO
   (dich = 0) cung mot thoi tiet la MOT chuyen duy nhat lap lai: chay 100 lan van ra
   dung mot con so. Chay nhieu hat giong ma khong bom tan xa = tu lua minh.

   Cac num tan xa (deu qua --set hoac co san trong disp):
     dv    : sai so van toc luc tach tang (m/s, ca hai truc)
     dalt  : sai so do cao luc tach tang (m)
     dprop : thieu nhien lieu (tan) so voi danh dinh
     pw    : he so gio MA BO LAI NHIN THAY (1 = dung; .7 / 1.3 = mo hinh gio sai).
             Bom bang cach vie^'t mot ban sao tam cua module, chi doi loi goi windAt
             BEN TRONG boosterAuto + ballisticImpact (dan huong) — vat ly that giu nguyen.

   Ket qua: <out>/<nhan>.jsonl, moi dong mot chuyen. Cung nhan + cung module + cung
   tham so thi giong tung bit, nen so hai ban dan huong la so tung chuyen. */

const fs = require('fs'), path = require('path'), os = require('os');
const ROOT = process.env.BOOSTEVAL_ROOT || path.join(__dirname, '..');
const DEF_WX = ['calm', 'breezy', 'rain', 'snow', 'gusty', 'storm', 'blizzard'];
const DEF_TG = [0, 80000, 120000, 160000];
const DEF_DT = [0.02];

/* ---------- tham so dong lenh ---------- */
function parseArgs(a) {
  const o = {}; const rest = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith('--')) { const k = a[i].slice(2); const v = (a[i + 1] && !a[i + 1].startsWith('--')) ? a[++i] : true; o[k] = v; }
    else rest.push(a[i]);
  }
  return { o, rest };
}
const num = (v, d) => v === undefined ? d : Number(v);
const list = (v, d) => v === undefined || v === true ? d : String(v).split(',');

/* ---------- nap module, co the boi gio cua BO LAI ---------- */
function findBody(src, sig) {
  const i = src.indexOf(sig); if (i < 0) throw new Error('khong thay ' + sig);
  let j = src.indexOf('{', i), depth = 0;
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) return [j, k + 1]; }
  }
  throw new Error('khong dong ngoac ' + sig);
}
function loadFlight(modPath, pw) {
  const p = path.resolve(modPath);
  if (!(pw > 0) || pw === 1) return require(p);
  let src = fs.readFileSync(p, 'utf8');
  // chi doi gio ma DAN HUONG nhin thay: boosterAuto + ballisticImpact
  // ballisticImpact nam TRUOC boosterAuto trong file -> phai sap xep theo vi tri,
  // khong thi cat chuoi lui ve sau va sinh ra module hong.
  const rng = ['function boosterAuto(b)', 'function ballisticImpact(b)'].map(sig => findBody(src, sig)).sort((a, b) => a[0] - b[0]);
  let out = '', last = 0;
  for (const [s, e] of rng) {
    out += src.slice(last, s) + src.slice(s, e).replace(/windAt\(/g, '__gw(');
    last = e;
  }
  out += src.slice(last);
  out = out.replace('function boosterAuto(b)', `const __gw = (al, tt) => windAt(al, tt) * ${pw};\n  function boosterAuto(b)`);
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bev-')), 'flight.js');
  fs.writeFileSync(tmp, out);
  return require(tmp);
}

/* ---------- mot chuyen ---------- */
function flyOne(F, c) {
  const dt = c.dt;
  F.setWeather(c.wx); F.setBoosterTarget(c.tg);
  // --- phong toi tach tang (tat dinh) ---
  const st = F.makeState(); let sep = null, rud = false;
  for (let i = 0; i < 400000 && st.alive && !sep; i++)
    for (const e of F.step(st, dt)) {
      if (e.type === 'MECO') sep = { x: st.x, y: st.y, vx: st.vx, vy: st.vy, prop1: st.prop1 };
      if (e.type === 'RUD') rud = true;
    }
  if (rud || !sep) return { ...c, outcome: 'RUD' };
  // --- tan xa thu cong ---
  if (c.dv) { const s = Math.hypot(sep.vx, sep.vy) || 1; sep.vx += c.dv * sep.vx / s; sep.vy += c.dv * sep.vy / s; }
  if (c.dalt) { const r = Math.hypot(sep.x, sep.y); sep.x *= 1 + c.dalt / r; sep.y *= 1 + c.dalt / r; }
  if (c.dprop) sep.prop1 = Math.max(0, (Number.isFinite(sep.prop1) ? sep.prop1 : 0) - c.dprop * 1000);

  const bo = F.makeBooster(sep);
  let td = null, tLand = null, tiltMax = 0, vsMax = 0, prof = {}, hSave = [400, 200, 100, 50, 20];
  for (let i = 0; i < 900000 && bo.alive; i++) {
    const r = F.boosterStep(bo, dt);
    const f = F.bFrame(bo), h = f.alt - 120;
    if (tLand === null && bo.phase === 'LANDING') tLand = bo.t;
    if (h < 2000) { tiltMax = Math.max(tiltMax, Math.abs(bo.th)); vsMax = Math.max(vsMax, Math.abs(f.ve)); }
    for (const hs of hSave) if (prof[hs] === undefined && h <= hs) prof[hs] = { d: +(f.dr - c.tg).toFixed(2), ve: +f.ve.toFixed(2), vu: +f.vu.toFixed(2), tilt: +(bo.th * 57.3).toFixed(2) };
    if (r && r.type === 'TOUCHDOWN') { td = r; break; }
  }
  return {
    ...c, outcome: td ? td.outcome : 'mat dau',
    miss: td ? +td.lat.toFixed(3) : null, vs: td ? +Math.abs(td.vs).toFixed(3) : null,
    tilt: td ? +(td.tilt * 57.3).toFixed(2) : null, prop: +(bo.prop / 1000).toFixed(2),
    rcs: +bo.rcs.toFixed(0), land: tLand === null ? null : +(bo.t - tLand).toFixed(2),
    tiltMax: +(tiltMax * 57.3).toFixed(2), veMax: +vsMax.toFixed(2), prof,
  };
}

/* ---------- cac bo truong hop ---------- */
function casesSweep(o) {
  const wx = list(o.wx, DEF_WX), tg = list(o.tg, DEF_TG).map(Number), dts = list(o.dts, DEF_DT).map(Number);
  const out = [];
  for (const w of wx) for (const t of tg) for (const d of dts)
    out.push({ key: `sweep|${w}|${t}|${d}`, kind: 'sweep', wx: w, tg: t, dt: d, dv: 0, dalt: 0, dprop: 0, pw: 1 });
  return out;
}
function casesDisp(o) {
  const wx = list(o.wx, DEF_WX), tg = list(o.tg, [0, 120000]).map(Number);
  const n = num(o.n, 8), dt = num(o.dt, 0.02);
  const seeds = list(o.seeds, ['777']).map(Number);
  const out = [];
  for (const s of seeds) {
    let z = s >>> 0; const rnd = () => { z = (z * 1664525 + 1013904223) >>> 0; return z / 4294967296; };
    for (const w of wx) for (const t of tg) for (let k = 0; k < n; k++) {
      // tan xa: van toc tach tang +-30 m/s, do cao +-600 m, thieu 0-6 t, gio mo hinh 0.7-1.3
      const dv = +((rnd() * 2 - 1) * 30).toFixed(2), dalt = +((rnd() * 2 - 1) * 600).toFixed(1);
      const dprop = +(rnd() * 6).toFixed(2), pw = +(0.7 + rnd() * 0.6).toFixed(3);
      out.push({ key: `disp|${s}|${w}|${t}|${k}`, kind: 'disp', wx: w, tg: t, dt, dv, dalt, dprop, pw, seed: s, k });
    }
  }
  return out;
}

/* ---------- tong hop ---------- */
const ok = r => r.outcome === 'perfect' || r.outcome === 'caught';
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
const fx = (v, n) => Number.isFinite(v) ? v.toFixed(n) : '--';
function group(rows, name, P) {
  if (!rows.length) return;
  const g = rows.filter(ok), m = g.map(r => Math.abs(r.miss));
  P(`| ${name} | ${g.length}/${rows.length} | ${rows.filter(r => r.outcome === 'perfect').length} | `
    + `${fx(mean(m), 2)} / ${fx(Math.max(...m, 0), 2)} | ${fx(Math.max(...g.map(r => r.vs), 0), 2)} | `
    + `${fx(Math.max(...g.map(r => r.tilt), 0), 2)} | ${fx(Math.min(...rows.map(r => r.prop)), 1)} | `
    + `${fx(mean(rows.map(r => (r.prof[100] || {}).d).filter(Number.isFinite).map(Math.abs)), 1)} | `
    + `${fx(mean(rows.map(r => (r.prof[100] || {}).ve).filter(Number.isFinite).map(Math.abs)), 1)} |`);
}
function summarize(dir, baseLabel) {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'));
  const by = {};
  for (const f of files) by[f.replace(/\.jsonl$/, '')] = fs.readFileSync(path.join(dir, f), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  const P = console.log;
  for (const [label, rows] of Object.entries(by)) {
    P(`\n## ${label} — ${rows.length} chuyen`);
    P('| nhom | bat duoc | perfect | lech tb/max m | v cham max | nghieng cham max do | nl con min t | |lech| o 100 m | |v ngang| o 100 m |');
    P('|---|---|---|---|---|---|---|---|---|');
    group(rows, 'TAT CA', P);
    group(rows.filter(r => r.tg === 0), 'thap bo', P);
    group(rows.filter(r => r.tg !== 0), 'xa lan', P);
    for (const w of DEF_WX) group(rows.filter(r => r.wx === w), w, P);
    const bad = rows.filter(r => !ok(r));
    if (bad.length) { P('\nchuyen HONG:'); for (const r of bad) P(`  ${r.key} -> ${r.outcome} lech ${fx(r.miss, 2)} m, v ${fx(r.vs, 2)}, nl con ${fx(r.prop, 1)} t`); }
    const wor = rows.filter(ok).sort((a, b) => Math.abs(b.miss) - Math.abs(a.miss)).slice(0, 6);
    P('\n6 chuyen lech nhat:'); for (const r of wor) P(`  ${r.key} lech ${fx(r.miss, 2)} m | v ${fx(r.vs, 2)} | nghieng ${fx(r.tilt, 2)} do | nl ${fx(r.prop, 1)} t`);
    // hoi tu theo buoc tich phan
    const byCase = {};
    for (const r of rows) { const k = `${r.wx}|${r.tg}`; (byCase[k] = byCase[k] || []).push(r); }
    const spread = Object.entries(byCase).filter(([, v]) => new Set(v.map(r => r.dt)).size > 1)
      .map(([k, v]) => ({ k, s: Math.max(...v.map(r => r.miss)) - Math.min(...v.map(r => r.miss)) }));
    if (spread.length) {
      spread.sort((a, b) => b.s - a.s);
      P(`\nHOI TU theo buoc tich phan (chenh lech |max-min| cua lech): tb ${fx(mean(spread.map(s => s.s)), 2)} m, te nhat:`);
      for (const s of spread.slice(0, 5)) P(`  ${s.k}: ${fx(s.s, 2)} m`);
    }
  }
  if (baseLabel && by[baseLabel]) {
    const B = new Map(by[baseLabel].map(r => [r.key, r]));
    for (const [label, rows] of Object.entries(by)) {
      if (label === baseLabel) continue;
      let same = 0, better = 0, worse = 0, fixed = 0, broke = 0;
      const dd = [];
      for (const r of rows) {
        const b = B.get(r.key); if (!b) continue;
        if (JSON.stringify(r.miss) === JSON.stringify(b.miss) && r.outcome === b.outcome) same++;
        if (ok(r) && !ok(b)) fixed++; if (!ok(r) && ok(b)) broke++;
        if (r.miss !== null && b.miss !== null) {
          const d = Math.abs(r.miss) - Math.abs(b.miss); dd.push(d);
          if (d < -0.01) better++; else if (d > 0.01) worse++;
        }
      }
      console.log(`\n## ${label} vs ${baseLabel}: y het ${same} | do lech giam ${better}, tang ${worse} | cuu duoc ${fixed}, lam hong ${broke} | thay doi lech tb ${fx(mean(dd), 2)} m`);
    }
  }
}

/* ---------- chay ---------- */
const { o, rest } = parseArgs(process.argv.slice(2));
const mode = rest[0], label = rest[1];
if (mode === 'sum') { summarize(path.resolve(rest[1] || o.out || '.'), o.base); process.exit(0); }
if (!mode || !label || !['sweep', 'disp'].includes(mode)) {
  console.error('dung: node tools/boosteval.js sweep|disp <nhan> [--out thumuc] [--module .../flight.js] [--wx ...] [--tg ...] [--dts 0.01,0.02,0.04] [--n 8] [--seeds ...]');
  process.exit(2);
}
const outDir = path.resolve(o.out || path.join(ROOT, 'evb'));
fs.mkdirSync(outDir, { recursive: true });
const modPath = o.module ? path.resolve(String(o.module)) : path.join(ROOT, 'game', 'flight.js');
const cases = mode === 'sweep' ? casesSweep(o) : casesDisp(o);
const t0 = Date.now();
const lines = [];
for (const c of cases) {
  const F = loadFlight(modPath, c.pw);
  const r = flyOne(F, c);
  lines.push(JSON.stringify(r));
  if (!o.quiet) console.log(`${label} ${c.key.padEnd(28)} ${String(r.outcome).padEnd(8)} lech ${fx(r.miss, 2).padStart(8)} m  v ${fx(r.vs, 2)}  nl ${fx(r.prop, 1)} t`);
}
fs.writeFileSync(path.join(outDir, label + '.jsonl'), lines.join('\n') + '\n');
console.log(`\n${cases.length} chuyen trong ${((Date.now() - t0) / 1000).toFixed(1)} s -> ${path.join(outDir, label + '.jsonl')}`);
