import {
  applyRecipe, DEFAULT_RECIPE, estimateBackground, flattenIllumination,
  neutralisePaper, stretchContrast, adaptiveThreshold, RECIPE_PRESETS,
} from "../imageEnhance";

// A stand-in page: paper with a horizontal illumination gradient (bright on the
// left, shadowed on the right, as a binding shadow looks) and darker ink strokes.
function makePage(width = 120, height = 90, { cast = [1, 1, 1], inkRows = [30, 60] } = {}) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const lighting = 1 - 0.5 * (x / width); // 1.0 down to 0.5
      const isInk = inkRows.some((r) => y >= r && y < r + 6) && x > 10 && x < width - 10;
      const base = isInk ? 70 : 230;
      const v = base * lighting;
      data[i] = Math.min(255, v * cast[0]);
      data[i + 1] = Math.min(255, v * cast[1]);
      data[i + 2] = Math.min(255, v * cast[2]);
      data[i + 3] = 255;
    }
  }
  return { data, width, height };
}

const lum = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
const at = (page, x, y) => {
  const i = (y * page.width + x) * 4;
  return lum(page.data, i);
};

describe("background estimate", () => {
  it("follows the lighting across the sheet", () => {
    const page = makePage();
    const bg = estimateBackground(page.data, page.width, page.height);
    const left = bg.grid[Math.floor(bg.gh / 2) * bg.gw + 1];
    const right = bg.grid[Math.floor(bg.gh / 2) * bg.gw + (bg.gw - 2)];
    expect(left).toBeGreaterThan(right * 1.3);
  });
});

describe("illumination flattening", () => {
  it("evens out paper brightness between the lit and shadowed sides", () => {
    const page = makePage();
    const before = { left: at(page, 5, 5), right: at(page, page.width - 5, 5) };
    flattenIllumination(page.data, page.width, page.height, 100);
    const after = { left: at(page, 5, 5), right: at(page, page.width - 5, 5) };
    const spreadBefore = Math.abs(before.left - before.right);
    const spreadAfter = Math.abs(after.left - after.right);
    expect(spreadAfter).toBeLessThan(spreadBefore / 2);
  });

  it("keeps ink darker than paper while doing it", () => {
    const page = makePage();
    flattenIllumination(page.data, page.width, page.height, 100);
    expect(at(page, 60, 32)).toBeLessThan(at(page, 60, 10)); // ink row vs paper row
  });

  it("does nothing at zero strength", () => {
    const page = makePage();
    const copy = Uint8ClampedArray.from(page.data);
    flattenIllumination(page.data, page.width, page.height, 0);
    expect(page.data).toEqual(copy);
  });
});

describe("paper neutralisation", () => {
  it("pulls a yellow cast back towards neutral", () => {
    const page = makePage(80, 60, { cast: [1, 0.95, 0.72] });
    const i = (5 * 80 + 5) * 4;
    const castBefore = page.data[i] - page.data[i + 2];
    neutralisePaper(page.data, page.width, page.height, 100);
    const castAfter = page.data[i] - page.data[i + 2];
    expect(Math.abs(castAfter)).toBeLessThan(Math.abs(castBefore));
  });
});

describe("contrast stretch", () => {
  it("widens the gap between ink and paper", () => {
    const page = makePage();
    const gapBefore = at(page, 60, 10) - at(page, 60, 32);
    stretchContrast(page.data, page.width, page.height, 100);
    const gapAfter = at(page, 60, 10) - at(page, 60, 32);
    expect(gapAfter).toBeGreaterThan(gapBefore);
  });

  it("leaves a flat image alone rather than amplifying nothing", () => {
    const width = 20, height = 20;
    const data = new Uint8ClampedArray(width * height * 4).fill(128);
    for (let i = 3; i < data.length; i += 4) data[i] = 255;
    const copy = Uint8ClampedArray.from(data);
    stretchContrast(data, width, height, 100);
    expect(data).toEqual(copy);
  });
});

describe("adaptive threshold", () => {
  it("separates ink from paper on both the lit and shadowed sides", () => {
    const page = makePage();
    adaptiveThreshold(page.data, page.width, page.height, 100);
    // shadowed side: ink still lands dark and paper still lands light
    expect(at(page, page.width - 20, 32)).toBeLessThan(60);
    expect(at(page, page.width - 20, 10)).toBeGreaterThan(200);
  });
});

describe("applyRecipe", () => {
  it("does nothing unless it is enabled", () => {
    const page = makePage();
    const copy = Uint8ClampedArray.from(page.data);
    applyRecipe(page, { ...DEFAULT_RECIPE, enabled: false, flatten: 100 });
    expect(page.data).toEqual(copy);
  });

  it("improves ink-to-paper separation on a badly lit page", () => {
    const page = makePage();
    const shadowGapBefore = at(page, page.width - 20, 10) - at(page, page.width - 20, 32);
    applyRecipe(page, { ...DEFAULT_RECIPE, enabled: true });
    const shadowGapAfter = at(page, page.width - 20, 10) - at(page, page.width - 20, 32);
    expect(shadowGapAfter).toBeGreaterThan(shadowGapBefore);
  });

  it("evens the page out so the shadowed side reads like the lit side", () => {
    const page = makePage();
    const before = Math.abs(at(page, 5, 5) - at(page, page.width - 5, 5));
    applyRecipe(page, { ...DEFAULT_RECIPE, enabled: true });
    const after = Math.abs(at(page, 5, 5) - at(page, page.width - 5, 5));
    expect(after).toBeLessThan(before);
  });

  it("ships presets that are all enabled and in range", () => {
    for (const p of RECIPE_PRESETS) {
      expect(p.name).toBeTruthy();
      expect(p.recipe.enabled).toBe(true);
      for (const k of ["flatten", "paper", "contrast", "sharpen", "threshold"]) {
        expect(p.recipe[k]).toBeGreaterThanOrEqual(0);
        expect(p.recipe[k]).toBeLessThanOrEqual(100);
      }
    }
  });

  it("survives a degenerate image without throwing", () => {
    expect(() => applyRecipe({ data: new Uint8ClampedArray(0), width: 0, height: 0 }, { enabled: true })).not.toThrow();
  });
});
