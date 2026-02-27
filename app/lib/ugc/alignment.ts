export type WavAlignmentEstimate = {
  offsetMs: number;
  score: number;
  method: "rms_correlation";
};

type ParsedWavMono = {
  sampleRate: number;
  mono: Float32Array;
};

const TARGET_FEATURE_RATE = 120;
const MAX_LAG_MS = 5000;

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += String.fromCharCode(bytes[offset + i] || 0);
  }
  return out;
}

function readU16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function readU32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

function readI24(view: DataView, offset: number): number {
  const b0 = view.getUint8(offset);
  const b1 = view.getUint8(offset + 1);
  const b2 = view.getUint8(offset + 2);
  const unsigned = b0 | (b1 << 8) | (b2 << 16);
  return unsigned & 0x800000 ? unsigned - 0x1000000 : unsigned;
}

function clampSample(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v > 1) return 1;
  if (v < -1) return -1;
  return v;
}

function parseWavMono(bytes: Uint8Array): ParsedWavMono {
  if (bytes.byteLength < 44) throw new Error("ALIGNMENT_UNSUPPORTED_FORMAT");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (readAscii(bytes, 0, 4) !== "RIFF" || readAscii(bytes, 8, 4) !== "WAVE") {
    throw new Error("ALIGNMENT_UNSUPPORTED_FORMAT");
  }

  let fmtOffset = -1;
  let fmtSize = 0;
  let dataOffset = -1;
  let dataSize = 0;

  let cursor = 12;
  while (cursor + 8 <= bytes.byteLength) {
    const chunkId = readAscii(bytes, cursor, 4);
    const chunkSize = readU32(view, cursor + 4);
    const payloadOffset = cursor + 8;
    if (payloadOffset + chunkSize > bytes.byteLength) break;

    if (chunkId === "fmt ") {
      fmtOffset = payloadOffset;
      fmtSize = chunkSize;
    } else if (chunkId === "data") {
      dataOffset = payloadOffset;
      dataSize = chunkSize;
      break;
    }

    cursor = payloadOffset + chunkSize + (chunkSize % 2);
  }

  if (fmtOffset < 0 || dataOffset < 0 || fmtSize < 16 || dataSize < 4) {
    throw new Error("ALIGNMENT_UNSUPPORTED_FORMAT");
  }

  const audioFormat = readU16(view, fmtOffset);
  const channels = readU16(view, fmtOffset + 2);
  const sampleRate = readU32(view, fmtOffset + 4);
  const blockAlign = readU16(view, fmtOffset + 12);
  const bitsPerSample = readU16(view, fmtOffset + 14);

  const bytesPerSample = Math.floor(bitsPerSample / 8);
  if (!channels || !sampleRate || !blockAlign || !bytesPerSample) {
    throw new Error("ALIGNMENT_UNSUPPORTED_FORMAT");
  }
  if (audioFormat !== 1 && audioFormat !== 3) {
    throw new Error("ALIGNMENT_UNSUPPORTED_FORMAT");
  }
  if (audioFormat === 1 && ![16, 24, 32].includes(bitsPerSample)) {
    throw new Error("ALIGNMENT_UNSUPPORTED_FORMAT");
  }
  if (audioFormat === 3 && bitsPerSample !== 32) {
    throw new Error("ALIGNMENT_UNSUPPORTED_FORMAT");
  }

  const frames = Math.floor(dataSize / blockAlign);
  if (frames <= 0) throw new Error("ALIGNMENT_UNSUPPORTED_FORMAT");

  const mono = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame += 1) {
    let acc = 0;
    const frameOffset = dataOffset + frame * blockAlign;
    for (let ch = 0; ch < channels; ch += 1) {
      const sampleOffset = frameOffset + ch * bytesPerSample;
      let v = 0;
      if (audioFormat === 1 && bitsPerSample === 16) {
        v = view.getInt16(sampleOffset, true) / 32768;
      } else if (audioFormat === 1 && bitsPerSample === 24) {
        v = readI24(view, sampleOffset) / 8388608;
      } else if (audioFormat === 1 && bitsPerSample === 32) {
        v = view.getInt32(sampleOffset, true) / 2147483648;
      } else if (audioFormat === 3 && bitsPerSample === 32) {
        v = view.getFloat32(sampleOffset, true);
      }
      acc += clampSample(v);
    }
    mono[frame] = clampSample(acc / channels);
  }

  return { sampleRate, mono };
}

function makeEnergyFeature(signal: Float32Array, sampleRate: number): { feature: Float32Array; featureRate: number } {
  const step = Math.max(1, Math.floor(sampleRate / TARGET_FEATURE_RATE));
  const featureLength = Math.max(1, Math.floor(signal.length / step));
  const feature = new Float32Array(featureLength);

  for (let i = 0; i < featureLength; i += 1) {
    const start = i * step;
    const end = Math.min(signal.length, start + step);
    let sumAbs = 0;
    for (let j = start; j < end; j += 1) {
      sumAbs += Math.abs(signal[j]);
    }
    const windowSize = Math.max(1, end - start);
    feature[i] = sumAbs / windowSize;
  }

  let mean = 0;
  for (let i = 0; i < feature.length; i += 1) mean += feature[i];
  mean /= feature.length;

  let variance = 0;
  for (let i = 0; i < feature.length; i += 1) {
    const d = feature[i] - mean;
    variance += d * d;
  }
  variance /= feature.length;
  const std = Math.sqrt(variance);

  if (std > 1e-6) {
    for (let i = 0; i < feature.length; i += 1) {
      feature[i] = (feature[i] - mean) / std;
    }
  } else {
    feature.fill(0);
  }

  return { feature, featureRate: sampleRate / step };
}

function normalizedCorrelationAtLag(reference: Float32Array, target: Float32Array, lag: number): number {
  let sumXY = 0;
  let sumXX = 0;
  let sumYY = 0;
  let overlap = 0;

  if (lag >= 0) {
    const n = Math.min(reference.length, target.length - lag);
    if (n <= 2) return -1;
    overlap = n;
    for (let i = 0; i < n; i += 1) {
      const x = reference[i];
      const y = target[i + lag];
      sumXY += x * y;
      sumXX += x * x;
      sumYY += y * y;
    }
  } else {
    const shift = -lag;
    const n = Math.min(reference.length - shift, target.length);
    if (n <= 2) return -1;
    overlap = n;
    for (let i = 0; i < n; i += 1) {
      const x = reference[i + shift];
      const y = target[i];
      sumXY += x * y;
      sumXX += x * x;
      sumYY += y * y;
    }
  }

  const denom = Math.sqrt(sumXX * sumYY);
  if (!Number.isFinite(denom) || denom <= 1e-9) return -1;
  const raw = sumXY / denom;
  const overlapPenalty = overlap / Math.max(reference.length, target.length);
  return raw * overlapPenalty;
}

export function estimateWavStemAlignment(referenceBytes: Uint8Array, targetBytes: Uint8Array): WavAlignmentEstimate {
  const reference = parseWavMono(referenceBytes);
  const target = parseWavMono(targetBytes);

  const refFeature = makeEnergyFeature(reference.mono, reference.sampleRate);
  const targetFeature = makeEnergyFeature(target.mono, target.sampleRate);
  const featureRate = Math.max(1, Math.min(refFeature.featureRate, targetFeature.featureRate));

  const maxLagByMs = Math.floor((MAX_LAG_MS / 1000) * featureRate);
  const maxPossibleLag = Math.max(1, Math.min(maxLagByMs, refFeature.feature.length - 2, targetFeature.feature.length - 2));

  let bestLag = 0;
  let bestCorr = -1;

  for (let lag = -maxPossibleLag; lag <= maxPossibleLag; lag += 1) {
    const corr = normalizedCorrelationAtLag(refFeature.feature, targetFeature.feature, lag);
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }

  const offsetMs = Math.round((bestLag / featureRate) * 1000);
  const score = Number(Math.max(0, Math.min(1, (bestCorr + 1) / 2)).toFixed(3));

  return {
    offsetMs,
    score,
    method: "rms_correlation",
  };
}
