# Elbow Arrow Connector — Design

**Date:** 2026-07-24
**Status:** Approved

## Problem

The Arrow tool only draws straight lines. Excel/PowerPoint's "elbow
connector" — a right-angle-bend connector, common when linking shapes that
aren't diagonally aligned — has no equivalent. The user wants this style,
with the bend position draggable (matching Excel's actual feel, not a fixed
midpoint).

## Data model

Two new optional fields on `ArrowAnn`, both defaulting so existing saved
arrows are unaffected:

```ts
style?: 'straight' | 'elbow'   // default 'straight'
bendRatio?: number             // 0..1, default 0.5 — position along the
                                // dominant axis where the elbow bends
```

Everything else on `ArrowAnn` (`x1,y1,x2,y2`, `head`, `doubleEnded`,
`startConnect`, `endConnect`) is reused as-is.

## Path geometry

The dominant axis (`|dx|` vs `|dy|`) is recomputed live from the current
endpoints on every render — never persisted — so a glued elbow arrow keeps
routing sensibly as its connected shape moves and the dominant axis flips.

Given dominant axis = horizontal:

```
bendX = x1 + bendRatio * (x2 - x1)
path: (x1,y1) → (bendX,y1) → (bendX,y2) → (x2,y2)
```

(Vertical dominant axis mirrors this with `bendY`.) This is a 3-segment
Z-path, the same shape Excel's elbow connector produces. At `bendRatio` near
0 or 1 one of the two dominant-axis segments collapses to ~0 length, which
visually degenerates to a clean L — so no separate "L vs Z" mode is needed.

## Interaction

- Arrow tool's row-2 options gain a straight/elbow toggle, alongside the
  existing arrowhead-style and single/double-end controls.
- A selected elbow arrow shows one new drag handle (`bend`) at the midpoint
  of the middle segment. Dragging it updates `bendRatio` (clamped 0..1).
- Endpoint dragging, connection-point gluing (the 16-anchor Excel-style
  connector system), resizing, and duplication are all unchanged — they only
  read/write `x1,y1,x2,y2`, which fully describe an elbow arrow's endpoints
  regardless of `style`.

## Rendering detail: arrowhead angle

A straight arrow's head angle is `atan2(y2-y1, x2-x1)` (the whole-segment
direction). For an elbow arrow the head at (x2,y2) must instead use the
angle of the **last segment** (bend point → x2,y2), and — for double-ended
arrows — the head at (x1,y1) uses the **first segment**'s angle. Both are
axis-aligned (0°/90°/180°/270°) by construction, so the existing head-drawing
code (`drawArrowHead`) needs no changes beyond receiving the corrected angle.

## Scope reuse (no changes needed)

- `getAnnotationBounds`/`getAnnotationLocalBounds` for arrows already use the
  bbox of `(x1,y1)`–`(x2,y2)` plus head padding — the elbow path never
  leaves that box (bendRatio is clamped to 0..1), so bounds stay correct
  unmodified.
- `hitTest` for arrows already falls through to the generic bbox test —
  adequate for elbow arrows too (same box).
- Connection-point resolution (`getConnectAnchorPoint`,
  `resolveArrowConnections`) only touches `x1,y1,x2,y2` — untouched by this
  feature.

## Out of scope (YAGNI)

- Obstacle-avoiding auto-routing (Visio-style) — explicitly rejected in
  favor of the simpler always-Z-path + draggable bend model.
- An explicit "which corner" mode switch — the continuous `bendRatio` model
  covers both L-ish and Z-ish shapes without a separate flag.
