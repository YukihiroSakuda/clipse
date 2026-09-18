import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Pipette, RefreshCw } from 'lucide-react'
import { PALETTE, TAILWIND_PALETTE, TAILWIND_SHADE_NAMES } from '../lib/annotations'
import styles from './Toolbar.module.css'

// Gray families (0-4) merged to index 1 (gray); colorful families 5-21
const DISPLAY_FAMILIES = [
  { name: 'gray',    shades: TAILWIND_PALETTE[1]  },
  { name: 'red',     shades: TAILWIND_PALETTE[5]  },
  { name: 'orange',  shades: TAILWIND_PALETTE[6]  },
  { name: 'amber',   shades: TAILWIND_PALETTE[7]  },
  { name: 'yellow',  shades: TAILWIND_PALETTE[8]  },
  { name: 'lime',    shades: TAILWIND_PALETTE[9]  },
  { name: 'green',   shades: TAILWIND_PALETTE[10] },
  { name: 'emerald', shades: TAILWIND_PALETTE[11] },
  { name: 'teal',    shades: TAILWIND_PALETTE[12] },
  { name: 'cyan',    shades: TAILWIND_PALETTE[13] },
  { name: 'sky',     shades: TAILWIND_PALETTE[14] },
  { name: 'blue',    shades: TAILWIND_PALETTE[15] },
  { name: 'indigo',  shades: TAILWIND_PALETTE[16] },
  { name: 'violet',  shades: TAILWIND_PALETTE[17] },
  { name: 'purple',  shades: TAILWIND_PALETTE[18] },
  { name: 'fuchsia', shades: TAILWIND_PALETTE[19] },
  { name: 'pink',    shades: TAILWIND_PALETTE[20] },
  { name: 'rose',    shades: TAILWIND_PALETTE[21] },
]

// White has no lightness/saturation to pick — a single fixed swatch,
// selected directly instead of opening a shade row like the families above.
const WHITE = PALETTE.white

interface Props {
  value: string
  onChange: (hex: string) => void
  recentColors?: string[]
  title?: string
  /** Optional "Auto" entry at the top of the popup, for a color whose
   *  default is computed rather than a literal pick (e.g. shadow color
   *  falling back to black/the ink color). Clicking it doesn't set `value`
   *  itself — the caller decides what "auto" resolves to. */
  auto?: { active: boolean; onClick: () => void; title: string }
}

/**
 * A small swatch button that opens the standard family-grid + shade-row
 * color popup on click. Used by both Toolbar's main ink-color control and
 * ToolOptionsPanel's shadow-color control — pulled out here rather than
 * duplicated so the two never drift into looking like different pickers.
 */
export default function ColorSwatchPicker({ value, onChange, recentColors = [], title = 'Color', auto }: Props) {
  const shadePickerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [picker, setPicker] = useState<{ familyIdx: number; top: number; left: number } | null>(null)

  useEffect(() => {
    if (!picker) return
    const onPointerDown = (e: PointerEvent) => {
      if (
        !shadePickerRef.current?.contains(e.target as Node) &&
        !triggerRef.current?.contains(e.target as Node)
      ) setPicker(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [picker])

  // The trigger this opens off of can sit anywhere — including, now that
  // ToolOptionsPanel docks a swatch inside a 220px-wide sidebar against the
  // window's right edge, right where the popup's own ~250px width no longer
  // fits. `toggle` positions from the trigger alone (it can't know the
  // popup's real size before that first render), so this corrects for
  // overflow once the popup actually exists to measure. Runs to a fixed
  // point in at most one correction: after the pull-back, the measured rect
  // no longer overflows, so the effect's own dependency change fires once
  // more and does nothing.
  useLayoutEffect(() => {
    if (!picker) return
    const el = shadePickerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const overflowX = rect.right - (window.innerWidth - 4)
    const overflowY = rect.bottom - (window.innerHeight - 4)
    if (overflowX <= 0 && overflowY <= 0) return
    setPicker((p) => p && ({
      ...p,
      left: overflowX > 0 ? Math.max(4, p.left - overflowX) : p.left,
      top: overflowY > 0 ? Math.max(4, p.top - overflowY) : p.top,
    }))
  }, [picker])

  const toggle = () => {
    if (picker) { setPicker(null); return }
    const btn = triggerRef.current
    if (!btn) return
    const rect = btn.getBoundingClientRect()
    const found = DISPLAY_FAMILIES.findIndex((f) => f.shades.includes(value))
    setPicker({ familyIdx: found >= 0 ? found : 0, top: rect.bottom + 4, left: Math.max(4, rect.left) })
  }

  return (
    <>
      <button
        ref={triggerRef}
        className={`${styles.colorTrigger} ${picker ? styles.colorTriggerOpen : ''}`}
        style={{ '--swatch': value } as React.CSSProperties}
        onClick={toggle}
        title={title}
      />
      {picker && (
        <div
          ref={shadePickerRef}
          className={styles.colorPopup}
          style={{ top: picker.top, left: picker.left }}
        >
          {auto && (
            <button
              className={`${styles.autoColorBtn} ${auto.active ? styles.active : ''}`}
              onClick={() => { auto.onClick(); setPicker(null) }}
              title={auto.title}
            >
              <RefreshCw size={11} strokeWidth={1.75} />
              <span>Auto</span>
            </button>
          )}
          <div className={styles.familyGrid}>
            {DISPLAY_FAMILIES.map(({ name, shades }, fi) => (
              <button
                key={name}
                className={`${styles.familySwatch} ${picker.familyIdx === fi ? styles.familySelected : ''}`}
                style={{ '--swatch': shades[5] } as React.CSSProperties}
                onClick={() => { onChange(shades[5]); setPicker({ ...picker, familyIdx: fi }) }}
                title={name}
              />
            ))}
            {/* White: no shade row to open, just select it directly. */}
            <button
              className={`${styles.familySwatch} ${styles.whiteSwatch} ${value === WHITE ? styles.familySelected : ''}`}
              style={{ '--swatch': WHITE } as React.CSSProperties}
              onClick={() => { onChange(WHITE); setPicker(null) }}
              title="White"
            />
          </div>
          <div className={styles.shadePickerLabel}>{DISPLAY_FAMILIES[picker.familyIdx].name}</div>
          <div className={styles.shadeSwatches}>
            {DISPLAY_FAMILIES[picker.familyIdx].shades.map((hex, si) => (
              <button
                key={si}
                className={`${styles.shadeSwatch} ${value === hex ? styles.shadeActive : ''}`}
                style={{ '--swatch': hex } as React.CSSProperties}
                onClick={() => { onChange(hex); setPicker(null) }}
                title={`${DISPLAY_FAMILIES[picker.familyIdx].name}-${TAILWIND_SHADE_NAMES[si]}`}
              />
            ))}
          </div>
          {/* Picked (eyedropper) colors — pipette icon marks the section. */}
          {recentColors.length > 0 && (
            <div className={styles.popupPickedRow}>
              <span className={styles.pickedDivider} title="Picked colors">
                <Pipette size={12} strokeWidth={2} />
              </span>
              {recentColors.map((hex) => (
                <button
                  key={hex}
                  className={`${styles.shadeSwatch} ${value === hex ? styles.shadeActive : ''}`}
                  style={{ '--swatch': hex } as React.CSSProperties}
                  onClick={() => { onChange(hex); setPicker(null) }}
                  title={`Picked ${hex}`}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </>
  )
}
