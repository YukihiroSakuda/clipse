import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, FolderOpen, Loader2, Pencil, RotateCcw, X } from 'lucide-react'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { ipc } from '../lib/ipc'
import type { AppSettings, OcrEngine, OutputFormat, ShortcutSettings } from '../lib/ipc'
import { getVersion } from '@tauri-apps/api/app'
import { checkForUpdate, installUpdate, restartIntoUpdate } from '../lib/updater'
import type { UpdateState } from '../lib/updater'
import { accelFromEvent, accelParts } from '../lib/shortcuts'
import { t } from '../lib/i18n'
import type { Lang } from '../lib/i18n'
import styles from './Settings.module.css'

/** Must match `DEFAULT_*_SHORTCUT` in settings.rs. */
const DEFAULT_SHORTCUTS: ShortcutSettings = {
  capture: 'PrintScreen',
  quick_menu: 'Ctrl+PrintScreen',
}

export default function Settings() {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'ok' | 'err'>('idle')

  useEffect(() => {
    ipc.getSettings().then(setSettings).catch(console.error)
  }, [])

  const patch = useCallback((p: Partial<AppSettings>) => {
    setSettings((s) => (s ? { ...s, ...p } : s))
    setDirty(true)
    setSaveStatus('idle')
  }, [])

const handleBrowse = useCallback(async () => {
    const picked = await ipc.pickDirectory(settings?.save_dir ?? null).catch(() => null)
    if (picked) patch({ save_dir: picked })
  }, [settings?.save_dir, patch])

  const handleSave = useCallback(async () => {
    if (!settings) return
    setSaveStatus('saving')
    try {
      await ipc.updateSettings(settings)
      setSaveStatus('ok')
      setDirty(false)
      setTimeout(() => setSaveStatus('idle'), 1800)
    } catch (e) {
      console.error(e)
      setSaveStatus('err')
    }
  }, [settings])

  if (!settings) {
    return (
      <div className={styles.root}>
        <div className={styles.loading}>
          <Loader2 size={20} strokeWidth={1.5} style={{ animation: 'spin 1s linear infinite' }} />
        </div>
      </div>
    )
  }

  const isJpeg = settings.output_format === 'jpeg'
  const lang = settings.language

  return (
    <div className={styles.root}>
      {/* ── Header (drag region) ── */}
      <header className={styles.header} data-tauri-drag-region>
        <span className={styles.title} data-tauri-drag-region>Settings</span>
        <div className={styles.headerActions}>
          <button
            className={`${styles.saveBtn} ${saveStatus === 'ok' ? styles.saveBtnOk : ''}`}
            onClick={handleSave}
            disabled={!dirty || saveStatus === 'saving'}
            title="Save settings"
          >
            {saveStatus === 'saving'
              ? <Loader2 size={13} strokeWidth={2} style={{ animation: 'spin 1s linear infinite' }} />
              : saveStatus === 'ok'
                ? <Check size={13} strokeWidth={2.5} />
                : null}
            <span>{saveStatus === 'ok' ? 'Saved' : saveStatus === 'err' ? 'Error' : 'Save'}</span>
          </button>
          <button className={styles.closeBtn} onClick={() => getCurrentWebviewWindow().close()}>
            <X size={14} strokeWidth={2} />
          </button>
        </div>
      </header>

      <div className={styles.body}>
        {/* ── Language ── */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Language</h2>

          <div className={styles.row}>
            <label className={styles.label}>{t('lblExplanatoryText', lang)}</label>
            <select
              className={styles.select}
              value={settings.language}
              onChange={(e) => patch({ language: e.target.value as 'en' | 'ja' })}
            >
              <option value="en">English</option>
              <option value="ja">日本語</option>
            </select>
          </div>
        </section>

        {/* ── Saving ── */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Saving</h2>

          <div className={styles.row}>
            <label className={styles.label}>{t('lblSaveFolder', lang)}</label>
            <div className={styles.dirControl}>
              <span className={styles.path} title={settings.save_dir ?? ''}>
                {settings.save_dir && settings.save_dir.trim() ? settings.save_dir : t('settingsDefaultDir', lang)}
              </span>
              <button className={styles.smallBtn} onClick={handleBrowse} title="Choose folder">
                <FolderOpen size={13} strokeWidth={1.5} />
              </button>
              {settings.save_dir && (
                <button
                  className={styles.smallBtn}
                  onClick={() => patch({ save_dir: null })}
                  title="Reset to default"
                >
                  <X size={13} strokeWidth={2} />
                </button>
              )}
            </div>
          </div>

          <div className={styles.row}>
            <label className={styles.label}>{t('lblFilenamePattern', lang)}</label>
            <input
              className={styles.input}
              value={settings.filename_pattern}
              onChange={(e) => patch({ filename_pattern: e.target.value })}
              spellCheck={false}
            />
          </div>
          <p className={styles.hint}>{t('filenamePatternHint', lang)}</p>

          <div className={styles.row}>
            <label className={styles.label}>{t('lblFormat', lang)}</label>
            <select
              className={styles.select}
              value={settings.output_format}
              onChange={(e) => patch({ output_format: e.target.value as OutputFormat })}
            >
              <option value="png">PNG</option>
              <option value="jpeg">JPEG</option>
            </select>
          </div>

          {isJpeg && (
            <SliderRow
              label={t('lblJpegQuality', lang)}
              min={1}
              max={100}
              value={settings.jpeg_quality}
              onChange={(v) => patch({ jpeg_quality: v })}
            />
          )}
        </section>

        {/* ── Behavior ── */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Behavior</h2>

          <Toggle
            label={t('lblOpenEditorAfterCapture', lang)}
            checked={settings.open_editor_after_capture}
            onChange={(v) => patch({ open_editor_after_capture: v })}
          />
          <p className={styles.hint}>{t('openEditorAfterCaptureHint', lang)}</p>
          <Toggle
            label={t('lblCaptureCursor', lang)}
            checked={settings.capture_cursor}
            onChange={(v) => patch({ capture_cursor: v })}
          />
          <Toggle
            label={t('lblLaunchStartup', lang)}
            checked={settings.launch_on_startup}
            onChange={(v) => patch({ launch_on_startup: v })}
          />
        </section>

        {/* ── Global shortcuts ── */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Global shortcuts</h2>

          <ShortcutRow
            label={t('lblShortcutCapture', lang)}
            lang={lang}
            value={settings.shortcuts.capture}
            taken={settings.shortcuts.quick_menu}
            onChange={(v) => patch({ shortcuts: { ...settings.shortcuts, capture: v } })}
            onReset={() => patch({
              shortcuts: { ...settings.shortcuts, capture: DEFAULT_SHORTCUTS.capture },
            })}
            isDefault={settings.shortcuts.capture === DEFAULT_SHORTCUTS.capture}
          />
          <ShortcutRow
            label={t('lblShortcutQuickMenu', lang)}
            lang={lang}
            value={settings.shortcuts.quick_menu}
            taken={settings.shortcuts.capture}
            onChange={(v) => patch({ shortcuts: { ...settings.shortcuts, quick_menu: v } })}
            onReset={() => patch({
              shortcuts: { ...settings.shortcuts, quick_menu: DEFAULT_SHORTCUTS.quick_menu },
            })}
            isDefault={settings.shortcuts.quick_menu === DEFAULT_SHORTCUTS.quick_menu}
          />
          <p className={styles.hint}>{t('shortcutsHint', lang)}</p>
        </section>

        {/* ── Scrolling capture ── */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Scrolling capture</h2>

          <SliderRow
            label={t('lblWaitTime', lang)}
            min={100}
            max={1000}
            step={50}
            suffix="ms"
            value={settings.scroll.settle_ms}
            onChange={(v) => patch({ scroll: { ...settings.scroll, settle_ms: v } })}
          />
          <p className={styles.hint}>{t('scrollSettleHint', lang)}</p>
        </section>

        {/* ── OCR ── */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>OCR</h2>

          <div className={styles.row}>
            <label className={styles.label}>{t('lblOcrEngine', lang)}</label>
            <select
              className={styles.select}
              value={settings.ocr.engine}
              onChange={(e) => patch({ ocr: { ...settings.ocr, engine: e.target.value as OcrEngine } })}
            >
              <option value="auto">Auto</option>
              <option value="claude">Claude Code</option>
              <option value="codex">Codex</option>
            </select>
          </div>
          <p className={styles.hint}>{t('ocrEngineHint', lang)}</p>

          {/* The withdrawal half of the consent granted in the editor's dialog.
              Consent that can only be given and never taken back isn't consent,
              and the Store listing's privacy disclosure points here. */}
          <Toggle
            label={t('lblOcrConsent', lang)}
            checked={settings.ocr.consented}
            onChange={(v) => patch({ ocr: { ...settings.ocr, consented: v } })}
          />
          {!settings.ocr.consented && (
            <p className={styles.hint}>{t('ocrConsentRevoked', lang)}</p>
          )}
        </section>

        {/* ── Updates ── */}
        <UpdateSection lang={lang} />
      </div>
    </div>
  )
}

/**
 * Version readout plus a manual update check.
 *
 * Its own component with its own state: the update flow is independent of the
 * settings document, so it must not mark the form dirty or be discarded when
 * the user saves. See `src/lib/updater.ts` for why Clipse self-updates at all.
 */
function UpdateSection({ lang }: { lang: Lang }) {
  const [version, setVersion] = useState('')
  const [state, setState] = useState<UpdateState>({ status: 'idle' })

  useEffect(() => {
    getVersion().then(setVersion).catch(() => {})
  }, [])

  const handleCheck = useCallback(async () => {
    setState({ status: 'checking' })
    try {
      const update = await checkForUpdate()
      setState(update ? { status: 'available', update } : { status: 'none' })
    } catch (e) {
      setState({ status: 'error', message: String(e) })
    }
  }, [])

  const handleInstall = useCallback(async () => {
    if (state.status !== 'available') return
    const { update } = state
    setState({ status: 'downloading', percent: 0 })
    try {
      await installUpdate(update, (percent) => setState({ status: 'downloading', percent }))
      setState({ status: 'ready' })
    } catch (e) {
      setState({ status: 'error', message: String(e) })
    }
  }, [state])

  const busy = state.status === 'checking' || state.status === 'downloading'

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Updates</h2>

      <div className={styles.row}>
        <label className={styles.label}>{t('lblCurrentVersion', lang)}</label>
        <span className={styles.value}>{version || '—'}</span>
      </div>

      <div className={styles.row}>
        <label className={styles.label}>{t('lblUpdateCheck', lang)}</label>
        {state.status === 'available' ? (
          <button className={styles.btn} onClick={handleInstall}>
            {`Install ${state.update.version}`}
          </button>
        ) : state.status === 'ready' ? (
          <button className={styles.btn} onClick={() => void restartIntoUpdate()}>
            Restart
          </button>
        ) : (
          <button className={styles.btn} onClick={handleCheck} disabled={busy}>
            {busy ? (
              <Loader2 size={13} strokeWidth={1.5} style={{ animation: 'spin 1s linear infinite' }} />
            ) : (
              <RotateCcw size={13} strokeWidth={1.5} />
            )}
            <span>Check</span>
          </button>
        )}
      </div>

      {state.status === 'none' && <p className={styles.hint}>{t('updateNone', lang)}</p>}
      {state.status === 'downloading' && (
        <p className={styles.hint}>{`${t('updateDownloading', lang)} ${state.percent}%`}</p>
      )}
      {state.status === 'ready' && <p className={styles.hint}>{t('updateReady', lang)}</p>}
      {state.status === 'error' && <p className={styles.hint}>{state.message}</p>}
      {state.status === 'idle' && <p className={styles.hint}>{t('updateHint', lang)}</p>}
    </section>
  )
}

/**
 * One rebindable global shortcut: shows the current combination, and records a
 * new one when clicked.
 *
 * While recording, the backend suspends the hook and the fallback hotkeys
 * (`setShortcutRecording`) — otherwise a bound key is swallowed before it can
 * reach this window, which would make PrintScreen impossible to re-enter. The
 * resume is in a `finally` and also runs on unmount, so closing the window
 * mid-recording can't leave the hotkeys switched off.
 */
function ShortcutRow({ label, value, taken, onChange, onReset, isDefault, lang }: {
  label: string
  value: string
  lang: Lang
  /** The other action's accelerator — binding both to one key would leave the
   *  second unreachable, since the hook matches in order. */
  taken: string
  onChange: (v: string) => void
  onReset: () => void
  isDefault: boolean
}) {
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const recordingRef = useRef(false)

  const stop = useCallback(() => {
    recordingRef.current = false
    setRecording(false)
    ipc.setShortcutRecording(false).catch(console.error)
  }, [])

  const start = useCallback(() => {
    setError(null)
    recordingRef.current = true
    setRecording(true)
    ipc.setShortcutRecording(true).catch((e) => {
      console.error(e)
      recordingRef.current = false
      setRecording(false)
    })
  }, [])

  // Whatever happens to this component, the hotkeys go back on.
  useEffect(() => () => {
    if (recordingRef.current) ipc.setShortcutRecording(false).catch(console.error)
  }, [])

  useEffect(() => {
    if (!recording) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey) { stop(); return }

      const accel = accelFromEvent(e)
      if (!accel) return // a bare modifier, or a key with no name — keep listening
      if (accel.error) { setError(accel.error); return }
      if (accel.text === taken) {
        setError('Already used by the other shortcut')
        return
      }
      setError(null)
      onChange(accel.text)
      stop()
    }
    // Both edges: Chromium only ever reports PrintScreen on keyup, so a
    // keydown-only recorder could never capture the default binding.
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('keyup', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('keyup', onKey, true)
    }
  }, [recording, taken, onChange, stop])

  const parts = accelParts(value)

  return (
    <>
      <div className={styles.row}>
        <label className={styles.label}>{label}</label>
        <div className={styles.shortcutControl}>
          <button
            className={`${styles.shortcutBtn} ${recording ? styles.shortcutBtnRecording : ''}`}
            onClick={recording ? stop : start}
            title={recording ? 'Press a key combination (Esc to cancel)' : 'Click to change'}
          >
            {recording ? (
              <>
                <span className={styles.recDot} />
                <span className={styles.shortcutPrompt}>Press keys…</span>
              </>
            ) : (
              <>
                <span className={styles.shortcutKeys}>
                  {parts.map((part, i) => (
                    <span key={i}>
                      <kbd className={styles.kbd}>{part}</kbd>
                      {i < parts.length - 1 && <span className={styles.plus}>+</span>}
                    </span>
                  ))}
                </span>
                {/* The affordance: without it the row reads as a static label
                    and nothing suggests the keys can be changed at all. */}
                <Pencil className={styles.shortcutEditIcon} size={11} strokeWidth={1.5} />
              </>
            )}
          </button>
          {/* Always rendered, only faded out — letting it appear and disappear
              made the row's width jump the moment recording started. */}
          <button
            className={`${styles.smallBtn} ${isDefault || recording ? styles.smallBtnHidden : ''}`}
            onClick={onReset}
            disabled={isDefault || recording}
            title="Reset to default"
            aria-hidden={isDefault || recording}
          >
            <RotateCcw size={13} strokeWidth={1.5} />
          </button>
        </div>
      </div>
      {/* One status line under the row, so the layout never shifts: the reason a
          key was refused if there is one, otherwise how to get back out. */}
      {(error || recording) && (
        <p className={error ? styles.shortcutError : styles.shortcutRecHint}>
          {error ?? t('shortcutRecording', lang)}
        </p>
      )}
    </>
  )
}

function Toggle({ label, checked, onChange }: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className={styles.row}>
      <label className={styles.label}>{label}</label>
      <button
        role="switch"
        aria-checked={checked}
        className={`${styles.toggle} ${checked ? styles.toggleOn : ''}`}
        onClick={() => onChange(!checked)}
      >
        <span className={styles.toggleKnob} />
      </button>
    </div>
  )
}

function SliderRow({ label, min, max, step = 1, value, onChange, suffix = '' }: {
  label: string
  min: number
  max: number
  step?: number
  value: number
  onChange: (v: number) => void
  suffix?: string
}) {
  return (
    <div className={styles.row}>
      <label className={styles.label}>{label}</label>
      <div className={styles.sliderControl}>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className={styles.range}
        />
        <span className={styles.sliderVal}>{value}{suffix}</span>
      </div>
    </div>
  )
}
