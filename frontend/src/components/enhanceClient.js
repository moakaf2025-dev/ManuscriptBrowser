// Thin client around the enhancement worker.
//
// One worker for the whole viewer, started on first use. Each request carries an
// id so a page whose render was superseded can be ignored, and the pixel buffer is
// transferred rather than copied in both directions.
//
// Falls back to running the pipeline inline if a worker cannot be created (which
// keeps the feature working rather than failing silently); the only cost is the
// main-thread pause this was written to avoid.
import { applyRecipe } from "./imageEnhance";

let worker = null;
let workerBroken = false;
let seq = 0;
const pending = new Map();

function ensureWorker() {
  if (worker || workerBroken) return worker;
  try {
    worker = new Worker(new URL("./enhance.worker.js", import.meta.url));
    worker.onmessage = (e) => {
      const { id, buffer, error } = e.data || {};
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      if (error) entry.reject(new Error(error));
      else entry.resolve(new Uint8ClampedArray(buffer));
    };
    worker.onerror = () => {
      workerBroken = true;
      for (const [, entry] of pending) entry.reject(new Error("enhance worker failed"));
      pending.clear();
    };
  } catch {
    workerBroken = true;
  }
  return worker;
}

export function enhancePixels(imageData, recipe) {
  const { data, width, height } = imageData;
  const w = ensureWorker();
  if (!w) {
    applyRecipe(imageData, recipe);
    return Promise.resolve(imageData.data);
  }
  const id = ++seq;
  const copy = new Uint8ClampedArray(data); // the buffer is transferred away
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, buffer: copy.buffer, width, height, recipe }, [copy.buffer]);
  });
}
