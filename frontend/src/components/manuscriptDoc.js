// Manuscript document abstractions:
// - Wraps pdf.js docs and image sequences under a unified "PdfLikeDoc" API
// - Supports splitting each page into two (right/left for RTL manuscripts) via smart fold detection
// - All processing is client-side, no backend needed.

const IMAGE_EXT = /\.(jpe?g|png|tiff?|bmp|webp|gif)$/i;
const PDF_EXT = /\.pdf$/i;

// ------------------- Image loader -------------------
export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

// ------------------- Image-sequence doc (pdf.js-like) -------------------
function createImageDoc(imageUrls) {
  return {
    kind: "images",
    numPages: imageUrls.length,
    _urls: imageUrls,
    getPage: async (pageNum) => {
      const url = imageUrls[pageNum - 1];
      const img = await loadImage(url);
      return {
        _img: img,
        _width: img.naturalWidth,
        _height: img.naturalHeight,
        getViewport: ({ scale = 1, rotation = 0 } = {}) => {
          const rotated = rotation % 180 !== 0;
          const w = (rotated ? img.naturalHeight : img.naturalWidth) * scale;
          const h = (rotated ? img.naturalWidth : img.naturalHeight) * scale;
          return { width: w, height: h, scale, rotation };
        },
        render: ({ canvasContext, viewport }) => {
          return {
            promise: (async () => {
              const { width, height, rotation } = viewport;
              const ctx = canvasContext;
              ctx.save();
              ctx.translate(width / 2, height / 2);
              ctx.rotate(((rotation || 0) * Math.PI) / 180);
              const rotated = (rotation || 0) % 180 !== 0;
              const dw = rotated ? height : width;
              const dh = rotated ? width : height;
              ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
              ctx.restore();
            })(),
          };
        },
      };
    },
  };
}

// ------------------- Splitting-doc wrapper -------------------
// Given a base doc, produces a doc with 2N pages where each parent page
// is split into (right-half, left-half) — RTL order for Arabic manuscripts.
function createSplittingDoc(baseDoc, opts = {}) {
  const rtl = opts.rtl !== false; // right = A (first), left = B (second)
  const foldCache = new Map(); // basePageNum -> foldX ratio (0..1)

  return {
    kind: "split-" + baseDoc.kind,
    numPages: baseDoc.numPages * 2,
    _base: baseDoc,
    _rtl: rtl,
    getPage: async (splitPageNum) => {
      const basePageNum = Math.ceil(splitPageNum / 2);
      const sideIndex = ((splitPageNum - 1) % 2); // 0 = first, 1 = second
      const basePage = await baseDoc.getPage(basePageNum);

      // Render base page at scale=1 to compute fold if not cached
      let foldRatio = foldCache.get(basePageNum);
      if (foldRatio == null) {
        const bv = basePage.getViewport({ scale: 1, rotation: 0 });
        const off = document.createElement("canvas");
        off.width = Math.min(1200, Math.floor(bv.width));
        const ratio = off.width / bv.width;
        off.height = Math.floor(bv.height * ratio);
        const ctx = off.getContext("2d", { willReadFrequently: true });
        const vp = basePage.getViewport({ scale: ratio, rotation: 0 });
        await basePage.render({ canvasContext: ctx, viewport: vp }).promise;
        foldRatio = detectFoldColumn(off) / off.width;
        foldCache.set(basePageNum, foldRatio);
      }

      const isRight = rtl ? sideIndex === 0 : sideIndex === 1;

      return {
        _basePage: basePage,
        _foldRatio: foldRatio,
        _isRight: isRight,
        getViewport: ({ scale = 1, rotation = 0 } = {}) => {
          const bv = basePage.getViewport({ scale, rotation });
          const rotated = (rotation || 0) % 180 !== 0;
          if (rotated) {
            // when rotated 90/270, splitting is more complex; fallback to half-height
            return { width: bv.width, height: bv.height / 2, scale, rotation, _rotated: true };
          }
          const w = isRight ? bv.width * (1 - foldRatio) : bv.width * foldRatio;
          return { width: w, height: bv.height, scale, rotation, _foldPx: bv.width * foldRatio };
        },
        render: ({ canvasContext, viewport }) => {
          return {
            promise: (async () => {
              const { rotation = 0, scale } = viewport;
              const bv = basePage.getViewport({ scale, rotation });
              // render full base to off-screen
              const off = document.createElement("canvas");
              off.width = Math.floor(bv.width);
              off.height = Math.floor(bv.height);
              const offCtx = off.getContext("2d");
              await basePage.render({ canvasContext: offCtx, viewport: bv }).promise;
              const foldPx = bv.width * foldRatio;
              if (isRight) {
                // right half: sx = foldPx, sw = bv.width - foldPx
                const sw = bv.width - foldPx;
                canvasContext.drawImage(off, foldPx, 0, sw, bv.height, 0, 0, sw, bv.height);
              } else {
                const sw = foldPx;
                canvasContext.drawImage(off, 0, 0, sw, bv.height, 0, 0, sw, bv.height);
              }
            })(),
          };
        },
      };
    },
    // Expose base for potential later use
    baseDoc,
  };
}

// ------------------- Fold detection -------------------
// Detects the vertical fold line by finding the column (within middle 30-70%)
// with the lowest average brightness (typical fold shadow / gutter).
function detectFoldColumn(canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const { width, height } = canvas;
  const start = Math.floor(width * 0.35);
  const end = Math.floor(width * 0.65);
  const w = end - start;
  const region = ctx.getImageData(start, 0, w, height).data;
  let minSum = Infinity;
  let foldX = Math.floor(w / 2);
  const rowStep = 3;
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = 0; y < height; y += rowStep) {
      const idx = (y * w + x) * 4;
      sum += region[idx] + region[idx + 1] + region[idx + 2];
    }
    if (sum < minSum) {
      minSum = sum;
      foldX = x;
    }
  }
  return start + foldX;
}

// ------------------- ZIP handling -------------------
export async function unpackZip(file, JSZip) {
  const zip = await JSZip.loadAsync(file);
  const entries = [];
  zip.forEach((relPath, entry) => {
    if (entry.dir) return;
    entries.push(entry);
  });
  // Sort by filename to preserve order
  entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
  const images = [];
  const pdfs = [];
  for (const entry of entries) {
    if (IMAGE_EXT.test(entry.name)) {
      const blob = await entry.async("blob");
      images.push({ name: entry.name, blob });
    } else if (PDF_EXT.test(entry.name)) {
      const blob = await entry.async("blob");
      pdfs.push({ name: entry.name, blob });
    }
  }
  return { images, pdfs };
}

// ------------------- Builder API -------------------
export async function buildDocFromFile(file, { pdfjsLib, JSZip, splitPages = false } = {}) {
  const name = file.name.toLowerCase();
  let base;

  if (PDF_EXT.test(name)) {
    const buf = await file.arrayBuffer();
    base = await pdfjsLib.getDocument({ data: buf }).promise;
    base.kind = "pdf";
  } else if (IMAGE_EXT.test(name)) {
    const url = URL.createObjectURL(file);
    base = createImageDoc([url]);
  } else if (/\.zip$/i.test(name)) {
    const { images, pdfs } = await unpackZip(file, JSZip);
    if (pdfs.length > 0) {
      // Use the largest PDF inside the ZIP
      pdfs.sort((a, b) => b.blob.size - a.blob.size);
      const buf = await pdfs[0].blob.arrayBuffer();
      base = await pdfjsLib.getDocument({ data: buf }).promise;
      base.kind = "pdf";
    } else if (images.length > 0) {
      const urls = images.map((i) => URL.createObjectURL(i.blob));
      base = createImageDoc(urls);
    } else {
      throw new Error("لا توجد صور أو ملفات PDF داخل الملف المضغوط");
    }
  } else {
    throw new Error("صيغة غير مدعومة");
  }

  return splitPages ? createSplittingDoc(base) : base;
}

// Wrap an already-loaded base doc with splitting on/off dynamically
export function toggleSplitDoc(baseDoc, split) {
  if (split) return createSplittingDoc(baseDoc);
  return baseDoc;
}

// ------------------- Folio numbering -------------------
export function formatFolio(pageIndex, { startFolio = 1, offset = 0, style = "folio" } = {}) {
  // pageIndex is 1-based
  // offset is number of front pages to skip (e.g., 2 covers before manuscript starts)
  const manuscriptIdx = pageIndex - offset; // 1-based within manuscript
  if (manuscriptIdx <= 0) {
    return `[غلاف ${pageIndex}]`;
  }
  if (style !== "folio") {
    return `صفحة ${manuscriptIdx}`;
  }
  const folio = Math.ceil(manuscriptIdx / 2) + (startFolio - 1);
  const side = manuscriptIdx % 2 === 1 ? "a" : "b";
  return `${folio}${side}`;
}

// ------------------- Image compression export -------------------
export async function compressImage(source, { maxSize = 2000, quality = 0.82, mime = "image/jpeg" } = {}) {
  const img = source instanceof HTMLImageElement ? source : await loadImage(source);
  const { naturalWidth: w, naturalHeight: h } = img;
  const scale = Math.min(1, maxSize / Math.max(w, h));
  const cw = Math.round(w * scale);
  const ch = Math.round(h * scale);
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, cw, ch);
  ctx.drawImage(img, 0, 0, cw, ch);
  return new Promise((resolve) => canvas.toBlob(resolve, mime, quality));
}
