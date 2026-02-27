const EVENT_NAME = "rr-sound-player-slot-change"

type SlotRecord = {
  element: HTMLElement
}

type SlotRegistryState = {
  slots: SlotRecord[]
}

declare global {
  interface Window {
    __rrSoundPlayerSlotRegistry?: SlotRegistryState
  }
}

function state(): SlotRegistryState {
  if (typeof window === "undefined") return { slots: [] }
  if (!window.__rrSoundPlayerSlotRegistry) {
    window.__rrSoundPlayerSlotRegistry = { slots: [] }
  }
  return window.__rrSoundPlayerSlotRegistry
}

function emitChange() {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(EVENT_NAME))
}

function pruneDisconnectedSlots() {
  const s = state()
  const before = s.slots.length
  s.slots = s.slots.filter((slot) => slot.element.isConnected)
  if (s.slots.length !== before) emitChange()
}

export function registerSoundPlayerSlot(element: HTMLElement): () => void {
  if (typeof window === "undefined") return () => {}
  const s = state()
  const existingIndex = s.slots.findIndex((slot) => slot.element === element)
  if (existingIndex >= 0) {
    s.slots.splice(existingIndex, 1)
  }
  s.slots.push({ element })
  emitChange()
  return () => {
    const nextState = state()
    const index = nextState.slots.findIndex((slot) => slot.element === element)
    if (index < 0) return
    nextState.slots.splice(index, 1)
    emitChange()
  }
}

export function getLatestSoundPlayerSlot(): HTMLElement | null {
  if (typeof window === "undefined") return null
  pruneDisconnectedSlots()
  const slots = state().slots
  if (!slots.length) return null
  const latest = slots[slots.length - 1]
  return latest?.element ?? null
}

export function subscribeSoundPlayerSlot(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {}
  const handler = () => onChange()
  window.addEventListener(EVENT_NAME, handler as EventListener)
  return () => {
    window.removeEventListener(EVENT_NAME, handler as EventListener)
  }
}

