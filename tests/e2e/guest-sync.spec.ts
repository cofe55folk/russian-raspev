import { expect, test } from "@playwright/test";

function makeMonoWavBase64() {
  // 1.2 sec, 44.1kHz, mono, 16-bit PCM, simple sine (small amplitude)
  const sampleRate = 44100;
  const seconds = 1.2;
  const samples = Math.floor(sampleRate * seconds);
  const bytesPerSample = 2;
  const channels = 1;
  const dataSize = samples * channels * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  const freq = 220;
  let ptr = 44;
  for (let i = 0; i < samples; i++) {
    const t = i / sampleRate;
    const v = Math.sin(2 * Math.PI * freq * t) * 0.12;
    const int = Math.max(-1, Math.min(1, v));
    view.setInt16(ptr, int < 0 ? int * 0x8000 : int * 0x7fff, true);
    ptr += 2;
  }

  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

test("guest + track playback does not jump backward in time", async ({ page }) => {
  const wavBase64 = makeMonoWavBase64();

  await page.addInitScript(async ({ base64 }) => {
    await new Promise<void>((resolve) => {
      const req = indexedDB.open("rr_guest_tracks", 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("tracks")) db.createObjectStore("tracks");
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("tracks", "readwrite");
        const store = tx.objectStore("tracks");

        const bytes = Uint8Array.from(atob(base64 as string), (c) => c.charCodeAt(0));
        const blob = new Blob([bytes], { type: "audio/wav" });
        store.put({ blob, ts: Date.now() }, "latest");

        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          resolve();
        };
      };
      req.onerror = () => resolve();
    });
  }, { base64: wavBase64 });

  await page.goto("/");
  await page.getByRole("button", { name: "Гостевая дорожка" }).click();
  await expect(page.getByRole("button", { name: "Гость + трек" })).toBeVisible();

  await page.getByRole("button", { name: "Solo Селезень 01" }).click();
  await page.getByRole("button", { name: "Гость + трек" }).click();
  await expect(page.getByRole("button", { name: "Остановить Гость + трек" })).toBeVisible();

  const regressions = await page.evaluate(async () => {
    const audio = document.querySelector("audio");
    if (!audio) return -1;

    const values: number[] = [];
    for (let i = 0; i < 22; i++) {
      values.push((audio as HTMLAudioElement).currentTime);
      await new Promise((r) => setTimeout(r, 120));
    }

    let bad = 0;
    for (let i = 1; i < values.length; i++) {
      // tolerate tiny browser jitter
      if (values[i] + 0.02 < values[i - 1]) bad += 1;
    }
    return bad;
  });

  expect(regressions).toBeGreaterThanOrEqual(0);
  expect(regressions).toBeLessThanOrEqual(1);
});
