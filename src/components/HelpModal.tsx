import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { ipc } from '../lib/ipc'
import { accelParts } from '../lib/shortcuts'
import type { Lang, TKey } from '../lib/i18n'
import { t } from '../lib/i18n'
import styles from './HelpModal.module.css'

interface Props {
  onClose: () => void
}

/** The two global shortcuts are user-configurable, so this section is built from
 *  the live settings rather than listed below — showing the shipped defaults to
 *  someone who has rebound them is worse than showing nothing. */
const DEFAULT_GLOBALS = { capture: 'PrintScreen', quick_menu: 'Ctrl+PrintScreen' }

// Row descriptions are translation keys (resolved with `t()` at render time,
// against the live language setting) — see CLAUDE.md's UI rules: this is
// prose/explanation, not a structural label, so it switches with the app
// language. Section titles below stay English on purpose.
const SECTIONS: { title: string; rows: { keys: string[]; descKey: TKey }[] }[] = [
  {
    title: 'Region selection',
    rows: [
      { keys: ['Shift'], descKey: 'helpOvSquare' },
      { keys: ['R'], descKey: 'helpOvRatio' },
      { keys: ['L'], descKey: 'helpOvLastSize' },
      { keys: ['Shift', 'L'], descKey: 'helpOvLastPosition' },
      { keys: ['S'], descKey: 'helpOvScroll' },
    ],
  },
  {
    title: 'Quick menu',
    rows: [
      { keys: ['↑ / ↓'], descKey: 'helpQmMove' },
      { keys: ['Enter'], descKey: 'helpQmRun' },
      { keys: ['1–9'], descKey: 'helpQmRunByNumber' },
      { keys: ['Esc'], descKey: 'helpQmClose' },
    ],
  },
  {
    title: 'Gallery',
    rows: [
      { keys: ['← ↑ ↓ →'], descKey: 'helpGalMove' },
      { keys: ['Enter'], descKey: 'helpGalOpen' },
      { keys: ['Home / End'], descKey: 'helpGalJump' },
      { keys: ['Ctrl', 'C'], descKey: 'helpGalCopy' },
      { keys: ['Ctrl', 'Shift', 'C'], descKey: 'helpGalCopyPath' },
      { keys: ['Ctrl', 'P'], descKey: 'helpGalPin' },
      { keys: ['Ctrl', 'A'], descKey: 'helpGalSelectAll' },
      { keys: ['Delete'], descKey: 'helpGalDelete' },
      { keys: ['Esc'], descKey: 'helpGalCancel' },
      { keys: ['Double-click'], descKey: 'helpGalDblClick' },
      { keys: ['Drag out'], descKey: 'helpGalDragOut' },
    ],
  },
  {
    title: 'Editor — tools',
    rows: [
      { keys: ['Space'], descKey: 'helpEdToolSelect' },
      { keys: ['F1'], descKey: 'helpEdToolArrow' },
      { keys: ['F2'], descKey: 'helpEdToolPen' },
      { keys: ['F3'], descKey: 'helpEdToolRect' },
      { keys: ['F4'], descKey: 'helpEdToolEllipse' },
      { keys: ['F5'], descKey: 'helpEdToolText' },
      { keys: ['F6'], descKey: 'helpEdToolNumber' },
      { keys: ['F7'], descKey: 'helpEdToolHighlight' },
      { keys: ['F8'], descKey: 'helpEdToolSpotlight' },
      { keys: ['F9'], descKey: 'helpEdToolMagnifier' },
      { keys: ['F10'], descKey: 'helpEdToolBlur' },
      { keys: ['F11'], descKey: 'helpEdToolMagicWand' },
      { keys: ['F12'], descKey: 'helpEdToolCrop' },
    ],
  },
  {
    title: 'Editor — actions',
    rows: [
      { keys: ['Ctrl', 'Z'], descKey: 'helpEdActUndo' },
      { keys: ['Ctrl', 'Y'], descKey: 'helpEdActRedo' },
      { keys: ['Ctrl', 'A'], descKey: 'helpEdActSelectAll' },
      { keys: ['Ctrl', 'C'], descKey: 'helpEdActCopy' },
      { keys: ['Ctrl', 'Shift', 'C'], descKey: 'helpEdActCopyPath' },
      { keys: ['Ctrl', 'Shift', 'O'], descKey: 'helpEdActOcr' },
      { keys: ['Ctrl', 'P'], descKey: 'helpEdActPin' },
      { keys: ['Ctrl', 'V'], descKey: 'helpEdActPaste' },
      { keys: ['Ctrl', 'D'], descKey: 'helpEdActDuplicate' },
      { keys: ['Ctrl', 'S'], descKey: 'helpEdActSave' },
      { keys: ['Ctrl', '0'], descKey: 'helpEdActResetZoom' },
      { keys: ['Arrow keys'], descKey: 'helpEdActNudge' },
      { keys: ['Delete'], descKey: 'helpEdActDelete' },
      { keys: ['Double-click'], descKey: 'helpEdActDblClick' },
      { keys: ['Enter'], descKey: 'helpEdActConfirm' },
      { keys: ['Esc'], descKey: 'helpEdActCancel' },
      { keys: ['Scroll'], descKey: 'helpEdActZoom' },
      { keys: ['Middle-drag'], descKey: 'helpEdActPan' },
    ],
  },
]

export default function HelpModal({ onClose }: Props) {
  // Starts on the defaults so the section renders immediately; the fetch only
  // corrects it for anyone who has rebound something.
  const [globals, setGlobals] = useState(DEFAULT_GLOBALS)
  const [lang, setLang] = useState<Lang>('ja')

  useEffect(() => {
    ipc.getSettings().then((s) => {
      setGlobals(s.shortcuts)
      setLang(s.language)
    }).catch(console.error)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const sections = [
    {
      title: 'Global shortcuts',
      rows: [
        { keys: accelParts(globals.capture), descKey: 'helpGlobalCapture' as TKey },
        { keys: accelParts(globals.quick_menu), descKey: 'helpGlobalQuickMenu' as TKey },
      ],
    },
    ...SECTIONS,
  ]

  return (
    <div className={styles.backdrop} onPointerDown={onClose}>
      <div className={styles.modal} onPointerDown={(e) => e.stopPropagation()}>
        <header className={styles.header}>
          <span className={styles.title}>Keyboard shortcuts</span>
          <button className={styles.closeBtn} onClick={onClose} title="Close (Esc)">
            <X size={13} strokeWidth={2} />
          </button>
        </header>

        <div className={styles.body}>
          {sections.map((section) => (
            <section key={section.title} className={styles.section}>
              <h3 className={styles.sectionTitle}>{section.title}</h3>
              <table className={styles.table}>
                <tbody>
                  {section.rows.map((row) => (
                    <tr key={row.descKey} className={styles.row}>
                      <td className={styles.keys}>
                        {row.keys.map((k, i) => (
                          <span key={i}>
                            <kbd className={styles.kbd}>{k}</kbd>
                            {i < row.keys.length - 1 && <span className={styles.plus}>+</span>}
                          </span>
                        ))}
                      </td>
                      <td className={styles.desc}>{t(row.descKey, lang)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
