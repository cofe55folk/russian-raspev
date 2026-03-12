"use client"

import type { AppendablePcmChunk } from "./appendableQueueEngine"

export const APPENDABLE_QUEUE_SAB_RING_STATE = {
  readIndex: 0,
  writeIndex: 1,
  availableFrames: 2,
  bufferedEndFrame: 3,
  length: 4,
} as const

export type AppendableQueueSabRing = {
  channelCount: number
  ringFrames: number
  stateSab: SharedArrayBuffer
  dataSabs: SharedArrayBuffer[]
  state: Int32Array
  channels: Float32Array[]
}

export type AppendableQueueSabRingWriteResult = {
  writtenFrames: number
  droppedFrames: number
  availableFrames: number
  writeIndex: number
}

export type AppendableQueueSabRingReadResult = {
  framesRead: number
  availableFrames: number
  readIndex: number
  channels: Float32Array[]
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

function createSharedFloat32Array(frameCount: number) {
  return new SharedArrayBuffer(Float32Array.BYTES_PER_ELEMENT * frameCount)
}

function createSharedInt32Array(length: number) {
  return new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * length)
}

export function createAppendableQueueSabRing(params: {
  channelCount: number
  ringFrames: number
}): AppendableQueueSabRing {
  const channelCount = Math.max(1, Math.floor(params.channelCount))
  const ringFrames = Math.max(1, Math.floor(params.ringFrames))
  const stateSab = createSharedInt32Array(APPENDABLE_QUEUE_SAB_RING_STATE.length)
  const dataSabs = Array.from({ length: channelCount }, () => createSharedFloat32Array(ringFrames))
  return {
    channelCount,
    ringFrames,
    stateSab,
    dataSabs,
    state: new Int32Array(stateSab),
    channels: dataSabs.map((sab) => new Float32Array(sab)),
  }
}

export function resetAppendableQueueSabRing(ring: AppendableQueueSabRing, startFrame = 0) {
  Atomics.store(ring.state, APPENDABLE_QUEUE_SAB_RING_STATE.readIndex, 0)
  Atomics.store(ring.state, APPENDABLE_QUEUE_SAB_RING_STATE.writeIndex, 0)
  Atomics.store(ring.state, APPENDABLE_QUEUE_SAB_RING_STATE.availableFrames, 0)
  Atomics.store(ring.state, APPENDABLE_QUEUE_SAB_RING_STATE.bufferedEndFrame, Math.max(0, Math.floor(startFrame)))
}

export function getAppendableQueueSabRingAvailableFrames(ring: AppendableQueueSabRing) {
  return Math.max(0, Atomics.load(ring.state, APPENDABLE_QUEUE_SAB_RING_STATE.availableFrames) | 0)
}

export function getAppendableQueueSabRingBufferedEndFrame(ring: AppendableQueueSabRing) {
  return Math.max(0, Atomics.load(ring.state, APPENDABLE_QUEUE_SAB_RING_STATE.bufferedEndFrame) | 0)
}

export function writeAppendableQueueSabRingChunk(
  ring: AppendableQueueSabRing,
  chunk: Pick<AppendablePcmChunk, "channels" | "frameCount">
): AppendableQueueSabRingWriteResult {
  const availableByChannel = chunk.channels
    .map((channel) => (channel && typeof channel.length === "number" ? Math.max(0, channel.length | 0) : 0))
    .filter((frameCount) => frameCount > 0)
  if (!availableByChannel.length) {
    return {
      writtenFrames: 0,
      droppedFrames: Math.max(0, Math.floor(chunk.frameCount)),
      availableFrames: getAppendableQueueSabRingAvailableFrames(ring),
      writeIndex: Math.max(0, Atomics.load(ring.state, APPENDABLE_QUEUE_SAB_RING_STATE.writeIndex) | 0),
    }
  }

  const requestedFrames = Math.max(0, Math.floor(chunk.frameCount))
  const currentAvailableFrames = getAppendableQueueSabRingAvailableFrames(ring)
  const writableFrames = clamp(
    Math.min(requestedFrames, ...availableByChannel),
    0,
    Math.max(0, ring.ringFrames - currentAvailableFrames)
  )
  const currentWriteIndex = Math.max(0, Atomics.load(ring.state, APPENDABLE_QUEUE_SAB_RING_STATE.writeIndex) | 0)
  if (writableFrames <= 0) {
    return {
      writtenFrames: 0,
      droppedFrames: requestedFrames,
      availableFrames: currentAvailableFrames,
      writeIndex: currentWriteIndex,
    }
  }

  const chunkA = Math.min(writableFrames, ring.ringFrames - currentWriteIndex)
  const chunkB = writableFrames - chunkA
  for (let channelIndex = 0; channelIndex < ring.channelCount; channelIndex += 1) {
    const source = chunk.channels[channelIndex]
    if (!source || source.length < writableFrames) continue
    const target = ring.channels[channelIndex]
    target.set(source.subarray(0, chunkA), currentWriteIndex)
    if (chunkB > 0) {
      target.set(source.subarray(chunkA, chunkA + chunkB), 0)
    }
  }

  const nextWriteIndex = (currentWriteIndex + writableFrames) % ring.ringFrames
  Atomics.store(ring.state, APPENDABLE_QUEUE_SAB_RING_STATE.writeIndex, nextWriteIndex)
  const nextAvailableFrames = Atomics.add(ring.state, APPENDABLE_QUEUE_SAB_RING_STATE.availableFrames, writableFrames) + writableFrames
  Atomics.add(ring.state, APPENDABLE_QUEUE_SAB_RING_STATE.bufferedEndFrame, writableFrames)
  return {
    writtenFrames: writableFrames,
    droppedFrames: Math.max(0, requestedFrames - writableFrames),
    availableFrames: Math.max(0, nextAvailableFrames),
    writeIndex: nextWriteIndex,
  }
}

export function readAppendableQueueSabRingFrames(
  ring: AppendableQueueSabRing,
  frameCount: number
): AppendableQueueSabRingReadResult {
  const requestedFrames = Math.max(0, Math.floor(frameCount))
  const currentAvailableFrames = getAppendableQueueSabRingAvailableFrames(ring)
  const readableFrames = clamp(requestedFrames, 0, currentAvailableFrames)
  const currentReadIndex = Math.max(0, Atomics.load(ring.state, APPENDABLE_QUEUE_SAB_RING_STATE.readIndex) | 0)
  const channels = Array.from({ length: ring.channelCount }, () => new Float32Array(readableFrames))
  if (readableFrames <= 0) {
    return {
      framesRead: 0,
      availableFrames: currentAvailableFrames,
      readIndex: currentReadIndex,
      channels,
    }
  }

  const chunkA = Math.min(readableFrames, ring.ringFrames - currentReadIndex)
  const chunkB = readableFrames - chunkA
  for (let channelIndex = 0; channelIndex < ring.channelCount; channelIndex += 1) {
    const source = ring.channels[channelIndex]
    channels[channelIndex].set(source.subarray(currentReadIndex, currentReadIndex + chunkA), 0)
    if (chunkB > 0) {
      channels[channelIndex].set(source.subarray(0, chunkB), chunkA)
    }
  }

  const nextReadIndex = (currentReadIndex + readableFrames) % ring.ringFrames
  Atomics.store(ring.state, APPENDABLE_QUEUE_SAB_RING_STATE.readIndex, nextReadIndex)
  const nextAvailableFrames = Atomics.sub(ring.state, APPENDABLE_QUEUE_SAB_RING_STATE.availableFrames, readableFrames) - readableFrames
  return {
    framesRead: readableFrames,
    availableFrames: Math.max(0, nextAvailableFrames),
    readIndex: nextReadIndex,
    channels,
  }
}
