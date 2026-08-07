import { useCallback, useEffect, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { Camera, Check, Copy, Edit3, Film, Folder, FolderOpen, Image as ImageIcon, LayoutGrid, Link2, Loader2, Pencil, Pin as PinIcon, Play, Search, Star, Trash2, X } from 'lucide-react'
import { ipc } from '../lib/ipc'
import type { CaptureEntry } from '../lib/ipc'
import { useStore } from '../lib/store'
import { usePrintScreenKey } from '../lib/usePrintScreenKey'
import HelpModal from '../components/HelpModal'
import styles from './Gallery.module.css'

/** Cards per row. Mirrors `.grid`'s `grid-template-columns: repeat(4, 1fr)` in
 *  Gallery.module.css — Up/Down navigation moves by exactly one row, so the two
 *  have to be changed together. */
const GRID_COLUMNS = 4

export default function Gallery() {
  const { captures, setCaptures } = useStore()
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())
  // The keyboard cursor: which card the arrow keys move from and Enter opens.
  // Kept separate from `selectedPaths` because that is a multi-selection (Ctrl+
  // click, Ctrl+A) with no notion of "the current one"; arrowing always collapses
  // it back to a single card, so the two stay in step without extra styling.
  const [focusedPath, setFocusedPath] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [confirmDeletePath, setConfirmDeletePath] = useState<string | null>(null)
  const [confirmDeleteSelection, setConfirmDeleteSelection] = useState(false)
  const [copiedPath, setCopiedPath] = useState<string | null>(null)
  const [copiedImagePath, setCopiedImagePath] = useState<string | null>(null)
  const [copiedFilePath, setCopiedFilePath] = useState<string | null>(null)
  const [showHelp, setShowHelp] = useState(false)
  const [typeFilter, setTypeFilter] = useState<'all' | 'image' | 'video'>('all')
  const [importantFilter, setImportantFilter] = useState<'all' | 'important' | 'other'>('all')
  const [query, setQuery] = useState('')
  const [renamingPath, setRenamingPath] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renameError, setRenameError] = useState<string | null>(null)

  // Reloads the list without flashing the spinner over the existing grid — the
  // initial `loading` state covers first paint; later refreshes (events, rename)
  // update in place so a focused rename input isn't ripped out mid-edit.
  const refresh = useCallback(() => {
    ipc.listCaptures()
      .then((list) => { setCaptures(list); setLoading(false) })
      .catch((e) => { console.error(e); setLoading(false) })
  }, [setCaptures])

  useEffect(() => { refresh() }, [refresh])

  // Card elements by path, so the focused one can be scrolled into view. Keyed
  // by path rather than queried from the DOM because a Windows path is full of
  // characters a CSS selector would choke on.
  const cardRefs = useRef(new Map<string, HTMLDivElement>())

  const unlistenRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    listen<void>('capture-saved', () => refresh()).then(fn => { unlistenRef.current = fn })
    return () => { unlistenRef.current?.() }
  }, [refresh])

  const executeDeleteSelected = useCallback(() => {
    const toDelete = new Set(selectedPaths)
    setSelectedPaths(new Set())
    setConfirmDeleteSelection(false)
    setConfirmDeletePath(null)
    setCaptures(captures.filter(c => !toDelete.has(c.path)))
    toDelete.forEach(path => ipc.deleteCapture(path).catch(console.error))
  }, [selectedPaths, captures, setCaptures])

  // Same reasoning as in the editor: the global hook can't be relied on while a
  // Clipse window is focused, and this window is focused for exactly as long as
  // the user is looking for something to capture. Errors go to the console —
  // the gallery has no toast host of its own.
  usePrintScreenKey('gallery', (message) => console.error('[gallery] capture', message))

  const handleCardClick = useCallback((entry: CaptureEntry, e: React.MouseEvent) => {
    if (confirmDeletePath === entry.path) { setConfirmDeletePath(null); return }
    // Clicking also moves the keyboard cursor, so an arrow key afterwards
    // continues from what was just clicked rather than from wherever the cursor
    // happened to be left.
    setFocusedPath(entry.path)
    if (e.ctrlKey || e.metaKey) {
      setSelectedPaths(prev => {
        const next = new Set(prev)
        if (next.has(entry.path)) next.delete(entry.path)
        else next.add(entry.path)
        return next
      })
    } else {
      setSelectedPaths(new Set([entry.path]))
    }
  }, [confirmDeletePath])

  const handleOpen = useCallback((entry: CaptureEntry) => {
    ipc.openCaptureInEditor(entry.path).catch(console.error)
  }, [])

  const handleOpenFile = useCallback((entry: CaptureEntry) => {
    ipc.openFile(entry.path).catch(console.error)
  }, [])

  /** What double-click and Enter both do: the editor for an image, the OS
   *  player for a video (which the annotation editor can't open). */
  const handleActivate = useCallback((entry: CaptureEntry) => {
    if (entry.file_type === 'video') handleOpenFile(entry)
    else handleOpen(entry)
  }, [handleOpen, handleOpenFile])

  const handleDeleteConfirmed = useCallback((entry: CaptureEntry) => {
    setConfirmDeletePath(null)
    setCaptures(captures.filter(c => c.path !== entry.path))
    setSelectedPaths(prev => { const next = new Set(prev); next.delete(entry.path); return next })
    ipc.deleteCapture(entry.path).catch(console.error)
  }, [captures, setCaptures])

  const handleCopyPath = useCallback((entry: CaptureEntry) => {
    navigator.clipboard.writeText(entry.path).then(() => {
      setCopiedPath(entry.path)
      setTimeout(() => setCopiedPath(null), 1500)
    }).catch(console.error)
  }, [])

  const handleCopyImage = useCallback((entry: CaptureEntry) => {
    ipc.copyCaptureToClipboard(entry.path).then(() => {
      setCopiedImagePath(entry.path)
      setTimeout(() => setCopiedImagePath(null), 1500)
    }).catch(console.error)
  }, [])

  const handlePin = useCallback((entry: CaptureEntry) => {
    ipc.pinCaptureByPath(entry.path).catch(console.error)
  }, [])

  const handleToggleFavorite = useCallback((entry: CaptureEntry, e: React.MouseEvent) => {
    e.stopPropagation()
    const next = !entry.favorite
    setCaptures(captures.map(c => c.path === entry.path ? { ...c, favorite: next } : c))
    ipc.toggleFavorite(entry.path).catch(console.error)
  }, [captures, setCaptures])

  // Videos can't go on the clipboard as an image — copy the file itself
  // (CF_HDROP), pasteable into Explorer / chat apps.
  const handleCopyFile = useCallback((entry: CaptureEntry) => {
    ipc.copyFileToClipboard(entry.path).then(() => {
      setCopiedFilePath(entry.path)
      setTimeout(() => setCopiedFilePath(null), 1500)
    }).catch(console.error)
  }, [])

  /** What the card's Copy button does, whichever type it is: an image goes on
   *  the clipboard as a bitmap, a video as the file itself. */
  const handleCopyEntry = useCallback((entry: CaptureEntry) => {
    if (entry.file_type === 'video') handleCopyFile(entry)
    else handleCopyImage(entry)
  }, [handleCopyFile, handleCopyImage])

  const handleNewCapture = useCallback(() => {
    // The gallery is hidden Rust-side inside open_region_overlay, *before* it
    // snapshots the desktop for the overlay background — hiding it here first
    // would make Rust see it as already-hidden and skip its compositing wait,
    // letting the still-painted gallery leak into the frozen frame.
    ipc.openRegionOverlay().catch(console.error)
  }, [])

  const handleOpenFolder = useCallback(() => {
    ipc.openCapturesFolder().catch(console.error)
  }, [])

  // ── Inline rename ──
  const startRename = useCallback((entry: CaptureEntry, e: React.MouseEvent) => {
    e.stopPropagation()
    setRenamingPath(entry.path)
    setRenameValue(entry.filename.replace(/\.[^.]+$/, ''))
    setRenameError(null)
  }, [])

  const cancelRename = useCallback(() => {
    setRenamingPath(null)
    setRenameError(null)
  }, [])

  const commitRename = useCallback(async (entry: CaptureEntry) => {
    const stem = renameValue.trim()
    const currentStem = entry.filename.replace(/\.[^.]+$/, '')
    if (!stem || stem === currentStem) { cancelRename(); return }
    try {
      await ipc.renameCapture(entry.path, stem)
      cancelRename()
      refresh()
    } catch (err) {
      setRenameError(String(err))
    }
  }, [renameValue, cancelRename, refresh])

  // ── Type + importance + filename filtering ──
  const q = query.trim().toLowerCase()
  const visibleCaptures = captures.filter((c) =>
    (typeFilter === 'all' || c.file_type === typeFilter) &&
    (importantFilter === 'all' || (importantFilter === 'important' ? c.favorite : !c.favorite)) &&
    (q === '' || c.filename.toLowerCase().includes(q))
  )
  const imageCount = captures.filter((c) => c.file_type === 'image').length
  const videoCount = captures.length - imageCount
  const importantCount = captures.filter((c) => c.favorite).length
  const otherCount = captures.length - importantCount

  // ── Keyboard navigation ──
  //
  // Declared after the handlers and after `visibleCaptures` on purpose: the deps
  // array is evaluated during render, so anything it names has to already exist.

  /** Moves the cursor by `delta` cards through `visibleCaptures` and selects
   *  where it lands. Starting cold (nothing focused, or the focused card
   *  filtered away) enters at the first or last card depending on direction, so
   *  the very first arrow press always lands somewhere sensible. */
  const moveFocus = useCallback((delta: number) => {
    if (visibleCaptures.length === 0) return
    const current = visibleCaptures.findIndex((c) => c.path === focusedPath)
    const next = current === -1
      ? (delta > 0 ? 0 : visibleCaptures.length - 1)
      : Math.min(Math.max(current + delta, 0), visibleCaptures.length - 1)
    const entry = visibleCaptures[next]
    setFocusedPath(entry.path)
    setSelectedPaths(new Set([entry.path]))
  }, [visibleCaptures, focusedPath])

  /** The card a single-target shortcut (copy, copy path, pin) acts on: the
   *  keyboard cursor, or the one selected card when the cursor hasn't been
   *  placed. Clicking a card sets both, so the fallback only matters after a
   *  Ctrl+click or Ctrl+A — and with several selected there is no single
   *  sensible target, so those shortcuts simply don't fire. */
  const shortcutTarget = useCallback((): CaptureEntry | null => {
    const focused = visibleCaptures.find((c) => c.path === focusedPath)
    if (focused) return focused
    if (selectedPaths.size !== 1) return null
    const [only] = selectedPaths
    return visibleCaptures.find((c) => c.path === only) ?? null
  }, [visibleCaptures, focusedPath, selectedPaths])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // While typing (rename input), leave every key to the input — Ctrl+A
      // must select the text, Delete must delete a character, etc.
      const t = e.target
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return

      // Match on e.code (physical key): with the Japanese IME active e.key
      // reports 'Process' instead of 'a', and CapsLock turns it into 'A'.
      const ctrl = e.ctrlKey || e.metaKey

      // `?` opens the shortcut list. The header lost its Help button, so this
      // is the only way in — same key as the editor's. Matched on the character
      // as well as Shift+Slash, for layouts that put `?` elsewhere.
      if (!ctrl && (e.key === '?' || (e.shiftKey && e.code === 'Slash'))) {
        e.preventDefault()
        setShowHelp((v) => !v)
        return
      }

      if (ctrl && e.code === 'KeyA') {
        e.preventDefault()
        setSelectedPaths(new Set(captures.map(c => c.path)))
      // Ctrl+Shift+C copies the path (Windows Explorer's own binding for it),
      // plain Ctrl+C copies the capture. Shift is tested first because the
      // Ctrl+C branch below doesn't look at it. Both mirror the buttons on the
      // card exactly, feedback tick included.
      } else if (ctrl && e.shiftKey && e.code === 'KeyC') {
        const entry = shortcutTarget()
        if (entry) { e.preventDefault(); handleCopyPath(entry) }
      } else if (ctrl && e.code === 'KeyC') {
        const entry = shortcutTarget()
        if (entry) { e.preventDefault(); handleCopyEntry(entry) }
      } else if (ctrl && e.code === 'KeyP') {
        // Pin is image-only, like the card action — there is no Pin button on a
        // video card, and a floating always-on-top video isn't what it does.
        const entry = shortcutTarget()
        if (entry && entry.file_type !== 'video') { e.preventDefault(); handlePin(entry) }
      } else if (e.key === 'Delete' && selectedPaths.size > 0 && !confirmDeleteSelection) {
        setConfirmDeleteSelection(true)
      } else if (e.key === 'Enter' && confirmDeleteSelection) {
        // A pending delete owns Enter until it's answered.
        executeDeleteSelected()
      } else if (e.key === 'Enter') {
        const entry = visibleCaptures.find((c) => c.path === focusedPath)
        if (entry) { e.preventDefault(); handleActivate(entry) }
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft'
              || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (confirmDeleteSelection) return
        e.preventDefault() // otherwise the grid also scrolls under the cursor
        // Up/Down move a whole row. GRID_COLUMNS mirrors `.grid`'s
        // `grid-template-columns: repeat(4, 1fr)` in Gallery.module.css —
        // change one and the other has to follow.
        const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1
        moveFocus(e.key === 'ArrowUp' || e.key === 'ArrowDown' ? step * GRID_COLUMNS : step)
      } else if (e.key === 'Home' || e.key === 'End') {
        if (confirmDeleteSelection || visibleCaptures.length === 0) return
        e.preventDefault()
        const entry = visibleCaptures[e.key === 'Home' ? 0 : visibleCaptures.length - 1]
        setFocusedPath(entry.path)
        setSelectedPaths(new Set([entry.path]))
      } else if (e.key === 'Escape') {
        // Cascades outward: dismiss whatever is open, then drop the selection,
        // and only with nothing left to cancel does Escape close the window.
        // Without the steps in between, one Escape would both clear a selection
        // and hide the gallery.
        if (showHelp) {
          // HelpModal has its own window-level Escape listener and closes
          // itself; both fire, so bail out or the gallery goes too.
          return
        }
        if (confirmDeleteSelection) setConfirmDeleteSelection(false)
        else if (confirmDeletePath) setConfirmDeletePath(null)
        else if (selectedPaths.size > 0 || focusedPath) {
          setSelectedPaths(new Set())
          setFocusedPath(null)
        } else {
          // Hidden, not closed — the app is tray-resident and the window is
          // reused, the same thing its own close button ends up doing.
          getCurrentWebviewWindow().hide().catch(console.error)
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedPaths, confirmDeleteSelection, confirmDeletePath, showHelp,
      executeDeleteSelected, captures,
      visibleCaptures, focusedPath, moveFocus, handleActivate,
      shortcutTarget, handleCopyEntry, handleCopyPath, handlePin])

  // Keep the cursor on screen when arrowing past the visible rows. `nearest`
  // scrolls the minimum needed, so moving within the viewport doesn't jump.
  useEffect(() => {
    if (!focusedPath) return
    cardRefs.current.get(focusedPath)?.scrollIntoView({ block: 'nearest' })
  }, [focusedPath])

  return (
    <div className={styles.root}>
      {/* ── Header (drag region) ── */}
      {/* Button clicks must not leave focus behind. The window is hidden rather
          than destroyed, so the webview restores focus to the last-focused
          element when it reopens — click ✕, reopen from the tray, press an
          arrow key, and Chromium switches to keyboard modality and paints the
          :focus-visible ring on that stale ✕. The editor header does the same.
          Only presses on a button are cancelled, so dragging the window still
          works. */}
      <header
        className={styles.header}
        data-tauri-drag-region
        onMouseDown={(e) => {
          if ((e.target as HTMLElement).closest('button')) e.preventDefault()
        }}
      >
        <div className={styles.headerLeft} data-tauri-drag-region>
          <img src="/icon.png" className={styles.logo} alt="" draggable={false} data-tauri-drag-region />
          <span className={styles.title} data-tauri-drag-region>Clipse</span>
          {selectedPaths.size > 1 && (
            <span className={styles.selectionBadge}>{selectedPaths.size} selected</span>
          )}
        </div>
        {/* Capture, Record and Settings used to sit here too. They are all on
            the quick menu (and the tray), which is the point of that menu —
            this header is for what only the gallery can do. Help has no button
            left, so `?` opens it, the same key the editor uses. */}
        <div className={styles.headerRight}>
          <button className={styles.headerBtn} onClick={handleOpenFolder} title="Open saves folder">
            <Folder size={14} strokeWidth={1.5} />
            <span>Folder</span>
          </button>
          <button
            className={styles.closeBtn}
            onClick={() => getCurrentWebviewWindow().hide()}
            title="Close (Esc)"
          >
            <X size={13} strokeWidth={2} />
          </button>
        </div>
      </header>

      {/* ── Filter / search bar ── */}
      {!loading && captures.length > 0 && (
        <div className={styles.filterBar}>
          <div className={styles.typeToggle}>
            <button
              className={`${styles.typeBtn} ${typeFilter === 'all' ? styles.typeActive : ''}`}
              onClick={() => setTypeFilter('all')}
              title="Show all"
            >
              <LayoutGrid size={13} strokeWidth={1.5} /> All
              <span className={styles.typeCount}>{captures.length}</span>
            </button>
            <button
              className={`${styles.typeBtn} ${typeFilter === 'image' ? styles.typeActive : ''}`}
              onClick={() => setTypeFilter('image')}
              title="Images only"
            >
              <ImageIcon size={13} strokeWidth={1.5} /> Images
              <span className={styles.typeCount}>{imageCount}</span>
            </button>
            <button
              className={`${styles.typeBtn} ${typeFilter === 'video' ? styles.typeActive : ''}`}
              onClick={() => setTypeFilter('video')}
              title="Videos only"
            >
              <Film size={13} strokeWidth={1.5} /> Videos
              <span className={styles.typeCount}>{videoCount}</span>
            </button>
          </div>
          <div className={styles.typeToggle}>
            <button
              className={`${styles.typeBtn} ${importantFilter === 'all' ? styles.typeActive : ''}`}
              onClick={() => setImportantFilter('all')}
              title="Show all"
            >
              All
            </button>
            <button
              className={`${styles.typeBtn} ${importantFilter === 'important' ? styles.typeActive : ''}`}
              onClick={() => setImportantFilter('important')}
              title="Important only"
            >
              <Star size={13} strokeWidth={1.5} /> Important
              <span className={styles.typeCount}>{importantCount}</span>
            </button>
            <button
              className={`${styles.typeBtn} ${importantFilter === 'other' ? styles.typeActive : ''}`}
              onClick={() => setImportantFilter('other')}
              title="Everything else"
            >
              Other
              <span className={styles.typeCount}>{otherCount}</span>
            </button>
          </div>
          <div className={styles.searchBox}>
            <Search size={13} strokeWidth={1.5} className={styles.searchIcon} />
            <input
              className={styles.searchInput}
              type="text"
              placeholder="Filter by filename"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button className={styles.searchClear} onClick={() => setQuery('')} title="Clear">
                <X size={12} strokeWidth={2} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Delete confirmation bar ── */}
      {confirmDeleteSelection && (
        <div className={styles.deleteBar}>
          <Trash2 size={13} strokeWidth={1.5} style={{ color: 'var(--color-danger)', flexShrink: 0 }} />
          <span className={styles.deleteBarText}>
            Delete {selectedPaths.size === 1 ? '1 item' : `${selectedPaths.size} items`}?
          </span>
          <div className={styles.deleteBarActions}>
            <button
              className={`${styles.iconBtn} ${styles.iconBtnCancel}`}
              onClick={() => setConfirmDeleteSelection(false)}
              title="Cancel (Esc)"
            >
              <X size={12} strokeWidth={2} />
              <span>Cancel</span>
            </button>
            <button
              className={`${styles.iconBtn} ${styles.iconBtnConfirmDelete}`}
              onClick={executeDeleteSelected}
              title="Confirm delete (Enter)"
            >
              <Trash2 size={12} strokeWidth={1.5} />
              <span>Delete</span>
            </button>
          </div>
        </div>
      )}

      {/* ── Gallery grid ── */}
      <main className={styles.main}>
        {loading ? (
          <div className={styles.empty}>
            <Loader2 size={20} strokeWidth={1.5} style={{ color: 'var(--color-text-faint)', animation: 'spin 1s linear infinite' }} />
          </div>
        ) : captures.length === 0 ? (
          <div className={styles.empty}>
            <FolderOpen size={36} strokeWidth={1} style={{ color: 'var(--color-text-faint)' }} />
            <p className={styles.emptyText}>No captures yet</p>
            <p className={styles.emptyHint}>Press PrintScreen to capture</p>
            <button className={styles.emptyBtn} onClick={handleNewCapture} title="New capture">
              <Camera size={14} strokeWidth={1.5} />
              Capture
            </button>
          </div>
        ) : visibleCaptures.length === 0 ? (
          <div className={styles.empty}>
            <Search size={32} strokeWidth={1} style={{ color: 'var(--color-text-faint)' }} />
            <p className={styles.emptyText}>No matches</p>
            <p className={styles.emptyHint}>Try a different filter or search term</p>
          </div>
        ) : (
          <div className={styles.grid}>
            {visibleCaptures.map((entry) => (
              <div
                key={entry.path}
                ref={(el) => {
                  if (el) cardRefs.current.set(entry.path, el)
                  else cardRefs.current.delete(entry.path)
                }}
                className={`${styles.card} ${selectedPaths.has(entry.path) ? styles.cardSelected : ''} ${confirmDeletePath === entry.path ? styles.cardConfirming : ''}`}
                onClick={(e) => handleCardClick(entry, e)}
                onDoubleClick={() => handleActivate(entry)}
              >
                <div className={styles.thumb}>
                  {entry.favorite && (
                    <div className={styles.favoriteBadge} title="Important">
                      <Star size={11} strokeWidth={1.5} fill="currentColor" />
                    </div>
                  )}
                  {entry.thumbnail_base64 ? (
                    <img
                      src={`data:image/png;base64,${entry.thumbnail_base64}`}
                      alt={entry.filename}
                      className={styles.thumbImg}
                      loading="lazy"
                      draggable={false}
                    />
                  ) : (
                    <div className={styles.videoPlaceholder}>
                      <Film size={32} strokeWidth={1} />
                    </div>
                  )}
                  {entry.file_type === 'video' ? (
                    <>
                      <div className={styles.videoPlayOverlay}>
                        <Play size={20} strokeWidth={1.5} fill="currentColor" />
                      </div>
                      <div className={styles.videoBadge}>
                        <Film size={10} strokeWidth={1.5} /> VIDEO
                      </div>
                    </>
                  ) : (
                    <div className={styles.editHintOverlay}>
                      <Edit3 size={16} strokeWidth={1.5} />
                      <span>Double-click to edit</span>
                    </div>
                  )}
                </div>
                {confirmDeletePath === entry.path ? (
                  <div className={styles.deleteConfirm}>
                    <Trash2 size={12} strokeWidth={1.5} style={{ color: 'var(--color-danger)', flexShrink: 0 }} />
                    <span className={styles.deleteConfirmText}>Delete?</span>
                    <div className={styles.deleteConfirmActions}>
                      <button
                        className={`${styles.iconBtn} ${styles.iconBtnCancel}`}
                        title="Cancel"
                        onClick={(e) => { e.stopPropagation(); setConfirmDeletePath(null) }}
                      >
                        <X size={12} strokeWidth={2} />
                      </button>
                      <button
                        className={`${styles.iconBtn} ${styles.iconBtnConfirmDelete}`}
                        title="Confirm delete"
                        onClick={(e) => { e.stopPropagation(); handleDeleteConfirmed(entry) }}
                      >
                        <Check size={12} strokeWidth={2} />
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className={styles.cardMeta}>
                      {renamingPath === entry.path ? (
                        <div className={styles.renameRow} onClick={(e) => e.stopPropagation()}>
                          <input
                            className={`${styles.renameInput} ${renameError ? styles.renameInputError : ''}`}
                            value={renameValue}
                            autoFocus
                            title={renameError ?? undefined}
                            onChange={(e) => { setRenameValue(e.target.value); setRenameError(null) }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') { e.preventDefault(); commitRename(entry) }
                              else if (e.key === 'Escape') { e.preventDefault(); cancelRename() }
                            }}
                            onBlur={cancelRename}
                          />
                          <span className={styles.renameExt}>{entry.filename.match(/\.[^.]+$/)?.[0] ?? ''}</span>
                        </div>
                      ) : (
                        <div className={styles.filenameRow}>
                          <span className={styles.cardFilename} title={entry.filename}>
                            {entry.filename}
                          </span>
                          <button
                            className={styles.renameBtn}
                            title="Rename"
                            onClick={(e) => startRename(entry, e)}
                          >
                            <Pencil size={11} strokeWidth={1.5} />
                          </button>
                        </div>
                      )}
                      <div className={styles.cardMetaRow}>
                        <span className={styles.cardDate}>
                          {new Date(entry.created_at * 1000).toLocaleString(undefined, {
                            month: '2-digit', day: '2-digit',
                            hour: '2-digit', minute: '2-digit',
                            hour12: false,
                          })}
                        </span>
                        {entry.file_type !== 'video' && (
                          <span className={styles.cardSize}>
                            {entry.width}×{entry.height}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className={styles.cardActions}>
                      <button
                        className={`${styles.iconBtn} ${entry.favorite ? styles.iconBtnFavorite : ''}`}
                        title={entry.favorite ? 'Unmark important' : 'Mark important'}
                        onClick={(e) => handleToggleFavorite(entry, e)}
                      >
                        <Star size={12} strokeWidth={1.5} fill={entry.favorite ? 'currentColor' : 'none'} />
                      </button>
                      {entry.file_type === 'video' ? (
                        <>
                          <button
                            className={styles.iconBtn}
                            title="Open in player"
                            onClick={(e) => { e.stopPropagation(); handleOpenFile(entry) }}
                          >
                            <Play size={12} strokeWidth={1.5} />
                          </button>
                          <button
                            className={`${styles.iconBtn} ${copiedFilePath === entry.path ? styles.iconBtnCopied : ''}`}
                            title="Copy file (Ctrl+C)"
                            onClick={(e) => { e.stopPropagation(); handleCopyFile(entry) }}
                          >
                            {copiedFilePath === entry.path
                              ? <Check size={12} strokeWidth={2.5} />
                              : <Copy size={12} strokeWidth={1.5} />}
                          </button>
                          <button
                            className={`${styles.iconBtn} ${copiedPath === entry.path ? styles.iconBtnCopied : ''}`}
                            title="Copy path (Ctrl+Shift+C)"
                            onClick={(e) => { e.stopPropagation(); handleCopyPath(entry) }}
                          >
                            {copiedPath === entry.path
                              ? <Check size={12} strokeWidth={2.5} />
                              : <Link2 size={12} strokeWidth={1.5} />}
                          </button>
                          <button
                            className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                            title="Delete"
                            onClick={(e) => { e.stopPropagation(); setConfirmDeletePath(entry.path) }}
                          >
                            <Trash2 size={12} strokeWidth={1.5} />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            className={`${styles.iconBtn} ${copiedImagePath === entry.path ? styles.iconBtnCopied : ''}`}
                            title="Copy image (Ctrl+C)"
                            onClick={(e) => { e.stopPropagation(); handleCopyImage(entry) }}
                          >
                            {copiedImagePath === entry.path
                              ? <Check size={12} strokeWidth={2.5} />
                              : <Copy size={12} strokeWidth={1.5} />}
                          </button>
                          <button
                            className={`${styles.iconBtn} ${copiedPath === entry.path ? styles.iconBtnCopied : ''}`}
                            title="Copy path (Ctrl+Shift+C)"
                            onClick={(e) => { e.stopPropagation(); handleCopyPath(entry) }}
                          >
                            {copiedPath === entry.path
                              ? <Check size={12} strokeWidth={2.5} />
                              : <Link2 size={12} strokeWidth={1.5} />}
                          </button>
                          <button
                            className={styles.iconBtn}
                            title="Pin to screen (Ctrl+P)"
                            onClick={(e) => { e.stopPropagation(); handlePin(entry) }}
                          >
                            <PinIcon size={12} strokeWidth={1.5} />
                          </button>
                          <button
                            className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                            title="Delete"
                            onClick={(e) => { e.stopPropagation(); setConfirmDeletePath(entry.path) }}
                          >
                            <Trash2 size={12} strokeWidth={1.5} />
                          </button>
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </main>

      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
    </div>
  )
}
