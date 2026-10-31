import { Fragment } from 'react'
import arrowLeft from 'lucide-static/icons/arrow-left.svg?raw'
import arrowRight from 'lucide-static/icons/arrow-right.svg?raw'
import arrowUp from 'lucide-static/icons/arrow-up.svg?raw'
import arrowDown from 'lucide-static/icons/arrow-down.svg?raw'
import './keys.css'

// Keystrokes shown as keycaps (act.key): one shared cap per combination.

/** Where keycaps show. Give `{ wide, compact }` to place them per layout. */
export type KeysAt = 'bottom' | 'top' | 'bottom-left' | 'bottom-right'

// Each keystroke is its own row of caps, so one still fading out never
// changes or recenters when the next arrives
export type Keys = { id: number; caps: string[]; show: boolean; down: boolean }

const KEYCAPS: Record<string, string> = { cmd: '⌘', shift: '⇧', alt: '⌥', option: '⌥', ctrl: '⌃', enter: '↵', return: '↵', esc: 'esc', tab: '⇥', up: '↑', down: '↓', left: '←', right: '→', backspace: '⌫' }

const ARROWS: Record<string, string> = { '←': arrowLeft, '→': arrowRight, '↑': arrowUp, '↓': arrowDown }

/** 'cmd+k' as caps: ['⌘', 'K']. */
export const capsOf = (combo: string) => combo.split('+').map((k) => KEYCAPS[k.trim().toLowerCase()] ?? k.trim().toUpperCase())

/** The last row (fading out) and the current one. */
export function Keycaps({ rows, at }: { rows: (Keys | null)[]; at: KeysAt }) {
  return (
    <>
      {rows.map(
        (row) =>
          row && (
            <div key={row.id} className="ss-keys" data-show={row.show} data-at={at} aria-hidden>
              <kbd className="ss-key" data-down={row.down}>
                {row.caps.map((c, i) => (
                  <Fragment key={i}>
                    {i > 0 && <span className="ss-key-separator">+</span>}
                    <span>{ARROWS[c] ? <span className="ss-key-arrow" dangerouslySetInnerHTML={{ __html: ARROWS[c] }} /> : c}</span>
                  </Fragment>
                ))}
              </kbd>
            </div>
          ),
      )}
    </>
  )
}
