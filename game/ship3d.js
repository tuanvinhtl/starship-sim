/* ============================================================================
   SHIP 3D — dong luc hoc vat ran day du cho pha tau quay ve.
   Khac han lo 2D: tu the la QUATERNION, van toc goc la vector 3 chieu, va bon
   flap dieu khien DOC LAP. Nho vay co ROLL — thu ma mo hinh 2D khong the co,
   va la ly do that su khien bon canh cua Starship vung lech nhau.
   Dung chung hang so / khi quyen voi flight.js (truyen vao qua `F`).
   ==========================================================================*/
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Ship3D = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- vector 3 ---------- */
  const V = (x, y, z) => ({ x: x || 0, y: y || 0, z: z || 0 });
  const vadd = (a, b) => V(a.x + b.x, a.y + b.y, a.z + b.z);
  const vsub = (a, b) => V(a.x - b.x, a.y - b.y, a.z - b.z);
  const vmul = (a, s) => V(a.x * s, a.y * s, a.z * s);
  const vdot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  const vcross = (a, b) => V(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
  const vlen = a => Math.sqrt(vdot(a, a));
  const vnorm = a => { const l = vlen(a); return l > 1e-12 ? vmul(a, 1 / l) : V(0, 1, 0); };
  const vcopy = a => V(a.x, a.y, a.z);

  /* ---------- quaternion (w,x,y,z), quay tu BODY sang WORLD ---------- */
  const Q = (w, x, y, z) => ({ w, x, y, z });
  function qmul(a, b) {
    return Q(a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
             a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
             a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
             a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w);
  }
  function qnorm(q) {
    const l = Math.sqrt(q.w * q.w + q.x * q.x + q.y * q.y + q.z * q.z) || 1;
    return Q(q.w / l, q.x / l, q.y / l, q.z / l);
  }
  const qconj = q => Q(q.w, -q.x, -q.y, -q.z);
  function qrot(q, v) {                       // body -> world
    const t = vmul(vcross(V(q.x, q.y, q.z), v), 2);
    return vadd(vadd(v, vmul(t, q.w)), vcross(V(q.x, q.y, q.z), t));
  }
  const qrotInv = (q, v) => qrot(qconj(q), v);
  function qAxisAngle(axis, ang) {
    const a = vnorm(axis), s = Math.sin(ang / 2);
    return Q(Math.cos(ang / 2), a.x * s, a.y * s, a.z * s);
  }
  /* Quaternion quay vector `from` sang `to` (ca hai da chuan hoa). */
  function qBetween(from, to) {
    const d = vdot(from, to);
    if (d > 0.999999) return Q(1, 0, 0, 0);
    if (d < -0.999999) {
      let ax = vcross(V(1, 0, 0), from);
      if (vlen(ax) < 1e-6) ax = vcross(V(0, 0, 1), from);
      return qAxisAngle(ax, Math.PI);
    }
    const c = vcross(from, to);
    return qnorm(Q(1 + d, c.x, c.y, c.z));
  }
  function qIntegrate(q, w, dt) {             // w trong he BODY
    const dq = qmul(q, Q(0, w.x * dt / 2, w.y * dt / 2, w.z * dt / 2));
    return qnorm(Q(q.w + dq.w, q.x + dq.x, q.y + dq.y, q.z + dq.z));
  }

  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

  /* ---------- cau hinh tau ----------
     He BODY:  +Y = mui (truc day),  +X = BUNG (chan nhiet),  +Z = suon phai. */
  const CFG = {
    len: 50, dia: 9, com: 22,
    aBase: Math.PI * 4.5 * 4.5, aSide: 50 * 9,
    cdAx: 0.9, cdBroad: 1.30,
    sFlap: 15, cdFlap: 1.25,          // m2 moi canh
    /* ===== CUM VOI KHI NONG =====
       Truoc day mo hinh cho CUNG mot mo-men 1.6 MN.m quanh CA BA TRUC. Sai ve
       hinh hoc: voi chuc-ngua/dao-huong nam o mui va o duoi, canh tay don toi
       trong tam la 22 m va 13 m; con muon XOAY DOC than thi luc chi tac dung
       tren BAN KINH THAN 4.5 m. Cho bang nhau la cho khong 5 lan.
       Gio tinh tu hinh hoc that:
         · Cum MUI  (y=44) va cum DUOI (y=9): phut HUONG TAM -> chuc ngua, dao huong
         · 4 voi VAT TIEP TUYEN tren than (y=30, ban kinh 4.5): chi de XOAY DOC
       Chinh 4 voi vat do la thu cho phep tau tu chinh phuong bung khi tiep can
       thap — khong co chung thi mo-men xoay doc gan nhu bang khong. */
    rcsF: 46e3,                        // N moi cum (gop nhieu voi nho)
    rcsPorts: {
      nose: { y: 44, n: 4 },           // canh tay don 22 m
      aft:  { y:  9, n: 4 },           // canh tay don 13 m
      roll: { y: 30, n: 4, cant: 1 },  // vat tiep tuyen tren ban kinh 4.5 m
    },
    rcsTank: 900, rcsFlow: 6,
    gimbal: 15 * Math.PI / 180,
    // 4 flap: goc quanh truc than tinh tu +X(bung), va vi tri doc than
    flaps: [
      { name: 'FL', th:  110 * Math.PI / 180, y: 36.5, fore: 1, right:  1 },
      { name: 'FR', th: -110 * Math.PI / 180, y: 36.5, fore: 1, right: -1 },
      { name: 'AL', th:  100 * Math.PI / 180, y:  6.0, fore: -1, right:  1 },
      { name: 'AR', th: -100 * Math.PI / 180, y:  6.0, fore: -1, right: -1 },
    ],
  };
  /* ===================== NHIET TAI NHAP =====================
     Truoc day khong he co mo hinh nhiet: gach chan nhiet chi la texture, tau
     bay xuyen 7800 m/s ma khong nong len ti nao. Gio dat that.

     Dong nhiet diem dung theo Sutton-Graves: q = k*sqrt(rho/Rn)*v^3.
     Nhiet do be mat can bang khi hap thu = buc xa: eps*sigma*T^4 = q_hap_thu,
     nen tich phan  C*dT/dt = q_hap_thu - eps*sigma*(T^4 - T_moi_truong^4).

     Ba vung, ba so phan khac nhau:
     · BUNG co gach: gach cach nhiet nen phan lon nhiet buc xa lai ra ngoai,
       chi mot phan nho ngam vao. Chiu duoc toi ~1600 K.
     · LUNG tran thep: khong co gi che. Thep 304L mat ben o ~1300 K va chay o
       ~1700 K. Bay dung the bung-truoc thi lung nam trong bong khi dong nen
       gan nhu khong an nhiet — bay sai the thi no an tron.
     · KHE BAN LE FLAP: cho dut quang cua lop gach. Be flap cang nhieu thi khe
       ha cang rong va dong khi nong luon vao cang manh. Day dung la cho chay
       thung tren chuyen bay that.                                          */
  /* Phuong vi chot nang so voi bung. Chi con dung de doc: truc noi hai chot
     la +Z cua than voi MOI gia tri AZ, nen ca dan huong lan cham diem deu lay
     thang V(0,0,1). Hinh 3D van dat chot theo dung goc nay. */
  const PIN_AZ = 110 * Math.PI / 180;
  const SG_K = 1.7415e-4;          // he so Sutton-Graves (SI)
  const R_NOSE = 4.5;              // ban kinh mui hieu dung (m)
  const SIGMA = 5.670374e-8;
  const T_AMB = 250;
  const C_TILE = 5.2e4;            // nhiet dung rieng be mat gach (J/m2/K)
  const C_SKIN = 2.6e4;            // vo thep mong -> nong nhanh gap doi
  const C_HINGE = 1.5e4;           // khe ban le be, nong nhanh nhat
  const EPS = 0.85;
  const TILE_PASS = 0.16;          // ti le nhiet lot qua gach
  const T_TILE_MAX = 1750;         // gach bat dau hong (dinh danh dinh ~1620 K)
  /* 304L mat phan lon do ben tu ~1100 K. Dat 1450 thi bay LUNG-TRUOC van
     song (do duoc dinh 1349 K) — vo ly, vi luc do thep tran an tron dong
     nhiet tai nhap. Bay dung the thi lung nam yen o 250 K nen nguong nay
     khong bao gio cham nham. */
  const T_STEEL_MAX = 1150;        // thep mat ben
  const T_HINGE_MAX = 1500;

  /* Mo-men toi da theo TUNG TRUC, suy tu vi tri voi chu khong dat tay.
     Chuc ngua / dao huong: hai cum tao ngau luc, tong canh tay don = |y-com| cong lai.
     Xoay doc: 4 voi vat, moi voi tac dung tren ban kinh than. */
  CFG.rcsLim = (() => {
    const P = CFG.rcsPorts, F = CFG.rcsF, R = CFG.dia / 2;
    const armN = Math.abs(P.nose.y - CFG.com), armA = Math.abs(P.aft.y - CFG.com);
    const pitch = F * (armN + armA);          // ngau luc mui + duoi
    const roll  = F * P.roll.n * R * 0.55;    // 0.55: voi vat cheo nen chi mot phan luc sinh mo-men
    return { pitch, roll };
  })();

  // canh tay don tu trong tam toi tung flap (he body)
  CFG.flaps.forEach(f => {
    f.r = V(Math.cos(f.th) * 4.5, f.y - CFG.com, Math.sin(f.th) * 4.5);
  });

  /* Tensor quan tinh duong cheo (he body).
     Quanh truc DOC (Y) nho hon ~21 lan -> roll rat nhanh, dung nhu tru tron. */
  function inertia(m) {
    const R = CFG.dia / 2, L = CFG.len;
    return V(m * (L * L / 12 + R * R / 4), m * (R * R / 2), m * (L * L / 12 + R * R / 4));
  }

  /* Dung quaternion tu hai truc mong muon trong he world (gan dung -> truc giao). */
  function qFromAxes(xW, yW) {
    const y = vnorm(yW);
    let x = vnorm(vsub(xW, vmul(y, vdot(xW, y))));
    const z = vcross(x, y);
    const m00 = x.x, m10 = x.y, m20 = x.z;
    const m01 = y.x, m11 = y.y, m21 = y.z;
    const m02 = z.x, m12 = z.y, m22 = z.z;
    const tr = m00 + m11 + m22;
    let w, qx, qy, qz, sc;
    if (tr > 0) { sc = Math.sqrt(tr + 1) * 2; w = .25 * sc; qx = (m21 - m12) / sc; qy = (m02 - m20) / sc; qz = (m10 - m01) / sc; }
    else if (m00 > m11 && m00 > m22) { sc = Math.sqrt(1 + m00 - m11 - m22) * 2; w = (m21 - m12) / sc; qx = .25 * sc; qy = (m01 + m10) / sc; qz = (m02 + m20) / sc; }
    else if (m11 > m22) { sc = Math.sqrt(1 + m11 - m00 - m22) * 2; w = (m02 - m20) / sc; qx = (m01 + m10) / sc; qy = .25 * sc; qz = (m12 + m21) / sc; }
    else { sc = Math.sqrt(1 + m22 - m00 - m11) * 2; w = (m10 - m01) / sc; qx = (m02 + m20) / sc; qy = (m12 + m21) / sc; qz = .25 * sc; }
    return qnorm(Q(w, qx, qy, qz));
  }

  /* ---------- KHI DONG + LUC ----------
     Tra ve gia toc dai (world) va MO-MEN (he body). */
  function forces(sh, cmd, F) {
    const r = vlen(sh.p), rhat = vmul(sh.p, 1 / r), alt = r - F.RE;
    const A = F.atmosphere(alt);
    // gio: dong khi that su qua than = van toc - van toc gio
    const we = F.windAt ? F.windAt(alt, sh.t) : 0;
    const east = vlen(vcross(rhat, V(0, 0, 1))) > 1e-6
      ? vnorm(vcross(rhat, V(0, 0, 1))) : V(1, 0, 0);
    const vRel = vsub(sh.v, vmul(east, we));
    const speed = vlen(vRel);
    const vhat = speed > 1e-6 ? vmul(vRel, 1 / speed) : vcopy(rhat);
    const qd = 0.5 * A.rho * speed * speed;

    const axis = qrot(sh.q, V(0, 1, 0));        // truc than (mui) trong world
    const belly = qrot(sh.q, V(1, 0, 0));       // mat chan nhiet

    let force = V(0, 0, 0);
    const T = cmd.nEng > 0 ? F.clusterThrust(F.VEH.s2.sl, cmd.throttle, A.p, cmd.nEng) : { F: 0, mdot: 0 };
    force = vadd(force, vmul(axis, T.F));
    force = vadd(force, vmul(rhat, -F.MU / (r * r) * sh.m));

    let torque = V(0, 0, 0);
    const vb = qrotInv(sh.q, vhat);             // huong bay trong he body
    if (speed > 1 && A.rho > 0) {
      // goc tan: giua truc than va vector van toc
      const ca = clamp(vdot(axis, vhat), -1, 1);
      const aoa = Math.acos(clamp(Math.abs(ca), -1, 1));
      const sn = Math.sin(aoa), cs = Math.abs(ca);
      const area = CFG.aBase * cs + CFG.aSide * sn;
      const cd = CFG.cdAx * cs + CFG.cdBroad * sn;
      force = vadd(force, vmul(vhat, -qd * cd * area));

      // Luc nang: vuong goc van toc, trong mat phang (v, truc than).
      // BANK quanh vector van toc chinh la cach xoay vector nay -> lai ngang.
      const perp = vsub(axis, vmul(vhat, vdot(axis, vhat)));
      if (vlen(perp) > 1e-4) {
        const Lmag = qd * CFG.aSide * 0.25 * Math.sin(2 * aoa);
        force = vadd(force, vmul(vnorm(perp), -Lmag));
      }
      // on dinh: than tru muon nam ngang dong khi; cong can xoay
      const wv = -0.30 * qd * CFG.aSide * 2.0 * Math.sin(2 * (aoa - Math.PI / 2)) * (1 - (sh.tuck || 0));
      const wAx = vlen(vcross(vb, V(0, 1, 0))) > 1e-6 ? vnorm(vcross(vb, V(0, 1, 0))) : V(0, 0, 1);
      torque = vadd(torque, vmul(wAx, wv));
      const dmp = 0.45 * qd * CFG.aSide * CFG.len * 0.02;
      torque = vsub(torque, vmul(sh.w, dmp));

      // --- 4 FLAP DOC LAP: moi canh mot luc can rieng, dat tai r_i ---
      const kf0 = qd * CFG.sFlap * CFG.cdFlap;
      for (let i = 0; i < 4; i++) {
        const e = sh.flap[i];
        if (e <= 0) continue;
        // ban le chay thi canh mat luc: 0 = con nguyen, 1 = hong han
        const kf = kf0 * (1 - 0.85 * (sh.hingeDmg ? sh.hingeDmg[i] : 0));
        const Fb = vmul(vb, -kf * e);            // luc trong he body
        torque = vadd(torque, vcross(CFG.flaps[i].r, Fb));
        force = vadd(force, vmul(vhat, -kf * e)); // dong gop luc can tong
      }
    }
    // gimbal: chi tao duoc pitch/yaw, KHONG tao duoc roll (luc day doc truc)
    if (T.F > 1e3 && cmd.gim) {
      const gx = clamp(cmd.gim.x, -CFG.gimbal, CFG.gimbal);
      const gz = clamp(cmd.gim.z, -CFG.gimbal, CFG.gimbal);
      torque = vadd(torque, V(T.F * Math.sin(gx) * CFG.com, 0, T.F * Math.sin(gz) * CFG.com));
    }
    if (cmd.rcs) torque = vadd(torque, cmd.rcs);
    // voi RCS nam tren than: chi day duoc VUONG GOC truc than
    if (cmd.rcsF) force = vadd(force, vsub(cmd.rcsF, vmul(axis, vdot(cmd.rcsF, axis))));
    return { acc: vmul(force, 1 / sh.m), torque, mdot: T.mdot, qd, alt, speed, A, vhat, axis, belly };
  }

  /* Thap o (0, RE, 0). Mat phang danh nghia la z = 0, nen LECH NGANG = p.z.
     Bank quanh vector van toc xoay vector luc nang ra khoi mat phang do —
     day la co che lai ngang that su, va la ly do bon canh phai co roll. */
  /* MUC TIEU tham so hoa: mot vector don vi bat ky tren mat cau. Thay vi viet
     lai toan bo bo lai, ta giu mot QUATERNION xoay the gioi sao cho muc tieu
     roi ve (0,1,0) — toan bo cong thuc cu chay nguyen ven trong khung do.
     Doi muc tieu giua chuyen bay chi la doi mot quaternion. */
  let TOWER = V(0, 1, 0), TQ = Q(1, 0, 0, 0), TQi = Q(1, 0, 0, 0);
  function setTarget(t) {
    TOWER = vnorm(t || V(0, 1, 0));
    TQ = qBetween(TOWER, V(0, 1, 0));      // xoay muc tieu ve cuc bac
    TQi = qconj(TQ);
    return TOWER;
  }
  const getTarget = () => TOWER;
  const toTargetFrame = v => qrot(TQ, v);

  function frame(sh, F) {
    const r = vlen(sh.p), rhat = vmul(sh.p, 1 / r);
    const speed = vlen(sh.v);
    const vhat = speed > 1e-6 ? vmul(sh.v, 1 / speed) : vcopy(rhat);
    const pt = toTargetFrame(sh.p), vt = toTargetFrame(sh.v);   // he lay muc tieu lam goc
    return {
      r, rhat, alt: r - F.RE, speed, vhat,
      vu: vdot(sh.v, rhat),
      down: Math.atan2(pt.x, pt.y) * F.RE,     // tam xa so voi MUC TIEU
      cross: pt.z, crossRate: vt.z,            // lech ngang so voi mat phang tiep can
    };
  }

  /* Du bao diem cham tren mat phang z=0 neu giu nguyen goc tan. */
  /* bankHold: nghieng bao nhieu thi chi con L*cos(bank) do len — bo qua no
     thi du bao dai hon thuc te hang chuc km. Day la ket noi ngang<->doc that
     su cua bai toan tai nhap. */
  function predict(sh, aoaHold, F, bankHold) {
    let p = vcopy(sh.p), v = vcopy(sh.v), tt = sh.t;
    for (let i = 0; i < 40000; i++) {
      const r = vlen(p), alt = r - F.RE;
      if (alt <= F.CATCH_ALT) break;
      const dt = alt > 100000 ? .25 : alt > 70000 ? .06 : .02;
      const A = F.atmosphere(alt);
      /* GIO: dong luc hoc that tinh luc theo van toc TUONG DOI VOI KHONG KHI,
         nen bo du bao cung phai vay. Bo qua no thi sai so ti le thang voi gio:
         do duoc 115 m khi lang, 1654 m o gio 9/30, 6072 m o gio 21/62. */
      const rhat2 = vmul(p, 1 / r);
      const cz = vcross(rhat2, V(0, 0, 1));
      const east2 = vlen(cz) > 1e-6 ? vnorm(cz) : V(1, 0, 0);
      const vR = vsub(v, vmul(east2, F.windAt ? F.windAt(alt, tt) : 0));
      const sp = vlen(vR);
      let a = vmul(p, -F.MU / (r * r * r));
      if (sp > 1 && A.rho > 0) {
        const qd = .5 * A.rho * sp * sp;
        const sn = Math.sin(aoaHold), cs = Math.abs(Math.cos(aoaHold));
        const area = CFG.aBase * cs + CFG.aSide * sn;
        const cd = CFG.cdAx * cs + CFG.cdBroad * sn;
        a = vadd(a, vmul(vR, -qd * cd * area / (sh.m * sp)));
        // luc nang huong len trong mat phang thang dung (bank = 0)
        const up = vmul(p, 1 / r);
        const side = vcross(vmul(vR, 1 / sp), up);
        if (vlen(side) > 1e-6) {
          const lu = vnorm(vcross(vnorm(side), vmul(vR, 1 / sp)));
          a = vadd(a, vmul(lu, qd * CFG.aSide * .25 * Math.sin(2 * aoaHold) * Math.cos(bankHold || 0) / sh.m));
        }
      }
      v = vadd(v, vmul(a, dt)); p = vadd(p, vmul(v, dt)); tt += dt;
    }
    const pt = toTargetFrame(p);
    return Math.atan2(pt.x, pt.y) * F.RE;
  }

  const ENTRY_AOA = 68 * Math.PI / 180, FLOP_AOA = 80 * Math.PI / 180;
  const FLOP_ALT = 35000;                  // ENTRY -> FLOP
  const PRED_GAP = 0.2;                    // s giua cac lan predictFlip cua MOT chu ky (xem auto)

  /* ===== DU BAO DIEM LAT =====
     predict() o tren nham diem roi o CATCH_ALT, luc nang THANG DUNG, bo qua flap:
     no du bao dai hon mo phong 3D +1.3 km o 35 km, +510 m o 20 km, nen ENTRY phai
     bu tay rangeBias 7500 m, va belly flop duoi 20 km het tham quyen sua -> 48
     chuyen lat cach thap tb 950 m (600-1340), lech ngang tb 450 m.
     predictFlip thi:
       · CUNG khung tu the voi attitudeCmd (mui theo van toc SO VOI DAT, bank xoay
         luc nang ra NGANG), luc khi dong theo van toc TUONG DOI KHONG KHI nhu
         forces(), them can 4 flap o ext .5;
       · tren FLOP_ALT giu aoaE (ENTRY), duoi do giu aoaF (belly flop);
       · DUNG o dieu kien lat cua auto() (h <= hBurn + FLIP_MARGIN), tra tam xa /
         lech ngang / thoi diem CUA CHINH DIEM LAT — dung thu FLOP can nham;
       · gio mo hinh nhan sh.kw (anh chup FLOP, <= 1, xem auto FLOP LECH BO DU BAO), tra them
         w0 = gio mo hinh CHUA nhan kw o diem dau (cung moc gio) de so voi gio khi dong.
     Sai so so voi mo phong 3D GIU CUNG lenh (3 chuyen, seed 9001): FLOP <= 17 m tu
     30 km, <= 15 m tu 10 km (-84..-97 m ngay sau ban giao, 34 km). ENTRY du bao
     NGAN hon 7.5-9.1 km o 60 km, 1.8-2.0 km o 45 km, nhung Newton nham lai moi 2 s
     nen ban giao o 35 km chi lech +322 m (277-373, 48 chuyen): FLOP du tham quyen.
     Viet bang so thuc, khong cap phat vector: ENTRY 3.4 ms / lan (toi 30 nghin
     vong), FLOP 0.95 ms; predict() cu 9.0 / 2.3 ms (Node, Apple M3). */
  function predictFlip(sh, aoaF, F, bank, aoaE) {
    let px = sh.p.x, py = sh.p.y, pz = sh.p.z, vx = sh.v.x, vy = sh.v.y, vz = sh.v.z, tt = sh.t;
    const m = sh.m, cb = Math.cos(bank || 0), sb = Math.sin(bank || 0), kw = sh.kw === undefined ? 1 : sh.kw;
    let w0 = null;
    const aE = aoaE === undefined ? aoaF : aoaE;
    const cE = Math.cos(aE), sE = Math.sin(aE), cF = Math.cos(aoaF), sF = Math.sin(aoaF);
    const flapA = 4 * CFG.sFlap * CFG.cdFlap * .5, eng = F.VEH.s2.sl;
    const hTop = F.CATCH_ALT + (sh.tw ? sh.tw.y : 0);
    for (let i = 0; i < 60000; i++) {
      const r = Math.sqrt(px * px + py * py + pz * pz), alt = r - F.RE;
      if (alt <= F.CATCH_ALT) break;
      const ux = px / r, uy = py / r, uz = pz / r, gr = F.MU / (r * r * r);
      const vu = vx * ux + vy * uy + vz * uz, A = F.atmosphere(alt);
      if (vu < 0 && alt - hTop <= vu * vu / (2 * Math.max(1, 3 * Math.max(0, eng.Fvac - eng.Ae * A.p) / m - gr * r)) + SGC.FLIP_MARGIN) break;
      const dt = alt > 100000 ? .25 : alt > 70000 ? .06 : .02;
      let ax = -px * gr, ay = -py * gr, az = -pz * gr;
      if (A.rho > 0) {
        let ex = uy, ey = -ux;                                   // dong = rhat x Z
        const el = Math.sqrt(ex * ex + ey * ey);
        if (el > 1e-6) { ex /= el; ey /= el; } else { ex = 1; ey = 0; }
        const w = F.windAt ? F.windAt(alt, tt) : 0;
        if (w0 === null) w0 = w;
        const rx = vx - ex * w * kw, ry = vy - ey * w * kw, rz = vz, sp = Math.sqrt(rx * rx + ry * ry + rz * rz);
        if (sp > 1) {
          const hx = rx / sp, hy = ry / sp, hz = rz / sp, vl = Math.sqrt(vx * vx + vy * vy + vz * vz);
          const gx = vl > 1e-6 ? vx / vl : hx, gy = vl > 1e-6 ? vy / vl : hy, gz = vl > 1e-6 ? vz / vl : hz;
          let sx = gy * uz - gz * uy, sy = gz * ux - gx * uz, sz = gx * uy - gy * ux;   // vhat x rhat
          const sl = Math.sqrt(sx * sx + sy * sy + sz * sz);
          if (sl > 1e-12) { sx /= sl; sy /= sl; sz /= sl; } else { sx = 0; sy = 1; sz = 0; }
          // k = side quay `bank` quanh vhat; mui = -vhat quay `aoa` quanh k (nhu attitudeCmd)
          const kx = sx * cb + (gy * sz - gz * sy) * sb, ky = sy * cb + (gz * sx - gx * sz) * sb, kz = sz * cb + (gx * sy - gy * sx) * sb;
          const c0 = alt > FLOP_ALT ? cE : cF, s0 = alt > FLOP_ALT ? sE : sF;
          const nx = -gx * c0 - (ky * gz - kz * gy) * s0, ny = -gy * c0 - (kz * gx - kx * gz) * s0, nz = -gz * c0 - (kx * gy - ky * gx) * s0;
          const ca = clamp(nx * hx + ny * hy + nz * hz, -1, 1), cs = Math.abs(ca), sn = Math.sqrt(1 - cs * cs);
          const qd = .5 * A.rho * sp * sp;
          const kD = -qd * ((CFG.cdAx * cs + CFG.cdBroad * sn) * (CFG.aBase * cs + CFG.aSide * sn) + flapA) / m;
          ax += hx * kD; ay += hy * kD; az += hz * kD;
          if (sn > 1e-4) {                                     // |L| = qd*aSide*.25*sin 2a, phuong (mui - vhat*ca)/sn
            const kL = -qd * CFG.aSide * .5 * cs / m;
            ax += (nx - hx * ca) * kL; ay += (ny - hy * ca) * kL; az += (nz - hz * ca) * kL;
          }
        }
      }
      vx += ax * dt; vy += ay * dt; vz += az * dt;
      px += vx * dt; py += vy * dt; pz += vz * dt; tt += dt;
    }
    const pt = toTargetFrame(V(px, py, pz));
    return { down: Math.atan2(pt.x, pt.y) * F.RE, cross: pt.z, t: tt, w0 };
  }
  // Anh chup du cho predictFlip: cac lan goi cua mot chu ky tinh tren CUNG trang thai va CUNG kw (ENTRY luon 1)
  const predState = sh => ({ p: vcopy(sh.p), v: vcopy(sh.v), t: sh.t, m: sh.m, tw: { y: sh.tw ? sh.tw.y : 0 }, kw: sh._fkw || 1 });

  /* Lenh tu the: goc tan `aoa` quanh truc `k`, trong do k duoc BANK quanh vhat. */
  function attitudeCmd(f, aoa, bank) {
    const side = vnorm(vcross(f.vhat, f.rhat));
    const k = qrot(qAxisAngle(f.vhat, bank), side);
    const nose = qrot(qAxisAngle(k, aoa), vmul(f.vhat, -1));
    let belly = vsub(f.vhat, vmul(nose, vdot(f.vhat, nose)));
    if (vlen(belly) < 1e-4) belly = vnorm(vcross(nose, f.rhat));
    return qFromAxes(belly, nose);
  }

  /* ================= DAN HUONG BAM HO SO LUC CAN =================
     Kieu tau con thoi. Voi chuyen luot:  dR/dV = -V/D
     => tich phan ra:   D_can = (V^2 - Vf^2) / (2 * R_conlai)
     Tinh lai moi buoc tu tam con lai, nen KHONG can bo du bao, khong can
     Newton, va tu dong bu moi nhieu loan tren duong bay.

     MOT bien dieu khien lam CA HAI viec:
       - DO LON goc nghieng: nghieng nhieu -> it luc nang doc -> tut vao khi
         quyen day hon -> luc can tang  => chinh TAM XA
       - DAU goc nghieng: lat qua lai de giu LECH NGANG trong dai chet
     Dai chet thu hep dan theo van toc, dung nhu ho lam.                  */


  /* Gia toc can THUC TE dang chiu (m/s^2). */
  function dragAccel(sh, F) {
    const f = frame(sh, F), A = F.atmosphere(f.alt);
    if (A.rho <= 0 || f.speed < 1) return 0;
    const axis = qrot(sh.q, V(0, 1, 0));
    const aoa = Math.acos(clamp(Math.abs(vdot(axis, f.vhat)), -1, 1));
    const sn = Math.sin(aoa), cs = Math.abs(Math.cos(aoa));
    const area = CFG.aBase * cs + CFG.aSide * sn;
    const cd = CFG.cdAx * cs + CFG.cdBroad * sn;
    return 0.5 * A.rho * f.speed * f.speed * cd * area / sh.m;
  }

  /* DA THU VA BO: doi mat phang quy dao truoc tai nhap.
     Y tuong la khu lech ngang bang Dv (2*V*sin(di/2), chi ~20-50 m/s) roi de
     khi dong lo phan tinh. Do ra TE HON o moi muc:
        lech 38 km:  khong doi 400 m  ->  co doi 1776 m
        lech 60 km:  khong doi 1003 m ->  co doi 6314 m
     Ly do: quy dao tu nhien DA HOI TU san (toc do lech ngang -13 m/s), cu dot
     lam no thanh +41 m/s tuc PHAN KY. Va bao lai ngang cua khi dong rong hon
     nhieu so voi tao tuong — 140 km van cho 2093 m. Khong can Dv o day. */

  function auto(sh, F) {
    const f = frame(sh, F);
    const g = F.MU / (f.r * f.r);
    const h = f.alt - (F.CATCH_ALT + (sh.tw ? sh.tw.y : 0));   // toi mat ray HIEN TAI
    const T3 = F.clusterThrust(F.VEH.s2.sl, 1, F.atmosphere(f.alt).p, 3).F;

    // --- lai ngang bang BANK: dua p.z va v.z ve 0 ---
    const tGoC = Math.max(20, h / Math.max(Math.abs(f.vu), 40));
    /* He so nay quyet dinh do chinh xac ngang. Bo cu (2.2e-5 / 6.0e-4) de lai
       sai so ~10% cua luong lech — do la bo lai chua hoi tu, khong phai het bao
       khi dong nhu tao tuong. Quet lai: 9e-5 / 1.6e-3 cho BULLSEYE toi 12 km. */
    const bankRaw = -(f.cross * 9e-5 + f.crossRate * 1.6e-3);
    const bank = clamp(bankRaw, -70 * Math.PI / 180, 70 * Math.PI / 180);

    if (sh.phase === 'ENTRY') {
      /* Tam xa: nghich dao bo du bao bang Newton.
         Lech ngang: nghieng LIEN TUC ti le voi sai so (bien `bank` o tren).

         DA THU VA BO hai cach cua tau con thoi, ca hai deu TE HON o day:
         · Bam ho so luc can  D = (V^2-Vf^2)/(2R): sai 460 km. Ly do la 480 s
           dau tau con tren 84 km, luc can BANG 0 nen khong co gi de bam, ma
           tam xa da troi mat 3700 km theo dan dao. Tau con thoi bam duoc vi
           quang tai nhap cua no dai gap nhieu lan.
         · Dao chieu nghieng bang-bang: sai 4-12 km. Quang tai nhap chi ~900 s
           nen chi kip 1-2 lan dao, khong du de triet tieu sai so; luat ti le
           lien tuc nut duoc lien tuc nen tot hon han.
         Bo du bao la predictFlip (a0 toi FLOP_ALT roi FLOP_AOA toi DIEM LAT), nham
         APR.GATE + rangeBias (xem fromPlan) thay cho predict() nham 7500 m chinh
         tay o CATCH_ALT (ban giao lech theo thoi tiet). */
      const tgtE = APR.GATE + sh.rangeBias;
      /* TRAI LAN GOI. Hai lan predictFlip trong MOT buoc an p95 10.2 ms (362/2840
         buoc > 9 ms; predict() cu 29.9 ms) trong khi vong game chi xem dong ho moi 8
         buoc, ngan sach 9 ms / khung. Nen lan 1 chup trang thai (predState), lan 2
         chay sau PRED_GAP = 10 buoc tren CUNG anh chup: phep tinh y het, lenh tre
         0.2 s trong chu ky 2 s. Buoc ENTRY con p95 4.6 ms (26/5680 > 9 ms). 48 chuyen
         (GATE 250) so voi goi cung buoc: diem lat lech <= 0.31 m, 48/48 bullseye; LAND tung
         chuyen doi toi 4.6 s (nhom lang cham 64-71 s), tb 51.5 s so voi 51.8. */
      const J = sh._pj;
      if (!J && sh.t - (sh._pT === undefined ? -99 : sh._pT) > 2) {   // _pT = 0 hop le: khong dung ||
        sh._pT = sh.t;
        const a0 = sh._aoa || ENTRY_AOA, S = predState(sh);
        sh.pi = predictFlip(S, FLOP_AOA, F, bank, a0).down;
        sh._pj = { S, a0, bank, p0: sh.pi };
      } else if (J && sh.t - sh._pT >= PRED_GAP) {
        sh._pj = null;
        const dA = 0.035, p1 = predictFlip(J.S, FLOP_AOA, F, J.bank, J.a0 + dA).down;
        const slope = (p1 - J.p0) / dA;
        if (Math.abs(slope) > 1e4) {
          const step = clamp(-(J.p0 - tgtE) / slope, -0.20, 0.20);
          sh._aoa = clamp(J.a0 + step * 0.65, 35 * Math.PI / 180, 89 * Math.PI / 180);
        }
      }
      const aoa = sh._aoa || ENTRY_AOA;
      sh.ext = clamp(0.5 + (sh.pi - tgtE) * 3e-6, 0, 1);
      if (f.alt < FLOP_ALT) { sh.phase = 'FLOP'; sh._pj = null; }
      else return { aoa, bank, ext: sh.ext, throttle: 0, nEng: 0 };
    }
    if (sh.phase === 'FLOP') {
      /* NHAM DIEM LAT, khong nham diem roi. Luat cu (goc tan ti le K_AOA vao CONG
         450 m tren predict(), bank theo luat ENTRY) khong sua duoc diem ban giao.
         Moi 1 s: ba lan predictFlip -> Jacobi 2x2 cua (tam xa, lech ngang) TAI DIEM
         LAT theo (goc tan, bank), mot buoc Newton giam chan .65 nham (GATE, 0).
         48 chuyen (seed 9001/31337/2718/1234 x lang/mua/giat), GATE 400: lat 400-401 m,
         lech ngang 0 m, 48/48 bullseye, LAND tb 47.6 s (luat cu 64.2), con tb 58.9 t
         (cu 49.7). Van toc ngang luc lat khong duoc dieu khien: o GATE 250 khi lang
         LAND tach hai nhom 43-52 / 63-71 s; 400 m du cho de luat ha vua tien vua ha.
         DA THU VA BO (12 chuyen dev): chi Newton goc tan, bank luat cu -> lech ngang
         tb 227 m (max 683); nham trang thai LUC BAT DAU LAND (them cu lat chat
         diem) -> lat 198-232 m nhung LAND 61.2 s. */
      /* LECH BO DU BAO: gio mo hinh sai (jet lech, gio nhan he so) -> du bao DAI hon that, Newton giu du bao o GATE nhung that HUT:
         base thu tai 555/8080 lat hut 20/456 (jetm2 7, pw13 1, pw13wx 12). Bang chung chi co khi tau DI QUA lop gio sai (jet 16-6 km);
         pw13wx storm duoi 20 km khong goc tan nao con qua thap -> can bang chung som. Hai kenh, CHI dich ve phia DAI; khong bang
         chung thi trung base tung bit (pw07wx 555: 12/12 y het):
         · GIO KHI DONG (som): wA = gio tai cho (F.windAt(f.alt, sh.t)) so voi wM = gio mo hinh cung diem (w0 cua predictFlip). He
           so goc tren HIEU tung chu ky, tam hoa EMA: gio nhan he so nhan ca giat nhanh -> 1/1.3; jet lech chi doi xu the cham -> ~1.
           k < K_DB thi kw = max(K_MIN, k) nhan gio mo hinh o cac chu ky sau (predState). pw13wx 555: 6 lat hut -> 0, lat 399-400 m.
         · TROI (muon): res = p0 - (p0 truoc + Da da + Db db); EMA; bias con ~ B_GAIN (-rate - B_DB) min(t_go, B_TH) -> nham GATE +
           shift. Chi khi kw = 1 ca hai chu ky, duoi B_ALT, lenh doi < 2 do. ref 555: res +-1 m / chu ky duoi 30 km; jetm2 -7..-17.
         · THOAT TRAN: tren FLOP_AOA ma Da > 0 (qua goc can cuc dai 80-85 do) va du bao hut, Newton cu tang goc tan len 89 do
           (jetm2 555#1 ghim 2816 buoc, p0 218 m van hut, lat -29 m). Co bang chung (shift > B_ESC hoac kw < 1) thi dung -Da;
           khong co thi giu: pw07wx storm cung ghim tran nhung that dai ~1300 m. jetm2 555: 5 lat hut -> 271-400 m.
         DA THU VA BO (seed 555): chi TROI + thoat tran, t_go khong chan -> pw13wx con 5/12 lat hut; ti le TUYET DOI Sxy/Sxx, K_MIN .5
         -> jetp2 lat 620 m, con min 59.1 t (suon jet mo hinh 22-13 km manh 2-3 lan); them K_MIN .75 -> 568 m / 62.6 t; xoa bang chung
         khi |wA| >= K_DB |wM| -> 571 m / 62.5 t; troi ca tren 30 km va B_DB 1 -> pw07wx 555#8 LAND +28.6 s / -14.5 t (shift 63 m o
         34.4 km doi dau bank bao hoa cuoi FLOP). */
      const aMin = APR.AOA_MIN * Math.PI / 180, aMax = APR.AOA_MAX * Math.PI / 180;
      if (sh._fbank === undefined) { sh._faoa = FLOP_AOA; sh._fbank = bank; }
      // Ba lan goi cung TRAI ra ba buoc cach PRED_GAP tren mot anh chup (xem ENTRY):
      // moi buoc <= 1 lan: p95 1.7 ms thay vi 5.9 ms; lenh tre 0.4 s / chu ky 1 s.
      const J = sh._pj;
      if (sh._fa) { /* dang CAN MUI (xem duoi): tu the khong con thuoc ho (goc tan, bank) cua predictFlip -> giu nguyen */ }
      else if (!J && sh.t - (sh._pT === undefined ? -99 : sh._pT) > 1) {
        sh._pT = sh.t;
        const a0 = sh._faoa, b0 = sh._fbank, S = predState(sh), p0 = predictFlip(S, a0, F, b0);
        sh.pi = p0.down;
        sh._pj = { S, a0, b0, dA: a0 + .035 > aMax ? -.035 : .035, dB: b0 > 0 ? -.05 : .05, p0, pA: null };
        // GIO KHI DONG tai cho so voi gio mo hinh cung diem (xem LECH BO DU BAO)
        const wA = F.windAt ? F.windAt(f.alt, sh.t) : 0, wM = p0.w0 === null ? wA : p0.w0;
        const G = sh._fg || (sh._fg = { m: wM, a: wA, mM: 0, mA: 0, xx: 0, xy: 0 }), e = APR.K_EMA;
        const dM = wM - G.m, dW = wA - G.a;
        G.m = wM; G.a = wA; G.mM += e * (dM - G.mM); G.mA += e * (dW - G.mA);
        G.xx += e * ((dM - G.mM) * (dM - G.mM) - G.xx); G.xy += e * ((dM - G.mM) * (dW - G.mA) - G.xy);
        const kR = (G.xy + APR.K_P) / (G.xx + APR.K_P);
        sh._fkw = kR > APR.K_DB ? 1 : Math.max(APR.K_MIN, kR);
      } else if (J && !J.pA && sh.t - sh._pT >= PRED_GAP) {
        J.pA = predictFlip(J.S, J.a0 + J.dA, F, J.b0);
      } else if (J && J.pA && sh.t - sh._pT >= 2 * PRED_GAP) {
        sh._pj = null;
        const a0 = J.a0, b0 = J.b0, dA = J.dA, dB = J.dB, p0 = J.p0, pA = J.pA;
        const pB = predictFlip(J.S, a0, F, b0 + dB);
        let Da = (pA.down - p0.down) / dA;
        const Db = (pB.down - p0.down) / dB;
        const Ca = (pA.cross - p0.cross) / dA, Cb = (pB.cross - p0.cross) / dB;
        // TROI (xem LECH BO DU BAO); kep +-40 m bo nhay phi tuyen (jetm2 gusty +386 m khi ghim tran)
        const L = sh._fl;
        if (L && Math.abs(a0 - L.a) < .035 && Math.abs(b0 - L.b) < .05 && J.S.kw === 1 && L.kw === 1 && f.alt < APR.B_ALT) {
          const res = p0.down - (L.p + L.Da * (a0 - L.a) + L.Db * (b0 - L.b));
          sh._frt = (sh._frt || 0) + APR.B_EMA * (clamp(res, -40, 40) - (sh._frt || 0));
        }
        sh._fl = { p: p0.down, a: a0, b: b0, Da, Db, kw: J.S.kw };
        const tGo = Math.min(APR.B_TH, Math.max(0, h - sh.hBurn - SGC.FLIP_MARGIN) / Math.max(-f.vu, 20));
        if (J.S.kw < 1) sh._frt = 0;
        sh._fsh = APR.B_GAIN * Math.max(0, -(sh._frt || 0) - APR.B_DB) * tGo;   // <= .8 x 38 x 30 = 912 m
        const aim = APR.GATE + sh._fsh;
        if ((sh._fsh > APR.B_ESC || J.S.kw < 1) && a0 > FLOP_AOA && Da > 0 && p0.down < aim) Da = -Da;   // THOAT TRAN
        const eD = p0.down - aim, eC = p0.cross, det = Da * Cb - Db * Ca;
        // Du bao NaN -> det NaN -> nhanh duoi (buoc 0 theo dao ham hong): _faoa/_fbank
        // giu qua cac chu ky nhung khong bao gio dinh NaN, khong can chan rieng.
        let sA, sB;
        if (Math.abs(det) > 1e-3 * Math.max(1, Math.abs(Da * Cb))) { sA = (Db * eC - Cb * eD) / det; sB = (Ca * eD - Da * eC) / det; }
        else { sA = Math.abs(Da) > 100 ? -eD / Da : 0; sB = Math.abs(Cb) > 100 ? -eC / Cb : 0; }
        sh._faoa = clamp(a0 + clamp(sA, -.2, .2) * .65, aMin, aMax);
        sh._fbank = clamp(b0 + clamp(sB, -.3, .3) * .65, -70 * Math.PI / 180, 70 * Math.PI / 180);
      }
      const aNet = Math.max(1, T3 / sh.m - g);
      sh.hBurn = f.vu < 0 ? (f.vu * f.vu) / (2 * aNet) : 0;
      if (h <= sh.hBurn + SGC.FLIP_MARGIN) { sh.phase = 'FLIP'; sh.flipT = 0; sh.flipT0 = sh.t; sh.flipAlt = f.alt; }
      else {
        sh.ext = clamp(0.5 + (sh.pi - APR.GATE - (sh._fsh || 0)) * 9e-5, 0, 1);   // theo diem nham GATE + shift
        /* CAN MUI TRUOC LAT: xoay phuong vi mui (giu goc tan) ve phia van toc can = FA_V m/s huong toi thap - van toc
           ngang. Khi lat mui quet theo cung lon tu phuong vi dang co len thang dung, nen dv ngang cua luc day 3 may
           (40-60 m/s) di theo phuong vi mui LUC BAT DAU LAT. Tau nam bung quay quanh phuong thang dung = quay quanh truc
           bung: flap (luc can doc dong) khong tao mo-men quanh do, gimbal tat -> chi RCS ~2 do/s2 (1.61 MN.m / 45.7e6).
           Ban cu bat 5 s truoc lat bang lenh buoc: 3333#1 lang (gan dung yen, lech phuong vi -100..-119 do tu 20 s truoc
           lat) lenh nhay 115 do, than lan / chuc 25 do/s, mui con lech 104 do -> dv luc day vuong goc -80 m/s, vao LAND
           lech ngang 296 m, duoi 200 m 43 s. Nay:
             · bat khi thoi gian toi lat tF < thoi gian servo (FA_W, FA_ACC) can cho goc lech + FA_T; servo phuong vi tu
               phuong vi lenh tu nhien, tron lenh FA_BLEND s; Newton FLOP dung trong luc can (xem tren);
             · chi khi tau da qua thap (f.down > FA_DOWN: luc bay qua dinh thap huong can lat 180 do) va diem lat du bao
               truoc mieng tay (pi > FA_DOWN). Lat hut jetm2 3141#2 / #5 (diem lat -50 / -48 m): co chan vao LAND lech
               ngang -2.3 / 8.2 m, bo chan 75.8 / 71.5 m.
           3333#1 (4 bien the SDR / DPROP): vao LAND lech ngang 5.5-11.6 m (base 86-109), duoi 200 m 20.2-20.3 s (base
           41.8-53.6); w than 6 s cuoi FLOP max 6.3 do/s (quick 12 + 3333 5 chuyen; base toi 11.0).
           DA THU VA BO: servo 8 do/s + 1.2 do/s2 va Newton van chay: goc tan cham AOA_MIN, diem lat 3333#1 508 m; gusty
           4242#3 / #6 bat 35 s truoc lat (tau bay qua thap) -> vao LAND lech ngang -44.6 / +45.7 m. Lech phuong vi tinh
           theo mui THAN thay lenh: nhu nhau (<= 0.2 m). */
        const tF = (h - sh.hBurn - SGC.FLIP_MARGIN) / Math.max(-f.vu, 20);
        if (SGC.FA_T > 0 && sh.pi > SGC.FA_DOWN && (sh._fa || f.down > SGC.FA_DOWN)) {
          const cA = qrot(TQi, V(0, 0, 1)), eA = vnorm(vcross(f.rhat, cA));
          const dF = Math.max(1, Math.hypot(f.down, f.cross));
          const uD = -SGC.FA_V * f.down / dF - vdot(sh.v, eA), uC = -SGC.FA_V * f.cross / dF - f.crossRate;
          const nAC = qrot(attitudeCmd(f, sh._faoa, sh._fbank), V(0, 1, 0));
          const psiAC = Math.atan2(vdot(nAC, cA), vdot(nAC, eA)), psiU = Math.atan2(uC, uD);
          let A = sh._fa;
          if (!A) {
            const dP = Math.abs(wrapPi(psiU - psiAC)), W = SGC.FA_W, AC = SGC.FA_ACC;
            const tNeed = dP > W * W / AC ? dP / W + W / AC : 2 * Math.sqrt(dP / AC);
            if (tF < tNeed + SGC.FA_T) A = sh._fa = { psi: psiAC, w: 0, t: sh.t, t0: sh.t };
          }
          if (A) {
            const dtF = Math.min(.1, Math.max(0, sh.t - A.t)); A.t = sh.t;
            const r = tServo(A.psi, A.w, A.psi + wrapPi(psiU - A.psi), SGC.FA_W, SGC.FA_ACC, dtF); A.psi = r.x; A.w = r.v;
            const hd = vadd(vmul(eA, Math.cos(A.psi)), vmul(cA, Math.sin(A.psi)));
            const w = vnorm(vsub(hd, vmul(f.vhat, vdot(hd, f.vhat))));
            let nose = vnorm(vadd(vmul(f.vhat, -Math.cos(sh._faoa)), vmul(w, Math.sin(sh._faoa))));
            const s = clamp((sh.t - A.t0) / SGC.FA_BLEND, 0, 1);
            if (s < 1) nose = vnorm(vadd(vmul(nAC, 1 - s), vmul(nose, s)));
            const belly = vsub(f.vhat, vmul(nose, vdot(f.vhat, nose)));
            return { qCmd: qFromAxes(belly, nose), aoa: sh._faoa, bank: sh._fbank, ext: sh.ext, throttle: 0, nEng: 0 };
          }
        }
        return { aoa: sh._faoa, bank: sh._fbank, ext: sh.ext, throttle: 0, nEng: 0 };
      }
    }
    if (sh.phase === 'FLIP') {
      /* Dong ho lat theo THOI GIAN MO PHONG, khong theo so lan goi auto(): "+= 0.02" moi
         lan goi thi tool nao goi them auto() moi buoc se co tuck nhanh gap doi va het gio
         lat sau 5 s thay vi 10 s. +0.02: lan goi dau (cung buoc chuyen pha) van la 0.02. */
      if (sh.flipT0 === undefined) sh.flipT0 = sh.t - sh.flipT;
      sh.flipT = sh.t - sh.flipT0 + 0.02;
      sh.tuck = Math.min(1, sh.flipT / 1.2);
      sh.ext = 0;
      /* Truc "dung" muc tieu nghieng ve PHIA THAP mot goc ty le voi lech ngang:
         luc day 3 may trong luc lat vua ham vua keo tau theo cung. */
      let upv = f.rhat;
      const eH = Math.hypot(f.down, f.cross);
      if (SGC.LEAD_MAX > 0 && eH > 1) {
        const cA = qrot(TQi, V(0, 0, 1)), eA = vnorm(vcross(f.rhat, cA));
        /* LEAD theo sai so VAN TOC: gia toc can a = FL_KV (-FL_V - v toi thap) doc huong toi thap, -FL_KT v vuong goc;
           truc dung nghieng theo a mot goc min(LEAD_MAX, |a| / aT) rad (aT = gia toc day ~.43 T3/m; ti le, khong
           phai atan). Lat hut (pi <= FA_DOWN): giu luat cu theo vi tri (LEAD_K). */
        if (SGC.FL_KV > 0 && sh.pi > SGC.FA_DOWN) {
          const ux = f.down / eH, uz = f.cross / eH, vD = vdot(sh.v, eA), vC = f.crossRate;
          const vr = vD * ux + vC * uz, vt = vC * ux - vD * uz;
          const ar = SGC.FL_KV * (-SGC.FL_V - vr), at = -SGC.FL_KT * vt;
          const aH = vadd(vmul(eA, ar * ux - at * uz), vmul(cA, ar * uz + at * ux));
          const aT = Math.max(1, T3 * .43 / sh.m);
          upv = vnorm(vadd(f.rhat, vmul(vnorm(aH), Math.tan(Math.min(SGC.LEAD_MAX, vlen(aH) / aT)))));
        } else {
          const toT = vnorm(vadd(vmul(eA, -f.down), vmul(cA, -f.cross)));
          upv = vnorm(vadd(f.rhat, vmul(toT, Math.tan(Math.min(SGC.LEAD_MAX, eH * SGC.LEAD_K)))));
        }
      }
      /* BUNG QUAY VE THAP (-mieng tay). Truoc day bung theo huong van toc ngang —
         tau dang troi RA XA thap nen bung bi lenh quay ra ngoai, nguoc voi cu lat
         ngoc mui tu nhien, va lat xong truc chot lech tay 68-88 do. */
      const opn = armFrame(sh, f).open;
      let bel = vsub(vmul(opn, -1), vmul(upv, -vdot(opn, upv)));
      if (vlen(bel) < 1e-3) bel = vcross(upv, vcross(f.vhat, upv));
      const upright = qFromAxes(vnorm(bel), upv);
      const err = Math.acos(clamp(vdot(qrot(sh.q, V(0, 1, 0)), upv), -1, 1));   // do so voi truc DA NGHIENG
      if (err < 18 * Math.PI / 180 || sh.flipT > Math.max(9, 2.2 / SGC.FLIP_RATE)) sh.phase = 'LAND';
      let thrFlip = 1;
      if (SGC.FLIP_THR === 'need') {
        const aNeed = (f.vu * f.vu) / (2 * Math.max(h, 2));
        thrFlip = clamp(sh.m * (aNeed + g) / Math.max(T3, 1), .4, 1);
      }
      return { qCmd: upright, ext: 0, throttle: thrFlip, nEng: 3, wMax: SGC.FLIP_RATE };
    }
    // --- LAND: dot ham + keo ve dung thap theo ca hai truc ngang ---
    if (APR.MODE === 'arc') return landArc(sh, f, F, g, h);
    const aReq = (f.vu * f.vu) / (2 * Math.max(h, 2));
    const Fneed = sh.m * (aReq + g);
    let nEng = 3, Tf = T3;
    for (const n of [1, 2, 3]) {
      const Tn = F.clusterThrust(F.VEH.s2.sl, 1, F.atmosphere(f.alt).p, n).F;
      if (Fneed <= Tn * .95 || n === 3) { nEng = n; Tf = Tn; break; }
    }
    /* ===== TIEP CAN TREO =====
       Du lieu chuyen bay that chi thang ra van de: tau vao toi 13 m roi TROI
       NGUOC RA 70 m trong 11 giay cuoi, trong khi chi ha duoc 8 m. No gan nhu
       da treo san — nhung `maxTilt = h/700` tut xuong 1.7 do o sat cho bat nen
       het sach tham quyen ngang, du mot chut van toc ngang la troi mat.
       TAO DA NOI SAI o lan truoc rang tau khong the treo: luc do tinh voi 3 may.
       Voi MOT may thi luc day 2.165 MN so voi trong luong ~1.7 MN — treo o ~78%
       ga, thoa man muc toi thieu 40%. Tau treo duoc, dung nhu SpaceX lam.
       Nen: duoi 200 m ma con lech thi GIU DO CAO, ha rat cham, va giu nguyen
       tham quyen nghieng de keo ve — thay vi cu ha xuong roi bat luc nhin no
       troi. Dung lai khi con 3 t nhien lieu de con du cham dat.
       Quet du tru 3/6/12/18/26 t x nghieng .14/.20/.28/.36:
         3 t + .20  ->  lech tb 14 m, max 72 m, 0 hong   <- chon
         3 t + .28  ->  lech tb  4 m nhung 4 chuyen het nhien lieu
         12 t + .20 ->  lech tb 45 m (treo qua it)
       So voi truoc khi co pha nay: 149 m -> 14 m. */
    const errH = Math.hypot(f.down, f.cross);
    const eastH = vnorm(vcross(f.rhat, qrot(TQi, V(0, 0, 1))));
    const rateH = Math.hypot(vdot(sh.v, eastH), f.crossRate);
    const near = h < 200 && sh.prop > 3000;
    /* Kep bu duoc REACH m ngang, nen chi lo lung khi lech VUOT qua tam do. */
    const errRel = Math.max(0, errH - TWS.REACH * .8);
    const hovering = near && (errRel > 4 || rateH > 2.0);   // con lech: GIU DO CAO ma keo ve
    const settling = near && !hovering;                   // da vao cho: dung thang, ha nhe
    let throttle;
    if (hovering || settling) {
      /* O pha settling, GIU NGUYEN do cao cho toi khi than that su thang.
         Neu ha ngay thi tau cham khi con nghieng 11 do — vuot nguong 8 do va
         bao VO du lech chi 8-21 m. Do la 4 chuyen hong o lan do truoc. */
      const tiltNow = Math.acos(clamp(vdot(qrot(sh.q, V(0, 1, 0)), f.rhat), -1, 1));
      const vWant = hovering ? -clamp(h / 40, 0, 1.2)
                  : tiltNow > 0.055 ? 0
                  : -clamp(h / 16, 0.8, APR.SETTLE_V);  // kep khop toc do nen ha nhanh duoc
      const aUp = clamp((vWant - f.vu) * 0.9, -6, 6);
      throttle = clamp(sh.m * (g + aUp) / Math.max(Tf, 1), .4, 1);
    } else {
      throttle = clamp(Fneed / Math.max(Tf, 1), .4, 1);
      if (f.vu > .5) throttle = 0;
    }
    /* CHAN TREN cho tGo. Sat mat dat tau xuong rat cham (4-5 m/s) nen
       2h/|v_dung| ra 60-70 giay trong khi thuc te chi con 35 — bo lai tuong
       thua thoi gian, ra lenh qua nhe, va het do cao khi sai so con vai tram
       met. Booster da co chan tren 13 s tu lau; tau thi chua.
       Quet 30/20/14/10/7/5 s: 14 s tot nhat — lech trung binh 250 -> 174 m,
       mua 209 -> 30 m, gio nhe 202 -> 60 m.
       DA THU VA BO (deu do bang 18 chuyen, khong cai nao an thua):
       · Noi tran gia toc 22 -> 40: ket qua GIONG HET, lenh khong he bao hoa.
       · Noi tran nghieng .36 -> .55/.75: te hon (174 -> 179/186).
       · Bu gio trong pha ha: 250 -> 247, gio o day chi dang ~0.3 m/s2.
       · Bu luc can ngang cua suon: te hon (174 -> 182).
       · Lat som hon (+900 m): bon chuyen ve 0-6 m nhung CAN SACH nhien lieu,
         vi ga toi thieu 40% ma treo chi can 18% nen tau khong the lo lung.
       · Nghich dao Newton trong pha chuc ngua: te hon (261 -> 454 m). */
    const tGo = clamp(2 * h / Math.max(Math.abs(f.vu), 5), 1.5, SGC.TGO_CAP);
    // gia toc ngang mong muon trong CA HAI phuong (mat phang + lech ngang)
    const dAx = vnorm(vcross(f.rhat, qrot(TQi, V(0, 0, 1))));
    const dRate = vdot(sh.v, dAx);
    /* LUAT RIENG CHO PHA TREO. Du lieu chuyen bay that cho thay tau DAO DONG
       khi tiep can thap: trong bao tuyet do lech nay ±18 m suot 32 giay ma chi
       ha duoc 10 m. Nguyen nhan la luat tGo — khi treo thi h be nen tGo be,
       he so vi tri 6/tGo^2 vot len, trong khi than tau xoay cham nen lenh toi
       khi thuc hien duoc thi da tre pha. Do la cong thuc cua mot bo dao dong.
       Thay bang PD dat rieng: kp 0.18, kd 1.6 (rat nang giam chan).
       Quet 4 bo he so tren 18 chuyen: 0.18/1.6 cho lech tb 2.1 m va 0 hong;
       bo cu cho 5.1 m va 1 hong.
       DA THU VA BO:
       · Lat gan thap hon (bien 420 -> 300 m) de tiet kiem: co tiet kiem that,
         6-10 t, nhung sinh 1-8 chuyen hong tren 18 — khong dang.
       · CHOT trang thai 'da vao cho' de gio giat khong day nguoc lai: tiet
         kiem 3.6 t nhung lech tb vot tu 2.1 len 69.5 m, vi chot xong la no
         thoi giu do cao, roi troi ma khong con tham quyen ma chua. */
    const aD = hovering ? clamp(-(0.18 * f.down + 1.6 * dRate), -22, 22)
                        : clamp(-(6 * f.down / (tGo * tGo) + 4 * dRate / tGo), -22, 22);
    const aC = hovering ? clamp(-(0.18 * f.cross + 1.6 * f.crossRate), -22, 22)
                        : clamp(-(6 * f.cross / (tGo * tGo) + 4 * f.crossRate / tGo), -22, 22);
    const crossAxis = qrot(TQi, V(0, 0, 1));   // truc lech ngang trong he the gioi
    const aAvail = Math.max(1, Tf * Math.max(throttle, .4) / sh.m);
    /* Treo thi duoc nghieng 0.20 rad de keo ve. Nhung nguong cham cua tau la
       8 do, ma 0.20 rad = 11.5 do — hai chuyen lech chi 6-8 m van bao VO vi
       chua kip dung thang.
       DA THU vuot tran nghieng theo do cao (0.03 + h/700): chua duoc vo that,
       nhung GIET do chinh xac trong giong (WIDE 595-1599 m) vi no cat tham
       quyen dung luc con dang can. Cach dung la tach lam hai buoc: keo ve xong
       HAN o pha treo, roi moi sang pha 'settling' — dung thang va ha nhe. */
    const maxTilt = hovering ? 0.20 : settling ? 0.025 : clamp(h / 700, .03, SGC.TILT_MAX);
    const east = vnorm(vcross(f.rhat, crossAxis));
    const tAx = (hovering || settling) ? .20 : SGC.TILT_MAX;
    let tilt = vadd(vmul(east, clamp(aD / aAvail, -tAx, tAx)), vmul(crossAxis, clamp(aC / aAvail, -tAx, tAx)));
    if (vlen(tilt) > maxTilt) tilt = vmul(vnorm(tilt), maxTilt);
    const nose = vnorm(vadd(f.rhat, tilt));
    /* PHUONG QUANH TRUC DUNG. Muon hai chot ngoi len hai canh tay thi TRUC NOI
       HAI CHOT phai trung truc noi hai tay (= east), va bung quay ve phia thap.
       qFromAxes(x, y) dat than: +x = doi so thu nhat, +z = x cross y. Hai chot
       o ±PIN_AZ so voi +x nen hieu cua chung la thuan +z cua than — tuc TRUC
       CHOT CHINH LA +z. Vay dieu kien la  belly x nose = east, ma trong bo
       (east, nx, nose) truc giao thi nx x nose = east, nen belly = nx.
       DA THU dat belly = east*cos(PIN_AZ) + nx*sin(PIN_AZ): sai 110-90 = 20 do,
       do duoc dung 20.1 do lech giua truc chot va truc tay, va chot truot ra
       ngoai tay 3-9 m. Nham cho: PIN_AZ la phuong vi CHOT tren than, khong
       phai goc quay cua than. */
    const nx = vnorm(vcross(nose, armFrame(sh, f).arm));   // truc tay XOAY theo thap
    return { qCmd: qFromAxes(nx, nose), ext: 0, throttle, nEng };
  }

  /* Dua trang thai 2D da lap ke hoach len 3D, kem LECH NGANG ban dau de bo
     lai buoc phai bank ma keo ve — dung nhu moi chuyen tai nhap that. */
  /* ===== THAP BAT CHU DONG =====
     Do bang tools/terminal.js truoc khi co phan nay: tau xuong toi 200 m tren
     cho bat khi con cach thap 500-970 m, roi LO LUNG bay ngang va cho lech duoi
     4 m moi ha cham <=2.2 m/s xuong DUNG 120 m. Ket qua: 123-157 s duoi 200 m,
     64-79 t nhien lieu — 92% nhien lieu ca chang ha — con 5.5 t khi co gio.
     Thap bi dong: vat ly chi bat khi day tau cham DUNG CATCH_ALT.
     Gio thap co trang thai va dong luc rieng:
       · NANG DON: tau vao chang ha thi xe truot nang toi +40 m, tau khong phai
         ha cham qua 40 m cuoi.
       · BU NGANG: truot +-3.5 m ve phia tau, nen tau khong phai lo lung cho
         toi khi lech duoi 4 m.
       · KHOP TOC DO: 8 m cuoi xe truot di XUONG cung tau o 60% toc do cua no,
         van toc tuong doi luc cham chi con 40%.
     Toi keo va truot ngang deu co gioi han toc do + gia toc (luat phanh). */
  /* MODE: 'hold' = dung san o +MAX; 'match' = 8 m cuoi ha theo tau; 'rise' =
     len DO o MAX-RISE_H tu khi tau FLOP duoi APR.B_TRACK_H, roi MOT lan chay len
     don voi RISE_V khi tau dang ha vao tay (landArc I.go) trong RISE_H + 4 m cuoi.
     CLOSE: toc do khep cuoi (so voi xe truot) cua ho so ha landArc. */
  /* MAX 40 -> 70: nhu video that, kep nang cao de bat SOM — tau khong phai ha
     cham qua 70 m cuoi. Thap tau cao them tuong ung ben phan hinh. */
  const TWS = { MAX: 70, V: 2.6, A: 1.3, REACH: 3.5, VL: 1.4, AL: 1.1,
                MODE: 'rise', MATCH_H: 8, MATCH_K: .6, RISE_H: 8, CLOSE: 1.8, RISE_V: 1 };
  /* ===== DAN HUONG LAT THEO CUNG =====
     Do duoc: tau xuong toi 200 m khi con cach thap 345-990 m, roi phai bay
     ngang sat thap. Cu lat bat dau o hBurn + 420 m va chi lat THANG DUNG —
     khong dung cu lat de keo ve phia thap.
     Nhu video that: lat tu cao hon, va trong luc lat NGHIENG MUI VE PHIA THAP
     de luc day 3 may ve mot duong cung rong toi gan thap.
       FLIP_MARGIN : lat khi con cach hBurn bao nhieu met
       LEAD_MAX    : goc nghieng toi da ve phia thap trong luc lat (rad)
       LEAD_K      : chi khi lat hut (pi <= FA_DOWN): goc = lech ngang * LEAD_K (roi chan
                     LEAD_MAX); con lai LEAD theo sai so van toc FL_KV / FL_V / FL_KT
       TILT_MAX    : tran nghieng khi dot ham
       TGO_CAP     : tran thoi gian con lai cua luat ngang */
  /* FLIP_THR: 'full' = ga 100% suot cu lat (cu); 'need' = ga theo luc can
     m*(v^2/2h + g), toi thieu 40%. Quet dau cho thay lat cao hon +800 m ton
     them ~20 t va +1200 m CAN NHIEN LIEU — nghi ngo la vi ep ga day trong luc
     lat: phanh qua som tren cao roi phai roi cham chong trong luc rat lau. */
  /* FLIP_RATE: tran toc do quay khi lat (rad/s). 0.5 = cu: dung thang trong ~3 s,
     gat. Quay cham hon thi luc day nam ngang lau hon — vua ham vua keo tau theo
     mot duong cung rong, nhu cu lat nhe nhang trong video that. */
  /* Mac dinh chon theo quet (24 chuyen moi dong, seed 777 + 4242, calm/rain/gusty):
       lat+420 full dan0 : lat@675 m, con tb 38.8 t min 33.5 t (mac dinh cu; dan0.4 -> 42 t)
       q.5 (cu, do o lat+700): LAT 2.4 s dinh 28 d/s, cung 14 m — gat
       lat+420 need q.5  : hong 1/6 — con 500 m ma lech 1.3 km, ga vua du khong keo kip
       lat+700 need q.5  : lat@960 m, con tb 37.3 t min 31.8 t
       lat+700 need q.22 : lat@960 m, LAT 4.1 s dinh 15 d/s, cung 60 m, con tb 38.5 t min 33.3 t,
                           LAND 88 s, 24/24 tot
     Quay cham tot hon o moi chi so: luc day nam ngang lau hon nen vua ham vua keo.
     FA_V / FA_DOWN / FA_W / FA_ACC / FA_T / FA_BLEND: can mui truoc lat; FL_KV / FL_V / FL_KT: LEAD theo van toc
     khi lat (xem auto). */
  const SGC = { FLIP_MARGIN: 700, LEAD_MAX: 0.40, LEAD_K: 0.0006, TILT_MAX: 0.36, TGO_CAP: 14, FLIP_THR: 'need',
                FLIP_RATE: .22, FA_T: 3, FA_W: 12 * Math.PI / 180, FA_ACC: 1.8 * Math.PI / 180, FA_BLEND: 1.5, FA_V: 30, FA_DOWN: 50, FL_KV: .3, FL_V: 30, FL_KT: .5 };
  /* ===== HUONG MIENG TAY + CONG TIEP CAN =====
     Do bang tools/approach.js (6 chuyen) truoc khi co phan nay:
       · truc noi hai tay CO DINH theo tam xa, mieng tay mo theo lech ngang; ma
         tau bay ve DOC tam xa -> luc lat tau o ben hong tay, goc toi tb 77 do;
       · belly flop khong sua duoc diem roi: bo du bao biet truoc se VUOT thap
         0.8-1.3 km nhung luat chi xoay 1.7 do goc tan moi km -> lat cach thap
         ~1 km, roi mat ~79 s duoi 200 m moi bat duoc;
       · lat xong truc chot lech truc tay 68-88 do, tau tu xoay 10-25 s moi khop.
     Dieu dung sau: tau troi QUA thap, mui chi NGUOC ve thap; lat thi bung quay
     ve dung huong mui vua chi va luc day day tau quay lai — do chinh la duong
     cung. Chi can MIENG TAY QUAY VE PHIA DO.
       · Thap xoay HAI TANG: xa lan cham (tu PSI0 = mieng tay ve phia SAU thap
         theo tam xa; tau duoi B_TRACK_H va o PHIA MIENG TAY thi bam phuong vi that) + xe truot
         nhanh ±C_MAX bam chinh xac trong luc lat/ha, sat C_HOLD m thi quay VE 0 (C_RET, xem towerSlew).
       · Belly flop nham DIEM LAT cach thap GATE m phia mieng tay (xem auto).
       · Luc lat va luc ha, bung tau duoc lenh quay ve thap (-mieng tay): truc
         chot tu trung truc tay, khong phai xoay quanh than nua.
       · SETTLE_V: toc do ha toi da khi da vao cho (truoc la 3.2 m/s). */
  /* GATE: tam xa DIEM LAT (m, phia mieng tay); ENTRY nham GATE + rangeBias.
     Do 48 chuyen (seed 9001/31337/2718/1234) + thu tai 19 kich ban x 24 chuyen
     (seed 555/8080: sai so gio trong bo du bao, lech ngang +-20 km, nhien lieu
     +-5 t, tam xa 60-300 km, bao/tuyet):
       200: LAND 67.5 s (max 85), con 47.6 t — luat ha 'arc' can tau con du xa.
       250: lat 250 m; khi lang LAND tach hai nhom (6/16 cham hon ban cu toi 14 s);
            thu tai 27 lan lat HUT truoc thap (ban cu 22), gio x1.3 -> con 29.7 t.
       400: lat 400 m MOI chuyen, LAND tb 47.6 max 49.9 s (cu 64.2 / 83.8), con tb
            58.9 min 57.2 t (cu 49.7 / 39.8); TUNG chuyen nhanh hon ban cu >= 7 s va
            du >= 3.8 t. Thu tai: 19 lan hut (cu 22), duoi nhien lieu/LAND bang hoac
            tot hon ban cu o ca 19 kich ban.
     Base: bo du bao tuong luong jet THAP hon that 2 km -> 7/24 lat hut (ban cu 0) vi goc
     tan belly flop cham tran 89 do; nay uoc luong lech bo du bao (xem auto FLOP). Chi xay
     ra khi bo du bao BIET SAI gio; game hien doc gio that. Lat cang sat thap thi cang mat
     le an toan do. */
  const APR = { GATE: 400, AOA_MIN: 60, AOA_MAX: 89,
                /* LECH BO DU BAO (xem auto FLOP). B_*: kenh TROI — B_EMA loc, B_DB vung chet (m / chu ky), B_GAIN, B_TH tam ngoai
                   suy (s), B_ALT tren do bo (gio mo hinh = 0 tren 32 km), B_ESC shift toi thieu de thoat tran. K_*: kenh GIO KHI
                   DONG — K_EMA loc, K_P tien nghiem (m/s)^2, K_DB nguong coi nhu dung, K_MIN san kw (lam yeu toi da 25%; pw13 can .77). */
                B_EMA: .3, B_DB: 2, B_GAIN: .8, B_ESC: 50, B_TH: 30, B_ALT: 30000,
                K_EMA: .1, K_P: .25, K_DB: .95, K_MIN: .75,
                PSI0: Math.PI / 2, B_TRACK_H: 6000,
                B_RATE: 0.5 * Math.PI / 180, B_ACC: 0.02 * Math.PI / 180,
                C_MAX: 0.61, C_RATE: 0.26, C_ACC: 0.3, C_HOLD: 25, C_RET: .05,
                SETTLE_V: 3.2,
                /* LUAT HA 'arc' — THONG NHAT theo thoi gian con lai (xem landArc).
                   NGANG: A_B phanh deu, TAU_T giam gia toc ve 0, V_MAX tran; A_ACC / A_MAX kep lenh doc huong toi tam;
                   K_V / K_T bam toc do / triet van toc vuong goc; T_LEAD lay ff truoc; D_CAP + KP / KD: PD sat tam;
                   D_DB / KD_FIN: PD trong FIN; W_TAU / K_W: loc / he so bu nhieu.
                   DOC (toc do khep so voi xe truot): ho so BAC — loe A_LO toi TWS.CLOSE o H_S, tran V_LO duoi H_SOFT, tran
                   V_MID duoi H_MID, phanh A_D phia tren moi bac; K_Z bam. T_TAIL toi noi sau ngang; A_HOLD / H_HOLD dung cho
                   vao tam; T_WAIT het cho duoi H_HOLD. H_GATE / T_GATE / TILT_GATE: cong tren dai 40 m.
                   NHAN: H_PREC; vao FIN H_FIN, D_FIN, V_FIN, TILT_IN; ra FIN D_FIN_OUT, V_FIN_OUT (khong ra duoi H_COMMIT);
                   D_OK: duoi H_HOLD lech hon thi ha cham. TILT_CATCH / H_TC: tran nghieng giam tu TILT_FIN trong H_TC
                   m cuoi. */
                MODE: 'arc', A_B: 3, TAU_T: 5, V_MAX: 40, A_ACC: 3, A_MAX: 6, K_V: 1, K_T: .8, T_LEAD: 1,
                D_CAP: 3, KP: .18, KD: .8, D_DB: 3, KD_FIN: .8, W_TAU: .5, K_W: 1,
                H_S: 1, A_D: 3, A_LO: 1.5, H_SOFT: 12, V_LO: 2.7, H_MID: 30, V_MID: 4, A_HOLD: 3, H_HOLD: 20, T_TAIL: 5, T_WAIT: 20, K_Z: 1.5, H_GATE: 45, T_GATE: 4, TILT_GATE: .07,
                H_PREC: 5, H_FIN: 40, H_COMMIT: 3, D_FIN: 2.5, V_FIN: 1, D_FIN_OUT: 4.5, D_OK: 2.5, V_FIN_OUT: 2.5, TILT_IN: .03,
                TILT_APP: .36, TILT_PREC: .12, TILT_FIN: .05, TILT_HOLD: .10, TILT_CATCH: .015, H_TC: 20,
                /* CAN BANG BANG RCS — xem landArc. */
                RCS_TRANS: true, RCS_SHARE: .7, RCS_SHARE_NEAR: 1, RCS_SHARE_FIN: 1, RCS_DAMP: .8, RCS_ISP: 300,
                TILT_SLEW: 10 * Math.PI / 180, TILT_SLEW_APP: 1000, TILT_SLEW_VAO: 1000, VAO_T: 6,
                RCS_APP: true, RCS_DAMP_APP: .8 };
  /* Luc NGANG THUAN lon nhat cua RCS: cum mui (canh tay don 22 m) va cum duoi (13 m)
     phut CUNG CHIEU theo ti le 13:22 thi mo-men triet tieu. Cum duoi cham tran
     truoc: F_duoi = rcsF, F_mui = rcsF*13/22 -> tong ~73 kN. */
  const RCS_TMAX = CFG.rcsF * (1 + (CFG.com - CFG.rcsPorts.aft.y) / (CFG.rcsPorts.nose.y - CFG.com));
  const wrapPi = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  /* Truc MIENG TAY (tu cot ra, tro ve phia tau) va truc NOI HAI TAY, he the gioi.
     psi = 0: mieng tay theo +lech ngang, hai tay cach nhau theo tam xa (nhu cu). */
  function armFrame(sh, f) {
    const psi = sh.tw ? sh.tw.psiB + sh.tw.psiC : 0;
    const cA = qrot(TQi, V(0, 0, 1)), eA = vnorm(vcross(f.rhat, cA));
    const c = Math.cos(psi), s = Math.sin(psi);
    return { psi, open: vnorm(vadd(vmul(cA, c), vmul(eA, s))), arm: vnorm(vsub(vmul(eA, c), vmul(cA, s))) };
  }
  const _ts = { x: 0, v: 0 };
  function tServo(x, v, tgt, vmax, amax, dt) {
    const e = tgt - x;
    const vw = (e > 0 ? 1 : -1) * Math.min(vmax, Math.sqrt(2 * amax * Math.abs(e)));
    const dv = vw - v, cap = amax * dt;
    v += dv > cap ? cap : dv < -cap ? -cap : dv;
    x += v * dt;
    if ((tgt - x) * e < 0) { x = tgt; v = 0; }
    _ts.x = x; _ts.v = v; return _ts;
  }
  /* ===== LUAT HA THONG NHAT theo THOI GIAN CON LAI =====
     Luat cu (APP san do cao 0.45*d, PREC PD+I, FIN ha mu vW = h/10): 48 chuyen dev duoi 200 m tb 37.7 s
     (max 40.6), FIN tb 20.9 s chi de ha 40 m cuoi; giong ton 76-86 s vi PREC tran nghieng .12 khong giu noi gio.
     Lac than chi xet theo DAI DO CAO tren xe truot (40-12 m, < 12 m), khong theo nhan APP/PREC/FIN.
     Gio MOT luat tu cuoi cu lat toi luc bat:
       · NGANG: bam HO SO PHANH theo huong toi tam (brakeProf): phanh deu A_B roi giam deu gia toc ve 0 trong
         TAU_T s cuoi, tran V_MAX; lenh = gia toc cua ho so (lay truoc T_LEAD, bu tre nghieng) + K_V (uRef - u),
         van toc vuong goc triet bang K_T, sat tam tron sang PD. Ho so cho luon THOI GIAN CON LAI Tp.
       · NHIEU: gia toc do duoc - luc day - RCS - trong luc = gio + luc can that, loc W_TAU, bu thang vao lenh
         (thay tich phan cham KI .02).
       · DOC (toc do khep hv so voi xe truot): cham nhat trong (1) ho so BAC: tran V_MID duoi H_MID, tran V_LO duoi
         H_SOFT (phanh A_D phia tren moi bac), loe A_LO toi CLOSE o H_S — khong tang toc giua cac bac; (2) toi noi sau
         ngang: giam toc deu toi dat o Tr + T_TAIL; (3) chua vao tam thi phanh dung o H_HOLD; (4) CONG H_GATE.
         Ho so cu (A_D toi H_SOFT roi A_LO toi CLOSE): qua 30 m o 7.1-9.2 m/s, 12 m o 4.9-5.4 m/s (quick 12 chuyen) va
         vao FIN o 38 m thi vW nhay 9.1 -> 13.9 (tang toc ha, 777#2): lao vao tay.
       · NHAN: APP = bam ho so; FIN = duoi H_FIN, da vao tam (< D_FIN m, < V_FIN m/s) va than thang so voi goc
         phai nghieng de giu gio; PREC = chi khi phai GIU DO CAO cho vao tam hoac bi day ra khoi FIN.
       · CONG (tren H_FIN): Tr > T_GATE hoac nghieng > goc giu gio + TILT_GATE thi phanh giu H_GATE — bat ngang
         xong moi vao dai 40-12 m.
     Do ban chot (shipeval, so voi base): dev 48 (777/4242/555/8080) LAND tb 29.3 s (max 30.8; base 47.3 / 50.8), duoi
     200 m 20.1 s (max 20.5; base 37.7 / 40.6), con tb 69.4 t (min 68.1; base 59.0 / 56.9); toc do khep LON NHAT trong
     dai 30-12 m 4.04 m/s, duoi 12 m 2.74 m/s; duoi 50 m min 11.8 s, duoi 12 m max 4.7 s; xe truot dung o 62 m khi tau
     qua 50 m va len don 1.00 m/s luc cham; lac 40-12 m max 1.27 do, lech 0.00 m, vao LAND lech ngang max 6.6 m (base
     68.3). 48 chuyen seed moi 9191/9292/9393/9494: LAND 29.3 s (base 47.6), duoi 200 m 20.1 s (base 38.0), con 69.4 t
     (base 58.9). Gio xau 16 (555/8080): LAND tb 28.8 (max 30.9; base 58.1 / 86.4), duoi 200 m 20.4 / 21.6 s, khep
     4.26 / 2.75 m/s, lech max 0.14 m (base 2.55), nghieng cham max 1.15 do (base 4.03); giong 12 (7373/8484) LAND 28.3 s
     (base 80.0), con 75.9 t (base 46.3). dp5 24: LAND 29.6 / 31.0 s (base 48.8 / 52.7), duoi 200 m 20.3 / 20.7 s, con
     64.9 / 63.7 t (base 54.2 / 52.2).
     Doi lai: than nghieng nhieu hon khi phanh o 200-40 m (rms max 10.1 do, base 3.9).
     DA THU VA BO:
       · Quy dao bac 4 (van toc + gia toc cuoi = 0), T nho nhat de dinh gia toc <= 3 m/s2: lech ngang 19 m/s can
         T >= 6v/A = 39 s -> luat gan nhu thu dong, qua thap 32 m ve phia cot (h 105 m), LAND 45.7 s.
       · ZEM/ZEV a = -6x/T^2 - 4v/T, T = bang-bang tung truc: LAND 23.7-30.4 s nhung phanh manh nhat DUNG luc toi
         noi, vao PREC/FIN con nghieng 13-17 do (mua FIN cu 0.13 do).
       · PREC = d < 4 m: trung duoi ho so phanh, lac 7.43 do (cu 6.31).
       · Chan vao FIN khi goc giu gio > 1.5 do (doi luc lang gio): giong do hon nhung bao tuyet treo 8 s o 19 m,
         PREC 2.99 do (cu 2.14); nguong 3 do thi y het tat.
       · PD trong FIN keo lech > 1.5 m: giong ton ~1.3 do nghieng de keo lech 2.8 m ma xe truot tu bu -> vung chet 3 m.
       · Tran nghieng FIN .06 thay .07: giong 2.77 / 2.57 do, khong doi gi.
       · Chi doi nhan PREC (khi duong giu ham < 3 m/s): bao tuyet van 1.13 do (cu 0.18); noi V_FIN .6 -> 1 thi het treo.
       · FIN co gio: aUp >= -1 (khong giam luc day khi vao FIN): gusty 777#6 1.38 -> 1.34, 8080#3 1.51 -> 1.57.
       · Tran nghieng truoc FIN giam dan theo thoi gian toi H_FIN: gusty khong doi, blizzard 777#6 duoi 12 m 6.0 s.
       · Cong chi theo Tr (khong xet nghieng; do tren ban synth con K_WS): pw13 1357#3 van 6.71 do; blizzard 1357#2
         3.57 -> 3.82 (> 3.66). TILT_GATE .10: nhu .07, lang nhanh hon 0.1 s — giu .07.
       · Diem ngam NGUOC gio 2 m (theo tWind, loc 3 s) cho ca luat ngang: lech 3141#2 0.28 m nhung gio lang dot
         ngot + bu gio tre -> vot nguoc gio 3.8 m, bao tuyet duoi 12 m 5-6 s, nghieng cham 0.95, gusty b40 1.35.
       · San tran nghieng sat dat .025 (thay .015) khi du bao troi: 3141#2 lech 0.74 nhung nghieng cham 1.66 (lim 2).
       · (ban nay, polish/NOTES.md) Loe A_LO khong gioi han duoi H_SOFT: gioi han ca doan 270 -> 50 m (vW 28.4 o 270 m).
       · T_TAIL 3 (ban chot, quick 777/4242 x 6): duoi 200 m 20.38 s (T_TAIL 5: 20.13), lac 40-12 m max 1.19 do
         (T_TAIL 5: 0.84) — toi cong 45 m som roi cho; T_TAIL 4.5 khong nhanh hon 5 (polish/NOTES.md).
       · Noi sau theo thoi gian ho so (profT / (Tr + T_TAIL)): toi cong som roi cho, quick duoi 200 m 22.9 s, 6 vi pham lac 40-12 m;
         giong duoi 200 m 45 s, lech 3.31 m.
       · A_B 3.5 / TAU_T 3.5, A_B 3.3 / TAU_T 3: quick duoi 200 m 19.5-19.8 s nhung giong: lech 2.10 m, duoi 12 m 19.5 s,
         lac 40-12 m 7.49 do; A_B 4: phanh can ~22 do > TILT_APP, lac 40-12 m quick toi 6.6 do.
       · V_MID 4.2: giong khep 30 m 4.49 m/s (lim 4.5).
       · (ban synth) Ho so ket thuc o CLOSE 1.8 + doan A_LO duoi 12 m thay 2.3 m/s mot doan A_D: 48 chuyen dev vs max
         2.24 -> 1.85, duoi 50 m min 6.8 -> 7.9 s — giu. H_FIN 52 thay 40: blizzard lac 40-12 m 3.90 -> 2.96 nhung gusty
         777#6 1.38 -> 1.58 — giu 40. K_WS 25 + S_WMIN .3: gusty lac 40-12 m 0.71 / 1.03 nhung +1.5 s moi chuyen giat.
       · Ha cham theo gio trong FIN (K_WS 20): voi ho so bac khong can cho lac 40-12 m (bo: quick max .84, gio xau 2.51
         do, deu trong lim) va ton duoi 200 m +0.16 s quick / +0.44 s gio xau.
       · CHAN TROI (du bao troi > REACH thi phanh A_D toi H_S, bo ha cham theo gio; ban nay nha tre GUARD_OFF .7): ho so
         bac cam ha nhanh duoi 30 m (khep <= 4.5 / 3.0 m/s) nen chot chi con bo K_WS — bo cung K_WS. Gio xau 16 chuyen
         khong chot: lech max 0.14 m. */
  /* HO SO PHANH theo khoang cach x toi tam. Tra [toc do tham chieu, du/dx, thoi gian con lai] vao _pb
     (khong cap phat moi buoc). Doan giam deu: a = A tau/TAU_T, u = A tau^2/(2 TAU_T), x = A tau^3/(6 TAU_T). */
  const _pb = [0, 0, 0];
  function brakeProf(x) {
    const A = APR.A_B, tt = APR.TAU_T, ut = A * tt / 2, xt = A * tt * tt / 6;
    if (x <= xt) { const tau = Math.cbrt(6 * tt * Math.max(0, x) / A); _pb[0] = A * tau * tau / (2 * tt); _pb[1] = 2 / Math.max(tau, .3); _pb[2] = tau; return _pb; }
    const xc = xt + (APR.V_MAX * APR.V_MAX - ut * ut) / (2 * A);
    if (x <= xc) { const u = Math.sqrt(ut * ut + 2 * A * (x - xt)); _pb[0] = u; _pb[1] = A / u; _pb[2] = tt + (u - ut) / A; return _pb; }
    _pb[0] = APR.V_MAX; _pb[1] = 0; _pb[2] = tt + (APR.V_MAX - ut) / A + (x - xc) / APR.V_MAX; return _pb;
  }
  function landArc(sh, f, F, g, h) {
    const cA = qrot(TQi, V(0, 0, 1)), eA = vnorm(vcross(f.rhat, cA));
    const vD = vdot(sh.v, eA), vC = f.crossRate;
    const d = Math.hypot(f.down, f.cross), vh = Math.hypot(vD, vC);
    const H = Math.max(0, h), hv = f.vu - (sh.tw ? sh.tw.vy : 0);          // toc do khep doc so voi xe truot
    const noseNow = qrot(sh.q, V(0, 1, 0));
    const tiltNow = Math.acos(clamp(vdot(noseNow, f.rhat), -1, 1));
    /* Buoc thoi gian cua bo lai (auto khong nhan dt): lay tu dong ho tau. Khoang lan goi >= .1 s (cham tran dtA: dung
       game, goi lai sau quang nghi) thi bo mot lan cap nhat uoc luong nhieu va lay lai mau van toc — chia dv ca quang
       cho .1 s se vot. */
    const gapA = sh.arcT === undefined ? 0 : sh.t - sh.arcT;
    const dtA = Math.min(.1, Math.max(0, gapA)); sh.arcT = sh.t;
    if (!sh.arcI) sh.arcI = { t0: sh.t, st: 0, wD: 0, wC: 0, wU: 0, vp: null, rp: null, thr: 0, ne: 0, wait: 0, go: false };
    const I = sh.arcI, Pa = F.atmosphere(f.alt).p;
    /* UOC LUONG NHIEU: gia toc do duoc - luc day (truc than hien tai = truc cua buoc vua tich phan; ga / so may
       = LENH buoc truoc, la lenh da tich phan) - RCS buoc truoc + trong luc = gio + luc can + luc nang that. */
    if (I.vp && gapA > 0 && gapA < .1) {
      const aT = I.ne > 0 ? F.clusterThrust(F.VEH.s2.sl, I.thr, Pa, I.ne).F / sh.m : 0;
      let a = vsub(vmul(vsub(sh.v, I.vp), 1 / dtA), vmul(noseNow, aT));
      if (I.rp) a = vsub(a, vmul(vsub(I.rp, vmul(noseNow, vdot(I.rp, noseNow))), 1 / sh.m));
      const k = Math.min(1, dtA / APR.W_TAU);
      I.wD += (vdot(a, eA) - I.wD) * k; I.wC += (vdot(a, cA) - I.wC) * k; I.wU += (vdot(a, f.rhat) + g - I.wU) * k;
    }
    I.vp = vcopy(sh.v);
    // --- GIAI DOAN (sh.arc): FIN khi than thang so voi goc phai nghieng de giu gio (RCS da ganh het phan co the) ---
    const rFin = APR.RCS_SHARE_FIN * RCS_TMAX / sh.m;
    const tWind = Math.max(0, Math.hypot(I.wD, I.wC) - rFin) / Math.max(1, g);
    if (I.st !== 2 && H < APR.H_FIN && d < APR.D_FIN && vh < APR.V_FIN && tiltNow < APR.TILT_IN + tWind) I.st = 2;
    else if (I.st === 2 && H > APR.H_COMMIT && (d > APR.D_FIN_OUT || vh > APR.V_FIN_OUT)) I.st = 1;   // duoi H_COMMIT: da cham tay, khong quay lai giu do cao
    const tCapFin = APR.TILT_CATCH + (APR.TILT_FIN - APR.TILT_CATCH) * clamp(H / APR.H_TC, 0, 1);
    // --- NGANG: bam ho so phanh theo huong toi tam + triet van toc vuong goc; sat tam PD ---
    const ux = d > 1e-3 ? f.down / d : 0, uz = d > 1e-3 ? f.cross / d : 0;
    const vr = vD * ux + vC * uz, u = -vr;                              // u > 0: dang toi tam
    let pb = brakeProf(d);
    const uRef = pb[0], Tp = pb[2];
    pb = brakeProf(Math.max(0, d - Math.max(0, u) * APR.T_LEAD));       // ff lay truoc T_LEAD (tre nghieng)
    const dU = clamp(-Math.max(0, u) * Math.min(pb[1], 3) + APR.K_V * (uRef - u), -APR.A_MAX, APR.A_ACC);
    let aD = -dU * ux - APR.K_T * (vD - vr * ux), aC = -dU * uz - APR.K_T * (vC - vr * uz);
    const wCap = clamp(d / APR.D_CAP - 1, 0, 1);                        // D_CAP..2 D_CAP: tron sang PD
    if (wCap < 1) { aD = wCap * aD - (1 - wCap) * (APR.KP * f.down + APR.KD * vD); aC = wCap * aC - (1 - wCap) * (APR.KP * f.cross + APR.KD * vC); }
    if (I.st === 2) {                                                   // FIN: xe truot bu +-REACH -> chi keo vi tri ngoai D_DB
      const kp = d > APR.D_DB ? APR.KP * (d - APR.D_DB) / d : 0;
      aD = -(kp * f.down + APR.KD_FIN * vD); aC = -(kp * f.cross + APR.KD_FIN * vC);
    }
    aD -= APR.K_W * I.wD; aC -= APR.K_W * I.wC;
    const Tr = Tp + Math.max(0, uRef - u) / (2 * APR.A_ACC);            // thoi gian ngang con lai (cho truc doc)
    const fin = I.st === 2;
    /* HET CHO: duoi H_HOLD gan dung yen cong don qua T_WAIT s thi ha theo ho so voi tran nghieng FIN — khong treo vo han
       cho gio lang. I.go = FIN hoac het cho: xe truot len don (towerStep).
       KHONG co nhanh "het nhien lieu" rieng: forces() van day khi binh rong, nen luat thuong (giu 20 m / cong 45 m, het cho
       T_WAIT) bat chinh xac hon. Do 777#1 lang thieu 78/82/84/86/90 t: lech 0.00/0.00/1.59/5.25/3.11 m (base 0.00);
       4242 x 3 thieu 84 t: 0.67/0.00/1.05 (base 0.00/0.00/0.96); bao + bao tuyet 555 x 4 thieu 84 t: 38-69 m (base 318-528).
       DA THU VA BO: (1) het nhien lieu o MOI do cao = ha theo ho so, tran nghieng FIN (ban polish): thieu 82 / 84 t lech
       6.14 / 17.24 m, xe truot khong len; (2) tren H_HOLD van keo ngang, duoi H_HOLD ho so FIN: 82 t 0.00 nhung 84 t
       14.57 m (het RCS khi con < 500 kg, tran nghieng FIN khong keo noi); (3) bo cho, giu luat ngang + nhip ha, san 1.5
       m/s: 84 / 86 t VO, nghieng cham 15.1 / 13.9 do; (4) ha cham nhu base (h/10, <= SETTLE_V) + luat ngang: 82 t 6.66 m,
       90 t 27.5 m, bao tuyet VO. */
    if (H < APR.H_HOLD && Math.abs(hv) < .5) I.wait += dtA;
    const commit = H < APR.H_HOLD && I.wait > APR.T_WAIT;
    I.go = fin || commit;
    // --- DOC: cham nhat trong ho so BAC / toi noi sau ngang T_TAIL / dung o H_HOLD / cong (xem dau muc) ---
    const vT = TWS.CLOSE;
    const vFl = Math.sqrt(vT * vT + 2 * APR.A_LO * clamp(H - APR.H_S, 0, APR.H_SOFT - APR.H_S) + 2 * APR.A_D * Math.max(0, H - APR.H_SOFT));
    const vLo = H > APR.H_SOFT ? Math.sqrt(APR.V_LO * APR.V_LO + 2 * APR.A_D * (H - APR.H_SOFT)) : APR.V_LO;
    const vMid = H > APR.H_MID ? Math.sqrt(APR.V_MID * APR.V_MID + 2 * APR.A_D * (H - APR.H_MID)) : APR.V_MID;
    let vW = Math.min(vFl, vLo, vMid);
    let aW = vW === vMid ? (H > APR.H_MID ? APR.A_D : 0) : vW === vLo ? (H > APR.H_SOFT ? APR.A_D : 0) : (H > APR.H_S ? APR.A_LO : 0);
    if (commit) { /* het cho */ }
    else if (!fin) {
      {
        const vHold = Math.sqrt(2 * APR.A_HOLD * Math.max(0, H - APR.H_HOLD));
        if (vHold < vW) { vW = vHold; aW = vHold > 0 ? APR.A_HOLD : 0; if (I.st === 0 && H < APR.H_HOLD + APR.H_PREC) I.st = 1; }   // PREC: dang GIU do cao cho vao tam
        // CONG: ngang chua xong / than chua thang thi chua vao dai 40-12 m
        if (H > APR.H_FIN && (Tr > APR.T_GATE || tiltNow > tWind + APR.TILT_GATE)) { const vG = Math.sqrt(2 * APR.A_HOLD * Math.max(0, H - APR.H_GATE)); if (vG < vW) { vW = vG; aW = vG > 0 ? APR.A_HOLD : 0; } }
      }
      const Tc = Tr + APR.T_TAIL, vTm = Math.max(0, 2 * H / Tc - vT);
      if (vTm < vW) { vW = vTm; aW = Math.max(0, 2 * (H - vT * Tc) / (Tc * Tc)); }
    } else if (tiltNow > APR.TILT_HOLD && H < APR.H_HOLD) { vW = 0; aW = 0; }
    else if (H < APR.H_HOLD && tWind < tCapFin) {                                           // duoi H_HOLD: lech ngang lon thi ha cham lai
      const kd = clamp((APR.D_FIN_OUT - d) / (APR.D_FIN_OUT - APR.D_OK), 0, 1);
      vW *= kd; aW *= kd;
    }
    const aFF = vW > .5 ? aW * clamp(-hv / vW, 0, 1.5) : 0;             // gia toc cua chinh duong tham chieu
    /* XE TRUOT NANG DON (dieu kien y het towerStep) tang toc len RISE_V voi TWS.A trong ~.8 s: khong bu thi vong K_Z tre
       va toc do khep vot ngay duoi 12 m (moc 12 m doc 2.7 nhung dinh 3.30 m/s, quick 777/4242 x 6). Bu truoc: tau giam
       toc do ha dung bang gia toc cua xe -> dinh 2.74 m/s, duoi 200 m 19.89 -> 20.13 s. */
    const twRel = sh.tw ? Math.hypot(f.down - sh.tw.ex, f.cross - sh.tw.ez) : 1e9;
    const aTw = TWS.MODE === 'rise' && I.go && H <= TWS.RISE_H + 4 && twRel < 3 && sh.tw.vy < TWS.RISE_V
      ? Math.min(TWS.A, (TWS.RISE_V - sh.tw.vy) / Math.max(dtA, .02)) : 0;
    const aUp = clamp((-vW - hv) * APR.K_Z + aFF + aTw, -6, 8);
    const aTh = Math.max(1, g + aUp - APR.K_W * I.wU);
    const near = I.st > 0 || d < 2 * APR.D_CAP;
    /* FIN / het cho: tran nghieng giam tuyen tinh TILT_FIN -> TILT_CATCH trong H_TC m cuoi (than tre ~1 s): tau troi,
       xe truot bu ngang. Nghieng cham max dev 48 0.98 do, wx 16 1.15 do (base 4.03), dp5 24 0.19 do (base 2.34). */
    const tMax = fin || commit ? tCapFin
               : near ? APR.TILT_PREC : APR.TILT_APP;
    /* ===== CAN BANG BANG RCS =====
       Do bang tools/wobble.js truoc khi co phan nay: sat thap lenh nghieng DAO kich
       tran +6.9 -> -6.9 do trong ~1 s, than tau bam tre 2-3 s (goc 0.8 rad/s moi
       rad, gimbal ~7 do/s) — vong vi tri gap tre pha thanh dao dong 0.11-0.17 Hz.
       RCS thi NGOI KHONG (0% thoi gian). Goc re: giam chan van toc KD 1.6 s^-1
       (hang so thoi gian 0.6 s) NHANH HON than tau nghieng theo (~1.25 s).
       Lam: RCS DUOC UU TIEN — gia toc ngang can <= RCS_SHARE*73 kN/m thi RCS ganh
       het, than giu thang dung, chi phan vuot moi phai nghieng; RCS giam chan SAI
       toc do quay; voi khi nong an tu BON CHINH (Isp 300) — binh RCS rieng 900 kg
       khong du, va muc tieu cu ngam Isp > 1000 s.
       Luat thong nhat: sat thap (d < 2 D_CAP) va FIN dung CA 73 kN (RCS_SHARE_NEAR/FIN 1) de it nghieng giu gio;
       gioi han doi lenh nghieng sat thap 6 -> 10 do/s: bat tam nhanh hon, bao tuyet het treo cho vao FIN.
       Du tru mo-men .85 (RCS_SHARE_NEAR / FIN) thu lai: dev 8080#3 gusty lac 40-12 m 1.27 -> 1.53 do (lim 1.38) — giu 1.
       DA THU VA BO:
         · Loc thap lenh nghieng 2.5 s + RCS bu phan nghieng chua kip tao: can tam
           51-100 s, binh RCS CAN o 3/6 chuyen, nghieng luc cham 2.8 do.
         · Gioi han toc do doi lenh nghieng khi tiep can / 3-6 s sau cu lat (8-20
           do/s): cu xoay sau lat em hon (12 -> 8.6 do) nhung QUA DO TRAN sang doan
           tiep can, lac tang 1.3 -> 2.0-2.6 do. Chi gioi han SAT THAP. */
    let rD = 0, rC = 0, rcsF = null;
    if (APR.RCS_TRANS && (near || APR.RCS_APP) && sh.prop > 500) {
      const rMax = fin ? rFin : (near ? APR.RCS_SHARE_NEAR : APR.RCS_SHARE) * RCS_TMAX / sh.m, al = Math.hypot(aD, aC);
      const kR = al > rMax ? rMax / al : 1;
      rD = aD * kR; rC = aC * kR;
      rcsF = vadd(vmul(eA, rD * sh.m), vmul(cA, rC * sh.m));
    }
    I.rp = rcsF;                                                        // allocate() ap dung dung dieu kien nay (prop > 500)
    let txT = (aD - rD) / aTh, tzT = (aC - rC) / aTh;
    const tlT = Math.hypot(txT, tzT);
    if (tlT > tMax) { txT *= tMax / tlT; tzT *= tMax / tlT; }
    if (I.tx === undefined) { I.tx = vdot(noseNow, eA); I.tz = vdot(noseNow, cA); }
    const vao = sh.t - I.t0 < APR.VAO_T;                                // vai giay dau sau cu lat
    const sl = (vao ? APR.TILT_SLEW_VAO : near ? APR.TILT_SLEW : APR.TILT_SLEW_APP) * dtA;
    const ddx = txT - I.tx, ddz = tzT - I.tz, ddl = Math.hypot(ddx, ddz);
    if (ddl > sl) { I.tx += ddx * sl / ddl; I.tz += ddz * sl / ddl; } else { I.tx = txT; I.tz = tzT; }
    const tx = I.tx, tz = I.tz, tl = Math.hypot(tx, tz);
    const nose = vnorm(vadd(f.rhat, vadd(vmul(eA, tx), vmul(cA, tz))));
    const Fneed = sh.m * aTh / Math.cos(Math.min(tl, .6));
    let nEng = 3, Tn = 1;
    for (const n of [1, 2, 3]) {
      Tn = F.clusterThrust(F.VEH.s2.sl, 1, Pa, n).F;
      if (Fneed <= Tn * .95 || n === 3) { nEng = n; break; }
    }
    let throttle = clamp(Fneed / Math.max(Tn, 1), .4, 1);
    if (f.vu > 2 && !fin) throttle = 0;
    I.thr = throttle; I.ne = nEng;
    sh.arc = fin ? 'FIN' : I.st === 1 ? 'PREC' : 'APP';
    sh.arcDbg = { d, Tr, vW, tilt: tiltNow, aD, aC, aUp, tx, tz, rD, rC, wD: I.wD, wC: I.wC, wU: I.wU };
    const nx = vnorm(vcross(nose, armFrame(sh, f).arm));
    return { qCmd: qFromAxes(nx, nose), ext: 0, throttle, nEng, rcsF, rcsDamp: near ? APR.RCS_DAMP : APR.RCS_DAMP_APP, hotGas: true };
  }
  function towerSlew(sh, dt, f, F) {
    const tw = sh.tw; if (!tw) return;
    const dist = Math.hypot(f.down, f.cross), brg = Math.atan2(f.down, f.cross);   // phuong vi tau nhin tu thap
    const hT = f.alt - (F.CATCH_ALT + tw.y);
    const act = sh.phase === 'FLOP' || sh.phase === 'FLIP' || sh.phase === 'LAND';
    /* Hinh ve tay quay quanh COT THAP (tay 28.7 m): con psiC luc bat thi mieng tay lech 28.7*sin(psiC) ma xe truot hinh
       chi truot +-3.5 m -> tay khong khoa (twCapture dung o BAM). Hai sua:
       (1) sa lan chi bam phuong vi khi tau o PHIA MIENG TAY: tau bay qua dau thap (tu sau ra truoc) keo sa lan quay ~15 do
           roi xe truot phai quay nguoc lai. Mot minh: |psiC| luc cham tb 7.2 -> 4.2 do nhung max 15.6 (quick 777/4242 x 6).
       (2) tau trong C_HOLD m thi xe truot quay VE 0 voi C_RET (tau tu xoay chot theo).
       Ca hai, do quick 777/4242 va 555/8080 x 6, bao/bao tuyet 555 x 4: |psiC| luc cham tb 7.2 / 11.4 / 8.0 do (max 17.1,
       base max 11.2) -> 0.0; lech phuong chot max 0.06 do; LAND, lech, lac, toc do khep, nhien lieu khong doi. */
    if (act && hT < APR.B_TRACK_H && dist > 60 && Math.cos(brg - tw.psiB) > 0) {   // chi bam khi tau o PHIA MIENG TAY
      const r = tServo(tw.psiB, tw.wB, tw.psiB + wrapPi(brg - tw.psiB), APR.B_RATE, APR.B_ACC, dt);
      tw.psiB = wrapPi(r.x); tw.wB = r.v;
    } else {
      tw.wB -= clamp(tw.wB, -APR.B_ACC * dt, APR.B_ACC * dt); tw.psiB = wrapPi(tw.psiB + tw.wB * dt);
    }
    if ((sh.phase === 'FLIP' || sh.phase === 'LAND') && dist > APR.C_HOLD) {
      const r = tServo(tw.psiC, tw.wC, clamp(wrapPi(brg - tw.psiB), -APR.C_MAX, APR.C_MAX), APR.C_RATE, APR.C_ACC, dt);
      tw.psiC = r.x; tw.wC = r.v;
    } else if (sh.phase === 'LAND') {
      const r = tServo(tw.psiC, tw.wC, 0, APR.C_RET, APR.C_ACC, dt);        // sat thap: xe truot quay VE truc thap
      tw.psiC = r.x; tw.wC = r.v;
    } else {
      tw.wC -= clamp(tw.wC, -APR.C_ACC * dt, APR.C_ACC * dt);
      tw.psiC = clamp(tw.psiC + tw.wC * dt, -APR.C_MAX, APR.C_MAX);
    }
  }
  function towerStep(sh, dt, f, F) {
    const tw = sh.tw; if (!tw) return;
    const hShip = f.alt - (F.CATCH_ALT + tw.y);
    /* LEN DO SOM: 0 -> MAX - RISE_H mat ~26 s (V 2.6, A 1.3). Ban cu chi chay tu FLIP (tu lat toi cham nay ngan hon thoi gian xe len): qua
       50 m xe con len 2.6 m/s (twY 54.8-58.1, quick), dung roi lai len don. Nay chay tu khi tau FLOP duoi B_TRACK_H
       (cung luc thap bat dau xoay): qua 50 m xe da dung o 62 m moi chuyen (dev 48, wx 16, dp5 24, 3333 8: twVy 0,
       twY 62). He qua: nguong lat tinh tu xe truot nen tau lat cao hon ~62 m (do cao lat tb dev 1014 m, base 952). */
    if (sh.phase !== 'LAND' && sh.phase !== 'FLIP' && !(sh.phase === 'FLOP' && hShip < APR.B_TRACK_H)) return;   // chua toi: nghi
    const rel = Math.hypot(f.down - tw.ex, f.cross - tw.ez);      // lech so voi kep
    let vCmd = null, yT = TWS.MAX;
    if (TWS.MODE === 'match' && hShip <= TWS.MATCH_H) vCmd = clamp(f.vu * TWS.MATCH_K, -TWS.V, 0);
    if (TWS.MODE === 'rise') {
      yT = TWS.MAX - TWS.RISE_H;
      /* Tau dang ha vao tay (landArc I.go: FIN hoac het cho / het nhien lieu) va con cach it: CHAY LEN DON voi toc
         do co dinh RISE_V; luat ha tu khep so voi xe truot. Base clamp(CLOSE + vu, 0, V) ra 0 khi tau ha nhanh hon
         CLOSE nen xe dung yen. Het dieu kien giua chung (tau bi day khoi FIN, lech >= 3 m) thi xe DUNG TAI CHO (vCmd 0),
         khong ha lai ve do cao do va khong keo tiep len toi MAX.
         Do dev 48: xe len luc cham 1.00 m/s moi chuyen (base 0.90), |vs| max 1.81 (base 1.80). */
      const goOk = sh.arcI ? sh.arcI.go : APR.MODE !== 'arc';          // MODE 'old' khong co landArc: len don nhu base
      if (hShip <= TWS.RISE_H + 4 && rel < 3 && goOk) vCmd = TWS.RISE_V;
      else if (tw.y > yT + .01) vCmd = 0;                                 // da len don ma mat dieu kien: DUNG tai cho, khong ha lai
    }
    if (vCmd === null) {
      const r = tServo(tw.y, tw.vy, yT, TWS.V, TWS.A, dt); tw.y = r.x; tw.vy = r.v;
    } else {
      tw.vy += clamp(vCmd - tw.vy, -TWS.A * dt, TWS.A * dt);
      tw.y += tw.vy * dt;
    }
    if (tw.y < 0) { tw.y = 0; tw.vy = Math.max(0, tw.vy); }
    if (tw.y > TWS.MAX) { tw.y = TWS.MAX; tw.vy = Math.min(0, tw.vy); }
    const near = hShip < 200;
    let r = tServo(tw.ex, tw.vex, near ? clamp(f.down, -TWS.REACH, TWS.REACH) : 0, TWS.VL, TWS.AL, dt);
    tw.ex = r.x; tw.vex = r.v;
    r = tServo(tw.ez, tw.vez, near ? clamp(f.cross, -TWS.REACH, TWS.REACH) : 0, TWS.VL, TWS.AL, dt);
    tw.ez = r.x; tw.vez = r.v;
  }

  function fromPlan(p2, F, crossKm) {
    const cz = (crossKm === undefined ? 38 : crossKm) * 1000;
    const sh = {
      t: 0,
      p: V(p2.x, p2.y, cz),
      v: V(p2.vx, p2.vy, -cz * 3.5e-4),
      m: p2.m, prop: p2.prop, rcs: CFG.rcsTank,
      w: V(0, 0, 0), flap: [.5, .5, .5, .5], ext: .5, tuck: 0,
      phase: 'ENTRY', alive: true, outcome: null, pi: 0, hBurn: 0, flipT: 0,
      // ENTRY nham diem lat o APR.GATE + rangeBias (predictFlip, belly flop 80 do).
      // Ban giao NGAN 1.5 km vi FLOP keo XA them (xuong 60 do) de hon keo NGAN lai
      // (len 89 do). Do seed 9001: +3000 -> lat 1549-1804 m, LAND 88-109 s;
      // -6000 -> lat -137..251 m (giat lat TRUOC thap); -800 (dev) -> giat can > 89
      // do, lat 265-274 m.
      rangeBias: -1500,
      throttle: 0, nEng: 0, eff: '—', bank: 0, aoa: 0, plan: p2.plan,
      Tb: T_AMB, Tl: T_AMB, Th: [T_AMB, T_AMB, T_AMB, T_AMB],
      dmg: 0, hingeDmg: [0, 0, 0, 0], qdot: 0, burn: null,
      tw: { y: 0, vy: 0, ex: 0, ez: 0, vex: 0, vez: 0,      // thap bat chu dong
            psiB: APR.PSI0, wB: 0, psiC: 0, wC: 0 },          // huong xa lan + goc xe truot
    };
    // vao diem tai nhap con chi mui ve truoc -> RCS phai xoay sang the bung-truoc
    const f = frame(sh, F);
    sh.q = attitudeCmd(f, ENTRY_AOA - 0.62, 0);
    return sh;
  }

  /* Phan bo mo-men cho co cau: FLAP (pitch+roll), GIMBAL (pitch+yaw), RCS (ca ba).
     Gimbal khong the tao ROLL vi luc day nam doc truc — dung nhu ngoai doi. */
  function allocate(sh, cmd, F, dt) {
    const f = frame(sh, F);
    const A = F.atmosphere(f.alt);
    const qd = .5 * A.rho * f.speed * f.speed;
    const I = inertia(sh.m);

    const qCmd = cmd.qCmd || attitudeCmd(f, cmd.aoa, cmd.bank || 0);
    const qe = qmul(qconj(sh.q), qCmd);
    let ax = V(qe.x, qe.y, qe.z), w0 = qe.w;
    if (w0 < 0) { ax = vmul(ax, -1); w0 = -w0; }
    const s = vlen(ax);
    const err = s > 1e-9 ? vmul(vmul(ax, 1 / s), 2 * Math.atan2(s, w0)) : V(0, 0, 0);
    // roll co quan tinh nho hon 21 lan -> he so cao hon
    const wm = cmd.wMax || .5;   // tran toc do quay pitch/yaw; cu lat co the xin cham hon
    const wWant = V(clamp(err.x * .8, -wm, wm), clamp(err.y * 1.6, -1.4, 1.4), clamp(err.z * .8, -wm, wm));
    const dw = vsub(wWant, sh.w);
    const tau = V(I.x * clamp(dw.x * 2.0, -2, 2), I.y * clamp(dw.y * 3.0, -6, 6), I.z * clamp(dw.z * 2.0, -2, 2));

    // --- flap ---
    const kf = qd * CFG.sFlap * CFG.cdFlap;
    let pitchU = 0, rollU = 0, usedFlap = false;
    if (kf > 150 && !cmd.tuckAll) {
      pitchU = clamp(tau.z / (kf * 61), -.5, .5);
      rollU = clamp(-tau.y / (kf * 17.2), -.5, .5);
      usedFlap = Math.abs(pitchU) + Math.abs(rollU) > .02;
    }
    const base = cmd.ext === undefined ? .5 : cmd.ext;
    let sy = 0, sz = 0;
    for (let i = 0; i < 4; i++) {
      const fl = CFG.flaps[i];
      sh.flap[i] = clamp(base * (1 - (sh.tuck || 0)) + pitchU * fl.fore + rollU * fl.right, 0, 1);
      sy += sh.flap[i] * fl.r.z; sz += sh.flap[i] * fl.r.y;
    }
    const tauFlap = V(0, -kf * sy, kf * sz);
    let res = vsub(tau, tauFlap);

    // --- gimbal (chi khi may chay) ---
    let gim = null;
    const T = cmd.nEng > 0 ? F.clusterThrust(F.VEH.s2.sl, cmd.throttle, A.p, cmd.nEng).F : 0;
    if (T > 1e3) {
      const lim = T * Math.sin(CFG.gimbal) * CFG.com;
      gim = V(clamp(res.x / Math.max(lim, 1), -1, 1) * CFG.gimbal, 0,
              clamp(res.z / Math.max(lim, 1), -1, 1) * CFG.gimbal);
      res = V(res.x - clamp(res.x, -lim, lim), res.y, res.z - clamp(res.z, -lim, lim));
      sh.eff = 'GIMBAL';
    } else sh.eff = usedFlap ? 'FLAP' : '—';

    /* RCS DAY NGANG (lenh tu landArc): tieu nhien lieu theo muc dung va chiem
       mot phan cong suat cum, phan con lai moi de tao mo-men. */
    let useT = 0, rcsF = null;
    const hot = cmd.hotGas && sh.prop > 500;              // khi nong tu bon chinh (dang ha)
    const g0Isp = (APR.RCS_ISP || 300) * 9.80665;
    if (cmd.rcsF && hot) {
      useT = Math.min(1, vlen(cmd.rcsF) / RCS_TMAX);
      rcsF = cmd.rcsF;
      const dm = vlen(cmd.rcsF) / g0Isp * dt;
      sh.prop = Math.max(0, sh.prop - dm); sh.m -= dm;
    }
    sh.rcsT = useT;
    const bT = rcsF ? qrotInv(sh.q, rcsF) : null;
    sh.rcsTb = bT ? [bT.x / RCS_TMAX, bT.z / RCS_TMAX] : [0, 0];
    // RCS giam chan: them mo-men theo SAI toc do quay pitch/yaw
    if (cmd.rcsDamp && (hot || sh.rcs > 0) && T > 1e3) res = vadd(res, V(I.x * dw.x * cmd.rcsDamp, 0, I.z * dw.z * cmd.rcsDamp));

    // --- RCS bu phan con lai (va la thu duy nhat trong chan khong) ---
    let rcs = null;
    if ((hot || sh.rcs > 0) && vlen(res) > 1e4) {
      // than +Y la truc doc -> res.y la XOAY DOC, hai truc kia la chuc ngua/dao huong
      const lp = CFG.rcsLim.pitch * (1 - useT), lr = CFG.rcsLim.roll;
      rcs = V(clamp(res.x, -lp, lp), clamp(res.y, -lr, lr), clamp(res.z, -lp, lp));
      const use = Math.min(1, Math.hypot(rcs.x, rcs.z) / Math.max(1, CFG.rcsLim.pitch) + Math.abs(rcs.y) / lr);
      if (hot) {
        /* dang ha: voi khi nong an tu bon chinh — luc = mo-men / canh tay don */
        const dm = (Math.hypot(rcs.x, rcs.z) / 17.5 + Math.abs(rcs.y) / 4.5) / g0Isp * dt;
        sh.prop = Math.max(0, sh.prop - dm); sh.m -= dm;
      } else sh.rcs = Math.max(0, sh.rcs - use * CFG.rcsFlow * dt);
      sh.rcsCmd = clamp(use, 0, 1);
      if (!usedFlap && T <= 1e3) sh.eff = 'RCS';
    } else sh.rcsCmd = 0;
    if (sh.rcs <= 0 && !usedFlap && T <= 1e3) sh.eff = 'KHONG';

    sh.bank = cmd.bank || 0; sh.aoa = cmd.aoa || 0;
    return { nEng: cmd.nEng, throttle: cmd.throttle, gim, rcs, rcsF };
  }

  /* Cap nhat nhiet cho ba vung. Tra ve su kien neu chay thung. */
  function heatStep(sh, dt, F) {
    const f = frame(sh, F), A = F.atmosphere(f.alt);
    if (!(A.rho > 0) || f.speed < 200) { sh.qdot = 0; }
    else sh.qdot = SG_K * Math.sqrt(A.rho / R_NOSE) * f.speed * f.speed * f.speed;
    const q = sh.qdot;

    // huong dong khi trong he body: quyet dinh mat nao an nhiet
    const belly = qrot(sh.q, V(1, 0, 0));          // phap tuyen mat gach
    const back  = vmul(belly, -1);
    /* Mat DON GIO la mat co phap tuyen cung chieu vector bay: khong khi ap
       toi tu phia truoc. Tao viet nham dau (-vhat) o ban dau nen thanh ra
       tinh mat KHUAT gio — lung nong 1469 K con bung nam yen 250 K, nguoc han. */
    const cB = Math.max(0, vdot(belly, f.vhat));   // 1 = bung don tron dong khi
    const cL = Math.max(0, vdot(back,  f.vhat));

    const cool = (T) => EPS * SIGMA * (T * T * T * T - T_AMB * T_AMB * T_AMB * T_AMB);
    /* BE MAT gach an gan tron dong nhiet roi tu buc xa ra — do chinh la cach
       TPS lam viec: no khong chan nhiet, no chiu nong roi hat lai. Can bang
       eps*sigma*T^4 = q cho ra ~1620 K o dinh, dung tam gach chiu duoc.
       Ket cau ben trong nguoi mat vi gach cach nhiet (TILE_PASS). */
    sh.Tb += dt * (q * cB * 0.95 - cool(sh.Tb)) / C_TILE;
    // lung la THEP TRAN: bay dung the thi cL = 0 va no nam yen; bay sai the
    // thi no an tron dong nhiet va chay thung rat nhanh.
    sh.Tl += dt * (q * cL * 0.92 - cool(sh.Tl)) / C_SKIN;
    sh.Tb = Math.max(T_AMB, sh.Tb); sh.Tl = Math.max(T_AMB, sh.Tl);

    /* DINH phai theo doi trong BUOC VAT LY, khong phai trong vong dung hinh.
       Truoc day part5 bat dinh o nhip giao dien 10 Hz — nghia la ban ghi phu
       thuoc nhip khung hinh, va neu ai do chay mo phong khong qua frame() thi
       moi dinh deu bang 0. Do la ly do hai ca hong thu nghiem ghi ra rong. */
    sh.pkTb = Math.max(sh.pkTb || 0, sh.Tb);
    sh.pkTl = Math.max(sh.pkTl || 0, sh.Tl);
    /* Lech phuong chi co nghia TU PHA HA tro di: truoc do tau bay bung-truoc
       nen goc nay tu nhien gan 90 do, ghi lai thi chi thay 90 va vo dung. */
    if (sh.phase === 'LAND') sh.pkYaw = Math.max(sh.pkYaw || 0, sh.yawErr || 0);

    let ev = null;
    for (let i = 0; i < 4; i++) {
      // be flap cang nhieu, khe ban le ha cang rong
      const dfl = Math.abs((sh.flap[i] - 0.5) * 2);
      const expo = (0.30 + 0.70 * dfl) * Math.max(cB, cL * 0.6);
      sh.Th[i] += dt * (q * expo * 0.62 - cool(sh.Th[i])) / C_HINGE;
      sh.Th[i] = Math.max(T_AMB, sh.Th[i]);
      sh.pkTh = Math.max(sh.pkTh || 0, sh.Th[i]);
      if (sh.Th[i] > T_HINGE_MAX) {
        // qua nguong thi hu dan, flap yeu di roi ket han
        sh.hingeDmg[i] = Math.min(1, sh.hingeDmg[i] + dt * (sh.Th[i] - T_HINGE_MAX) / 900);
        if (sh.hingeDmg[i] >= 1 && !sh._hb) { sh._hb = 1;
          ev = { type: 'HINGE_BURN', flap: CFG.flaps[i].name, T: sh.Th[i] }; }
      }
    }
    // than thung -> mat tau
    if (sh.Tl > T_STEEL_MAX || sh.Tb > T_TILE_MAX) {
      sh.dmg = Math.min(1, sh.dmg + dt * (Math.max(sh.Tl - T_STEEL_MAX, sh.Tb - T_TILE_MAX)) / 600);
      if (sh.dmg >= 1) {
        sh.alive = false; sh.outcome = 'burn';
        sh.burn = sh.Tl > T_STEEL_MAX ? 'lung' : 'bung';
        return { type: 'BURN_THROUGH', where: sh.burn, T: Math.round(Math.max(sh.Tl, sh.Tb)) };
      }
    }
    return ev;
  }

  function step(sh, dt, F, override) {
    if (!sh.alive) return null;
    /* Lech phuong quanh truc dung phai cap nhat MOI BUOC, khong phai chi luc
       cham chot — neu khong thi dong ho va bo ghi deu doc so cu, va khong ai
       nhin thay tau dang lech trong luc no con chua kip xoay lai. */
    {
      const fr = frame(sh, F);
      const pinAx = qrot(sh.q, V(0, 0, 1));   // xem chu thich o SHIP_DOWN
      const armA = armFrame(sh, fr).arm;
      sh.yawErr = Math.acos(clamp(Math.abs(vdot(pinAx, armA)), -1, 1));
    }
    const hev = heatStep(sh, dt, F);
    if (!sh.alive) return hev;              // chay thung -> mat tau ngay
    if (hev) sh.pendEv = hev;               // ban le chay -> bao mot lan
    const cmd = override || auto(sh, F);
    const act = allocate(sh, cmd, F, dt);

    const d0 = forces(sh, act, F);
    // tu the: tich phan quaternion voi gia toc goc = I^-1 (tau - w x Iw)
    const I = inertia(sh.m);
    const Iw = V(I.x * sh.w.x, I.y * sh.w.y, I.z * sh.w.z);
    const gyro = vcross(sh.w, Iw);
    const alpha = V((d0.torque.x - gyro.x) / I.x, (d0.torque.y - gyro.y) / I.y, (d0.torque.z - gyro.z) / I.z);
    sh.w = vadd(sh.w, vmul(alpha, dt));
    const wl = vlen(sh.w); if (wl > 1.2) sh.w = vmul(sh.w, 1.2 / wl);
    sh.q = qIntegrate(sh.q, sh.w, dt);

    // tinh tien: RK4 voi tu the giu nguyen trong buoc
    // `t` bat buoc phai co: thieu no thi windAt tra NaN va luc khi dong bi bo im lang
    const acc = st => forces({ p: st.p, v: st.v, q: sh.q, m: sh.m, t: sh.t,
                               flap: sh.flap, tuck: sh.tuck, w: sh.w }, act, F).acc;
    const k1v = acc({ p: sh.p, v: sh.v }), k1p = sh.v;
    const s2 = { p: vadd(sh.p, vmul(k1p, dt / 2)), v: vadd(sh.v, vmul(k1v, dt / 2)) };
    const k2v = acc(s2), k2p = s2.v;
    const s3 = { p: vadd(sh.p, vmul(k2p, dt / 2)), v: vadd(sh.v, vmul(k2v, dt / 2)) };
    const k3v = acc(s3), k3p = s3.v;
    const s4 = { p: vadd(sh.p, vmul(k3p, dt)), v: vadd(sh.v, vmul(k3v, dt)) };
    const k4v = acc(s4), k4p = s4.v;
    sh.p = vadd(sh.p, vmul(vadd(vadd(k1p, vmul(k2p, 2)), vadd(vmul(k3p, 2), k4p)), dt / 6));
    sh.v = vadd(sh.v, vmul(vadd(vadd(k1v, vmul(k2v, 2)), vadd(vmul(k3v, 2), k4v)), dt / 6));

    const dm = d0.mdot * dt;
    sh.prop = Math.max(0, sh.prop - dm);
    sh.m = Math.max(F.VEH.s2.dry, sh.m - dm);
    sh.t += dt;
    if (sh.prop <= 0) { sh.throttle = 0; sh.nEng = 0; }
    else { sh.throttle = act.throttle; sh.nEng = act.nEng; }

    const f = frame(sh, F);
    towerSlew(sh, dt, f, F);
    towerStep(sh, dt, f, F);
    if (f.alt <= F.CATCH_ALT + sh.tw.y) {
      sh.alive = false;
      sh.throttle = 0; sh.nEng = 0;

      /* Lech va van toc tinh TUONG DOI VOI KEP: kep da truot ngang va dang di
         xuong cung tau. */
      const miss = Math.hypot(f.down - sh.tw.ex, f.cross - sh.tw.ez);
      const vs = Math.abs(f.vu - sh.tw.vy);
      const tilt = Math.acos(clamp(vdot(qrot(sh.q, V(0, 1, 0)), f.rhat), -1, 1));
      /* HUONG QUANH TRUC DUNG. Hai canh tay dua cach nhau theo truc TAM XA, va
         hai chot nang cua tau nam o than +X/-X (mat bung va mat lung). Neu tau
         vao chot lech phuong thi CANH GIO dap vao canh tay chu khong phai chot
         — canh se hong va tau tuot khoi tay dua.
         Truc than +X phai gan trung truc tam xa; qua 25 do la khong vao duoc. */
      /* TRUC NOI HAI CHOT, khong phai vi tri mot chot. Hai chot o (cos AZ, 0,
         ±sin AZ) tren than nen hieu cua chung la thuan +Z cua than. DA THU do
         bang qrot(q, V(cos PIN_AZ, 0, sin PIN_AZ)): do la BAN KINH toi mot
         chot, no bang 0 do ngay ca khi truc chot lech 20 do — bo ghi bao
         yaw 0.39 do trong khi hinh cho thay chot truot ra ngoai tay 3-9 m. */
      const pinAx = qrot(sh.q, V(0, 0, 1));
      const armAxis = armFrame(sh, f).arm;                          // truc noi hai canh tay (da xoay)
      const yaw = Math.acos(clamp(Math.abs(vdot(pinAx, armAxis)), -1, 1));
      sh.yawErr = yaw;
      const aligned = yaw < 25 * Math.PI / 180;
      const soft = vs < F.SHIP_LAND.vspeed && tilt < F.SHIP_LAND.tilt && aligned;
      sh.outcome = !soft ? 'crash'
        : miss < F.SHIP_LAND.bullseye ? 'bullseye'
        : miss < F.SHIP_LAND.ontarget ? 'ontarget'
        : miss < F.SHIP_LAND.wide ? 'wide' : 'lost';
      return { type: 'SHIP_DOWN', outcome: sh.outcome, lat: f.down, cross: f.cross, miss,
               vs: f.vu - sh.tw.vy, vsAbs: f.vu, tilt, yaw, aligned,
               twY: sh.tw.y, twVy: sh.tw.vy, twEx: sh.tw.ex, twEz: sh.tw.ez,
               twPsiB: sh.tw.psiB, twPsiC: sh.tw.psiC };
    }
    return null;
  }

  function telemetry(sh, F) {
    const f = frame(sh, F), A = F.atmosphere(f.alt);
    const nose = qrot(sh.q, V(0, 1, 0));
    const aoaAct = Math.acos(clamp(Math.abs(vdot(nose, f.vhat)), -1, 1));
    return {
      t: sh.t, alt: f.alt, speed: f.speed, vspeed: f.vu, lateral: f.down, cross: f.cross,
      q: .5 * A.rho * f.speed * f.speed, mach: A.a > 0 ? f.speed / A.a : 0,
      prop: sh.prop, propFrac: sh.prop / (F.VEH.s2.prop * .09),
      throttle: sh.throttle, engines: sh.nEng, phase: sh.phase,
      aoa: aoaAct, bank: sh.bank, flap: sh.flap.slice(), ext: sh.ext, tuck: sh.tuck || 0,
      eff: sh.eff, rcs: sh.rcs, rcsFrac: sh.rcs / CFG.rcsTank, rcsCmd: sh.rcsCmd || 0,
      rcsLim: CFG.rcsLim,
      roll: sh.w.y, impact: sh.pi || 0, hBurn: sh.hBurn || 0,
      toBurn: (f.alt - F.CATCH_ALT - (sh.tw ? sh.tw.y : 0)) - (sh.hBurn || 0) - SGC.FLIP_MARGIN,
      twY: sh.tw ? sh.tw.y : 0, twVy: sh.tw ? sh.tw.vy : 0,
      twEx: sh.tw ? sh.tw.ex : 0, twEz: sh.tw ? sh.tw.ez : 0,
      twPsiB: sh.tw ? sh.tw.psiB : 0, twPsiC: sh.tw ? sh.tw.psiC : 0,
      rcsT: sh.rcsT || 0, rcsTb: sh.rcsTb ? sh.rcsTb.slice() : [0, 0],
      q4: sh.q,
      qdot: sh.qdot || 0, Tb: sh.Tb || 0, Tl: sh.Tl || 0,
      pkTb: sh.pkTb || 0, pkTl: sh.pkTl || 0, pkTh: sh.pkTh || 0, pkYaw: sh.pkYaw || 0,
      Th: sh.Th ? sh.Th.slice() : [0,0,0,0], yawErr: sh.yawErr || 0,
      hingeDmg: sh.hingeDmg ? sh.hingeDmg.slice() : [0,0,0,0], dmg: sh.dmg || 0,
    };
  }

  return { V, vadd, vsub, vmul, vdot, vcross, vlen, vnorm, vcopy,
           Q, qmul, qnorm, qconj, qrot, qrotInv, qAxisAngle, qBetween, qIntegrate,
           clamp, CFG, inertia, qFromAxes, forces, frame, predict, predictFlip, auto,
           attitudeCmd, setTarget, getTarget, ENTRY_AOA, FLOP_AOA,
           dragAccel,
           fromPlan, allocate, step, telemetry, TWS, SGC, APR };
});
