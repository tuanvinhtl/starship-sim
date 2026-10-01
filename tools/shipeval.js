#!/usr/bin/env node
/* Cham tau quay ve HANG LOAT bang node — bo do chuan truoc/sau moi lan chinh dan huong.
   Goi dan huong DUNG MOT LAN moi buoc (chi S3.step) y het vong lap game (DT 0.02): goi
   them S3.auto thi dong ho lat (flipT) va cac bo tich phan chay nhanh gap doi.

   node tools/shipeval.js run <nhan> [--seeds 9001,31337,2718,1234] [--n 12] [--wx calm,rain,gusty]
        [--set '{"APR":{"GATE":400},"RANGE_BIAS":-1500}'] [--module duong/dan/ship3d.js]
        [--out thu_muc] [--base nhan_goc] [--jobs 4] [--quiet]
        [--snap <thu_muc_cache>] [--snap-stage FLOP|FLIP] [--snap-trust] [--snap-check 1]
     -> <out>/<nhan>_<seed>.jsonl (ghi de), moi seed mot tien trinh con chay song song,
        xong in bang tong hop (va so voi --base neu co san trong cung thu muc).
   node tools/shipeval.js cmp <thu_muc> <nhan_goc> [nhan ...]
     -> bang tong hop, theo thoi tiet, va so TUNG CHUYEN voi nhan goc (cung seed, cung
        chuyen, cung dieu kien dau).

   CACHE ANH CHUP (--snap) — cho viec chinh PHA CUOI. Mot chuyen do duoc 4.1 s ma FLIP+LAND
   chi ~0.02 s: sua luat ha thi gan 100% may chay lai phan ENTRY+FLOP khong he doi. --snap
   luu trang thai tau + bo dem cua harness tai buoc DAU TIEN vao --snap-stage (mac dinh
   FLOP) roi lan sau buoc tiep tu do; thieu ban ghi thi tu chay lanh va tao. Do duoc tren
   24 chuyen (seed 777+9191, --n 12, --jobs 2): khong cache 47.5 s = 1.98 s/chuyen; cache
   am stage FLOP 7.8 s = 0.33 s/chuyen (nhanh 6.1 lan), stage FLIP 0.27 s = 0.011 s/chuyen
   (nhanh 176 lan); lan chay lanh de tao cache 47.3 s, bang voi khi khong cache.
   Khoa cache = seed + so hieu chuyen + thoi tiet + --set (da chuan hoa) + stage + HASH VAN
   BAN MODULE + hash game/flight.js; khac mot thu la tinh lai. Dong so ngau nhien van rut y nguyen nen tung dong
   JSONL trung TUNG BIT voi khi khong cache (tru `wall` = gio may chay).
   --snap-trust: cho dung lai ke ca khi CHI hash module khac — nguoi goi cam ket thay doi
   nam SAU anh chup (vd chi sua pha LAND). Khi do tool TU KIEM LAI --snap-check N chuyen
   moi seed (mac dinh 1; N chuyen dau tien THUC SU dung ban ghi cua module khac): chay lanh
   lai bang module hien tai roi so tung truong voi ban trong cache; lech thi in ten truong
   va thoat voi ma 3. --snap-check 0 de tat (tu chiu trach nhiem).
   Hai cho --snap-trust KHONG phu: chuyen CHET truoc moc luu duoc phat lai nguyen ket qua cu, va
   --snap-check chi kiem N chuyen dau THUC SU dung ban ghi cua module khac, khong phai moi chuyen.
   Mot thu muc cache dung chung duoc cho nhieu tien trinh (ghi file tam roi doi ten).
   Chay ban sao ngoai repo: dat SHIPEVAL_ROOT=<goc repo>.

   Dieu kien dau (tam xa 60-300 km, lech ngang +-18 km, sai so vao +-20) sinh tu seed theo
   dung thu tu cua tools/terminal.js, nen cung seed + cung module thi cung ket qua tung bit.
   Truong moi chuyen (JSONL): under500/200/50/12 = giay tu luc qua do cao do (tren xe truot) toi luc
   cham; sway{APP,PREC,FIN} va swayH{b200: 200-40 m, b40: 40-12 m, b12: <12 m} = do nghieng than
   {rms, max} (do); ev = su kien cham (ev.twVy > 0: xe truot dang NANG len don). Anh chup S.h500/h200/
   h50/h30/h12 co them twY, twVy (xe truot); vkMax {b30: 30-12 m, b12: < 12 m} = toc do khep (-(vu - twVy))
   lon nhat trong dai.
   --set (JSON): APR / SGC / TWS gan de vao khoi hang so cua module; RANGE_BIAS -> sh.rangeBias.
   Thu tai: DPROP (kg them/bot nhien lieu luc vao), SDR (km, ep tam xa), ENTRY_ERR (ep sai so vao),
   PW {scale, dh}: sai so gio CHI trong bo du bao (nhan he so / doi tam luong jet dh m) — luc
   that van dung gio that. Cung --set thi hai module van so tung chuyen duoc. */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto'), { spawn } = require('child_process');
/* Ban sao dat ngoai repo van chay duoc: dat SHIPEVAL_ROOT=<goc repo> (spawn ke thua env nen
   tien trinh con cua `run` cung thay). Mac dinh van la thu muc cha cua tools/. */
const ROOT = path.resolve(process.env.SHIPEVAL_ROOT || path.join(__dirname, '..'));
const SEEDS = '9001,31337,2718,1234';

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

/* Sai so gio trong bo du bao: chep module ra file tam, thay moi cho bo du bao doc gio
   (`F.windAt ? F.windAt(alt, tt) : 0`; forces() doc F.windAt(alt, sh.t) nen khong dinh)
   bang __pw(). Luong jet mo phong theo F.windAt: Gauss tam 11 km, be rong 5.2 km. */
function hookWind(src) {
  let s = fs.readFileSync(src, 'utf8');
  const pat = 'F.windAt ? F.windAt(alt, tt) : 0', anchor = '  function attitudeCmd(';
  const n = s.split(pat).length - 1;
  if (n < 1 || s.split(anchor).length !== 2) throw new Error(`hookWind: ${n} cho gio, moc attitudeCmd khong duy nhat — module da doi`);
  s = s.split(pat).join('__pw(F, alt, tt)').replace(anchor, `  function __pw(F, alt, t) {
    const w = F.windAt ? F.windAt(alt, t) : 0, P = globalThis.__PW;
    if (!P) return w;
    let x = w;
    if (P.dh && alt >= 0 && alt <= 32000 && F.getWeather) {
      const J = F.getWeather().jet;
      x += J * (Math.exp(-Math.pow((alt - 11000 - P.dh) / 5200, 2)) - Math.exp(-Math.pow((alt - 11000) / 5200, 2)));
    }
    return x * (P.scale === undefined ? 1 : P.scale);
  }
` + anchor);
  const dst = path.join(os.tmpdir(), `shipeval-pw-${process.pid}.js`);
  fs.writeFileSync(dst, s);
  process.on('exit', () => { try { fs.unlinkSync(dst); } catch (e) { /* da xoa */ } });
  return dst;
}

/* ---------- CACHE ANH CHUP PHA CUOI (--snap) ----------
   Do tren may nay: mot chuyen 4.1 s ma FLIP+LAND chi ~0.02 s — chinh pha ha thi gan 100%
   may chay lai phan ENTRY+FLOP khong he doi. --snap luu lai trang thai tau VA toan bo bo
   dem cua vong lap harness tai buoc DAU TIEN vao --snap-stage, lan sau buoc tiep tu do.
   KHOA CACHE tach lam hai:
     bh = sha1({v, seed, k, wx, stage, dt, fh = hash game/flight.js, set da chuan hoa}) -> ten file
     mh = sha1(VAN BAN module thuc su nap: ban PW da viet lai neu co --set PW) -> duoi ten
   Tach de --snap-trust co the lay ban CHI khac mh; khong trust thi phai trung ca hai.
   Doc xong con doi chieu rec.key voi khoa hien tai + doi chieu dieu kien dau (sinh tu
   seed + k) truoc khi dam dung. */
const SNAP_V = 'snap1';
const sortDeep = v => Array.isArray(v) ? v.map(sortDeep)
  : (v && typeof v === 'object') ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sortDeep(v[k])])) : v;
const sha = s => crypto.createHash('sha1').update(s).digest('hex');
/* JSON thuong lam mat NaN / Infinity / -0 (vd S.*.pi co the la NaN) -> boc sentinel. */
const NUMK = { NaN: NaN, Inf: Infinity, '-Inf': -Infinity, '-0': -0 };
const encJ = v0 => JSON.stringify(v0, (k, v) => typeof v !== 'number' ? v
  : Number.isNaN(v) ? { __num: 'NaN' } : v === Infinity ? { __num: 'Inf' }
  : v === -Infinity ? { __num: '-Inf' } : Object.is(v, -0) ? { __num: '-0' } : v);
const decJ = s => JSON.parse(s, (k, v) => v && typeof v === 'object' && typeof v.__num === 'string'
  && Object.prototype.hasOwnProperty.call(NUMK, v.__num) ? NUMK[v.__num] : v);
/* So TUNG TRUONG de quy; Object.is nen NaN == NaN va 0 != -0. */
const fmtv = v => typeof v === 'number' ? String(v) : JSON.stringify(v);
function diffDeep(a, b, p, out) {
  if (out.length > 30) return out;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') {
    if (!Object.is(a, b)) out.push(`${p || '.'}: ${fmtv(a)} != ${fmtv(b)}`);
    return out;
  }
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diffDeep(a[k], b[k], p ? `${p}.${k}` : k, out);
  return out;
}
/* Phan SO SANH duoc cua ban ghi (bo created/modHash/modPath; row thi bo nhan + duong dan
   module + gio chay vi ba thu do doi theo lan chay chu khong theo vat ly). */
const payload = r => ({ kind: r.kind, ic: r.ic, rangeBias0: r.rangeBias0, sh: r.sh, acc: r.acc,
  row: r.row ? Object.assign({}, r.row, { label: '', module: '', wall: 0 }) : null });
let _tmpN = 0;
/* Ghi NGUYEN TU: file tam + doi ten (cung thu muc = cung FS). Hai tien trinh dung chung mot
   thu muc cache khong bao gio doc phai ban ghi viet do dang. KHONG dung Math.random de dat
   ten file tam — no da bi thay bang LCG, goi them la lech dong so cua chuyen bay. */
function snapWrite(dir, bh, mh, rec) {
  const tmp = path.join(dir, `.tmp-${process.pid}-${Date.now()}-${_tmpN++}`);
  try { fs.writeFileSync(tmp, encJ(rec)); fs.renameSync(tmp, path.join(dir, `${bh}-${mh}.json`)); }
  catch (e) { try { fs.unlinkSync(tmp); } catch (e2) { /* khong con */ } throw e; }
}
/* Doc: uu tien ban dung hash module; chi khi --snap-trust moi lay ban khac hash (sort theo
   ten cho on dinh). File hong / cut / sai khoa -> coi nhu khong co (tinh lai roi ghi de). */
function snapRead(dir, bh, mh, trust, base) {
  const one = fn => {
    try {
      const r = decJ(fs.readFileSync(path.join(dir, fn), 'utf8'));
      if (!r || r.v !== SNAP_V || JSON.stringify(r.key) !== JSON.stringify(base)) return null;
      return r;
    } catch (e) { if (e.code !== 'ENOENT') console.error(`snap: bo qua ban ghi hong ${fn} (${e.message})`); return null; }
  };
  const exact = `${bh}-${mh}.json`;
  const r0 = one(exact);                       // doc thang, khong quet ca thu muc
  if (r0) return r0;
  if (!trust) return null;
  let names;
  try { names = fs.readdirSync(dir); } catch (e) { return null; }
  // ban cua module KHAC: lay ban MOI NHAT (truoc day lay ten nho nhat -> co the vo phai to tien cu)
  const sib = names.filter(f => f.startsWith(bh + '-') && f.endsWith('.json') && f !== exact)
    .map(f => { let t = 0; try { t = fs.statSync(path.join(dir, f)).mtimeMs; } catch (e) { /* vua bi xoa */ } return { f, t }; })
    .sort((a, b) => b.t - a.t);
  for (const c of sib) { const r = one(c.f); if (r) return r; }
  return null;
}

/* ---------- mot seed = mot tien trinh ---------- */
function runSeed(label, seed, o) {
  const F = require(path.join(ROOT, 'game/flight.js'));
  const OV = o.set ? JSON.parse(o.set) : {};
  const modPath = path.resolve(o.module || path.join(ROOT, 'game/ship3d.js'));
  const loadPath = OV.PW ? hookWind(modPath) : modPath;   // PW nap BAN VIET LAI -> hash theo ban do
  const S3 = require(loadPath);
  if (OV.PW) globalThis.__PW = OV.PW;
  const dt = 0.02, D = 180 / Math.PI;
  const N = parseInt(o.n || '12', 10), WX = String(o.wx || 'calm,rain,gusty').split(',');
  let _seed = seed;
  Math.random = () => { _seed = (_seed * 1664525 + 1013904223) >>> 0; return _seed / 4294967296; };
  for (const k of ['SGC', 'TWS', 'APR']) if (OV[k]) Object.assign(S3[k], OV[k]);
  const outFile = path.join(path.resolve(o.out), `${label}_${seed}.jsonl`);
  fs.writeFileSync(outFile, '');
  const SNAP = o.snap ? path.resolve(String(o.snap)) : null;
  const stRaw = o['snap-stage'];                                              // 'run' chuyen co trong thanh chuoi 'true'
  const STAGE = String(stRaw === undefined || stRaw === true || stRaw === 'true' ? 'FLOP' : stRaw).toUpperCase();
  const TRUST = !!o['snap-trust'];
  const ckRaw = o['snap-check'];                                              // de trong (ke ca chuoi 'true') = 1, KHONG duoc thanh 0
  const CHK = ckRaw === undefined || ckRaw === true || ckRaw === 'true' ? 1 : Math.max(0, parseInt(String(ckRaw), 10) || 0);
  let MODH = '', FLH = '', nChk = 0;
  if (SNAP) {
    if (STAGE !== 'FLOP' && STAGE !== 'FLIP') throw new Error(`--snap-stage chi nhan FLOP hoac FLIP, khong phai ${STAGE}`);
    fs.mkdirSync(SNAP, { recursive: true });          // thu muc chua co thi tao
    MODH = sha(fs.readFileSync(loadPath, 'utf8')).slice(0, 12);
    FLH = sha(fs.readFileSync(path.join(ROOT, 'game/flight.js'), 'utf8')).slice(0, 12);   // doi flight.js = khoa khac han
  }

  const secoCache = {};
  const seco = wx => {
    if (!secoCache[wx]) {
      F.setWeather(wx);
      const st = F.makeState();
      for (let i = 0; i < 400000 && st.alive; i++) F.step(st, dt);
      secoCache[wx] = JSON.stringify(st);
    }
    return JSON.parse(secoCache[wx]);
  };
  const hOf = (sh, f) => f.alt - F.CATCH_ALT - (sh.tw ? sh.tw.y : 0);
  const snap = (sh, f, h) => {
    const cA = S3.qrot(S3.qconj(S3.qBetween(S3.getTarget(), S3.V(0, 1, 0))), S3.V(0, 0, 1));
    const eA = S3.vnorm(S3.vcross(f.rhat, cA));
    return { t: sh.t, alt: f.alt, h, down: f.down, cross: f.cross, dist: Math.hypot(f.down, f.cross),
      vD: S3.vdot(sh.v, eA), vC: S3.vdot(sh.v, cA), vu: f.vu, speed: f.speed, prop: sh.prop / 1000, rcs: sh.rcs,
      pi: typeof sh.pi === 'number' ? sh.pi : NaN, hBurn: sh.hBurn, ph: sh.phase, arc: sh.arc || null,
      twY: sh.tw ? sh.tw.y : NaN, twVy: sh.tw ? sh.tw.vy : NaN };
  };
  const r2 = x => Math.round(x * 100) / 100;

  /* Trang thai MUC MODULE (khong nam trong sh): thoi tiet + tam xa muc tieu (flight.js) va
     muc tieu cua bo lai (ship3d.js). Phai dat lai TRUOC khi buoc tiep tu anh chup. */
  const applyMod = (wx, sDr, sCr) => {
    F.setWeather(wx);
    F.setShipTargetDr(sDr);
    const a = sDr / F.RE, c = sCr / F.RE;
    S3.setTarget(S3.vnorm(S3.V(Math.sin(a) * Math.cos(c), Math.cos(a) * Math.cos(c), Math.sin(c))));
  };
  /* Chay lanh: can ascent (seco, do duoc 0.46 s moi thoi tiet) + planShipReturn. Ca hai
     KHONG rut so ngau nhien nao nen bo qua chung khong lam lech dong LCG. */
  const born = (wx, sDr, sCr, entryErr) => {
    const st = seco(wx);
    applyMod(wx, sDr, sCr);
    const sh = S3.fromPlan(F.planShipReturn(st), F, sCr / 1000 + entryErr);
    if (OV.DPROP) { sh.prop += OV.DPROP; sh.m += OV.DPROP; }
    if (OV.RANGE_BIAS !== undefined) sh.rangeBias = OV.RANGE_BIAS;
    return sh;
  };
  /* TAT CA bo dem cua vong lap nam trong mot doi tuong -> anh chup duoc nguyen ven. */
  const newAcc = sh => ({ i: -1, S: {}, arcDur: {}, sway: {}, swayH: {}, vkMax: { b30: 0, b12: 0 },
    prevPh: sh.phase, prevH: null, down: null, rcsMin: sh.rcs, evs: 0, hover: 0 });
  /* Vong lap goc. stopStage != null -> dung o CUOI buoc DAU TIEN co phase == stopStage (tra
     'stage'); het chuyen -> 'end'. A.i giu so buoc da chay de tran 400000 khong doi. */
  const runLoop = (sh, A, stopStage) => {
    for (let i = A.i + 1; i < 400000 && sh.alive; i++) {
      const r = S3.step(sh, dt, F);             // DUNG MOT LAN goi dan huong / buoc
      const f = S3.frame(sh, F), h = hOf(sh, f);
      let hit = false;
      if (sh.phase !== A.prevPh) { if (!A.S[sh.phase]) A.S[sh.phase] = snap(sh, f, h); A.prevPh = sh.phase; hit = sh.phase === stopStage; }
      if (A.prevH !== null && (sh.phase === 'FLIP' || sh.phase === 'LAND'))
        for (const x of [500, 200, 50, 30, 12]) if (A.prevH > x && h <= x && !A.S['h' + x]) A.S['h' + x] = snap(sh, f, h);
      A.prevH = h;
      if (sh.phase === 'LAND') {
        /* thoi gian + do nghieng than (truc tau so voi phuong thang dung) theo tung che do ha */
        const m = sh.arc || 'LAND';
        A.arcDur[m] = (A.arcDur[m] || 0) + dt;
        const ax = S3.qrot(sh.q, S3.V(0, 1, 0));
        const tl = Math.acos(Math.max(-1, Math.min(1, S3.vdot(ax, f.rhat)))) * D;
        const w = A.sway[m] || (A.sway[m] = { n: 0, ss: 0, max: 0 });
        w.n++; w.ss += tl * tl; if (tl > w.max) w.max = tl;
        /* Lac theo DAI DO CAO tren xe truot (khong phu thuoc nhan che do: doi nhan APP/PREC/FIN
           thi so lieu theo che do doi theo, con dai do cao thi khong). */
        /* toc do khep LON NHAT theo dai (khong chi luc qua moc): xe truot nang o 12 m thi toc
           do khep co the vot ngay SAU moc. */
        if (sh.tw && h <= 30) { const vk = -(f.vu - sh.tw.vy), kb = h > 12 ? 'b30' : 'b12'; if (vk > A.vkMax[kb]) A.vkMax[kb] = vk; }
        if (h <= 200) {
          const bk = h > 40 ? 'b200' : h > 12 ? 'b40' : 'b12';
          const u = A.swayH[bk] || (A.swayH[bk] = { n: 0, ss: 0, max: 0 });
          u.n++; u.ss += tl * tl; if (tl > u.max) u.max = tl;
        }
        if (Math.abs(f.vu) < 1 && h > 5) A.hover += dt;
      }
      if (sh.rcs < A.rcsMin) A.rcsMin = sh.rcs;
      if (r && sh.alive) A.evs++;
      A.i = i;
      if (!sh.alive) { A.down = r; return 'end'; }
      if (hit) return 'stage';
    }
    return 'end';
  };
  const mkRow = (sh, A, k, wx, ic, rangeBias0, w0) => {
    const S = A.S, down = A.down;
    const since = key => S[key] ? sh.t - S[key].t : NaN;
    const ev = down ? Object.fromEntries(Object.entries(down).filter(([, v]) => ['number', 'string', 'boolean'].includes(typeof v))) : null;
    return { label, seed, k, wx, ic, set: OV, module: modPath, rangeBias0,
      type: down ? down.type : 'none', outcome: down ? (down.outcome || down.type) : 'none',
      miss: down && down.miss !== undefined ? down.miss : NaN, vs: down && down.vs !== undefined ? down.vs : NaN,
      tilt: down && down.tilt !== undefined ? down.tilt * D : NaN, yaw: down && down.yaw !== undefined ? down.yaw * D : NaN,
      tEnd: sh.t, landDur: since('LAND'), flipDur: (S.LAND && S.FLIP) ? S.LAND.t - S.FLIP.t : NaN,
      under500: since('h500'), under200: since('h200'), under50: since('h50'), under12: since('h12'), hover: r2(A.hover),
      arcDur: Object.fromEntries(Object.entries(A.arcDur).map(([m, v]) => [m, r2(v)])),
      sway: Object.fromEntries(Object.entries(A.sway).map(([m, w]) => [m, { rms: r2(Math.sqrt(w.ss / w.n)), max: r2(w.max) }])),
      vkMax: { b30: r2(A.vkMax.b30), b12: r2(A.vkMax.b12) },
      swayH: Object.fromEntries(Object.entries(A.swayH).map(([m, w]) => [m, { rms: r2(Math.sqrt(w.ss / w.n)), max: r2(w.max) }])),
      propEnd: sh.prop / 1000, rcsEnd: sh.rcs, rcsMin: A.rcsMin, rcsFlop: S.FLOP ? S.FLOP.rcs : NaN,
      flipAlt: sh.flipAlt, dmg: sh.dmg || 0, hingeDmgMax: sh.hingeDmg ? Math.max(...sh.hingeDmg) : 0,
      pkTb: sh.pkTb || 0, pkTl: sh.pkTl || 0, pkTh: sh.pkTh || 0, evs: A.evs, twY: sh.tw ? sh.tw.y : NaN, ev,
      wall: (Date.now() - w0) / 1000, S };
  };
  const mkRec = (base, kind, ic, rangeBias0, sh, acc, row) => ({ v: SNAP_V, key: base, modHash: MODH,
    modPath, stage: STAGE, created: new Date().toISOString(), kind, ic, rangeBias0, sh, acc, row });
  const show = (row, A, tag) => {
    const fx = (x, d = 0) => Number.isFinite(x) ? x.toFixed(d) : '-';
    const Fp = A.S.FLIP || {}, Lp = A.S.LAND || {};
    console.log(`${label} s${seed} #${row.k + 1} ${row.wx.padEnd(5)} ${row.outcome.padEnd(8)} miss ${fx(row.miss, 2)}`
      + ` | lat cach thap ${fx(Fp.dist)} m, vao LAND lech ngang ${fx(Lp.cross)} m | LAND ${fx(row.landDur, 1)} s, duoi 200 m ${fx(row.under200, 1)} s`
      + ` (FIN ${fx(A.arcDur.FIN, 1)}) | con ${fx(row.propEnd, 1)} t | ${fx(row.wall, 1)} s${tag}`);
  };

  for (let k = 0; k < N; k++) {
    const wx = WX[k % WX.length];
    const sDrRaw = Math.round((60 + Math.random() * 240) * (Math.random() < .5 ? -1 : 1) * 1000);
    const sCr = Math.round((Math.random() * 36 - 18) * 1000);
    const entryErrRaw = Math.random() * 40 - 20;
    const sDr = OV.SDR !== undefined ? Math.round(OV.SDR * 1000) : sDrRaw;      // van rut du so ngau nhien
    const entryErr = OV.ENTRY_ERR !== undefined ? OV.ENTRY_ERR : entryErrRaw;  // de chuyen sau khong doi
    /* 4 so tren duoc rut o MOI chuyen ke ca khi lay tu cache -> thu tu dong LCG khong doi. */
    const ic = { sDr, sCr, entryErr }, w0 = Date.now();
    let base = null, bh = '', rec = null;
    if (SNAP) {
      base = { v: SNAP_V, seed, k, wx, stage: STAGE, dt, fh: FLH, set: sortDeep(OV) };
      bh = sha(JSON.stringify(base)).slice(0, 16);
      rec = snapRead(SNAP, bh, MODH, TRUST, base);
      /* dieu kien dau sinh tu (seed, k): lech thi ban ghi khong phai cua chuyen nay -> bo di */
      if (rec && JSON.stringify(rec.ic) !== JSON.stringify(ic)) {
        console.error(`snap: ban ghi ${bh} co dieu kien dau khac (${JSON.stringify(rec.ic)}) -> tinh lai`);
        rec = null;
      }
    }
    /* --snap-trust: ban trong cache la cua module khac -> phai kiem lai CHK chuyen dau tien */
    const check = !!rec && rec.modHash !== MODH && nChk < CHK;
    let row = null, sh = null, A = null, rb0 = 0, wrote = false, tag = '';
    if (check) {
      nChk++;
      sh = born(wx, sDr, sCr, entryErr); A = newAcc(sh); rb0 = sh.rangeBias;
      const res = runLoop(sh, A, rec.kind === 'dead' ? null : STAGE);
      const got = res === 'stage' ? mkRec(base, 'snap', ic, rb0, sh, A, null)
        : mkRec(base, 'dead', ic, rb0, null, null, mkRow(sh, A, k, wx, ic, rb0, w0));
      const d = diffDeep(payload(rec), payload(got), '', []);
      if (d.length) {
        console.error(`\nsnap: KIEM TRA HONG — s${seed} #${k + 1} ${wx} stage ${STAGE}: anh chup trong cache`
          + ` (module ${rec.modHash}) KHAC ket qua tinh lai bang module hien tai (${MODH}).`
          + ` --snap-trust chi dung duoc khi thay doi nam SAU anh chup.`);
        for (const x of d) console.error(`  ${x}`);
        console.error(`  (${d.length} truong lech${d.length > 30 ? '+' : ''}; ban ghi ${bh}-${rec.modHash}.json trong ${SNAP})`);
        try { fs.writeFileSync(outFile, ''); } catch (e) { /* khong ghi duoc thi thoi */ }
        console.error(`  (da xoa cac dong da ghi trong ${outFile})`);
        process.exitCode = 3;
        return;
      }
      console.log(`snap-check s${seed} #${k + 1} ${wx} ${STAGE}: KHOP (cache ${rec.modHash} vs module ${MODH})`);
      snapWrite(SNAP, bh, MODH, got);     // ghi them ban duoi hash module moi -> lan sau khop tuyet doi
      wrote = true; tag = ' | kiem';
      if (got.kind === 'dead') { row = got.row; A = { S: row.S, arcDur: row.arcDur }; }
    } else if (rec) {
      wrote = true; tag = rec.modHash === MODH ? ' | cache' : ' | cache*';
      if (rec.kind === 'dead') {          // chuyen chet TRUOC stage: dung lai nguyen ket qua
        row = rec.row; A = { S: row.S, arcDur: row.arcDur };
        row.label = label; row.module = modPath; row.set = OV;   // gan vao khoa DA CO -> giu thu tu
        row.wall = (Date.now() - w0) / 1000;
      } else {
        sh = rec.sh; A = rec.acc; rb0 = rec.rangeBias0;
        applyMod(wx, sDr, sCr);           // dat lai trang thai muc module truoc khi buoc tiep
      }
    }
    if (!row && !sh) {                    // chay lanh tu dau
      sh = born(wx, sDr, sCr, entryErr); A = newAcc(sh); rb0 = sh.rangeBias;
      if (SNAP) {
        tag = ' | lanh';
        if (runLoop(sh, A, STAGE) === 'stage') { snapWrite(SNAP, bh, MODH, mkRec(base, 'snap', ic, rb0, sh, A, null)); wrote = true; }
      }
    }
    if (!row) {
      runLoop(sh, A, null);
      row = mkRow(sh, A, k, wx, ic, rb0, w0);
      /* chet truoc khi toi stage: luu nguyen ket qua de lan sau khoi chay lai */
      if (SNAP && !wrote) { snapWrite(SNAP, bh, MODH, mkRec(base, 'dead', ic, rb0, null, null, row)); tag = ' | lanh/chet'; }
    }
    fs.appendFileSync(outFile, JSON.stringify(row) + '\n');
    show(row, A, tag);
  }
}

/* ---------- tong hop / so sanh ---------- */
const fin = x => typeof x === 'number' && Number.isFinite(x);
const mean = a => { a = a.filter(fin); return a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN; };
const mx = a => { a = a.filter(fin); return a.length ? Math.max(...a) : NaN; };
const mn = a => { a = a.filter(fin); return a.length ? Math.min(...a) : NaN; };
const f0 = x => fin(x) ? x.toFixed(0) : '-', f1 = x => fin(x) ? x.toFixed(1) : '-', f2 = x => fin(x) ? x.toFixed(2) : '-';
const SV = (r, k, f) => r.S && r.S[k] ? r.S[k][f] : NaN;

function loadRows(dir) {
  const rows = [];
  for (const fn of fs.readdirSync(dir)) if (fn.endsWith('.jsonl'))
    for (const l of fs.readFileSync(path.join(dir, fn), 'utf8').split('\n')) if (l.trim()) rows.push(JSON.parse(l));
  return rows;
}
function summary(R) {
  return {
    n: R.length, bull: R.filter(r => r.outcome === 'bullseye').length,
    outcomes: R.reduce((o, r) => (o[r.outcome] = (o[r.outcome] || 0) + 1, o), {}),
    flipDist: mean(R.map(r => SV(r, 'FLIP', 'dist'))), flipDistMax: mx(R.map(r => SV(r, 'FLIP', 'dist'))),
    // lat HUT: diem lat chua toi mieng tay (+50 m) hoac khong lat
    wrong: R.filter(r => !(SV(r, 'FLIP', 'down') >= 50)).length, downMin: mn(R.map(r => SV(r, 'FLIP', 'down'))),
    crossLand: mean(R.map(r => Math.abs(SV(r, 'LAND', 'cross')))), crossLandMax: mx(R.map(r => Math.abs(SV(r, 'LAND', 'cross')))),
    land: mean(R.map(r => r.landDur)), landMax: mx(R.map(r => r.landDur)),
    u200: mean(R.map(r => r.under200)), u200Max: mx(R.map(r => r.under200)),
    fin: mean(R.map(r => (r.arcDur || {}).FIN)), finMax: mx(R.map(r => (r.arcDur || {}).FIN)),
    hover: mean(R.map(r => r.hover)),
    fuel: mean(R.map(r => r.propEnd)), fuelMin: mn(R.map(r => r.propEnd)),
    tiltMax: mx(R.map(r => r.tilt)), vsMax: mx(R.map(r => Math.abs(r.vs))), missMax: mx(R.map(r => r.miss)),
    swayFin: mx(R.map(r => ((r.sway || {}).FIN || {}).rms)), swayMax: mx(R.map(r => mx(Object.values(r.sway || {}).map(w => w.max)))),
    swayB40: mx(R.map(r => ((r.swayH || {}).b40 || {}).rms)), swayB12: mx(R.map(r => ((r.swayH || {}).b12 || {}).rms)),
    u12Max: mx(R.map(r => r.under12)), u50Min: mn(R.map(r => r.under50)), twVyMin: mn(R.map(r => r.ev ? r.ev.twVy : NaN)),
    vk30: mx(R.map(r => r.vkMax ? r.vkMax.b30 : NaN)), vk12: mx(R.map(r => r.vkMax ? r.vkMax.b12 : NaN)),
    rcsMin: mn(R.map(r => r.rcsMin)), hinge: mx(R.map(r => r.hingeDmgMax)), dmg: mx(R.map(r => r.dmg)),
  };
}
function cmp(dir, want) {
  const rows = loadRows(dir);
  const labels = want.length ? want : [...new Set(rows.map(r => r.label))];
  const base = labels[0], P = s => console.log(s);
  const by = L => rows.filter(r => r.label === L);
  P(`\n## Tong hop (${dir})\n`);
  P('| nhan | bull | lat cach thap tb/max m | lat hut | vao LAND lech ngang tb/max m | LAND tb/max s | duoi 200 m tb/max s | FIN tb/max s | duoi 50 m min / duoi 12 m max s | toc do khep max 30-12 m / <12 m m/s | treo s | con tb/min t | nghieng cham max | lac rms max 40-12 m / <12 m do | xe truot nang luc cham min m/s | vs max | miss max | RCS min kg | ban le / hong |');
  P('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const L of labels) {
    const s = summary(by(L));
    if (!s.n) { P(`| ${L} | (khong co du lieu) |`); continue; }
    P(`| ${L} | ${s.bull}/${s.n} | ${f0(s.flipDist)} / ${f0(s.flipDistMax)} | ${s.wrong} | ${f1(s.crossLand)} / ${f1(s.crossLandMax)} | ${f1(s.land)} / ${f1(s.landMax)} | ${f1(s.u200)} / ${f1(s.u200Max)} | ${f1(s.fin)} / ${f1(s.finMax)} | ${f1(s.u50Min)} / ${f1(s.u12Max)} | ${f1(s.vk30)} / ${f1(s.vk12)} | ${f1(s.hover)} | ${f1(s.fuel)} / ${f1(s.fuelMin)} | ${f2(s.tiltMax)} | ${f2(s.swayB40)} / ${f2(s.swayB12)} | ${f2(s.twVyMin)} | ${f2(s.vsMax)} | ${f2(s.missMax)} | ${f0(s.rcsMin)} | ${f2(s.hinge)} / ${f2(s.dmg)} |`);
    if (s.bull !== s.n) P(`|   | ket qua ${JSON.stringify(s.outcomes)} |`);
  }
  const WXS = [...new Set(rows.map(r => r.wx))];
  P('\n## Theo thoi tiet: LAND tb (max) s / duoi 200 m tb (max) s / con tb (min) t / bull\n');
  P('| nhan | ' + WXS.join(' | ') + ' |'); P('|---|' + WXS.map(() => '---').join('|') + '|');
  for (const L of labels) P(`| ${L} | ` + WXS.map(w => { const s = summary(by(L).filter(r => r.wx === w)); return s.n ? `${f1(s.land)} (${f1(s.landMax)}) / ${f1(s.u200)} (${f1(s.u200Max)}) / ${f1(s.fuel)} (${f1(s.fuelMin)}) / ${s.bull}/${s.n}` : '-'; }).join(' | ') + ' |');
  if (labels.length < 2) return;
  P(`\n## So tung chuyen voi "${base}" (cung seed + chuyen + dieu kien dau)\n`);
  P('| nhan | cap | lech DK dau | mat bullseye | cham hon >10 s | it nhien lieu >5 t | dLAND tb / te nhat s | d duoi200 tb / te nhat s | dNL tb / te nhat t |');
  P('|---|---|---|---|---|---|---|---|---|');
  const B = new Map(by(base).map(r => [`${r.seed}#${r.k}`, r]));
  for (const L of labels.slice(1)) {
    let n = 0, ic = 0, lost = 0, slow = 0, fuel = 0; const dL = [], dU = [], dF = [];
    for (const r of by(L)) {
      const b = B.get(`${r.seed}#${r.k}`); if (!b) continue;
      if (JSON.stringify([b.wx, b.ic]) !== JSON.stringify([r.wx, r.ic])) { ic++; continue; }
      n++;
      if (b.outcome === 'bullseye' && r.outcome !== 'bullseye') lost++;
      const l = r.landDur - b.landDur, u = r.under200 - b.under200, fu = r.propEnd - b.propEnd;
      if (l > 10) slow++; if (fu < -5) fuel++;
      dL.push(l); dU.push(u); dF.push(fu);
    }
    P(`| ${L} | ${n} | ${ic} | ${lost} | ${slow} | ${fuel} | ${f1(mean(dL))} / ${f1(mx(dL))} | ${f1(mean(dU))} / ${f1(mx(dU))} | ${f1(mean(dF))} / ${f1(mn(dF))} |`);
  }
}

/* ---------- chay nhieu seed song song ---------- */
async function runAll(label, o) {
  const seeds = String(o.seeds || SEEDS).split(',').map(s => parseInt(s, 10));
  const out = path.resolve(o.out || path.join(os.tmpdir(), 'shipeval'));
  fs.mkdirSync(out, { recursive: true });
  const jobs = Math.max(1, parseInt(o.jobs || String(Math.max(1, os.cpus().length - 1)), 10));
  const t0 = Date.now(), codes = [];
  const one = seed => new Promise(res => {
    const a = [__filename, '_seed', label, String(seed), '--out', out];
    for (const k of ['n', 'wx', 'set', 'snap-stage', 'snap-check']) if (o[k] !== undefined) a.push('--' + k, String(o[k]));
    if (o.snap) a.push('--snap', path.resolve(String(o.snap)));
    if (o['snap-trust']) a.push('--snap-trust');
    if (o.module) a.push('--module', path.resolve(o.module));
    const p = spawn(process.execPath, a, { stdio: ['ignore', 'pipe', 'inherit'] });
    let buf = '';
    p.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { if (!o.quiet) console.log(buf.slice(0, i)); buf = buf.slice(i + 1); } });
    p.on('close', code => { if (buf && !o.quiet) console.log(buf); codes.push(code); res(); });
  });
  const queue = seeds.slice();
  await Promise.all(Array.from({ length: Math.min(jobs, seeds.length) }, async () => { while (queue.length) await one(queue.shift()); }));
  const bad = codes.filter(c => c !== 0).length;
  console.log(`\nxong ${seeds.length} seed trong ${((Date.now() - t0) / 1000).toFixed(0)} s -> ${out}${bad ? ` | ${bad} tien trinh LOI` : ''}`);
  cmp(out, o.base ? [String(o.base), label] : [label]);
  if (bad) process.exitCode = 1;
}

const o = parseArgs(process.argv.slice(2));
const [cmd, ...rest] = o._;
if (cmd === 'run' && rest[0]) runAll(rest[0], o);
else if (cmd === '_seed') runSeed(rest[0], parseInt(rest[1], 10), o);
else if (cmd === 'cmp' && rest[0]) cmp(path.resolve(rest[0]), rest.slice(1));
else { console.error(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 31).join('\n')); process.exitCode = 2; }
