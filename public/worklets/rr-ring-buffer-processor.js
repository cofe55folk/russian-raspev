class RrRingBufferProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();

    const processorOptions = options?.processorOptions || {};
    this.channelCount = Math.max(1, processorOptions.channelCount || 2);
    this.ringFrames = Math.max(8192, processorOptions.ringFrames || 131072);
    this.buffers = Array.from({ length: this.channelCount }, () => new Float32Array(this.ringFrames));

    this.readIndex = 0;
    this.writeIndex = 0;
    this.availableFrames = 0;
    this.playing = false;
    this.underrunFrames = 0;
    this.droppedFrames = 0;
    this.framesSinceReport = 0;
    this.reportEveryFrames = 2048;
    this.minAvailableFrames = 0;
    this.maxAvailableFrames = 0;
    this.readWrapCount = 0;
    this.writeWrapCount = 0;
    this.lastReadWrapDeltaMax = 0;

    this.port.onmessage = (event) => {
      const data = event?.data;
      if (!data || typeof data !== "object") return;
      switch (data.type) {
        case "reset":
          this.readIndex = 0;
          this.writeIndex = 0;
          this.availableFrames = 0;
          this.underrunFrames = 0;
          this.droppedFrames = 0;
          this.minAvailableFrames = 0;
          this.maxAvailableFrames = 0;
          this.readWrapCount = 0;
          this.writeWrapCount = 0;
          this.lastReadWrapDeltaMax = 0;
          break;
        case "setPlaying":
          this.playing = !!data.playing;
          break;
        case "push":
          this.pushFrames(data.channels, data.frames);
          break;
        default:
          break;
      }
    };
  }

  pushFrames(channels, framesRaw) {
    if (!Array.isArray(channels) || channels.length === 0) return;
    const srcFrames = Math.max(0, Number(framesRaw) | 0);
    if (!srcFrames) return;

    const availableByChannel = channels
      .map((ch) => (ch && typeof ch.length === "number" ? ch.length : 0))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (!availableByChannel.length) return;

    const frames = Math.min(srcFrames, ...availableByChannel);
    if (!frames) return;

    let srcOffset = 0;
    while (srcOffset < frames) {
      if (this.availableFrames >= this.ringFrames) {
        // Drop oldest block to keep most recent data if producer outruns consumer.
        const dropFrames = Math.min(1024, this.availableFrames);
        this.readIndex = (this.readIndex + dropFrames) % this.ringFrames;
        this.availableFrames -= dropFrames;
        this.droppedFrames += dropFrames;
      }

      const writable = Math.min(this.ringFrames - this.availableFrames, frames - srcOffset);
      if (writable <= 0) break;

      const chunkA = Math.min(writable, this.ringFrames - this.writeIndex);
      const chunkB = writable - chunkA;
      const willWrapWrite = this.writeIndex + writable >= this.ringFrames;

      for (let ch = 0; ch < this.channelCount; ch += 1) {
        const src = channels[ch];
        if (!src || src.length < srcOffset + chunkA) continue;
        this.buffers[ch].set(src.subarray(srcOffset, srcOffset + chunkA), this.writeIndex);
        if (chunkB > 0) {
          this.buffers[ch].set(src.subarray(srcOffset + chunkA, srcOffset + chunkA + chunkB), 0);
        }
      }

      this.writeIndex = (this.writeIndex + writable) % this.ringFrames;
      if (willWrapWrite) {
        this.writeWrapCount += 1;
      }
      this.availableFrames += writable;
      this.maxAvailableFrames = Math.max(this.maxAvailableFrames, this.availableFrames);
      srcOffset += writable;
    }
  }

  process(_inputs, outputs) {
    const output = outputs?.[0];
    if (!output || !output.length || !output[0]) return true;

    const frames = output[0].length;
    this.minAvailableFrames = Math.min(this.minAvailableFrames, this.availableFrames);
    this.maxAvailableFrames = Math.max(this.maxAvailableFrames, this.availableFrames);
    if (!this.playing) {
      for (let ch = 0; ch < output.length; ch += 1) {
        output[ch].fill(0);
      }
      return true;
    }

    for (let i = 0; i < frames; i += 1) {
      if (this.availableFrames > 0) {
        for (let ch = 0; ch < output.length; ch += 1) {
          output[ch][i] = this.buffers[ch]?.[this.readIndex] ?? 0;
        }
        if (this.readIndex + 1 >= this.ringFrames) {
          let readWrapDeltaMax = 0;
          for (let ch = 0; ch < output.length; ch += 1) {
            const tailSample = output[ch][i] ?? 0;
            const headSample = this.buffers[ch]?.[0] ?? 0;
            readWrapDeltaMax = Math.max(readWrapDeltaMax, Math.abs(headSample - tailSample));
          }
          this.lastReadWrapDeltaMax = readWrapDeltaMax;
          this.readIndex = 0;
          this.readWrapCount += 1;
        } else {
          this.readIndex += 1;
        }
        this.availableFrames -= 1;
      } else {
        for (let ch = 0; ch < output.length; ch += 1) {
          output[ch][i] = 0;
        }
        this.underrunFrames += 1;
      }
    }

    this.minAvailableFrames = Math.min(this.minAvailableFrames, this.availableFrames);
    this.maxAvailableFrames = Math.max(this.maxAvailableFrames, this.availableFrames);

    this.framesSinceReport += frames;
    if (this.framesSinceReport >= this.reportEveryFrames) {
      const payload = {
        type: "stats",
        availableFrames: this.availableFrames,
        minAvailableFrames: this.minAvailableFrames,
        maxAvailableFrames: this.maxAvailableFrames,
        underrunFrames: this.underrunFrames,
        droppedFrames: this.droppedFrames,
        readWrapCount: this.readWrapCount,
        writeWrapCount: this.writeWrapCount,
        lastReadWrapDeltaMax: this.lastReadWrapDeltaMax,
      };
      this.framesSinceReport = 0;
      this.minAvailableFrames = this.availableFrames;
      this.maxAvailableFrames = this.availableFrames;
      try {
        this.port.postMessage(payload);
      } catch {}
    }

    return true;
  }
}

registerProcessor("rr-ring-buffer", RrRingBufferProcessor);
