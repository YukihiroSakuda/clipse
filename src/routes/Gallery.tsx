import { useCallback, useEffect, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { Camera, Check, ClipboardCopy, Copy, Edit3, Film, Folder, FolderOpen, HelpCircle, Loader2, Play, ScanText, Settings as SettingsIcon, StopCircle, Trash2, X } from 'lucide-react'
import { ipc } from '../lib/ipc'
import type { CaptureEntry } from '../lib/ipc'
import { useStore } from '../lib/store'
import HelpModal from '../components/HelpModal'
import styles from './Gallery.module.css'

export default function Gallery() {
  const { captures, setCaptures } = useStore()
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [confirmDeletePath, setConfirmDeletePath] = useState<string | null>(null)
  const [confirmDeleteSelection, setConfirmDeleteSelection] = useState(false)
  const [copiedPath, setCopiedPath] = useState<string | null>(null)
  const [copiedImagePath, setCopiedImagePath] = useState<string | null>(null)
  const [showHelp, setShowHelp] = useState(false)
  const [isRecording, setIsRecording] = useState(false)

  const refresh = useCallback(() => {
    setLoading(true)
    ipc.listCaptures()
      .then((list) => { setCaptures(list); setLoading(false) })
      .catch((e) => { console.error(e); setLoading(false) })
  }, [setCaptures])

  useEffect(() => { refresh() }, [refresh])

  useEffect(() => {
    ipc.isRecording().then(setIsRecording).catch(console.error)
  }, [])

  const handleOpenRecorder = useCallback(async () => {
    try {
      await ipc.openRecorder()
    } catch (e) {
      console.error('open_recorder:', e)
    }
  }, [])

  const handleStopRecording = useCallback(async () => {
    try {
      await ipc.stopRecording()
      setIsRecording(false)
      refresh()
    } catch (e) {
      console.error('stop_recording:', e)
      setIsRecording(false)
    }
  }, [refresh])

  const unlistenRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    listen<void>('capture-saved', () => refresh()).then(fn => { unlistenRef.current = fn })
    return () => { unlistenRef.current?.() }
  }, [refresh])

  // The screenshot hotkeys can stop a recording on the Rust side (e.g. one
  // started from this button) without going through handleStopRecording.
  const unlistenRecordingRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    listen<string>('recording-stopped', () => setIsRecording(false))
      .then(fn => { unlistenRecordingRef.current = fn })
    return () => { unlistenRecordingRef.current?.() }
  }, [])

  const executeDeleteSelected = useCallback(() => {
    const toDelete = new Set(selectedPaths)
    setSelectedPaths(new Set())
    setConfirmDeleteSelection(false)
    setConfirmDeletePath(null)
    setCaptures(captures.filter(c => !toDelete.has(c.path)))
    toDelete.forEach(path => ipc.deleteCapture(path).catch(console.error))
  }, [selectedPaths, captures, setCaptures])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault()
        setSelectedPaths(new Set(captures.map(c => c.path)))
      } else if (e.key === 'Delete' && selectedPaths.size > 0 && !confirmDeleteSelection) {
        setConfirmDeleteSelection(true)
      } else if (e.key === 'Enter' && confirmDeleteSelection) {
        executeDeleteSelected()
      } else if (e.key === 'Escape') {
        if (confirmDeleteSelection) setConfirmDeleteSelection(false)
        else setSelectedPaths(new Set())
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedPaths, confirmDeleteSelection, executeDeleteSelected, captures])

  const handleCardClick = useCallback((entry: CaptureEntry, e: React.MouseEvent) => {
    if (confirmDeletePath === entry.path) { setConfirmDeletePath(null); return }
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

  const handleNewCapture = useCallback(() => {
    ipc.openRegionOverlay().catch(console.error)
  }, [])

  const handleOpenFolder = useCallback(() => {
    ipc.openCapturesFolder().catch(console.error)
  }, [])

  const handleOpenSettings = useCallback(() => {
    ipc.openSettings().catch(console.error)
  }, [])

  return (
    <div className={styles.root}>
      {/* ── Header (drag region) ── */}
      <header className={styles.header} data-tauri-drag-region>
        <div className={styles.headerLeft} data-tauri-drag-region>
          <img src="/icon.png" className={styles.logo} alt="" draggable={false} data-tauri-drag-region />
          <span className={styles.title} data-tauri-drag-region>Clipse</span>
          {!loading && captures.length > 0 && (
            <span className={styles.count}>{captures.length}</span>
          )}
          {selectedPaths.size > 1 && (
            <span className={styles.selectionBadge}>{selectedPaths.size} selected</span>
          )}
        </div>
        <div className={styles.headerRight}>
          <button className={styles.headerBtn} onClick={handleNewCapture} title="New capture">
            <Camera size={14} strokeWidth={1.5} />
          </button>
          <button
            className={`${styles.headerBtn} ${isRecording ? styles.headerBtnRecording : ''}`}
            onClick={isRecording ? handleStopRecording : handleOpenRecorder}
            title={isRecording ? 'Stop recording' : 'Record screen…'}
          >
            {isRecording
              ? <StopCircle size={14} strokeWidth={1.5} />
              : <Film size={14} strokeWidth={1.5} />}
          </button>
          <button className={styles.headerBtn} onClick={handleOpenFolder} title="Open saves folder">
            <Folder size={14} strokeWidth={1.5} />
          </button>
          <button className={styles.headerBtn} onClick={handleOpenSettings} title="Settings">
            <SettingsIcon size={14} strokeWidth={1.5} />
          </button>
          <button className={styles.headerBtn} onClick={() => setShowHelp(true)} title="Help / shortcuts">
            <HelpCircle size={14} strokeWidth={1.5} />
          </button>
          <button className={styles.closeBtn} onClick={() => getCurrentWebviewWindow().hide()} title="Close">
            <X size={13} strokeWidth={2} />
          </button>
        </div>
      </header>

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
        ) : (
          <div className={styles.grid}>
            {captures.map((entry) => (
              <div
                key={entry.path}
                className={`${styles.card} ${selectedPaths.has(entry.path) ? styles.cardSelected : ''} ${confirmDeletePath === entry.path ? styles.cardConfirming : ''}`}
                onClick={(e) => handleCardClick(entry, e)}
                onDoubleClick={() => entry.file_type === 'video' ? handleOpenFile(entry) : handleOpen(entry)}
              >
                <div className={styles.thumb}>
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
                  {entry.file_type === 'video' && (
                    <div className={styles.videoBadge}>
                      <Film size={10} strokeWidth={1.5} />
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
                      <span className={styles.cardFilename} title={entry.filename}>
                        {entry.filename}
                      </span>
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
                            className={`${styles.iconBtn} ${copiedPath === entry.path ? styles.iconBtnCopied : ''}`}
                            title="Copy path"
                            onClick={(e) => { e.stopPropagation(); handleCopyPath(entry) }}
                          >
                            {copiedPath === entry.path
                              ? <Check size={12} strokeWidth={2.5} />
                              : <Copy size={12} strokeWidth={1.5} />}
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
                            className={styles.iconBtn}
                            title="Open in editor"
                            onClick={(e) => { e.stopPropagation(); handleOpen(entry) }}
                          >
                            <Edit3 size={12} strokeWidth={1.5} />
                          </button>
                          <button
                            className={styles.iconBtn}
                            title="OCR"
                            onClick={(e) => { e.stopPropagation(); handleOpen(entry) }}
                          >
                            <ScanText size={12} strokeWidth={1.5} />
                          </button>
                          <button
                            className={`${styles.iconBtn} ${copiedImagePath === entry.path ? styles.iconBtnCopied : ''}`}
                            title="Copy image"
                            onClick={(e) => { e.stopPropagation(); handleCopyImage(entry) }}
                          >
                            {copiedImagePath === entry.path
                              ? <Check size={12} strokeWidth={2.5} />
                              : <ClipboardCopy size={12} strokeWidth={1.5} />}
                          </button>
                          <button
                            className={`${styles.iconBtn} ${copiedPath === entry.path ? styles.iconBtnCopied : ''}`}
                            title="Copy path"
                            onClick={(e) => { e.stopPropagation(); handleCopyPath(entry) }}
                          >
                            {copiedPath === entry.path
                              ? <Check size={12} strokeWidth={2.5} />
                              : <Copy size={12} strokeWidth={1.5} />}
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
