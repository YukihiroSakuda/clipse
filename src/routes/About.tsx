import { useEffect, useState } from 'react'
import { Camera, ScrollText, Film, Pencil, ScanText, Pin, X } from 'lucide-react'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { ipc } from '../lib/ipc'
import type { Lang } from '../lib/i18n'
import { t } from '../lib/i18n'
import styles from './About.module.css'

const FEATURES: { icon: typeof Camera; title: string; descKey: Parameters<typeof t>[0] }[] = [
  { icon: Camera, title: 'Region / Window / Fullscreen capture', descKey: 'aboutFeatureCaptureDesc' },
  { icon: ScrollText, title: 'Scrolling capture', descKey: 'aboutFeatureScrollDesc' },
  { icon: Film, title: 'Screen recording', descKey: 'aboutFeatureRecordDesc' },
  { icon: Pencil, title: 'Annotations', descKey: 'aboutFeatureAnnotateDesc' },
  { icon: ScanText, title: 'OCR', descKey: 'aboutFeatureOcrDesc' },
  { icon: Pin, title: 'Tray-resident', descKey: 'aboutFeatureTrayDesc' },
]

export default function About() {
  const [lang, setLang] = useState<Lang>('ja')
  const [version, setVersion] = useState('')

  useEffect(() => {
    ipc.getSettings().then((s) => setLang(s.language)).catch(console.error)
    ipc.getAppVersion().then(setVersion).catch(console.error)
  }, [])

  return (
    <div className={styles.root}>
      {/* ── Header (drag region) ── */}
      <header className={styles.header} data-tauri-drag-region>
        <span className={styles.title} data-tauri-drag-region>About</span>
        <button className={styles.closeBtn} onClick={() => getCurrentWebviewWindow().close()}>
          <X size={14} strokeWidth={2} />
        </button>
      </header>

      <div className={styles.body}>
        {/* ── Hero ── */}
        <div className={styles.hero}>
          <img className={styles.icon} src="/icon.png" alt="" />
          <span className={styles.appName}>Clipse</span>
          <p className={styles.tagline}>{t('aboutTagline', lang)}</p>
          {version && <span className={styles.version}>v{version}</span>}
        </div>

        {/* ── Features ── */}
        <div className={styles.section}>
          <span className={styles.sectionTitle}>Features</span>
          <ul className={styles.featureList}>
            {FEATURES.map(({ icon: Icon, title, descKey }) => (
              <li key={title} className={styles.feature}>
                <Icon className={styles.featureIcon} size={18} strokeWidth={1.75} />
                <div className={styles.featureText}>
                  <span className={styles.featureTitle}>{title}</span>
                  <span className={styles.featureDesc}>{t(descKey, lang)}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
