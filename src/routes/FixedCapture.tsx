import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, X } from 'lucide-react'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { ipc, AppSettings } from '../lib/ipc'
import { t, Lang } from '../lib/i18n'
import styles from './FixedCapture.module.css'

type Kind = 'ratio' | 'size'

const RATIO_PRESETS: { label: string; w: number; h: number }[] = [
  { label: '16:9', w: 16, h: 9 },
  { label: '4:3', w: 4, h: 3 },
  { label: '3:2', w: 3, h: 2 },
  { label: '1:1', w: 1, h: 1 },
]

const SIZE_PRESETS: { label: string; w: number; h: number }[] = [
  { label: '1920 × 1080', w: 1920, h: 1080 },
  { label: '1280 × 720', w: 1280, h: 720 },
  { label: '1200 × 630 (OGP)', w: 1200, h: 630 },
  { label: '800 × 600', w: 800, h: 600 },
]

/** Small utility window: pick a fixed size or ratio, then hand off to the
 * region overlay constrained to it. Unlike Recorder, doesn't need to stay
 * visible during the capture — it hides while the overlay is up. The
 * backend (`FixedRegionSpec` / `end_fixed_capture_session` in
 * commands/capture.rs) decides what happens next and drives this window
 * directly: a successful capture hides it (the normal capture flow's own
 * bottom-right toast takes over from there, same as any other capture
 * mode); an Esc-cancel or an error re-shows it so the size/ratio can be
 * adjusted and retried. The window itself is only ever destroyed via its
 * own close (X) button — every other transition just hides/shows the same
 * instance, so reopening from the tray is never racing a teardown. */
export default function FixedCapture() {
  const [kind, setKind] = useState<Kind>('ratio')
  const [w, setW] = useState(16)
  const [h, setH] = useState(9)
  const [loaded, setLoaded] = useState(false)
  const [lang, setLang] = useState<Lang>('en')
  const settingsRef = useRef<AppSettings | null>(null)

  useEffect(() => {
    let cancelled = false
    ipc.getSettings()
      .then((s) => {
        if (cancelled) return
        settingsRef.current = s
        setKind(s.fixed_capture.kind)
        setW(s.fixed_capture.w)
        setH(s.fixed_capture.h)
        setLang(s.language)
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
    return () => { cancelled = true }
  }, [])

  const persist = useCallback((patch: Partial<{ kind: Kind; w: number; h: number }>) => {
    const s = settingsRef.current
    if (!s) return
    const next = { ...s, fixed_capture: { ...s.fixed_capture, ...patch } }
    settingsRef.current = next
    ipc.updateSettings(next).catch(() => {})
  }, [])

  const handleKind = useCallback((k: Kind) => {
    setKind(k)
    persist({ kind: k })
  }, [persist])

  const applyPreset = useCallback((pw: number, ph: number) => {
    setW(pw)
    setH(ph)
    persist({ w: pw, h: ph })
  }, [persist])

  const handleW = useCallback((v: number) => {
    if (!Number.isFinite(v)) return
    const clamped = Math.max(1, Math.min(10000, Math.round(v)))
    setW(clamped)
    persist({ w: clamped })
  }, [persist])

  const handleH = useCallback((v: number) => {
    if (!Number.isFinite(v)) return
    const clamped = Math.max(1, Math.min(10000, Math.round(v)))
    setH(clamped)
    persist({ h: clamped })
  }, [persist])

  const handleCapture = useCallback(async () => {
    const win = getCurrentWebviewWindow()
    await win.hide()
    try {
      await ipc.openFixedCaptureOverlay(kind, w, h)
    } catch (e) {
      // The overlay never opened (e.g. a capture was already in progress),
      // so the backend never marked a fixed-capture session as active and
      // won't be driving this window at all — re-show it directly.
      console.error('fixed capture overlay error', e)
      await win.show()
      await win.setFocus()
    }
  }, [kind, w, h])

  const presets = kind === 'ratio' ? RATIO_PRESETS : SIZE_PRESETS

  return (
    <div className={styles.root}>
      <header className={styles.header} data-tauri-drag-region>
        <span className={styles.title} data-tauri-drag-region>Fixed Capture</span>
        <button className={styles.closeBtn} onClick={() => getCurrentWebviewWindow().close()}>
          <X size={13} strokeWidth={2} />
        </button>
      </header>

      <div className={styles.body}>
        <div className={styles.kindToggle}>
          <button
            className={`${styles.kindBtn} ${kind === 'ratio' ? styles.kindActive : ''}`}
            onClick={() => handleKind('ratio')}
          >
            Ratio
          </button>
          <button
            className={`${styles.kindBtn} ${kind === 'size' ? styles.kindActive : ''}`}
            onClick={() => handleKind('size')}
          >
            Fixed size
          </button>
        </div>

        <div className={styles.presetGrid}>
          {presets.map((p) => (
            <button
              key={p.label}
              className={`${styles.presetBtn} ${w === p.w && h === p.h ? styles.presetActive : ''}`}
              onClick={() => applyPreset(p.w, p.h)}
              title={p.label}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className={styles.customRow}>
          <span className={styles.customLabel}>Custom</span>
          <input
            type="number"
            className={styles.customInput}
            min={1}
            max={10000}
            value={w}
            onChange={(e) => handleW(Number(e.target.value))}
          />
          <span className={styles.customSep}>{kind === 'ratio' ? ':' : '×'}</span>
          <input
            type="number"
            className={styles.customInput}
            min={1}
            max={10000}
            value={h}
            onChange={(e) => handleH(Number(e.target.value))}
          />
        </div>

        <p className={styles.hint}>
          {t(kind === 'ratio' ? 'fixedCaptureHintRatio' : 'fixedCaptureHintSize', lang)}
        </p>

        <button className={styles.captureBtn} onClick={handleCapture} disabled={!loaded} title="Open the region overlay with this constraint">
          <Camera size={14} strokeWidth={2} />
          <span>Capture</span>
        </button>
      </div>
    </div>
  )
}
