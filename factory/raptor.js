/* Raptor — mo hinh dong co full-flow staged combustion (FFSC), day chuyen san
   xuat va be thu static fire.  Khong phu thuoc DOM, dung chung cho factory.html
   va bo test node (factory/test_raptor.js).

   Diem neo hieu chuan: BLOCK "R2" + bien the "sl" phai cho ra dung so lieu ma
   sim/python/ascent.py va game/flight.js dang dung:
       F_vac = 2.30 MN   Isp_vac = 347 s   Ae = 1.33 m2   mdot = 676 kg/s
   test_raptor.js kiem tra lai moc nay moi lan chay.                           */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Raptor = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const G0 = 9.80665, P0 = 101325.0, BAR = 1e5;

  /* ==================================================================
     0. NGAU NHIEN CO HAT GIONG
     Ca nha may chay tren mot dong ngau nhien duy nhat co seed -> chay lai
     mot ca san xuat cho ra dung ket qua cu. Debug duoc, so sanh duoc.
     ================================================================== */
  function makeRng(seed) {
    let a = (seed >>> 0) || 0x9E3779B9;
    const f = function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    f.norm = function (mu, sd) {                       // Box-Muller
      const u = Math.max(1e-9, f()), v = f();
      return (mu || 0) + (sd === undefined ? 1 : sd) * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };
    f.pick = arr => arr[Math.floor(f() * arr.length) % arr.length];
    return f;
  }

  /* ==================================================================
     1. NHIET DONG LUC HOC BUONG DOT + LOA PHUT
     Khi chay: LOX/CH4 giau nhien lieu nhe, gamma ~ 1.15.
     ================================================================== */
  const GAMMA = 1.15;

  /* Ti so ap suat cua ra tren buong, giai nguoc tu ti so dien tich (1-D dang
     nhiet).  Dat cache vi ham nay bi goi moi tick va bisection 60 vong. */
  const _peCache = new Map();
  function peOverPc(eps) {
    const key = Math.round(eps * 1000);
    const hit = _peCache.get(key);
    if (hit !== undefined) return hit;
    const g = GAMMA;
    const areaOf = x => {
      const t1 = Math.pow((g + 1) / 2, 1 / (g - 1));
      const t2 = Math.pow(x, 1 / g);
      const t3 = Math.sqrt((g + 1) / (g - 1) * (1 - Math.pow(x, (g - 1) / g)));
      return 1 / (t1 * t2 * t3);
    };
    let lo = 1e-10, hi = 0.95;
    for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (areaOf(m) > eps) lo = m; else hi = m; }
    const r = (lo + hi) / 2;
    if (_peCache.size < 4096) _peCache.set(key, r);
    return r;
  }

  /* He so luc day Cf.  Kem theo kiem tra TACH DONG: khi ap suat ra tut xuong
     duoi ~35% ap suat moi truong, dong khi bat khoi thanh loa phut. Day la ly
     do dong co chan khong (eps lon) KHONG danh lua duoc o mat dat — thu la vo
     loa phut that. Be thu mo phong dung hien tuong do. */
  function nozzle(eps, pc, pa) {
    const g = GAMMA, x = peOverPc(eps), pe = x * pc;
    const cfIdeal = Math.sqrt(2 * g * g / (g - 1) * Math.pow(2 / (g + 1), (g + 1) / (g - 1))
                              * (1 - Math.pow(x, (g - 1) / g)));
    const sepP = 0.35 * pa;                  // tieu chuan Summerfield
    if (pa > 0 && pe < sepP) {
      /* Dong tach: coi nhu loa phut chi con hoat dong toi tiet dien co ap suat
         = sepP, phan con lai la vung xoay -> mat luc day + tai ben. */
      let e2 = eps;
      for (let i = 0; i < 24; i++) {         // tim eps hieu dung sao cho pe = sepP
        const xe = peOverPc(e2);
        if (xe * pc > sepP) break;
        e2 *= 0.93;
        if (e2 < 3) { e2 = 3; break; }
      }
      const x2 = peOverPc(e2);
      const cf2 = Math.sqrt(2 * g * g / (g - 1) * Math.pow(2 / (g + 1), (g + 1) / (g - 1))
                            * (1 - Math.pow(x2, (g - 1) / g)));
      return { cf: cf2 + (x2 - pa / pc) * e2, pe, separated: true, sepFrac: 1 - e2 / eps };
    }
    return { cf: cfIdeal + (x - pa / pc) * eps, pe, separated: false, sepFrac: 0 };
  }

  /* c* ly tuong.  Dinh quanh MR 3.55; giam hai ben. Pc cao -> phan ly it hon ->
     c* nhinh len. Hang so CSTAR_PEAK hieu chuan de R2/sl cho dung Isp 347 s. */
  const CSTAR_PEAK = 1873.9;
  function cstarIdeal(mr, pcBar) {
    const d = mr - 3.55;
    return CSTAR_PEAK * (1 - 0.045 * d * d) * (1 + 0.02 * Math.log(Math.max(50, pcBar) / 300));
  }
  /* Nhiet do ngon lua. Dinh gan ti le hop thuc (O/F = 4.0 cho CH4). Giau nhien
     lieu -> mat hon -> lam mat de hon; giau oxy -> nong + an mon thanh buong. */
  function chamberTemp(mr) {
    const d = mr - 3.90;
    return 3820 - 950 * d * d;
  }

  const RHO_OX = 1180, RHO_F = 440;          // kg/m3, day sieu lanh (densified)
  const CP_FPB = 3600, CP_OPB = 1150;        // J/kg.K khi tien dot giau nhien lieu / giau oxy
  const K_TURB = 1.28;
  const CP_CH4 = 3500;                       // J/kg.K, CH4 long trong ao lam mat

  /* ==================================================================
     2. THIET KE DONG CO
     "Block" = the he (Raptor 1/2/3). "Variant" = ban mat dat (sl) hay chan
     khong (vac).  Nguoi choi chinh 6 nut trong DESIGN_KNOBS -> doi het chuoi
     hieu nang / nhiet / bom, day la phan "cai tien".
     ================================================================== */
  const LIMITS = {
    twall: 810,        // K — gioi han thanh buong hop kim dong
    titF: 810,         // K — nhiet vao tuabin nhien lieu
    titO: 780,         // K — nhiet vao tuabin oxy (giau oxy nen thap hon)
    rpmF: 34000,       // v/ph
    rpmO: 25000,
    vib: 12.0,         // g RMS
    pcHigh: 1.12,      // lan Pc danh dinh
    pcLow: 0.90,
    mrDev: 0.25,       // lech MR cho phep
    stiff: 0.080,      // do cung voi phun toi thieu truoc khi chug
  };

  const BLOCKS = {
    R1: {
      key: 'R1', name: 'Raptor 1', year: 2019,
      pc: 250, mr: 3.55, stiff: 0.22, pr: 2.10,
      etaC: 0.950, etaPump: 0.72, etaTurb: 0.76, lambda: 0.975,
      coolK: 1.06, massBase: 2080, cost: 2.0,
      taktMul: 1.00, defectMul: 1.00,
      note: 'Nhieu ong dan ngoai, lop chan nhiet, tho lap rap. Nang va dat.',
    },
    R2: {
      key: 'R2', name: 'Raptor 2', year: 2022,
      pc: 300, mr: 3.60, stiff: 0.20, pr: 2.00,
      etaC: 0.965, etaPump: 0.75, etaTurb: 0.79, lambda: 0.980,
      coolK: 1.00, massBase: 1600, cost: 1.0,
      taktMul: 0.62, defectMul: 0.55,
      note: 'Gian luoc ong dan, bo lop chan nhiet, voi phun lam lien khoi.',
    },
    R3: {
      key: 'R3', name: 'Raptor 3', year: 2024,
      pc: 350, mr: 3.60, stiff: 0.20, pr: 1.95,
      etaC: 0.972, etaPump: 0.78, etaTurb: 0.82, lambda: 0.982,
      coolK: 0.88, massBase: 1525, cost: 0.9,
      taktMul: 0.45, defectMul: 0.40,
      note: 'Ong dan chim trong vo, lam mat thu cap thay lop chan, sach tron.',
    },
  };

  /* Duong kinh hong hieu chuan: R2/sl phai ra dung 2.30 MN & 347 s. */
  const DT_REF = 0.22772;                    // m
  const VARIANTS = {
    sl:  { key: 'sl',  name: 'Mặt đất',   eps: 32.65, gimbal: 15, massMul: 1.00 },
    vac: { key: 'vac', name: 'Chân không', eps: 110,  gimbal: 0,  massMul: 1.42 },
  };

  const DESIGN_KNOBS = [
    { key: 'pc',    label: 'Áp suất buồng',   unit: 'bar', min: 200, max: 400,  step: 5,
      hint: 'Cao hơn: lực đẩy trên một kg lớn hơn — nhưng bơm phải ép mạnh hơn, tuabin nóng hơn, thành buồng nhận nhiệt lớn hơn.' },
    { key: 'mr',    label: 'Tỉ lệ trộn O/F',  unit: '',    min: 2.9, max: 4.1,  step: 0.02,
      hint: 'Đỉnh c* quanh 3.55. Giàu nhiên liệu: mát, dễ làm nguội. Giàu oxy: nóng và ăn mòn thành buồng.' },
    { key: 'eps',   label: 'Tỉ số giãn nở',   unit: '',    min: 12,  max: 200,  step: 0.5,
      hint: 'Lớn hơn: Isp chân không cao hơn, loa phụt nặng hơn. Quá lớn thì dòng tách ở mặt đất — không đánh lửa được.' },
    { key: 'dt',    label: 'Đường kính họng', unit: 'm',   min: 0.16, max: 0.30, step: 0.001,
      hint: 'Quyết định lưu lượng: to hơn thì lực đẩy lớn hơn ở cùng Pc, nhưng bơm và tuabin phải gánh nhiều hơn.' },
    { key: 'stiff', label: 'Độ cứng vòi phun', unit: 'ΔP/Pc', min: 0.10, max: 0.32, step: 0.005,
      hint: 'Chống mất ổn định cháy. Cao thì bơm tốn công; thấp thì ga sâu sẽ chug (cháy giật).' },
    { key: 'pr',    label: 'Tỉ số áp tuabin', unit: '',    min: 1.6, max: 2.6,  step: 0.02,
      hint: 'Cao thì tuabin lấy được công ở nhiệt độ thấp hơn, nhưng bơm phải nâng áp cao hơn.' },
  ];

  function makeDesign(blockKey, variantKey, over) {
    const b = BLOCKS[blockKey] || BLOCKS.R2, v = VARIANTS[variantKey] || VARIANTS.sl;
    const d = {
      block: b.key, variant: v.key,
      pc: b.pc, mr: b.mr, stiff: b.stiff, pr: b.pr,
      dt: DT_REF, eps: v.eps,
      etaC: b.etaC, etaPump: b.etaPump, etaTurb: b.etaTurb, lambda: b.lambda,
      coolK: b.coolK, massBase: b.massBase * v.massMul, gimbal: v.gimbal,
      upg: {},
    };
    if (over) for (const k in over) d[k] = over[k];
    return d;
  }
  const geom = d => {
    const at = Math.PI * d.dt * d.dt / 4;
    return { at, ae: at * d.eps, de: Math.sqrt(at * d.eps * 4 / Math.PI) };
  };
  /* Khoi luong: than + loa phut theo dien tich ra. Loa cang lon cang nang, day
     la cai gia that su cua viec tang eps. */
  function engineMass(d) {
    const g = geom(d);
    return d.massBase * 0.83 * (0.72 + 0.28 * Math.pow(d.pc / 300, 0.6)) + 210 * g.ae;
  }

  /* ==================================================================
     3. DIEM LAM VIEC — trai tim cua mo hinh
     Chuoi tinh: ga -> Pc -> c* -> lưu lượng -> Cf -> luc day
                 -> bom (cong suat) -> tuabin (nhiet do vao)
                 -> ao lam mat (nhiet do thanh) -> on dinh chay
     Moi khau tra ve ca GIA TRI va GIOI HAN, be thu chi viec so sanh.
     ================================================================== */
  function operate(d, opt) {
    opt = opt || {};
    const th = opt.throttle === undefined ? 1 : opt.throttle;
    const pa = opt.pAmb === undefined ? P0 : opt.pAmb;
    const u = opt.unit || null;
    const wear = opt.wear || 0;                          // 0..1
    const g = geom(d);

    /* --- lech che tao cua tung ca the --- */
    const dAt   = u ? u.dev.at   : 0;    // sai so tiet dien hong
    const dEtaC = u ? u.dev.etaC : 0;    // sai so voi phun
    const dPump = u ? u.dev.pump : 0;
    const dCool = u ? u.dev.cool : 0;
    const at = g.at * (1 + dAt);
    const eps = g.ae / at;

    /* --- ap suat buong theo ga --- */
    const pcBar = d.pc * th;
    const pc = pcBar * BAR;
    if (th <= 0 || pc <= 0) {
      return { th: 0, pc: 0, pcBar: 0, F: 0, isp: 0, mdot: 0, mdotO: 0, mdotF: 0, mr: d.mr, at, eps, zero: true,
               stiff: 0, twall: 300, titF: 0, titO: 0, rpmF: 0, rpmO: 0, pumpF: 0, pumpO: 0,
               pdF: 0, pdO: 0, vib: 0, sep: false, chug: 0, tc: 0, qwall: 0, cf: 0, cstar: 0 };
    }

    /* --- do cung voi phun: dP ~ mdot^2 nen dP/Pc ~ ga --- */
    const stiff = d.stiff * th * (1 - 0.35 * wear);
    /* Voi phun mem -> tron kem -> mat c*; qua mem -> chay giat (chug). */
    const chug = Math.max(0, (LIMITS.stiff - stiff) / LIMITS.stiff);   // 0 = an toan
    const etaMix = 1 - 0.06 * chug * chug;

    /* --- c* va luu luong --- */
    const mrAct = d.mr * (1 + (opt.mrShift || 0));
    const csI = cstarIdeal(mrAct, pcBar);
    const etaC = Math.min(0.995, d.etaC * (1 + dEtaC) * etaMix * (1 - 0.05 * wear));
    const cstar = csI * etaC;
    const mdot = pc * at / cstar;
    const mdotO = mdot * mrAct / (1 + mrAct), mdotF = mdot / (1 + mrAct);

    /* --- loa phut --- */
    const nz = nozzle(eps, pc, pa);
    const F = Math.max(0, d.lambda * nz.cf * pc * at);
    const isp = mdot > 0 ? F / (mdot * G0) : 0;

    /* --- bom: phai ep qua voi phun, tien dot va tuabin --- */
    const dpJacket = 55 * BAR * Math.pow(pcBar / 300, 1.8) * d.coolK;   // ton ap ao lam mat
    const pdF = pc * (1 + stiff) * 1.10 * d.pr + dpJacket;              // xa bom nhien lieu
    const pdO = pc * (1 + stiff) * 1.10 * d.pr;                         // xa bom oxy
    const etaP = d.etaPump * (1 + dPump);
    const pumpF = mdotF * pdF / (RHO_F * etaP);                         // W
    const pumpO = mdotO * pdO / (RHO_OX * etaP);

    /* --- tuabin: giai nguoc nhiet do vao tu cong suat can --- */
    const expo = 1 - Math.pow(d.pr, -(K_TURB - 1) / K_TURB);
    const mdotFpb = mdotF * 1.30;                 // toan bo nhien lieu + it oxy
    const mdotOpb = mdotO * 1.02;                 // toan bo oxy + it nhien lieu
    const titF = pumpF / Math.max(1, mdotFpb * CP_FPB * expo * d.etaTurb);
    const titO = pumpO / Math.max(1, mdotOpb * CP_OPB * expo * d.etaTurb);

    /* --- vong quay bom: n ~ can bac hai cot ap --- */
    const rpmF = 30000 * Math.sqrt(pdF / (847 * BAR)) * Math.pow(mdotF / 146.9, 0.15);
    const rpmO = 22000 * Math.sqrt(pdO / (792 * BAR)) * Math.pow(mdotO / 529.0, 0.15);

    /* --- lam mat: Bartz rut gon. q ~ Pc^0.8 / dt^0.2, khoi lam mat ~ mdotF^0.8 --- */
    const tc = chamberTemp(mrAct);
    const qwall = 62e6 * Math.pow(pcBar / 300, 0.85) * (tc / 3734)
                  * Math.pow(0.22772 / d.dt, 0.2) * (1 + 0.5 * wear);
    /* Kha nang tai nhiet cua ao lam mat: ti le mdot^0.8, nhung Pc cao thi CH4
       trong ranh tien gan tran nhiet (sieu toi han, bat dau phan huy) nen hieu
       qua tut di — day moi la ly do that su khien Pc cao kho lam mat. */
    const coolCap = Math.pow(mdotF / 146.9, 0.8)
                  / (d.coolK * (1 + dCool) * (1 + 0.35 * Math.max(0, pcBar / 300 - 1)));
    const twall = 300 + 392 * (qwall / 62e6) / Math.max(0.25, coolCap);
    const coolRise = qwall * 0.42 / Math.max(1, mdotF * CP_CH4) * 100;   // do tang nhiet chat lam mat

    /* --- rung: nen o diem thiet ke, tang manh khi chug hoac tach dong --- */
    const vib = 1.6 + 4.5 * chug + 6 * nz.sepFrac * Math.max(0, th - 0.5) * 2 + 2.4 * wear
                + 0.9 * Math.max(0, pcBar / 300 - 1);

    return {
      th, pc, pcBar, F, isp, mdot, mdotO, mdotF, mr: mrAct, at, eps, cstar, cf: nz.cf,
      pe: nz.pe, sep: nz.separated, sepFrac: nz.sepFrac,
      stiff, chug, tc, qwall, twall, coolRise,
      pdF, pdO, pumpF, pumpO, titF, titO, rpmF, rpmO, vib,
      mass: engineMass(d),
    };
  }

  /* Bang so lieu ky thuat cho mot thiet ke (dung cho bang thong so & xuat sang
     game).  Khong co ca the -> dong co "danh dinh" hoan hao. */
  function datasheet(d) {
    const vac = operate(d, { throttle: 1, pAmb: 0 });
    const sl = operate(d, { throttle: 1, pAmb: P0 });
    const g = geom(d);
    return {
      block: d.block, variant: d.variant,
      Fvac: vac.F, Fsl: sl.F, ispVac: vac.isp, ispSl: sl.isp,
      Ae: g.ae, At: g.at, de: g.de, eps: d.eps,
      mdot: vac.mdot, pcBar: d.pc, mr: d.mr, mass: vac.mass,
      twall: vac.twall, titF: vac.titF, titO: vac.titO,
      rpmF: vac.rpmF, rpmO: vac.rpmO, pumpMW: (vac.pumpF + vac.pumpO) / 1e6,
      slSeparated: sl.sep, tmin: minThrottle(d),
    };
  }
  /* Ga toi thieu: cham nguong chug thi dung. Day chinh la con so 0.40 ma
     flight.js dang dung cho Raptor 2 — no khong phai so bia. */
  function minThrottle(d) {
    const t = LIMITS.stiff / d.stiff;
    return Math.max(0.15, Math.min(1, Math.round(t * 100) / 100));
  }

  /* ==================================================================
     4. DAY CHUYEN SAN XUAT (tang ham)
     5 tram noi tiep. Moi tram co takt (gio/dong co), muc do ky luong, va
     xac suat gieo LOI TIEM AN vao ca the. Loi tiem an khong nhin thay duoc
     tren giay to — chi be thu moi loi ra. Do la ly do phai thu.
     ================================================================== */
  const STATIONS = [
    { key: 'powerhead', name: 'Cụm bơm & tiền đốt', takt: 9.0, cost: 0.42,
      defects: ['turbine_blade', 'weld_porosity'],
      note: 'Hai turbopump, hai buồng tiền đốt, ống dẫn khí nóng.' },
    { key: 'chamber',   name: 'Buồng đốt & vòi phun', takt: 7.5, cost: 0.30,
      defects: ['injector_face', 'coolant_channel'],
      note: 'Lót đồng, phay rãnh làm mát, hàn vòi phun đồng trục.' },
    { key: 'nozzle',    name: 'Loa phụt tái sinh', takt: 5.0, cost: 0.14,
      defects: ['weld_porosity'],
      note: 'Cuốn ống, hàn, kiểm tra rò bằng heli.' },
    { key: 'valves',    name: 'Van & điều khiển', takt: 4.0, cost: 0.10,
      defects: ['valve_seat', 'igniter_weak', 'sensor_drift'],
      note: 'Van chính LOX/CH4, van tiết lưu, đánh lửa đuốc, cảm biến.' },
    { key: 'assembly',  name: 'Lắp ráp & cân chỉnh', takt: 6.0, cost: 0.12,
      defects: ['weld_porosity', 'sensor_drift'],
      note: 'Ghép cụm, đo lệch, cân bằng, nghiệm thu khô.' },
  ];

  const DEFECTS = {
    turbine_blade:  { name: 'Rạn chân cánh tuabin', reveal: 'rpm',
      desc: 'Rung tăng dần theo vòng quay; vượt ngưỡng thì cánh văng.' },
    weld_porosity:  { name: 'Rỗ khí mối hàn',       reveal: 'press',
      desc: 'Rò dưới áp suất: mất chất làm mát, thành buồng nóng lên.' },
    injector_face:  { name: 'Lệch lỗ vòi phun',     reveal: 'burn',
      desc: 'Vệt cháy cục bộ: mất c*, điểm nóng trên mặt vòi phun.' },
    coolant_channel:{ name: 'Rãnh làm mát hẹp',     reveal: 'burn',
      desc: 'Lưu lượng làm mát thiếu — biên nhiệt độ thành mỏng đi.' },
    valve_seat:     { name: 'Hở đế van oxy',        reveal: 'start',
      desc: 'Oxy vào sớm — nguy cơ khởi động cứng khi đánh lửa.' },
    igniter_weak:   { name: 'Đuốc đánh lửa yếu',    reveal: 'start',
      desc: 'Có thể không mồi được, hoặc mồi trễ gây khởi động cứng.' },
    sensor_drift:   { name: 'Cảm biến trôi chuẩn',  reveal: 'any',
      desc: 'Số đo lệch thật — có thể cắt nhầm một động cơ tốt.' },
  };

  function makeLine(seed) {
    return {
      rng: makeRng(seed === undefined ? 20260909 : seed),
      built: 0, scrapped: 0, hours: 0, day: 1,
      care: 1.0,                 // 0.7 nhanh & au, 1.0 chuan, 1.4 ky luong
      feed: true,
      wip: STATIONS.map(() => null),
      queueOut: [],
      sn: 1,
      spent: 0,
      learn: 0.90,               // duong cong hoc tap Wright
    };
  }
  /* Takt thuc te: giam theo duong cong hoc tap, tang neu lam ky. */
  function stationTakt(line, st, block) {
    const n = Math.max(1, line.built + 1);
    const lc = Math.pow(n, Math.log2(line.learn));
    return st.takt * BLOCKS[block].taktMul * lc * (0.55 + 0.45 * line.care);
  }
  function lineRate(line, block) {
    let t = 0;
    for (const st of STATIONS) t = Math.max(t, stationTakt(line, st, block));
    return 24 / t;                                    // dong co / ngay (tram cham nhat)
  }

  function buildUnit(d, line) {
    const r = line.rng;
    const care = line.care, dm = BLOCKS[d.block].defectMul;
    const tol = 1 / (0.6 + 0.8 * care);               // lam ky -> dung sai chat hon
    const u = {
      sn: 'SN' + String(line.sn++).padStart(4, '0'),
      block: d.block, variant: d.variant, born: line.day,
      design: JSON.parse(JSON.stringify(d)),
      dev: {
        at:   r.norm(0, 0.0030) * tol,
        etaC: r.norm(0, 0.0055) * tol,
        pump: r.norm(0, 0.010) * tol,
        cool: r.norm(0, 0.030) * tol,
      },
      defects: [], wear: 0, tests: 0, testSec: 0, flights: 0,
      status: 'raw',                                  // raw -> tested -> certified / scrap
      log: [],
    };
    for (const st of STATIONS) {
      for (const key of st.defects) {
        const base = 0.055 * dm / (0.5 + care);
        if (r() < base) u.defects.push(key);
      }
    }
    return u;
  }

  /* Mot buoc thoi gian cua day chuyen (gio). Bang chuyen day: tram i chi nhan
     phoi khi tram i+1 da tra hang. */
  function stepLine(line, hours, d) {
    const out = [];
    line.hours += hours;
    let guard = 0;
    while (hours > 0 && guard++ < 500) {
      // nap phoi moi vao dau day chuyen
      if (!line.wip[0] && line.feed) {
        const u = buildUnit(d, line);
        line.wip[0] = { unit: u, left: stationTakt(line, STATIONS[0], d.block) };
        line.spent += STATIONS.reduce((a, s) => a + s.cost, 0) * BLOCKS[d.block].cost * (0.7 + 0.3 * line.care);
      }
      // tim tram som ket thuc nhat
      let tNext = hours, idx = -1;
      for (let i = 0; i < STATIONS.length; i++) {
        const w = line.wip[i];
        if (w && w.left < tNext) { tNext = w.left; idx = i; }
      }
      for (let i = 0; i < STATIONS.length; i++) if (line.wip[i]) line.wip[i].left -= tNext;
      hours -= tNext;
      if (idx >= 0) {
        const w = line.wip[idx];
        if (idx === STATIONS.length - 1) { line.wip[idx] = null; line.built++; out.push(w.unit); }
        else if (!line.wip[idx + 1]) { line.wip[idx + 1] = { unit: w.unit, left: stationTakt(line, STATIONS[idx + 1], d.block) }; line.wip[idx] = null; }
        else { w.left = 0.001; }                       // ket: cho tram sau
      }
      if (tNext <= 0 && idx < 0) break;
    }
    return out;
  }

  /* ==================================================================
     5. BE THU STATIC FIRE
     Chuoi thao tac dung nhu ngoai doi: xa khi tro -> lam lanh -> tang ap ->
     xa nuoc dap am -> quay mo -> danh lua duoc -> len ga -> chay bai thu ->
     tat may -> xa khi & noi soi.
     Moi tick deu do va so voi REDLINE. Cham redline thi cat — cat kip thi
     dong co con sua duoc, cham thi hong, rat cham thi no be.
     ================================================================== */
  const PROFILES = {
    accept: {
      key: 'accept', name: 'Nghiệm thu', desc: 'Bài chuẩn trước khi xuất xưởng: lên 100%, hạ ga, quay gimbal.',
      steps: [
        { p: 'HOLD',   dur: 12, th: 1.00 },
        { p: 'BUCKET', dur: 6,  th: 0.50 },
        { p: 'HOLD',   dur: 4,  th: 1.00 },
        { p: 'GIMBAL', dur: 8,  th: 0.90, gimbal: 1 },
      ],
    },
    duty: {
      key: 'duty', name: 'Toàn thời gian', desc: 'Đúng chu trình một chuyến booster: 160 s liên tục.',
      steps: [
        { p: 'HOLD',   dur: 55, th: 1.00 },
        { p: 'MAXQ',   dur: 25, th: 0.65 },
        { p: 'HOLD',   dur: 60, th: 1.00 },
        { p: 'BUCKET', dur: 20, th: 0.45 },
      ],
    },
    deep: {
      key: 'deep', name: 'Ga sâu', desc: 'Dò đáy ga — tìm chỗ bắt đầu cháy giật (chug).',
      steps: [
        { p: 'HOLD',   dur: 6,  th: 1.00 },
        { p: 'SWEEP',  dur: 30, th: 1.00, to: 0.20 },
      ],
    },
    stress: {
      key: 'stress', name: 'Quá tải', desc: 'Đẩy lên 112% để xem biên còn bao nhiêu. Rủi ro cao.',
      steps: [
        { p: 'HOLD',   dur: 8,  th: 1.00 },
        { p: 'SWEEP',  dur: 14, th: 1.00, to: 1.12 },
        { p: 'HOLD',   dur: 10, th: 1.12 },
      ],
    },
    reflight: {
      key: 'reflight', name: 'Tái kiểm', desc: 'Kiểm lại động cơ đã bay: ngắn, chỉ soi biên độ hao mòn.',
      steps: [
        { p: 'HOLD',   dur: 10, th: 1.00 },
        { p: 'BUCKET', dur: 5,  th: 0.50 },
      ],
    },
  };

  const PRE = [
    { p: 'PURGE', dur: 8,  label: 'Xả khí trơ' },
    { p: 'CHILL', dur: 45, label: 'Làm lạnh đường ống & bơm' },
    { p: 'PRESS', dur: 10, label: 'Tăng áp thùng' },
    { p: 'DELUGE',dur: 4,  label: 'Mở nước dập âm' },
    { p: 'SPIN',  dur: 2,  label: 'Quay mồi tuabin' },
    { p: 'IGNITE',dur: 1.4,label: 'Đánh lửa đuốc & tiền đốt' },
    { p: 'RAMP',  dur: 2.4,label: 'Lên ga' },
  ];
  const POST = [
    { p: 'CUTOFF', dur: 1.6, label: 'Cắt máy' },
    { p: 'SAFE',   dur: 6,   label: 'Xả khí & nội soi' },
  ];

  const PHASE_LABEL = {
    PURGE: 'Xả khí trơ', CHILL: 'Làm lạnh', PRESS: 'Tăng áp', DELUGE: 'Nước dập âm',
    SPIN: 'Quay mồi', IGNITE: 'Đánh lửa', RAMP: 'Lên ga', HOLD: 'Giữ ga',
    BUCKET: 'Hạ ga', MAXQ: 'Ga max-Q', GIMBAL: 'Quay gimbal', SWEEP: 'Quét ga',
    CUTOFF: 'Cắt máy', SAFE: 'Xả an toàn', DONE: 'Xong', ABORT: 'Đã cắt',
  };

  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h | 0;
  }

  function startTest(unit, profileKey, opt) {
    opt = opt || {};
    const prof = PROFILES[profileKey] || PROFILES.accept;
    const d = unit.design;
    const seq = [];
    for (const s of PRE) seq.push({ p: s.p, dur: s.dur, label: s.label, pre: true });
    for (const s of prof.steps) seq.push(Object.assign({}, s, { label: PHASE_LABEL[s.p] || s.p }));
    for (const s of POST) seq.push({ p: s.p, dur: s.dur, label: s.label, post: true });
    return {
      unit, design: d, profile: prof, seq, i: 0, tSeg: 0, t: 0, tFire: 0,
      pAmb: opt.pAmb === undefined ? P0 : opt.pAmb,
      rng: makeRng(opt.seed === undefined ? (hashStr(unit.sn) + unit.tests * 104729) | 0 : opt.seed),
      chill: 0, throttle: 0, cmdTh: 0, gimbal: 0, lit: false, sepT: 0,
      leak: 0, hotspot: 0, vibExtra: 0, bias: 0,
      state: 'run', phase: 'PURGE', outcome: null, damage: 0, chugOnset: 0, sepSeen: 0,
      trips: [], events: [], peak: { pc: 0, F: 0, twall: 0, titF: 0, titO: 0, rpmF: 0, rpmO: 0, vib: 0 },
      acc: { n: 0, pc: 0, F: 0, isp: 0, mr: 0 },
      hold: { n: 0, pc: 0, F: 0, isp: 0, mr: 0, twall: 0 },
      trace: { t: [], pc: [], F: [], twall: [], vib: [], th: [] },
      op: null, nextTrace: 0,
    };
  }

  const REDLINES = [
    { key: 'twall', name: 'Nhiệt độ thành buồng', unit: 'K',   get: o => o.twall, lim: () => LIMITS.twall,  sev: 2 },
    { key: 'titF',  name: 'Nhiệt vào tuabin CH4',  unit: 'K',   get: o => o.titF,  lim: () => LIMITS.titF,   sev: 2 },
    { key: 'titO',  name: 'Nhiệt vào tuabin LOX',  unit: 'K',   get: o => o.titO,  lim: () => LIMITS.titO,   sev: 3 },
    { key: 'rpmF',  name: 'Vòng quay bơm CH4',     unit: 'v/p', get: o => o.rpmF,  lim: () => LIMITS.rpmF,   sev: 2 },
    { key: 'rpmO',  name: 'Vòng quay bơm LOX',     unit: 'v/p', get: o => o.rpmO,  lim: () => LIMITS.rpmO,   sev: 3 },
    { key: 'vib',   name: 'Rung RMS',              unit: 'g',   get: o => o.vib,   lim: () => LIMITS.vib,    sev: 1 },
    { key: 'pc',    name: 'Áp suất buồng',         unit: 'bar', get: o => o.pcBar, lim: (o, d) => d.pc * LIMITS.pcHigh, sev: 3 },
  ];

  function logEv(T, kind, text) { T.events.push({ t: +T.t.toFixed(2), kind, text }); }

  function stepTest(T, dt) {
    if (T.state !== 'run') return T;
    const d = T.design, u = T.unit;
    T.t += dt;
    T.tSeg += dt;
    const seg = T.seq[T.i];
    T.phase = seg.p;

    /* ---------- pha truoc khi chay ---------- */
    if (seg.pre) {
      if (seg.p === 'CHILL') T.chill = Math.min(1, T.chill + dt / seg.dur);
      if (seg.p === 'IGNITE' && !T.lit) {
        const igW = u.defects.indexOf('igniter_weak') >= 0;
        const oxLeak = u.defects.indexOf('valve_seat') >= 0;
        const pFail = (igW ? 0.34 : 0.012);
        if (T.tSeg > seg.dur * 0.6) {
          if (T.rng() < pFail) {
            logEv(T, 'bad', 'Không mồi được — đuốc đánh lửa không bắt.');
            return finish(T, 'noignition', 0.05);
          }
          /* Khoi dong cung: oxy vao truoc, tich tu roi no khi mo lua. Ap suat
             buong voi len gap boi Pc danh dinh -> vo mat voi phun. */
          const pHard = (oxLeak ? 0.42 : 0.02) * (1 + 0.6 * (1 - T.chill));
          if (T.rng() < pHard) {
            const spike = 1.5 + T.rng() * 1.4;
            logEv(T, 'bad', 'KHỞI ĐỘNG CỨNG — đỉnh Pc ' + Math.round(d.pc * spike) + ' bar.');
            T.peak.pc = d.pc * spike;
            return finish(T, spike > 2.2 ? 'rud' : 'hardstart', spike > 2.2 ? 1 : 0.55);
          }
          T.lit = true;
          logEv(T, 'ok', 'Bắt lửa — tiền đốt ổn định.');
        }
      }
      if (seg.p === 'RAMP') {
        T.cmdTh = Math.min(1, T.tSeg / seg.dur);
        /* Chua lam lanh du -> bom xam thuc (cavitation) khi len ga. */
        if (T.chill < 0.75 && T.rng() < 0.05 * dt * 20) {
          logEv(T, 'bad', 'Bơm xâm thực — chưa làm lạnh đủ (' + Math.round(T.chill * 100) + '%).');
          return finish(T, 'cavitation', 0.35);
        }
      }
    } else if (seg.post) {
      if (seg.p === 'CUTOFF') T.cmdTh = Math.max(0, 1 - T.tSeg / seg.dur) * (T.cmdThAtCut || 1);
      else T.cmdTh = 0;
    } else {
      /* ---------- pha chay theo bai thu ---------- */
      T.tFire += dt;
      if (seg.p === 'SWEEP') {
        const f = Math.min(1, T.tSeg / seg.dur);
        T.cmdTh = seg.th + (seg.to - seg.th) * f;
      } else T.cmdTh = seg.th;
      if (seg.gimbal) T.gimbal = Math.sin(T.tSeg * 1.7) * d.gimbal;
      else T.gimbal *= 0.85;
      T.cmdThAtCut = T.cmdTh;
    }

    /* Ga di theo lenh co tre bac nhat (van tiet lưu khong nhay tuc thi). */
    const tau = 0.18;
    T.throttle += (T.cmdTh - T.throttle) * Math.min(1, dt / tau);
    if (!T.lit) T.throttle = 0;

    /* ---------- loi tiem an bieu hien dan ---------- */
    if (T.throttle > 0.05) {
      if (u.defects.indexOf('weld_porosity') >= 0) T.leak = Math.min(1, T.leak + dt * 0.028);
      if (u.defects.indexOf('coolant_channel') >= 0) T.leak = Math.min(1, T.leak + dt * 0.016);
      if (u.defects.indexOf('injector_face') >= 0) T.hotspot = Math.min(1, T.hotspot + dt * 0.020);
      if (u.defects.indexOf('turbine_blade') >= 0) T.vibExtra += dt * 0.28 * Math.pow(T.throttle, 2);
    }

    /* ---------- diem lam viec ---------- */
    const wearEff = Math.min(0.95, u.wear + 0.55 * T.leak + 0.25 * T.hotspot);
    const op = operate(d, {
      throttle: T.throttle, pAmb: T.pAmb, unit: u, wear: wearEff,
      mrShift: T.hotspot * 0.06 + (u.defects.indexOf('valve_seat') >= 0 ? 0.02 : 0),
    });
    op.vib += T.vibExtra + (T.throttle > 0.05 ? T.rng.norm(0, 0.25) : 0);
    op.twall += 130 * T.hotspot;
    T.op = op;

    if (T.throttle > 0.05) {
      T.acc.n++; T.acc.pc += op.pcBar; T.acc.F += op.F; T.acc.isp += op.isp; T.acc.mr += op.mr;
      if (T.cmdTh >= 0.995 && Math.abs(T.throttle - 1) < 0.01) {
        const h = T.hold;
        h.n++; h.pc += op.pcBar; h.F += op.F; h.isp += op.isp; h.mr += op.mr; h.twall += op.twall;
      }
      for (const k in T.peak) {
        const v = k === 'pc' ? op.pcBar : k === 'F' ? op.F : op[k];
        if (v > T.peak[k]) T.peak[k] = v;
      }
      if (op.chug > 0 && !T.chugOnset && !seg.pre && !seg.post
          && Math.abs(T.cmdTh - T.throttle) < 0.05) T.chugOnset = T.throttle;
      if (op.sep && op.sepFrac > 0.05) T.sepSeen = Math.max(T.sepSeen || 0, op.sepFrac);
      if (T.t >= T.nextTrace) {
        T.nextTrace = T.t + 0.25;
        T.trace.t.push(+T.t.toFixed(2)); T.trace.pc.push(Math.round(op.pcBar));
        T.trace.F.push(+(op.F / 1e6).toFixed(3)); T.trace.twall.push(Math.round(op.twall));
        T.trace.vib.push(+op.vib.toFixed(2)); T.trace.th.push(+T.throttle.toFixed(3));
      }
    }

    /* ---------- redline ---------- */
    if (T.throttle > 0.05) {
      const drift = u.defects.indexOf('sensor_drift') >= 0;
      for (const rl of REDLINES) {
        const raw = rl.get(op), lim = rl.lim(op, d);
        /* Cam bien troi -> so DOC lech so THAT. Bo dieu khien cat theo so doc. */
        const read = drift ? raw * (1 + (T.bias || (T.bias = T.rng.norm(0, 0.055)))) : raw;
        if (read > lim) {
          const over = raw / lim;
          logEv(T, 'bad', 'REDLINE ' + rl.name + ': ' + fmt(read) + ' ' + rl.unit
                 + ' (giới hạn ' + fmt(lim) + ')' + (drift ? ' — số đọc từ cảm biến trôi' : ''));
          T.trips.push({ key: rl.key, name: rl.name, read, lim, real: raw, drift });
          /* Cat kip hay khong phu thuoc muc vuot va do nghiem trong. */
          const sev = rl.sev * (over - 1);
          if (sev > 0.55) return finish(T, 'rud', 1.0);
          if (sev > 0.16) return finish(T, 'damage', 0.45 + sev);
          return finish(T, 'abort', 0.10);
        }
      }
      const steady = Math.abs(T.cmdTh - T.throttle) < 0.05 && !seg.pre && !seg.post;
      if (steady && op.chug > 0.55 && T.rng() < dt * 0.9) {
        logEv(T, 'bad', 'Cháy giật (chug) biên độ lớn — cắt máy.');
        return finish(T, 'abort', 0.18);
      }
      /* Tach dong luc len ga la binh thuong — loa phut nao o mat dat cung
         di qua no trong vai phan giay. Chi khi tach KEO DAI o ga cao thi tai
         ben moi xe rach loa phut. Do la ly do dong co chan khong khong the
         nghiem thu o mat dat, con dong co mat dat thi qua duoc.            */
      if (op.sep && op.sepFrac > 0.15 && T.throttle > 0.55) T.sepT += dt;
      else T.sepT = Math.max(0, T.sepT - dt * 0.5);
      if (T.sepT > 1.5) {
        logEv(T, 'bad', 'Dòng tách kéo dài trong loa phụt — tải bên xé loa phụt.');
        return finish(T, 'damage', 0.6);
      }
    }

    /* ---------- sang doan ke ---------- */
    if (T.tSeg >= seg.dur) {
      T.tSeg = 0; T.i++;
      if (T.i >= T.seq.length) return finish(T, 'complete', 0);
      const n = T.seq[T.i];
      logEv(T, 'info', n.label + (n.th !== undefined ? ' — ga ' + Math.round((n.to || n.th) * 100) + '%' : ''));
    }
    return T;
  }

  const fmt = v => Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('vi-VN')
                 : Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(2);

  function finish(T, outcome, damage) {
    T.state = 'done'; T.outcome = outcome; T.damage = damage || 0;
    T.throttle = 0; T.phase = outcome === 'complete' ? 'DONE' : 'ABORT';
    const u = T.unit;
    u.tests++; u.testSec += T.tFire;
    u.wear = Math.min(1, u.wear + T.tFire / 2600 + T.damage * 0.5);

    const a = T.acc, n = Math.max(1, a.n), h = T.hold, hn = Math.max(1, h.n);
    T.avg = { pc: a.pc / n, F: a.F / n, isp: a.isp / n, mr: a.mr / n };
    /* So nghiem thu lay tai DIEM 100% ON DINH — dung cach nha may that cham. */
    T.rated = { n: h.n, pc: h.pc / hn, F: h.F / hn, isp: h.isp / hn, mr: h.mr / hn, twall: h.twall / hn };
    T.fireSec = T.tFire;

    /* --- phan xet nghiem thu --- */
    const spec = datasheet(T.design);
    const ok = outcome === 'complete';
    const checks = [];
    if (ok) {
      const refF = T.pAmb > 5e4 ? spec.Fsl : spec.Fvac;
      const dF = T.rated.F / refF - 1, dPc = T.rated.pc / T.design.pc - 1;
      checks.push({ name: 'Lực đẩy ở 100%', val: T.rated.F / 1e6, unit: 'MN',
                    ok: T.rated.n > 20 && Math.abs(dF) < 0.03, det: (dF * 100).toFixed(1) + '% so với danh định' });
      checks.push({ name: 'Áp suất buồng', val: T.rated.pc, unit: 'bar',
                    ok: T.rated.n > 20 && Math.abs(dPc) < 0.025, det: (dPc * 100).toFixed(1) + '% so với danh định' });
      checks.push({ name: 'Rung đỉnh', val: T.peak.vib, unit: 'g',
                    ok: T.peak.vib < LIMITS.vib * 0.72, det: 'ngưỡng ' + (LIMITS.vib * 0.72).toFixed(1) });
      checks.push({ name: 'Biên nhiệt thành', val: LIMITS.twall - T.peak.twall, unit: 'K',
                    ok: T.peak.twall < LIMITS.twall * 0.94, det: 'còn lại tới giới hạn' });
      checks.push({ name: 'Thời gian cháy', val: T.tFire, unit: 's',
                    ok: true, det: 'đủ bài ' + T.profile.name.toLowerCase() });
    }
    T.checks = checks;
    T.pass = ok && checks.every(c => c.ok);

    if (T.pass) {
      u.status = 'certified';
      u.log.push('Đạt ' + T.profile.name.toLowerCase() + ' — ngày ' + (u.born));
      logEv(T, 'ok', 'ĐẠT NGHIỆM THU — động cơ được cấp chứng nhận bay.');
    } else if (outcome === 'complete') {
      u.status = 'rework';
      logEv(T, 'warn', 'Chạy hết bài nhưng có chỉ tiêu ngoài dung sai — trả về sửa.');
    } else if (outcome === 'rud') {
      u.status = 'scrap';
      logEv(T, 'bad', 'ĐỘNG CƠ NỔ TRÊN BỆ — bệ thử hư hại, phải sửa.');
    } else if (outcome === 'damage' || outcome === 'hardstart' || outcome === 'cavitation') {
      u.status = 'rework';
      logEv(T, 'bad', 'Hỏng phần cứng — tháo về xưởng sửa.');
    } else {
      u.status = 'rework';
      logEv(T, 'warn', 'Cắt an toàn — động cơ còn nguyên, tìm nguyên nhân rồi thử lại.');
    }
    /* Phat hien loi: cai nao da lo ra thi tho biet, con lai van nam im. */
    T.found = [];
    for (const k of T.unit.defects) {
      const dd = DEFECTS[k];
      if (!dd) continue;
      const shown = (k === 'weld_porosity' || k === 'coolant_channel') ? T.leak > 0.15
                  : (k === 'injector_face') ? T.hotspot > 0.15
                  : (k === 'turbine_blade') ? T.vibExtra > 0.6
                  : (k === 'valve_seat' || k === 'igniter_weak') ? outcome === 'hardstart' || outcome === 'noignition' || outcome === 'rud'
                  : T.trips.some(t => t.drift);
      if (shown) T.found.push(k);
    }
    u.foundDefects = (u.foundDefects || []).concat(T.found);
    return T;
  }

  /* Sua chua: bo loi da tim ra, ton thoi gian & tien. */
  function rework(u, line) {
    const found = u.foundDefects || [];
    u.defects = u.defects.filter(k => found.indexOf(k) < 0);
    u.foundDefects = [];
    u.status = 'raw';
    u.wear = Math.max(0, u.wear - 0.10);
    if (line) line.spent += 0.25;
    return u;
  }

  /* ==================================================================
     6. NGHIEN CUU & CAI TIEN
     Mo khoa bang GIAY THU NGHIEM tich luy — dung cach thuc te: muon tin dong
     co thi phai dot no that nhieu giay tren be.
     ================================================================== */
  const UPGRADES = [
    { key: 'sx500',   name: 'Hợp kim đồng SX500',      sec: 400,  cost: 6,
      desc: 'Lót buồng chịu nhiệt hơn: giới hạn thành +70 K.',
      apply: () => { LIMITS.twall = 880; } },
    { key: 'blade',   name: 'Cánh tuabin đơn tinh thể', sec: 900,  cost: 9,
      desc: 'Tuabin chịu nóng hơn: +60 K cả hai bên.',
      apply: () => { LIMITS.titF = 870; LIMITS.titO = 810; } },
    { key: 'inj2',    name: 'Vòi phun đồng trục xoáy',  sec: 1500, cost: 8,
      desc: 'Trộn tốt hơn: c* +1.2%, ngưỡng chug hạ xuống 0.06.',
      apply: d => { d.etaC = Math.min(0.99, d.etaC * 1.012); LIMITS.stiff = 0.060; } },
    { key: 'pump2',   name: 'Cánh bơm in 3D thế hệ 2',  sec: 2400, cost: 11,
      desc: 'Hiệu suất bơm +4% — tuabin mát hơn ở cùng Pc.',
      apply: d => { d.etaPump = Math.min(0.88, d.etaPump * 1.04); } },
    { key: 'cool2',   name: 'Làm mát thứ cấp mặt trong', sec: 3600, cost: 14,
      desc: 'Tải nhiệt lên thành giảm 12%.',
      apply: d => { d.coolK *= 0.88; } },
    { key: 'nozz2',   name: 'Loa phụt màng khí',        sec: 5200, cost: 16,
      desc: 'Bớt tổn thất phân kỳ: λ +0.8%, nhẹ hơn 8%.',
      apply: d => { d.lambda = Math.min(0.995, d.lambda * 1.008); d.massBase *= 0.92; } },
  ];
  function applyUpgrades(d, owned) {
    for (const up of UPGRADES) if (owned && owned[up.key]) up.apply(d);
    return d;
  }
  /* Gioi han goc — de reset khi doi thiet ke. */
  const LIMITS0 = JSON.parse(JSON.stringify(LIMITS));
  function resetLimits() { for (const k in LIMITS0) LIMITS[k] = LIMITS0[k]; }

  /* ==================================================================
     7. XUAT SANG GAME
     flight.js doc VEH.s1.eng = {n, Fvac, isp, Ae, tmin}. Doi so o day la doi
     ten lua that su bay khac di.
     ================================================================== */
  function fleetSpec(designSL, designVac, units) {
    const a = datasheet(designSL), b = datasheet(designVac);
    const certified = (units || []).filter(u => u.status === 'certified');
    /* Do tin cay doi dong: ti le dat cua lo + hao mon trung binh. */
    const wear = certified.length ? certified.reduce((s, u) => s + u.wear, 0) / certified.length : 0;
    return {
      ts: Date.now(), block: designSL.block,
      s1: { n: 33, Fvac: a.Fvac, isp: a.ispVac, Ae: a.Ae, tmin: a.tmin, mass: a.mass },
      s2sl: { n: 3, Fvac: a.Fvac, isp: a.ispVac, Ae: a.Ae, tmin: a.tmin, mass: a.mass },
      s2vac: { n: 3, Fvac: b.Fvac, isp: b.ispVac, Ae: b.Ae, tmin: b.tmin, mass: b.mass },
      certified: certified.length, wear,
      sns: certified.slice(0, 40).map(u => u.sn),
    };
  }

  return {
    G0, P0, GAMMA, LIMITS, LIMITS0, BLOCKS, VARIANTS, STATIONS, DEFECTS, PROFILES,
    PRE, POST, PHASE_LABEL, REDLINES, UPGRADES, DESIGN_KNOBS, DT_REF,
    makeRng, nozzle, cstarIdeal, chamberTemp, peOverPc,
    makeDesign, geom, engineMass, operate, datasheet, minThrottle,
    makeLine, stationTakt, lineRate, buildUnit, stepLine,
    startTest, stepTest, rework, applyUpgrades, resetLimits, fleetSpec,
  };
});
