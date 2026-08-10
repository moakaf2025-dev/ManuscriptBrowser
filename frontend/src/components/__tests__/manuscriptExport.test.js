import JSZip from "jszip";
import docx from "docx";
import { infoRows, buildHeadingsDocument, buildCommentsDocument } from "../manuscriptExport";

// Guards the interop the app depends on: `docx` is aliased to its CommonJS build,
// and only the default binding carries the library's exports. A named or namespace
// import compiles fine and then reads undefined in the browser.
it("exposes the docx API through the default binding", () => {
  expect(typeof docx.Packer).toBe("function");
  expect(docx.BorderStyle && docx.BorderStyle.SINGLE).toBeTruthy();
});

// Pull the main document part out of the .docx so assertions run against the OOXML
// Word will actually read, not against our own builder objects.
async function documentXml(doc) {
  const buffer = await docx.Packer.toBuffer(doc);
  const zip = await JSZip.loadAsync(buffer);
  return zip.file("word/document.xml").async("string");
}

const fullInfo = {
  type: "single",
  number: "12345",
  library: "الأزهر",
  title: "شرح الورقات",
  author: "ابن الفركاح",
  copyist: "محمد بن أحمد",
  copyDate: "823هـ",
  notes: "نسخة تامة",
};

describe("infoRows", () => {
  it("keeps only fields that are filled in", () => {
    expect(infoRows({ number: "12", library: "", title: "   " })).toEqual([["رقم النسخة", "12"]]);
  });

  it("reports the single-manuscript fields in card order", () => {
    expect(infoRows(fullInfo).map(([k]) => k)).toEqual([
      "رقم النسخة", "المكتبة", "عنوان المخطوط", "المؤلف", "الناسخ", "تاريخ النسخ", "ملاحظات ووصف",
    ]);
  });

  it("exports the list of works in a collection, which the old export dropped", () => {
    const rows = infoRows({ type: "collection", number: "7", titlesList: "1. الأول\n2. الثاني" });
    expect(rows).toContainEqual(["نوع المخطوط", "مجموع"]);
    expect(rows).toContainEqual(["عناوين المجموع", "1. الأول\n2. الثاني"]);
  });

  it("does not emit author or copyist for a collection", () => {
    const keys = infoRows({ type: "collection", author: "س", copyist: "ص" }).map(([k]) => k);
    expect(keys).not.toContain("المؤلف");
    expect(keys).not.toContain("الناسخ");
  });

  it("ignores fields the info card has no input for", () => {
    // The previous Word export printed nine such fields; none can ever be set.
    const rows = infoRows({ ...fullInfo, era: "القرن التاسع", script: "نسخ", dimensions: "20x15" });
    const values = rows.map(([, v]) => v);
    expect(values).not.toContain("القرن التاسع");
    expect(values).not.toContain("نسخ");
    expect(values).not.toContain("20x15");
  });
});

describe("headings export", () => {
  const headings = [
    { id: "b", page: 9, title: "باب الإجماع", level: 2 },
    { id: "a", page: 3, title: "كتاب الطهارة", level: 1 },
  ];

  it("produces a real Office Open XML package", async () => {
    const buffer = await docx.Packer.toBuffer(
      buildHeadingsDocument({ info: fullInfo, headings, fileName: "الأزهر 12345.pdf" })
    );
    const zip = await JSZip.loadAsync(buffer);
    // A .docx is a zip with these parts; the old export was HTML named .doc.
    expect(zip.file("[Content_Types].xml")).toBeTruthy();
    expect(zip.file("word/document.xml")).toBeTruthy();
  });

  it("orders headings by page and cites each with its folio", async () => {
    const xml = await documentXml(
      buildHeadingsDocument({
        info: fullInfo,
        headings,
        fileName: "x.pdf",
        folio: (page) => `f${page}`,
      })
    );
    expect(xml.indexOf("كتاب الطهارة")).toBeLessThan(xml.indexOf("باب الإجماع"));
    expect(xml).toContain("f3");
    expect(xml).toContain("f9");
  });

  it("marks the text right-to-left so Word lays it out correctly", async () => {
    const xml = await documentXml(buildHeadingsDocument({ info: fullInfo, headings }));
    expect(xml).toContain("<w:bidi");   // paragraph direction
    expect(xml).toContain("<w:rtl");    // run direction
    expect(xml).toContain("<w:bidiVisual"); // table column order
  });

  it("says so plainly when there is nothing to export", async () => {
    const xml = await documentXml(buildHeadingsDocument({ info: fullInfo, headings: [] }));
    expect(xml).toContain("لا توجد عناوين مسجّلة");
  });
});

describe("comments export", () => {
  const comments = [
    { id: "2", page: 8, y: 10, folio: "٤/ب", line: 3, text: "سقط هنا", createdAt: 1700000000000 },
    { id: "1", page: 2, y: 40, folio: "١/ب", text: "تعليق أول\nسطر ثانٍ", createdAt: 1700000000000 },
  ];

  it("orders by page then position on the page", async () => {
    const xml = await documentXml(buildCommentsDocument({ info: fullInfo, comments }));
    expect(xml.indexOf("تعليق أول")).toBeLessThan(xml.indexOf("سقط هنا"));
  });

  it("carries the folio citation, including the line number when present", async () => {
    const xml = await documentXml(buildCommentsDocument({ info: fullInfo, comments }));
    expect(xml).toContain("٤/ب · س3");
    expect(xml).toContain("١/ب");
  });

  it("keeps a multi-line comment as one cell with line breaks", async () => {
    const xml = await documentXml(buildCommentsDocument({ info: fullInfo, comments }));
    expect(xml).toContain("تعليق أول");
    expect(xml).toContain("سطر ثانٍ");
    expect(xml).toContain("<w:br/>");
  });

  it("includes the catalogue card so the export stands alone", async () => {
    const xml = await documentXml(buildCommentsDocument({ info: fullInfo, comments, fileName: "الأزهر 12345.pdf" }));
    expect(xml).toContain("شرح الورقات");
    expect(xml).toContain("ابن الفركاح");
    expect(xml).toContain("الأزهر 12345.pdf");
  });
});
