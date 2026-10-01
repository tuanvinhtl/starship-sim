#!/usr/bin/env python3
"""
Prototype 3-DOF cho quy trinh phong Starship/Super Heavy.
Muc dich: chot toan hoc (khi quyen, luc day, mass flow, gravity turn, max-Q,
hot-staging) NGOAI Unreal truoc, roi moi port sang C++.

Chay:  python3 sim/python/ascent.py
Xuat:  sim/python/out/ascent.csv  +  bang su kien + do thi ASCII
Stdlib-only, khong can numpy.
"""
import json, math, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
VEH  = json.load(open(os.path.join(ROOT, "sim/reference/vehicle_starship.json")))

# ---------------- hang so ----------------
G0   = 9.80665          # m/s^2, dung cho Isp
MU   = 3.986004418e14   # m^3/s^2, tham so hap dan Trai Dat
RE   = 6371000.0        # m, ban kinh trung binh
P0   = 101325.0         # Pa

# ---------------- US Standard Atmosphere 1976 (0-86 km) ----------------
# [h_base_m, T_base_K, P_base_Pa, lapse_K_per_m]
_LAYERS = [
    (0,      288.15,  101325.0,   -0.0065),
    (11000,  216.65,   22632.06,   0.0),
    (20000,  216.65,    5474.889,  0.001),
    (32000,  228.65,     868.0187, 0.0028),
    (47000,  270.65,     110.9063, 0.0),
    (51000,  270.65,      66.93887,-0.0028),
    (71000,  214.65,       3.956420,-0.002),
]
R_AIR, GAMMA = 287.05287, 1.4

def atmosphere(h):
    """-> (rho kg/m3, P Pa, T K, a m/s). Tren 86 km coi nhu chan khong."""
    if h >= 86000.0:
        return 0.0, 0.0, 186.87, 275.0
    if h < 0.0:
        h = 0.0
    hb, Tb, Pb, L = _LAYERS[0]
    for layer in _LAYERS:
        if h >= layer[0]:
            hb, Tb, Pb, L = layer
        else:
            break
    dh = h - hb
    if L == 0.0:
        T = Tb
        P = Pb * math.exp(-G0 * dh / (R_AIR * Tb))
    else:
        T = Tb + L * dh
        P = Pb * (T / Tb) ** (-G0 / (L * R_AIR))
    rho = P / (R_AIR * T)
    return rho, P, T, math.sqrt(GAMMA * R_AIR * T)

def cd_of_mach(m, table):
    if m <= table[0][0]:  return table[0][1]
    if m >= table[-1][0]: return table[-1][1]
    for i in range(len(table) - 1):
        x0, y0 = table[i]; x1, y1 = table[i + 1]
        if x0 <= m <= x1:
            return y0 + (y1 - y0) * (m - x0) / (x1 - x0)
    return table[-1][1]

# ---------------- mo hinh dong co ----------------
class EngineCluster:
    """Cum dong co dong nhat. Thrust giam theo ap suat moi truong."""
    def __init__(self, count, thrust_vac_N, isp_vac_s, exit_area_m2, throttle_min):
        self.n, self.Fv, self.isp, self.Ae, self.tmin = \
            count, thrust_vac_N, isp_vac_s, exit_area_m2, throttle_min
    def thrust(self, throttle, p_amb, n_live=None):
        n = self.n if n_live is None else n_live
        if throttle <= 0.0 or n == 0: return 0.0, 0.0
        F1 = max(0.0, self.Fv - self.Ae * p_amb)      # bu ap suat mieng phun
        F  = F1 * n * throttle
        mdot = (self.Fv * n * throttle) / (self.isp * G0)  # mass flow ~ khong doi theo p_amb
        return F, mdot

s1, s2 = VEH["stage1"], VEH["stage2"]
BOOST = EngineCluster(s1["engines"]["count"], s1["engines"]["thrust_vac_N"],
                      s1["engines"]["isp_vac_s"], s1["engines"]["nozzle_exit_area_m2"],
                      s1["engines"]["throttle_min"])
SHIP_SL = EngineCluster(s2["engines_sl"]["count"], s2["engines_sl"]["thrust_vac_N"],
                        s2["engines_sl"]["isp_vac_s"], s2["engines_sl"]["nozzle_exit_area_m2"], 0.4)
SHIP_VAC= EngineCluster(s2["engines_vac"]["count"], s2["engines_vac"]["thrust_vac_N"],
                        s2["engines_vac"]["isp_vac_s"], s2["engines_vac"]["nozzle_exit_area_m2"], 0.4)

AREA   = math.pi * (VEH["diameter_m"] / 2.0) ** 2
CDTAB  = [tuple(x) for x in VEH["aero_cd_vs_mach"]]
MAXQ   = VEH["limits"]["max_q_pa"]
MAXG   = VEH["limits"]["max_axial_g"]

# ---------------- trang thai ----------------
class State:
    __slots__ = ("t","x","y","vx","vy","m","stage","prop1","prop2")
    def __init__(s):
        s.t = 0.0
        s.x, s.y = 0.0, RE            # goc Trai Dat, phong tu (0, RE)
        s.vx, s.vy = 0.0, 0.0
        s.stage = 1
        s.prop1 = s1["propellant_t"] * 1000.0
        s.prop2 = s2["propellant_t"] * 1000.0
        s.m = (s1["dry_mass_t"] + s1["propellant_t"] + s2["dry_mass_t"] + s2["propellant_t"]) * 1000.0

DRY1 = s1["dry_mass_t"] * 1000.0
DRY2 = s2["dry_mass_t"] * 1000.0

# ---------------- guidance: gravity turn ----------------
PITCH_KICK_V = 60.0      # m/s -> bat dau nghieng
KICK_DEG     = 3.0
TARGET_V     = 7800.0    # m/s -> van toc cat dong co giai doan 2
TARGET_ALT   = 120000.0  # m  -> do cao toi thieu truoc khi cho phep SECO

def thrust_direction(st, alt, speed):
    """Unit vector huong luc day (zero-alpha gravity turn)."""
    r = math.hypot(st.x, st.y)
    ux, uy = st.x / r, st.y / r                    # local vertical
    if speed < PITCH_KICK_V or alt < 500.0:
        return ux, uy
    if speed < PITCH_KICK_V + 40.0:                # cu hich nghieng
        a = math.radians(KICK_DEG)
        return ux * math.cos(a) - uy * math.sin(a), ux * math.sin(a) + uy * math.cos(a)
    return st.vx / speed, st.vy / speed             # bam prograde

def _s2_thrust(throttle, p_amb, n_sl, n_vac):
    F1, m1 = SHIP_SL.thrust(throttle, p_amb, n_sl)
    F2, m2 = SHIP_VAC.thrust(throttle, p_amb, n_vac)
    return F1 + F2, m1 + m2

def select_setting(st, p_amb, q):
    """Chon (throttle, n_sl, n_vac) de khong vuot max-Q va gioi han gia toc doc truc.
    Giai doan 2 tat bot dong co khi min-throttle van con qua manh (giong Falcon/Starship that)."""
    F_cap = MAXG * G0 * st.m                       # luc day toi da cho phep
    if st.stage == 1:
        F_full, _ = BOOST.thrust(1.0, p_amb)
        th = 0.65 if q > MAXQ * 0.85 else 1.0      # throttle-down qua max-Q
        if F_full * th > F_cap:
            th = F_cap / F_full
        return max(BOOST.tmin, min(1.0, th)), BOOST.n, 0
    for n_sl, n_vac in ((3, 3), (2, 3), (1, 3), (0, 3), (0, 2), (0, 1)):
        F_full, _ = _s2_thrust(1.0, p_amb, n_sl, n_vac)
        if F_full <= 0.0:
            continue
        th = min(1.0, F_cap / F_full)
        if th >= 0.4 or (n_sl, n_vac) == (0, 1):
            return max(0.4, th), n_sl, n_vac
    return 0.4, 0, 1

# ---------------- derivative ----------------
def derivs(st, throttle, n_sl, n_vac):
    r     = math.hypot(st.x, st.y)
    alt   = r - RE
    speed = math.hypot(st.vx, st.vy)
    rho, p_amb, _T, a_snd = atmosphere(alt)

    if st.stage == 1:
        F, mdot = BOOST.thrust(throttle, p_amb, n_sl)
    else:
        F, mdot = _s2_thrust(throttle, p_amb, n_sl, n_vac)

    tx, ty = thrust_direction(st, alt, speed)
    ax, ay = F * tx / st.m, F * ty / st.m

    g = MU / (r * r)                               # hap dan nghich binh phuong
    ax -= g * st.x / r; ay -= g * st.y / r

    q = 0.5 * rho * speed * speed                  # can khi dong
    if speed > 1e-3 and rho > 0.0:
        mach = speed / a_snd if a_snd > 0 else 0.0
        D = q * cd_of_mach(mach, CDTAB) * AREA
        ax -= D * (st.vx / speed) / st.m
        ay -= D * (st.vy / speed) / st.m
    return ax, ay, mdot, q, F

# ---------------- vong lap ----------------
def run(dt=0.02, t_end=900.0, hot_stage_prop_frac=0.04):
    st, rows, events = State(), [], []
    maxq = maxq_t = maxg = maxg_t = 0.0
    n = int(t_end / dt)

    for i in range(n):
        r     = math.hypot(st.x, st.y)
        alt   = r - RE
        speed = math.hypot(st.vx, st.vy)
        rho, p_amb, _, a_snd = atmosphere(alt)
        q = 0.5 * rho * speed * speed

        th, n_sl, n_vac = select_setting(st, p_amb, q)
        F_now = derivs(st, th, n_sl, n_vac)[4]
        a_ax  = F_now / st.m                        # gia toc doc truc THUC TE

        # --- RK4 tren (x,y,vx,vy); khoi luong tich phan bang trung binh RK4 ---
        def f(s):
            ax, ay, md, _q, _F = derivs(s, th, n_sl, n_vac)
            return s.vx, s.vy, ax, ay, md
        def adv(s, k, h):
            o = State(); o.t = s.t + h; o.stage = s.stage; o.m = s.m
            o.prop1 = s.prop1; o.prop2 = s.prop2
            o.x = s.x + k[0]*h; o.y = s.y + k[1]*h
            o.vx = s.vx + k[2]*h; o.vy = s.vy + k[3]*h
            return o
        k1 = f(st); k2 = f(adv(st, k1, dt/2)); k3 = f(adv(st, k2, dt/2)); k4 = f(adv(st, k3, dt))
        st.x  += dt/6*(k1[0] + 2*k2[0] + 2*k3[0] + k4[0])
        st.y  += dt/6*(k1[1] + 2*k2[1] + 2*k3[1] + k4[1])
        st.vx += dt/6*(k1[2] + 2*k2[2] + 2*k3[2] + k4[2])
        st.vy += dt/6*(k1[3] + 2*k2[3] + 2*k3[3] + k4[3])
        dm = dt/6*(k1[4] + 2*k2[4] + 2*k3[4] + k4[4])

        if st.stage == 1: st.prop1 = max(0.0, st.prop1 - dm)
        else:             st.prop2 = max(0.0, st.prop2 - dm)
        st.m = max(DRY2, st.m - dm)
        st.t += dt

        if q > maxq:    maxq, maxq_t = q, st.t
        if a_ax > maxg: maxg, maxg_t = a_ax, st.t

        if i % int(0.5/dt) == 0:
            rows.append((st.t, alt, speed, q, st.m, th, st.stage,
                         float(n_sl + n_vac), a_ax/G0))

        # --- hot-staging khi booster gan het nhien lieu ---
        if st.stage == 1 and st.prop1 <= s1["propellant_t"]*1000.0*hot_stage_prop_frac:
            events.append(("MECO / hot-stage", st.t, alt, speed))
            st.stage = 2
            st.m = DRY2 + st.prop2                  # bo booster
            events.append(("Ship ignition", st.t, alt, speed))

        # --- SECO: cat dong co khi dat van toc muc tieu (khong dot can) ---
        if st.stage == 2 and speed >= TARGET_V and alt >= TARGET_ALT:
            events.append(("SECO (dat van toc muc tieu)", st.t, alt, speed))
            break
        if st.stage == 2 and st.prop2 <= 0.0:
            events.append(("SECO (HET nhien lieu - thieu delta-v)", st.t, alt, speed)); break
        if alt < -10.0:
            events.append(("IMPACT", st.t, alt, speed)); break

    events.insert(0, ("Liftoff", 0.0, 0.0, 0.0))
    events.append(("Max-Q", maxq_t, 0.0, 0.0))
    events.append(("Gia toc doc truc max", maxg_t, 0.0, 0.0))
    return rows, events, maxq, maxq_t, maxg, st

# ---------------- do thi ASCII ----------------
def plot(rows, idx, label, unit, h=16, w=78):
    if not rows: return
    ys = [r[idx] for r in rows]; lo, hi = min(ys), max(ys)
    if hi - lo < 1e-9: hi = lo + 1
    grid = [[" "]*w for _ in range(h)]
    for c in range(w):
        a = int(c * len(rows) / w); b = max(a+1, int((c+1) * len(rows) / w))
        bucket = rows[a:b] or [rows[min(a, len(rows)-1)]]
        r = max(bucket, key=lambda z: z[idx])
        row = h-1 - int((r[idx]-lo)/(hi-lo)*(h-1))
        grid[row][c] = "#" if r[6] == 1 else "*"
    print(f"\n  {label} ({unit})   [# = giai doan 1, * = giai doan 2]")
    for i, line in enumerate(grid):
        v = hi - (hi-lo)*i/(h-1)
        print(f"  {v:10,.0f} |{''.join(line)}")
    print(f"  {'':10} +{'-'*w}")
    print(f"  {'':10}  0s{' '*(w-12)}{rows[-1][0]:.0f}s")

if __name__ == "__main__":
    rows, events, maxq, maxq_t, maxg, st = run()
    out = os.path.join(ROOT, "sim/python/out"); os.makedirs(out, exist_ok=True)
    csv = os.path.join(out, "ascent.csv")
    with open(csv, "w") as f:
        f.write("t_s,alt_m,speed_ms,q_pa,mass_kg,throttle,stage,vmag_ms,axial_g\n")
        for r in rows: f.write(",".join(f"{v:.3f}" for v in r) + "\n")

    print("=" * 80)
    print("  STARSHIP ASCENT — prototype 3-DOF (chua co Trai Dat quay, chua co lift)")
    print("=" * 80)
    print(f"  Khoi luong cat canh : {(s1['dry_mass_t']+s1['propellant_t']+s2['dry_mass_t']+s2['propellant_t']):,.0f} t")
    F_sl, _ = BOOST.thrust(1.0, P0)
    m0 = (s1['dry_mass_t']+s1['propellant_t']+s2['dry_mass_t']+s2['propellant_t'])*1000
    print(f"  Luc day mat dat     : {F_sl/1e6:,.1f} MN   ->  TWR = {F_sl/(m0*G0):.2f}")
    print(f"  Max-Q               : {maxq/1000:,.1f} kPa  @ T+{maxq_t:.0f}s   (that: ~30-35 kPa @ T+55-70s)")
    print(f"  Gia toc doc truc max: {maxg/G0:,.2f} g")
    print(f"  Do cao cuoi         : {(math.hypot(st.x,st.y)-RE)/1000:,.1f} km")
    print(f"  Toc do cuoi         : {math.hypot(st.vx,st.vy):,.0f} m/s  (quy dao thap can ~7,800 m/s)")
    res = st.prop2
    print(f"  Nhien lieu Ship du   : {res/1000:,.0f} t ({res/(s2['propellant_t']*1000)*100:.0f}%)"
          f"  -> delta-v con lai ~{380*G0*math.log(st.m/(st.m-res)):,.0f} m/s")
    print("\n  SU KIEN")
    for name, t, alt, spd in sorted(events, key=lambda e: e[1]):
        print(f"    T+{t:6.1f}s  {name:<24} alt={alt/1000:7.1f} km  v={spd:6.0f} m/s")
    plot(rows, 1, "Do cao", "m")
    plot(rows, 2, "Toc do", "m/s")
    plot(rows, 3, "Ap suat dong q", "Pa")
    print(f"\n  CSV -> {csv}  ({len(rows)} dong)\n")
