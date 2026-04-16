import { type ReactNode, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

interface Props {
  text: string
  children: ReactNode
  side?: 'top' | 'right'
}

const GAP = 8 // px between cursor and tooltip edge

// Don't show tooltips on touch-only devices (no hover capability)
const supportsHover = window.matchMedia('(hover: hover)').matches

export default function Tooltip({ text, children }: Props) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const anchorRef = useRef<HTMLSpanElement>(null)

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!supportsHover) return
    setPos({ x: e.clientX, y: e.clientY })
  }

  const tooltipEl =
    pos !== null
      ? createPortal(
          <span
            className="pointer-events-none fixed z-[9999] px-2 py-1 rounded bg-[#111827] text-[#e5e7eb] text-[10px] leading-relaxed shadow-xl max-w-[160px] break-words text-left"
            style={{
              left: pos.x + GAP,
              top: pos.y,
              transform: 'translateY(-50%)',
            }}
          >
            {text}
          </span>,
          document.body,
        )
      : null

  return (
    <span
      ref={anchorRef}
      className="inline-flex items-center"
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setPos(null)}
    >
      {children}
      {tooltipEl}
    </span>
  )
}
