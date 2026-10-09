// Self-host third-party runtime assets so the app works offline / without CDNs:
//  - Excalidraw fonts
//  - Tesseract OCR worker, WASM core and English language data
import { cpSync, existsSync, mkdirSync } from "node:fs";

const copy = (from, to) => {
  if (existsSync(from)) {
    mkdirSync(to.replace(/\/[^/]*$/, ""), { recursive: true });
    cpSync(from, to, { recursive: true });
  }
};

copy("node_modules/@excalidraw/excalidraw/dist/prod/fonts", "public/fonts");

copy("node_modules/tesseract.js/dist/worker.min.js", "public/ocr/worker.min.js");
for (const f of ["tesseract-core-simd-lstm.wasm.js", "tesseract-core-relaxedsimd-lstm.wasm.js", "tesseract-core-lstm.wasm.js"])
  copy(`node_modules/tesseract.js-core/${f}`, `public/ocr/core/${f}`);
copy("node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz", "public/ocr/lang/eng.traineddata.gz");
