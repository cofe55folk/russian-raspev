class AudioDebugMasterTapProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()

    const processorOptions = options?.processorOptions || {}
    this.channelCount = Math.max(1, processorOptions.channelCount || 2)
    this.chunkFrames = Math.max(1024, processorOptions.chunkFrames || 4096)
    this.clickThreshold = Math.max(0.02, processorOptions.clickThreshold || 0.07)
    this.clickCooldownFrames = Math.max(1024, processorOptions.clickCooldownFrames || Math.floor(sampleRate * 0.08))
    this.frameCursor = 0
    this.lastMonoSample = 0
    this.lastClickFrame = -this.clickCooldownFrames
    this.chunkBuffer = new Int16Array(this.chunkFrames)
    this.chunkWrite = 0
    this.droppedMessages = 0
    this.port.onmessage = (event) => {
      const type = event?.data?.type
      if (type === "flush") {
        const token = event?.data?.token ?? null
        const framesBeforeFlush = this.chunkWrite
        this.flushChunk()
        try {
          this.port.postMessage({
            type: "flush_ack",
            token,
            framesFlushed: framesBeforeFlush,
          })
        } catch {
          this.droppedMessages += 1
        }
      }
    }
  }

  flushChunk() {
    if (this.chunkWrite <= 0) return
    const payload = this.chunkBuffer.slice(0, this.chunkWrite)
    try {
      this.port.postMessage(
        {
          type: "chunk",
          frames: this.chunkWrite,
          samples: payload.buffer,
        },
        [payload.buffer]
      )
    } catch {
      this.droppedMessages += 1
    }
    this.chunkBuffer = new Int16Array(this.chunkFrames)
    this.chunkWrite = 0
  }

  process(inputs, outputs) {
    const input = inputs?.[0]
    const output = outputs?.[0]
    if (!output?.length) return true

    const frames = output[0]?.length ?? 0
    if (!frames) return true

    for (let ch = 0; ch < output.length; ch += 1) {
      const src = input?.[ch]
      if (src?.length) {
        output[ch].set(src)
      } else {
        output[ch].fill(0)
      }
    }

    if (!input?.length || !input[0]?.length) {
      this.frameCursor += frames
      return true
    }

    for (let i = 0; i < frames; i += 1) {
      let mono = 0
      let contributing = 0
      for (let ch = 0; ch < input.length; ch += 1) {
        const sample = input[ch]?.[i]
        if (typeof sample !== "number") continue
        mono += sample
        contributing += 1
      }
      mono = contributing > 0 ? mono / contributing : 0

      const deltaAbs = Math.abs(mono - this.lastMonoSample)
      if (deltaAbs >= this.clickThreshold && this.frameCursor - this.lastClickFrame >= this.clickCooldownFrames) {
        this.lastClickFrame = this.frameCursor
        try {
          this.port.postMessage({
            type: "click",
            deltaAbs,
            frameCursorFrames: this.frameCursor,
            outputSec: Number((this.frameCursor / sampleRate).toFixed(6)),
            droppedMessages: this.droppedMessages,
          })
        } catch {
          this.droppedMessages += 1
        }
      }
      this.lastMonoSample = mono

      const clamped = Math.max(-1, Math.min(1, mono))
      const pcm = clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff)
      this.chunkBuffer[this.chunkWrite] = pcm
      this.chunkWrite += 1
      if (this.chunkWrite >= this.chunkFrames) {
        this.flushChunk()
      }
      this.frameCursor += 1
    }

    return true
  }
}

registerProcessor("audio-debug-master-tap", AudioDebugMasterTapProcessor)
