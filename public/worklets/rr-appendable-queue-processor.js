import { SimpleFilter, SoundTouch } from "./soundtouch.js";

const SAB_STATE = {
  readIndex: 0,
  writeIndex: 1,
  availableFrames: 2,
  bufferedEndFrame: 3,
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

class AppendableSoundTouchSource {
  constructor(processor) {
    this.processor = processor;
    this.position = 0;
  }

  extract(target, numFrames) {
    const written = this.processor.extractSourceFrames(target, numFrames);
    this.position += written;
    this.processor.playedFrame = this.position;
    return written;
  }

  setPosition(frame) {
    this.position = Math.max(0, Number(frame) | 0);
    this.processor.playedFrame = this.position;
  }

  getPosition() {
    return this.position;
  }
}

class RrAppendableQueueProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();

    const processorOptions = options?.processorOptions || {};
    this.channelCount = Math.max(1, processorOptions.channelCount || 2);
    this.ringFrames = Math.max(8192, processorOptions.ringFrames || 131072);
    this.dataPlaneMode = "postmessage_pcm";
    this.sabState = null;
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
    this.playedFrame = 0;
    this.bufferedEndFrame = 0;
    this.discontinuityCount = 0;
    this.tempo = 1;
    this.pitchSemitones = 0;
    this.outputInterleaved = new Float32Array(4096 * 2);
    this.source = new AppendableSoundTouchSource(this);
    this.st = new SoundTouch(sampleRate);
    this.st.tempo = this.tempo;
    this.st.pitch = 1;
    this.st.pitchSemitones = this.pitchSemitones;
    this.filter = new SimpleFilter(this.source, this.st);

    this.port.onmessage = (event) => {
      const data = event?.data;
      if (!data || typeof data !== "object") return;
      switch (data.type) {
        case "configureSabRing":
          this.configureSabRing(data);
          break;
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
        case "setTempo":
          this.setTempo(data);
          break;
        case "setPitchSemitones":
          this.setPitchSemitones(data);
          break;
        default:
          break;
      }
    };
  }

  ensureOutputBuffer(frameCount) {
    const needed = Math.max(256, frameCount | 0) * 2;
    if (this.outputInterleaved.length >= needed) return;
    this.outputInterleaved = new Float32Array(needed);
  }

  getAvailableFrames() {
    if (this.sabState) {
      const availableFrames = Math.max(0, Atomics.load(this.sabState, SAB_STATE.availableFrames) | 0);
      this.availableFrames = availableFrames;
      return availableFrames;
    }
    return this.availableFrames;
  }

  getReadIndex() {
    if (this.sabState) {
      const readIndex = Math.max(0, Atomics.load(this.sabState, SAB_STATE.readIndex) | 0) % this.ringFrames;
      this.readIndex = readIndex;
      return readIndex;
    }
    return this.readIndex;
  }

  getBufferedEndFrame() {
    if (this.sabState) {
      const bufferedEndFrame = Math.max(0, Atomics.load(this.sabState, SAB_STATE.bufferedEndFrame) | 0);
      this.bufferedEndFrame = bufferedEndFrame;
      return bufferedEndFrame;
    }
    return this.bufferedEndFrame;
  }

  setReadIndex(nextReadIndex) {
    const safeReadIndex = Math.max(0, nextReadIndex | 0) % this.ringFrames;
    this.readIndex = safeReadIndex;
    if (this.sabState) {
      Atomics.store(this.sabState, SAB_STATE.readIndex, safeReadIndex);
    }
  }

  consumeAvailableFrames(frameCount) {
    const safeFrameCount = Math.max(0, frameCount | 0);
    if (this.sabState) {
      const nextAvailableFrames = Atomics.sub(this.sabState, SAB_STATE.availableFrames, safeFrameCount) - safeFrameCount;
      this.availableFrames = Math.max(0, nextAvailableFrames);
      return this.availableFrames;
    }
    this.availableFrames = Math.max(0, this.availableFrames - safeFrameCount);
    return this.availableFrames;
  }

  clearProcessorState() {
    try {
      this.filter.clear();
    } catch {}
    try {
      this.st.clear();
    } catch {}
    this.source.setPosition(this.baseFrame);
    this.playedFrame = this.baseFrame;
  }

  configureSabRing(data) {
    if (!(data.stateSab instanceof SharedArrayBuffer) || !Array.isArray(data.dataSabs) || !data.dataSabs.length) {
      return;
    }
    const buffers = [];
    for (let channelIndex = 0; channelIndex < this.channelCount; channelIndex += 1) {
      const sab = data.dataSabs[channelIndex];
      if (!(sab instanceof SharedArrayBuffer)) {
        return;
      }
      buffers.push(new Float32Array(sab));
    }
    this.sabState = new Int32Array(data.stateSab);
    this.buffers = buffers;
    this.dataPlaneMode = "sab_ring";
    this.readIndex = this.getReadIndex();
    this.availableFrames = this.getAvailableFrames();
    this.bufferedEndFrame = this.getBufferedEndFrame();
  }

  resetState(data) {
    this.readIndex = 0;
    this.writeIndex = 0;
    this.availableFrames = 0;
    this.underrunFrames = 0;
    this.droppedFrames = 0;
    this.minAvailableFrames = 0;
    this.maxAvailableFrames = 0;
    this.discontinuityCount = 0;
    this.generation = Number.isFinite(data.generation) ? (Number(data.generation) | 0) : 0;
    this.baseFrame = Number.isFinite(data.startFrame) ? (Number(data.startFrame) | 0) : 0;
    this.bufferedEndFrame = this.baseFrame;
    if (this.sabState) {
      Atomics.store(this.sabState, SAB_STATE.readIndex, 0);
      Atomics.store(this.sabState, SAB_STATE.writeIndex, 0);
      Atomics.store(this.sabState, SAB_STATE.availableFrames, 0);
      Atomics.store(this.sabState, SAB_STATE.bufferedEndFrame, this.baseFrame);
    }
    this.clearProcessorState();
  }

  setTempo(data) {
    const nextTempo = clamp(Number.isFinite(data.tempo) ? Number(data.tempo) : 1, 0.25, 4);
    this.tempo = nextTempo;
    this.st.tempo = nextTempo;
  }

  setPitchSemitones(data) {
    const nextPitchSemitones = clamp(
      Number.isFinite(data.pitchSemitones) ? Number(data.pitchSemitones) : this.pitchSemitones,
      -12,
      12
    );
    this.pitchSemitones = nextPitchSemitones;
    try {
      this.st.pitchSemitones = nextPitchSemitones;
    } catch {}
  }

  appendFrames(data) {
    if (this.dataPlaneMode === "sab_ring") return;

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
      this.bufferedEndFrame = startFrame;
      this.clearProcessorState();
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

  extractSourceFrames(target, numFrames) {
    const framesToRead = Math.min(Math.max(0, numFrames | 0), this.getAvailableFrames());
    if (framesToRead <= 0) {
      return 0;
    }

    let written = 0;
    while (written < framesToRead) {
      const readIndex = this.getReadIndex();
      const chunkFrames = Math.min(framesToRead - written, this.ringFrames - readIndex);
      const left = this.buffers[0];
      const right = this.buffers[1] || left;

      for (let i = 0; i < chunkFrames; i += 1) {
        const outIndex = (written + i) * 2;
        target[outIndex] = left?.[readIndex + i] ?? 0;
        target[outIndex + 1] = right?.[readIndex + i] ?? target[outIndex];
      }

      this.setReadIndex(readIndex + chunkFrames);
      this.consumeAvailableFrames(chunkFrames);
      written += chunkFrames;
    }

    this.getBufferedEndFrame();
    return written;
  }

  reportStats() {
    const payload = {
      type: "stats",
      availableFrames: this.getAvailableFrames(),
      minAvailableFrames: this.minAvailableFrames,
      maxAvailableFrames: this.maxAvailableFrames,
      underrunFrames: this.underrunFrames,
      droppedFrames: this.droppedFrames,
      playedFrame: this.playedFrame,
      bufferedEndFrame: this.getBufferedEndFrame(),
      discontinuityCount: this.discontinuityCount,
      generation: this.generation,
      tempo: this.tempo,
      pitchSemitones: this.pitchSemitones,
    };
    this.framesSinceReport = 0;
    this.minAvailableFrames = payload.availableFrames;
    this.maxAvailableFrames = payload.availableFrames;
    try {
      this.port.postMessage(payload);
    } catch {}
  }

  process(_inputs, outputs) {
    const output = outputs?.[0];
    if (!output || !output.length || !output[0]) return true;

    const frames = output[0].length;
    this.ensureOutputBuffer(frames);
    const currentAvailableFrames = this.getAvailableFrames();
    this.minAvailableFrames = Math.min(this.minAvailableFrames, currentAvailableFrames);
    this.maxAvailableFrames = Math.max(this.maxAvailableFrames, currentAvailableFrames);

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

    let extracted = 0;
    try {
      extracted = this.filter.extract(this.outputInterleaved, frames);
    } catch {
      extracted = 0;
    }

    const safeExtracted = Math.max(0, Math.min(frames, Number.isFinite(extracted) ? extracted | 0 : 0));
    for (let ch = 0; ch < output.length; ch += 1) {
      const channel = output[ch];
      const interleavedOffset = ch === 0 ? 0 : 1;
      for (let i = 0; i < safeExtracted; i += 1) {
        channel[i] = this.outputInterleaved[i * 2 + interleavedOffset] || 0;
      }
      if (safeExtracted < frames) {
        channel.fill(0, safeExtracted);
      }
    }

    if (safeExtracted < frames) {
      this.underrunFrames += frames - safeExtracted;
    }

    const postProcessAvailableFrames = this.getAvailableFrames();
    this.minAvailableFrames = Math.min(this.minAvailableFrames, postProcessAvailableFrames);
    this.maxAvailableFrames = Math.max(this.maxAvailableFrames, postProcessAvailableFrames);
    this.framesSinceReport += frames;
    if (this.framesSinceReport >= this.reportEveryFrames) {
      this.reportStats();
    }

    return true;
  }
}

registerProcessor("rr-appendable-queue", RrAppendableQueueProcessor);
