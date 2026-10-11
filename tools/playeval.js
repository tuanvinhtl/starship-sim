#!/usr/bin/env node
/* Doc so lieu nguoi choi tu GoatCounter va tra loi MOT cau hoi: co dang tang khong.
 *
 *   GC_SITE=starship-sim GC_TOKEN=... node tools/playeval.js [--ngay 30]
 *
 * GC_SITE la phan truoc .goatcounter.com. GC_TOKEN tao o trang Settings → API
 * cua chinh site do, chi can quyen doc thong ke.
 *
 * Khong co thu vien ngoai — fetch cua Node 18+ la du.
 *
 * MOT DIEU PHAI NOI RO VE MOI CON SO DUOI DAY: day la so da bi CHAN BOT. Bo
 * dem chay o trinh duyet nen ai bat chan quang cao la khong duoc dem. Nen
 * doc chung nhu mot CAN DUOI, va quan trong hon: chi so sanh ky nay voi ky
 * truoc khi NGUON traffic khong doi. Dan Hacker News bi chan nhieu hon dan
 * Facebook rat nhieu, nen doi kenh quang ba co the trong y het nhu doi tang
 * truong. Cot "nguon" o cuoi la de nhin ra dieu do.
 */
'use strict';

const SITE = process.env.GC_SITE || '';
const TOKEN = process.env.GC_TOKEN || '';
const argv = process.argv.slice(2);
const soNgay = (() => {
  const i = argv.indexOf('--ngay');
  const n = i >= 0 ? parseInt(argv[i + 1], 10) : 28;
  return Number.isFinite(n) && n >= 4 ? n : 28;
})();

if (!SITE || !TOKEN) {
  console.error('Thieu GC_SITE hoac GC_TOKEN.\n'
    + '  GC_SITE=<ma-site> GC_TOKEN=<token> node tools/playeval.js [--ngay 28]');
  process.exit(2);
}

/* GC_API de tro sang mot ban GoatCounter tu dung — va de chay thu bo nay
   bang mot may chu gia, khong can tai khoan that. */
const GOC = process.env.GC_API || `https://${SITE}.goatcounter.com/api/v0`;

async function api(duong, tham = {}) {
  const u = new URL(GOC + duong);
  for (const [k, v] of Object.entries(tham)) if (v !== undefined) u.searchParams.set(k, v);
  const r = await fetch(u, {
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`${r.status} ${duong} — ${t.slice(0, 200)}`);
  }
  return r.json();
}

const ngay = d => d.toISOString().slice(0, 10);
const luiNgay = n => { const d = new Date(); d.setUTCDate(d.getUTCDate() - n); return d; };
const pct = (a, b) => (b === 0 ? (a === 0 ? '—' : '+∞') : ((a - b) / b * 100).toFixed(0) + '%');

/* Cot bang chu: 8 muc do cao trong MOT dong, de doc duoc duong cong ma khong
   can mo trinh duyet. */
const KHOI = ' ▁▂▃▄▅▆▇█';
function duongCong(v) {
  const max = Math.max(1, ...v);
  return v.map(x => KHOI[Math.min(8, Math.round(x / max * 8))]).join('');
}

/* Gop `stats` cua GoatCounter (mang HitListStat) thanh map ngay -> so. */
function theoNgay(stats) {
  const m = new Map();
  for (const s of stats || []) m.set(s.day, (m.get(s.day) || 0) + (s.daily || 0));
  return m;
}
const tong = m => [...m.values()].reduce((a, b) => a + b, 0);

/* Lay cac su kien co tien to cho truoc, tra ve [ten, so] da sap xep. */
function nhom(hits, tienTo) {
  const ra = [];
  for (const h of hits) {
    if (!h.event) continue;
    const p = (h.path || '').replace(/^\//, '');
    if (!p.startsWith(tienTo + '/')) continue;
    ra.push([p.slice(tienTo.length + 1), h.count]);
  }
  return ra.sort((a, b) => b[1] - a[1]);
}

function bang(tieuDe, hang, tongSo) {
  if (!hang.length) return;
  console.log('\n' + tieuDe);
  const w = Math.max(...hang.map(h => h[0].length), 4);
  for (const [ten, n] of hang) {
    const p = tongSo > 0 ? (n / tongSo * 100).toFixed(0).padStart(3) + '%' : '   —';
    console.log('  ' + ten.padEnd(w) + '  ' + String(n).padStart(6) + '  ' + p);
  }
}

(async () => {
  const start = ngay(luiNgay(soNgay - 1));
  const end = ngay(new Date());

  const tot = await api('/stats/total', { start, end });
  const hits = await api('/stats/hits', { start, end, limit: 100, group: 'day' });

  const moi = (hits.hits || []);
  const sk = moi.filter(h => h.event);
  const trang = moi.filter(h => !h.event);

  /* DUONG CONG DUNG TU `stats` CUA TUNG DUONG DAN, khong dung /stats/total.
     Ly do: tai lieu cua GoatCounter tu mau thuan ve `total` — cho thi ghi
     "total number of visitors (including events)", cho thi ghi "total number
     of pageviews". Khong biet no la luot xem hay nguoi xem, va no gop ca su
     kien vao, nen dung no lam duong cong tang truong la tron hai don vi roi
     cong them luot bam nut vao luot ghe tham. Cong tay tung dong thi don vi
     ro rang: hang khong-phai-su-kien la LUOT XEM, hang launch la LUOT CHOI. */
  const congNgay = hang => {
    const m = new Map();
    for (const h of hang) for (const st of h.stats || [])
      m.set(st.day, (m.get(st.day) || 0) + (st.daily || 0));
    return m;
  };
  const mXem = congNgay(trang);
  const mChoi = congNgay(sk.filter(h => (h.path || '').replace(/^\//, '').startsWith('launch/')));

  /* Chuoi ngay lien tuc, ke ca ngay khong co luot nao — thieu ngay 0 thi
     duong cong noi lien hai dau va trong nhu khong he tut. */
  const chuoi = [], choi = [];
  for (let i = soNgay - 1; i >= 0; i--) {
    const d = ngay(luiNgay(i));
    chuoi.push([d, mXem.get(d) || 0]);
    choi.push(mChoi.get(d) || 0);
  }
  const so = chuoi.map(x => x[1]);

  const tuan = n => so.slice(Math.max(0, so.length - 7 * n), so.length - 7 * (n - 1))
    .reduce((a, b) => a + b, 0);
  const t1 = tuan(1), t2 = tuan(2), t3 = tuan(3), t4 = tuan(4);

  const demSk = tien => nhom(sk, tien).reduce((a, b) => a + b[1], 0);
  const soLaunch = demSk('launch'), soEnd = demSk('end');
  const xem = trang.reduce((a, b) => a + (b.count || 0), 0);

  console.log(`\nHOT STAGE — ${soNgay} ngay (${start} → ${end})  ·  site ${SITE}`);
  console.log('='.repeat(64));

  console.log(`\nLuot xem    ${String(xem).padStart(7)}   (cong tay cac duong dan khong phai su kien)`);
  console.log(`Luot choi   ${String(soLaunch).padStart(7)}   (su kien launch/*)`);
  if (moi.length >= 100) console.log('  CANH BAO: /stats/hits tra ve toi da 100 dong — con bi cat bot.');

  console.log('\nTheo ngay');
  console.log('  xem   ' + duongCong(so));
  console.log('  choi  ' + duongCong(choi));
  console.log('        ' + chuoi[0][0].slice(5)
    + ' '.repeat(Math.max(1, so.length - 10)) + chuoi[so.length - 1][0].slice(5));

  console.log('\nTuan nay so voi tuan truoc');
  console.log(`  7 ngay gan nhat   ${String(t1).padStart(6)}`);
  console.log(`  7 ngay truoc do   ${String(t2).padStart(6)}   ${pct(t1, t2)}`);
  if (soNgay >= 21) console.log(`  tuan thu 3        ${String(t3).padStart(6)}`);
  if (soNgay >= 28) console.log(`  tuan thu 4        ${String(t4).padStart(6)}`);

  /* TI LE CHOI la con so dang nhin nhat. Luot xem tang ma ti le choi tut thi
     khong phai dang lon len — la dang bi nguoi ta ghe qua roi bo di. */
  console.log('\nVao roi co choi khong');
  console.log(`  bam Phong         ${String(soLaunch).padStart(6)}`
    + (xem > 0 ? `   ${(soLaunch / xem * 100).toFixed(0)}% so luot xem` : ''));
  console.log(`  bay het chuyen    ${String(soEnd).padStart(6)}`
    + (soLaunch > 0 ? `   ${(soEnd / soLaunch * 100).toFixed(0)}% so lan phong` : ''));

  console.log(`  (API tu bao total ${tot.total || 0} / total_events ${tot.total_events || 0};`
    + ' tai lieu khong noi ro la luot hay nguoi nen khong dung lam mau so)');

  bang('Nhiem vu', nhom(sk, 'launch'), soLaunch);
  bang('Ket cuc', nhom(sk, 'end'), soEnd);
  bang('Ngon ngu (moi phien mot lan)', nhom(sk, 'lang'), demSk('lang'));

  if (trang.length) {
    bang('Trang', trang.map(h => [h.path, h.count]).slice(0, 8),
      trang.reduce((a, b) => a + b.count, 0));
  }

  /* Nguon: can de doc duong cong o tren cho dung. Tang truong tu mot cu dang
     bai len dien dan khong giong tang truong deu. */
  try {
    const refs = await api('/stats/toprefs', { start, end, limit: 10 });
    const r = (refs.stats || []).map(x => [x.name || '(truc tiep)', x.count]);
    bang('Nguon traffic', r, r.reduce((a, b) => a + b[1], 0));
  } catch (e) {
    console.log('\n(khong doc duoc nguon traffic: ' + e.message + ')');
  }

  console.log('\n' + '-'.repeat(64));
  console.log('So tren la CAN DUOI — ai chan quang cao thi khong duoc dem, va ti le');
  console.log('chan thay doi theo nguon. Chi so sanh hai ky khi nguon khong doi.');
})().catch(e => { console.error('\nLoi: ' + e.message); process.exit(1); });
