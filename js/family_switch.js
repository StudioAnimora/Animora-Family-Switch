// Animora Family Switch v1
// One-family mute for the Animora workflow, plus stacking-order persistence.
import { app } from "../../scripts/app.js";

// ---------- constants (colors unchanged from earlier versions) ----------
const TYPE = "AnimoraFamilySwitch";
const TITLE = "Animora Family Switch";
const FAMILIES = [
  { id: "Anima", color: "#ae08b6" },
  { id: "SDXL", color: "#2e8b57" }, // SDXL / Pony / Illustrious share this family
  { id: "Krea", color: "#1b8a8c" },
];
const DEFAULT_FAMILY = "Anima";
const NODE_COLOR = "#8c5a00";
const NODE_BGCOLOR = "#171717";
const STYLE_ID = "animora-family-switch-css";

const SHARED = /wildcard|dashboard|control(?!\s*net)|output|seed|dimension|timer|monitor|run log|markdown|workflow information/i;
const IMAGE_WIRE = /image/i;
const EDGE_PAD = 40;   // px around a family group's sides/bottom
const TOP_PAD = 80;    // px above a family group
const LOADER_TYPES = new Set([
  "VAELoader", "CLIPLoader", "UNETLoader", "DualCLIPLoader", "TripleCLIPLoader",
  "CheckpointLoaderSimple", "CheckpointLoader", "Checkpoint Loader (Simple)",
  "CheckpointLoaderSimple (SMZ)", "CLIPSetLastLayer",
  "LoraLoader", "Lora Loader (LoraManager)",
]);

const LG = () => (typeof LiteGraph !== "undefined" ? LiteGraph : {});
const MODE_ON = () => LG().ALWAYS ?? 0;
const MODE_MUTE = () => LG().NEVER ?? 2;
const MODE_BYPASS = () => LG().BYPASS ?? 4;

const isSwitch = (n) => n?.type === TYPE || n?.comfyClass === TYPE;
const rootGraph = () => app.graph;

// ---------- family detection ----------
function familyFromText(text) {
  const t = String(text || "").toLowerCase();
  if (!t) return null;
  // skip common false hits ("animation", "animal", "animated", "illumination", "illusion", "illustration")
  if (/anima(?!tion|ted|te |l)/.test(t)) return "Anima";
  if (t.includes("krea")) return "Krea";
  if (t.includes("sdxl") || t.includes("pony") || /illu(?!min|sion|strat)/.test(t)) return "SDXL";
  return null;
}

const pair = (v, dx, dy) =>
  !v ? [dx, dy] : typeof v[0] === "number" ? [v[0], v[1]] : [v.x ?? dx, v.y ?? dy];

function readGroup(g) {
  const [px, py] = pair(g.pos, 0, 0);
  const [sw, sh] = pair(g.size, 0, 0);
  return {
    x: g.x ?? px, y: g.y ?? py, w: g.w ?? sw, h: g.h ?? sh,
    family: familyFromText(g.title || g.name),
  };
}

function familyGroups() {
  let raw = [];
  try {
    const api = window.PixaromaPixGroup;
    if (api?.listGroups) raw = api.listGroups() || [];
  } catch (e) {}
  if (!raw.length) raw = rootGraph()?.extra?.pixaromaGroups || [];
  // Native ComfyUI groups work too, so no extra pack is required.
  const native = (rootGraph()?._groups || rootGraph()?.groups || []).map((g) => ({
    title: g.title,
    x: g.pos?.[0] ?? g._pos?.[0] ?? g.bounding?.[0],
    y: g.pos?.[1] ?? g._pos?.[1] ?? g.bounding?.[1],
    w: g.size?.[0] ?? g._size?.[0] ?? g.bounding?.[2],
    h: g.size?.[1] ?? g._size?.[1] ?? g.bounding?.[3],
  }));
  return [...raw, ...native].map(readGroup).filter((g) => g.family);
}

function familyOf(node, groups) {
  if (!node || isSwitch(node)) return null;
  const byTitle = familyFromText(node.title) || familyFromText(node.properties?.pixSGName);
  if (byTitle) return byTitle;
  if (SHARED.test(node.title || "") || SHARED.test(node.type || "")) return null;

  const [x, y] = pair(node.pos, 0, 0);
  const [w, h] = pair(node.size, 200, 80);
  const cx = x + w / 2;
  const cy = y + h / 2;
  const type = node.type || node.comfyClass || "";
  const columnType = LOADER_TYPES.has(type) || type.includes("-");

  for (const g of groups) {
    const inBand = cy >= g.y - TOP_PAD && cy <= g.y + g.h + EDGE_PAD;
    const inBox = inBand && cx >= g.x - EDGE_PAD && cx <= g.x + g.w + EDGE_PAD;
    const inColumn = inBand && cx >= g.x && cx <= g.x + g.w;
    if (inBox || (columnType && inColumn)) return g.family;
  }
  return null;
}

// ---------- muting ----------
function applyFamily(picked) {
  const graph = rootGraph();
  if (!graph || !picked) return;
  const groups = familyGroups();
  for (const node of graph._nodes || []) {
    const fam = familyOf(node, groups);
    if (!fam) continue;
    if (fam === picked) node.mode = MODE_ON();
    else {
      const imageWire = IMAGE_WIRE.test(node.title || "") || IMAGE_WIRE.test(node.properties?.pixSGName || "");
      node.mode = imageWire ? MODE_BYPASS() : MODE_MUTE();
    }
  }
  graph.setDirtyCanvas?.(true, true);
}

// ---------- diagnostics ----------
const TAG = "[AFS]";
// diagnostics are off by default. Turn on with DEBUG = true here, or at runtime
// with AFS.debug(true) in the browser console (remembered in localStorage).
const DEBUG_KEY = "AFS.debug";
let DEBUG = false;
try { DEBUG = localStorage.getItem(DEBUG_KEY) === "1"; } catch (e) {}
const SHOW_TOAST = false; // toasts also need DEBUG on
const log = (...a) => { if (DEBUG) console.log(TAG, ...a); };
const warn = (...a) => { if (DEBUG) console.warn(TAG, ...a); };
function toast(severity, detail) {
  if (!SHOW_TOAST || !DEBUG) return;
  try {
    app.extensionManager?.toast?.add?.({ severity, summary: "Family Switch", detail, life: 3000 });
  } catch (e) {}
}

// ---------- stacking order ----------
// Two kinds of ComfyUI frontend handle stacking differently:
//  * Older ones (up to about 1.55): the Vue (Nodes 2.0) renderer gives each node a
//    z-index in its layout store when the node is created on load, and that value is
//    the node's execution "order". canvas.bringToFront only reorders graph._nodes,
//    which the Vue renderer ignores, and the layout store isn't reachable from an
//    extension. So the order has to be planted in node.order before Vue reads it,
//    in onGraphConfigured, which runs right before Vue's onAfterGraphConfigured.
//  * Newer ones (about 1.56+): bringToFront writes the layout store z-index directly.
// It does both, reads the live order from the Vue DOM when Vue is on, and checks the
// result a few times after load.
function canvasFor(graph) {
  const c = app.canvas;
  return c && graph && c.graph === graph ? c : null; // not while inside a subgraph
}

const isRoot = (graph) => !!graph && (graph === app.graph || graph === app.rootGraph);

// true when canvas.bringToFront only splices graph._nodes (older frontends)
function bringIsArrayOnly(c) {
  try {
    return /\.splice\(/.test(Function.prototype.toString.call(c.bringToFront));
  } catch (e) {
    return false;
  }
}

// id -> { z, i } from the Vue node elements, or null when Vue nodes aren't on screen
function vueZ() {
  const els = document.querySelectorAll(".lg-node[data-node-id]");
  if (!els.length) return null;
  const map = new Map();
  els.forEach((el, i) => {
    const z = parseFloat(el.style.zIndex);
    map.set(String(el.dataset.nodeId), { z: Number.isFinite(z) ? z : 0, i });
  });
  return map;
}

const isWireless = (n) =>
  n?.properties?.pixSGName != null ||
  /(^|[^a-z])(set|get)([^a-z]|$)/i.test(`${n?.type || ""} ${n?.title || ""}`);

function readOrder(graph) {
  const c = canvasFor(graph);
  if (!c) return null;
  const nodes = graph._nodes || [];
  const vz = vueZ();
  if (vz && nodes.every((n) => vz.has(String(n.id)))) {
    const ids = nodes
      .map((n) => ({ id: n.id, ...vz.get(String(n.id)) }))
      .sort((a, b) => a.z - b.z || a.i - b.i)
      .map((x) => x.id);
    return { ids, source: "vue-dom" };
  }
  if (!c.visible_area || typeof c.computeVisibleNodes !== "function") return null;
  const va = c.visible_area;
  const keep = [va[0], va[1], va[2], va[3]];
  try {
    va[0] = -1e9; va[1] = -1e9; va[2] = 2e9; va[3] = 2e9;
    const ids = c.computeVisibleNodes(undefined, []).map((n) => n.id);
    return ids.length === nodes.length ? { ids, source: "canvas" } : null;
  } catch (e) {
    return null;
  } finally {
    va[0] = keep[0]; va[1] = keep[1]; va[2] = keep[2]; va[3] = keep[3];
  }
}

function wirelessZ(graph) {
  const vz = vueZ();
  return (graph?._nodes || []).filter(isWireless).map((n) => ({
    id: n.id, title: n.title, z: vz?.get(String(n.id))?.z ?? null,
  }));
}

// Older Vue renderer: plant the order where Vue reads it on load.
function seedOrder(graph, ids) {
  const rank = new Map(ids.map((id, i) => [String(id), i + 1]));
  let next = ids.length;
  let hit = 0;
  const before = [];
  for (const n of graph._nodes || []) {
    const r = rank.get(String(n.id));
    if (isWireless(n)) before.push({ id: n.id, title: n.title, order: n.order, seeded: r ?? next + 1 });
    if (r) hit++;
    n.order = r ?? ++next;
  }
  return { hit, before };
}

function writeOrder(graph, ids) {
  if (!Array.isArray(ids) || !ids.length) return 0;
  const c = canvasFor(graph);
  if (typeof c?.bringToFront !== "function") return 0;
  const byId = new Map((graph._nodes || []).map((n) => [String(n.id), n]));
  let hit = 0;
  for (const id of ids) {
    const n = byId.get(String(id));
    if (!n) continue;
    try { c.bringToFront(n); hit++; } catch (e) {}
  }
  c.setDirty?.(true, true);
  return hit;
}

// Does the live order match the saved one (ignoring removed/new nodes)?
function compareOrder(graph, ids) {
  const cur = readOrder(graph);
  if (!cur) return { ok: null };
  const want = new Set(cur.ids.map(String));
  const wanted = ids.map(String).filter((id) => want.has(id));
  const set = new Set(wanted);
  const got = cur.ids.map(String).filter((id) => set.has(id));
  let bad = 0;
  let first = -1;
  for (let i = 0; i < wanted.length; i++) {
    if (wanted[i] !== got[i]) { bad++; if (first < 0) first = i; }
  }
  return { ok: bad === 0, bad, first, wanted, got, source: cur.source };
}

// While a load is being restored, saves write the target order instead of reading the
// half-built canvas/DOM (stale Vue elements from the previous graph can share ids).
// the guard is tied to the switch node that set it, so a save in another
// workflow tab within the 5 s window can't receive this workflow's order.
let guardIds = null;
let guardNode = null;
let guardTimer = 0;
function setGuard(ids, node) {
  guardIds = ids;
  guardNode = node || null;
  clearTimeout(guardTimer);
  guardTimer = setTimeout(() => { guardIds = null; }, 5000);
}
function clearGuard() {
  guardIds = null;
  guardNode = null;
  clearTimeout(guardTimer);
}

let loadSeq = 0;
function verifyLater(graph, ids, arrayOnly) {
  const seq = ++loadSeq;
  let reported = false;
  let refixed = false;
  const check = (label) => {
    if (seq !== loadSeq || rootGraph() !== graph) return;
    clearGuard();
    // Older Vue renderer can only take the order at load; newer one or classic canvas can be re-applied.
    const fixable = !arrayOnly || !vueZ();
    const r = compareOrder(graph, ids);
    if (r.ok === null) return log(`check @${label}: could not read live order (inside a subgraph?)`);
    if (r.ok) {
      if (!reported) {
        reported = true;
        log(`check @${label}: stacking matches saved order (${r.wanted.length} nodes, read from ${r.source}). Set/Get z:`, wirelessZ(graph));
        toast("success", "Stacking order restored");
      }
      return;
    }
    warn(`RESET DETECTED @${label}: ${r.bad} nodes out of place (first at position ${r.first}: wanted ${r.wanted[r.first]}, got ${r.got[r.first]}, read from ${r.source}). Set/Get z:`, wirelessZ(graph));
    reported = false;
    if (fixable && !refixed) {
      refixed = true;
      const n = writeOrder(graph, ids);
      log(`re-applied bringToFront to ${n} nodes`);
    } else if (!fixable) {
      warn("order changed after load (a click/drag raises a node, which is normal; otherwise something reset it). This frontend's Vue renderer only takes the saved order at load time.");
      toast("warn", "Stacking was reset after load, see console [AFS]");
    }
  };
  requestAnimationFrame(() => requestAnimationFrame(() => check("2 frames")));
  for (const ms of [500, 1500, 4000]) setTimeout(() => check(`${ms}ms`), ms);
}

// Per-load state shared by onGraphConfigured (before Vue) and afterConfigureGraph.
let loadState = null;

// ---------- undo / redo ----------
let pendingUndo = null;
function onKey(e) {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  const k = (e.key || "").toLowerCase();
  if (k !== "z" && k !== "y") return;
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
  const graph = rootGraph();
  if (!graph?._nodes?.some(isSwitch)) return;
  const cur = readOrder(graph);
  if (cur) pendingUndo = { ids: cur.ids, at: Date.now() };
}
function takePendingUndo() {
  const p = pendingUndo;
  pendingUndo = null;
  return p && Date.now() - p.at < 2000 ? p.ids : null;
}

// ---------- UI (styling unchanged) ----------
function injectCss() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
  .afs-root { display:flex; flex-direction:column; gap:2px; padding:4px 6px 6px; width:100%; box-sizing:border-box; }
  .afs-row { display:flex; align-items:center; gap:8px; height:30px; padding:0 8px; border-radius:6px; cursor:pointer;
             background:rgba(255,255,255,0.04); user-select:none; }
  .afs-row:hover { background:rgba(255,255,255,0.08); }
  .afs-row.on { background:rgba(255,255,255,0.10); }
  .afs-dot { width:10px; height:10px; border-radius:50%; flex:0 0 10px; }
  .afs-name { flex:1; font-size:12px; color:#8a8a8a; font-weight:600; }
  .afs-row.on .afs-name { color:#fff; }
  .afs-tog { width:34px; height:18px; border-radius:99px; background:rgba(255,255,255,0.16); position:relative; flex:0 0 34px; }
  .afs-tog .k { width:14px; height:14px; border-radius:50%; background:#c8c8c8; position:absolute; top:2px; left:2px; transition:left .12s, background .12s; }
  .afs-row.on .afs-tog { background:var(--afs-acc,#f66744); }
  .afs-row.on .afs-tog .k { left:18px; background:#fff; }
  `;
  document.head.appendChild(s);
}

const picked = (node) => node?.properties?.family || DEFAULT_FAMILY;

function paint(node) {
  node?._afsRoot?.querySelectorAll(".afs-row").forEach((row) =>
    row.classList.toggle("on", row.dataset.fam === picked(node)));
}

function buildDom(node) {
  injectCss();
  const root = document.createElement("div");
  root.className = "afs-root";
  for (const f of FAMILIES) {
    const row = document.createElement("div");
    row.className = "afs-row";
    row.dataset.fam = f.id;
    row.style.setProperty("--afs-acc", f.color);
    row.innerHTML = `<span class="afs-dot" style="background:${f.color}"></span>
      <span class="afs-name">${f.id}</span>
      <span class="afs-tog"><span class="k"></span></span>`;
    row.onpointerdown = (e) => e.stopPropagation();
    row.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      node.properties.family = f.id;
      paint(node);
      applyFamily(f.id);
    };
    root.appendChild(row);
  }
  node._afsRoot = root;
  paint(node);
  return root;
}

// ---------- node ----------
let lastSaveKey = "";
let lastSaveWarn = 0;

class AnimoraFamilySwitch extends LiteGraph.LGraphNode {
  constructor() {
    super(TITLE);
    this.type = TYPE;
    this.comfyClass = TYPE;
    this.isVirtualNode = true;
    this.serialize_widgets = false;
    this.properties = { family: DEFAULT_FAMILY };
    this.size = [260, 140];
    this.color = NODE_COLOR;
    this.bgcolor = NODE_BGCOLOR;
  }

  onAdded() {
    if (!this._afsDom && typeof this.addDOMWidget === "function") {
      this._afsDom = this.addDOMWidget("afs", "", buildDom(this), { serialize: false });
    }
    if (!this.size || this.size[1] < 140) this.size = [Math.max(this.size?.[0] || 260, 260), 140];
    paint(this);
  }

  onSerialize(o) {
    o.properties = o.properties || {};
    o.properties.family = picked(this);
    if (guardIds && guardNode === this) {
      o.properties.zOrder = guardIds;
      return;
    }
    const cur = isRoot(this.graph) ? readOrder(this.graph) : null;
    if (cur) {
      o.properties.zOrder = cur.ids;
      this.properties.zOrder = cur.ids;
      const key = cur.ids.join(",");
      if (key !== lastSaveKey) {
        lastSaveKey = key;
        const ranks = (this.graph._nodes || []).filter(isWireless)
          .map((n) => `${n.id}@${cur.ids.indexOf(n.id) + 1}`);
        log(`save: zOrder written to switch properties (${cur.ids.length} nodes, read from ${cur.source}). Set/Get back-to-front rank:`, ranks.join(" "));
      }
    } else if (this.properties?.zOrder) {
      o.properties.zOrder = this.properties.zOrder;
      if (Date.now() - lastSaveWarn > 5000) {
        lastSaveWarn = Date.now();
        warn(`save: couldn't read the live order (inside a subgraph or canvas not ready), kept previous zOrder (${this.properties.zOrder.length} nodes)`);
      }
    }
  }

  onConfigure(info) {
    this.properties = this.properties || {};
    this.properties.family = info?.properties?.family || this.properties.family || DEFAULT_FAMILY;
    paint(this);
    // Pasting a switch outside a full graph load reapplies its family.
    if (!app.configuringGraph) applyFamily(this.properties.family);
  }

  // Runs on every node after the graph loads but before the Vue renderer reads
  // node.order to build its z-index. This is the only point an extension can steer it.
  onGraphConfigured() {
    const graph = this.graph;
    if (!isRoot(graph) || (graph._nodes || []).find(isSwitch) !== this) return;
    const undoIds = takePendingUndo();
    const ids = undoIds || this.properties?.zOrder;
    if (!Array.isArray(ids) || !ids.length) {
      loadState = null;
      log("restore: this workflow has no saved zOrder yet. Save it once, then reopen.");
      return;
    }
    const { hit, before } = seedOrder(graph, ids);
    loadState = { graph, ids, seeded: true };
    setGuard(ids, this);
    log(`restore fired (pre-mount, ${undoIds ? "undo/redo" : "saved zOrder"}): seeded node.order for ${hit}/${ids.length} saved ids, ${(graph._nodes || []).length} nodes in graph. Set/Get before -> seeded:`, before);
  }
}

// ---------- extension ----------
app.registerExtension({
  name: "animora.FamilySwitch",
  setup() {
    window.addEventListener("keydown", onKey, true);
    const c = app.canvas;
    log(`loaded. bringToFront ${c && bringIsArrayOnly(c) ? "only reorders graph._nodes (older frontend: Vue order is seeded on load)" : "writes the layout store (newer frontend)"}. Vue nodes ${vueZ() ? "on" : "off/not mounted yet"}.`);
    // Manual helpers for the console: AFS.check() / AFS.dump()
    window.AFS = {
      dump: () => { const g = rootGraph(); const r = readOrder(g); console.log(TAG, "live order", r?.source, r?.ids, "Set/Get z:", wirelessZ(g)); return r; },
      debug: (on = true) => { DEBUG = !!on; try { localStorage.setItem(DEBUG_KEY, DEBUG ? "1" : "0"); } catch (e) {} console.log(TAG, `debug logging ${DEBUG ? "on" : "off"}`); return DEBUG; },
      check: () => { const g = rootGraph(); const sw = (g?._nodes || []).find(isSwitch); const r = sw?.properties?.zOrder ? compareOrder(g, sw.properties.zOrder) : null; console.log(TAG, "compare with saved zOrder", r); return r; },
    };
  },
  registerCustomNodes() {
    LiteGraph.registerNodeType(TYPE, AnimoraFamilySwitch);
    AnimoraFamilySwitch.category = "animora";
    AnimoraFamilySwitch.title = TITLE;
  },
  async afterConfigureGraph() {
    const graph = rootGraph();
    const node = (graph?._nodes || []).find(isSwitch); // first switch only
    if (!node) return;
    // always say so when there's more than one switch (only the first one is used).
    const count = (graph._nodes || []).filter(isSwitch).length;
    if (count > 1) console.warn(TAG, `${count} Family Switch nodes in this workflow; only the first (id ${node.id}) is used on load. Delete the extras.`);
    if (!node.size || node.size[1] < 140) node.size = [Math.max(node.size?.[0] || 260, 260), 140];
    paint(node);
    applyFamily(picked(node));

    let state = loadState && loadState.graph === graph ? loadState : null;
    loadState = null;
    if (!state) {
      // onGraphConfigured didn't run (unusual frontend); fall back to a bring-to-front restore.
      const ids = takePendingUndo() || node.properties?.zOrder;
      if (!Array.isArray(ids) || !ids.length) return;
      warn("restore: pre-mount hook didn't fire; Vue z-order may not follow on older frontends");
      state = { graph, ids, seeded: false };
      setGuard(ids, node);
    }
    // Put the real execution order back (node.order was borrowed for seeding).
    if (state.seeded) try { graph.updateExecutionOrder?.(); } catch (e) {}

    const c = canvasFor(graph);
    const arrayOnly = c ? bringIsArrayOnly(c) : true;
    const n = writeOrder(graph, state.ids);
    log(`restore: bringToFront on ${n} nodes (${arrayOnly ? "graph._nodes for the classic canvas" : "layout store"}). Vue nodes ${vueZ() ? "mounted" : "not mounted yet"}.`);
    verifyLater(graph, state.ids, arrayOnly);
  },
});
