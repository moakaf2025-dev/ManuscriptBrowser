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
// Given a base doc, produces a doc where pages within `range` are split into two,
// and pages outside `range` remain single. RTL: right half first (recto), then left (verso).
function createSplittingDoc(baseDoc, opts = {}) {
  const rtl = opts.rtl !== false;
  const totalBase = baseDoc.numPages;
  const rangeFrom = Math.max(1, Math.min(totalBase, opts.range?.from || 1));
  const rangeTo = Math.max(rangeFrom, Math.min(totalBase, opts.range?.to || totalBase));
  const foldCache = new Map();
  // overridesRef: either a Map, plain object, or a ref-like { current: {...} }.
  // Values in the object should be numeric ratios (0..1) per basePage number.
  const overridesRef = opts.overridesRef || null;

  const getOverride = (basePage) => {
    if (!overridesRef) return null;
    const src = overridesRef.current || overridesRef;
    if (src instanceof Map) return src.has(basePage) ? src.get(basePage) : null;
    if (src && typeof src === "object" && src[basePage] != null) return src[basePage];
    return null;
  };

  const splitCount = rangeTo - rangeFrom + 1;
  const numPages = totalBase + splitCount;

  function resolve(virt) {
    if (virt < rangeFrom) return { basePage: virt, split: false };
    const rangeStartVirt = rangeFrom;
    const rangeSize = splitCount * 2;
    if (virt <= rangeStartVirt + rangeSize - 1) {
      const offset = virt - rangeStartVirt;
      const baseOffset = Math.floor(offset / 2);
      const side = offset % 2;
      return { basePage: rangeFrom + baseOffset, split: true, side };
    }
    return { basePage: virt - splitCount, split: false };
  }

  return {
    kind: "split-" + baseDoc.kind,
    numPages,
    _base: baseDoc,
    _rtl: rtl,
    _range: { from: rangeFrom, to: rangeTo },
    _foldCache: foldCache,
    _overridesRef: overridesRef,
    resolve,
    getPage: async (virtPageNum) => {
      const { basePage, split, side } = resolve(virtPageNum);
      const basePageObj = await baseDoc.getPage(basePage);

      if (!split) {
        return basePageObj;
      }

      // Priority: manual override > cached auto-detect > run detection
      const override = getOverride(basePage);
      let foldRatio;
      if (override != null) {
        foldRatio = override;
      } else if (foldCache.has(basePage)) {
        foldRatio = foldCache.get(basePage);
      } else {
        const bv = basePageObj.getViewport({ scale: 1, rotation: 0 });
        const off = document.createElement("canvas");
        off.width = Math.min(1200, Math.floor(bv.width));
        const ratio = off.width / bv.width;
        off.height = Math.floor(bv.height * ratio);
        const ctx = off.getContext("2d", { willReadFrequently: true });
        const vp = basePageObj.getViewport({ scale: ratio, rotation: 0 });
        await basePageObj.render({ canvasContext: ctx, viewport: vp }).promise;
        foldRatio = detectFoldColumn(off) / off.width;
        foldCache.set(basePage, foldRatio);
      }

      const isRight = rtl ? side === 0 : side === 1;

      return {
        _basePage: basePageObj,
        _basePageNum: basePage,
        _foldRatio: foldRatio,
        _isOverride: override != null,
        _isRight: isRight,
        getViewport: ({ scale = 1, rotation = 0 } = {}) => {
          // Always read the LATEST override at call-time (so slider updates take effect)
          const latest = getOverride(basePage);
          const effective = latest != null ? latest : foldRatio;
          const bv = basePageObj.getViewport({ scale, rotation });
          const w = isRight ? bv.width * (1 - effective) : bv.width * effective;
          return { width: w, height: bv.height, scale, rotation };
        },
        render: ({ canvasContext, viewport }) => {
          return {
            promise: (async () => {
              const latest = getOverride(basePage);
              const effective = latest != null ? latest : foldRatio;
              const { rotation = 0, scale } = viewport;
              const bv = basePageObj.getViewport({ scale, rotation });
              const off = document.createElement("canvas");
              off.width = Math.floor(bv.width);
              off.height = Math.floor(bv.height);
              const offCtx = off.getContext("2d");
              await basePageObj.render({ canvasContext: offCtx, viewport: bv }).promise;
              const foldPx = bv.width * effective;
              if (isRight) {
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

// ------------------- RAR / 7z / tar handling (via libarchive.js WASM) -------------------
let _archiveLibPromise = null;
async function getLibArchive() {
  if (!_archiveLibPromise) {
    _archiveLibPromise = (async () => {
      const mod = await import("libarchive.js");
      const Archive = mod.Archive || mod.default?.Archive;
      Archive.init({
        workerUrl: `${process.env.PUBLIC_URL || "."}/libarchive-worker.js`,
      });
      return Archive;
    })();
  }
  return _archiveLibPromise;
}

export async function unpackArchive(file) {
  const Archive = await getLibArchive();
  const archive = await Archive.open(file);
  const files = await archive.getFilesArray();
  // Sort by filename with natural order
  files.sort((a, b) => {
    const pa = (a.path || "") + a.file.name;
    const pb = (b.path || "") + b.file.name;
    return pa.localeCompare(pb, undefined, { numeric: true, sensitivity: "base" });
  });
  const images = [];
  const pdfs = [];
  for (const f of files) {
    const name = f.file.name;
    if (IMAGE_EXT.test(name)) {
      const extracted = await f.file.extract();
      const blob = new Blob([await extracted.arrayBuffer()], { type: extracted.type || "image/jpeg" });
      images.push({ name, blob });
    } else if (PDF_EXT.test(name)) {
      const extracted = await f.file.extract();
      const blob = new Blob([await extracted.arrayBuffer()], { type: "application/pdf" });
      pdfs.push({ name, blob });
    }
  }
  return { images, pdfs };
}

// ------------------- Builder API -------------------
const ARCHIVE_EXT = /\.(rar|7z|tar|tar\.gz|tgz|tar\.bz2)$/i;

export async function buildDocFromFile(file, { pdfjsLib, JSZip, splitPages = false, splitRange, overridesRef } = {}) {
  const name = file.name.toLowerCase();
  let base;

  if (PDF_EXT.test(name)) {
    const buf = await file.arrayBuffer();
    base = await pdfjsLib.getDocument({ data: buf }).promise;
    base.kind = "pdf";
  } else if (IMAGE_EXT.test(name)) {
    const url = URL.createObjectURL(file);
    base = createImageDoc([url]);
  } else if (/\.zip$/i.test(name) || ARCHIVE_EXT.test(name)) {
    const isZip = /\.zip$/i.test(name);
    const { images, pdfs } = isZip
      ? await unpackZip(file, JSZip)
      : await unpackArchive(file);
    // If no images and multiple PDFs, merge them into one
    if (images.length === 0 && pdfs.length > 0) {
      if (pdfs.length === 1) {
        const buf = await pdfs[0].blob.arrayBuffer();
        base = await pdfjsLib.getDocument({ data: buf }).promise;
        base.kind = "pdf";
      } else {
        // Merge multiple PDFs via pdf-lib
        const { PDFDocument } = await import("pdf-lib");
        const merged = await PDFDocument.create();
        // Sort PDFs by filename for consistent order
        pdfs.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
        for (const p of pdfs) {
          const buf = await p.blob.arrayBuffer();
          const src = await PDFDocument.load(buf);
          const copied = await merged.copyPages(src, src.getPageIndices());
          copied.forEach((pg) => merged.addPage(pg));
        }
        const mergedBytes = await merged.save();
        base = await pdfjsLib.getDocument({ data: mergedBytes }).promise;
        base.kind = "pdf";
      }
    } else if (images.length > 0) {
      const urls = images.map((i) => URL.createObjectURL(i.blob));
      base = createImageDoc(urls);
    } else {
      throw new Error("لا توجد صور أو ملفات PDF داخل الأرشيف");
    }
  } else {
    throw new Error("صيغة غير مدعومة (المدعوم: PDF، صور، ZIP، RAR، 7z، TAR)");
  }

  return splitPages ? createSplittingDoc(base, { rtl: true, range: splitRange, overridesRef }) : base;
}

// Wrap an already-loaded base doc with splitting on/off dynamically
export function toggleSplitDoc(baseDoc, split, splitRange, overridesRef) {
  if (split) return createSplittingDoc(baseDoc, { rtl: true, range: splitRange, overridesRef });
  return baseDoc;
}

// ------------------- Folio numbering -------------------
// Convert Western digits to Arabic-Indic so BiDi keeps them RTL-strong.
// This makes "1/أ" render as "١/أ" in RTL contexts with number-slash-letter reading order
// (which is what manuscript-studies convention requires).
const _ARABIC_DIGITS = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];
function _toArabicDigits(n) {
  return String(n).split("").map((c) => (/\d/.test(c) ? _ARABIC_DIGITS[+c] : c)).join("");
}

export function formatFolio(pageIndex, { startFolio = 1, offset = 0, style = "folio", latin = false } = {}) {
  // pageIndex is 1-based
  const manuscriptIdx = pageIndex - offset;
  if (manuscriptIdx <= 0) {
    return `[غلاف ${_toArabicDigits(pageIndex)}]`;
  }
  if (style !== "folio") {
    return `صفحة ${_toArabicDigits(manuscriptIdx)}`;
  }
  const folio = Math.ceil(manuscriptIdx / 2) + (startFolio - 1);
  const side = manuscriptIdx % 2 === 1 ? (latin ? "a" : "أ") : (latin ? "b" : "ب");
  if (latin) return `${folio}/${side}`;
  // Use Arabic-Indic digits so all glyphs are strong-RTL — BiDi renders them
  // in logical order in an RTL context: "١/أ" reads (number → / → letter).
  return `${_toArabicDigits(folio)}/${side}`;
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

// ------------------- Export full doc as PDF -------------------
export async function exportDocAsPdf(doc, { PDFDocument, maxSize = 4000, quality = 0.95, onProgress } = {}) {
  const pdfDoc = await PDFDocument.create();
  for (let i = 1; i <= doc.numPages; i++) {
    if (onProgress) onProgress(i, doc.numPages);
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1, rotation: 0 });
    const targetScale = Math.min(2, maxSize / Math.max(vp.width, vp.height));
    const rvp = page.getViewport({ scale: targetScale, rotation: 0 });
    const off = document.createElement("canvas");
    off.width = Math.floor(rvp.width);
    off.height = Math.floor(rvp.height);
    const ctx = off.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, off.width, off.height);
    await page.render({ canvasContext: ctx, viewport: rvp }).promise;
    const blob = await new Promise((r) => off.toBlob(r, "image/jpeg", quality));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const img = await pdfDoc.embedJpg(bytes);
    const pdfPage = pdfDoc.addPage([img.width, img.height]);
    pdfPage.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
  }
  const pdfBytes = await pdfDoc.save();
  return new Blob([pdfBytes], { type: "application/pdf" });
}
