class RrAppendableQueueProcessor extends AudioWorkletProcessor {
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
    this.generation = 0;
    this.baseFrame = 0;
    this.playedFrames = 0;
    this.bufferedEndFrame = 0;
    this.discontinuityCount = 0;

    this.port.onmessage = (event) => {
      const data = event?.data;
      if (!data || typeof data !== "object") return;
      switch (data.type) {
        case "reset":
          this.resetState(data);
          break;
        case "setPlaying":
          if (Number.isFinite(data.generation)) {
            this.generation = Number(data.generation) | 0;
          }
          this.playing = !!data.playing;
          break;
        case "append":
          this.appendFrames(data);
          break;
        default:
          break;
      }
    };
  }

  resetState(data) {
    this.readIndex = 0;
    this.writeIndex = 0;
    this.availableFrames = 0;
    this.underrunFrames = 0;
    this.droppedFrames = 0;
    this.minAvailableFrames = 0;
    this.maxAvailableFrames = 0;
    this.playedFrames = 0;
    this.discontinuityCount = 0;
    this.generation = Number.isFinite(data.generation) ? (Number(data.generation) | 0) : 0;
    this.baseFrame = Number.isFinite(data.startFrame) ? (Number(data.startFrame) | 0) : 0;
    this.bufferedEndFrame = this.baseFrame;
  }

  appendFrames(data) {
    const generation = Number.isFinite(data.generation) ? (Number(data.generation) | 0) : this.generation;
    if (generation !== this.generation) return;

    const channels = Array.isArray(data.channels) ? data.channels : [];
    if (!channels.length) return;

    const startFrame = Number.isFinite(data.startFrame) ? (Number(data.startFrame) | 0) : this.bufferedEndFrame;
    const srcFrames = Math.max(0, Number(data.frames) | 0);
    if (!srcFrames) return;

    if (startFrame !== this.bufferedEndFrame) {
      this.discontinuityCount += 1;
      this.readIndex = 0;
      this.writeIndex = 0;
      this.availableFrames = 0;
      this.baseFrame = startFrame;
      this.playedFrames = 0;
      this.bufferedEndFrame = startFrame;
    }

    const availableByChannel = channels
      .map((ch) => (ch && typeof ch.length === "number" ? ch.length : 0))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (!availableByChannel.length) return;

    const frames = Math.min(srcFrames, ...availableByChannel);
    if (!frames) return;

    let srcOffset = 0;
    while (srcOffset < frames) {
      const writable = Math.min(this.ringFrames - this.availableFrames, frames - srcOffset);
      if (writable <= 0) {
        this.droppedFrames += frames - srcOffset;
        break;
      }

      const chunkA = Math.min(writable, this.ringFrames - this.writeIndex);
      const chunkB = writable - chunkA;

      for (let ch = 0; ch < this.channelCount; ch += 1) {
        const src = channels[ch];
        if (!src || src.length < srcOffset + chunkA) continue;
        this.buffers[ch].set(src.subarray(srcOffset, srcOffset + chunkA), this.writeIndex);
        if (chunkB > 0) {
          this.buffers[ch].set(src.subarray(srcOffset + chunkA, srcOffset + chunkA + chunkB), 0);
        }
      }

      this.writeIndex = (this.writeIndex + writable) % this.ringFrames;
      this.availableFrames += writable;
      this.bufferedEndFrame += writable;
      this.maxAvailableFrames = Math.max(this.maxAvailableFrames, this.availableFrames);
      srcOffset += writable;
    }
  }

  reportStats() {
    const payload = {
      type: "stats",
      availableFrames: this.availableFrames,
      minAvailableFrames: this.minAvailableFrames,
      maxAvailableFrames: this.maxAvailableFrames,
      underrunFrames: this.underrunFrames,
      droppedFrames: this.droppedFrames,
      playedFrame: this.baseFrame + this.playedFrames,
      bufferedEndFrame: this.bufferedEndFrame,
      discontinuityCount: this.discontinuityCount,
      generation: this.generation,
    };
    this.framesSinceReport = 0;
    this.minAvailableFrames = this.availableFrames;
    this.maxAvailableFrames = this.availableFrames;
    try {
      this.port.postMessage(payload);
    } catch {}
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
      this.framesSinceReport += frames;
      if (this.framesSinceReport >= this.reportEveryFrames) {
        this.reportStats();
      }
      return true;
    }

    for (let i = 0; i < frames; i += 1) {
      if (this.availableFrames > 0) {
        for (let ch = 0; ch < output.length; ch += 1) {
          output[ch][i] = this.buffers[ch]?.[this.readIndex] ?? 0;
        }
        this.readIndex = (this.readIndex + 1) % this.ringFrames;
        this.availableFrames -= 1;
      } else {
        for (let ch = 0; ch < output.length; ch += 1) {
          output[ch][i] = 0;
        }
        this.underrunFrames += 1;
      }
      this.playedFrames += 1;
    }

    this.minAvailableFrames = Math.min(this.minAvailableFrames, this.availableFrames);
    this.maxAvailableFrames = Math.max(this.maxAvailableFrames, this.availableFrames);

    this.framesSinceReport += frames;
    if (this.framesSinceReport >= this.reportEveryFrames) {
      this.reportStats();
    }

    return true;
  }
}

registerProcessor("rr-appendable-queue", RrAppendableQueueProcessor);
