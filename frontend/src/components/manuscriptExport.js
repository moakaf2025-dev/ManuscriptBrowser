// Word export of the two study outputs a researcher takes away from a manuscript:
// the heading index and the comment list, both cited by folio.
//
// These used to be HTML strings saved under a .doc extension. Word opens such a
// file but warns that its format does not match its extension, and what opens is
// not really a document: no styles, no navigable headings, nothing Word can
// restyle. This builds actual OOXML instead.
//
// Every paragraph is marked bidirectional and every run right-to-left, and tables
// carry visuallyRightToLeft, so column order and text direction survive in Word
// regardless of the reader's UI language.
// Default import, not named or namespace: craco aliases `docx` to its CommonJS
// build (see craco.config.js). Webpack hands a CJS module's exports object over as
// the default binding, but does not synthesise named bindings from it — `import
// { BorderStyle }` compiles and then reads undefined at runtime. Keep this default
// import in step with that alias; against the ESM build it would be undefined.
import docx from "docx";

const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, WidthType, BorderStyle, HeadingLevel,
} = docx;

const FONT = "Traditional Arabic";
const BODY_PT = 28;   // half-points: 14pt
const SMALL_PT = 22;  // 11pt
const BORDER = { style: BorderStyle.SINGLE, size: 6, color: "999999" };
const CELL_BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };

function runs(text, { bold = false, italics = false, size = BODY_PT, color } = {}) {
  // Word treats each newline as a separate break inside one paragraph.
  return String(text ?? "")
    .split("\n")
    .flatMap((line, i) => {
      const run = new TextRun({ text: line, bold, italics, size, color, font: FONT, rightToLeft: true });
      return i === 0 ? [run] : [new TextRun({ break: 1, font: FONT }), run];
    });
}

function para(text, opts = {}) {
  const { alignment = AlignmentType.RIGHT, spacing, ...runOpts } = opts;
  return new Paragraph({ bidirectional: true, alignment, spacing, children: runs(text, runOpts) });
}

function labelled(label, value) {
  return new Paragraph({
    bidirectional: true,
    alignment: AlignmentType.RIGHT,
    spacing: { after: 60 },
    children: [...runs(`${label}: `, { bold: true }), ...runs(value)],
  });
}

function cell(text, { bold = false, size = BODY_PT, width, align = AlignmentType.RIGHT, shaded = false } = {}) {
  return new TableCell({
    borders: CELL_BORDERS,
    width: width ? { size: width, type: WidthType.PERCENTAGE } : undefined,
    shading: shaded ? { fill: "EEEEEE" } : undefined,
    children: [new Paragraph({ bidirectional: true, alignment: align, children: runs(text, { bold, size }) })],
  });
}

function table(headers, rows) {
  return new Table({
    visuallyRightToLeft: true,
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        tableHeader: true,
        children: headers.map((h) =>
          cell(h.text, { bold: true, size: SMALL_PT, width: h.width, align: AlignmentType.CENTER, shaded: true })
        ),
      }),
      ...rows,
    ],
  });
}

// The catalogue fields that actually exist on the info card, in card order.
// Anything not filled in is left out rather than printed empty.
export function infoRows(info = {}) {
  const rows = [];
  const push = (label, value) => {
    if (value != null && String(value).trim()) rows.push([label, String(value).trim()]);
  };
  push("رقم النسخة", info.number);
  push("المكتبة", info.library);
  if ((info.type || "single") === "single") {
    push("عنوان المخطوط", info.title);
    push("المؤلف", info.author);
    push("الناسخ", info.copyist);
    push("تاريخ النسخ", info.copyDate);
  } else {
    push("نوع المخطوط", "مجموع");
    // The titles of the works bound together in a majmūʿ are the whole point of
    // collection mode, and the old export dropped them entirely.
    push("عناوين المجموع", info.titlesList);
  }
  push("ملاحظات ووصف", info.notes);
  return rows;
}

function documentShell({ title, info, fileName, children }) {
  const heading = new Paragraph({
    bidirectional: true,
    alignment: AlignmentType.RIGHT,
    heading: HeadingLevel.HEADING_1,
    spacing: { after: 200 },
    children: runs(title, { bold: true, size: 44 }),
  });

  const infoBlock = infoRows(info).map(([k, v]) => labelled(k, v));

  return new Document({
    title,
    description: `تصدير من متصفح المخطوطات — ${fileName || ""}`.trim(),
    styles: {
      default: {
        document: { run: { font: FONT, size: BODY_PT, rightToLeft: true } },
      },
    },
    sections: [{
      properties: {},
      children: [
        heading,
        ...infoBlock,
        labelled("الملف", fileName || "—"),
        labelled("تاريخ التصدير", new Date().toLocaleString("ar-EG")),
        para(""),
        ...children,
      ],
    }],
  });
}

export function buildHeadingsDocument({ info = {}, headings = [], fileName = "", folio = String } = {}) {
  const sorted = [...headings].sort((a, b) => a.page - b.page);
  const rows = sorted.map((h, i) =>
    new TableRow({
      children: [
        cell(String(i + 1), { width: 8, align: AlignmentType.CENTER, size: SMALL_PT }),
        cell(folio(h.page), { width: 15, align: AlignmentType.CENTER, bold: true }),
        // Level is conveyed by indentation in the title column and by its own column.
        cell(" ".repeat(Math.max(0, (h.level || 1) - 1) * 4) + (h.title || ""), { width: 62 }),
        cell(String(h.level || 1), { width: 15, align: AlignmentType.CENTER, size: SMALL_PT }),
      ],
    })
  );

  return documentShell({
    title: "عناوين المخطوط",
    info,
    fileName,
    children: sorted.length === 0
      ? [para("لا توجد عناوين مسجّلة لهذا المخطوط.", { italics: true })]
      : [
          para(`عدد العناوين: ${sorted.length}`, { bold: true, spacing: { after: 120 } }),
          table(
            [{ text: "#", width: 8 }, { text: "الورقة", width: 15 }, { text: "العنوان", width: 62 }, { text: "المستوى", width: 15 }],
            rows
          ),
        ],
  });
}

export function buildCommentsDocument({ info = {}, comments = [], fileName = "" } = {}) {
  const sorted = [...comments].sort((a, b) => a.page - b.page || a.y - b.y);
  const rows = sorted.map((c, i) =>
    new TableRow({
      children: [
        cell(String(i + 1), { width: 7, align: AlignmentType.CENTER, size: SMALL_PT }),
        cell(c.line ? `${c.folio} · س${c.line}` : String(c.folio ?? ""), { width: 15, align: AlignmentType.CENTER, bold: true }),
        cell(c.text || "", { width: 58 }),
        cell(c.createdAt ? new Date(c.createdAt).toLocaleString("ar-EG") : "", { width: 20, size: SMALL_PT }),
      ],
    })
  );

  return documentShell({
    title: "تعليقات المخطوط",
    info,
    fileName,
    children: sorted.length === 0
      ? [para("لا توجد تعليقات مسجّلة لهذا المخطوط.")]
      : [
          para(`عدد التعليقات: ${sorted.length}`, { bold: true, spacing: { after: 120 } }),
          table(
            [{ text: "#", width: 7 }, { text: "العزو (الفوليو)", width: 15 }, { text: "نص التعليق", width: 58 }, { text: "تاريخ الإضافة", width: 20 }],
            rows
          ),
        ],
  });
}

export function toDocxBlob(document) {
  return Packer.toBlob(document);
}
