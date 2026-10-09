/* ============================================================================
   GHEP NOI — hen gap va cap tram tren quy dao.

   BA DIEU DA DO DUOC TRUOC KHI VIET, de khoi ai phai doan lai:

   1. KHONG CAN Clohessy-Wiltshire lam BO TICH PHAN. Hai vat o 420 km lech nhau
      1 cm, chay 278.472 buoc orbitStep o dt=0.02, sau tron mot vong van khop
      nghiem CW toi 7,8e-8 m huong tam. So thuc 64 bit o r=6,79e6 m phan giai
      0,9 nanomet — thua bon bac de tai hinh hoc tuong doi co centimet. Nen he
      Hill o day chi la CACH NHIN va LUAT DAN, con chuyen dong van la hai-the
      tuyet doi buoc bang chinh orbitStep cua flight.js.

   2. RCS cua ship3d KHONG day doc truc duoc: no chieu bo thanh phan doc than
      (ship3d.js:244). Ma toc do khep khi cap thi dung la doc truc. Nen o day co
      RIENG mot kenh doc — xem RCS.AX.

   3. Tren quy dao tau KHONG he co tu the: `st` co 14 truong, khong truong nao
      la goc. Mo hinh nay bo sung tu the PHANG (th, om) — du de cham lech goc khi
      cap, va dung ho 3-DOF phang giong flight.js chu khong keo ca quaternion.

   HE TOA DO: y het flight.js. Goc vi tri = atan2(x, y), tuc do tu +Y sang +X.
   Khong phu thuoc DOM. Dung chung hang so voi flight.js (truyen vao qua `F`).
   ============================================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Dock = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEG = Math.PI / 180;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

  /* --- TRAM --------------------------------------------------------------
     ISS that: 419 t, gian 109 m x 73 m, quy dao ~420 km. Trong mo hinh phang
     nay tram chi can khoi luong (de khong ai day duoc no) va mot cong cap. */
  const STN = {
    alt: 420e3,
    m: 419e3,
    len: 109, wid: 73,
    /* Cong cap quay xuong TAM TRAI DAT (huong -R). Tau bo len tu duoi — kieu
       R-bar, dung cach HTV cap that.
       LY DO chon huong nay KHONG phai vi gradient trong luc phanh tau lai — no
       lam nguoc lai: phuong trinh CW cho ddx = 3n^2 x, tau o duoi (x<0) thi bi
       day XUONG, roi xa tram. Chinh cai do moi la uu diem: TAT MAY LA TU TROI
       RA, khong dam vao tram. Doi lai phai day lien tuc de giu vi tri —
       3n^2*h, o 2 km la 7,6e-3 m/s^2 tuc ~1,5 kN, het chung 0,5 t cho ca doan
       tiep can. Bon RCS 2,4 t chiu duoc. */
    port: 11,          // m tu tam tram xuong toi mieng cong
  };

  /* --- TAU ---------------------------------------------------------------
     Lay dung hinh hoc cua ship3d de hai lo khong noi hai chuyen khac nhau. */
  /* port = 52.1 m, do tu DIEM TRANG THAI toi mieng cong, KHONG phai tu trong tam.
     Ly do: bo dung hinh dat GOC CUC BO cua than tau (y = 0, tuc day tau) vao
     dung diem trang thai; chop mui nam o y = 52.1 cuc bo. Neu o day do tu trong
     tam (30,1 m) thi lo vat ly bao hai cong da cham nhau trong khi tren man
     hinh mui tau dam xuyen qua tram dung 22 m — da do duoc dung 22,00 m. */
  const SHIP = { len: 50, dia: 9, com: 22, port: 52.1 };

  /* --- RCS ---------------------------------------------------------------
     NGANG: 73,2 kN — dung con so ship3d da dan ra tu hinh hoc voi that
     (cum mui canh tay don 22 m + cum duoi 13 m, phut cung chieu ti le 13:22
     thi mo-men triet tieu).
     DOC: ship3d khong co kenh nay. Voi doc truc tren Starship la cum dat o
     vanh mui va vanh duoi phut doc; dat 20 kN — nho hon ngang la dung, vi
     cum doc it voi hon va khong duoc phep manh bang, neu khong thi cap qua tho.
     MO-MEN: 1,61e6 N.m = rcsF*(22+13), y het CFG.rcsLim.pitch cua ship3d. */
  const RCS = {
    /* CHE DO TINH — day la muc dung khi TIEP CAN, khong phai muc ha canh.
       Ship3d co 73,2 kN ngang, nhung do la de vat mot con tau 200 t vao giua
       hai canh tay thap. Dem nguyen no sang day thi luu luong (F/Isp*g0) len
       31,7 kg/s: bon 2,4 t can trong 76 GIAY. Do duoc, va do la ly do phai co
       che do tinh rieng. Voi cap that thi nho hon nhieu — Draco cua Dragon chi
       400 N mot cai. Dat 8 kN ngang / 6 kN doc: tren tau 195 t ra 0,041 va
       0,031 m/s^2, triet mot toc do khep 0,1 m/s trong 3 giay. */
    LAT: 73.2e3,
    AX: 20e3,
    TQ: 1.2e5,
    ISP: 300,
    /* 4000 kg chu khong phai 2400. May tu cap het chung 1230 kg, tuc voi bon
       2400 thi nguoi choi gianh lai chi con ~1170 kg — giu Shift chua day mot
       phut la cạn (luu luong toan luc la 31,7 kg/s). Do duoc: 40 giay nghich
       la tau van 9,4 km va het sach khi. 4000 kg de lai ~2770 kg de lai tay,
       van la con so hop ly cho mot tau di tram. */
    TANK: 4000,        // kg — bon rieng cho hen gap, khong an vao binh chinh
  };
  /* HAI LAN TAO DAT SAI CHO NAY, ghi lai ca hai:
     Lan 1 — bung nguyen 73 kN cua ship3d vao mot bo dieu khien PD phut LIEN
     TUC: luu luong 31,7 kg/s, bon 2,4 t can trong 76 giay.
     Lan 2 — chua benh bang cach ha xuong 600 N kieu Draco. Nhung Draco la cho
     tau 12 t; Starship 195 t nang gap 16 lan. Voi 600 N, mot cu dot 0,49 m/s
     mat 195 giay, tuc gan nua chang: gia thiet "dot tuc thoi" cua CW sup, tau
     bay lech han quy dao da tinh, va lech ngang don len 153 m khong go duoc.
     Dung: giu NGUYEN muc luc that cua ship3d, nhung DOT NGAN roi THA TROI. Cu
     0,49 m/s o 0,375 m/s^2 chi mat 1,3 giay va het 30 kg. Ca chuyen tiep can
     chung 8 cu, khoang 240 kg tren bon 2,4 t. */
  /* 0,09 chu khong phai 0,30: kenh DOC TRUC chi co 20 kN, tren tau 195 t la
     0,1026 m/s^2. Lenh to hon the thi kenh doc bi kep con kenh ngang thi khong,
     va HUONG cu dot bi meo — tau bay sai quy dao da tinh. Giu duoi nguong kep
     de huong dot dung nguyen. */
  const A_LEG = 0.09;          // m/s^2 — tran khi dang dot co dich
  const A_FIN = 0.004;         // m/s^2 — tran doan khep cuoi, phai nhe

  /* --- DUNG SAI BAT MEM --------------------------------------------------
     Theo chuan IDSS that. Ra ngoai bat ky nguong nao la truot, phai lui lai. */
  const CAP = {
    vMin: 0.05, vMax: 0.10,      // m/s toc do khep
    lat: 0.10,                   // m lech ngang
    ang: 4 * DEG,                // rad lech goc
    vLat: 0.04,                  // m/s troi ngang
    wAng: 0.15 * DEG,            // rad/s toc do xoay
  };

  /* --- CAC CUA CHAN TIEP CAN --------------------------------------------
     Giong hanh trinh that cua Dragon: moi cua la mot lan dung lai giu vi tri
     roi moi di tiep. Toc do khep giam dan theo khoang cach. */
  /* Doan R-bar bat dau tu 300 m, khong phai 2 km — dung nhu HTV that. Giu vi
     tri tren R-bar ton day lien tuc 3n^2*h, nen o 2 km la 1,5 kN lien tuc, an
     het bon. Doan 2 km truoc do bay theo V-bar (dong quy dao, DUNG YEN mien
     phi — da do: lech goc tren cung quy dao thi dR = dV = 0 tuyet doi suot mot
     gio khong ton mot gam nao). */
  /* MOC TIEP CAN — do bang met DUOI TAM TRAM. Diem cap nam o 41,1 m (11 m
     cong tram + 30,1 m tu trong tam tau toi mieng cong o mui).
     Tu moc cuoi tro di thi KHEP LIEN TUC cham, vi doan do qua ngan de mot cu
     nham CW co y nghia. */
  /* DIEM CAP: bao nhieu met duoi TAM tram thi hai cong cham nhau. */
  /* `let` chu khong `const`: cung bo nay dung cho CA HAI loai muc tieu.
     · cap TRAM : 11 + 52,1 = 63,1 m
     · cap TAU  : 52,1 + 52,1 = 104,2 m — hai mui cham nhau, va vi `port` do tu
       DIEM TRANG THAI (day than) chu khong tu trong tam, nen khoang cach giua
       hai diem trang thai dung bang tong hai `port`.
     Doi qua datTam() de WP/FINAL cap lai theo — chung bam DOCK_R, dong tren da
     ghi lai lan tao doi cong cap ma quen doi moc tiep can. */
  let DOCK_R = STN.port + SHIP.port;

  /* Hai chang tho dau (1200, 600) la de di tu quy dao dong-elip 2 km duoi tram
     xuong truc R-bar. Tau khong bi tha san o 300 m — no bay toi that.
     Ba moc cuoi BAM THEO DOCK_R chu khong phai so cung: lan truoc tao doi moc
     do cong cap ma quen doi moc tiep can, doan khep cuoi bi bop tu 29 m con
     7,9 m va ca ba chuyen thu deu truot vi lech ngang. */
  let WP = [1200, 600, 300, DOCK_R + 137, DOCK_R + 77, DOCK_R + 32];
  let FINAL = DOCK_R + 32;     // m: tu day khep lien tuc
  function datTam(r) {
    DOCK_R = r;
    WP = [1200, 600, 300, r + 137, r + 77, r + 32];
    FINAL = r + 32;
    return { DOCK_R, WP: WP.slice(), FINAL };
  }
  const tamCap = () => DOCK_R;
  const V_FINAL = 0.08;        // m/s toc do khep doan cuoi — giua 0,05 va 0,10
  const CORR = 10 * DEG;         // nua goc hanh lang tiep can tu cong tram

  // ---------------------------------------------------------------------
  // HINH HOC QUY DAO
  // ---------------------------------------------------------------------

  /* Vi tri goc tren quy dao, dung dung quy uoc cua flight.js. */
  const angOf = p => Math.atan2(p.x, p.y);

  /* Truc he Hill tai mot vat: ur huong tam (len tren), ut theo chieu bay. */
  function axes(p) {
    const r = Math.hypot(p.x, p.y);
    const ur = { x: p.x / r, y: p.y / r };
    const s = Math.hypot(p.vx, p.vy) || 1;
    const ut = { x: p.vx / s, y: p.vy / s };
    return { ur, ut, r };
  }

  /* Toc do goc cua tram (dung de doi van toc quan tinh sang van toc NHIN TU
     HE QUAY). Thieu buoc nay thi o cach 200 m se thay "troi" 0,2 m/s ao. */
  const meanRate = (F, p) => {
    const r = Math.hypot(p.x, p.y);
    return Math.hypot(p.vx, p.vy) / r;
  };

  /* TRANG THAI TUONG DOI TRONG HE HILL cua tram.
       R  > 0: tau o TREN tram (xa Trai Dat hon)
       V  > 0: tau o TRUOC tram theo chieu bay
     Van toc la van toc NHIN TU HE QUAY, nen tau dung yen canh tram thi ra 0. */
  function rel(F, ship, stn) {
    const { ur, ut } = axes(stn);
    const dx = ship.x - stn.x, dy = ship.y - stn.y;
    const dvx = ship.vx - stn.vx, dvy = ship.vy - stn.vy;
    const R = dx * ur.x + dy * ur.y;
    const V = dx * ut.x + dy * ut.y;
    const n = meanRate(F, stn);
    /* Doi sang he quay: v_quay = v_quantinh - omega x dr.
       Trong he toa do nay goc TANG theo chieu bay, va ur x ut = -1, tuc vector
       quay la -n*zhat. Khai trien ra dung hai so hang duoi day. */
    const dR = (dvx * ur.x + dvy * ur.y) + n * V;
    const dV = (dvx * ut.x + dvy * ut.y) - n * R;
    return { R, V, dR, dV, range: Math.hypot(R, V), rate: Math.hypot(dR, dV) };
  }

  /* Doi mot vector he Hill nguoc ve he quan tinh (dung khi ap luc RCS). */
  function toWorld(stn, aR, aV) {
    const { ur, ut } = axes(stn);
    return { x: aR * ur.x + aV * ut.x, y: aR * ur.y + aV * ut.y };
  }

  /* Hai cu dot Hohmann tu ban kinh r1 len r2. */
  function hohmann(F, r1, r2) {
    const a = (r1 + r2) / 2;
    const v1 = Math.sqrt(F.MU / r1), v2 = Math.sqrt(F.MU / r2);
    const vp = Math.sqrt(F.MU * (2 / r1 - 1 / a)), va = Math.sqrt(F.MU * (2 / r2 - 1 / a));
    return { dv1: vp - v1, dv2: v2 - va, t: Math.PI * Math.sqrt(a * a * a / F.MU), a };
  }

  /* GOC PHA CAN THIET luc chau ngoi dot 1: trong thoi gian tau bay nua elip,
     tram di duoc bao nhieu do. Tau di dung 180 do. */
  function leadNeeded(F, r1, r2, rStn) {
    const h = hohmann(F, r1, r2);                       // r2 = ban kinh DICH cua tau
    const rs = rStn || r2;
    const nT = Math.sqrt(F.MU / (rs * rs * rs));        // toc do goc cua TRAM
    return Math.PI - nT * h.t;                          // rad, tram phai DAN TRUOC tau
  }

  /* Goc tram dang dan truoc tau, quy ve (-pi, pi]. */
  function leadNow(ship, stn) {
    let d = angOf(stn) - angOf(ship);
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d <= -Math.PI) d += 2 * Math.PI;
    return d;
  }

  /* CON BAO LAU NUA TOI CUA SO. Tau o duoi quay nhanh hon nen goc dan cua tram
     GIAM dan; doi toi khi no bang goc can. */
  function windowIn(F, ship, stn, rTgt) {
    const rStn = Math.hypot(stn.x, stn.y);
    const r1 = Math.hypot(ship.x, ship.y), r2 = rTgt || rStn;
    const need = leadNeeded(F, r1, r2, rStn);
    const now = leadNow(ship, stn);
    const n1 = Math.sqrt(F.MU / (r1 * r1 * r1)), n2 = Math.sqrt(F.MU / (rStn * rStn * rStn));
    const drift = n2 - n1;                              // < 0: goc dan dang giam
    let d = now - need;
    if (drift === 0) return { need, now, wait: Infinity, orbits: Infinity };
    // doi cho toi lan TIEP THEO goc dan cham dung tri can
    let wait = d / -drift;
    const syn = 2 * Math.PI / Math.abs(drift);
    while (wait < 0) wait += syn;
    return { need, now, wait, syn, orbits: wait / (2 * Math.PI / n1) };
  }

  /* Cu dot doc chieu bay, an binh chinh. dv > 0 la xuoi chieu (nang quy dao). */
  function burn(F, s, dv) {
    const sp = Math.hypot(s.vx, s.vy);
    if (!sp) return { ok: false, dv: 0, used: 0 };
    /* Qua F.m2 chu khong go lai cong thuc: ban TAU CHO nhe hon 5 t, go tay o
       day la moi cu dot chuyen quy dao bi tinh nang len 5 t. */
    const m = F.m2(s);
    const dm = m * (1 - Math.exp(-Math.abs(dv) / (F.VEH.s2.vac.isp * F.G0)));
    if (dm >= s.prop2) return { ok: false, dv, need: dm / 1000, have: s.prop2 / 1000 };
    const k = dv / sp;
    s.vx *= 1 + k; s.vy *= 1 + k;
    s.prop2 -= dm;
    s.m = F.m2(s);
    return { ok: true, dv, used: dm / 1000 };
  }

  // ---------------------------------------------------------------------
  // MO HINH GHEP NOI
  // ---------------------------------------------------------------------

  /* Dung mot chuyen hen gap. `ship` la st cua flight.js (se duoc SAO CHEP, khong
     sua truc tiep), `lead0` la goc tram dan truoc tau luc bat dau, tinh bang rad. */
  function make(F, ship, opt) {
    opt = opt || {};
    const alt = opt.alt || STN.alt;
    const rS = F.RE + alt;
    const vS = Math.sqrt(F.MU / rS);
    const a0 = angOf(ship) + (opt.lead0 !== undefined ? opt.lead0 : 0.6);
    /* `tgt` = trang thai muc tieu do NGUOI GOI dua vao (cap tau-voi-tau: chinh
       `st` cua con tau dang o tren quy dao). Khong co thi dung mot tram gia o
       quy dao tron nhu cu. `m` bat buoc phai co: phep tron dong luong luc bat
       mem doc no, va mot muc tieu 212 t khac han mot tram 419 t. */
    const stn = opt.tgt || {
      x: rS * Math.sin(a0), y: rS * Math.cos(a0),
      vx: vS * Math.cos(a0), vy: -vS * Math.sin(a0), t: 0,
    };
    if (stn.m === undefined) stn.m = STN.m;
    datTam(opt.tgtShip ? 2 * SHIP.port : STN.port + SHIP.port);
    /* DUNG TRUC TIEP doi tuong duoc truyen vao, KHONG sao chep. Lop game lay
       `st` lam trang thai goc cho ca HUD, telemetry va bo tinh quy dao; neu o
       day giu mot ban sao thi hai ben se lech nhau ngay sau cu dot dau tien.
       Chi bo sung ba truong con thieu: tu the phang va bon RCS. */
    const s = ship;
    if (s.th === undefined) s.th = Math.atan2(ship.vx, ship.vy);
    if (s.om === undefined) s.om = 0;
    if (s.rcs === undefined) s.rcs = RCS.TANK;
    return {
      F, s, stn, alt, tgtShip: !!opt.tgtShip,
      phase: 'PHASING',
      t: 0, gate: 0, hold: 0, dv1: 0, dv2: 0, tTrans: 0,
      captured: false, fail: null, why: null, tries: 0,
      log: [],
    };
  }

  /* ==================== NHAM THEO CW ====================
     Day la cho tao da lam sai mot lan, ghi lai de khong ai lam lai:
     ban dau tao dieu khien hai truc R va V bang hai vong PD doc lap. Chay ra
     tau bam duoc do cao nhung TROI DOC DUONG BAY 0,05 m/s ma lenh -2e-3 m/s^2
     phat lien tuc khong he chan lai duoc. Khong phai loi ma — la co hoc quy
     dao: phuong trinh CW cho ddy = -2n*dx, nen day DOC DUONG BAY khong sinh
     gia toc doc duong bay, no sinh VAN TOC HUONG TAM (trang thai dung: dx =
     a_y/2n). Muon lui lai phia sau thi phai DOI DO CAO cho doi chu ky.
     Nen o day dung dung cach tau that lam: giai bai toan hai diem bang ma tran
     chuyen trang thai CW, ra mot cu dot co dich, roi tha troi.

     Phi(t) tach thanh bon khoi 2x2, voi s = sin(nt), c = cos(nt). */
  function cwPhi(n, t) {
    const s = Math.sin(n * t), c = Math.cos(n * t), nt = n * t;
    return {
      rr: [[4 - 3 * c, 0], [6 * (s - nt), 1]],
      rv: [[s / n, 2 * (1 - c) / n], [-2 * (1 - c) / n, (4 * s - 3 * nt) / n]],
      vr: [[3 * n * s, 0], [-6 * n * (1 - c), 0]],
      vv: [[c, 2 * s], [-2 * s, 4 * c - 3]],
    };
  }

  /* Van toc CAN CO ngay bay gio de sau T giay toi dung diem rT.
     v0 = Phi_rv^-1 * (rT - Phi_rr * r0).  Tra null neu Phi_rv suy bien. */
  function cwAim(n, r0, v0, rT, T) {
    const P = cwPhi(n, T);
    const bx = rT[0] - (P.rr[0][0] * r0[0] + P.rr[0][1] * r0[1]);
    const by = rT[1] - (P.rr[1][0] * r0[0] + P.rr[1][1] * r0[1]);
    const a = P.rv[0][0], b = P.rv[0][1], cc = P.rv[1][0], dd = P.rv[1][1];
    const det = a * dd - b * cc;
    if (Math.abs(det) < 1e-12) return null;
    const vx = (dd * bx - b * by) / det;
    const vy = (-cc * bx + a * by) / det;
    return { dvR: vx - v0[0], dvV: vy - v0[1], vR: vx, vV: vy };
  }

  /* RK4 hai-the CONG gia toc ngoai khong doi. Khi ax=ay=0 phai ra dung y het
     F.orbitStep — da kiem trung tung bit. */
  function rk4(p, dt, MU, ax, ay) {
    const f = q => { const r = Math.hypot(q.x, q.y), g = MU / (r * r);
                     return [q.vx, q.vy, -g * q.x / r + ax, -g * q.y / r + ay]; };
    const adv = (q, k, h) => ({ x: q.x + k[0]*h, y: q.y + k[1]*h, vx: q.vx + k[2]*h, vy: q.vy + k[3]*h });
    const k1 = f(p), k2 = f(adv(p,k1,dt/2)), k3 = f(adv(p,k2,dt/2)), k4 = f(adv(p,k3,dt));
    p.x  += dt/6*(k1[0]+2*k2[0]+2*k3[0]+k4[0]);
    p.y  += dt/6*(k1[1]+2*k2[1]+2*k3[1]+k4[1]);
    p.vx += dt/6*(k1[2]+2*k2[2]+2*k3[2]+k4[2]);
    p.vy += dt/6*(k1[3]+2*k2[3]+2*k3[3]+k4[3]);
    if (p.t !== undefined) p.t += dt;
  }

  /* Huong cong cap cua tram trong he Hill: quay XUONG (-R). Tau phai nam duoi
     tram, mui chi LEN (+R), tuc nguoc huong cong. */
  const portDir = () => ({ R: -1, V: 0 });

  /* Diem dich cua mui tau: ngay duoi cong tram mot doan bang tam voi. */
  function aimPoint(d) {
    return { R: -DOCK_R, V: 0 };
  }

  /* Lech goc giua mui tau va truc hanh lang. Truc hanh lang huong LEN (+R),
     nen goc mong muon cua mui tau la huong +R tai vi tri tram. */
  function axisErr(d) {
    const { ur } = axes(d.stn);
    const want = Math.atan2(ur.x, ur.y);        // huong +R, quy uoc goc vi tri
    let e = d.s.th - want;
    while (e > Math.PI) e -= 2 * Math.PI;
    while (e <= -Math.PI) e += 2 * Math.PI;
    return e;
  }

  /* TRANG THAI DAY DU cho HUD va cho bo cham diem. */
  function tel(d) {
    const r = rel(d.F, d.s, d.stn);
    const aim = aimPoint(d);
    const dR = r.R - aim.R, dV = r.V - aim.V;
    return {
      phase: d.phase, t: d.t,
      R: r.R, V: r.V, dR: r.dR, dV: r.dV,
      range: Math.hypot(dR, dV),          // toi DIEM CAP, khong phai toi tam tram
      /* Toc do khep = hinh chieu van toc tuong doi len duong noi toi DIEM CAP.
         Truoc day tao lay -dR, sai dau va chi dung khi tau nam dung truc. */
      closing: Math.hypot(dR, dV) > 1e-9
               ? -(dR * r.dR + dV * r.dV) / Math.hypot(dR, dV) : -r.dR,
      drift: r.dV,                        // troi ngang
      lat: Math.abs(dV), latS: dV,        // lech ngang so voi truc hanh lang (latS co dau)
      ang: axisErr(d), om: d.s.om,
      rcs: d.s.rcs, rcsFrac: d.s.rcs / RCS.TANK,
      gate: d.gate, captured: d.captured, why: d.why,
      lead: leadNow(d.s, d.stn),
    };
  }

  /* KIEM DUNG SAI BAT MEM. Tra ve null neu dat, hoac ly do truot. */
  function capCheck(t) {
    if (t.closing < CAP.vMin) return 'cham qua — khong bat duoc chot';
    if (t.closing > CAP.vMax) return 'nhanh qua — gay co cau bat';
    if (t.lat > CAP.lat) return 'lech ngang qua';
    if (Math.abs(t.ang) > CAP.ang) return 'lech goc qua';
    if (Math.abs(t.drift) > CAP.vLat) return 'troi ngang qua';
    if (Math.abs(t.om) > CAP.wAng) return 'dang xoay qua nhanh';
    return null;
  }

  /* LUAT DAN TU DONG. Tra ve lenh {aR, aV, tq} — gia toc mong muon trong he
     Hill va mo-men mong muon. Nguoi choi cuop can thi game tu dat cmd khac. */
  /* LUAT DAN: VAN TOC CON PHAI DAT, tinh lai moi buoc bang ma tran CW.
     Moi chang co mot moc va mot HAN GIO toi. Moi buoc hoi ma tran CW xem "de
     toi moc do dung han thi ngay bay gio van toc phai la bao nhieu", lay hieu
     voi van toc that, roi triet hieu do bang mot hang so thoi gian. Cach nay tu
     sua sai va khong phai ghi so tung cu dot — dung kieu dan vong kin that. */
  function auto(d) {
    const t = tel(d), aim = aimPoint(d);
    const n = meanRate(d.F, d.stn);
    const below = -t.R;                       // dang o bao nhieu met duoi tam tram

    /* Tu the: giu mui doc truc hanh lang. Truc do QUAY theo tram voi toc do n,
       nen phai bu san om = n; thieu cai bu nay thi bo P dung lai o mot sai so
       co dinh (do duoc: -4,31 do, tuc vua du truot nguong 4 do cua IDSS). */
    const Ip = (d.s.m || 200e3) * (SHIP.len * SHIP.len / 12 + (SHIP.dia / 2) * (SHIP.dia / 2) / 4);
    const aMaxAng = RCS.TQ / Ip, wn = 0.03;
    const tq = clamp((-wn * wn * t.ang - 2 * wn * (t.om - n)) / aMaxAng, -1, 1);

    // ---- doan cuoi: khep cham, khong nham CW nua ----
    if (below <= FINAL + 1) {
      const eR = t.R - aim.R;                 // am khi con o duoi diem cap
      const vT = (eR < 0 ? 1 : -1) * Math.min(V_FINAL,
                 Math.sqrt(2 * A_FIN * 0.3 * Math.abs(eR) + 1e-12) + 0.004);
      const aR = clamp((vT - t.dR) * 0.05 - 3 * n * n * t.R, -A_FIN, A_FIN);
      const aV = clamp(-t.V * 0.0008 - t.dV * 0.05 + 2 * n * t.dR, -A_FIN, A_FIN);
      return { aR, aV, tq };
    }

    /* ---- CAC CHANG MOC: dot - tha troi - phanh ----
       Truoc day tao giai CW lai MOI BUOC roi bam theo van toc can co. Nghe hay
       nhung mat on dinh: khi T tien ve 0 thi Phi_rv suy bien, van toc can co
       vot len vo cuc, bo dieu khien vat lon va ban tau lech 151 m ngang. Tau
       that khong lam the — giai MOT LAN, dot ngan, tha troi het chang, roi
       phanh. Dung nhu vay o day. */
    if (!d.leg || d.leg.done) {
      /* Moc phai TIEN MOT CHIEU. Truoc day moi lan lap ke hoach lai suy moc tu
         vi tri hien tai — thanh ra khi tau dung ngay TAI mot moc thi no dao
         quanh bien: do 1202 m thi chon lai chinh moc 1200, do 1193 m thi chon
         moc 600, cu the nhay qua nhay lai. Do duoc: tau ket o 1200 m suot
         5.000 giay, dot 135 kg moi 400 giay, khong bao gio di tiep. Nay giu
         mot CHI SO moc, chi tang; chi suy lai tu vi tri khi ke hoach bi xoa tu
         ben ngoai (nguoi choi tra lai can). */
      if (d.wp === undefined || !d.leg) {
        d.wp = 0;
        while (d.wp < WP.length && below <= WP[d.wp] + 1.5) d.wp++;
      } else d.wp++;
      const tgt = d.wp < WP.length ? WP[d.wp] : FINAL;
      const T = clamp(Math.max(1, below - tgt) / 0.3, 200, 1200);
      const g = cwAim(n, [t.R, t.V], [t.dR, t.dV], [-tgt, 0], T);
      if (!g) return { aR: 0, aV: 0, tq };
      const mag = Math.hypot(g.dvR, g.dvV) || 1e-12;
      d.leg = { tgt, t0: d.t, tEnd: d.t + T, acc: 0,
                uR: g.dvR / mag, uV: g.dvV / mag, mag, done: false };
    }
    /* Dem XUNG DA GIAO THAT (step cong don vao d.leg.acc) chu khong bam gio.
       Bam gio thi sai: lenh nam chu yeu doc truc, ma kenh doc bi kep 20 kN, nen
       het gio moi giao duoc mot phan ba xung — tau troi mat. */
    if (d.leg.acc < d.leg.mag) return { aR: d.leg.uR * A_LEG, aV: d.leg.uV * A_LEG, tq };
    if (d.t < d.leg.tEnd) return { aR: 0, aV: 0, tq };      // tha troi, khong dung mot gam nao
    /* Toi han: PHANH VA GIU. Phai co hai so hang bu, vi dung yen canh tram
       KHONG phai trang thai can bang: lech huong tam thi luc thuy trieu keo di
       (3n^2 R), va moi chuyen dong huong tam lai de ra Coriolis (-2n dR). Ban
       truoc tao chi phanh van toc ve 0 ma khong bu, nen tau troi, bo phanh duoi
       mai, het bon 2,4 t roi bay mat 132 km. */
    if (!d.leg.tBrake) d.leg.tBrake = d.t;
    const hR = clamp(-t.dR * 0.3 - (t.R + d.leg.tgt) * 0.002 - 3 * n * n * t.R, -A_LEG, A_LEG);
    const hV = clamp(-t.dV * 0.3 + 2 * n * t.dR, -A_LEG, A_LEG);
    /* Xong khi da dung yen, HOAC het 150 giay phanh — khong de ket mai o mot
       chang: sai so con lai de cu nham CW cua chang sau don. */
    if (Math.hypot(t.dR, t.dV) < 0.004 || d.t - d.leg.tBrake > 150) d.leg.done = true;
    return { aR: hR, aV: hV, tq };
  }



  /* LENH ON DINH: triet van toc tuong doi va dua mui ve truc hanh lang, KHONG
     nham di dau ca. Lop game goi cai nay MOT KHOANG NGAN sau khi nguoi choi tra
     lai can.
     Vi sao khong nhet thang vao auto(): da thu, va hong. Dat nguong "dang troi
     nhanh thi triet truoc" ngay trong auto() thi nguong do roi vao dung dai toc
     do binh thuong sau moi cu dot — bo dan giang co giua triet va nham, dung li
     o moc 1200 m suot 10.000 giay roi dot sach ca bon 4 t. Tach han ra, va do
     bang THOI GIAN chu khong bang nguong toc do, thi khong con cho nao de thrash. */
  function holdCmd(d) {
    const t = tel(d), n = meanRate(d.F, d.stn);
    const Ip = (d.s.m || 200e3) * (SHIP.len * SHIP.len / 12 + (SHIP.dia / 2) * (SHIP.dia / 2) / 4);
    const wn = 0.03;
    const tq = clamp((-wn * wn * t.ang - 2 * wn * (t.om - n)) / (RCS.TQ / Ip), -1, 1);
    return { aR: clamp(-t.dR * 0.3 - 3 * n * n * t.R, -A_LEG, A_LEG),
             aV: clamp(-t.dV * 0.3 + 2 * n * t.dR, -A_LEG, A_LEG), tq };
  }

  /* MOT BUOC. cmd = {aR, aV, tq} hoac null de dung luat tu dong. */
  function step(d, dt, cmd) {
    const F = d.F;
    d.t += dt;

    if (d.phase === 'PHASING' || d.phase === 'TRANSFER' || d.phase === 'COELLIP' || d.phase === 'DONE') {
      F.orbitStep(d.stn, dt);
      F.orbitStep(d.s, dt);
      d.s.th = Math.atan2(d.s.vx, d.s.vy);        // chua dieu khien tu the: chi mui theo huong bay
      d.rcsB = { ax: 0, lat: 0, tq: 0 };
      return;
    }
    if (d.phase === 'DOCKED') {
      F.orbitStep(d.stn, dt);
      /* Gan CUNG voi tram, nhung phai giu dung khoang cach cap — de trung tam
         tram thi tren hinh tau chui vao giua gian truss. */
      const A = axes(d.stn), h = DOCK_R;
      d.s.x = d.stn.x - A.ur.x * h; d.s.y = d.stn.y - A.ur.y * h;
      d.s.vx = d.stn.vx; d.s.vy = d.stn.vy;
      d.s.th = Math.atan2(A.ur.x, A.ur.y); d.s.om = 0;
      d.rcsB = { ax: 0, lat: 0, tq: 0 };
      return;
    }

    /* --- APPROACH / DOCK / UNDOCK: co dieu khien ---
       LUAT DAN PHAI DOC TRANG THAI DAU BUOC, tuc TRUOC khi buoc tram. Ban dau
       tao buoc tram ngay dau ham roi moi goi auto(): bo dan nhin thay tau o
       buoc cu doi chieu voi tram da tien mot buoc. Mot buoc cua tram la
       7666 m/s * 0,02 s = 153 m — dung bang do lech ngang 153 m da am anh moi
       ban thu truoc do. Tu day: tinh lenh truoc, buoc ca hai sau. */
    const c = cmd || auto(d);
    F.orbitStep(d.stn, dt);
    const m = d.s.m || 200e3;

    /* Kep theo LUC THAT co duoc, khong phai theo gia toc muon co. Day la cho
       de noi doi nhat: neu cho phep gia toc tuy y thi cap luc nao cung ngot. */
    const nose = { x: Math.sin(d.s.th), y: Math.cos(d.s.th) };
    const left = { x: Math.cos(d.s.th), y: -Math.sin(d.s.th) };
    /* c.body = lenh cho theo HE THAN TAU (doc truc / ngang than) thay vi he
       Hill. Nguoi choi nghi theo than tau — "day toi", "dat sang phai" — chu
       khong nghi theo huong tam va chieu bay. */
    let w = c.body
      ? { x: nose.x * c.ax + left.x * c.lat, y: nose.y * c.ax + left.y * c.lat }
      : toWorld(d.stn, c.aR, c.aV);
    const along = w.x * nose.x + w.y * nose.y;
    const perpX = w.x - along * nose.x, perpY = w.y - along * nose.y;
    const perp = Math.hypot(perpX, perpY);
    const fAx = clamp(along * m, -RCS.AX, RCS.AX);
    const fLat = Math.min(perp * m, RCS.LAT);
    const px = perp > 1e-9 ? perpX / perp : 0, py = perp > 1e-9 ? perpY / perp : 0;

    let ax = (fAx * nose.x + fLat * px) / m;
    let ay = (fAx * nose.y + fLat * py) / m;

    // het khi RCS thi khong day duoc nua
    if (d.s.rcs <= 0) { ax = 0; ay = 0; }

    /* CHOT LAI luc dang phut, quy ve HE THAN TAU, de lop game con biet ma ve tia
       lua. Thieu cho nay thi tau truot vao vi tri trong im lang tuyet doi: lo
       vat ly dot het 1,2 tan khi ma tren man hinh khong mot voi nao sang. */
    const lx = Math.cos(d.s.th), ly = -Math.sin(d.s.th);      // truc ngang cua than
    d.rcsB = d.s.rcs > 0
      ? { ax: fAx / RCS.AX, lat: fLat * (px * lx + py * ly) / RCS.LAT, tq: clamp(c.tq || 0, -1, 1) }
      : { ax: 0, lat: 0, tq: 0 };
    if (d.leg && !d.leg.done) d.leg.acc = (d.leg.acc || 0) + Math.hypot(ax, ay) * dt;

    /* PHAI dung DUNG bo tich phan cua tram, neu khong hai ben lech nhau mot
       cach GIA TAO. Do duoc: tau buoc Euler nua-an con tram buoc RK4, cung mot
       quy dao khong luc day, sau 60 s da troi 5,2 m va sau 15 phut 97 m — du
       pha nat moi dung sai cap 10 cm. Nen o day la RK4 y het orbitStep, chi
       cong them gia toc RCS coi nhu hang so trong mot buoc. */
    rk4(d.s, dt, F.MU, ax, ay);

    // tu the
    const Ip = m * (SHIP.len * SHIP.len / 12 + (SHIP.dia / 2) * (SHIP.dia / 2) / 4);
    const tq = clamp(c.tq || 0, -1, 1) * RCS.TQ;
    d.s.om += (d.s.rcs > 0 ? tq / Ip : 0) * dt;
    d.s.th += d.s.om * dt;

    // ton khi RCS
    const used = (Math.abs(fAx) + fLat) / (RCS.ISP * F.G0) * dt
               + Math.abs(tq) / (RCS.ISP * F.G0 * 20) * dt;
    d.s.rcs = Math.max(0, d.s.rcs - used);

    // --- kiem cham ---
    const t = tel(d);
    if (d.phase !== 'UNDOCK' && t.range < 0.35) {
      const why = capCheck(t);
      if (why) { d.fail = why; d.why = why; d.tries++; d.phase = 'APPROACH'; backOff(d); }
      else {
        /* TRON DONG LUONG. Truoc day doan DOCKED gan cung `d.s.vx = d.stn.vx`,
           tuc coi muc tieu NANG VO HAN. Dung cho tram 419 t (tau 212 t lam no
           doi 0,03 m/s, duoi nguong do), SAI cho hai tau cung co: mot cu khep
           0,06 m/s phai thanh 0,03 m/s cho CA HAI, khong phai tau dung lai con
           muc tieu khong he nhuc nhich.
           Bao toan dong luong, roi tu day hai than di cung mot quy dao. */
        const m1 = d.s.m || 200e3, m2m = d.stn.m || STN.m, M = m1 + m2m;
        const vx = (m1 * d.s.vx + m2m * d.stn.vx) / M;
        const vy = (m1 * d.s.vy + m2m * d.stn.vy) / M;
        d.vKhep = Math.hypot(d.s.vx - d.stn.vx, d.s.vy - d.stn.vy);
        d.s.vx = d.stn.vx = vx; d.s.vy = d.stn.vy = vy;
        d.captured = true; d.phase = 'DOCKED'; d.why = null;
      }
    }
  }

  /* Truot thi day nguoc ra 40 m roi lam lai — dung nhu quy trinh that. */
  function backOff(d) {
    placeBelow(d, DOCK_R + 40);
    d.s.om = 0;
  }

  /* Dat tau vao dau doan tiep can (dung khi da chuyen tiep xong, hoac de cham
     diem rieng doan cap ma khong phai bay lai ca chuyen). */
  function toApproach(d, dist) {
    const dd = dist === undefined ? 2000 : dist;
    placeBelow(d, dd);
    d.s.th = Math.atan2(axes(d.stn).ur.x, axes(d.stn).ur.y); d.s.om = 0;
    d.phase = 'APPROACH';
  }

  /* Dat tau thang duoi tram mot doan h VA DUNG YEN TRONG HE HILL.
     Cho de sai nhat ca mo hinh: cho van toc bang van toc tram thi tau KHONG
     dung yen — no co san +n*h troi doc duong bay (o 2 km la 2,26 m/s), du de
     keo tau ra khoi truc hanh lang va dot sach bon RCS. Muon dung yen thi phai
     di CHAM hon tram dung n*h, vi no o ban kinh nho hon ma phai quay cung toc
     do goc. */
  function placeBelow(d, h) {
    const { ur, ut } = axes(d.stn);
    const n = meanRate(d.F, d.stn);
    d.s.x = d.stn.x - ur.x * h; d.s.y = d.stn.y - ur.y * h;
    d.s.vx = d.stn.vx - ut.x * n * h;
    d.s.vy = d.stn.vy - ut.y * n * h;
  }

  return {
    STN, SHIP, RCS, CAP, V_FINAL, CORR, DEG, A_LEG, A_FIN,
    datTam, tamCap,
    get WP() { return WP.slice(); }, get FINAL() { return FINAL; },
    angOf, axes, rel, toWorld, hohmann, leadNeeded, leadNow, windowIn, burn,
    cwPhi, cwAim, meanRate, holdCmd,
    make, step, auto, tel, capCheck, aimPoint, axisErr, toApproach, backOff,
  };
});
