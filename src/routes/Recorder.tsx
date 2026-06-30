import { useCallback, useEffect, useRef, useState } from 'react'
import { Circle, Film, Image as ImageIcon, Loader2, Monitor, Square, X } from 'lucide-react'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { currentMonitor } from '@tauri-apps/api/window'
import { listen } from '@tauri-apps/api/event'
import { LogicalSize, PhysicalPosition } from '@tauri-apps/api/dpi'
import { ipc, AppSettings, RecordingMonitorInfo } from '../lib/ipc'
import styles from './Recorder.module.css'

const MINI_W = 220
const MINI_H = 52
const FULL_W = 540
const FULL_H = 210

const GIF_FPS_OPTIONS = [5, 10, 12, 15, 20] as const

type Format = 'mp4' | 'gif'
type Phase = 'idle' | 'recording' | 'finishing' | 'done' | 'error'

function positionLabel(monitors: RecordingMonitorInfo[], m: RecordingMonitorInfo): string {
  if (monitors.length <= 1) return ''
  const sorted = [...monitors].sort((a, b) => a.x - b.x)
  const xi = sorted.findIndex((s) => s.index === m.index)
  if (sorted.length === 2) return xi === 0 ? 'Left' : 'Right'
  if (xi === 0) return 'Left'
  if (xi === sorted.length - 1) return 'Right'
  return 'Center'
}

function fmtElapsed(ms: number): string {
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** Tucks the (already-resized) window into its monitor's bottom-right corner.
 * The mini bar stays visible and on top while recording (excluded from the
 * capture on the Rust side), so it shouldn't sit in the middle of the screen
 * blocking whatever's being recorded. */
async function tuckIntoCorner(win: ReturnType<typeof getCurrentWebviewWindow>) {
  const monitor = await currentMonitor().catch(() => null)
  if (!monitor) return
  const margin = 16 * monitor.scaleFactor
  const x = monitor.position.x + monitor.size.width - MINI_W * monitor.scaleFactor - margin
  const y = monitor.position.y + monitor.size.height - MINI_H * monitor.scaleFactor - margin
  await win.setPosition(new PhysicalPosition(Math.round(x), Math.round(y))).catch(() => {})
}

export default function Recorder() {
  const [format, setFormat] = useState<Format>('mp4')
  const [phase, setPhase] = useState<Phase>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [message, setMessage] = useState('')
  const [monitors, setMonitors] = useState<RecordingMonitorInfo[]>([])
  const [monitorIndex, setMonitorIndex] = useState<number>(0)
  const [gifFps, setGifFps] = useState<number>(12)
  const [minimized, setMinimized] = useState(false)
  const settingsRef = useRef<AppSettings | null>(null)
  const startedAt = useRef(0)
  const timerRef = useRef<number | null>(null)
  const phaseRef = useRef<Phase>('idle')
  useEffect(() => { phaseRef.current = phase }, [phase])

  useEffect(() => {
    let cancelled = false

    const init = async () => {
      const [list, settings] = await Promise.all([
        ipc.listRecordingMonitors().catch(() => [] as RecordingMonitorInfo[]),
        ipc.getSettings().catch(() => null),
      ])
      if (cancelled) return

      setMonitors(list)
      const primary = list.find((m) => m.is_primary)
      const idx = primary?.index ?? (list[0]?.index ?? 0)
      setMonitorIndex(idx)

      let fmt: Format = 'mp4'
      if (settings) {
        settingsRef.current = settings
        if (settings.recording.format === 'gif') fmt = 'gif'
        setFormat(fmt)
        setGifFps(settings.recording.gif_fps)
      }

      // If a recording was already started elsewhere (e.g. Gallery button),
      // attach to it so this window shows the timer.
      const alreadyRecording = await ipc.isRecording().catch(() => false)
      if (cancelled) return

      if (alreadyRecording) {
        beginTimer()
        setMinimized(true)
        const win = getCurrentWebviewWindow()
        await win.setSize(new LogicalSize(MINI_W, MINI_H))
        await tuckIntoCorner(win)
        await win.setFocus()
      }
    }

    init()
    return () => {
      cancelled = true
      if (timerRef.current) window.clearInterval(timerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleGifFpsChange = useCallback(async (fps: number) => {
    setGifFps(fps)
    const s = settingsRef.current
    if (!s) return
    const updated = { ...s, recording: { ...s.recording, gif_fps: fps } }
    settingsRef.current = updated
    await ipc.updateSettings(updated).catch(() => {})
  }, [])

  const beginTimer = useCallback(() => {
    setPhase('recording')
    startedAt.current = Date.now()
    setElapsed(0)
    if (timerRef.current) window.clearInterval(timerRef.current)
    timerRef.current = window.setInterval(() => {
      setElapsed(Date.now() - startedAt.current)
    }, 250)
  }, [])

  const stopTimer = useCallback(() => {
    if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null }
  }, [])

  const handleStart = useCallback(async () => {
    setMessage('')
    try {
      await ipc.startRecording(format, monitorIndex || undefined)
      beginTimer()
      setMinimized(true)
      const win = getCurrentWebviewWindow()
      // The Rust side excludes this window from the capture itself (Windows
      // WDA_EXCLUDEFROMCAPTURE), so it can stay visible as a small always-on-top
      // bar instead of being hidden outright — Stop is reachable by clicking it
      // directly, not just via the tray menu or a screenshot hotkey.
      await win.setSize(new LogicalSize(MINI_W, MINI_H))
      await tuckIntoCorner(win)
      await win.setFocus()
    } catch (e) {
      setMinimized(false)
      setPhase('error')
      setMessage(String(e))
    }
  }, [format, monitorIndex, beginTimer])

  const handleStop = useCallback(async () => {
    stopTimer()
    setPhase('finishing')
    setMinimized(false)
    const win = getCurrentWebviewWindow()
    // Growing back up from the tucked-in corner position (see tuckIntoCorner)
    // would otherwise push the window partly off-screen.
    await win.setSize(new LogicalSize(FULL_W, FULL_H))
    await win.center()
    try {
      const path = await ipc.stopRecording()
      setPhase('done')
      setMessage(path)
    } catch (e) {
      setPhase('error')
      setMessage(String(e))
    }
  }, [stopTimer])

  useEffect(() => {
    if (phase !== 'recording') return
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault()
        handleStop()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, handleStop])

  // The screenshot hotkeys (PrintScreen / Ctrl+Shift+1/2/3) and the tray's
  // "Stop Recording" item stop the recording on the Rust side directly. Pick
  // up the result here instead of calling stopRecording again (the recording
  // is already gone).
  useEffect(() => {
    const unlisten = listen<string>('recording-stopped', async (event) => {
      if (phaseRef.current !== 'recording') return
      stopTimer()
      setMinimized(false)
      const win = getCurrentWebviewWindow()
      await win.show()
      await win.setSize(new LogicalSize(FULL_W, FULL_H))
      await win.center()
      await win.setFocus()
      setPhase('done')
      setMessage(event.payload)
    })
    return () => { unlisten.then((fn) => fn()) }
  }, [stopTimer])

  const recording = phase === 'recording'
  const busy = phase === 'finishing'
  const selectedMonitor = monitors.find((m) => m.index === monitorIndex)

  return (
    <div className={`${styles.root} ${minimized ? styles.minimized : ''}`}>
      {!minimized && (
        <header className={styles.header}>
          <span className={styles.title}>Recorder</span>
          <button className={styles.closeBtn} onClick={() => getCurrentWebviewWindow().close()}>
            <X size={13} strokeWidth={2} />
          </button>
        </header>
      )}

      <div className={styles.body}>
        {recording || busy ? (
          <div className={styles.recRow}>
            <span className={styles.dot} />
            <span className={styles.timer}>{fmtElapsed(elapsed)}</span>
            {!minimized && <span className={styles.fmtBadge}>{format.toUpperCase()}</span>}
            {!minimized && selectedMonitor && monitors.length > 1 && (
              <span className={styles.monitorBadge} title={selectedMonitor.name}>
                <Monitor size={10} strokeWidth={2} />
                {selectedMonitor.index}
              </span>
            )}
            <button
              className={styles.stopBtn}
              onClick={handleStop}
              disabled={busy}
              title={minimized ? 'Stop (Space)' : 'Stop recording'}
            >
              {busy
                ? <Loader2 size={14} strokeWidth={2} style={{ animation: 'spin 1s linear infinite' }} />
                : <Square size={13} strokeWidth={2} />}
              {!minimized && <span>{busy ? 'Saving…' : 'Stop'}</span>}
            </button>
          </div>
        ) : (
          <div className={styles.idleStack}>
            <div className={styles.idleRow}>
              <div className={styles.fmtToggle}>
                <button
                  className={`${styles.fmtBtn} ${format === 'mp4' ? styles.fmtActive : ''}`}
                  onClick={() => setFormat('mp4')}
                  title="Record MP4 video"
                >
                  <Film size={13} strokeWidth={1.5} /> MP4
                </button>
                <button
                  className={`${styles.fmtBtn} ${format === 'gif' ? styles.fmtActive : ''}`}
                  onClick={() => setFormat('gif')}
                  title="Record animated GIF"
                >
                  <ImageIcon size={13} strokeWidth={1.5} /> GIF
                </button>
              </div>
              <button className={styles.recBtn} onClick={handleStart} title="Start recording">
                <Circle size={13} strokeWidth={2} fill="currentColor" />
                <span>Record</span>
              </button>
            </div>
            {(format === 'gif' || monitors.length > 1) && (
              <div className={styles.selectRow}>
                {format === 'gif' && (
                  <select
                    className={styles.fpsSelect}
                    value={gifFps}
                    onChange={(e) => handleGifFpsChange(Number(e.target.value))}
                    title="GIF frame rate"
                  >
                    {GIF_FPS_OPTIONS.map((fps) => (
                      <option key={fps} value={fps}>{fps} fps</option>
                    ))}
                  </select>
                )}
                {monitors.length > 1 && (
                  <select
                    className={styles.monitorSelect}
                    value={monitorIndex}
                    onChange={(e) => setMonitorIndex(Number(e.target.value))}
                    title="Select monitor to record"
                  >
                    {monitors.map((m) => {
                      const pos = positionLabel(monitors, m)
                      return (
                        <option key={m.index} value={m.index}>
                          {pos ? `[${pos}] ` : ''}{m.name || `Display ${m.index}`} ({m.width}×{m.height}){m.is_primary ? ' ★' : ''}
                        </option>
                      )
                    })}
                  </select>
                )}
              </div>
            )}
          </div>
        )}

        {!minimized && message && (
          <p className={`${styles.message} ${phase === 'error' ? styles.messageError : ''}`} title={message}>
            {phase === 'done' ? `Saved: ${message}` : message}
          </p>
        )}
        {!minimized && phase === 'idle' && (
          <p className={styles.hint}>
            {monitors.length > 1
              ? `${monitors.length} monitors detected.`
              : 'Records the primary monitor.'}
          </p>
        )}
      </div>
    </div>
  )
}
