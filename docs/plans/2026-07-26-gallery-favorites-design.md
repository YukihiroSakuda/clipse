# Gallery Favorites (Important Mark) — Design

**Date:** 2026-07-26
**Status:** Approved

## Problem

Captures accumulate in the gallery over time with no way to mark the ones
that matter and quickly narrow down to just those, without changing their
position in the list (chronological order stays authoritative).

## Storage

Captures are listed today by a pure filesystem scan (`list_captures` in
`storage.rs`) — there is no metadata database. Favorites need a small
persistent store, kept separate from the existing annotation sidecar
mechanism (`.clipse/<stem>.json` + `.orig.png`), since favoriting is
unrelated to re-editable annotations and must work on any capture, edited
or not.

```
<save_dir>/
  .clipse/
    favorites.json   ← JSON array of absolute capture paths
```

- `favorites.json` is a flat `Vec<String>` of paths, read once per
  `list_captures` call and cross-referenced to set `CaptureEntry.favorite`.
- `rename_capture` updates the matching entry's path in place.
- `delete_capture` removes the entry.
- Missing/corrupt file is treated as an empty set (best-effort, never fails
  the caller).

## Backend (Rust)

- `CaptureEntry` gains `favorite: bool`.
- New command `toggle_favorite(path: String) -> Result<bool, String>`:
  loads the set, flips membership for `path`, writes back, returns the new
  state.
- `list_captures`, `rename_capture`, `delete_capture` updated as above.

## Frontend (Gallery.tsx)

- `ipc.toggleFavorite(path)` wrapper.
- Star icon button added to `cardActions` (both image and video cards),
  optimistically toggling `entry.favorite` in the `captures` store on click.
- A second segmented toggle next to the existing All/Images/Videos filter:
  **All / Important / Other**, filtering `visibleCaptures` by
  `entry.favorite` (AND'd with the existing type filter and filename
  search). Filtering only — no reordering.

## Scope

Out of scope for this pass: bulk-favorite from multi-select, pinning
favorites to the top of the grid (explicitly not wanted — order must stay
chronological).
