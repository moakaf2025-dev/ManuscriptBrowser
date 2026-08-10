import {
  formatFolio, toggleSplitDoc, fitCanvasScale, createImageDoc,
  createOrderedDoc, defaultPageOrder, movePage,
  extrapolateExportSize, recommendExportSettings, formatBytes,
} from "../manuscriptDoc";

describe("formatFolio", () => {
  it("numbers two viewer pages to one folio, recto then verso", () => {
    expect(formatFolio(1)).toBe("١/أ");
    expect(formatFolio(2)).toBe("١/ب");
    expect(formatFolio(3)).toBe("٢/أ");
    expect(formatFolio(4)).toBe("٢/ب");
  });

  it("uses Arabic-Indic digits so BiDi keeps number-slash-letter order", () => {
    // Western digits are weak-directional and would flip around the slash in an
    // RTL run; every glyph here is strong-RTL.
    expect(formatFolio(21)).toBe("١١/أ");
    expect(formatFolio(21)).not.toMatch(/[0-9]/);
  });

  it("treats pages before the offset as cover plates, not folios", () => {
    expect(formatFolio(1, { offset: 2 })).toBe("[غلاف ١]");
    expect(formatFolio(2, { offset: 2 })).toBe("[غلاف ٢]");
    expect(formatFolio(3, { offset: 2 })).toBe("١/أ");
    expect(formatFolio(4, { offset: 2 })).toBe("١/ب");
  });

  it("starts counting at startFolio when the scan begins mid-manuscript", () => {
    expect(formatFolio(1, { startFolio: 5 })).toBe("٥/أ");
    expect(formatFolio(2, { startFolio: 5 })).toBe("٥/ب");
    expect(formatFolio(3, { startFolio: 5 })).toBe("٦/أ");
  });

  it("can render Latin folio numbers for non-Arabic citation", () => {
    expect(formatFolio(3, { latin: true })).toBe("2/a");
    expect(formatFolio(4, { latin: true })).toBe("2/b");
  });

  it("falls back to plain page numbering when folio style is off", () => {
    expect(formatFolio(7, { style: "page" })).toBe("صفحة ٧");
  });
});

describe("split-page numbering", () => {
  const baseDoc = (numPages) => ({
    kind: "images",
    numPages,
    getPage: async () => ({ getViewport: () => ({ width: 100, height: 100 }), render: () => ({ promise: Promise.resolve() }) }),
  });

  it("leaves the document untouched when splitting is off", () => {
    const base = baseDoc(10);
    expect(toggleSplitDoc(base, false)).toBe(base);
  });

  it("adds one virtual page per split page and nothing more", () => {
    const split = toggleSplitDoc(baseDoc(10), true, { from: 3, to: 5 });
    expect(split.numPages).toBe(13); // 10 + 3 split pages
  });

  it("maps virtual pages back to the right half of the right base page", () => {
    const split = toggleSplitDoc(baseDoc(10), true, { from: 3, to: 5 });
    // before the split range: untouched, one-to-one
    expect(split.resolve(1)).toEqual({ basePage: 1, split: false });
    expect(split.resolve(2)).toEqual({ basePage: 2, split: false });
    // inside the range: each base page becomes recto (side 0) then verso (side 1)
    expect(split.resolve(3)).toEqual({ basePage: 3, split: true, side: 0 });
    expect(split.resolve(4)).toEqual({ basePage: 3, split: true, side: 1 });
    expect(split.resolve(5)).toEqual({ basePage: 4, split: true, side: 0 });
    expect(split.resolve(8)).toEqual({ basePage: 5, split: true, side: 1 });
    // after the range: shifted back by the number of pages that were split
    expect(split.resolve(9)).toEqual({ basePage: 6, split: false });
    expect(split.resolve(13)).toEqual({ basePage: 10, split: false });
  });

  it("clamps a range that runs past the end of the document", () => {
    const split = toggleSplitDoc(baseDoc(4), true, { from: 2, to: 999 });
    expect(split._range).toEqual({ from: 2, to: 4 });
    expect(split.numPages).toBe(7); // 4 + 3 split pages
  });
});

describe("lazy image pages", () => {
  // jsdom has no image decoding, so stand in for the bits createImageDoc uses.
  let created, revoked, loads;

  beforeEach(() => {
    created = [];
    revoked = [];
    loads = [];
    global.URL.createObjectURL = (blob) => { const u = `blob:${created.length}`; created.push(blob); return u; };
    global.URL.revokeObjectURL = (u) => revoked.push(u);
    // loadImage() news up an Image and waits for onload; make that resolve at once.
    global.Image = class {
      constructor() { setTimeout(() => this.onload && this.onload(), 0); }
      set src(v) { this._src = v; }
      get src() { return this._src; }
      naturalWidth = 100;
      naturalHeight = 200;
    };
  });

  const makeDoc = (count, opts) =>
    createImageDoc(
      Array.from({ length: count }, (_, i) => ({
        name: `p${i}.jpg`,
        load: async () => { loads.push(i); return new Blob([`page ${i}`]); },
      })),
      opts
    );

  it("does not touch any entry until a page is asked for", async () => {
    const doc = makeDoc(500);
    expect(doc.numPages).toBe(500);
    expect(loads).toEqual([]);
    expect(created).toEqual([]);
  });

  it("loads only the page requested", async () => {
    const doc = makeDoc(500);
    await doc.getPage(7);
    expect(loads).toEqual([6]);
  });

  it("serves a repeated page from cache instead of reloading it", async () => {
    const doc = makeDoc(10);
    await doc.getPage(3);
    await doc.getPage(3);
    await doc.getPage(3);
    expect(loads).toEqual([2]);
  });

  it("coalesces concurrent requests for the same page", async () => {
    const doc = makeDoc(10);
    await Promise.all([doc.getPage(4), doc.getPage(4), doc.getPage(4)]);
    expect(loads).toEqual([3]);
  });

  it("keeps only the most recent pages and frees the rest", async () => {
    const doc = makeDoc(20, { cacheSize: 3 });
    for (const p of [1, 2, 3, 4, 5]) await doc.getPage(p);
    // five loaded, three retained, so the two oldest URLs are released
    expect(loads).toEqual([0, 1, 2, 3, 4]);
    expect(revoked).toEqual(["blob:0", "blob:1"]);
  });

  it("counts a re-read as recent use, so it is not the next evicted", async () => {
    const doc = makeDoc(20, { cacheSize: 3 });
    for (const p of [1, 2, 3]) await doc.getPage(p);
    await doc.getPage(1); // touch the oldest
    await doc.getPage(4); // forces one eviction
    expect(revoked).toEqual(["blob:1"]); // page 2, not page 1
  });

  it("releases everything still held when the document is destroyed", async () => {
    const doc = makeDoc(20, { cacheSize: 10 });
    for (const p of [1, 2, 3]) await doc.getPage(p);
    expect(revoked).toEqual([]);
    doc.destroy();
    expect(revoked.sort()).toEqual(["blob:0", "blob:1", "blob:2"]);
  });
});

describe("page order", () => {
  const baseDoc = (numPages) => ({
    kind: "images",
    numPages,
    getPage: async (n) => ({ _sourcePage: n }),
  });

  it("passes the document through untouched when the order is the natural one", () => {
    const base = baseDoc(5);
    expect(createOrderedDoc(base, [1, 2, 3, 4, 5])).toBe(base);
    expect(createOrderedDoc(base, null)).toBe(base);
    expect(createOrderedDoc(base, [])).toBe(base);
  });

  it("shows pages in the order given", async () => {
    const doc = createOrderedDoc(baseDoc(5), [3, 1, 2, 5, 4]);
    expect(doc.numPages).toBe(5);
    expect((await doc.getPage(1))._sourcePage).toBe(3);
    expect((await doc.getPage(2))._sourcePage).toBe(1);
    expect((await doc.getPage(5))._sourcePage).toBe(4);
  });

  it("hides a page left out of the order without renumbering the source", async () => {
    const doc = createOrderedDoc(baseDoc(5), [1, 2, 4, 5]); // page 3 removed
    expect(doc.numPages).toBe(4);
    expect((await doc.getPage(3))._sourcePage).toBe(4);
    expect(doc.toDisplayPage(3)).toBeNull();  // hidden
    expect(doc.toDisplayPage(4)).toBe(3);
  });

  it("maps both ways so annotations can follow their own page", () => {
    const doc = createOrderedDoc(baseDoc(4), [4, 3, 2, 1]);
    for (const src of [1, 2, 3, 4]) {
      expect(doc.toSourcePage(doc.toDisplayPage(src))).toBe(src);
    }
  });

  it("ignores entries that are not real pages", () => {
    const doc = createOrderedDoc(baseDoc(3), [2, 99, 0, -1, 1, null, 3]);
    expect(doc._order).toEqual([2, 1, 3]);
  });

  it("moves a page without losing or duplicating any", () => {
    const order = defaultPageOrder(6);
    expect(movePage(order, 0, 3)).toEqual([2, 3, 4, 1, 5, 6]);
    expect(movePage(order, 5, 0)).toEqual([6, 1, 2, 3, 4, 5]);
    expect(movePage(order, 2, 2)).toEqual(order);
    const moved = movePage(order, 4, 1);
    expect([...moved].sort((a, b) => a - b)).toEqual(order);
  });

  it("leaves the order alone for an out-of-range move", () => {
    const order = defaultPageOrder(4);
    expect(movePage(order, -1, 2)).toEqual(order);
    expect(movePage(order, 0, 9)).toEqual(order);
  });

  it("survives being stacked under the splitting layer", async () => {
    // Reordering happens before numbering, so splitting sees the reordered pages.
    const ordered = createOrderedDoc(baseDoc(4), [4, 3, 2, 1]);
    const split = toggleSplitDoc(ordered, true, { from: 1, to: 2 });
    expect(split.numPages).toBe(6); // 4 pages, first two split in half
    expect(split.resolve(1)).toEqual({ basePage: 1, split: true, side: 0 });
    expect((await ordered.getPage(1))._sourcePage).toBe(4);
  });
});

describe("export size estimation", () => {
  it("scales the average sampled page up to the whole document", () => {
    const r = extrapolateExportSize([100000, 120000, 110000], 300);
    expect(r.perPage).toBe(110000);
    expect(r.estimate).toBe(110000 * 300);
    expect(r.sampled).toBe(3);
  });

  it("trusts a document whose pages compress alike, and says so when they do not", () => {
    expect(extrapolateExportSize([100000, 110000], 50).confidence).toBe("high");
    expect(extrapolateExportSize([100000, 250000], 50).confidence).toBe("medium");
    expect(extrapolateExportSize([50000, 900000], 50).confidence).toBe("low");
  });

  it("returns nothing rather than a made-up number when it has no samples", () => {
    expect(extrapolateExportSize([], 100)).toBeNull();
    expect(extrapolateExportSize([0, NaN], 100)).toBeNull();
    expect(extrapolateExportSize([100000], 0)).toBeNull();
  });

  it("never recommends upscaling past the source", () => {
    expect(recommendExportSettings(2200).maxSize).toBe(2200);
    expect(recommendExportSettings(1000).maxSize).toBe(1200); // floor, still legible
  });

  it("caps very large scans where extra pixels stop buying legibility", () => {
    const r = recommendExportSettings(6000);
    expect(r.maxSize).toBe(3000);
    expect(r.quality).toBe(88);
    expect(r.reason).toContain("3000px");
  });

  it("formats sizes for reading", () => {
    expect(formatBytes(0)).toBe("—");
    expect(formatBytes(2048)).toBe("2.0 ك.ب");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 م.ب");
    expect(formatBytes(1.5 * 1024 * 1024 * 1024)).toBe("1.5 ج.ب");
  });
});

describe("fitCanvasScale", () => {
  it("leaves ordinary pages at the scale they asked for", () => {
    expect(fitCanvasScale(1200, 1600, 2)).toBe(2);
    expect(fitCanvasScale(1200, 1600, 1)).toBe(1);
  });

  it("caps the longest side at what Chromium will allocate", () => {
    // 9000px wide at dpr 2 would be 18000px, past the 16384 limit.
    const s = fitCanvasScale(9000, 1000, 2);
    expect(9000 * s).toBeLessThanOrEqual(16384);
  });

  it("keeps every result inside both limits at once", () => {
    const sizes = [
      [800, 1200], [4200, 5800], [9000, 1000], [1000, 20000],
      [16000, 16000], [30000, 900], [50000, 50000],
    ];
    for (const [w, h] of sizes) {
      for (const desired of [0.5, 1, 2]) {
        const s = fitCanvasScale(w, h, desired);
        expect(s).toBeLessThanOrEqual(desired);
        expect(Math.max(w * s, h * s)).toBeLessThanOrEqual(16384 + 1e-6);
        expect(w * s * h * s).toBeLessThanOrEqual(268435456 + 1);
      }
    }
  });

  it("never scales all the way to nothing", () => {
    expect(fitCanvasScale(1e6, 1e6, 2)).toBeGreaterThan(0);
  });

  it("passes through degenerate sizes rather than dividing by zero", () => {
    expect(fitCanvasScale(0, 0, 1.5)).toBe(1.5);
  });
});
