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
// Pages arrive as { name, load: () => Promise<Blob> } and are materialised only
// when asked for. Opening a 600-page archive used to decompress every entry,
// mint an object URL for each and hold all of it for the session; a manuscript
// scanned at 300dpi costs tens of megabytes per page once decoded, so the app
// spent minutes unpacking and then sat on gigabytes it would never look at.
//
// Only the last PAGE_CACHE pages stay resident. Evicting revokes the object URL;
// the decoded bitmap goes when the browser drops the last reference to the image.
const PAGE_CACHE = 6;

export function createImageDoc(entries, { cacheSize = PAGE_CACHE } = {}) {
  const cache = new Map(); // index -> { url, img }, iteration order = least recent first
  const inflight = new Map();

  const evict = () => {
    while (cache.size > cacheSize) {
      const oldest = cache.keys().next().value;
      const held = cache.get(oldest);
      cache.delete(oldest);
      try { URL.revokeObjectURL(held.url); } catch { /* noop */ }
    }
  };

  const acquire = async (index) => {
    const hit = cache.get(index);
    if (hit) {
      cache.delete(index);
      cache.set(index, hit); // touch: move to most-recent
      return hit.img;
    }
    if (inflight.has(index)) return inflight.get(index);
    const p = (async () => {
      const blob = await entries[index].load();
      const url = URL.createObjectURL(blob);
      const img = await loadImage(url);
      cache.set(index, { url, img });
      evict();
      return img;
    })();
    inflight.set(index, p);
    try {
      return await p;
    } finally {
      inflight.delete(index);
    }
  };

  return {
    kind: "images",
    numPages: entries.length,
    _entries: entries,
    // Called when a tab closes, mirroring pdf.js's own destroy().
    destroy: () => {
      for (const held of cache.values()) {
        try { URL.revokeObjectURL(held.url); } catch { /* noop */ }
      }
      cache.clear();
      inflight.clear();
    },
    getPage: async (pageNum) => {
      const img = await acquire(pageNum - 1);
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

// ------------------- Page-order wrapper -------------------
// Manuscripts get photographed out of order, upside down, or with stray sheets.
// This layer lets the reader fix that before numbering: `order` is the list of
// source pages to show, in the order to show them. A page left out of `order` is
// simply not shown — nothing is thrown away, so removing is always undoable.
//
// Deliberately a view, not an edit. Everything anchored to a page (comments,
// headings, fold overrides) refers to the *source* page, so moving a sheet moves
// its annotations with it and deleting one hides them rather than shifting them
// onto a neighbour.
export function createOrderedDoc(baseDoc, order) {
  const total = baseDoc.numPages;
  const clean = Array.isArray(order)
    ? order.filter((n) => Number.isInteger(n) && n >= 1 && n <= total)
    : null;
  // No order, or one that says exactly what the document already says: skip the layer.
  if (!clean || clean.length === 0) return baseDoc;
  if (clean.length === total && clean.every((n, i) => n === i + 1)) return baseDoc;

  return {
    kind: "ordered-" + baseDoc.kind,
    numPages: clean.length,
    _base: baseDoc,
    _order: clean,
    // display page (1-based) -> source page (1-based)
    toSourcePage: (displayPage) => clean[displayPage - 1] ?? null,
    // source page -> display page, or null when that page is currently hidden
    toDisplayPage: (sourcePage) => {
      const i = clean.indexOf(sourcePage);
      return i === -1 ? null : i + 1;
    },
    destroy: () => { try { baseDoc.destroy?.(); } catch { /* noop */ } },
    getPage: (displayPage) => baseDoc.getPage(clean[displayPage - 1]),
  };
}

// The identity order for a document, which is what the page manager starts from.
export function defaultPageOrder(numPages) {
  return Array.from({ length: numPages }, (_, i) => i + 1);
}

// Move one entry of an order array to another position, returning a new array.
export function movePage(order, from, to) {
  if (!Array.isArray(order)) return order;
  const n = order.length;
  if (from < 0 || from >= n || to < 0 || to >= n || from === to) return order.slice();
  const next = order.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

// ------------------- Split geometry -------------------
// A double page is rarely photographed square: the gutter usually leans a little.
// The cut is therefore a line, not a column — x = fold + (y - h/2) * tan(angle) —
// and each half is the region on one side of it.
//
// Because the line leans, a half is widest at one end. The returned width is that
// widest extent and `offset` is where to place the base page inside it, so no ink
// is clipped away at the corner where the half reaches furthest.
export function splitGeometry(width, height, ratio, angleDeg, isRight) {
  const r = Math.min(0.95, Math.max(0.05, Number.isFinite(ratio) ? ratio : 0.5));
  const angle = Math.max(-20, Math.min(20, Number.isFinite(angleDeg) ? angleDeg : 0));
  const fold = width * r;
  const lean = (height / 2) * Math.tan((angle * Math.PI) / 180);
  const foldMin = fold - Math.abs(lean);
  const foldMax = fold + Math.abs(lean);

  if (isRight) {
    const w = Math.max(1, Math.min(width, width - foldMin));
    return { width: w, offset: -Math.max(0, foldMin), fold, angle };
  }
  const w = Math.max(1, Math.min(width, foldMax));
  return { width: w, offset: 0, fold, angle };
}

// Normalise a stored override. Older files hold a bare ratio; newer ones hold
// {ratio, angle}. Both must keep working.
export function normaliseFold(value) {
  if (value == null) return null;
  if (typeof value === "number") return { ratio: value, angle: 0 };
  if (typeof value === "object" && Number.isFinite(value.ratio)) {
    return { ratio: value.ratio, angle: Number.isFinite(value.angle) ? value.angle : 0 };
  }
  return null;
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
          const latest = normaliseFold(getOverride(basePage));
          const effective = latest ? latest.ratio : foldRatio;
          const angle = latest ? latest.angle : 0;
          const bv = basePageObj.getViewport({ scale, rotation });
          const g = splitGeometry(bv.width, bv.height, effective, angle, isRight);
          return { width: g.width, height: bv.height, scale, rotation };
        },
        render: ({ canvasContext, viewport }) => {
          return {
            promise: (async () => {
              const latest = normaliseFold(getOverride(basePage));
              const effective = latest ? latest.ratio : foldRatio;
              const angle = latest ? latest.angle : 0;
              const { rotation = 0, scale } = viewport;
              const bv = basePageObj.getViewport({ scale, rotation });
              const g = splitGeometry(bv.width, bv.height, effective, angle, isRight);
              const lean = (bv.height / 2) * Math.tan((g.angle * Math.PI) / 180);
              // Draw the base page straight onto the destination, shifted so that the
              // half we want starts at x=0; the other half falls outside the canvas
              // and is clipped for free.
              //
              // This used to render the whole page onto an offscreen canvas and copy
              // half of it across. That asked for twice the pixels and, past roughly
              // 400% zoom on a full-size scan, for more than Chromium will allocate —
              // and an oversized canvas comes back blank rather than throwing, so the
              // page simply vanished. Both the base render and the underlying image
              // draw multiply into the current transform, so translating first is
              // enough for pdf.js pages and image sequences alike.
              canvasContext.save();
              canvasContext.translate(g.offset, 0);
              // Clip to the side of the leaning cut we want. The path is drawn in
              // base-page coordinates because the translate above is already in
              // effect, and it is extended well past the page on the far side so
              // the half is never trimmed by the path itself.
              const topX = g.fold - lean;
              const botX = g.fold + lean;
              const far = bv.width * 2;
              canvasContext.beginPath();
              if (isRight) {
                canvasContext.moveTo(topX, 0);
                canvasContext.lineTo(far, 0);
                canvasContext.lineTo(far, bv.height);
                canvasContext.lineTo(botX, bv.height);
              } else {
                canvasContext.moveTo(topX, 0);
                canvasContext.lineTo(-far, 0);
                canvasContext.lineTo(-far, bv.height);
                canvasContext.lineTo(botX, bv.height);
              }
              canvasContext.closePath();
              canvasContext.clip();
              await basePageObj.render({ canvasContext, viewport: bv }).promise;
              canvasContext.restore();
            })(),
          };
        },
      };
    },
    baseDoc,
  };
}

// ------------------- Canvas size limits -------------------
// Chromium caps both the longest side and the total area of a canvas. Past either
// limit it does not throw — it hands back a surface that stays blank, so the page
// silently disappears. Scale the backing store down instead: a slightly soft page
// at 1000% zoom beats no page at all.
const MAX_CANVAS_SIDE = 16384;
const MAX_CANVAS_AREA = 268435456; // 2^28 px

// maxPixels tightens the area budget beyond Chromium's own limit. The pixel-level
// filters read the whole backing store into JS, run a 3x3 kernel over it and write
// it back, all on the main thread; at full zoom that is a 190-megapixel canvas and
// the UI stops responding for many seconds on every slider nudge. Rendering those
// pages a little coarser while a filter is on keeps the control usable.
export const FILTERED_MAX_PIXELS = 12e6;

export function fitCanvasScale(width, height, desired = 1, maxPixels = MAX_CANVAS_AREA) {
  if (!(width > 0) || !(height > 0)) return desired;
  const area = Math.min(MAX_CANVAS_AREA, maxPixels > 0 ? maxPixels : MAX_CANVAS_AREA);
  const bySide = MAX_CANVAS_SIDE / Math.max(width, height);
  const byArea = Math.sqrt(area / (width * height));
  return Math.max(0.05, Math.min(desired, bySide, byArea));
}

// ------------------- Export size estimation -------------------
// Extrapolate the whole export from a handful of pages actually encoded at the
// chosen settings. Guessing from pixel counts is not good enough: how a page
// compresses depends on what is on it, and a manuscript's pages resemble each
// other far more than they resemble any formula.
export function extrapolateExportSize(sampleBytes, totalPages) {
  const samples = (sampleBytes || []).filter((n) => Number.isFinite(n) && n > 0);
  if (!samples.length || !(totalPages > 0)) return null;
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  const spread = samples.length > 1 ? Math.max(...samples) / Math.min(...samples) : 1;
  return {
    estimate: Math.round(mean * totalPages),
    perPage: Math.round(mean),
    sampled: samples.length,
    // How much the sampled pages differ from each other. A manuscript of plain
    // text pages sits near 1; a mix of blank leaves and dense illumination does
    // not, and then a single number deserves less trust.
    confidence: spread <= 1.5 ? "high" : spread <= 3 ? "medium" : "low",
  };
}

// Settings that keep the ink legible rather than the file small.
//
// The default was 4000px at 95% quality, which for most scans means upscaling
// nothing but storing JPEG artefacts at a fidelity no reader can see. Capping at
// the source's own longest side avoids inventing pixels, and 88% is where JPEG
// stops visibly softening the edges of Arabic script while still compressing well.
export function recommendExportSettings(sourceLongestSide) {
  const src = Number.isFinite(sourceLongestSide) && sourceLongestSide > 0 ? sourceLongestSide : 4000;
  const maxSize = Math.max(1200, Math.min(3000, Math.round(src)));
  return {
    maxSize,
    quality: 88,
    reason:
      src > 3000
        ? "مصوّرة عالية الدقة: 3000px تكفي لقراءة الحبر ومقابلته، وما فوقها يضاعف الحجم بلا فائدة مرئية"
        : "الحدّ مضبوط على دقة المصوّرة نفسها، فلا تُخترع بكسلات ولا تُفقد تفاصيل",
  };
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  const units = ["بايت", "ك.ب", "م.ب", "ج.ب"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
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
  // Nothing is decompressed here. JSZip holds the archive's compressed bytes and
  // inflates an entry only when its load() is called, which is what makes opening
  // a large archive immediate instead of a long unpack.
  const images = [];
  const pdfs = [];
  for (const entry of entries) {
    const item = { name: entry.name, load: () => entry.async("blob") };
    if (IMAGE_EXT.test(entry.name)) images.push(item);
    else if (PDF_EXT.test(entry.name)) pdfs.push(item);
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
  // Same deal as the zip path: hand back handles, extract on demand.
  const images = [];
  const pdfs = [];
  for (const f of files) {
    const name = f.file.name;
    const extractAs = async (fallbackType) => {
      const extracted = await f.file.extract();
      return new Blob([await extracted.arrayBuffer()], { type: extracted.type || fallbackType });
    };
    if (IMAGE_EXT.test(name)) images.push({ name, load: () => extractAs("image/jpeg") });
    else if (PDF_EXT.test(name)) pdfs.push({ name, load: () => extractAs("application/pdf") });
  }
  return { images, pdfs };
}

// ------------------- Builder API -------------------
const ARCHIVE_EXT = /\.(rar|7z|tar|tar\.gz|tgz|tar\.bz2)$/i;

// Open a PDF by reading byte ranges off disk, without the file ever being copied
// into the page.
//
// pdf.js will only issue range requests for a URL it considers HTTP — it gates
// them on `/^https?:/i.test(url)` and, failing that, never sends a Range header
// at all. A blob: URL fails that test, so handing pdf.js one does not get ranges;
// it gets the whole document read into the renderer, which is what left a 1.7GB
// manuscript resident after opening. A custom scheme fails the same test.
//
// PDFDataRangeTransport is the way past it: pdf.js asks *us* for [begin, end) and
// we answer from a file descriptor in the main process. No URL is involved, so
// there is no protocol to register and nothing to gate.
async function createRangeDoc(filePath, pdfjsLib, bridge) {
  const { id, size } = await bridge.openRangeFile(filePath);

  class DiskRangeTransport extends pdfjsLib.PDFDataRangeTransport {
    constructor() {
      // No initial data, and progressiveDone so pdf.js stops waiting on the
      // "full" stream that will never produce anything and satisfies the whole
      // document through ranges instead.
      super(size, null, true, null);
      this.aborted = false;
    }

    requestDataRange(begin, end) {
      bridge.readRange(id, begin, end).then((bytes) => {
        if (this.aborted) return;
        // pdf.js matches the reply to its pending reader by `begin`, so a failed
        // read must not answer with the wrong offset — better to leave it pending
        // and let the caller's own error path run.
        this.onDataRange(begin, bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
      }).catch(() => { /* reader stays pending; destroy() tears it down */ });
    }

    abort() {
      this.aborted = true;
    }
  }

  const doc = await pdfjsLib.getDocument({
    range: new DiskRangeTransport(),
    disableAutoFetch: true, // do not quietly pull the rest once the document opens
    disableStream: true,    // every byte comes through requestDataRange
    rangeChunkSize: 1 << 20,
  }).promise;
  doc.kind = "pdf";
  doc._rangeFileId = id;
  return doc;
}

export async function buildDocFromFile(file, { pdfjsLib, JSZip, splitPages = false, splitRange, overridesRef, filePath } = {}) {
  const name = file.name.toLowerCase();
  let base;

  if (PDF_EXT.test(name)) {
    const bridge = typeof window !== "undefined" ? window.msElectron : null;
    base = null;
    if (filePath && bridge?.openRangeFile) {
      try {
        base = await createRangeDoc(filePath, pdfjsLib, bridge);
      } catch (err) {
        // Falling back silently would turn "reads by range" into "loads the whole
        // file" with nothing to show why, which is the failure that is hardest to
        // notice on a large manuscript.
        console.warn("تعذّر فتح المخطوط بالمقاطع؛ سيُقرأ كاملًا:", err);
        base = null;
      }
    }
    if (!base) {
      // In a browser there is no path to read from, so this is the only option.
      // `file.arrayBuffer()` would be worse still: it pulls the whole file into a
      // JavaScript buffer before a single page is drawn, and close to double that
      // while the copy is made.
      //
      // A manuscript opened by path has no File behind it, so if the range route
      // failed there is nothing here to make a URL from and the bytes have to be
      // fetched whole. That is the bad case this fallback exists for, and it is
      // why the failure above is logged rather than swallowed.
      const blob = file instanceof Blob
        ? file
        : new Blob([await bridge.readFile(filePath)], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      base = await pdfjsLib.getDocument({
        url,
        disableAutoFetch: true,
        disableStream: false,
        rangeChunkSize: 1 << 20,
      }).promise;
      base.kind = "pdf";
      base._objectUrl = url;
    }
  } else if (IMAGE_EXT.test(name)) {
    base = createImageDoc([{ name: file.name, load: async () => file }]);
  } else if (/\.zip$/i.test(name) || ARCHIVE_EXT.test(name)) {
    const isZip = /\.zip$/i.test(name);
    const { images, pdfs } = isZip
      ? await unpackZip(file, JSZip)
      : await unpackArchive(file);
    // If no images and multiple PDFs, merge them into one
    if (images.length === 0 && pdfs.length > 0) {
      if (pdfs.length === 1) {
        const buf = await (await pdfs[0].load()).arrayBuffer();
        base = await pdfjsLib.getDocument({ data: buf }).promise;
        base.kind = "pdf";
      } else {
        // Merging genuinely needs every PDF, so these are extracted up front —
        // unlike the image path, there is nothing to defer.
        const { PDFDocument } = await import("pdf-lib");
        const merged = await PDFDocument.create();
        // Sort PDFs by filename for consistent order
        pdfs.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
        for (const p of pdfs) {
          const buf = await (await p.load()).arrayBuffer();
          const src = await PDFDocument.load(buf);
          const copied = await merged.copyPages(src, src.getPageIndices());
          copied.forEach((pg) => merged.addPage(pg));
        }
        const mergedBytes = await merged.save();
        base = await pdfjsLib.getDocument({ data: mergedBytes }).promise;
        base.kind = "pdf";
      }
    } else if (images.length > 0) {
      base = createImageDoc(images);
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
