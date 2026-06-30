import { useCallback, useEffect, useState } from 'react'
import { Check, FolderOpen, Loader2, X } from 'lucide-react'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { ipc } from '../lib/ipc'
import type { AppSettings, OutputFormat } from '../lib/ipc'
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

  return (
    <div className={styles.root}>
      {/* ── Header ── */}
      <header className={styles.header}>
        <span className={styles.title}>Settings</span>
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
        {/* ── Saving ── */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Saving</h2>

          <div className={styles.row}>
            <label className={styles.label}>Save folder</label>
            <div className={styles.dirControl}>
              <span className={styles.path} title={settings.save_dir ?? ''}>
                {settings.save_dir && settings.save_dir.trim() ? settings.save_dir : 'Default (app data)'}
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
            <label className={styles.label}>Filename pattern</label>
            <input
              className={styles.input}
              value={settings.filename_pattern}
              onChange={(e) => patch({ filename_pattern: e.target.value })}
              spellCheck={false}
            />
          </div>
          <p className={styles.hint}>Tokens: {'{date}'} YYYYMMDD, {'{time}'} HHMMSS, {'{ts}'} unix. Default: clipse_{'{date}'}_{'{time}'}</p>

          <div className={styles.row}>
            <label className={styles.label}>Format</label>
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
            <div className={styles.row}>
              <label className={styles.label}>JPEG quality</label>
              <div className={styles.sliderControl}>
                <input
                  type="range"
                  min={1}
                  max={100}
                  value={settings.jpeg_quality}
                  onChange={(e) => patch({ jpeg_quality: Number(e.target.value) })}
                  className={styles.range}
                />
                <span className={styles.sliderVal}>{settings.jpeg_quality}</span>
              </div>
            </div>
          )}
        </section>

        {/* ── Behavior ── */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Behavior</h2>

          <Toggle
            label="Copy to clipboard after capture"
            checked={settings.auto_copy}
            onChange={(v) => patch({ auto_copy: v })}
          />
          <Toggle
            label="Include cursor in captures"
            checked={settings.capture_cursor}
            onChange={(v) => patch({ capture_cursor: v })}
          />
          <Toggle
            label="Launch on system startup"
            checked={settings.launch_on_startup}
            onChange={(v) => patch({ launch_on_startup: v })}
          />
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
