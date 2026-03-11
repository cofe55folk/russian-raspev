export type AudioPilotEngineMode = "soundtouch" | "streaming_media" | "ringbuffer_worklet" | "appendable_queue_worklet"

export type AudioPilotRouting = {
  engineMode: AudioPilotEngineMode
  useStreamingPilot: boolean
  useAppendableQueuePilot: boolean
  useAppendableQueueMultistemPilot: boolean
  useRingBufferPilot: boolean
  appendableFlagsReady: boolean
  appendableBlockedByStreaming: boolean
  appendableActivationConfigured: boolean
  appendableActivationAllowed: boolean
  appendableBlockedByTargeting: boolean
}

export type AudioPilotRoutingInput = {
  trackCount: number
  streamingBufferPilotEnabled: boolean
  appendableQueuePilotEnabled: boolean
  appendableQueueMultistemPilotEnabled: boolean
  ringBufferPilotEnabled: boolean
  appendableActivationConfigured?: boolean
  appendableActivationAllowed?: boolean
}

export function resolveAudioPilotRouting({
  trackCount,
  streamingBufferPilotEnabled,
  appendableQueuePilotEnabled,
  appendableQueueMultistemPilotEnabled,
  ringBufferPilotEnabled,
  appendableActivationConfigured = false,
  appendableActivationAllowed = true,
}: AudioPilotRoutingInput): AudioPilotRouting {
  const useStreamingPilot = streamingBufferPilotEnabled
  const appendableFlagsReady = appendableQueuePilotEnabled && (trackCount === 1 || appendableQueueMultistemPilotEnabled)
  const appendableBlockedByTargeting = appendableFlagsReady && appendableActivationConfigured && !appendableActivationAllowed
  const useAppendableQueueMultistemPilot =
    appendableQueuePilotEnabled &&
    appendableQueueMultistemPilotEnabled &&
    appendableActivationAllowed &&
    !useStreamingPilot &&
    trackCount > 1
  const useAppendableQueuePilot = appendableFlagsReady && appendableActivationAllowed && !useStreamingPilot
  const useRingBufferPilot = ringBufferPilotEnabled && !useStreamingPilot && !useAppendableQueuePilot

  return {
    engineMode: useStreamingPilot
      ? "streaming_media"
      : useAppendableQueuePilot
        ? "appendable_queue_worklet"
        : useRingBufferPilot
          ? "ringbuffer_worklet"
          : "soundtouch",
    useStreamingPilot,
    useAppendableQueuePilot,
    useAppendableQueueMultistemPilot,
    useRingBufferPilot,
    appendableFlagsReady,
    appendableBlockedByStreaming:
      appendableFlagsReady && appendableActivationAllowed && useStreamingPilot && !useAppendableQueuePilot,
    appendableActivationConfigured,
    appendableActivationAllowed,
    appendableBlockedByTargeting,
  }
}
