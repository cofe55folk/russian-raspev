import { expect, test } from "@playwright/test"

import {
  createAppendableQueueSabRing,
  getAppendableQueueSabRingAvailableFrames,
  getAppendableQueueSabRingBufferedEndFrame,
  readAppendableQueueSabRingFrames,
  resetAppendableQueueSabRing,
  writeAppendableQueueSabRingChunk,
} from "../../app/components/audio/appendableQueueSabRing"

function makeChannel(values: number[]) {
  return Float32Array.from(values)
}

test.describe("appendable SAB ring", () => {
  test.skip(typeof SharedArrayBuffer !== "function", "SharedArrayBuffer is unavailable in this runtime")

  test("preserves frame order across wrap-around writes and reads", async () => {
    const ring = createAppendableQueueSabRing({ channelCount: 2, ringFrames: 8 })
    resetAppendableQueueSabRing(ring, 100)

    const firstWrite = writeAppendableQueueSabRingChunk(ring, {
      frameCount: 6,
      channels: [makeChannel([1, 2, 3, 4, 5, 6]), makeChannel([11, 12, 13, 14, 15, 16])],
    })
    expect(firstWrite).toMatchObject({
      writtenFrames: 6,
      droppedFrames: 0,
      availableFrames: 6,
      writeIndex: 6,
    })
    expect(getAppendableQueueSabRingBufferedEndFrame(ring)).toBe(106)

    const firstRead = readAppendableQueueSabRingFrames(ring, 5)
    expect(firstRead.framesRead).toBe(5)
    expect(Array.from(firstRead.channels[0] ?? [])).toEqual([1, 2, 3, 4, 5])
    expect(Array.from(firstRead.channels[1] ?? [])).toEqual([11, 12, 13, 14, 15])
    expect(getAppendableQueueSabRingAvailableFrames(ring)).toBe(1)

    const secondWrite = writeAppendableQueueSabRingChunk(ring, {
      frameCount: 4,
      channels: [makeChannel([7, 8, 9, 10]), makeChannel([17, 18, 19, 20])],
    })
    expect(secondWrite).toMatchObject({
      writtenFrames: 4,
      droppedFrames: 0,
      availableFrames: 5,
      writeIndex: 2,
    })
    expect(getAppendableQueueSabRingBufferedEndFrame(ring)).toBe(110)

    const secondRead = readAppendableQueueSabRingFrames(ring, 5)
    expect(secondRead.framesRead).toBe(5)
    expect(Array.from(secondRead.channels[0] ?? [])).toEqual([6, 7, 8, 9, 10])
    expect(Array.from(secondRead.channels[1] ?? [])).toEqual([16, 17, 18, 19, 20])
    expect(getAppendableQueueSabRingAvailableFrames(ring)).toBe(0)
  })

  test("drops overflow writes deterministically and reset clears the ring state", async () => {
    const ring = createAppendableQueueSabRing({ channelCount: 1, ringFrames: 4 })
    resetAppendableQueueSabRing(ring, 24)

    const firstWrite = writeAppendableQueueSabRingChunk(ring, {
      frameCount: 4,
      channels: [makeChannel([1, 2, 3, 4])],
    })
    expect(firstWrite.writtenFrames).toBe(4)
    expect(firstWrite.droppedFrames).toBe(0)
    expect(getAppendableQueueSabRingAvailableFrames(ring)).toBe(4)
    expect(getAppendableQueueSabRingBufferedEndFrame(ring)).toBe(28)

    const overflowWrite = writeAppendableQueueSabRingChunk(ring, {
      frameCount: 3,
      channels: [makeChannel([5, 6, 7])],
    })
    expect(overflowWrite.writtenFrames).toBe(0)
    expect(overflowWrite.droppedFrames).toBe(3)
    expect(getAppendableQueueSabRingAvailableFrames(ring)).toBe(4)

    const partialRead = readAppendableQueueSabRingFrames(ring, 2)
    expect(partialRead.framesRead).toBe(2)
    expect(Array.from(partialRead.channels[0] ?? [])).toEqual([1, 2])

    const partialWrite = writeAppendableQueueSabRingChunk(ring, {
      frameCount: 3,
      channels: [makeChannel([5, 6, 7])],
    })
    expect(partialWrite.writtenFrames).toBe(2)
    expect(partialWrite.droppedFrames).toBe(1)
    expect(getAppendableQueueSabRingBufferedEndFrame(ring)).toBe(30)

    resetAppendableQueueSabRing(ring, 42)
    expect(getAppendableQueueSabRingAvailableFrames(ring)).toBe(0)
    expect(getAppendableQueueSabRingBufferedEndFrame(ring)).toBe(42)

    const emptyRead = readAppendableQueueSabRingFrames(ring, 4)
    expect(emptyRead.framesRead).toBe(0)
    expect(Array.from(emptyRead.channels[0] ?? [])).toEqual([])
  })
})
