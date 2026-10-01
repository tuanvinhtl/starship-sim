/* Flight model 3-DOF — port tu sim/python/ascent.py (da verify).
   Dung chung cho ca game va bo test node.  Khong phu thuoc DOM. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Flight = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const G0 = 9.80665, MU = 3.986004418e14, RE = 6371000.0, P0 = 101325.0;
  const R_AIR = 287.05287, GAMMA = 1.4;
  let WX_T = 0;    // lech nhiet do hien tai; atmosphere() doc truoc khi WEATHER ton tai

  // US Standard Atmosphere 1976: [h_base, T_base, P_base, lapse]
  const LAYERS = [
    [0,     288.15, 101325.0,  -0.0065],
    [11000, 216.65, 22632.06,   0.0],
    [20000, 216.65, 5474.889,   0.001],
    [32000, 228.65, 868.0187,   0.0028],
    [47000, 270.65, 110.9063,   0.0],
    [51000, 270.65, 66.93887,  -0.0028],
    [71000, 214.65, 3.956420,  -0.002],
  ];

  function atmosphere(h) {
    if (h >= 86000) return { rho: 0, p: 0, T: 186.87, a: 275 };
    if (h < 0) h = 0;
    let L = LAYERS[0];
    for (const l of LAYERS) { if (h >= l[0]) L = l; else break; }
    const [hb, Tb, Pb, lam] = L, dh = h - hb;
    let T, p;
    if (lam === 0) { T = Tb; p = Pb * Math.exp(-G0 * dh / (R_AIR * Tb)); }
    else { T = Tb + lam * dh; p = Pb * Math.pow(T / Tb, -G0 / (lam * R_AIR)); }
    /* Troi lanh -> khong khi dac hon. Nhung dot lanh la hien tuong LOP BIEN:
       no khong keo len tang binh luu. Ap nguyen do lech cho moi do cao lam luc
       can tang 16% suot chuyen bay va an het du tru delta-v (tau het nhien lieu
       o 7222 m/s roi roi lai). Cho no tat dan theo do cao moi dung. */
    const Te = Math.max(120, T + (WX_T || 0) * Math.exp(-h / 9000));
    return { rho: p / (R_AIR * Te), p, T: Te, a: Math.sqrt(GAMMA * R_AIR * Te) };
  }

  /* ==================== THOI TIET ====================
     Gio khong chi lam canh dep: no doi VAN TOC TUONG DOI SO VOI KHONG KHI,
     ma moi luc khi dong deu tinh theo do. Gio cat o tang doi luu tao goc tan
     ngoai y muon -> q*alpha tang -> nguy co vo than. Day dung la rui ro phong
     kinh dien ma cac cong ty ten lua phai cho thoi tiet.                    */
  /* tempOff: lech nhiet do so voi khi quyen chuan (K). Lanh -> khong khi DAC
     hon -> ap suat dong va luc can deu tang. Tuyet khong chi la hat roi tren
     man hinh: no keo theo mat do va do la thay doi that. */
  const WEATHER = {
    calm:    { name: 'Lặng',      surf: 1.2, jet: 4,  gust: 0.3, rain: 0,   snow: 0, cloud: .20, tempOff: 0 },
    breezy:  { name: 'Gió nhẹ',   surf: 7,   jet: 26, gust: 2.5, rain: 0,   snow: 0, cloud: .45, tempOff: 0 },
    rain:    { name: 'Mưa',       surf: 9,   jet: 30, gust: 3,   rain: 1,   snow: 0, cloud: .88, tempOff: -4 },
    snow:    { name: 'Tuyết',     surf: 5,   jet: 18, gust: 2,   rain: 0,   snow: 1, cloud: .82, tempOff: -28 },
    gusty:   { name: 'Gió giật',  surf: 13,  jet: 45, gust: 7,   rain: .35, snow: 0, cloud: .75, tempOff: -2 },
    storm:   { name: 'Giông',     surf: 21,  jet: 62, gust: 13,  rain: 1,   snow: 0, cloud: 1.0, tempOff: -6 },
    blizzard:{ name: 'Bão tuyết', surf: 17,  jet: 52, gust: 10,  rain: 0,   snow: 1, cloud: 1.0, tempOff: -34 },
  };
  const WX_KEYS = Object.keys(WEATHER);
  let WX = WEATHER.calm;
  function randomWeather() { return setWeather(WX_KEYS[Math.floor(Math.random() * WX_KEYS.length)]); }
  function setWeather(k) { WX = WEATHER[k] || WEATHER.calm; WX_T = WX.tempOff || 0; return WX; }
  const getWeather = () => WX;

  /* Toc do gio ngang (m/s) theo do cao. Ba thanh phan:
       - lop bien: manh o sat dat, tat dan theo do cao
       - dong tia: dinh quanh 11 km, dung dang Gauss
       - giat: dao dong theo thoi gian VA do cao -> sinh ra gio CAT */
  function windAt(alt, t) {
    if (alt > 32000 || alt < 0) return 0;
    const surf = WX.surf * Math.exp(-alt / 2600);
    const jet = WX.jet * Math.exp(-Math.pow((alt - 11000) / 5200, 2));
    const gust = WX.gust * Math.sin(t * 0.41 + alt * 0.00085) * Math.sin(t * 0.13 + 1.7);
    return surf + jet + gust;
  }

  const CD_TABLE = [[0,.30],[.6,.32],[.9,.42],[1.05,.58],[1.3,.52],[2,.38],[3,.30],[5,.25],[10,.22]];
  function cdOfMach(m) {
    if (m <= CD_TABLE[0][0]) return CD_TABLE[0][1];
    const last = CD_TABLE[CD_TABLE.length - 1];
    if (m >= last[0]) return last[1];
    for (let i = 0; i < CD_TABLE.length - 1; i++) {
      const [x0, y0] = CD_TABLE[i], [x1, y1] = CD_TABLE[i + 1];
      if (m >= x0 && m <= x1) return y0 + (y1 - y0) * (m - x0) / (x1 - x0);
    }
    return last[1];
  }

  // --- vehicle (khop sim/reference/vehicle_starship.json) ---
  const VEH = {
    diameter: 9.0,
    s1: { dry: 200e3, prop: 3400e3,
          eng: { n: 33, Fvac: 2.30e6, isp: 347, Ae: 1.33, tmin: 0.40 } },
    /* HAI THUNG THAT, dung nhu Starship: thung header nho (LOX o mui, CH4 nam trong thung
       chinh) chi de HA CANH. Ly do that: trong belly flop va cu lat, nhien lieu trong thung
       lon khong lang duoc, bom se hut phai khi — day chinh la thu lam SN8 ha canh hong (ap
       header CH4 tut). Nen o day header bi KHOA RIENG: pha phong / tron quy dao / ha quy dao
       chi duoc an binh chinh, dot can binh chinh la tau chet chu khong muon duoc cua ha canh.
       35 t: do duoc cu ha canh ngon 19.8-33.1 t qua moi thoi tiet, moi muc tai va lech ngang
       toi 38 km (te nhat: giong + 40 ve tinh). prop la TONG ca hai thung. */
    s2: { dry: 120e3, prop: 1500e3, header: 35e3,
          sl:  { n: 3, Fvac: 2.30e6, isp: 347, Ae: 1.33, tmin: 0.40 },
          vac: { n: 3, Fvac: 2.64e6, isp: 380, Ae: 5.70, tmin: 0.40 } },
    maxQ: 35000, maxG: 3.5,
  };
  const AREA = Math.PI * Math.pow(VEH.diameter / 2, 2);

  function clusterThrust(e, throttle, pAmb, nLive) {
    const n = (nLive === undefined) ? e.n : nLive;
    if (throttle <= 0 || n === 0) return { F: 0, mdot: 0 };
    const F1 = Math.max(0, e.Fvac - e.Ae * pAmb);
    return { F: F1 * n * throttle, mdot: (e.Fvac * n * throttle) / (e.isp * G0) };
  }
  function s2Thrust(throttle, pAmb, nSL, nVac) {
    const a = clusterThrust(VEH.s2.sl, throttle, pAmb, nSL);
    const b = clusterThrust(VEH.s2.vac, throttle, pAmb, nVac);
    return { F: a.F + b.F, mdot: a.mdot + b.mdot };
  }

  const PITCH_KICK_V = 60, TARGET_V = 7800, TARGET_ALT = 120000;

  /* ==================== HANG HOA TRONG KHOANG TAU ====================
     Khoi luong hang di theo tau suot chuyen: no doi khoi luong luc phong, luc tach tang,
     va ke hoach quay ve. Tha hang xong thi game goi setPayload(0) — tau nhe lai that. */
  let PAYLOAD = 0;                                  // kg
  function setPayload(kg) { PAYLOAD = Math.max(0, kg || 0); return PAYLOAD; }
  const getPayload = () => PAYLOAD;

  /* GOC HAT MUI GIAN THEO TAI. Do duoc: voi goc co dinh 3 do, them 40 t hang la tau len
     dinh 185 km roi TUT ve 67 km (goc bay -7.8 do) trong khi van tang toc — no vuot
     7800 m/s o DUOI 120 km nen dieu kien SECO khong bao gio dat, va dot toi can. Tran tai
     chi ~32 t. Ha goc hat xuong 2.5 do thi 100 t van len quy dao 125 km.
     Quan trong: tai 0 thi ham nay tra ve DUNG 3.0 nhu cu, nen chuyen khong hang giong het
     ban da kiem tung bit.
     DA THU VA BO: lai khep kin bam ho so goc bay lay tu chinh chuyen danh dinh — kem hon
     (chet o 90 t) va ngon sach ngan sach q*alpha (2069-2500 so voi 286-295 cua cach nay),
     vi chuyen danh dinh von da tut xuong -4 do: bam theo no la TU RA LENH cho minh tut. */
  const kickDeg = () => 3.0 - 0.5 * Math.min(1, PAYLOAD / 100e3);

  function makeState() {
    return {
      t: 0, x: 0, y: RE, vx: 0, vy: 0, stage: 1,
      prop1: VEH.s1.prop, prop2: VEH.s2.prop - VEH.s2.header, head: VEH.s2.header,
      m: VEH.s1.dry + VEH.s1.prop + VEH.s2.dry + VEH.s2.prop + PAYLOAD,
      nSL: VEH.s2.sl.n, nVac: VEH.s2.vac.n, throttle: 1, alive: true,
      alpha: 0, qAlpha: 0, rud: false, hot: 0, hotT: 0, hotShare: 0, engOut: 0,
    };
  }

  /* Huong luc day. manual = {pitchCmd} de nguoi choi lai tay (rad lech khoi prograde). */
  /* pitchAbs != null -> lai tay: goc tuyet doi tinh tu phuong thang dung tai cho,
     duong = nga ve huong bay (downrange). null -> autopilot gravity turn. */
  function thrustDir(s, alt, speed, pitchAbs) {
    const r = Math.hypot(s.x, s.y), ux = s.x / r, uy = s.y / r;
    if (pitchAbs !== null && pitchAbs !== undefined) {
      const c = Math.cos(pitchAbs), si = Math.sin(pitchAbs);
      return [ux * c + uy * si, uy * c - ux * si];   // up*cos + east*sin
    }
    if (speed < PITCH_KICK_V || alt < 500) return [ux, uy];
    if (speed < PITCH_KICK_V + 40) {
      const a = kickDeg() * Math.PI / 180;          // up*cos + east*sin, cung quy uoc voi pitchAbs
      return [ux * Math.cos(a) + uy * Math.sin(a), uy * Math.cos(a) - ux * Math.sin(a)];
    }
    /* GIAM TAI (load relief) — CAT NGON goc tan, khong bo quy dao.
       Bo lai bam prograde QUAN TINH, con goc tan lai do theo KHONG KHI. Gio
       cat 62 m/s trong giong lam hai cai lech nhau ~10 do, va tang tu chiu
       du tai do: vo than o giay 58, 8.7 km, q.alpha 4001 — khong phai vi tai
       that su qua lon ma vi bo lai khong biet gi ve gio. Tang thuc lam dung
       cach nay qua max-Q.
       DA THU truoc do: lai HAN theo huong gio tuong doi (hoa dan theo q).
       Ha q.alpha rat manh (mua 2131 -> 460) nhung PHA QUY DAO — than bi gio
       lai di, MECO vot len 78 km, giong va bao tuyet khong len duoc quy dao
       roi roi nguoc xuong dat o 2900-3400 m/s. Cai "vo than luc 278-360 s"
       khi ay la dam xuong dat chu khong phai qua tai.
       Cach dung la chi lech VUA DU: cho phep goc tan toi da = ngan sach /
       ap suat dong. Khi troi lang thi dieu kien khong bao gio cham, quy dao
       y nguyen (q.alpha 286 khong doi). Ngan sach 2500 Pa.rad chua 1500 du
       tru duoi muc vo than, gia chi <= 30 m/s van toc MECO. */
    const wLR = windAt(alt, s.t);
    const rvx = s.vx - uy * wLR, rvy = s.vy + ux * wLR;
    const rsp = Math.hypot(rvx, rvy);
    if (rsp < 1) return [s.vx / speed, s.vy / speed];
    const qLR = 0.5 * atmosphere(alt).rho * rsp * rsp;
    if (qLR < 100) return [s.vx / speed, s.vy / speed];
    const thV = Math.atan2((s.vx * uy - s.vy * ux) / speed, (s.vx * ux + s.vy * uy) / speed);
    const thA = Math.atan2((rvx * uy - rvy * ux) / rsp, (rvx * ux + rvy * uy) / rsp);
    const aErr = angleWrap(thV - thA), aMax = QA_BUDGET / qLR;
    if (Math.abs(aErr) <= aMax) return [s.vx / speed, s.vy / speed];
    const thC = thA + (aErr > 0 ? aMax : -aMax);
    return [ux * Math.cos(thC) + uy * Math.sin(thC), uy * Math.cos(thC) - ux * Math.sin(thC)];
  }

  /* Goc phuong thang dung cua vector van toc (0 = len thang, PI/2 = nam ngang). */
  /* Goc cua DONG KHI di qua than — lech khoi prograde dung bang gio. Day moi
     la thu quyet dinh goc tan that, va la ly do gio cat xe duoc than tau. */
  function airPitch(s) {
    const r = Math.hypot(s.x, s.y), ux = s.x / r, uy = s.y / r;
    const we = windAt(r - RE, s.t);
    const rvx = s.vx - uy * we, rvy = s.vy + ux * we;
    const sp = Math.hypot(rvx, rvy);
    if (sp < 1e-3) return 0;
    return Math.atan2((rvx * uy - rvy * ux) / sp, (rvx * ux + rvy * uy) / sp);
  }

  function progradePitch(s) {
    const r = Math.hypot(s.x, s.y), ux = s.x / r, uy = s.y / r;
    const sp = Math.hypot(s.vx, s.vy);
    if (sp < 1e-3) return 0;
    const vu = (s.vx * ux + s.vy * uy) / sp;          // thanh phan thang dung
    const ve = (s.vx * uy - s.vy * ux) / sp;          // thanh phan ngang (east)
    return Math.atan2(ve, vu);
  }

  /* Chon throttle + so dong co song de khong vuot max-Q va gioi han g. */
  function selectSetting(s, pAmb, q, manualThrottle) {
    const Fcap = VEH.maxG * G0 * s.m;
    if (s.stage === 1 && s.hot) {
      return { th: 1, nSL: HOT_NENG, nVac: 0 };     // 3 may giua, ga day
    }
    if (s.stage === 1) {
      const full = clusterThrust(VEH.s1.eng, 1, pAmb).F;
      let th = (manualThrottle !== undefined && manualThrottle !== null)
        ? manualThrottle : (q > VEH.maxQ * 0.85 ? 0.65 : 1.0);
      if (full * th > Fcap) th = Fcap / full;
      /* Dong co hong vi manh vang tu be phong (xem delugeStep) van tinh vao day. */
      const nLive = Math.max(1, VEH.s1.eng.n - (s.engOut || 0));
      return { th: Math.max(VEH.s1.eng.tmin, Math.min(1, th)), nSL: nLive, nVac: 0 };
    }
    const combos = [[3,3],[2,3],[1,3],[0,3],[0,2],[0,1]];
    for (const [nSL, nVac] of combos) {
      const full = s2Thrust(1, pAmb, nSL, nVac).F;
      if (full <= 0) continue;
      let th = Math.min(1, Fcap / full);
      if (manualThrottle !== undefined && manualThrottle !== null) th = Math.min(th, manualThrottle);
      if (th >= 0.4 || (nSL === 0 && nVac === 1)) return { th: Math.max(0.4, th), nSL, nVac };
    }
    return { th: 0.4, nSL: 0, nVac: 1 };
  }

  /* ===== BE PHONG LAM MAT BANG NUOC =====
     Sau IFT-1 (4/2023), luong khi cua 33 Raptor thoi vo lop be tong duoi be
     phong. SpaceX thay bang mot TAM THEP DAY DUC LO phun nuoc NGUOC LEN vao
     dong khi — Musk goi la "mega-steel pancake". So lieu cong khai:
       · ~350 000 gallon (1325 m3) moi lan phong        — FAA PEA 6/2022
       · 650 000 gallon/phut = 41 m3/s                  — thu o Pad 2
       · binh chua ep bang khi ni-to 3000 psi
     Con so dang ke nhat la SU TUONG XUNG. Cong suat luong khi cua 33 may:
       mdot = 33*Fvac/(isp*g0) = 22 300 kg/s,  ve = isp*g0 = 3404 m/s
       P = mdot*ve^2/2 = 129 GW
     Con 41 m3/s nuoc, moi kg hap thu 4186*80 + 0.55*2.26e6 = 1.58 MJ neu hoa
     hoi mot phan:  41 000 * 1.58 MJ = 65 GW (toan bo tam), ~10 GW rot vao rieng
     vung dong khi dap. He thong duoc dat ngay o THANG CONG SUAT cua luong khi
     chu khong du ra hang chuc lan.

     Nen dieu quyet dinh KHONG phai co du nuoc hay khong, ma la ba thu nay:
       1) MO VAN TRUOC KHI DANH LUA. Khong lam mat thi lop mat tam nong
          ~590 K/s, vuot nguong thep trong chua hai giay.
       2) SOI MANG (film boiling). Tam qua nong thi nuoc khong bam duoc nua:
          mot mang hoi cach ly no khoi mat thep va hieu qua truyen nhiet SUP DO.
          Mo van muon roi thi khong cuu kip — dung hien tuong burnout that.
       3) BINH XA AP. Nuoc di, khi ni-to gian ra, ap tut, luu luong tut theo.
     QDOT duoi day la so HIEU CHINH, khong phai so do duoc: dong nhiet diem dung
     cua luong khi Raptor dap vao tam phang khong co so lieu cong khai. Dat sao
     cho khong nuoc thi hong trong ~1.5 s, con co nuoc thi tam am len roi giu. */
  const DEL = {
    W0: 1325,            // m3 nuoc (350 000 gallon)
    Q0: 41,              // m3/s o ap dinh muc (650 000 gallon/phut)
    ULL: 0.45,           // ty le the tich khi nen ban dau trong binh
    PREG: 0.55,          // van dieu ap giu du luu luong toi khi ap con ngan nay
    A_PLATE: 1017,       // m2 mat tam (ban kinh 18 m)
    A_IMP: 154,          // m2 vung dong khi dap vao (ban kinh ~7 m)
    QDOT: 18e6,          // W/m2 dong nhiet o do cao 0, ga day
    H0: 26,              // m — do cao lam dong nhiet con mot nua
    SKIN: 0.008,         // m — do sau tham nhiet cua thep trong vai giay dau
    RHO: 7850, CP: 490, EPS: 0.8, SIG: 5.67e-8, TA: 293,
    T_LIM: 1200,         // K — thep mat suc ben ket cau
    HW: 4186 * 80 + 2.26e6 * 0.55,   // J/kg: dun toi soi + hoa hoi mot phan
  };
  /* --- VOI PHUN: tu lien tuc ra van toc, tu van toc ra dan dao ---
     Q = N*A*v  ->  v = Q/(N*A).  Ap truoc voi suy nguoc: dp = rho*v^2/(2*Cd^2).
     Nho vay khi binh xa ap tut, luu luong tut, va TIA NUOC THAP DAN theo —
     khong phai mot cai non duoc keo dai ngan tuy y.
     Hat nuoc chiu TRONG LUC va LUC CAN: a = -g - k|v|v, voi
       k = 3*Cd_hat*rho_khi / (8*rho_nuoc*r)
     Luc can khong bo qua duoc: o 29 m/s no bang ~1.1 g, tuc cat gan mot nua do
     cao so voi dan dao chan khong. */
  DEL.NOZ_N = 180; DEL.NOZ_D = 0.10; DEL.NOZ_CD = 0.82;
  DEL.DROP_R = 0.006; DEL.DROP_CD = 0.47; DEL.RHO_A = 1.225;
  DEL.BREAK = 14;                    // chieu dai loi lien tuc = 14 lan duong kinh voi
  function nozzleExit(flow) {
    const A = DEL.NOZ_N * Math.PI * DEL.NOZ_D * DEL.NOZ_D / 4;
    const v = flow / A;
    return { v, A, dp: 1000 * v * v / (2 * DEL.NOZ_CD * DEL.NOZ_CD) };
  }
  const dropK = () => 3 * DEL.DROP_CD * DEL.RHO_A / (8 * 1000 * DEL.DROP_R);
  /* Do cao toi da cua tia. Voi a = -g - k*v^2 thi tich phan len duoc dang kin:
       y = ln(1 + k*v^2/g) / (2k)
     Kiem lai bang tich phan so: 19.55 m so voi 19.5 m — khop. Dung dang kin de
     khoi chay 4000 buoc moi khung hinh chi de lay mot con so hien thi. */
  function jetRise(v) {
    const k = dropK();
    return Math.log(1 + k * v * v / 9.81) / (2 * k);
  }

  function makeDeluge() {
    return { w: DEL.W0, on: false, flow: 0, T: DEL.TA, dmg: 0, steam: 0,
             pkT: DEL.TA, used: 0, tOn: null, film: false, dry: false };
  }
  /* alt = do cao day ten lua (m), thr = ty le luc day so voi 33 may ga day.
     Tach roi khoi trang thai bay de goi duoc CA TRONG DEM NGUOC (thr = 0). */
  function delugeStep(d, dt, alt, thr) {
    // --- luu luong: binh xa ap, van dieu ap giu phang doan dau ---
    if (d.on && d.w > 0) {
      const ull = DEL.ULL + (1 - d.w / DEL.W0) * (1 - DEL.ULL);
      const pRel = Math.pow(DEL.ULL / ull, 1.3);          // gian doan nhiet
      d.flow = DEL.Q0 * Math.min(1, Math.sqrt(pRel / DEL.PREG));
      d.w = Math.max(0, d.w - d.flow * dt);
      d.used += d.flow * dt;
      if (d.w <= 0) d.dry = true;
    } else d.flow = 0;

    // --- nhiet vao lop mat tam ---
    const g = 1 / (1 + (alt / DEL.H0) * (alt / DEL.H0));
    const Qin = DEL.QDOT * DEL.A_IMP * g * Math.max(0, thr);

    /* --- nhiet ra: nuoc, theo CHE DO SOI ---
       chua soi        -> doi luu, kem
       373..703 K      -> soi bot, tot nhat
       tren ~703 K     -> soi mang, hoi cach ly, hieu qua sup do con 10% */
    const mw = d.flow * 1000 * (DEL.A_IMP / DEL.A_PLATE);
    const dTs = d.T - 373;
    const eff = dTs <= 0 ? 0.28
              : dTs < 330 ? 0.28 + 0.72 * (dTs / 330)
              : Math.max(0.10, 1 - 0.90 * ((dTs - 330) / 430));
    const Qw = mw * DEL.HW * eff;
    const Qr = DEL.EPS * DEL.SIG * DEL.A_IMP * (Math.pow(d.T, 4) - Math.pow(DEL.TA, 4));

    const C = DEL.A_IMP * DEL.SKIN * DEL.RHO * DEL.CP;   // J/K cua lop mat
    d.T = Math.max(DEL.TA, d.T + (Qin - Qw - Qr) / C * dt);
    if (d.T > d.pkT) d.pkT = d.T;
    d.steam = Math.min(1, mw * eff / 3500);              // 0..1, cho phan hinh
    if (dTs > 330 && Qin > 0) d.film = true;

    if (d.T > DEL.T_LIM) {
      const b4 = d.dmg;
      d.dmg = Math.min(1, d.dmg + dt * (d.T - DEL.T_LIM) / 900);
      for (const lv of [0.25, 0.60, 1.0])
        if (b4 < lv && d.dmg >= lv) return { type: 'PAD_DMG', level: lv, T: Math.round(d.T) };
    }
    return null;
  }

  function derivs(s, th, nSL, nVac, pitchAbs) {
    const r = Math.hypot(s.x, s.y), alt = r - RE, speed = Math.hypot(s.vx, s.vy);
    const A = atmosphere(alt);
    let T = (s.stage === 1)
      ? clusterThrust(VEH.s1.eng, th, A.p, nSL)
      : s2Thrust(th, A.p, nSL, nVac);
    if (s.stage === 1 && s.hot) {
      // ca chong van la mot the: cong luc day cua tau, va no cung dot prop2
      const T2 = s2Thrust(1, A.p, VEH.s2.sl.n, 0);
      T = { F: T.F + T2.F, mdot: T.mdot + T2.mdot, mdot2: T2.mdot };
    }
    const [tx, ty] = thrustDir(s, alt, speed, pitchAbs);
    let ax = T.F * tx / s.m, ay = T.F * ty / s.m;
    const g = MU / (r * r);
    ax -= g * s.x / r; ay -= g * s.y / r;
    // GIO: luc khi dong sinh ra tu van toc TUONG DOI VOI KHONG KHI, khong phai
    // van toc so voi mat dat. Day la ca goc van de cua gio cat.
    const ux = s.x / r, uy = s.y / r, we = windAt(alt, s.t);
    const rvx = s.vx - uy * we, rvy = s.vy + ux * we;
    const rsp = Math.hypot(rvx, rvy);
    const q = 0.5 * A.rho * rsp * rsp;
    if (rsp > 1e-3 && A.rho > 0) {
      const D = q * cdOfMach(A.a > 0 ? rsp / A.a : 0) * AREA;
      ax -= D * (rvx / rsp) / s.m;
      ay -= D * (rvy / rsp) / s.m;
    }
    return { ax, ay, mdot: T.mdot, mdot2: T.mdot2, q, F: T.F, alt, speed, atm: A };
  }

  const HOT_STAGE_FRAC = 0.10;
  /* HOT STAGING. Truoc day tach tang la TUC THOI: mot khung la ca chong 33 may,
     khung sau la tang 2 voi 6 may, va booster thua huong y nguyen van toc —
     khong co gi day hai tang roi nhau. Ten hang so co san nhung co che thi
     khong. Gio dung dung trinh tu that:
       1. Booster ha ga xuong 3 MAY GIUA (con ~9% luc day)
       2. Tau danh lua 3 Raptor mat bien KHI VAN CON DINH — luc day cua no
          thoat qua vanh hot-stage
       3. Giu the do HOT_DUR giay, ca chong van la mot the
       4. Nha: tau nhe va day manh nen vot len, booster nang va da tat may nen
          tut lai. Van toc tach ra TU SINH tu chenh lech luc day, khong phai
          mot cu day gia dat vao.
     Luong phut cua tau con dap thang vao dinh booster — luc do co that va no
     lam booster tut nhanh hon. */
  /* Dat sao cho SAU cua so booster con dung ~10% nhu truoc: trong 3.2 s voi
     3 may no dot het ~6 t, nen kich hoat som hon 0.2% la vua. Giu nguyen ngan
     sach nhien lieu cu de toan bo phan chinh dinh duong ve khong bi lat. */
  const HOT_LEAD = 0.002;      // ha ga khi con nhieu hon nguong nay
  const HOT_DUR  = 3.2;        // giay hai tang cung chay
  const HOT_NENG = 3;          // so may giua cua booster luc do
  const PLUME_F  = 0.16;       // ti le luc day tau dap vao dinh booster
  const Q_ALPHA_LIMIT = 4000;   // Pa*rad — o max-Q (30 kPa) tuong ung ~7.6 do
  const QA_BUDGET = 2500;       // Pa*rad — muc bo lai TU GIU, chua 1500 du tru

  function angleWrap(a) { while (a > Math.PI) a -= 2*Math.PI; while (a < -Math.PI) a += 2*Math.PI; return a; }

  /* Mot buoc RK4. opts = {manualThrottle, manualPitch, autoStage}. Tra ve su kien phat sinh. */
  function step(s, dt, opts) {
    opts = opts || {};
    if (!s.alive) return [];
    const events = [];
    const r0 = Math.hypot(s.x, s.y), alt = r0 - RE, speed = Math.hypot(s.vx, s.vy);
    const A = atmosphere(alt);
    const q = 0.5 * A.rho * speed * speed;

    const set = selectSetting(s, A.p, q, opts.manualThrottle);
    s.throttle = set.th; s.nSL = set.nSL; s.nVac = set.nVac;
    const mp = (opts.pitchAbs === undefined) ? null : opts.pitchAbs;

    const f = (st) => {
      const d = derivs(st, set.th, set.nSL, set.nVac, mp);
      if (st === s && d.mdot2 !== undefined && d.mdot > 0) s.hotShare = d.mdot2 / d.mdot;
      return [st.vx, st.vy, d.ax, d.ay, d.mdot];
    };
    /* PHAI mang theo ca `t` VA `hot`: thieu `hot` thi 3 trong 4 buoc RK4 tinh
       luc day KHONG co phan cua tau — dung loai loi da gap voi `t` hoi truoc. */
    const adv = (st, k, h) => ({
      t: st.t + h, stage: st.stage, m: st.m, prop1: st.prop1, prop2: st.prop2,
      hot: st.hot, x: st.x + k[0]*h, y: st.y + k[1]*h,
      vx: st.vx + k[2]*h, vy: st.vy + k[3]*h,
    });
    const k1 = f(s), k2 = f(adv(s,k1,dt/2)), k3 = f(adv(s,k2,dt/2)), k4 = f(adv(s,k3,dt));
    s.x  += dt/6*(k1[0]+2*k2[0]+2*k3[0]+k4[0]);
    s.y  += dt/6*(k1[1]+2*k2[1]+2*k3[1]+k4[1]);
    s.vx += dt/6*(k1[2]+2*k2[2]+2*k3[2]+k4[2]);
    s.vy += dt/6*(k1[3]+2*k2[3]+2*k3[3]+k4[3]);
    const dm = dt/6*(k1[4]+2*k2[4]+2*k3[4]+k4[4]);

    if (s.stage === 1) {
      if (s.hot) {
        /* Hai binh chay cung luc. dm la tong; tach ra theo ti le mdot da tinh
           trong derivs, neu khong thi binh tang 1 chiu ca phan cua tau. */
        const d2 = dm * (s.hotShare || 0);
        s.prop2 = Math.max(0, s.prop2 - d2);
        s.prop1 = Math.max(0, s.prop1 - (dm - d2));
      } else s.prop1 = Math.max(0, s.prop1 - dm);
    } else s.prop2 = Math.max(0, s.prop2 - dm);
    s.m = Math.max(VEH.s2.dry + PAYLOAD + (s.head || 0), s.m - dm);
    s.t += dt;

    const newAlt = Math.hypot(s.x, s.y) - RE, newSpeed = Math.hypot(s.vx, s.vy);

    // --- tai trong khi dong: q * goc tan cong. Vuot han muc -> vo than. ---
    // Tinh CA KHI TU LAI: gio cat day than lech khoi dong khi, phi cong khong
    // can lam gi sai van co goc tan — dung nhu ngoai doi.
    if (newSpeed > 50) {
      const r4 = Math.hypot(s.x, s.y), u4x = s.x / r4, u4y = s.y / r4;
      const dN = thrustDir(s, newAlt, newSpeed, mp);
      const thN = Math.atan2(dN[0] * u4y - dN[1] * u4x, dN[0] * u4x + dN[1] * u4y);
      const alpha = Math.abs(angleWrap(thN - airPitch(s)));
      s.alpha = alpha;
      const A3 = atmosphere(newAlt);
      const we4 = windAt(newAlt, s.t);
      const rv4 = Math.hypot(s.vx - u4y * we4, s.vy + u4x * we4);
      const qa = 0.5 * A3.rho * rv4 * rv4 * alpha;
      s.qAlpha = qa;
      if (qa > Q_ALPHA_LIMIT) {
        events.push({ type: 'RUD', t: s.t, alt: newAlt, v: newSpeed, qAlpha: qa });
        s.alive = false; s.rud = true;
        return events;
      }
    } else { s.alpha = 0; s.qAlpha = 0; }

    // --- buoc 1-2: ha ga ve 3 may giua va danh lua tau khi VAN CON DINH ---
    if (s.stage === 1 && !s.hot &&
        s.prop1 <= VEH.s1.prop * (HOT_STAGE_FRAC + HOT_LEAD)) {
      s.hot = 1; s.hotT = 0;
      events.push({ type: 'HOTSTAGE', t: s.t, alt: newAlt, v: newSpeed });
    }
    if (s.hot) s.hotT += dt;

    // --- buoc 3-4: het cua so (hoac can binh) thi NHA ---
    if (s.stage === 1 && (s.hotT >= HOT_DUR || s.prop1 <= VEH.s1.prop * HOT_STAGE_FRAC * 0.35)) {
      events.push({ type: 'MECO', t: s.t, alt: newAlt, v: newSpeed, hotT: s.hotT });
      s.stage = 2; s.hot = 0; s.m = VEH.s2.dry + PAYLOAD + s.prop2 + (s.head || 0);
      events.push({ type: 'IGNITION', t: s.t, alt: newAlt, v: newSpeed });
      // khoi luong tut dot ngot khi bo booster -> chon lai throttle NGAY,
      // neu khong telemetry frame ke tiep se bao vot gioi han g.
      const A2 = atmosphere(newAlt);
      const q2 = 0.5 * A2.rho * newSpeed * newSpeed;
      const re = selectSetting(s, A2.p, q2, opts.manualThrottle);
      s.throttle = re.th; s.nSL = re.nSL; s.nVac = re.nVac;
    }
    if (s.stage === 2 && newSpeed >= TARGET_V && newAlt >= TARGET_ALT) {
      events.push({ type: 'SECO', t: s.t, alt: newAlt, v: newSpeed }); s.alive = false;
    } else if (s.stage === 2 && s.prop2 <= 0) {
      events.push({ type: 'DEPLETED', t: s.t, alt: newAlt, v: newSpeed }); s.alive = false;
    } else if (newAlt < -10) {
      events.push({ type: 'IMPACT', t: s.t, alt: newAlt, v: newSpeed }); s.alive = false;
    }
    return events;
  }

  function telemetry(s) {
    const r = Math.hypot(s.x, s.y), alt = r - RE, speed = Math.hypot(s.vx, s.vy);
    const A = atmosphere(alt);
    let T = s.stage === 1
      ? clusterThrust(VEH.s1.eng, s.throttle, A.p, s.nSL)
      : s2Thrust(s.throttle, A.p, s.nSL, s.nVac);
    // Trong cua so hot-stage dong ho phai cong ca luc day cua tau, khong thi
    // no bao 0.3 g trong khi thuc te ca chong dang chiu gap doi.
    if (s.stage === 1 && s.hot) {
      const T2 = s2Thrust(1, A.p, VEH.s2.sl.n, 0);
      T = { F: T.F + T2.F, mdot: T.mdot + T2.mdot };
    }
    const ur = [s.x / r, s.y / r];
    return {
      t: s.t, alt, speed, q: 0.5 * A.rho * speed * speed,
      mach: A.a > 0 ? speed / A.a : 0, mass: s.m, throttle: s.throttle,
      stage: s.stage, thrust: T.F, axialG: T.F / s.m / G0,
      vspeed: s.vx * ur[0] + s.vy * ur[1],
      propFrac: s.stage === 1 ? s.prop1 / VEH.s1.prop : s.prop2 / (VEH.s2.prop - VEH.s2.header),
      head: s.head || 0,
      engines: s.stage === 1 ? (s.hot ? s.nSL + VEH.s2.sl.n : s.nSL) : s.nSL + s.nVac,
      downrange: Math.atan2(s.x, s.y) * RE,
      alpha: s.alpha || 0, qAlpha: s.qAlpha || 0,
      prograde: progradePitch(s), rho: A.rho,
    };
  }

  /* ==================== THA VE TINH ====================
     Starlink V2 mini ~800 kg. Cua kieu "hop keo Pez": ve tinh bi day ra VUONG GOC voi van
     toc, luan phien hai ben, moi lan mot con. Tren 86 km khi quyen bang 0 trong mo hinh nay
     nen ve tinh bay hai-the thuan tuy — khong can luc can. */
  const SAT = { m: 800, dv: 1.2, gap: 1.6 };        // kg, m/s day ra, giay giua hai con

  function makeSat(s, k) {
    const sp = Math.hypot(s.vx, s.vy) || 1;
    const nx = -s.vy / sp, ny = s.vx / sp, sg = (k % 2) ? 1 : -1;
    return { x: s.x, y: s.y, vx: s.vx + nx * SAT.dv * sg, vy: s.vy + ny * SAT.dv * sg, t: 0, idx: k };
  }
  /* Mot buoc quy dao hai-the (dung cho ca ve tinh lan tau khi dang tha). */
  function orbitStep(p, dt) {
    const f = q => { const r = Math.hypot(q.x, q.y), g = MU / (r * r);
                     return [q.vx, q.vy, -g * q.x / r, -g * q.y / r]; };
    const adv = (q, k, h) => ({ x: q.x + k[0]*h, y: q.y + k[1]*h, vx: q.vx + k[2]*h, vy: q.vy + k[3]*h });
    const k1 = f(p), k2 = f(adv(p,k1,dt/2)), k3 = f(adv(p,k2,dt/2)), k4 = f(adv(p,k3,dt));
    p.x += dt/6*(k1[0]+2*k2[0]+2*k3[0]+k4[0]);
    p.y += dt/6*(k1[1]+2*k2[1]+2*k3[1]+k4[1]);
    p.vx += dt/6*(k1[2]+2*k2[2]+2*k3[2]+k4[2]);
    p.vy += dt/6*(k1[3]+2*k2[3]+2*k3[3]+k4[3]);
    if (p.t !== undefined) p.t += dt;
    return p;
  }
  /* Can diem / vien diem — de biet ve tinh co THAT SU o lai quy dao hay se roi lai. */
  function orbitOf(p) {
    const r = Math.hypot(p.x, p.y), v2 = p.vx * p.vx + p.vy * p.vy;
    const a = 1 / (2 / r - v2 / MU);
    const h = p.x * p.vy - p.y * p.vx;
    const e = Math.sqrt(Math.max(0, 1 - h * h / (MU * a)));
    return { a, e, peri: a * (1 - e) - RE, apo: a * (1 + e) - RE };
  }

  /* DOT TRON QUY DAO ngay tai cho. BAT BUOC truoc khi tha hang: sau SECO can diem nam
     DUOI MAT DAT (-537 km khi cho 60 con) — do la duong bay xuyen khi quyen ma SpaceX chon,
     nen tha ve tinh o do thi CA 60 CON ROI LAI, do duoc dung nhu vay. Phai tron truoc, va
     tron luc CON MANG HANG nen dat: 549 m/s khi rong, 803 m/s voi 60 con, 864 m/s voi 75. */
  function circularize(s) {
    const r = Math.hypot(s.x, s.y), ux = s.x / r, uy = s.y / r;
    const vC = Math.sqrt(MU / r), tvx = uy * vC, tvy = -ux * vC;
    const dv = Math.hypot(tvx - s.vx, tvy - s.vy);
    const m = VEH.s2.dry + PAYLOAD + s.prop2 + (s.head || 0);
    const dm = m * (1 - Math.exp(-dv / (VEH.s2.vac.isp * G0)));
    if (dm >= s.prop2) return { ok: false, dv, need: dm / 1000, have: s.prop2 / 1000 };
    s.prop2 -= dm; s.vx = tvx; s.vy = tvy;      // AN BINH CHINH, khong dung toi header
    s.m = VEH.s2.dry + PAYLOAD + s.prop2 + (s.head || 0);
    return { ok: true, dv, used: dm / 1000, orbit: orbitOf(s) };
  }

  /* DOT HA QUY DAO — nguoc voi circularize: day NGUOC chieu bay de keo can diem xuong hanh
     lang tai nhap. Game goi dung tai diem ma planShipReturn da chon (plan.burnAng). */
  function deorbitBurn(s, dv) {
    const sp = Math.hypot(s.vx, s.vy);
    if (!(dv > 0) || sp < 1) return { ok: false, dv: 0, used: 0, orbit: orbitOf(s) };
    const m = VEH.s2.dry + PAYLOAD + s.prop2 + (s.head || 0);
    const dm = m * (1 - Math.exp(-dv / (VEH.s2.vac.isp * G0)));
    const k = -dv / sp;
    s.vx *= 1 + k; s.vy *= 1 + k;
    s.prop2 = Math.max(0, s.prop2 - dm);        // AN BINH CHINH
    s.m = VEH.s2.dry + PAYLOAD + s.prop2 + (s.head || 0);
    return { ok: true, dv, used: dm / 1000, orbit: orbitOf(s) };
  }

  /* ==================================================================
     BOOSTER QUAY VE — boostback, entry burn, suicide burn, bat bang thap
     ================================================================== */
  const BCD = 1.15;              // roi day truoc: tru tron cut, Cd cao

  /* --- Dong luc hoc tu the: booster la VAT RAN co quan tinh quay, khong phai chat diem.
     Huong day di theo goc than b.th, chi doi duoc khi co MO-MEN. Ba nguon mo-men,
     moi nguon chi hieu qua trong mot vung bay — dung nhu Super Heavy that:
       gimbal   : manh nhat, chi co khi dong co dang chay
       grid fin : ti le voi ap suat dong, chi an trong khi quyen
       RCS      : khi nong tu thung chinh, la thu DUY NHAT dung duoc trong chan khong  */
  const B_LEN = 69, B_COM = 28;                 // m: chieu dai, trong tam tinh tu day
  const ARM_ENG = B_COM;                        // canh tay don mat may -> trong tam
  const ARM_FIN = 62 - B_COM;                   // grid fin o 62 m
  const GIMBAL_MAX = 15 * Math.PI / 180;
  const S_FIN = 30, CN_FIN = 1.2, CL_FIN = 0.8; // dien tich + he so cua 4 canh
  const RCS_TMAX = 5.5e6;                       // N*m — du lat 180 do trong ~17 s
  const RCS_TANK = 3500, RCS_FLOW = 8;          // kg, kg/s — voi khi nong an tu thung chinh
  /* LUC NGANG THUAN cua RCS khi nong — cung cach tinh nhu tau (xem ship3d RCS_TMAX):
     cum mui va cum duoi phut CUNG CHIEU theo ti le canh tay don thi mo-men triet tieu,
     con lai la luc tinh tien. Cum o ~66 m va ~8 m, trong tam 28 m:
       F_tong = F_cum * (1 + (28-8)/(66-28)) = 1.53 F_cum
     Lay F_cum 46 kN nhu tau -> ~70 kN. (Neu suy tu RCS_TMAX 5.5 MN.m voi canh tay 58 m
     thi duoc toi 145 kN; lay muc THAP cho chac.) Binh 3500 kg, ve toi dat con ~3200 kg
     chua dung — day la kho du tru dang nam khong. */
  const RCS_FLAT = 70e3;         // N — luc ngang thuan lon nhat
  const RCS_ISP = 300;           // s — khi nong an tu bon chinh
  const CN_BODY = 1.1;                          // luc phap tuyen than khi co goc tan
  const K_STAB = 0.42, ARM_STAB = 12;           // on dinh khi dong (tu xoay ve day truoc)
  const K_DAMP = 0.55;                          // can xoay khi dong

  const inertia = m => Math.max(1e6, m * B_LEN * B_LEN / 12);
  const CATCH_ALT = 120;         // m — do cao canh tay chopstick
  /* MUC TIEU HA CANH tham so hoa. 0 = thap o be phong; gia tri khac = diem ha
     khac tren duong bay (vd xa lan ngoai khoi). Bo lai tinh sai so THEO muc
     tieu nay o moi buoc, nen doi muc tieu giua chuyen van bam duoc. */
  let B_TARGET = 0, S_TARGET_DR = 0;
  /* Do cao KET THUC chuyen bay cua booster. CA HAI diem ha deu la THAP DUA:
     mot tren bo, mot tren xa lan ngoai khoi. Nen deu dung CATCH_ALT.
     (DA THU cho xa lan ha han xuong mat san 4 m kem sau chan chong. Sai huong:
     Super Heavy khong co chan, va hai loai diem ha khac nhau ve co cau thi
     phai dong bo bang cach dua THAP ra bien, khong phai lap chan vao xe.) */
  const bStop = b => CATCH_ALT + (b && b.tw ? b.tw.y : 0);

  /* ===== XE TRUOT CUA THAP DI DON BOOSTER =====
     Truoc day thap booster chi ton tai trong PHAN HINH: twCapture ben hotstage cho canh tay
     mo/khep va xe truot chay theo chot, nhung VAT LY thi cao do bat la hang so 120 m va phep
     bat do lech so voi mot DIEM CO DINH. Nghia la cai xe truot tren man hinh khong bat duoc gi.
     Tau thi nguoc lai: towerStep cua no la vat ly that, va do chinh la ly do tau "bullseye
     0.00 m" con booster thi ~1 m — xe truot cua tau bu not doan cuoi.
     Nay booster co xe truot that, cung gioi han voi ben hinh:
       REACH : truot ngang toi da (khop TW_XMAX = 3.5 m ben hinh)
       VL/AL : toc do va gia toc truot ngang (lay nhu tau)
       TRACK_H: duoi do cao nay xe moi bam — tren do no do o giua
       RISE_H/RISE_V: co cau CHAY LEN DON o met cuoi. RISE_V = 0 tuc la DANG TAT — xem
                      "da thu va bo" ben duoi. Giu lai ma vi neu bat len thi con cho ma sua.

     Xe truot KHONG he tac dong nguoc vao chuyen bay: RISE_V = 0 nen cao do bat van la hang
     so, quy dao bay giong TUNG BIT ban truoc. No chi doi mot thu: lech duoc do TU CANH TAY
     chu khong phai tu mot diem tuong tuong.

     SO DO DUOC (tools/boosteval.js):
       · Quet tat dinh 7 thoi tiet x 4 dich x 3 buoc tich phan: 84/84 bat duoc, THAP BO
         21/21 va ca 21 deu PERFECT — lech trung binh 0.24 m, te nhat 1.33 m (truoc khi co
         xe truot: 1.00 / 2.55 m).
       · Bo tan xa 112 chuyen: 112/112 bat duoc, 52 perfect; thap bo lech trung binh 0.43 m,
         te nhat 4.15 m (truoc: 1.15 / 4.90).

     DA THU VA BO:
       · XE CHAY LEN DON (RISE_V = 1 m/s, 8 m cuoi): toc do cham vot tu 3.2 len 4.3-5.9 m/s
         va KHONG con chuyen nao perfect. Ly do: xe di len thi toc do khep = |v_dung| + v_xe,
         ma luat ha lai nham V_TD theo van toc TUYET DOI. Tau khong dinh vi no tinh moi thu
         theo xe (hv = f.vu - tw.vy). Muon bat lai thi phai sua ca luat doc theo xe truot.
       · XE BAM VI TRI HIEN TAI (thay vi diem cham du bao): xe co quan tinh nen luon tre;
         trong giong ra xa lan booster con lac vai met o doan cuoi, xe cam 3.5 m ve mot ben
         dung luc booster ve ben kia -> lech SO VOI XE xa hon la khong co xe, 2 chuyen bi
         day tu bat duoc sang truot (-7.2 m hoa -10.7 m).
       · CHI BAM KHI BOOSTER DA VAO TRONG 6 M: khong hong chuyen nao nhung kem han ban bam
         du bao (thap bo 0.75 m so voi 0.43 m tren bo tan xa).

     DAI YEU CON LAI — GIONG / BAO TUYET RA XA LAN 130-142 KM (ghi de sau nay khoi do lai):
       Lech 8-10 m, thi thoang truot han (2/30 chuyen khi quet ca ba buoc tich phan; truoc
       khi siet tran nghieng la 3/30, truoc khi co xe truot la 4/33). KHONG phai thieu nhien
       lieu: cac chuyen do ve toi noi con 24-26 t.
       Co che (do duoc o giong 130 km): con 43 m tren tay tháp thi lech chi con -6 m, nhung
       than DANG NGHIENG 16.6 do vi lenh vua dao chieu va than tre 2-3 s -> 2.9 m/s2 ngang
       trong 3 giay cuoi, cham o +9.97 m. Tran nghieng h/250 duoi 120 m chinh la de chan bot
       cai do.
       DA THU VA BO: (1) gioi han toc do doi lenh nghieng 8 do/s duoi 200 m nhu tau —
       THAM HOA, 20/30 chuyen dai yeu truot, lech toi 225 m, vi 200 m la cho luat ngang van
       con phai doi lenh nhanh va rong; (2) vung chet 2.5 m duoi 80 m (de xe truot ganh not)
       — gan nhu khong doi gi: 3 truot, bien do 5.89 so voi 5.93. */
  const BTW = { REACH: 3.5, VL: 1.4, AL: 1.1, TRACK_H: 400, RISE_H: 8, RISE_V: 0, A: 1.3 };
  const _tsB = { x: 0, v: 0 };
  function tServoB(x, v, tgt, vmax, amax, dt) {
    const e = tgt - x;
    const vw = (e > 0 ? 1 : -1) * Math.min(vmax, Math.sqrt(2 * amax * Math.abs(e)));
    const dv = vw - v, cap = amax * dt;
    v += dv > cap ? cap : dv < -cap ? -cap : dv;
    x += v * dt;
    if ((tgt - x) * e < 0) { x = tgt; v = 0; }
    _tsB.x = x; _tsB.v = v; return _tsB;
  }
  function bTowerStep(b, dt, f) {
    const tw = b.tw; if (!tw) return;
    const h = f.alt - (CATCH_ALT + tw.y);
    // NGANG: bam theo booster trong tam voi, chi khi no da gan
    /* BAM DIEM CHAM DU BAO chu khong phai cho booster DANG dung: xe truot co quan tinh
       (VL 1.4 m/s, AL 1.1 m/s2) nen bam theo vi tri hien tai thi luon tre. Trong giong ra
       xa lan booster con lac vai met o doan cuoi: xe cam 3.5 m ve mot ben roi booster ve
       ben kia, lech SO VOI XE thanh ra xa hon la khong co xe (2 chuyen bi day tu bat duoc
       sang truot: -7.2 m hoa -10.7 m). Cong ve*tGo thi xe don dung cho booster se toi. */
    const tGo = clamp(h / Math.max(-f.vu, 1), 0, 12);
    const tgt = h < BTW.TRACK_H ? clamp(f.dr - B_TARGET + f.ve * tGo, -BTW.REACH, BTW.REACH) : 0;
    const r = tServoB(tw.ex, tw.vex, tgt, BTW.VL, BTW.AL, dt);
    tw.ex = r.x; tw.vex = r.v;
    // DOC: met cuoi thi len don, nhung chi khi da can ngang xong (khong thi don hut)
    const want = (h <= BTW.RISE_H && Math.abs(f.dr - B_TARGET - tw.ex) < 3) ? BTW.RISE_V : 0;
    tw.vy += clamp(want - tw.vy, -BTW.A * dt, BTW.A * dt);
    tw.y += tw.vy * dt;
    if (tw.y < 0) { tw.y = 0; tw.vy = Math.max(0, tw.vy); }
    if (tw.y > BTW.RISE_H) { tw.y = BTW.RISE_H; tw.vy = Math.min(0, tw.vy); }
  }
  /* Muc tieu TAM XA cua tau: bo lap ke hoach quy dao se giai thoi diem deorbit
     sao cho diem tai nhap dan toi day, thay vi luon nham thap. */
  function setShipTargetDr(dr) { S_TARGET_DR = dr || 0; return S_TARGET_DR; }
  const getShipTargetDr = () => S_TARGET_DR;
  function setBoosterTarget(dr) { B_TARGET = dr || 0; return B_TARGET; }
  const getBoosterTarget = () => B_TARGET;
  /* LUAT HA NGANG CUA BOOSTER — cung khuon voi tau (xem ship3d landArc):
     duong tham chieu co TRAN GIA TOC that + bo uoc luong nhieu bu vao lenh ngang.
       A_B / V_MAX : gia toc phanh va tran toc do khep cua duong tham chieu
       K_U / A_CAP : bam sai lech toc do khep / tran lenh ngang
       D_CAP / KP / KD : duoi 2 D_CAP tron dan sang PD
       W_TAU / K_W : loc va he so bu nhieu;  Q_W: chi bu khi ap suat dong duoi muc nay
       H_TILT / TILT_MIN / MAX : tran nghieng = h/H_TILT trong gioi han */
  const BAP = { A_B: 6, V_MAX: 300, K_U: .9, A_CAP: 9, D_CAP: 60, KP: .25, KD: 1.3,
                W_TAU: .6, K_W: 1, Q_W: 12000, D_FALL: 1500, H_TILT: 150, TILT_MIN: .055, TILT_MAX: .78 };
  const CATCH = { lateral: 10, vspeed: 8, tilt: 8 * Math.PI / 180 };
  const PERFECT = { lateral: 3, vspeed: 3 };

  function makeBooster(s) {
    /* Lay nhien lieu CON THUC. Neu ai do goi voi trang thai thieu prop1 thi
       lui ve muc danh dinh, khong de NaN lan ra ca chuyen bay — da dinh mot
       lan: booster thanh NaN va bay mai khong cham dat. */
    const prop = Number.isFinite(s.prop1) ? Math.max(0, s.prop1)
                                          : VEH.s1.prop * HOT_STAGE_FRAC;
    // tach tang khi dang bay nguoc len: than dang chi theo huong bay
    const r = Math.hypot(s.x, s.y), ux = s.x / r, uy = s.y / r;
    const sp = Math.hypot(s.vx, s.vy);
    const th0 = sp > 1 ? Math.atan2(s.vx * uy - s.vy * ux, s.vx * ux + s.vy * uy) : 0;
    /* LUONG PHUT DAP VAO DINH: 3 Raptor mat bien cua tau xa thang xuong vanh
       hot-stage, mot phan dong luong do truyen vao booster va day no TUT LAI.
       Day khong phai cu day gia — no la ly do booster va tau roi nhau nhanh
       ngay ca truoc khi chenh lech luc day kip an. */
    const mB = VEH.s1.dry + prop;
    const T2s = s2Thrust(1, atmosphere(r - RE).p, VEH.s2.sl.n, 0).F;
    const dv = PLUME_F * T2s * 0.9 / mB;          // ~0.9 s vanh con nhan luong
    const dvx = -(s.vx / Math.max(sp, 1)) * dv, dvy = -(s.vy / Math.max(sp, 1)) * dv;
    return {
      t: 0, x: s.x, y: s.y, vx: s.vx + dvx, vy: s.vy + dvy, prop,
      m: mB, throttle: 0, nEng: 0, pitch: 0,
      th: th0, om: 0, fin: 0, rcs: RCS_TANK, eff: '—',
      phase: 'SEP', alive: true, outcome: null, pi: 0, hBurn: 0,
      tw: { y: 0, vy: 0, ex: 0, vex: 0 },        // xe truot cua thap (xem bTowerStep)
    };
  }

  function bFrame(b) {
    const r = Math.hypot(b.x, b.y), ux = b.x / r, uy = b.y / r;
    return {
      r, ux, uy, alt: r - RE,
      vu: b.vx * ux + b.vy * uy,           // van toc theo phuong dung
      ve: b.vx * uy - b.vy * ux,           // van toc ngang (huong east/downrange)
      dr: Math.atan2(b.x, b.y) * RE,       // tam xa so voi thap
      speed: Math.hypot(b.vx, b.vy),
    };
  }

  function bDerivs(b, th, n, rcsLat) {
    const f = bFrame(b), A = atmosphere(f.alt);
    const T = clusterThrust(VEH.s1.eng, th, A.p, n);
    // luc day di theo TU THE THAT cua than, khong theo lenh
    const c = Math.cos(b.th), si = Math.sin(b.th);
    const tx = f.ux * c + f.uy * si, ty = f.uy * c - f.ux * si;
    let ax = T.F * tx / b.m, ay = T.F * ty / b.m;
    // RCS tinh tien: luc theo phuong NGANG tai cho (cung chieu f.ve), khong doi tu the
    if (rcsLat) { ax += rcsLat * f.uy / b.m; ay += -rcsLat * f.ux / b.m; }
    const g = MU / (f.r * f.r);
    ax -= g * b.x / f.r; ay -= g * b.y / f.r;
    // gio: booster ha canh trong lop bien, gio ngang day no lech khoi thap
    const we = windAt(f.alt, b.t);
    const rvx = b.vx - f.uy * we, rvy = b.vy + f.ux * we;
    const rsp = Math.hypot(rvx, rvy);
    const q = 0.5 * A.rho * rsp * rsp;
    if (rsp > 1e-3 && A.rho > 0) {
      const ivx = rvx / rsp, ivy = rvy / rsp;
      const D = q * BCD * AREA;
      ax -= D * ivx / b.m; ay -= D * ivy / b.m;
      // Goc tan: lech giua truc than va huong nguoc van toc.
      // Than nghieng sinh luc phap tuyen -> DAY LA CACH BOOSTER LAI TRONG KHI QUYEN.
      const aoa = angleWrap(b.th - Math.atan2(-(rvx * f.uy - rvy * f.ux), -(rvx * f.ux + rvy * f.uy)));
      // Dau AM: than roi day-truoc nen dau khi dong la DAY. Mui nga sang dong
      // => day nga sang tay => luc phap tuyen day ve TAY. Cung dau voi mo-men
      // hoi phuc -K_STAB*sin(aoa) ben duoi, hai thu phai nhat quan.
      const Fn = -q * AREA * CN_BODY * Math.sin(2 * aoa) * 0.5
               + q * S_FIN * CL_FIN * b.fin;
      const px = -ivy, py = ivx;                 // phap tuyen voi van toc
      ax += Fn * px / b.m; ay += Fn * py / b.m;
    }
    return { ax, ay, mdot: T.mdot, F: T.F, q, aoa: 0 };
  }

  /* Mot buoc dong luc hoc quay. Phan bo mo-men cho effector kha dung. */
  function attitudeStep(b, dt, cmdPitch, Fthrust, A, f) {
    const I = inertia(b.m);
    const q = 0.5 * A.rho * f.speed * f.speed;
    const errA = angleWrap(cmdPitch - b.th);
    const omWant = clamp(errA * 0.55, -0.30, 0.30);
    const tWant = I * clamp((omWant - b.om) * 1.4, -2.0, 2.0);

    let torque = 0; b.fin = 0; b.rcsCmd = 0;
    if (Fthrust > 1e4) {                                   // gimbal
      const tMax = Fthrust * Math.sin(GIMBAL_MAX) * ARM_ENG;
      torque = clamp(tWant, -tMax, tMax); b.eff = 'GIMBAL';
    } else {
      const tFin = q * S_FIN * CN_FIN * ARM_FIN;
      if (tFin > 1e5) {                                    // grid fin (q > ~82 Pa)
        b.fin = clamp(tWant / tFin, -1, 1);
        torque = b.fin * tFin; b.eff = 'GRID FIN';
      } else if (b.rcs > 0) {                              // RCS khi nong
        torque = clamp(tWant, -RCS_TMAX, RCS_TMAX);
        b.rcsCmd = torque / RCS_TMAX;
        b.rcs = Math.max(0, b.rcs - Math.abs(torque) / RCS_TMAX * RCS_FLOW * dt);
        b.eff = 'RCS';
      } else b.eff = 'KHONG';
    }
    // on dinh khi dong: than tu xoay ve the day-truoc, va can xoay.
    // Theo DONG KHI, khong theo van toc so voi mat dat.
    const wS = windAt(f.alt, b.t);
    const rxS = b.vx - f.uy * wS, ryS = b.vy + f.ux * wS;
    const aoa = angleWrap(b.th - Math.atan2(-(rxS * f.uy - ryS * f.ux), -(rxS * f.ux + ryS * f.uy)));
    torque -= K_STAB * q * AREA * ARM_STAB * Math.sin(aoa);
    torque -= K_DAMP * q * AREA * B_LEN * b.om;

    b.om += torque / I * dt;
    b.om = clamp(b.om, -0.5, 0.5);
    b.th = angleWrap(b.th + b.om * dt);
    b.aoa = aoa;
  }

  /* Diem cham dat du bao neu tat may tu bay gio (co tinh can khi dong). */
  function ballisticImpact(b) {
    // KHONG cache: luc boostback diem cham du bao dich ~10 km moi giay, du lieu
    // cu 0.1 s da lech 1 km. Do thuc te: 13 us/buoc — re, khong can toi uu.
    let x = b.x, y = b.y, vx = b.vx, vy = b.vy, tt = b.t;
    const dt = 1.0, stop = bStop(b);
    for (let i = 0; i < 3000; i++) {
      const r = Math.hypot(x, y), alt = r - RE;
      if (alt <= stop) break;
      const A = atmosphere(alt);
      const g = MU / (r * r);
      let ax = -g * x / r, ay = -g * y / r;
      // GIO trong bo du bao: khong co no thi bo lai chi phan ung sau khi da bi
      // day lech; co no thi no bu truoc, dung nhu bo lai thuc te lam khi co so
      // lieu khi tuong. Doi lai nhiem vu de hon.
      const ux2 = x / r, uy2 = y / r, we2 = windAt(alt, tt);
      const rvx = vx - uy2 * we2, rvy = vy + ux2 * we2;
      const sp = Math.hypot(rvx, rvy);
      if (sp > 1e-3 && A.rho > 0) {
        const D = 0.5 * A.rho * sp * sp * BCD * AREA / b.m;
        ax -= D * rvx / sp; ay -= D * rvy / sp;
      }
      tt += dt;
      vx += ax * dt; vy += ay * dt; x += vx * dt; y += vy * dt;
    }
    return Math.atan2(x, y) * RE;
  }

  const clamp = (v, a, z) => v < a ? a : v > z ? z : v;

  /* Tu lai booster. Tra ve {throttle, pitch, nEng}; pitch la TU THE MONG MUON.
     Vi tu the gio co quan tinh, moi lan doi huong phai CHO CAN XONG roi moi dot —
     dot khi con chia sai huong la phi nhien lieu, dung nhu ngoai doi. */
  function boosterAuto(b) {
    const f = bFrame(b), A = atmosphere(f.alt);
    const g = MU / (f.r * f.r);
    const T13 = clusterThrust(VEH.s1.eng, 1, A.p, 13).F;
    const T3 = clusterThrust(VEH.s1.eng, 1, A.p, 3).F;
    const T1 = clusterThrust(VEH.s1.eng, 1, A.p, 1).F;
    const h = f.alt - bStop(b);
    // Bo lai phai ra lenh theo DONG KHI, vi vat ly tinh goc tan theo dong khi.
    // Dung van toc so voi mat dat thi hai ben lech pha va luc khi dong sai huong.
    const wG = windAt(f.alt, b.t);
    const rgx = b.vx - f.uy * wG, rgy = b.vy + f.ux * wG;
    const retro = Math.atan2(-(rgx * f.uy - rgy * f.ux), -(rgx * f.ux + rgy * f.uy));
    const aligned = d => Math.abs(angleWrap(d - b.th)) < 12 * Math.PI / 180;

    /* UOC LUONG NHIEU: gia toc DO DUOC tru gia toc LUC DAY cua buoc vua tich phan, tru
       LUC CAN THEO MO HINH, roi cong trong luc. Con lai la thu bo lai KHONG biet: gio,
       luc nang do goc tan, sai so mo hinh.
       PHAI tru luc can theo mo hinh: neu khong, "nhieu" do duoc chinh la luc can ti le
       voi van toc — bu no di la tu chong lai cai dang phanh ho minh. Thu bu ca cum: 3/84
       chuyen bat duoc, nhien lieu con 41 t thay vi 11 t (phanh qua nhe).
       boosterAuto co the bi goi nhieu lan trong MOT buoc (tools/fly.js) nen chi cap nhat
       khi dong ho da nhich. */
    const I = b.arcI || (b.arcI = { wD: 0, wU: 0, vp: null, t: b.t, th: b.th });
    const dtA = b.t - I.t;
    if (I.vp && dtA > 1e-6 && dtA < .1) {
      const Tp = clusterThrust(VEH.s1.eng, b.throttle, A.p, b.nEng).F / b.m;
      const c0 = Math.cos(I.th), s0 = Math.sin(I.th);
      const tux = f.ux * c0 + f.uy * s0, tuy = f.uy * c0 - f.ux * s0;
      // luc can theo MO HINH tai trang thai hien tai (dung cong thuc cua bDerivs)
      const rvx = b.vx - f.uy * wG, rvy = b.vy + f.ux * wG, rsp = Math.hypot(rvx, rvy);
      const qq = 0.5 * A.rho * rsp * rsp;
      const Dm = rsp > 1e-3 && A.rho > 0 ? qq * BCD * AREA / b.m : 0;
      const dmx = rsp > 1e-3 ? -Dm * rvx / rsp : 0, dmy = rsp > 1e-3 ? -Dm * rvy / rsp : 0;
      const rx = (b.vx - I.vp[0]) / dtA - Tp * tux + g * f.ux - dmx;
      const ry = (b.vy - I.vp[1]) / dtA - Tp * tuy + g * f.uy - dmy;
      const k = Math.min(1, dtA / BAP.W_TAU);
      I.wD += ((rx * f.uy - ry * f.ux) - I.wD) * k;     // ngang (cung huong f.ve)
      I.wU += ((rx * f.ux + ry * f.uy) - I.wU) * k;     // dung
    }
    if (dtA > 1e-6) { I.vp = [b.vx, b.vy]; I.t = b.t; I.th = b.th; }

    const aNet = Math.max(1, T13 / b.m - g);
    b.hBurn = (f.vu < 0) ? (f.vu * f.vu) / (2 * aNet) : 0;

    // --- huong boostback: day nguoc ve phia diem cham du bao ---
    const bbDir = () => ((b.pi - B_TARGET) > 0 ? -1 : 1) * Math.PI / 2;

    if (b.phase === 'SEP') {
      b.pi = ballisticImpact(b);
      const want = bbDir();
      // lat bang RCS truoc — mat ~20-25 s, giong Super Heavy that
      if (b.t > 6 && aligned(want)) b.phase = 'BOOSTBACK';
      return { throttle: 0, pitch: want, nEng: 0 };
    }
    if (b.phase === 'BOOSTBACK') {
      b.pi = ballisticImpact(b);
      /* Boostback chinh xac hon (800 -> 300 m): moi met sai o day duoc sua bang KHI DONG khi
         roi, con met sua o pha ham thi phai tra bang nghieng than + 1/cos luc day. Thu chieu
         nguoc lai (2500 m, dung som cho re) thi lech te hon ma binh VAN cham day. */
      if (Math.abs(b.pi - B_TARGET) < 150 || b.prop < 88e3) { b.phase = 'COAST'; }
      else {
        const want = bbDir();
        // chua can xong thi khong dot
        return { throttle: aligned(want) ? 1 : 0, pitch: want, nEng: 13 };
      }
    }
    if (b.phase === 'COAST') {
      b.pi = ballisticImpact(b);
      if (f.alt < 62000 && f.vu < 0 && aligned(retro)) b.phase = 'ENTRY';
      else {
        if (Math.abs(b.pi - B_TARGET) > 1200 && b.prop > 100e3 && f.alt > 45000 && f.vu > 0) {
          const want = bbDir();
          return { throttle: aligned(want) ? 0.6 : 0, pitch: want, nEng: 3 };
        }
        return { throttle: 0, pitch: retro, nEng: 0 };   // xoay san ve the vao khi quyen
      }
    }
    if (b.phase === 'ENTRY') {
      if (f.speed < 1100 || f.alt < 38000) { b.phase = 'FALL'; }
      else {
        const eE = f.dr - B_TARGET, sE = eE >= 0 ? 1 : -1;
        const veWant = -sE * Math.min(BAP.V_MAX, Math.sqrt(2 * BAP.A_B * Math.abs(eE)));
        const bias = clamp((veWant - f.ve) * 0.004, -0.26, 0.26);
        const want = retro + bias;
        return { throttle: aligned(want) ? 1 : 0.25, pitch: want, nEng: 13 };
      }
    }
    if (b.phase === 'FALL') {
      /* DA THU san do cao 5.5 km cho pha nay: giup troi lanh (791 -> 276 m)
         nhung hai gio giat (5.6 -> 48 m), tinh chung te hon (2/6 so 3/6).
         Giu nguyen nguong theo hBurn. */
      /* 1.45 -> 1.70: dot ham som hon de co THEM THOI GIAN LAI NGANG. Tai
         diem bat dau dot booster con ~290 m/s van toc ngang phai triet tieu,
         trong khi gia toc ngang thuc te chi ~7-11 m/s2 (nghieng bi chan).
         Voi 1.45 thoi gian dot vua du sat nut nen ket qua bap benh; 1.70 cho
         du bien. Gia: nhien lieu con lai 49 t -> 17 t (van con 5% du tru). */
      /* 1.70 -> 1.95 sau khi them giam tai khi phong: quy dao MECO bi nang
         len (64 -> 68 km trong gio manh) nen booster ve theo cung khac, gio
         giat tut 7/7 xuong 2/7. Dot ham som hon lay lai 7/7.
         DA THU dot som THICH UNG theo do lech ngang (1.70 + |lech|/14000):
         chinh xac hon that (lech tb 2.9 m) nhung CAN NHIEN LIEU — 8/49 chuyen
         khong con du de cham dat. Nhien lieu moi la rang buoc that, khong
         phai do chinh xac.
         DA THU 1.95: thap 43/49 (hon 1.80 mot chuyen) nhung XA LAN tut
         35/35 -> 32/35 voi 3 chuyen CAN SACH nhien lieu. 1.80 giu ca hai
         va con 10.8 t du tru (3.2%). */
      if (h <= b.hBurn * 1.80) { b.phase = 'LANDING'; }
      else {
        b.pi = ballisticImpact(b);
        // Grid fin lai bang goc tan: nghieng than lech khoi huong nguoc van toc,
        // than sinh luc phap tuyen keo ngang. Day la cach booster that dieu huong.
        /* CUNG HO SO PHANH voi pha ham (xem LANDING): lai bang khi dong thi KHONG TON GIOT
           NAO, nen moi met lech xu ly o day la mot met khong phai nghieng than dot nhien lieu
           o duoi. Luat cu nham "toi diem dot ham thi lech 0 va van toc ngang 0" nen o giong
           no ve toi noi chi con 119 m/s khep trong khi ho so doi ~250: phan con lai bi day
           sang pha ham, noi moi met deu phai tra bang nhien lieu. */
        const e1 = f.dr - B_TARGET, s1 = e1 >= 0 ? 1 : -1, d1 = Math.abs(e1), u1 = -s1 * f.ve;
        let aLat;
        if (d1 > BAP.D_FALL) {
          // Con XA: bam ho so phanh — phai giu toc do khep, khong duoc "ve som roi doi"
          const uR1 = Math.min(BAP.V_MAX, Math.sqrt(2 * BAP.A_B * d1));
          const aP1 = uR1 > 1 ? BAP.A_B * Math.min(1, Math.max(0, u1) / uR1) : 0;
          aLat = clamp(-s1 * (BAP.K_U * (uR1 - u1) - aP1), -34, 34);
        } else {
          /* DA GAN: quay ve luat cu (triet CA lech VA van toc ngang tai diem dot ham). Ho so
             phanh o day la sai nguoi sai viec — no CHU DONG giu mot toc do khep, nen chuyen
             bao ra xa lan 120 km da o ngay tam luc 4.4 km lai bi tha troi ra +2186 m. */
          const hRem = Math.max(1, h - b.hBurn), vd = Math.max(0, -f.vu);
          const tGo = Math.max(6, (Math.sqrt(vd * vd + 2 * g * hRem) - vd) / g);
          aLat = clamp(-(6 * e1 / (tGo * tGo) + 4 * f.ve / tGo), -34, 34);
        }
        const q = 0.5 * A.rho * f.speed * f.speed;
        if (q > 800) {                       // du khi de grid fin an -> lai bang khi dong
          // a_n = (q*A*CN/m) * sin(2*aoa)/2  ->  nghich dao ra goc tan can dat
          const wF = windAt(f.alt, b.t);
          const spF = Math.hypot(b.vx - f.uy * wF, b.vy + f.ux * wF);
          const aWF = spF > 1 ? (0.5 * A.rho * spF * spF * BCD * AREA) * (wF / spF) / b.m : 0;
          const auth = q * AREA * CN_BODY / b.m;
          const aoaWant = 0.5 * Math.asin(clamp(-2 * (aLat + aWF) / Math.max(auth, .01), -0.94, 0.94));
          return { throttle: 0, pitch: angleWrap(retro + aoaWant), nEng: 0 };
        }
        if (b.prop > 58e3 && Math.abs(aLat) > 0.8) {   // con o cao, khong khi loang -> dung day
          const Tn = clusterThrust(VEH.s1.eng, 1, A.p, 3).F;
          const th = clamp(Math.abs(aLat) * b.m / Math.max(Tn, 1), 0.4, 0.85);
          const want = (aLat > 0 ? 1 : -1) * Math.PI / 2;
          return { throttle: aligned(want) ? th : 0, pitch: want, nEng: 3 };
        }
        return { throttle: 0, pitch: retro, nEng: 0 };
      }
    }
    /* =================== LANDING: dot ham + luat ngang theo HO SO PHANH ===================
       Luat cu (ZEM/ZEV voi tGo = 2h/|v_dung| kep 2-13 s) khong biet hai su that do duoc:
         · TRAN GIA TOC NGANG that chi ~9 m/s2 (day nghieng + luc phap tuyen than) va gan
           nhu KHONG doi theo do cao — ma luat cu ra lenh toi 30 m/s2. No "tin" minh phanh
           duoc nen ve toi noi con 140 m/s ngang o 1.5 km: giong vao thap = dam, lech 39-46 m.
         · LUC CAN AN TOC DO KHEP: o 130 kPa thanh phan ngang cua luc can toi 5 m/s2 nguoc
           chieu khep. Giong vao thap tut tu 119 xuong 65 m/s khep chi trong 8 s.
       Nay dung CUNG KHUON voi tau: duong tham chieu co tran gia toc (BAP.A_B) va bo uoc
       luong nhieu bu vao lenh, tran nghieng khong tu sap truoc khi ngang xong.
       DOC thi GIU NGUYEN cach cu (dot ham theo v^2/2h): da thu tru nhieu dung do duoc ra
       khoi luc day can — luc can doc hang chuc m/s2 lam lenh ga tut, 80/84 chuyen dam voi
       41 t nhien lieu con lai. Chi them bu cos(nghieng).

       RCS TINH TIEN (xem doan phan bo o duoi): than booster BAM LENH NGHIENG RAT CHAM — do
       duoc tre 2-3 s, lenh 4.4 do thi than moi len 1.4 do — nen 100 m cuoi vong vi tri khong
       khep noi, sai so dung khung o 5-6 m roi cham. Luc RCS thi TUC THI, khong phai cho xoay
       than. Binh khi nong 3500 kg truoc day ve toi dat con ~3200 kg CHUA DUNG MOT GIOT: ca pha
       ha chi dung gimbal (do duoc: GIMBAL 67-70 s, RCS 0 s). Nay duoi 300 m RCS ganh phan ngang
       truoc, than chi lo phan du — than dung gan nhu THANG DUNG (nghieng luc cham 0.0-0.5 do o
       ban chi them RCS, so voi 2-5 do truoc day) va chi ton 30-90 kg.

       SO DO DUOC (tools/boosteval.js, so voi luat CU cua ban goc):
         · Quet tat dinh 7 thoi tiet x 4 dich x 3 buoc tich phan: bat duoc 84/84 (cu 81/84).
           THAP BO 21/21 va CA 21 DEU PERFECT — lech trung binh 1.00 m, te nhat 2.55 m (cu
           lech trung binh 4.03 m, chi 2 chuyen perfect; va giong vao thap thi DAM 46 m).
         · Bo tan xa (sai so luc tach tang +-30 m/s va +-600 m, thieu toi 6 t nhien lieu, gio
           mo hinh sai 0.7-1.3): bat duoc 112/112 (cu 102/112), 51 chuyen perfect (cu 6).
           Thap bo lech trung binh 1.15 m / te nhat 4.90 m (cu 4.41 / 9.36).
         · So tung chuyen voi ban chua co RCS: 83 chuyen do lech GIAM, 28 tang, khong chuyen
           nao bi lam hong, trung binh giam 1.28 m.

       GIOI HAN CON LAI, ghi de sau nay khoi do lai:
         · Nhien lieu van ve gan het o mot so chuyen vao thap (con 0.0-0.6 t) — khong con lam
           roi chuyen nao nua, nhung khong co du tru. Muon co du tru thi phai noi ngan sach o
           boostback (dang nuot 208 t trong 340 t), khong phai chinh them o day.
         · Nhay theo buoc tich phan TANG: chenh lech trung binh 1.95 m, te nhat 6.5 m (giong ra
           xa lan 160 km). Doi lai la moi buoc tich phan deu bat duoc — ban truoc lech it hon
           nhung co ca DAM 19 m o buoc 0.01 s.
         · Nhanh PD PHAI duoc kep vao tran gia toc. Thu siet tay lai ma quen kep (KP .35):
           cach tam 100 m no doi 35 m/s2 trong khi tran that la 9 -> 24/28 chuyen dam, lech
           50-130 m. Kep roi thi KP .25 / KD 1.3 chay tot, con KP .45 lai vo tiep (36/112).
         · LAI TAY khong co RCS tinh tien: lenh tu game chi co {throttle, pitch, nEng}, dung y
           nhu tau. Gianh lai o 200 m cuoi thi lech ~3.4 m thay vi ~1 m — co y de vay. */
    const e0 = f.dr - B_TARGET;                        // lech (+ : booster o xa hon dich)
    const sgn = e0 >= 0 ? 1 : -1, d = Math.abs(e0);
    const u = -sgn * f.ve;                             // toc do KHEP (>0 la dang toi dich)

    /* --- DOC: giu dung nhip ha cua ban goc (dot ham tinh lai moi buoc, nham cham o V_TD),
       vi chinh nhip do moi de lai du thoi gian cho phan ngang. DA THU VA BO: bam toc do ha
       tham chieu kieu tau (v = min(tran ham, V_TD + K h)) — no ha SAT TRAN HAM nen nhanh hon
       ban goc o doan giua, phan ngang thieu thoi gian: den moc 100 m con lech 493-710 m
       (ban goc 16 m), 25/28 chuyen dam.
       Chi them SAN CHONG TREO: 3 may ga toi thieu cho T/W 1.25 nen khi luat doi it luc day
       hon trong luong, booster dung yen va treo den can binh (ban truoc treo 30 s o 140 m,
       dot ham 99.8 s / 152.6 t so voi 69.7 s / 131.1 t). San dat DUOI duong ha binh thuong
       (~sqrt(2*3*h)) nen chuyen bay binh thuong khong bao gio cham toi no. */
    const V_TD = 2.5;
    const aReq = (f.vu * f.vu - V_TD * V_TD) / (2 * Math.max(h, 2));
    let Fneed = b.m * (aReq + g);
    const vFloor = V_TD + 2.2 * Math.sqrt(Math.max(h - 3, 0));
    if (-f.vu < vFloor) Fneed = Math.min(Fneed, b.m * g * 0.75);
    /* Chon CUM MAY NHO NHAT du suc. Duoi 400 m cho phep 1 MAY: 3 may o ga toi thieu da la
       T/W 1.25 nen khong the giu toc do ha, con 1 may chay 0.4-1.0 thi T/W 0.42-1.04 —
       vua du de dieu toc do cham. */
    const pick = (Fn) => { if (h < 250 && Fn <= T1 * 0.95) return [1, T1]; if (Fn <= T3 * 0.95) return [3, T3]; return [13, T13]; };
    let [nEng, Tf] = pick(Fneed);

    /* --- ngang: ho so phanh. u_ref = sqrt(2 A_B d) kep V_MAX; khi dang bam dung duong
       tham chieu thi gia toc chinh la -A_B, con lai bam sai lech bang K_U. Lenh bao hoa o
       A_CAP theo CA HAI chieu — ke ca chieu TANG toc khep, viec luat cu khong he lam:
       giong vao thap vao dot ham voi 119 m/s khep trong khi ho so doi ~250. */
    const uRef = Math.min(BAP.V_MAX, Math.sqrt(2 * BAP.A_B * d));
    const aProf = uRef > 1 ? BAP.A_B * Math.min(1, Math.max(0, u) / uRef) : 0;
    let aLat = -sgn * clamp(BAP.K_U * (uRef - u) - aProf, -BAP.A_CAP, BAP.A_CAP);
    if (d < 2 * BAP.D_CAP) {                            // sat tam: tron dan sang PD cho em
      const w = clamp(d / BAP.D_CAP - 1, 0, 1);
      aLat = w * aLat - (1 - w) * (BAP.KP * e0 + BAP.KD * f.ve);
    }
    /* KEP CA NHANH PD vao tran gia toc that. Thieu cai nay thi PD la duong day khong dat:
       thu KP .35 ma khong kep -> o cach tam 100 m no doi 35 m/s2 (tran that 9), lenh nghieng
       bao hoa nguoc dau va 24/28 chuyen dam, lech 50-130 m. */
    aLat = clamp(aLat, -BAP.A_CAP, BAP.A_CAP);
    // Bu nhieu do duoc — CHI o khi quyen loang (q < Q_W): tren do "nhieu" con lan voi sai
    // so mo hinh luc can o ap suat dong lon, bu vao chi lam lenh giat.
    const qNow = 0.5 * A.rho * f.speed * f.speed;
    if (qNow < BAP.Q_W) aLat -= BAP.K_W * I.wD;

    /* RCS TINH TIEN GANH TRUOC (dung y nhu tau): than tau bam lenh nghieng CHAM — do duoc
       tre 2-3 s, lenh 4.4 do thi than moi 1.4 do — nen 100 m cuoi vong vi tri khong khep
       noi va sai so dung khung o 5-6 m. Luc RCS thi TUC THI va khong can xoay than.
       Chi dung duoi B_RCS_H (sat thap, luc thuc su can) de khoi phi khi. */
    let rcsLat = 0;
    if (h < 300 && b.rcs > 0) {
      rcsLat = clamp(aLat * b.m, -RCS_FLAT, RCS_FLAT);
      aLat -= rcsLat / b.m;                             // phan con lai moi phai nghieng than
    }

    /* Tran nghieng. Cu: clamp(h/600, .055, .78) — o 150 m con 1.4 do, tham quyen bien mat
       DUNG LUC con 40 m/s ngang. Nay h/150: 100 m -> 38 do, 30 m -> 11 do, 12 m -> 4.6 do,
       van ve duoi nguong bat 8 do khi cham (than tre ~1 s, luc do dang ha 2-3 m/s). */
    const aAvail = Math.max(1, Tf * 0.7 / b.m);
    /* Duoi 120 m siet tran nghieng lai (h/250 thay vi h/150): o do lech thuong chi con vai
       met, ma tran rong cho phep lenh 16 do — than tre 2-3 s bam theo roi VOT QUA (giong
       130 km: con 43 m tren tay, lech -6 m, than 16.6 do -> cham +9.97 m). */
    const tiltCap = clamp(h / (h < 120 ? 250 : BAP.H_TILT), BAP.TILT_MIN, BAP.TILT_MAX);
    const pitch = clamp(Math.asin(clamp(aLat / aAvail, -.78, .78)), -tiltCap, tiltCap);

    // nghieng roi thi thanh phan doc chi con cos(nghieng): phai nang luc day len, khong thi
    // moi lan lai ngang la tut do cao nhanh hon va an mat chinh cai thoi gian dang can
    Fneed /= Math.cos(Math.min(Math.abs(pitch), 0.6));
    [nEng, Tf] = pick(Fneed);
    let throttle = clamp(Fneed / Math.max(Tf, 1), 0.4, 1);
    if (f.vu > 0.5) throttle = 0;
    return { throttle, pitch, nEng, rcsLat };
  }

  function boosterStep(b, dt, cmd) {
    if (!b.alive) return null;
    const c = cmd || boosterAuto(b);
    /* HET NHIEN LIEU THI HET LUC DAY. Truoc day chi dat lai b.throttle = 0
       SAU khi tich phan, nhung buoc ke tiep boosterAuto() ra lenh ga moi va
       bDerivs() dung thang lenh do — thanh ra booster day duoc voi 0 t nhien
       lieu, vo han. Bug that, khong phai chuyen chinh so: trong tuyet va bao
       tuyet no TREO LO LUNG ngay tren nguong bat 120 m (vu = +0.5 m/s, ga
       toi thieu 0.4), dot can sach roi ket o do — 18000 s mo phong khong bao
       gio cham dat. */
    if (b.prop <= 0) { c.throttle = 0; c.nEng = 0; }
    b.throttle = c.throttle; b.nEng = c.nEng; b.pitch = c.pitch;

    const fr = bFrame(b), Aq = atmosphere(fr.alt);
    const Fth = clusterThrust(VEH.s1.eng, c.throttle, Aq.p, c.nEng).F;
    attitudeStep(b, dt, c.pitch, Fth, Aq, fr);

    const rcsL = b.rcs > 0 ? (c.rcsLat || 0) : 0;
    b.rcsLat = rcsL;
    if (rcsL) b.rcs = Math.max(0, b.rcs - Math.abs(rcsL) / (RCS_ISP * G0) * dt);
    const f0 = (st) => { const d = bDerivs(st, c.throttle, c.nEng, rcsL); return [st.vx, st.vy, d.ax, d.ay, d.mdot]; };
    // PHAI mang theo `t`: windAt(alt, undefined) ra NaN, khi do `rsp > 1e-3` la
    // false va CA KHOI LUC CAN bi bo qua o 3/4 buoc RK4 — booster mat 3/4 luc
    // can ma khong bao loi gi.
    const adv = (st, k, hh) => ({ t: st.t + hh, x: st.x + k[0]*hh, y: st.y + k[1]*hh,
                                  vx: st.vx + k[2]*hh, vy: st.vy + k[3]*hh,
                                  m: st.m, th: st.th, fin: st.fin });
    const k1 = f0(b), k2 = f0(adv(b,k1,dt/2)), k3 = f0(adv(b,k2,dt/2)), k4 = f0(adv(b,k3,dt));
    b.x  += dt/6*(k1[0]+2*k2[0]+2*k3[0]+k4[0]);
    b.y  += dt/6*(k1[1]+2*k2[1]+2*k3[1]+k4[1]);
    b.vx += dt/6*(k1[2]+2*k2[2]+2*k3[2]+k4[2]);
    b.vy += dt/6*(k1[3]+2*k2[3]+2*k3[3]+k4[3]);
    const dm = dt/6*(k1[4]+2*k2[4]+2*k3[4]+k4[4]);
    b.prop = Math.max(0, b.prop - dm);
    b.m = Math.max(VEH.s1.dry, b.m - dm);
    b.t += dt;
    if (b.prop <= 0) { b.throttle = 0; b.nEng = 0; }

    const f = bFrame(b);
    bTowerStep(b, dt, f);
    if (f.alt <= bStop(b)) {
      b.alive = false;
      b.throttle = 0; b.nEng = 0;      // vao chot la tat may, dong ho khong con bao 3 may

      /* Ca hai diem ha deu la dua kep nen chung mot nguong — canh tay doi
         tung met du no dat tren bo hay tren xa lan. (Truoc day xa lan duoc
         noi long con 26 m / 11 m/s vi khi do no la mot cai san phang.) */
      /* Lech va toc do deu do SO VOI XE TRUOT — canh tay o do chu khong o diem danh dinh. */
      const lat = Math.abs(f.dr - B_TARGET - b.tw.ex), vs = Math.abs(f.vu - b.tw.vy), tilt = Math.abs(b.th);
      if (lat < CATCH.lateral && vs < CATCH.vspeed && tilt < CATCH.tilt) {
        b.outcome = (lat < PERFECT.lateral && vs < PERFECT.vspeed) ? 'perfect' : 'caught';
      } else b.outcome = 'crash';
      return { type: 'TOUCHDOWN', outcome: b.outcome, lat: f.dr - B_TARGET - b.tw.ex, absDr: f.dr,
               latAbs: f.dr - B_TARGET, vs: f.vu - b.tw.vy, tilt, twEx: b.tw.ex, twY: b.tw.y };
    }
    if (f.alt < -50) { b.alive = false; b.outcome = 'crash'; return { type: 'TOUCHDOWN', outcome: 'crash', lat: f.dr, vs: f.vu, tilt: 0 }; }
    return null;
  }

  function boosterTelemetry(b) {
    const f = bFrame(b), A = atmosphere(f.alt);
    return {
      t: b.t, alt: f.alt, speed: f.speed, vspeed: f.vu, lateral: f.dr,
      hspeed: f.ve, prop: b.prop, propFrac: b.prop / (VEH.s1.prop * HOT_STAGE_FRAC),
      throttle: b.throttle, engines: b.nEng, phase: b.phase, pitch: b.th,
      cmdPitch: b.pitch, om: b.om, fin: b.fin, eff: b.eff, aoa: b.aoa || 0,
      rcs: b.rcs, rcsFrac: b.rcs / RCS_TANK, rcsCmd: b.rcsCmd || 0,
      rcsLat: b.rcsLat || 0,      // N — luc RCS tinh tien dang dung (duong = ve phia dong)
      twY: b.tw ? b.tw.y : 0, twVy: b.tw ? b.tw.vy : 0, twEx: b.tw ? b.tw.ex : 0,
      q: 0.5 * A.rho * f.speed * f.speed, mach: A.a > 0 ? f.speed / A.a : 0,
      impact: b.pi, hBurn: b.hBurn, toBurn: (f.alt - bStop(b)) - b.hBurn,
      target: B_TARGET, missDr: f.dr - B_TARGET - (b.tw ? b.tw.ex : 0), onTower: B_TARGET === 0,
    };
  }

  /* ==================================================================
     STARSHIP QUAY VE — deorbit, belly flop, flip, ha canh
     Vat ly khac han booster: no roi NAM NGANG de lay dien tich can.
     Than tru 50x9 m nam ngang cho ~450 m2 (gap 7 lan dien tich day 63.6 m2),
     nho vay ham tu 7800 m/s xuong ~80 m/s ma khong ton nhien lieu.
     4 flap thay grid fin; phut cuoi lat dung 90 do roi dot ham.
     ================================================================== */
  const SHIP_LEN = 50, SHIP_COM = 22;
  const A_BASE = AREA, A_SIDE = 50 * 9;              // m2: day vs suon
  const CD_AX = 0.9, CD_BROAD = 1.30;
  const S_FLAP = 60, CN_FLAP = 1.0, ARM_FLAP = 18;   // 4 flap
  const SH_RCS_TMAX = 1.6e6, SH_RCS_TANK = 900, SH_RCS_FLOW = 6;
  const K_FLOP = 0.30, K_SDAMP = 0.45;
  /* Gap flap sau khi lat: dien tich can phia DUOI mat di, tam ap dich len phia
     mui, sinh mo-men xoay tau ve the duoi-truoc (thang dung). Day moi la co che
     that cua cu lat — gimbal chi ho tro. Truoc day tao chi mo hinh mo-men cua
     flap ma bo qua LUC CAN cua no, nen cu lat chay bang gimbal don doc. */
  const K_TUCK = 0.55;
  // Than tru DOI XUNG: luc can cuc dai dung o 90 do, 92 do bang y het 88 do.
  // Nen goc danh nghia luc tai nhap phai NAM DUOI 90 de con thay doi duoc CA HAI
  // chieu — tang ve 89 do de bay ngan lai, ha ve 30 do de bay xa them.
  const ENTRY_AOA = 68 * Math.PI / 180;              // danh nghia khi lai tam xa
  const FLOP_AOA = 80 * Math.PI / 180;               // belly flop cuoi: lech khoi diem
                                                     // can bang 90 do de flap phai lam viec
  /* Tau khong bat bang thap: SpaceX moi lam duoc dieu do voi BOOSTER. Voi tau
     ho da lam ha canh mem co dinh diem xuong bien (IFT-4/5/6) — cham mem la
     dat, do chinh xac diem cham thi cham diem theo bac.                     */
  /* Nguong cua tau. Truoc day 200 m goi la "trung tam" — vo nghia khi tau
     duoc BAT bang dua: bo dua chi om duoc vai met, nen 200 m la treo canh
     thap chu khong phai bat duoc, dung nhu nhin thay tren man hinh.
     Sau khi co pha tiep can treo, tau ha chinh xac 1-10 m o hau het thoi tiet
     (quet 18 chuyen: trung binh 14 m, toi da 72 m), nen sieet lai cho that:
       20 m  = vao duoc tay dua
       150 m = truot tay nhung con tren be
     Con lai giu nguyen. */
  const SHIP_LAND = { vspeed: 8, tilt: 8 * Math.PI / 180,
                      bullseye: 20, ontarget: 150, wide: 5000 };
  const shipInertia = m => Math.max(1e6, m * SHIP_LEN * SHIP_LEN / 12);

  function sFrame(sh) {
    const r = Math.hypot(sh.x, sh.y), ux = sh.x / r, uy = sh.y / r;
    return { r, ux, uy, alt: r - RE,
      vu: sh.vx * ux + sh.vy * uy, ve: sh.vx * uy - sh.vy * ux,
      dr: Math.atan2(sh.x, sh.y) * RE, speed: Math.hypot(sh.vx, sh.vy) };
  }

  /* Dien tich va he so can phu thuoc GOC TAN — day la co che chinh cua belly flop. */
  function shipAeroCoef(aoa) {
    const sa = Math.abs(Math.sin(aoa)), ca = Math.abs(Math.cos(aoa));
    return { area: A_BASE * ca + A_SIDE * sa, cd: CD_AX * ca + CD_BROAD * sa };
  }

  function shDerivs(sh, th, n) {
    const f = sFrame(sh), A = atmosphere(f.alt);
    const T = n > 0 ? clusterThrust(VEH.s2.sl, th, A.p, n) : { F: 0, mdot: 0 };
    const c = Math.cos(sh.th), si = Math.sin(sh.th);
    let ax = T.F * (f.ux * c + f.uy * si) / sh.m, ay = T.F * (f.uy * c - f.ux * si) / sh.m;
    const g = MU / (f.r * f.r);
    ax -= g * sh.x / f.r; ay -= g * sh.y / f.r;
    const q = 0.5 * A.rho * f.speed * f.speed;
    if (f.speed > 1e-3 && A.rho > 0) {
      const aoa = angleWrap(sh.th - Math.atan2(-f.ve, -f.vu));
      const k = shipAeroCoef(aoa);
      // Flap khong chi sinh mo-men — xoe ra thi CAN THEM, thu vao thi can it.
      // Day la cach Starship dieu tiet tam xa va toc do roi o pha cuoi.
      const ext = sh.ext === undefined ? 0.5 : sh.ext;
      const D = q * k.cd * k.area * (1 - 0.16 * (sh.tuck || 0)) * (1 + 0.20 * (ext - 0.5));
      const ivx = sh.vx / f.speed, ivy = sh.vy / f.speed;
      ax -= D * ivx / sh.m; ay -= D * ivy / sh.m;
      // Tau tai nhap belly-down: luc nang huong RA XA mat dat, keo dai quang
      // luon — day moi la co che lai tam xa, khong phai luc can.
      const Fn = q * A_SIDE * 0.5 * Math.sin(2 * aoa) * 0.5;
      ax += Fn * (-ivy) / sh.m; ay += Fn * ivx / sh.m;
    }
    return { ax, ay, mdot: T.mdot, F: T.F, q };
  }

  function shAttitude(sh, dt, cmdPitch, Fth, A, f) {
    const I = shipInertia(sh.m);
    const q = 0.5 * A.rho * f.speed * f.speed;
    const errA = angleWrap(cmdPitch - sh.th);
    const omWant = clamp(errA * 0.7, -0.45, 0.45);
    const tWant = I * clamp((omWant - sh.om) * 1.8, -3.0, 3.0);

    let torque = 0; sh.flap = 0;
    if (Fth > 1e4) {
      const tMax = Fth * Math.sin(GIMBAL_MAX) * SHIP_COM;
      torque = clamp(tWant, -tMax, tMax); sh.eff = 'GIMBAL';
    } else {
      const tFlap = q * S_FLAP * CN_FLAP * ARM_FLAP;
      if (tFlap > 8e4) {
        sh.flap = clamp(tWant / tFlap, -1, 1);
        torque = sh.flap * tFlap; sh.eff = 'FLAP';
      } else if (sh.rcs > 0) {
        torque = clamp(tWant, -SH_RCS_TMAX, SH_RCS_TMAX);
        sh.rcsCmd = torque / SH_RCS_TMAX;
        sh.rcs = Math.max(0, sh.rcs - Math.abs(torque) / SH_RCS_TMAX * SH_RCS_FLOW * dt);
        sh.eff = 'RCS';
      } else sh.eff = 'KHONG';
    }
    const aoa = angleWrap(sh.th - Math.atan2(-f.ve, -f.vu));
    // than tru muon nam ngang trong dong khi (dien tich can lon nhat)
    torque -= K_FLOP * q * A_SIDE * 2.0 * (1 - (sh.tuck || 0)) * Math.sin(2 * (Math.abs(aoa) - Math.PI / 2));
    // GAP FLAP SAU: mui can nhieu hon duoi -> xoay ve the thang dung (aoa -> 0)
    if (sh.tuck) torque -= K_TUCK * q * A_SIDE * sh.tuck * Math.sin(aoa);
    torque -= K_SDAMP * q * A_SIDE * SHIP_LEN * sh.om * 0.02;
    sh.om = clamp(sh.om + torque / I * dt, -0.6, 0.6);
    sh.th = angleWrap(sh.th + sh.om * dt);
    sh.aoa = aoa;
  }

  /* Du bao diem cham neu giu nguyen goc tan hien tai (co can khi dong). */
  /* Dat (~12 ms) nhung diem cham luc tai nhap bien thien cham (~1 km/s), khac
     han boostback. Nen goi thua 2 s mot lan la du va khong giet khung hinh. */
  function shipImpactCached(sh, aoaHold) {
    // Cache theo THOI GIAN thoi. So ca goc tan thi truot cache moi buoc vi goc
    // doi lien tuc — bo du bao 12 ms chay 43.000 lan se treo.
    if (sh._pT !== undefined && sh.t - sh._pT < 2) return sh._pV;
    sh._pT = sh.t;
    return (sh._pV = shipImpact(sh, aoaHold));
  }

  function shipImpact(sh, aoaHold, coarse) {
    let x = sh.x, y = sh.y, vx = sh.vx, vy = sh.vy;
    for (let i = 0; i < 40000; i++) {
      const r = Math.hypot(x, y), alt = r - RE;
      if (alt <= CATCH_ALT) break;
      // Buoc THICH NGHI: trong khi quyen gia toc ham toi 50 m/s2, buoc 2 s cho
      // sai so hang chuc km. Ngoai khi quyen thi buoc lon cho nhanh.
      // Buoc phai RAT min: bo tho cho sai so 606 km, bo nay chi 28 km.
      const dt = coarse ? (alt > 100000 ? 3 : alt > 70000 ? 0.8 : 0.25)
                        : (alt > 100000 ? 0.25 : alt > 70000 ? 0.06 : 0.02);
      const A = atmosphere(alt), sp = Math.hypot(vx, vy);
      const g = MU / (r * r);
      let ax = -g * x / r, ay = -g * y / r;
      if (sp > 1e-3 && A.rho > 0) {
        const k = shipAeroCoef(aoaHold);
        const q = 0.5 * A.rho * sp * sp;
        const D = q * k.cd * k.area / sh.m;
        ax -= D * vx / sp; ay -= D * vy / sp;
        // LUC NANG: bo qua no thi du bao lech 100-500 km
        const Fn = q * A_SIDE * 0.5 * Math.sin(2 * aoaHold) * 0.5 / sh.m;
        ax += Fn * (-vy / sp); ay += Fn * (vx / sp);
      }
      vx += ax * dt; vy += ay * dt; x += vx * dt; y += vy * dt;
    }
    return Math.atan2(x, y) * RE;
  }

  function shipAuto(sh) {
    const f = sFrame(sh), A = atmosphere(f.alt);
    const g = MU / (f.r * f.r);
    const h = f.alt - CATCH_ALT;
    const retro = Math.atan2(-f.ve, -f.vu);
    const T3 = clusterThrust(VEH.s2.sl, 1, A.p, 3).F;

    if (sh.phase !== 'FLIP' && sh.phase !== 'LAND') sh.tuck = 0;
    if (sh.phase === 'FLIP' || sh.phase === 'LAND') sh.ext = 0;
    if (sh.phase === 'ENTRY') {
      // Dieu khien TAM XA bang goc tan: goc lon -> can lon -> bay ngan lai.
      sh.pi = shipImpactCached(sh, sh._aoaCmd || ENTRY_AOA);
      const err = sh.pi;                       // muon = 0 (dung thap)
      // He so PHAI nho: 1.2e-5 lam bo lai dap giua hai bien va phi nang luong
      // (lech 53 km). 6e-7 la diem on dinh — tren 9e-7 la vot len hang chuc km.
      const aoa = clamp(ENTRY_AOA + err * 6e-7, 35 * Math.PI / 180, 89 * Math.PI / 180);
      sh._aoaCmd = aoa;
      sh.ext = clamp(0.5 + err * 3e-6, 0, 1);
      if (f.alt < 35000) sh.phase = 'FLOP';
      else return { throttle: 0, pitch: angleWrap(retro + aoa), nEng: 0 };
    }
    if (sh.phase === 'FLOP') {
      sh.pi = shipImpactCached(sh, sh._aoaCmd || FLOP_AOA);
      // nguong lat: can du do cao de xoay 90 do roi ham het van toc roi
      const aNet = Math.max(1, T3 / sh.m - g);
      sh.hBurn = (f.vu < 0) ? (f.vu * f.vu) / (2 * aNet) : 0;
      if (h <= sh.hBurn + 420) { sh.phase = 'FLIP'; sh.flipT = 0; }
      else {
        const aoa = clamp(FLOP_AOA + sh.pi * 3.0e-5, 45 * Math.PI / 180, 89 * Math.PI / 180);
        sh._aoaCmd = aoa;
        // bay dai -> xoe flap cho can them; bay ngan -> thu vao cho luot xa
        sh.ext = clamp(0.5 + sh.pi * 9e-5, 0, 1);
        return { throttle: 0, pitch: angleWrap(retro + aoa), nEng: 0 };
      }
    }
    if (sh.phase === 'FLIP') {
      sh.flipT += 0.02;
      sh.tuck = Math.min(1, sh.flipT / 1.2);        // gap flap sau trong ~1.2 s
      // gap flap, danh lua 3 Raptor, xoay tu nam ngang ve thang dung trong ~4 s
      const lat = clamp(-f.dr * 0.02, -0.30, 0.30);
      if (Math.abs(angleWrap(sh.th - lat)) < 18 * Math.PI / 180 || sh.flipT > 9) sh.phase = 'LAND';
      return { throttle: 1, pitch: lat, nEng: 3 };
    }
    // --- LAND: dot ham ---
    // Tau rong chi con ~135 t: 3 may o ga 40% da cho gia toc len. Phai chon so
    // may theo luc day CAN, giong Starship that ha bang 2-3 may va throttle sau.
    const aReq = (f.vu * f.vu) / (2 * Math.max(h, 2));
    const Fneed = sh.m * (aReq + g);
    let nEng = 3, Tf = T3;
    for (const n of [1, 2, 3]) {
      const Tn = clusterThrust(VEH.s2.sl, 1, A.p, n).F;
      if (Fneed <= Tn * 0.95 || n === 3) { nEng = n; Tf = Tn; break; }
    }
    let throttle = clamp(Fneed / Math.max(Tf, 1), 0.4, 1);
    if (f.vu > 0.5) throttle = 0;
    const tGo = Math.max(1.5, 2 * h / Math.max(Math.abs(f.vu), 5));
    const aLat = clamp(-(6 * f.dr / (tGo * tGo) + 4 * f.ve / tGo), -22, 22);
    const aAvail = Math.max(1, Tf * Math.max(throttle, .4) / sh.m);
    const maxTilt = clamp(h / 700, 0.03, 0.36);
    const pitch = clamp(Math.asin(clamp(aLat / aAvail, -0.36, 0.36)), -maxTilt, maxTilt);
    return { throttle, pitch, nEng };
  }

  function shipReturnStep(sh, dt, cmd) {
    if (!sh.alive) return null;
    const c = cmd || shipAuto(sh);
    sh.throttle = c.throttle; sh.nEng = c.nEng; sh.cmdPitch = c.pitch;
    const fr = sFrame(sh), Aq = atmosphere(fr.alt);
    const Fth = c.nEng > 0 ? clusterThrust(VEH.s2.sl, c.throttle, Aq.p, c.nEng).F : 0;
    shAttitude(sh, dt, c.pitch, Fth, Aq, fr);

    const f0 = st => { const d = shDerivs(st, c.throttle, c.nEng); return [st.vx, st.vy, d.ax, d.ay, d.mdot]; };
    const adv = (st, k, hh) => ({ x: st.x + k[0]*hh, y: st.y + k[1]*hh, vx: st.vx + k[2]*hh,
                                  vy: st.vy + k[3]*hh, m: st.m, th: st.th });
    const k1 = f0(sh), k2 = f0(adv(sh,k1,dt/2)), k3 = f0(adv(sh,k2,dt/2)), k4 = f0(adv(sh,k3,dt));
    sh.x += dt/6*(k1[0]+2*k2[0]+2*k3[0]+k4[0]); sh.y += dt/6*(k1[1]+2*k2[1]+2*k3[1]+k4[1]);
    sh.vx += dt/6*(k1[2]+2*k2[2]+2*k3[2]+k4[2]); sh.vy += dt/6*(k1[3]+2*k2[3]+2*k3[3]+k4[3]);
    const dm = dt/6*(k1[4]+2*k2[4]+2*k3[4]+k4[4]);
    sh.prop = Math.max(0, sh.prop - dm); sh.m = Math.max(VEH.s2.dry, sh.m - dm);
    sh.t += dt;
    if (sh.prop <= 0) { sh.throttle = 0; sh.nEng = 0; }

    const f = sFrame(sh);
    if (f.alt <= CATCH_ALT) {
      sh.alive = false;
      const lat = Math.abs(f.dr), vs = Math.abs(f.vu), tilt = Math.abs(angleWrap(sh.th));
      const soft = vs < SHIP_LAND.vspeed && tilt < SHIP_LAND.tilt;
      sh.outcome = !soft ? 'crash'
        : lat < SHIP_LAND.bullseye ? 'bullseye'
        : lat < SHIP_LAND.ontarget ? 'ontarget'
        : lat < SHIP_LAND.wide ? 'wide' : 'lost';
      return { type: 'SHIP_DOWN', outcome: sh.outcome, lat: f.dr, vs: f.vu, tilt };
    }
    return null;
  }

  /* --- Lap ke hoach quay ve: tron mot vong roi tai nhap dung thap ---------
     Sau SECO can diem nam duoi mat dat (-176 km) nen tau tu roi lai — dung
     kieu quy dao SpaceX chon cho cac chuyen thu. Muon ve DUNG THAP thi phai:
       1. dot tron quy dao tai vien diem (nang can diem len khoi khi quyen)
       2. bay gan tron mot vong
       3. dot deorbit, do lon giai bang phan doi sao cho cham dung thap
     Toan bo chay mot lan, tuc thi.                                        */
  function _coast(st, stop, dt) {
    let { x, y, vx, vy } = st, ang = 0, prev = Math.atan2(x, y), t = 0;
    for (let i = 0; i < 60000; i++) {
      const r0 = Math.hypot(x, y);
      let g = MU / (r0 * r0 * r0);
      vx -= g * x * dt / 2; vy -= g * y * dt / 2;
      x += vx * dt; y += vy * dt;
      const r1 = Math.hypot(x, y);
      g = MU / (r1 * r1 * r1);
      vx -= g * x * dt / 2; vy -= g * y * dt / 2;
      t += dt;
      const a = Math.atan2(x, y);
      let d = a - prev; if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI;
      ang += d; prev = a;
      if (stop({ x, y, vx, vy, ang, t, alt: r1 - RE })) break;
    }
    return { x, y, vx, vy, ang, t, alt: Math.hypot(x, y) - RE };
  }

  function planShipReturn(s) {
    let m = VEH.s2.dry + PAYLOAD + s.prop2 + (s.head || 0), prop = s.prop2;   // dot bang binh chinh
    const spend = dv => { const dm = m * (1 - Math.exp(-dv / (VEH.s2.vac.isp * G0)));
                          m -= dm; prop = Math.max(0, prop - dm); };
    const applyDv = (st, dv, retro) => {
      const v = Math.hypot(st.vx, st.vy), k = (retro ? -1 : 1) * dv / v;
      return { x: st.x, y: st.y, vx: st.vx * (1 + k), vy: st.vy * (1 + k) };
    };
    // 1) Sau SECO tau DANG ROI (can diem duoi mat dat) — dung quy dao xuyen
    //    khi quyen ma SpaceX chon. Muon bay tron mot vong ve thap thi phai tron
    //    quy dao NGAY TAI DAY: triet tieu van toc theo phuong dung va chinh
    //    thanh phan ngang ve toc do tron.
    const r0 = Math.hypot(s.x, s.y), ux0 = s.x / r0, uy0 = s.y / r0;
    const vCirc = Math.sqrt(MU / r0);
    const tvx = uy0 * vCirc, tvy = -ux0 * vCirc;          // thuan tiep tuyen
    const dvCirc = Math.hypot(tvx - s.vx, tvy - s.vy);
    spend(dvCirc);
    let st = { x: s.x, y: s.y, vx: tvx, vy: tvy };

    // 2) Do lon deorbit do HANH LANG TAI NHAP quyet dinh (can diem 60 km).
    const rp = RE + 60000, aNew = (r0 + rp) / 2;
    const dvDe = vCirc - Math.sqrt(MU * (2 / r0 - 1 / aNew));

    // 3) Chi con dieu chinh THOI DIEM dot. Diem cham quan vong o +/-20.000 km
    //    nen do CUC TIEU |lech| thay vi do doi dau.
    const trial = (angBurn, coarse) => {
      const b0 = _coast(st, p => p.ang >= angBurn, 2);
      const b = applyDv(b0, dvDe, true);
      const e = _coast(b, p => p.alt <= 120000 && (p.x * p.vx + p.y * p.vy) < 0, 4);
      if (e.alt > 130000) return null;                    // khong tai nhap
      const mE = m * Math.exp(-dvDe / (VEH.s2.vac.isp * G0));
      return { land: shipImpact({ x: e.x, y: e.y, vx: e.vx, vy: e.vy, m: mE }, ENTRY_AOA, coarse), entry: e };
    };
    // Giai doan 1: quet tho ca vong bang bo du bao NHANH de khoanh vung.
    let bestA = null, bestAbs = Infinity;
    for (let k = 1; k <= 72; k++) {
      const a = k / 72 * 2 * Math.PI, r = trial(a, true);
      if (r && Math.abs(r.land - S_TARGET_DR) < bestAbs) { bestAbs = Math.abs(r.land - S_TARGET_DR); bestA = a; }
    }
    if (bestA === null) bestA = Math.PI;
    // Giai doan 2: tinh chinh cuc bo bang bo du bao MIN. Phai dat lai moc so
    // sanh — do tho va do min lech nhau hang tram km, tron lan thi chon sai.
    let bestR = trial(bestA, false);
    bestAbs = bestR ? Math.abs(bestR.land - S_TARGET_DR) : Infinity;
    let w = 2 * Math.PI / 72;
    for (let pass = 0; pass < 5; pass++, w /= 3) {
      let improved = false;
      for (const j of [-2, -1, 1, 2]) {
        const a = bestA + j * w / 2;
        if (a <= 0 || a >= 2 * Math.PI) continue;
        const r = trial(a, false);
        if (r && Math.abs(r.land - S_TARGET_DR) < bestAbs) { bestAbs = Math.abs(r.land - S_TARGET_DR); bestA = a; bestR = r; improved = true; }
      }
      if (!improved && pass === 0) w *= 3;      // chua trung thi mo rong mot lan
    }
    const fin = bestR;


    spend(dvDe);
    const e = fin.entry;
    const r = Math.hypot(e.x, e.y), ux = e.x / r, uy = e.y / r;
    const retro = Math.atan2(-(e.vx * uy - e.vy * ux), -(e.vx * ux + e.vy * uy));
    return {
      /* Tu day tro di CHI HEADER dot duoc: phan binh chinh con lai van nam tren tau nhung
         khong hut duoc trong luc lat, nen no chi la khoi luong chet. */
      t: 0, x: e.x, y: e.y, vx: e.vx, vy: e.vy, m, prop: s.head || prop,
      // Vao diem tai nhap tau con dang chi MUI VE TRUOC (the bay quan tinh);
      // phai dung RCS xoay sang the bung-truoc. Truoc day tao dat san dung tu the
      // nen RCS chang phai lam gi — sai va cung khong thay gi tren man hinh.
      th: angleWrap(retro + ENTRY_AOA - 0.62), om: 0, flap: 0, tuck: 0, ext: 0.5, rcs: SH_RCS_TANK,
      eff: '—', rcsCmd: 0, throttle: 0, nEng: 0, cmdPitch: 0,
      phase: 'ENTRY', alive: true, outcome: null, pi: 0, hBurn: 0, flipT: 0,
      /* mainLeft = binh chinh CON LAI sau tron quy dao + ha quy dao. Duong khong hang goi
         thang startShipReturn() nen st.prop2 chua he bi tru — phai lay so nay, khong duoc doc st. */
      plan: { circDv: dvCirc, deorbitDv: dvDe, propUsed: (s.prop2 - prop) / 1000,
              mainLeft: prop, predict: fin.land, burnAng: bestA },
    };
  }

  function shipReturnTelemetry(sh) {
    const f = sFrame(sh), A = atmosphere(f.alt);
    const q = 0.5 * A.rho * f.speed * f.speed;
    return { t: sh.t, alt: f.alt, speed: f.speed, vspeed: f.vu, lateral: f.dr, hspeed: f.ve,
      q, mach: A.a > 0 ? f.speed / A.a : 0, prop: sh.prop, propFrac: sh.prop / (VEH.s2.prop * 0.09),
      throttle: sh.throttle, engines: sh.nEng, phase: sh.phase, pitch: sh.th,
      aoa: sh.aoa || 0, flap: sh.flap || 0, tuck: sh.tuck || 0,
      ext: sh.ext === undefined ? 0.5 : sh.ext, eff: sh.eff || '—',
      rcs: sh.rcs, rcsFrac: sh.rcs / SH_RCS_TANK, rcsCmd: sh.rcsCmd || 0,
      impact: sh.pi || 0, hBurn: sh.hBurn || 0, toBurn: (f.alt - CATCH_ALT) - (sh.hBurn || 0) - 420 };
  }

  return { G0, RE, MU, VEH, AREA, atmosphere, cdOfMach, makeState, step,
           WEATHER, WX_KEYS, setWeather, getWeather, randomWeather, windAt, airPitch,
           setBoosterTarget, getBoosterTarget, setShipTargetDr, getShipTargetDr,
           telemetry, selectSetting, clusterThrust, s2Thrust, thrustDir,
           progradePitch, angleWrap, Q_ALPHA_LIMIT, HOT_STAGE_FRAC,
           setPayload, getPayload, SAT, makeSat, orbitStep, orbitOf, circularize, deorbitBurn,
           TARGET_V, TARGET_ALT, PITCH_KICK_V,
           shipReturnStep, shipAuto, shipReturnTelemetry, sFrame, shipImpact, planShipReturn,
           shipAeroCoef, SHIP_LEN, SH_RCS_TANK, FLOP_AOA, ENTRY_AOA, A_SIDE, SHIP_LAND,
           makeBooster, boosterStep, boosterAuto, boosterTelemetry, bFrame,
           ballisticImpact, CATCH_ALT, CATCH, PERFECT, BCD,
           RCS_TANK, GIMBAL_MAX, B_LEN, B_COM,
           DEL, makeDeluge, delugeStep, nozzleExit, jetRise, dropK };
});
