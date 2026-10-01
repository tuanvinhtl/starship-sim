#!/usr/bin/env node
/* THU TAI dan huong tau quay ve: 19 kich ban x seed 555/8080 x 12 chuyen (456 chuyen), moi
   kich ban mot thu muc con, chay bang tools/shipeval.js (goi dan huong 1 lan/buoc nhu game).
   Dung de so hai module tren CUNG dieu kien dau — vd truoc/sau khi sua dan huong.

   node tools/shipstress.js run <nhan> --module <ship3d.js> --out <thu_muc> [--jobs 7]
        [--only ref,jetm2,...] [--seeds 555,8080] [--n 12] [--verbose]
   node tools/shipstress.js cmp <thu_muc> <nhan_goc> [nhan ...] [--only ...]
   Co the them --snap <thu_muc_cache> [--snap-stage FLOP|FLIP] [--snap-trust] [--snap-check N]:
   chuyen thang cho shipeval.js (xem tai lieu o do).

   Kich ban: ref = khong loi; PW = sai so gio CHI trong bo du bao (pw: nhan he so, jet: doi tam
   luong jet dh m) — luc that van dung gio that; eep/eem20 = sai so vao +-20; propp/m5 = +-5 t
   nhien lieu; sdr = ep tam xa (km); *wx = bao, bao tuyet, tuyet, gio nhe.
   "lat hut" = diem lat chua qua mieng tay +50 m (S.FLIP.down < 50) hoac khong lat. */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), { spawn } = require('child_process');
const EVAL = path.join(__dirname, 'shipeval.js');
const WX3 = 'calm,rain,gusty', WXX = 'storm,blizzard,snow,breezy';
const SCEN = [
  ['ref', {}, WX3], ['pw07', { PW: { scale: 0.7 } }, WX3], ['pw11', { PW: { scale: 1.1 } }, WX3],
  ['pw12', { PW: { scale: 1.2 } }, WX3], ['pw13', { PW: { scale: 1.3 } }, WX3], ['jetp2', { PW: { dh: 2000 } }, WX3],
  ['jetm1', { PW: { dh: -1000 } }, WX3], ['jetm2', { PW: { dh: -2000 } }, WX3], ['eep20', { ENTRY_ERR: 20 }, WX3],
  ['eem20', { ENTRY_ERR: -20 }, WX3], ['propp5', { DPROP: 5000 }, WX3], ['propm5', { DPROP: -5000 }, WX3],
  ['sdrp60', { SDR: 60 }, WX3], ['sdrm60', { SDR: -60 }, WX3], ['sdrp300', { SDR: 300 }, WX3],
  ['sdrm300', { SDR: -300 }, WX3], ['wxext', {}, WXX], ['pw07wx', { PW: { scale: 0.7 } }, WXX],
  ['pw13wx', { PW: { scale: 1.3 } }, WXX],
];

function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { o._.push(a); continue; }
    const nx = argv[i + 1];
    o[a.slice(2)] = nx !== undefined && !nx.startsWith('--') ? (i++, nx) : true;
  }
  return o;
}
const pick = o => o.only ? SCEN.filter(s => String(o.only).split(',').includes(s[0])) : SCEN;

async function run(label, o) {
  if (!o.module || !o.out) throw new Error('can --module va --out');
  const out = path.resolve(o.out), mod = path.resolve(o.module);
  const seeds = String(o.seeds || '555,8080').split(','), n = String(o.n || 12);
  const jobs = Math.max(1, parseInt(o.jobs || String(Math.max(1, os.cpus().length - 1)), 10));
  const queue = [];
  for (const [name, set, wx] of pick(o)) {
    fs.mkdirSync(path.join(out, name), { recursive: true });
    for (const seed of seeds) queue.push({ name, set, wx, seed });
  }
  const total = queue.length, t0 = Date.now(); let done = 0, bad = 0;
  const one = j => new Promise(res => {
    const a = [EVAL, '_seed', label, j.seed, '--out', path.join(out, j.name), '--n', n, '--wx', j.wx, '--module', mod];
    for (const k of ['snap', 'snap-stage', 'snap-check', 'snap-trust'])   // chuyen tiep cache anh chup
      if (o[k] !== undefined) a.push('--' + k, ...(o[k] === true ? [] : [String(o[k])]));
    if (Object.keys(j.set).length) a.push('--set', JSON.stringify(j.set));
    const p = spawn(process.execPath, a, { stdio: ['ignore', o.verbose ? 'inherit' : 'ignore', 'inherit'] });
    p.on('close', code => {
      done++; if (code !== 0) bad++;
      console.log(`${code === 0 ? 'xong' : 'LOI '} ${j.name} s${j.seed} (${done}/${total}, ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
      res();
    });
  });
  await Promise.all(Array.from({ length: Math.min(jobs, total) }, async () => { while (queue.length) await one(queue.shift()); }));
  cmp(out, [label], o);
  if (bad) { console.log(`${bad} tien trinh LOI`); process.exitCode = 1; }
}

const fin = x => typeof x === 'number' && Number.isFinite(x);
const mean = a => { a = a.filter(fin); return a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN; };
const mx = a => { a = a.filter(fin); return a.length ? Math.max(...a) : NaN; };
const mn = a => { a = a.filter(fin); return a.length ? Math.min(...a) : NaN; };
const f0 = x => fin(x) ? x.toFixed(0) : '-', f1 = x => fin(x) ? x.toFixed(1) : '-';
const SV = (r, k, f) => r.S && r.S[k] ? r.S[k][f] : NaN;
const wrong = r => !(SV(r, 'FLIP', 'down') >= 50);

function cmp(out, want, o = {}) {
  const P = s => console.log(s);
  const tot = {};
  P(`\n## Thu tai (${out})\n`);
  P('| kich ban | nhan | bull | lat hut | down min m | lat cach thap tb m | LAND tb/max s | duoi 200 m tb s | con tb/min t | so voi goc: mat bull / hut moi / het hut / cham >10 s / thieu >5 t |');
  P('|---|---|---|---|---|---|---|---|---|---|');
  for (const [name] of pick(o)) {
    const dir = path.join(out, name);
    if (!fs.existsSync(dir)) continue;
    const rows = [];
    for (const fn of fs.readdirSync(dir)) if (fn.endsWith('.jsonl'))
      for (const l of fs.readFileSync(path.join(dir, fn), 'utf8').split('\n')) if (l.trim()) rows.push(JSON.parse(l));
    const labels = want.length ? want : [...new Set(rows.map(r => r.label))];
    const B = new Map(rows.filter(r => r.label === labels[0]).map(r => [`${r.seed}#${r.k}`, r]));
    for (const L of labels) {
      const R = rows.filter(r => r.label === L);
      if (!R.length) continue;
      const t = tot[L] || (tot[L] = { n: 0, bull: 0, wrong: 0, lost: 0, newW: 0, fixW: 0, slow: 0, fuel: 0, fuelMin: Infinity, landMax: -Infinity });
      let lost = 0, newW = 0, fixW = 0, slow = 0, fuel = 0, pairs = 0;
      if (L !== labels[0]) for (const r of R) {
        const b = B.get(`${r.seed}#${r.k}`);
        if (!b || JSON.stringify([b.wx, b.ic]) !== JSON.stringify([r.wx, r.ic])) continue;
        pairs++;
        if (b.outcome === 'bullseye' && r.outcome !== 'bullseye') lost++;
        if (!wrong(b) && wrong(r)) newW++;
        if (wrong(b) && !wrong(r)) fixW++;
        if (r.landDur > b.landDur + 10) slow++;
        if (r.propEnd < b.propEnd - 5) fuel++;
      }
      const bull = R.filter(r => r.outcome === 'bullseye').length, wr = R.filter(wrong).length;
      const fm = mn(R.map(r => r.propEnd)), lm = mx(R.map(r => r.landDur));
      Object.assign(t, { n: t.n + R.length, bull: t.bull + bull, wrong: t.wrong + wr, lost: t.lost + lost, newW: t.newW + newW,
        fixW: t.fixW + fixW, slow: t.slow + slow, fuel: t.fuel + fuel, fuelMin: Math.min(t.fuelMin, fm), landMax: Math.max(t.landMax, lm) });
      P(`| ${name} | ${L} | ${bull}/${R.length} | ${wr} | ${f0(mn(R.map(r => SV(r, 'FLIP', 'down'))))} | ${f0(mean(R.map(r => SV(r, 'FLIP', 'dist'))))}`
        + ` | ${f1(mean(R.map(r => r.landDur)))} / ${f1(lm)} | ${f1(mean(R.map(r => r.under200)))} | ${f1(mean(R.map(r => r.propEnd)))} / ${f1(fm)}`
        + ` | ${L === labels[0] ? '-' : `${lost} / ${newW} / ${fixW} / ${slow} / ${fuel} (${pairs} cap)`} |`);
    }
  }
  P('\n## Tong\n');
  for (const [L, t] of Object.entries(tot))
    P(`- ${L}: ${t.n} chuyen, bull ${t.bull}, lat hut ${t.wrong}, con it nhat ${f1(t.fuelMin)} t, LAND lau nhat ${f1(t.landMax)} s`
      + (L === (want[0] || Object.keys(tot)[0]) ? '' : ` | so voi goc: mat bull ${t.lost}, hut moi ${t.newW}, het hut ${t.fixW}, cham >10 s ${t.slow}, thieu >5 t ${t.fuel}`));
}

const o = parseArgs(process.argv.slice(2));
const [cmd, ...rest] = o._;
if (cmd === 'run' && rest[0]) run(rest[0], o).catch(e => { console.error(e.message); process.exitCode = 2; });
else if (cmd === 'cmp' && rest[0]) cmp(path.resolve(rest[0]), rest.slice(1), o);
else { console.error(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 14).join('\n')); process.exitCode = 2; }
