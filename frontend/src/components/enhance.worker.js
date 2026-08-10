/* eslint-disable no-restricted-globals */
// Runs the legibility pipeline off the main thread. The pixel buffer is
// transferred both ways rather than copied, so a full-resolution page costs one
// handover instead of two copies of tens of megabytes.
import { applyRecipe } from "./imageEnhance";

self.onmessage = (e) => {
  const { id, buffer, width, height, recipe } = e.data || {};
  try {
    const data = new Uint8ClampedArray(buffer);
    applyRecipe({ data, width, height }, recipe);
    self.postMessage({ id, buffer: data.buffer }, [data.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
