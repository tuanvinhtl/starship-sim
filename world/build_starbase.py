"""
Dung toan bo site Starbase tu world/starbase_layout.json.

Chay QUA MCP: tool `execute_python` cua unreal-mcp (khong chay bang python3 o terminal —
script nay can module `unreal` chi ton tai ben trong Unreal Editor).

Idempotent: xoa het actor trong folder outliner "Starbase" roi dung lai tu dau.
Nho vay sua layout JSON -> chay lai -> site dung lai chinh xac, diff duoc bang git.
"""
import json, math, os
import unreal

# ---- doc layout ---------------------------------------------------------
LAYOUT = os.environ.get(
    "STARBASE_LAYOUT",
    "/Users/tuanvinh/engine-object/world/starbase_layout.json")
CFG = json.load(open(LAYOUT))

M = 100.0          # 1 met = 100 don vi Unreal
ROOT_FOLDER = "Starbase"

CUBE     = "/Engine/BasicShapes/Cube"
CYLINDER = "/Engine/BasicShapes/Cylinder"
CONE     = "/Engine/BasicShapes/Cone"

_eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
_log = []

def log(msg):
    _log.append(msg)
    unreal.log("[starbase] " + msg)

def clear():
    """Xoa actor cu de chay lai duoc nhieu lan."""
    n = 0
    for a in _eas.get_all_level_actors():
        try:
            fp = str(a.get_folder_path())
        except Exception:
            continue
        if fp == ROOT_FOLDER or fp.startswith(ROOT_FOLDER + "/"):
            _eas.destroy_actor(a); n += 1
    log("da xoa %d actor cu" % n)

def _spawn(mesh_path, loc_m, scale, folder, label, rot=(0, 0, 0)):
    a = _eas.spawn_actor_from_class(
        unreal.StaticMeshActor,
        unreal.Vector(loc_m[0] * M, loc_m[1] * M, loc_m[2] * M),
        unreal.Rotator(rot[0], rot[1], rot[2]))
    mesh = unreal.EditorAssetLibrary.load_asset(mesh_path)
    a.static_mesh_component.set_static_mesh(mesh)
    a.set_actor_scale3d(unreal.Vector(*scale))
    a.set_actor_label(label)
    a.set_folder_path("%s/%s" % (ROOT_FOLDER, folder))
    return a

def box(center_m, size_m, folder, label, rot=(0, 0, 0)):
    """Cube goc 100x100x100uu -> scale = kich thuoc(m)."""
    return _spawn(CUBE, center_m, (size_m[0], size_m[1], size_m[2]), folder, label, rot)

def cyl(base_m, radius_m, height_m, folder, label, rot=(0, 0, 0)):
    """Cylinder goc: duong kinh 100uu, cao 100uu, tam o giua -> nang len height/2."""
    c = (base_m[0], base_m[1], base_m[2] + height_m / 2.0)
    return _spawn(CYLINDER, c, (radius_m * 2.0, radius_m * 2.0, height_m), folder, label, rot)

# ---- cac khoi cong trinh ------------------------------------------------
def build_pad_deck():
    d = CFG["pad_deck"]
    cyl((0, 0, d["height"] - d["thickness"] / 2.0), d["radius"], d["thickness"],
        "PadDeck", "PadDeck")
    log("pad deck ban kinh %.0f m" % d["radius"])

def build_olm():
    o = CFG["olm"]
    dp = o["deluge_plate"]
    cyl((0, 0, dp["height"]), dp["radius"], dp["thickness"], "OLM", "DelugePlate")

    lg = o["legs"]
    for i in range(lg["count"]):
        th = 2 * math.pi * i / lg["count"]
        cyl((lg["radius"] * math.cos(th), lg["radius"] * math.sin(th), 0.0),
            lg["leg_radius"], o["table_height"], "OLM", "OLM_Leg_%02d" % i)

    cyl((0, 0, o["table_height"]), o["table_radius"], o["table_thickness"],
        "OLM", "OLM_Table")

    hd = o["hold_down_clamps"]
    top = o["table_height"] + o["table_thickness"]
    for i in range(hd["count"]):
        th = 2 * math.pi * i / hd["count"]
        box((hd["radius"] * math.cos(th), hd["radius"] * math.sin(th), top + hd["height"] / 2.0),
            (0.6, 0.6, hd["height"]), "OLM/Clamps", "HoldDown_%02d" % i,
            rot=(0, 0, math.degrees(th)))
    log("OLM: %d chan, %d hold-down clamp, mat ban cao %.1f m" %
        (lg["count"], hd["count"], top))

def build_tower():
    t = CFG["tower"]
    px, py, pz = t["position"]
    w, h = t["width"], t["section_height"]
    for i in range(t["sections"]):
        box((px, py, pz + h * i + h / 2.0), (w, w, h), "Tower", "TowerSection_%02d" % i)
    total = h * t["sections"]

    ch = t["chopsticks"]
    for side, sign in (("L", 1.0), ("R", -1.0)):
        ang = math.radians(ch["open_angle_deg"]) * sign
        L = ch["arm_length"]
        cx = px + math.cos(ang) * L / 2.0
        cy = py + w / 2.0 + math.sin(ang) * L / 2.0
        box((cx, cy, ch["pivot_height"]), (L, ch["arm_width"], 2.2),
            "Tower/Chopsticks", "ChopstickArm_%s" % side,
            rot=(0, 0, math.degrees(ang)))

    qd = t["quick_disconnect"]
    box((px, py + w / 2.0 + qd["reach"] / 2.0, qd["height"]),
        (2.0, qd["reach"], 3.0), "Tower", "QuickDisconnect")
    log("thap cao %.1f m, %d tang, chopstick o %.0f m" %
        (total, t["sections"], ch["pivot_height"]))

def build_tank_farm():
    tf = CFG["tank_farm"]
    cx, cy, cz = tf["arc_center"]
    a0, a1, n = tf["arc_start_deg"], tf["arc_end_deg"], tf["count"]
    tk = tf["tank"]
    for i in range(n):
        f = i / float(max(1, n - 1))
        th = math.radians(a0 + (a1 - a0) * f)
        cyl((cx + tf["arc_radius"] * math.cos(th), cy + tf["arc_radius"] * math.sin(th), cz),
            tk["radius"], tk["height"], "TankFarm", "GSE_Tank_%02d" % i)
    log("tank farm: %d bon cao %.0f m" % (n, tk["height"]))

def build_lightning_towers():
    lt = CFG["lightning_towers"]
    for i in range(lt["count"]):
        th = math.radians(lt["start_deg"] + 360.0 * i / lt["count"])
        cyl((lt["radius"] * math.cos(th), lt["radius"] * math.sin(th), 0.0),
            lt["mast_radius"], lt["height"], "LightningTowers", "LightningMast_%02d" % i)
    log("%d cot chong set cao %.0f m" % (lt["count"], lt["height"]))

def build_roads():
    for r in CFG.get("roads", []):
        x0, y0, z0 = r["from"]; x1, y1, z1 = r["to"]
        dx, dy = x1 - x0, y1 - y0
        length = math.hypot(dx, dy)
        box(((x0 + x1) / 2.0, (y0 + y1) / 2.0, (z0 + z1) / 2.0),
            (length, r["width"], 0.3), "Roads", "Road_%s" % r["name"],
            rot=(0, 0, math.degrees(math.atan2(dy, dx))))
    log("%d duong" % len(CFG.get("roads", [])))

def main():
    clear()
    build_pad_deck()
    build_olm()
    build_tower()
    build_tank_farm()
    build_lightning_towers()
    build_roads()
    total = sum(1 for a in _eas.get_all_level_actors()
                if str(a.get_folder_path()).startswith(ROOT_FOLDER))
    log("XONG — %d actor trong folder '%s'" % (total, ROOT_FOLDER))
    return "\n".join(_log)

result = main()
print(result)
