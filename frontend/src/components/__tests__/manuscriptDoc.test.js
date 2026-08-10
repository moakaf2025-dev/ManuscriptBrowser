import { formatFolio, toggleSplitDoc } from "../manuscriptDoc";

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
