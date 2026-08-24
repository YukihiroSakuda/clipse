import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { ipc } from '../lib/ipc'
import { accelParts } from '../lib/shortcuts'
import styles from './HelpModal.module.css'

interface Props {
  onClose: () => void
}

/** The two global shortcuts are user-configurable, so this section is built from
 *  the live settings rather than listed below — showing the shipped defaults to
 *  someone who has rebound them is worse than showing nothing. */
const DEFAULT_GLOBALS = { capture: 'PrintScreen', quick_menu: 'Ctrl+PrintScreen' }

const SECTIONS = [
  {
    title: 'Quick menu',
    rows: [
      { keys: ['↑ / ↓'], desc: 'Move the selection' },
      { keys: ['Enter'], desc: 'Run the selected action' },
      { keys: ['1–9'], desc: 'Run an action directly by its number' },
      { keys: ['Esc'], desc: 'Close' },
    ],
  },
  {
    title: 'Gallery',
    rows: [
      { keys: ['← ↑ ↓ →'], desc: 'Move between captures (up/down move a whole row)' },
      { keys: ['Enter'], desc: 'Open the current capture — editor for an image, player for a video' },
      { keys: ['Home / End'], desc: 'Jump to the first / last capture' },
      { keys: ['Ctrl', 'C'], desc: 'Copy the current capture — image to the clipboard, video as a file' },
      { keys: ['Ctrl', 'Shift', 'C'], desc: 'Copy the file path' },
      { keys: ['Ctrl', 'P'], desc: 'Pin to screen (images only)' },
      { keys: ['Ctrl', 'A'], desc: 'Select all' },
      { keys: ['Delete'], desc: 'Delete selected (Enter then confirms)' },
      { keys: ['Esc'], desc: 'Cancel, then deselect, then close the window' },
      { keys: ['Double-click'], desc: 'Open in editor' },
      { keys: ['Drag out'], desc: 'Copy the file into Explorer, mail or a chat window (drags the whole selection)' },
    ],
  },
  {
    title: 'Editor — tools',
    rows: [
      { keys: ['Space'], desc: 'Select' },
      { keys: ['F1'], desc: 'Arrow' },
      { keys: ['F2'], desc: 'Pen (freehand)' },
      { keys: ['F3'], desc: 'Line' },
      { keys: ['F4'], desc: 'Rectangle' },
      { keys: ['F5'], desc: 'Ellipse' },
      { keys: ['F6'], desc: 'Text' },
      { keys: ['F7'], desc: 'Number marker' },
      { keys: ['F8'], desc: 'Highlight' },
      { keys: ['F9'], desc: 'Blur / redact' },
      { keys: ['F10'], desc: 'Spotlight' },
      { keys: ['F11'], desc: 'Crop' },
      { keys: ['F12'], desc: 'Magnifier callout' },
    ],
  },
  {
    title: 'Editor — actions',
    rows: [
      { keys: ['Ctrl', 'Z'], desc: 'Undo' },
      { keys: ['Ctrl', 'Y'], desc: 'Redo' },
      { keys: ['Ctrl', 'A'], desc: 'Select all annotations' },
      { keys: ['Ctrl', 'C'], desc: 'Copy selected annotations, or the image itself if nothing is selected' },
      { keys: ['Ctrl', 'Shift', 'C'], desc: 'Copy the file path' },
      { keys: ['Ctrl', 'Shift', 'O'], desc: 'OCR — extract text from the image' },
      { keys: ['Ctrl', 'P'], desc: 'Pin to screen (asks first — pinning closes this editor)' },
      { keys: ['Ctrl', 'V'], desc: 'Paste an image from the clipboard, or copied annotations — whichever was copied last (annotations may come from another open editor window)' },
      { keys: ['Ctrl', 'D'], desc: 'Duplicate selection' },
      { keys: ['Ctrl', 'S'], desc: 'Save to gallery' },
      { keys: ['Ctrl', '0'], desc: 'Reset zoom / pan' },
      { keys: ['Arrow keys'], desc: 'Nudge selection 1px (Shift: 10px)' },
      { keys: ['Delete'], desc: 'Delete selected annotation, or the image itself if nothing is selected (confirm required)' },
      { keys: ['Double-click'], desc: 'Edit a text label or number marker' },
      { keys: ['Enter'], desc: 'Confirm text/number edit, apply crop, or confirm image delete' },
      { keys: ['Esc'], desc: 'Cancel crop/edit, then deselect, then close this editor' },
      { keys: ['Scroll'], desc: 'Zoom in / out' },
      { keys: ['Middle-drag'], desc: 'Pan canvas' },
    ],
  },
]

export default function HelpModal({ onClose }: Props) {
  // Starts on the defaults so the section renders immediately; the fetch only
  // corrects it for anyone who has rebound something.
  const [globals, setGlobals] = useState(DEFAULT_GLOBALS)

  useEffect(() => {
    ipc.getSettings().then((s) => setGlobals(s.shortcuts)).catch(console.error)
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
        { keys: accelParts(globals.capture), desc: 'Region capture overlay' },
        {
          keys: accelParts(globals.quick_menu),
          desc: 'Quick menu at the cursor — every other capture action',
        },
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
