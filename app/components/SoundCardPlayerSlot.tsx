"use client"

import { useLayoutEffect, useRef } from "react"
import { registerSoundPlayerSlot } from "../lib/soundPlayerSlotRegistry"

type SoundCardPlayerSlotProps = {
  slug: string
}

export default function SoundCardPlayerSlot({ slug: _slug }: SoundCardPlayerSlotProps) {
  const slotRef = useRef<HTMLDivElement | null>(null)

  useLayoutEffect(() => {
    const slot = slotRef.current
    if (!slot) return
    return registerSoundPlayerSlot(slot)
  }, [])

  return (
    <div data-player-slug={_slug}>
      <div id="rr-sound-player-slot" ref={slotRef} />
    </div>
  )
}
