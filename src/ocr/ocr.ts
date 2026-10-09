/**
 * On-device text recognition (Tesseract, WASM). No network after the page loads: the worker, core and
 * English data are served from /ocr (copied at install/build). Loaded lazily on first use.
 * Best on printed text, screenshots, whiteboard photos; handwriting is hit-and-miss — an AI key does better.
 */
let workerPromise: Promise<any> | null = null;

async function getWorker() {
  workerPromise ??= (async () => {
    const { createWorker } = await import("tesseract.js");
    const base = `${location.origin}/ocr`;
    return createWorker("eng", 1, {
      workerPath: `${base}/worker.min.js`,
      corePath: `${base}/core`,
      langPath: `${base}/lang`,
      gzip: true,
    });
  })();
  try {
    return await workerPromise;
  } catch (e) {
    workerPromise = null;
    throw e;
  }
}

export interface OcrResult {
  text: string;
  confidence: number;
}

export async function recognize(image: Blob): Promise<OcrResult> {
  const worker = await getWorker();
  const { data } = await worker.recognize(image);
  const text = String(data.text ?? "")
    .split(/\r?\n/)
    .map((l: string) => l.trim())
    .filter((l: string) => /[\p{L}\p{N}]{2,}/u.test(l))
    .join("\n");
  return { text, confidence: Math.round(data.confidence ?? 0) };
}
