import fs from "node:fs/promises"
import path from "node:path"
import { chromium } from "playwright"

const ROOT = process.cwd()
const OUTPUT_ROOT = path.join(ROOT, "public", "audio-startup")
const STARTUP_DURATION_SEC = 10
const TAIL_START_SEC = 7.5
const TAIL_DURATION_SEC = 8
const CONTINUATION_BOUNDARY_FINGERPRINT_WINDOW_FRAMES = 128
const CONTINUATION_CHUNKS = [
  {
    startSec: STARTUP_DURATION_SEC,
    durationSec: 8,
    label: "continuation-10s-8s",
  },
  {
    startSec: STARTUP_DURATION_SEC + 8,
    durationSec: 8,
    label: "continuation-18s-8s",
  },
]

const TARGETS = [
  {
    slug: "terek-ne-vo-daleche",
    sources: [
      {
        src: "public/audio/terek-ne_vo_daleche/terek-ne_vo_daleche-01.mp3",
        output: "public/audio-startup/terek-ne_vo_daleche/terek-ne_vo_daleche-01-startup-10s.wav",
        tailOutput: "public/audio-startup/terek-ne_vo_daleche/terek-ne_vo_daleche-01-tail-8_5s-4s.wav",
      },
      {
        src: "public/audio/terek-ne_vo_daleche/terek-ne_vo_daleche-02.mp3",
        output: "public/audio-startup/terek-ne_vo_daleche/terek-ne_vo_daleche-02-startup-10s.wav",
        tailOutput: "public/audio-startup/terek-ne_vo_daleche/terek-ne_vo_daleche-02-tail-8_5s-4s.wav",
      },
    ],
  },
  {
    slug: "terek-mne-mladcu-malym-spalos",
    sources: [
      {
        src: "public/audio/terek-mne_mladcu_35k/terek-mne_mladcu_35k-01.mp3",
        output: "public/audio-startup/terek-mne_mladcu_35k/terek-mne_mladcu_35k-01-startup-10s.wav",
        tailOutput: "public/audio-startup/terek-mne_mladcu_35k/terek-mne_mladcu_35k-01-tail-8_5s-4s.wav",
      },
      {
        src: "public/audio/terek-mne_mladcu_35k/terek-mne_mladcu_35k-02.mp3",
        output: "public/audio-startup/terek-mne_mladcu_35k/terek-mne_mladcu_35k-02-startup-10s.wav",
        tailOutput: "public/audio-startup/terek-mne_mladcu_35k/terek-mne_mladcu_35k-02-tail-8_5s-4s.wav",
      },
    ],
  },
  {
    slug: "tomsk-bogoslovka-po-moryam",
    sources: [
      {
        src: "public/audio/tomsk-bogoslovka-po-moryam/tomsk-bogoslovka-po-moryam-01.m4a",
        output: "public/audio-startup/tomsk-bogoslovka-po-moryam/tomsk-bogoslovka-po-moryam-01-startup-10s.wav",
        tailOutput: "public/audio-startup/tomsk-bogoslovka-po-moryam/tomsk-bogoslovka-po-moryam-01-tail-8_5s-4s.wav",
      },
      {
        src: "public/audio/tomsk-bogoslovka-po-moryam/tomsk-bogoslovka-po-moryam-02.m4a",
        output: "public/audio-startup/tomsk-bogoslovka-po-moryam/tomsk-bogoslovka-po-moryam-02-startup-10s.wav",
        tailOutput: "public/audio-startup/tomsk-bogoslovka-po-moryam/tomsk-bogoslovka-po-moryam-02-tail-8_5s-4s.wav",
      },
      {
        src: "public/audio/tomsk-bogoslovka-po-moryam/tomsk-bogoslovka-po-moryam-03.m4a",
        output: "public/audio-startup/tomsk-bogoslovka-po-moryam/tomsk-bogoslovka-po-moryam-03-startup-10s.wav",
        tailOutput: "public/audio-startup/tomsk-bogoslovka-po-moryam/tomsk-bogoslovka-po-moryam-03-tail-8_5s-4s.wav",
      },
    ],
  },
  {
    slug: "balman-vechor-devku",
    sources: [
      {
        src: "public/audio/balman-vechor_devku/balman-vechor_devku-01.mp3",
        output: "public/audio-startup/balman-vechor_devku/balman-vechor_devku-01-startup-10s.wav",
        tailOutput: "public/audio-startup/balman-vechor_devku/balman-vechor_devku-01-tail-8_5s-4s.wav",
      },
      {
        src: "public/audio/balman-vechor_devku/balman-vechor_devku-02.mp3",
        output: "public/audio-startup/balman-vechor_devku/balman-vechor_devku-02-startup-10s.wav",
        tailOutput: "public/audio-startup/balman-vechor_devku/balman-vechor_devku-02-tail-8_5s-4s.wav",
      },
      {
        src: "public/audio/balman-vechor_devku/balman-vechor_devku-03.mp3",
        output: "public/audio-startup/balman-vechor_devku/balman-vechor_devku-03-startup-10s.wav",
        tailOutput: "public/audio-startup/balman-vechor_devku/balman-vechor_devku-03-tail-8_5s-4s.wav",
      },
    ],
  },
  {
    slug: "balman-ty-zorya-moya",
    sources: [
      {
        src: "public/audio/balman-ty_zorya_moya/balman-ty_zorya_moya-01.mp3",
        output: "public/audio-startup/balman-ty_zorya_moya/balman-ty_zorya_moya-01-startup-10s.wav",
        tailOutput: "public/audio-startup/balman-ty_zorya_moya/balman-ty_zorya_moya-01-tail-8_5s-4s.wav",
      },
      {
        src: "public/audio/balman-ty_zorya_moya/balman-ty_zorya_moya-02.mp3",
        output: "public/audio-startup/balman-ty_zorya_moya/balman-ty_zorya_moya-02-startup-10s.wav",
        tailOutput: "public/audio-startup/balman-ty_zorya_moya/balman-ty_zorya_moya-02-tail-8_5s-4s.wav",
      },
      {
        src: "public/audio/balman-ty_zorya_moya/balman-ty_zorya_moya-03.mp3",
        output: "public/audio-startup/balman-ty_zorya_moya/balman-ty_zorya_moya-03-startup-10s.wav",
        tailOutput: "public/audio-startup/balman-ty_zorya_moya/balman-ty_zorya_moya-03-tail-8_5s-4s.wav",
      },
    ],
  },
  {
    slug: "balman-seyu-veyu",
    sources: [
      {
        src: "public/audio/balman-seyu_veyu/balman-seyu-veyu-01.m4a",
        output: "public/audio-startup/balman-seyu_veyu/balman-seyu-veyu-01-startup-10s.wav",
        tailOutput: "public/audio-startup/balman-seyu_veyu/balman-seyu-veyu-01-tail-8_5s-4s.wav",
      },
      {
        src: "public/audio/balman-seyu_veyu/balman-seyu-veyu-02.m4a",
        output: "public/audio-startup/balman-seyu_veyu/balman-seyu-veyu-02-startup-10s.wav",
        tailOutput: "public/audio-startup/balman-seyu_veyu/balman-seyu-veyu-02-tail-8_5s-4s.wav",
      },
      {
        src: "public/audio/balman-seyu_veyu/balman-seyu-veyu-03.m4a",
        output: "public/audio-startup/balman-seyu_veyu/balman-seyu-veyu-03-startup-10s.wav",
        tailOutput: "public/audio-startup/balman-seyu_veyu/balman-seyu-veyu-03-tail-8_5s-4s.wav",
      },
    ],
  },
]

function toPosix(value) {
  return value.split(path.sep).join("/")
}

function resolveContinuationOutput(outputPath, chunk) {
  const parsed = path.parse(outputPath)
  return path.join(parsed.dir, `${parsed.name.replace(/-startup-\d+s$/, "")}-${chunk.label}.wav`)
}

async function ensureDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
}

async function generateChunk(page, sourcePath, startSec, durationSec) {
  const sourceBytes = await fs.readFile(sourcePath)
  const base64 = sourceBytes.toString("base64")
  return page.evaluate(
    async ({ base64Audio, chunkStartSec, chunkDurationSec, fingerprintWindowFrames }) => {
      const decodeBase64 = (value) => {
        const binary = atob(value)
        const out = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i)
        return out.buffer
      }

      const quantizeSampleForWav = (sample) => {
        const clamped = Math.max(-1, Math.min(1, sample ?? 0))
        const int16 = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff
        return Math.max(-0x8000, Math.min(0x7fff, Math.round(int16)))
      }

      const hashFrameWindow = (channels, startFrame, frameLength) => {
        let hash = 2166136261 >>> 0
        const safeStartFrame = Math.max(0, Math.floor(startFrame))
        const safeEndFrame = safeStartFrame + Math.max(0, Math.floor(frameLength))
        for (const channel of channels) {
          for (let frameIndex = safeStartFrame; frameIndex < safeEndFrame; frameIndex += 1) {
            const quantized = quantizeSampleForWav(channel[frameIndex])
            hash ^= quantized & 0xffff
            hash = Math.imul(hash, 16777619) >>> 0
          }
        }
        return hash.toString(16).padStart(8, "0")
      }

      const computeBoundaryFingerprint = (audioBuffer, startFrame, frameLength, windowFrames) => {
        const channels = Array.from(
          { length: audioBuffer.numberOfChannels },
          (_, channelIndex) => audioBuffer.getChannelData(channelIndex)
        )
        const safeWindowFrames = Math.max(1, Math.min(frameLength, Math.floor(windowFrames)))
        return {
          windowFrames: safeWindowFrames,
          firstHash: hashFrameWindow(channels, startFrame, safeWindowFrames),
          lastHash: hashFrameWindow(channels, startFrame + Math.max(0, frameLength - safeWindowFrames), safeWindowFrames),
        }
      }

      const writeAscii = (view, offset, value) => {
        for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i))
      }

      const encodeWav = (audioBuffer, startFrame, frameLength) => {
        const channelCount = audioBuffer.numberOfChannels
        const sampleRate = audioBuffer.sampleRate
        const bytesPerSample = 2
        const blockAlign = channelCount * bytesPerSample
        const dataByteLength = frameLength * blockAlign
        const buffer = new ArrayBuffer(44 + dataByteLength)
        const view = new DataView(buffer)
        writeAscii(view, 0, "RIFF")
        view.setUint32(4, 36 + dataByteLength, true)
        writeAscii(view, 8, "WAVE")
        writeAscii(view, 12, "fmt ")
        view.setUint32(16, 16, true)
        view.setUint16(20, 1, true)
        view.setUint16(22, channelCount, true)
        view.setUint32(24, sampleRate, true)
        view.setUint32(28, sampleRate * blockAlign, true)
        view.setUint16(32, blockAlign, true)
        view.setUint16(34, 16, true)
        writeAscii(view, 36, "data")
        view.setUint32(40, dataByteLength, true)

        const channels = Array.from({ length: channelCount }, (_, channelIndex) => audioBuffer.getChannelData(channelIndex))
        let offset = 44
        for (let frameIndex = 0; frameIndex < frameLength; frameIndex += 1) {
          for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
            const sourceIndex = Math.min(channels[channelIndex].length - 1, startFrame + frameIndex)
            view.setInt16(offset, quantizeSampleForWav(channels[channelIndex][sourceIndex]), true)
            offset += 2
          }
        }

        let binary = ""
        const bytes = new Uint8Array(buffer)
        const chunkSize = 0x8000
        for (let i = 0; i < bytes.length; i += chunkSize) {
          const chunk = bytes.subarray(i, i + chunkSize)
          binary += String.fromCharCode(...chunk)
        }
        return btoa(binary)
      }

      const AudioContextCtor = window.AudioContext || window.webkitAudioContext
      if (!AudioContextCtor) throw new Error("AudioContext_unavailable")

      const ctx = new AudioContextCtor()
      try {
        const audioBuffer = await ctx.decodeAudioData(decodeBase64(base64Audio))
        const startFrame = Math.max(0, Math.min(audioBuffer.length - 1, Math.floor(chunkStartSec * audioBuffer.sampleRate)))
        const frameLength = Math.max(
          1,
          Math.min(audioBuffer.length - startFrame, Math.floor(chunkDurationSec * audioBuffer.sampleRate))
        )
        const wavBase64 = encodeWav(audioBuffer, startFrame, frameLength)
        return {
          wavBase64,
          sampleRate: audioBuffer.sampleRate,
          channels: audioBuffer.numberOfChannels,
          chunkStartSec: startFrame / audioBuffer.sampleRate,
          chunkDurationSec: frameLength / audioBuffer.sampleRate,
          expectedFrames: frameLength,
          boundaryFingerprint: computeBoundaryFingerprint(
            audioBuffer,
            startFrame,
            frameLength,
            fingerprintWindowFrames
          ),
          estimatedTotalDurationSec: audioBuffer.duration,
        }
      } finally {
        await ctx.close().catch(() => {})
      }
    },
    {
      base64Audio: base64,
      chunkStartSec: startSec,
      chunkDurationSec: durationSec,
      fingerprintWindowFrames: CONTINUATION_BOUNDARY_FINGERPRINT_WINDOW_FRAMES,
    }
  )
}

async function main() {
  await fs.mkdir(OUTPUT_ROOT, { recursive: true })
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  await page.setContent("<!doctype html><html><body></body></html>")
  const manifest = {
    generatedAt: new Date().toISOString(),
    startupDurationSec: STARTUP_DURATION_SEC,
    tailStartSec: TAIL_START_SEC,
    tailDurationSec: TAIL_DURATION_SEC,
    continuationChunks: CONTINUATION_CHUNKS.map((chunk) => ({
      startSec: chunk.startSec,
      durationSec: chunk.durationSec,
      label: chunk.label,
    })),
    tracks: [],
  }

  try {
    for (const target of TARGETS) {
      const targetEntry = { slug: target.slug, sources: [] }
      for (const source of target.sources) {
        const sourcePath = path.join(ROOT, source.src)
        const outputPath = path.join(ROOT, source.output)
        const tailOutputPath = path.join(ROOT, source.tailOutput)
        const startupResult = await generateChunk(page, sourcePath, 0, STARTUP_DURATION_SEC)
        const tailResult = await generateChunk(page, sourcePath, TAIL_START_SEC, TAIL_DURATION_SEC)
        const continuationResults = []
        for (const continuationChunk of CONTINUATION_CHUNKS) {
          const continuationOutput = resolveContinuationOutput(source.output, continuationChunk)
          const continuationResult = await generateChunk(
            page,
            sourcePath,
            continuationChunk.startSec,
            continuationChunk.durationSec
          )
          await ensureDir(path.join(ROOT, continuationOutput))
          await fs.writeFile(path.join(ROOT, continuationOutput), Buffer.from(continuationResult.wavBase64, "base64"))
          continuationResults.push({
            src: toPosix(continuationOutput),
            startSec: Number(continuationResult.chunkStartSec.toFixed(3)),
            durationSec: Number(continuationResult.chunkDurationSec.toFixed(3)),
            label: continuationChunk.label,
            expectedFrames: continuationResult.expectedFrames,
            boundaryFingerprint: continuationResult.boundaryFingerprint,
          })
        }
        await ensureDir(outputPath)
        await ensureDir(tailOutputPath)
        await fs.writeFile(outputPath, Buffer.from(startupResult.wavBase64, "base64"))
        await fs.writeFile(tailOutputPath, Buffer.from(tailResult.wavBase64, "base64"))
        targetEntry.sources.push({
          strategy: "splice",
          src: toPosix(source.src),
          startupSrc: toPosix(source.output),
          startupDurationSec: Number(startupResult.chunkDurationSec.toFixed(3)),
          tailSrc: toPosix(source.tailOutput),
          tailStartSec: Number(tailResult.chunkStartSec.toFixed(3)),
          tailDurationSec: Number(tailResult.chunkDurationSec.toFixed(3)),
          estimatedTotalDurationSec: Number(startupResult.estimatedTotalDurationSec.toFixed(3)),
          continuationChunks: continuationResults,
          channels: startupResult.channels,
          sampleRate: startupResult.sampleRate,
        })
      }
      manifest.tracks.push(targetEntry)
    }
  } finally {
    await browser.close()
  }

  const manifestPath = path.join(OUTPUT_ROOT, "startup-chunks-manifest.json")
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8")
  process.stdout.write(`${manifestPath}\n`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
