/* public/worklets/soundtouch-processor.js */
importScripts("/worklets/soundtouch.js")

// Пытаемся достать конструкторы из UMD
const ST = self.soundtouch || self.SoundTouch || self
const SoundTouch = ST.SoundTouch || ST
const SimpleFilter = ST.SimpleFilter

class BufferSource {
  constructor(left, right) {
    this.left = left
    this.right = right || left
    this.position = 0 // samples
  }

  // soundtouchjs ожидает extract(target, numFrames, position)
  // position мы игнорируем, т.к. сами держим this.position
  extract(target, numFrames) {
    const L = this.left
    const R = this.right
    const len = L.length
    const out = target

    let i = 0
    const pos = this.position

    for (; i < numFrames; i++) {
      const p = pos + i
      if (p >= len) break
      out[i * 2] = L[p]
      out[i * 2 + 1] = R[p]
    }

    this.position += i
    return i
  }

  setPosition(samples) {
    this.position = Math.max(0, Math.min(samples, this.left.length))
  }

  getPosition() {
    return this.position
  }

  getLength() {
    return this.left.length
  }
}

class SoundTouchProcessor extends AudioWorkletProcessor {
  constructor() {
    super()

    this.ready = false
    this.playing = false

    this.sampleRate_ = sampleRate
    this.left = null
    this.right = null

    this.st = null
    this.src = null
    this.filter = null

    this.tempo = 1.0
    this.pitch = 1.0 // ratio, 1.0 = normal

    this._tmp = new Float32Array(4096 * 2) // interleaved L/R for extract

    this.port.onmessage = (e) => {
      const msg = e.data
      if (!msg || !msg.type) return

      if (msg.type === "init") {
        // msg.left/msg.right приходят как Float32Array
        this.left = msg.left
        this.right = msg.right || msg.left
        this.sampleRate_ = msg.sampleRate || sampleRate

        this.st = new SoundTouch(this.sampleRate_)
        this.st.tempo = this.tempo
        this.st.pitch = this.pitch

        this.src = new BufferSource(this.left, this.right)
        this.filter = new SimpleFilter(this.src, this.st)

        this.ready = true
        this.port.postMessage({ type: "ready" })
      }

      if (msg.type === "play") {
        this.playing = true
      }

      if (msg.type === "pause") {
        this.playing = false
      }

      if (msg.type === "seek") {
        if (!this.ready) return
        const samples = Math.floor((msg.seconds || 0) * this.sampleRate_)
        this.src.setPosition(samples)

        // ВАЖНО: сбрасываем внутренние буферы фильтра/алгоритма
        // (в soundtouchjs это обычно clear())
        try {
          this.filter.clear()
        } catch {}
        try {
          this.st.clear()
        } catch {}
      }

      if (msg.type === "set") {
        if (typeof msg.tempo === "number") {
          this.tempo = msg.tempo
          if (this.st) this.st.tempo = this.tempo
        }
        if (typeof msg.pitch === "number") {
          this.pitch = msg.pitch
          if (this.st) this.st.pitch = this.pitch
        }
      }

      if (msg.type === "getPos") {
        if (!this.ready) return
        const posSamples = this.src.getPosition()
        this.port.postMessage({
          type: "pos",
          seconds: posSamples / this.sampleRate_,
        })
      }
    }
  }

  process(inputs, outputs) {
    const out = outputs[0]
    const outL = out[0]
    const outR = out[1] || out[0]

    if (!this.ready) {
      outL.fill(0)
      outR.fill(0)
      return true
    }

    if (!this.playing) {
      outL.fill(0)
      outR.fill(0)
      return true
    }

    const frames = outL.length

    // вытаскиваем из filter интерлив L/R
    let extracted = 0
    try {
      extracted = this.filter.extract(this._tmp, frames)
    } catch {
      extracted = 0
    }

    if (extracted <= 0) {
      // конец буфера
      outL.fill(0)
      outR.fill(0)
      this.playing = false
      this.port.postMessage({ type: "ended" })
      return true
    }

    for (let i = 0; i < frames; i++) {
      outL[i] = this._tmp[i * 2] || 0
      outR[i] = this._tmp[i * 2 + 1] || 0
    }

    return true
  }
}

registerProcessor("soundtouch-processor", SoundTouchProcessor)
