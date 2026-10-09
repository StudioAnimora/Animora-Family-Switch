# Animora Family Switch (V1)

> **Group your nodes first.** This switch works by turning on or muting whatever nodes sit inside a group. It does **not** auto-detect model families, and it does **not** trace connections from your checkpoint to your output. If your nodes are loose and ungrouped, the switch has nothing to toggle.

**How it decides what to switch:**
- Put each family's nodes inside a group whose title names that family: **Anima**, **SDXL** (or Pony, Illu) or **Krea**. Normal ComfyUI groups work, and Pixaroma groups work too if you use them.
- Any node outside those groups is left alone, unless its own title names a family.
- Shared nodes (wildcards, seed, sizes, dashboard, Save Image) should stay outside the family groups so they're always on.

**What you get once it's grouped:**
- **One click, whole group.** Pick a family and every node in its group turns on, while the other family groups are muted, including Set/Get nodes and subgraph nodes inside them.
- **Mute vs bypass.** Nodes with "image" in the title are bypassed instead of muted, so an rgthree Any Switch downstream picks up the active image.
- **Survives restarts.** The chosen family is saved with the workflow and reapplied on load.
- **Keeps node stacking.** It saves which nodes sit in front and restores that on load and after Ctrl+Z, so collapsed Set/Get nodes stop jumping on top.
- **Lightweight.** JavaScript only, nothing to pip install, and no other custom node packs required.

## Install

**Comfy Manager:** open Manager → Custom Nodes Manager, search "Animora Family Switch", click Install, restart ComfyUI. (Shows up once the node is listed in the Comfy Registry.)

**Manager → Install via Git URL:** paste `https://github.com/StudioAnimora/Animora-Family-Switch` and restart.

**git clone:**
```
cd ComfyUI/custom_nodes
git clone https://github.com/StudioAnimora/Animora-Family-Switch AnimoraFamilySwitch
```
Restart ComfyUI and hard-refresh the browser (Ctrl+F5). It's JS only, so there's no pip step.

**Manual:** copy this folder to `ComfyUI/custom_nodes/AnimoraFamilySwitch` and restart.

No other packs are needed. It reads normal ComfyUI groups, and also understands Pixaroma groups and Set/Get nodes if you use them.

## Use

Add **animora → Animora Family Switch** to the dashboard and click a family.

A node belongs to a family when:
- its title (or Set/Get name) contains `anima`, `krea`, `sdxl`, `pony` or `illu`, or
- it sits inside a group whose title names a family (`Anima Loaders`, `SDXL Loaders (SDXL/Pony/Illustrious)`, `Krea 2 Loaders`).

The active family is switched on. The other families are muted, except nodes with "image" in the title or Set/Get name, which are **bypassed** so rgthree Any Switch can skip them. Set and Get nodes switch along with their family.

Wildcards, seed, size, the dashboard and SaveImage stay outside the family groups, so they always stay on.

## Stacking order

ComfyUI keeps the front-to-back order of nodes in a separate layer that isn't saved with the workflow, so on reload newer nodes (like Set/Get) jump on top. The switch fixes this:
- On every save it stores the back-to-front order in its own `zOrder` property. Nothing else in the workflow is touched. With Nodes 2.0 on, the order is read from the nodes on screen.
- On load it puts that order back. On older frontends (Nodes 2.0 takes each node's stacking from its execution order when the workflow loads), the switch sets that value just before Nodes 2.0 reads it, then puts the real execution order back. On newer frontends and the classic canvas it uses ComfyUI's own bring-to-front.
- A few seconds after load it checks the result and reports in the browser console.
- After Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z it puts back the order from right before the undo.

Older workflows without a saved order load as normal. Nodes that were removed or got new IDs are skipped.


### Console check (F12 or Ctrl+Shift+I → Console, filter `[AFS]`)

Logging is **off by default**. Type `AFS.debug(true)` in the console and reload to turn it on (`AFS.debug(false)` to turn it off). `AFS.dump()` and `AFS.check()` always work.

- `loaded. bringToFront only reorders graph._nodes ...` / `... writes the layout store` shows which kind of frontend you have.
- `save: zOrder written ...` shows the order was stored, with each Set/Get node's rank (1 = furthest back).
- `restore fired (pre-mount ...)` shows the load hook ran and which IDs it set.
- `restore: bringToFront on N nodes ...` is the second pass.
- `check @2 frames: stacking matches saved order` means it worked. A small "Stacking order restored" toast also pops up.
- `RESET DETECTED @...` means the order changed after load. Clicking or dragging a node in the first few seconds causes this too.
- `restore: this workflow has no saved zOrder yet` means you need to save once.
- Type `AFS.dump()` or `AFS.check()` in the console to see the current order or compare it with the saved one.

Toasts are off by default. To get them, set `SHOW_TOAST = true` near the top of `js/family_switch.js` and turn debug on.

## Don't

- Run another group switch or group bypasser on the same groups, because the two will fight.
- Pack a family subgraph while that family is muted, because the nodes inside freeze muted. Unmute it, pack it, then save.
- Mute SaveImage or the Any Switch.

## Known limitations

- **Undo from the Edit menu doesn't keep stacking.** Only Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z restore the Set/Get order; the menu buttons don't.
- **Stacking inside subgraphs isn't saved.** Only the main canvas order is stored. Families wrapped in subgraphs keep their inner layout but not their inner stacking.
- **Set nodes inside a family subgraph can't be seen from the main canvas.** A Get only looks in its own graph and the graphs around it. Keep any Set that a main-canvas Get reads (like each family's image Set) outside the subgraph and feed it from the subgraph's output.
- **One switch per workflow.** Extra switches are ignored, and a warning is printed in the console.
- **Families are found by group and title.** A node only switches with a family if it sits in that family's group or has Anima / SDXL / Pony / Illu / Krea in its title. Shared nodes need a shared title (e.g. "Control", "Dashboard", "Shared").
- **Built for the Animora layout.** Family names and group titles are fixed in the code.
- **The stacking restore depends on the ComfyUI frontend version.** It's been checked against the frontend source, not every release. If Set/Gets come back on top, run `AFS.debug(true)`, reload, and check the `[AFS]` console lines.

### Workflow notes

- **Quality tags only go on SDXL / Pony / Illustrious.** Anima and Krea 2 don't need them, and Krea 2 reads them as plain words.
- **Score tags vs aesthetic tags.** `score_9, score_8_up…` are Pony-only. Illustrious uses `masterpiece, best quality`. Don't mix them, and leave `score_` tags out of Anima, where they can push the look toward generic.
- **The optional latent upscale is one shared stage after the Any Switch,** controlled from OPTIONAL SETTINGS. It's off by default.
- **Each family can be wrapped in its own subgraph.** The switch mutes the whole subgraph node by its group and title.

## Version notes

- **1.0.1:** Clearer description: grouping comes first.
- **V1 (1.0.0):** First public release.
