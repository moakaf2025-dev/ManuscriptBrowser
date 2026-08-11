import { buildBackup, parseBackup, mergeInto, summarise, BACKUP_FORMAT, BACKUP_KEYS, backupContentHash, hasBackupWorthyContent } from "../manuscriptBackup";

const store = {
  "manuscriptRulerComments.v1": JSON.stringify({
    "الأزهر 1.pdf|100|1": [{ id: "c1", page: 2, text: "سقط" }, { id: "c2", page: 5, text: "حاشية" }],
    "5626.rar|200|2": [{ id: "c3", page: 1, text: "تعليق" }],
  }),
  "manuscriptRulerHeadings.v1": JSON.stringify({ "الأزهر 1.pdf|100|1": [{ id: "h1", page: 1, title: "كتاب الطهارة" }] }),
  "manuscriptRulerInfo.v1": JSON.stringify({ "الأزهر 1.pdf|100|1": { title: "شرح الورقات" } }),
  "manuscriptRulerPageOrder.v1": JSON.stringify({ "5626.rar|200|2": [3, 1, 2] }),
};
const read = (k) => (k in store ? store[k] : null);

describe("building a backup", () => {
  it("carries every kind of work the reader produced", () => {
    const b = buildBackup(read);
    expect(b.format).toBe(BACKUP_FORMAT);
    expect(b.data["manuscriptRulerComments.v1"]["5626.rar|200|2"]).toHaveLength(1);
    expect(b.data["manuscriptRulerHeadings.v1"]).toBeDefined();
    expect(b.data["manuscriptRulerPageOrder.v1"]["5626.rar|200|2"]).toEqual([3, 1, 2]);
  });

  it("skips keys this install has never written", () => {
    const b = buildBackup(() => null);
    expect(Object.keys(b.data)).toHaveLength(0);
  });

  it("summarises what is inside so the file is not opaque", () => {
    const b = buildBackup(read);
    expect(b.summary).toEqual({ manuscripts: 2, comments: 3, headings: 1 });
  });

  it("records when it was taken", () => {
    expect(Date.parse(buildBackup(read).savedAt)).not.toBeNaN();
  });
});

describe("reading a backup", () => {
  const roundTrip = () => parseBackup(JSON.stringify(buildBackup(read)));

  it("accepts a file it wrote itself", () => {
    const r = roundTrip();
    expect(r.ok).toBe(true);
    expect(r.summary.comments).toBe(3);
    expect(r.data["manuscriptRulerComments.v1"]["الأزهر 1.pdf|100|1"]).toHaveLength(2);
  });

  it("refuses anything that is not one of ours, with a reason", () => {
    expect(parseBackup("not json").ok).toBe(false);
    expect(parseBackup(JSON.stringify({ hello: 1 })).error).toContain("ليس نسخة احتياطية");
    expect(parseBackup(JSON.stringify({ format: BACKUP_FORMAT, version: 99, data: {} })).error).toContain("أحدث");
    expect(parseBackup(JSON.stringify({ format: BACKUP_FORMAT, version: 1, data: {} })).error).toContain("فارغة");
  });

  it("ignores unknown keys rather than writing them into storage", () => {
    const r = parseBackup(JSON.stringify({
      format: BACKUP_FORMAT, version: 1,
      data: { "manuscriptRulerComments.v1": { a: [] }, "somethingElse": { evil: true } },
    }));
    expect(r.ok).toBe(true);
    expect(Object.keys(r.data)).toEqual(["manuscriptRulerComments.v1"]);
    expect(BACKUP_KEYS).not.toContain("somethingElse");
  });
});

describe("merging a restore into existing work", () => {
  it("adds manuscripts this machine has never seen", () => {
    const mine = JSON.stringify({ A: [{ id: 1 }] });
    expect(mergeInto(mine, { B: [{ id: 2 }] })).toEqual({ A: [{ id: 1 }], B: [{ id: 2 }] });
  });

  it("does not overwrite work already here", () => {
    const mine = JSON.stringify({ A: [{ id: "mine" }] });
    expect(mergeInto(mine, { A: [{ id: "theirs" }] })).toEqual({ A: [{ id: "mine" }] });
  });

  it("fills in a manuscript that is present but empty", () => {
    const mine = JSON.stringify({ A: [] });
    expect(mergeInto(mine, { A: [{ id: "theirs" }] })).toEqual({ A: [{ id: "theirs" }] });
  });

  it("is safe to run twice", () => {
    const once = mergeInto(JSON.stringify({ A: [{ id: 1 }] }), { B: [{ id: 2 }] });
    const twice = mergeInto(JSON.stringify(once), { B: [{ id: 2 }] });
    expect(twice).toEqual(once);
  });

  it("takes the incoming data when this install has nothing or is corrupt", () => {
    expect(mergeInto(null, { A: 1 })).toEqual({ A: 1 });
    expect(mergeInto("{broken", { A: 1 })).toEqual({ A: 1 });
  });
});

describe("summarise", () => {
  it("counts nothing for an empty backup", () => {
    expect(summarise({})).toEqual({ manuscripts: 0, comments: 0, headings: 0 });
  });
});

describe("hasBackupWorthyContent", () => {
  it("is false for a backup with nothing in it", () => {
    expect(hasBackupWorthyContent({})).toBe(false);
  });

  it("is false when every recorded key is empty", () => {
    expect(hasBackupWorthyContent({
      "manuscriptRulerComments.v1": {},
      "manuscriptRulerBookmarks.v1": [],
    })).toBe(false);
  });

  it("is true once a comment exists", () => {
    expect(hasBackupWorthyContent(buildBackup(read).data)).toBe(true);
  });

  it("ignores state, recents, auto-bookmark and per-file settings", () => {
    // These rewrite themselves on nearly every page turn; keying the close-time
    // reminder off them would nag on every session regardless of whether the
    // reader wrote a single word.
    const noisy = {
      "manuscriptRulerState.v1": { page: 12, zoomIdx: 3 },
      "manuscriptRulerRecents.v1": [{ fileKey: "a", name: "a.pdf" }],
      "manuscriptRulerAutoBM.v1": { "a|1|1": { page: 5 } },
      "manuscriptRulerPerFileSettings.v1": { "a|1|1": { brightness: 80 } },
    };
    expect(hasBackupWorthyContent(noisy)).toBe(false);
  });
});

describe("backupContentHash", () => {
  it("is stable for the same reminder-relevant content", () => {
    const data = buildBackup(read).data;
    expect(backupContentHash(data)).toBe(backupContentHash(data));
  });

  it("changes when a comment is added", () => {
    const before = backupContentHash(buildBackup(read).data);
    const after = backupContentHash(buildBackup((k) => (k === "manuscriptRulerComments.v1"
      ? JSON.stringify({ "new|1|1": [{ id: "c9", page: 1, text: "جديد" }] })
      : read(k))).data);
    expect(after).not.toBe(before);
  });

  it("does not change when only state, recents or per-file settings change", () => {
    const withExtras = (extra) => buildBackup((k) => (Object.prototype.hasOwnProperty.call(extra, k) ? extra[k] : read(k))).data;
    const a = backupContentHash(withExtras({ "manuscriptRulerState.v1": JSON.stringify({ page: 1 }) }));
    const b = backupContentHash(withExtras({ "manuscriptRulerState.v1": JSON.stringify({ page: 99 }) }));
    expect(a).toBe(b);
  });
});
