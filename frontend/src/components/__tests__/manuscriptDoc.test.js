import { formatFolio, toggleSplitDoc, fitCanvasScale, createImageDoc } from "../manuscriptDoc";

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
