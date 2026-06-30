import { useEffect } from 'react'
import { X } from 'lucide-react'
import styles from './HelpModal.module.css'

interface Props {
  onClose: () => void
}

const SECTIONS = [
  {
    title: 'Global shortcuts',
    rows: [
      { keys: ['PrintScreen'], desc: 'Region capture overlay' },
    ],
  },
  {
    title: 'Gallery',
    rows: [
      { keys: ['Ctrl', 'A'], desc: 'Select all' },
      { keys: ['Delete'], desc: 'Delete selected (confirm required)' },
      { keys: ['Enter'], desc: 'Confirm delete' },
      { keys: ['Esc'], desc: 'Deselect / cancel' },
      { keys: ['Double-click'], desc: 'Open in editor' },
    ],
  },
  {
    title: 'Editor — tools',
    rows: [
      { keys: ['A'], desc: 'Arrow' },
      { keys: ['L'], desc: 'Line' },
      { keys: ['R'], desc: 'Rectangle' },
      { keys: ['E'], desc: 'Ellipse' },
      { keys: ['T'], desc: 'Text' },
      { keys: ['N'], desc: 'Number marker' },
      { keys: ['H'], desc: 'Highlight' },
      { keys: ['B'], desc: 'Blur / redact' },
      { keys: ['S'], desc: 'Spotlight' },
      { keys: ['V'], desc: 'Select' },
    ],
  },
  {
    title: 'Editor — actions',
    rows: [
      { keys: ['Ctrl', 'Z'], desc: 'Undo' },
      { keys: ['Ctrl', 'Y'], desc: 'Redo' },
      { keys: ['Ctrl', 'C'], desc: 'Copy image to clipboard' },
      { keys: ['Ctrl', 'S'], desc: 'Save to gallery' },
      { keys: ['Delete'], desc: 'Delete selected annotation' },
      { keys: ['Esc'], desc: 'Deselect' },
      { keys: ['Scroll'], desc: 'Zoom in / out' },
      { keys: ['Space', 'Drag'], desc: 'Pan canvas' },
    ],
  },
]

export default function HelpModal({ onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

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
          {SECTIONS.map((section) => (
            <section key={section.title} className={styles.section}>
              <h3 className={styles.sectionTitle}>{section.title}</h3>
              <table className={styles.table}>
                <tbody>
                  {section.rows.map((row) => (
                    <tr key={row.desc} className={styles.row}>
                      <td className={styles.keys}>
                        {row.keys.map((k, i) => (
                          <span key={i}>
                            <kbd className={styles.kbd}>{k}</kbd>
                            {i < row.keys.length - 1 && <span className={styles.plus}>+</span>}
                          </span>
                        ))}
                      </td>
                      <td className={styles.desc}>{row.desc}</td>
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
