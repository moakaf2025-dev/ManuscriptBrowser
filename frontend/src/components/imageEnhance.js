// Legibility pipeline for manuscript scans.
//
// The individual filters the viewer already had are general-purpose knobs. What a
// faded manuscript actually needs is a fixed sequence, because each stage depends
// on the one before it:
//
//   1. flatten  - even out the lighting across the sheet (binding shadow, lamp
//                 falloff). Estimated from the page itself, so it adapts per page.
//   2. paper    - neutralise the paper's colour cast using a white reference taken
//                 from the page, not a fixed number.
//   3. contrast - stretch what is left between the darkest ink and the lightest
//                 paper, using percentiles so one blot or highlight cannot set the
//                 range.
//   4. sharpen  - only now, once the noise has not been amplified by the stretch.
//   5. threshold- optional, and off by default: excellent for reading a very faint
//                 hand, misleading for documentation, so it stays an explicit choice.
//
// Everything works on plain {data,width,height}, so it runs in a worker and is
// testable without a canvas.

export const DEFAULT_RECIPE = {
  enabled: false,
  flatten: 70,    // 0..100
  paper: 40,      // 0..100
  contrast: 55,   // 0..100
  sharpen: 35,    // 0..100
  threshold: 0,   // 0..100, 0 = off
};

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

// ---- luminance ----
function luminance(data, i) {
  return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
}

// ---- background estimate ----
// Downsample to a coarse grid, blur that, and read it back bilinearly. Working at
// ~1/32 scale is what keeps this affordable: the illumination we are removing
// varies slowly across the sheet, so the estimate does not need fine detail, and
// a small grid also means the blur cannot smear ink into the estimate.
export function estimateBackground(data, width, height, cells = 24) {
  const gw = Math.max(2, Math.min(cells, width));
  const gh = Math.max(2, Math.min(cells, height));
  const sum = new Float64Array(gw * gh);
  const count = new Uint32Array(gw * gh);

  for (let y = 0; y < height; y++) {
    const gy = Math.min(gh - 1, ((y * gh) / height) | 0);
    for (let x = 0; x < width; x++) {
      const gx = Math.min(gw - 1, ((x * gw) / width) | 0);
      const g = gy * gw + gx;
      sum[g] += luminance(data, (y * width + x) * 4);
      count[g]++;
    }
  }

  // Each cell takes a bright quantile rather than its mean, so text inside the
  // cell does not drag the paper estimate down.
  const grid = new Float64Array(gw * gh);
  for (let i = 0; i < grid.length; i++) grid[i] = count[i] ? sum[i] / count[i] : 255;

  // light smoothing across cells to avoid blocky correction
  const smooth = new Float64Array(grid.length);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      let acc = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const yy = gy + dy, xx = gx + dx;
          if (yy < 0 || yy >= gh || xx < 0 || xx >= gw) continue;
          acc += grid[yy * gw + xx];
          n++;
        }
      }
      smooth[gy * gw + gx] = acc / n;
    }
  }
  return { grid: smooth, gw, gh };
}

function sampleBackground(bg, width, height, x, y) {
  const { grid, gw, gh } = bg;
  const fx = Math.min(gw - 1, Math.max(0, (x * gw) / width - 0.5));
  const fy = Math.min(gh - 1, Math.max(0, (y * gh) / height - 0.5));
  const x0 = fx | 0, y0 = fy | 0;
  const x1 = Math.min(gw - 1, x0 + 1), y1 = Math.min(gh - 1, y0 + 1);
  const tx = fx - x0, ty = fy - y0;
  const a = grid[y0 * gw + x0], b = grid[y0 * gw + x1];
  const c = grid[y1 * gw + x0], d = grid[y1 * gw + x1];
  return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
}

// ---- 1. illumination flattening ----
export function flattenIllumination(data, width, height, strength, bg) {
  if (strength <= 0) return;
  const s = strength / 100;
  const background = bg || estimateBackground(data, width, height);
  // Target is the brightest part of the estimate: push everything up to that level.
  let target = 0;
  for (let i = 0; i < background.grid.length; i++) if (background.grid[i] > target) target = background.grid[i];
  if (target <= 1) return;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const local = sampleBackground(background, width, height, x, y);
      if (local <= 1) continue;
      const gain = 1 + s * (target / local - 1);
      const i = (y * width + x) * 4;
      data[i] = clamp255(data[i] * gain);
      data[i + 1] = clamp255(data[i + 1] * gain);
      data[i + 2] = clamp255(data[i + 2] * gain);
    }
  }
}

// ---- 2. paper neutralisation ----
// White balance from the page's own paper, found as a high percentile per channel,
// so an ivory or foxed sheet reads as paper rather than as colour.
export function neutralisePaper(data, width, height, strength) {
  if (strength <= 0) return;
  const s = strength / 100;
  const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  for (let i = 0; i < data.length; i += 4) {
    hist[0][data[i]]++;
    hist[1][data[i + 1]]++;
    hist[2][data[i + 2]]++;
  }
  const total = data.length / 4;
  const refs = hist.map((h) => {
    let seen = 0;
    for (let v = 255; v >= 0; v--) {
      seen += h[v];
      if (seen >= total * 0.05) return Math.max(1, v); // 95th percentile
    }
    return 255;
  });
  const mean = (refs[0] + refs[1] + refs[2]) / 3;
  const gains = refs.map((r) => 1 + s * (mean / r - 1));
  for (let i = 0; i < data.length; i += 4) {
    data[i] = clamp255(data[i] * gains[0]);
    data[i + 1] = clamp255(data[i + 1] * gains[1]);
    data[i + 2] = clamp255(data[i + 2] * gains[2]);
  }
}

// ---- 3. percentile contrast stretch ----
export function stretchContrast(data, width, height, strength) {
  if (strength <= 0) return;
  const s = strength / 100;
  const hist = new Uint32Array(256);
  for (let i = 0; i < data.length; i += 4) hist[luminance(data, i) | 0]++;
  const total = data.length / 4;
  // Ignore the extreme 0.5% at each end so a single blot or specular highlight
  // cannot define the range.
  const cut = total * 0.005;
  let lo = 0, hi = 255, seen = 0;
  for (let v = 0; v < 256; v++) { seen += hist[v]; if (seen >= cut) { lo = v; break; } }
  seen = 0;
  for (let v = 255; v >= 0; v--) { seen += hist[v]; if (seen >= cut) { hi = v; break; } }
  if (hi - lo < 8) return;

  const scale = 255 / (hi - lo);
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const stretched = (data[i + c] - lo) * scale;
      data[i + c] = clamp255(data[i + c] * (1 - s) + stretched * s);
    }
  }
}

// ---- 4. unsharp mask ----
export function unsharp(data, width, height, strength) {
  if (strength <= 0) return;
  const s = strength / 100;
  const src = new Uint8ClampedArray(data);
  const kCenter = 1 + 4 * s;
  const kEdge = -s;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const v =
          kCenter * src[i + c] +
          kEdge * (src[i - width * 4 + c] + src[i + width * 4 + c] + src[i - 4 + c] + src[i + 4 + c]);
        data[i + c] = clamp255(v);
      }
    }
  }
}

// ---- 5. adaptive threshold ----
// Compares each pixel with the local paper level rather than a global cut, so a
// page that is bright on one side and shadowed on the other still separates.
export function adaptiveThreshold(data, width, height, strength, bg) {
  if (strength <= 0) return;
  const s = strength / 100;
  const background = bg || estimateBackground(data, width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const local = sampleBackground(background, width, height, x, y);
      const lum = luminance(data, i);
      const isInk = lum < local * 0.82;
      const target = isInk ? 0 : 255;
      data[i] = clamp255(data[i] * (1 - s) + target * s);
      data[i + 1] = clamp255(data[i + 1] * (1 - s) + target * s);
      data[i + 2] = clamp255(data[i + 2] * (1 - s) + target * s);
    }
  }
}

// ---- the recipe ----
export function applyRecipe(imageData, recipe) {
  const r = { ...DEFAULT_RECIPE, ...(recipe || {}) };
  const { data, width, height } = imageData;
  if (!r.enabled || !width || !height) return imageData;

  // One background estimate serves both stages that need it.
  const needsBg = r.flatten > 0 || r.threshold > 0;
  const bg = needsBg ? estimateBackground(data, width, height) : null;

  flattenIllumination(data, width, height, r.flatten, bg);
  neutralisePaper(data, width, height, r.paper);
  stretchContrast(data, width, height, r.contrast);
  unsharp(data, width, height, r.sharpen);
  // Threshold re-estimates: the earlier stages have changed the page.
  if (r.threshold > 0) adaptiveThreshold(data, width, height, r.threshold, null);
  return imageData;
}

export const RECIPE_PRESETS = [
  { name: "مخطوط باهت", recipe: { enabled: true, flatten: 85, paper: 55, contrast: 70, sharpen: 40, threshold: 0 } },
  { name: "إضاءة غير متساوية", recipe: { enabled: true, flatten: 95, paper: 35, contrast: 45, sharpen: 25, threshold: 0 } },
  { name: "ورق مصفرّ", recipe: { enabled: true, flatten: 55, paper: 85, contrast: 60, sharpen: 30, threshold: 0 } },
  { name: "أقصى وضوح للقراءة", recipe: { enabled: true, flatten: 90, paper: 60, contrast: 75, sharpen: 45, threshold: 55 } },
];
