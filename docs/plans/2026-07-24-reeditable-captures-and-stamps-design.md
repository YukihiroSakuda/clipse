# Re-editable Captures & Annotation Stamps — Design

**Date:** 2026-07-24
**Status:** Approved

## Problem

Two recurring frictions in the daily capture → annotate → paste workflow:

1. **Annotations can't be fixed after saving.** The editor's Save flattens
   annotations into the PNG and overwrites the auto-saved original
   (`overwrite_image`), so reopening a capture from the gallery gives burned-in
   pixels. Fixing a typo in a callout means redoing the whole annotation pass.
2. **The same annotation patterns are rebuilt by hand every time.** Recurring
   sets (arrow + number + box, etc.) have no way to be saved and reused.

Constraint confirmed with the user: re-editing happens Clipse-side (edit →
re-copy → re-paste). No integration with paste targets.

## Feature A: Re-editable captures (non-destructive annotations)

### Storage layout

A hidden `.clipse/` subfolder inside the save directory. The shared PNG stays
a plain flattened image — zero compatibility impact:

```
<save_dir>/
  clipse_20260724_1234.png          ← flattened (unchanged, what users paste/share)
  .clipse/
    clipse_20260724_1234.json       ← annotation sidecar
    clipse_20260724_1234.orig.png   ← pristine base image (always PNG, lossless)
```

- Sidecar JSON: `{ version: 1, annotations: Annotation[], nextNumber, frame? }`.
  All annotation types are plain objects; `JSON.stringify` round-trips them.
- Saving with zero annotations writes no sidecar (behavior identical to today).
- `list_captures` filters by file extension, so the `.clipse/` directory is
  naturally invisible to the gallery.

### Save flow (editor Save / Ctrl+S)

1. Flatten + `overwrite_image` as today.
2. New command `save_sidecar(path, annotationsJson, origBase64?)`:
   - `origBase64` is sent only when the base image isn't stashed yet, or when
     it changed (crop). After a crop, the cropped base becomes the new orig and
     annotation coordinates stay relative to it (reusing `applyCrop`'s
     existing coordinate shifting).

### Load flow (open from gallery)

1. `open_capture_in_editor` checks for a sidecar.
2. If present: `pending_image` ← `orig.png` bytes, new `pending_annotations`
   state ← sidecar JSON.
3. Editor fetches the image as usual, then `get_pending_annotations` restores
   the annotation objects into the store — editing resumes losslessly.
4. No sidecar (old files): flattened image opens as before (back-compat).

### File-operation follow-through

- `rename_capture` / `delete_capture` / editor Delete also rename/delete the
  two sidecar files.
- If the PNG is moved externally, the sidecar orphans harmlessly — the
  flattened image still opens; re-editing is simply unavailable.

## Feature B: Annotation stamps (templates)

### Data model

- `stamps.json` in the app data dir (Rust-owned, same idiom as settings.json):
  `{ version: 1, stamps: [{ id, name, createdAt, annotations: Annotation[] }] }`
- On save, the group is normalized: translated so its bounding box's top-left
  sits at (0,0). Shares Feature A's serialization.

### Saving a stamp

- Select annotations (existing multi-select / rubber band) → "Save as stamp"
  (context menu or toolbar) → inline name input (default "Stamp N") →
  `save_stamp` IPC appends.
- Arrow connections closed within the group are kept; connections to outside
  annotations are dropped via the existing `clearDanglingConnections`.

### Inserting a stamp

- Toolbar **Stamps popover** (same UI shape as the Frame popover): name list +
  delete buttons.
- Click inserts at view center:
  - fresh `makeId()` ids, `remapArrowConnections` rewires in-group connections,
  - number markers renumber sequentially from the store's `nextNumber`,
  - inserted group is left selected for immediate drag placement.
- Undo rides the existing history snapshot mechanism (1 insert = 1 snapshot).

## Phases

| Phase | Scope | Size |
|---|---|---|
| 1 | Feature A: sidecar save/load + rename/delete follow-through | Rust: storage.rs, state.rs, ipc; TS: Editor, store |
| 2 | Feature B: stamps.json CRUD + save/insert UI | Rust: two small commands; TS: Toolbar, Canvas |

Phase 1 is independently shippable. Phase 2 builds on Phase 1's serialization
but has thin code coupling.

## Out of scope (YAGNI)

- Auto-updating images already pasted into external documents
- Stamp thumbnail previews (v1 is name-only)
- Sidecar compression / disk-usage settings
- Stamp import/export UI (copying stamps.json works)
