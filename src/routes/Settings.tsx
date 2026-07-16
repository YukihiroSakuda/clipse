import { useCallback, useEffect, useState } from 'react'
import { Check, FolderOpen, Loader2, X } from 'lucide-react'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { ipc } from '../lib/ipc'
import type { AppSettings, OutputFormat } from '../lib/ipc'
import { t } from '../lib/i18n'
import styles from './Settings.module.css'

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
      </div>
    </div>
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
