// The dialogs and overlays the viewer opens on top of the page: bookmark naming,
// the catalogue card editor, heading and comment entry, and the snip overlay with
// its annotation preview. Each takes its data through props and hands results back
// through callbacks, so none of them touches the viewer's own state.
//
// Split out of ManuscriptRuler.jsx, which had grown to over 4000 lines.
import React from "react";
// Square, ArrowUpRight and Pencil are handed to toolBtn as values rather than
// written as JSX tags, so they are easy to miss when scanning for `<Icon`.
// Do not import lucide's `Image` here — SnipPreview calls `new Image()` and the
// icon of that name would shadow the DOM constructor.
import { X, Save, RotateCcw, Copy, Download, Square, ArrowUpRight, Pencil } from "lucide-react";

export function BookmarkModal({ initialLabel, onConfirm, onCancel }) {
  const [label, setLabel] = React.useState(initialLabel || "");
  const inputRef = React.useRef(null);

  React.useEffect(() => {
    const t = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 30);
    return () => clearTimeout(t);
  }, []);

  React.useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCancel();
      } else if (e.key === "Enter") {
        e.stopPropagation();
        onConfirm(label);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [label, onConfirm, onCancel]);

  return (
    <div className="mr-shortcuts-panel" onClick={onCancel} data-testid="mr-bookmark-modal">
      <div className="mr-shortcuts-card mr-fade" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420, position: "relative" }}>
        <button className="mr-modal-x" onClick={onCancel} data-testid="mr-bookmark-close" title="إغلاق"><X size={16} /></button>
        <h2 style={{ fontSize: 20 }}>إضافة علامة مرجعية</h2>
        <div className="mr-field">
          <label>عنوان العلامة (اختياري)</label>
          <input
            ref={inputRef}
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="مثلاً: بداية الفصل الأول"
            data-testid="mr-bookmark-input"
            style={{ padding: "8px 10px", borderRadius: 6, background: "var(--ink-3)", color: "var(--parchment)", border: "1px solid var(--line)", fontFamily: "inherit", fontSize: 14, width: "100%" }}
          />
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
          <button className="mr-btn" onClick={onCancel} data-testid="mr-bookmark-cancel">إلغاء</button>
          <button className="mr-btn mr-btn-primary" onClick={() => onConfirm(label)} data-testid="mr-bookmark-confirm">حفظ</button>
        </div>
      </div>
    </div>
  );
}

export function InfoEditorModal({ initial, onSave, onCancel }) {
  const [f, setF] = React.useState({ ...(initial || {}) });
  const firstRef = React.useRef(null);
  React.useEffect(() => {
    const t = setTimeout(() => firstRef.current?.focus(), 40);
    return () => clearTimeout(t);
  }, []);
  React.useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); onCancel(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  const inputStyle = { padding: "6px 9px", borderRadius: 6, background: "var(--ink-3)", color: "var(--parchment)", border: "1px solid var(--line)", fontFamily: "inherit", fontSize: 13, width: "100%" };
  const setField = (k) => (e) => setF({ ...f, [k]: e.target.value });

  return (
    <div className="mr-shortcuts-panel" onClick={onCancel} data-testid="mr-info-editor">
      <div className="mr-shortcuts-card mr-fade" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640, maxHeight: "85vh", overflowY: "auto", position: "relative" }}>
        <button className="mr-modal-x" onClick={onCancel} data-testid="mr-info-close" title="إغلاق"><X size={16} /></button>
        <h2 style={{ fontSize: 20 }}>بطاقة معلومات المخطوط</h2>

        <div className="mr-field">
          <label>نوع المخطوط</label>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              className={`mr-btn ${(f.type || "single") === "single" ? "mr-btn-active" : ""}`}
              onClick={() => setF({ ...f, type: "single" })}
              style={{ flex: 1, justifyContent: "center" }}
              data-testid="mr-info-type-single"
            >
              مفرد (كتاب واحد)
            </button>
            <button
              className={`mr-btn ${f.type === "collection" ? "mr-btn-active" : ""}`}
              onClick={() => setF({ ...f, type: "collection" })}
              style={{ flex: 1, justifyContent: "center" }}
              data-testid="mr-info-type-collection"
            >
              مجموع (عدة كتب)
            </button>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div className="mr-field">
            <label>رقم النسخة <span style={{ color: "var(--amber)" }}>(يُستورد من اسم الملف)</span></label>
            <input type="text" value={f.number || ""} onChange={setField("number")} style={inputStyle} data-testid="mr-info-field-number" />
          </div>
          <div className="mr-field">
            <label>المكتبة</label>
            <input type="text" value={f.library || ""} onChange={setField("library")} placeholder="اسم المكتبة" style={inputStyle} data-testid="mr-info-field-library" />
          </div>
        </div>

        {(f.type || "single") === "single" && (
          <>
            <div className="mr-field">
              <label>عنوان المخطوط</label>
              <input ref={firstRef} type="text" value={f.title || ""} onChange={setField("title")} style={inputStyle} data-testid="mr-info-field-title" />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div className="mr-field">
                <label>المؤلف</label>
                <input type="text" value={f.author || ""} onChange={setField("author")} style={inputStyle} data-testid="mr-info-field-author" />
              </div>
              <div className="mr-field">
                <label>الناسخ</label>
                <input type="text" value={f.copyist || ""} onChange={setField("copyist")} style={inputStyle} data-testid="mr-info-field-copyist" />
              </div>
            </div>
            <div className="mr-field">
              <label>تاريخ النسخ</label>
              <input type="text" value={f.copyDate || ""} onChange={setField("copyDate")} placeholder="مثلاً: 823هـ / 1420م" style={inputStyle} data-testid="mr-info-field-copyDate" />
            </div>
          </>
        )}

        {f.type === "collection" && (
          <div className="mr-field">
            <label>عناوين الكتب في المجموع (كل عنوان في سطر — يُرقَّم تلقائياً)</label>
            <textarea
              value={f.titlesList || ""}
              onChange={setField("titlesList")}
              placeholder={"1. …\n2. …\n3. …"}
              rows={8}
              style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit", lineHeight: 1.8 }}
              data-testid="mr-info-field-titlesList"
            />
          </div>
        )}

        <div className="mr-field">
          <label>ملاحظات ووصف المخطوط</label>
          <textarea
            value={f.notes || ""}
            onChange={setField("notes")}
            rows={6}
            placeholder="أضف هنا وصفاً مفصّلاً للمخطوط: حالته، خطه، أختامه، تعليقات على الهوامش، إجازات، سماعات…"
            style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit", lineHeight: 1.8 }}
            data-testid="mr-info-field-notes"
          />
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
          <button className="mr-btn" onClick={onCancel} data-testid="mr-info-cancel">إلغاء</button>
          <button className="mr-btn mr-btn-primary" onClick={() => onSave(f)} data-testid="mr-info-save"><Save size={13} /> حفظ</button>
        </div>
      </div>
    </div>
  );
}

export function HeadingModal({ initial, onSave, onCancel }) {
  const [title, setTitle] = React.useState(initial?.title || "");
  const level = 1;
  const inputRef = React.useRef(null);
  React.useEffect(() => { const t = setTimeout(() => inputRef.current?.focus(), 40); return () => clearTimeout(t); }, []);
  React.useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); onCancel(); }
      if (e.key === "Enter" && !e.shiftKey) { e.stopPropagation(); onSave(title, level); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [title, onSave, onCancel]);
  return (
    <div className="mr-shortcuts-panel" onClick={onCancel} data-testid="mr-heading-modal">
      <div className="mr-shortcuts-card mr-fade" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <button className="mr-modal-x" onClick={onCancel} data-testid="mr-heading-close" title="إغلاق"><X size={16} /></button>
        <h2 style={{ fontSize: 20 }}>{initial?.editingId ? "تعديل العنوان" : "إضافة عنوان"}<span style={{ fontSize: 13, color: "var(--amber)", marginInlineStart: 12 }}>الصفحة {initial?.page}</span></h2>
        <div className="mr-field">
          <label>نص العنوان</label>
          <input ref={inputRef} type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="مثلاً: الباب الأول - في التعريفات" data-testid="mr-heading-input"
            style={{ padding: "8px 10px", borderRadius: 6, background: "var(--ink-3)", color: "var(--parchment)", border: "1px solid var(--line)", fontFamily: "inherit", fontSize: 14, width: "100%" }} />
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
          <button className="mr-btn" onClick={onCancel}>إلغاء</button>
          <button className="mr-btn mr-btn-primary" onClick={() => onSave(title, level)} data-testid="mr-heading-save"><Save size={13} /> حفظ</button>
        </div>
      </div>
    </div>
  );
}

export function CommentModal({ initial, onSave, onCancel }) {
  const [text, setText] = React.useState(initial?.text || "");
  const inputRef = React.useRef(null);
  React.useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 40);
    return () => clearTimeout(t);
  }, []);
  React.useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); onCancel(); }
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.stopPropagation(); onSave(text); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [text, onSave, onCancel]);

  return (
    <div className="mr-shortcuts-panel" onClick={onCancel} data-testid="mr-comment-modal">
      <div className="mr-shortcuts-card mr-fade" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520, position: "relative" }}>
        <button className="mr-modal-x" onClick={onCancel} data-testid="mr-comment-close" title="إغلاق"><X size={16} /></button>
        <h2 style={{ fontSize: 20 }}>
          {initial?.editingId ? "تعديل التعليق" : "إضافة تعليق"}
          <span style={{ fontSize: 13, color: "var(--amber)", marginInlineStart: 12, fontFamily: "inherit" }}>
            العزو: {initial?.folio}{initial?.line ? ` · سطر ${initial.line}` : ""}
          </span>
        </h2>
        <div className="mr-field">
          <label>نص التعليق</label>
          <textarea
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            placeholder="اكتب تعليقك، اختلاف قراءة، ملاحظة تحقيق…"
            data-testid="mr-comment-input"
            style={{ padding: "10px 12px", borderRadius: 6, background: "var(--ink-3)", color: "var(--parchment)", border: "1px solid var(--line)", fontFamily: "inherit", fontSize: 14, width: "100%", resize: "vertical", lineHeight: 1.7 }}
          />
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: -6 }}>
          <span className="mr-kbd">Ctrl + Enter</span> للحفظ · <span className="mr-kbd">Esc</span> للإلغاء
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
          <button className="mr-btn" onClick={onCancel} data-testid="mr-comment-cancel">إلغاء</button>
          <button className="mr-btn mr-btn-primary" onClick={() => onSave(text)} data-testid="mr-comment-save">
            <Save size={13} /> {initial?.editingId ? "تعديل" : "حفظ"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function SnipOverlay({ pageWrapRef, onCancel, onFinish }) {
  const [dragStart, setDragStart] = React.useState(null);
  const [rect, setRect] = React.useState(null);

  React.useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); onCancel(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  const getPos = (e) => {
    const wrap = pageWrapRef.current;
    if (!wrap) return null;
    const r = wrap.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, wrap: r };
  };

  const onMouseDown = (e) => {
    const p = getPos(e);
    if (!p) return;
    setDragStart(p);
    setRect({ x: p.x, y: p.y, w: 0, h: 0 });
    e.preventDefault();
  };
  const onMouseMove = (e) => {
    if (!dragStart) return;
    const p = getPos(e);
    if (!p) return;
    const x = Math.min(dragStart.x, p.x);
    const y = Math.min(dragStart.y, p.y);
    const w = Math.abs(p.x - dragStart.x);
    const h = Math.abs(p.y - dragStart.y);
    setRect({ x, y, w, h });
  };
  const onMouseUp = () => {
    if (rect && rect.w > 8 && rect.h > 8) {
      onFinish(rect);
    } else {
      onCancel();
    }
  };

  const wrap = pageWrapRef.current;
  const r = wrap ? wrap.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 60, cursor: "crosshair" }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      data-testid="mr-snip-overlay"
    >
      <div style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.25)" }} />
      {rect && wrap && (
        <div style={{
          position: "absolute",
          left: r.left + rect.x, top: r.top + rect.y,
          width: rect.w, height: rect.h,
          border: "2px dashed var(--amber)",
          background: "rgba(212,162,80,0.12)",
          pointerEvents: "none",
        }} />
      )}
      <div style={{ position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", background: "var(--ink-2)", border: "1px solid var(--amber)", padding: "6px 14px", borderRadius: 8, color: "var(--parchment)", fontSize: 13 }}>
        اسحب لتحديد منطقة اللقطة · <span style={{ color: "var(--amber)" }}>Esc</span> لإلغاء
      </div>
    </div>
  );
}

export function SnipPreview({ snip, onClose, onSave, onCopy }) {
  const canvasRef = React.useRef(null);
  const baseImgRef = React.useRef(null);
  const [tool, setTool] = React.useState(null); // 'highlight' | 'rect' | 'arrow' | 'text' | 'freehand'
  const [color, setColor] = React.useState("#e63946"); // default red
  const [opacity, setOpacity] = React.useState(0.55);
  const [strokeWidth, setStrokeWidth] = React.useState(4);
  const [fontSize, setFontSize] = React.useState(22);
  const [history, setHistory] = React.useState([]); // canvas snapshots
  const [captionEnabled, setCaptionEnabled] = React.useState(false);
  const [captionText, setCaptionText] = React.useState("");
  const startRef = React.useRef(null);
  const prevSnapshotRef = React.useRef(null);

  // Load base image once
  React.useEffect(() => {
    const img = new Image();
    img.onload = () => {
      baseImgRef.current = img;
      const c = canvasRef.current;
      if (!c) return;
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      // seed history
      setHistory([c.toDataURL("image/png")]);
    };
    img.src = snip.dataUrl;
  }, [snip.dataUrl]);

  React.useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.stopPropagation();
        undo();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, history]);

  const pushHistory = () => {
    const c = canvasRef.current;
    if (!c) return;
    setHistory((h) => [...h.slice(-15), c.toDataURL("image/png")]);
  };

  const undo = () => {
    if (history.length <= 1) return;
    const prev = history[history.length - 2];
    const c = canvasRef.current;
    if (!c) return;
    const img = new Image();
    img.onload = () => {
      const ctx = c.getContext("2d");
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0);
      setHistory((h) => h.slice(0, -1));
    };
    img.src = prev;
  };

  const getPos = (e) => {
    const c = canvasRef.current;
    const r = c.getBoundingClientRect();
    const sx = c.width / r.width;
    const sy = c.height / r.height;
    return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
  };

  const hexToRgba = (hex, alpha) => {
    const h = hex.replace("#", "");
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  };

  const captureSnapshot = () => {
    const c = canvasRef.current;
    if (!c) return null;
    return c.getContext("2d").getImageData(0, 0, c.width, c.height);
  };

  const restoreSnapshot = (snap) => {
    if (!snap) return;
    const c = canvasRef.current;
    if (!c) return;
    c.getContext("2d").putImageData(snap, 0, 0);
  };

  const drawArrow = (ctx, x1, y1, x2, y2, col, width) => {
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const head = Math.max(12, width * 3.5);
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - head * Math.cos(angle - Math.PI / 7), y2 - head * Math.sin(angle - Math.PI / 7));
    ctx.lineTo(x2 - head * Math.cos(angle + Math.PI / 7), y2 - head * Math.sin(angle + Math.PI / 7));
    ctx.closePath();
    ctx.fill();
  };

  const onDown = (e) => {
    if (!tool) return;
    const c = canvasRef.current;
    if (!c) return;
    const p = getPos(e);
    startRef.current = p;
    prevSnapshotRef.current = captureSnapshot();
    const ctx = c.getContext("2d");

    if (tool === "highlight" || tool === "freehand") {
      ctx.strokeStyle = tool === "highlight" ? hexToRgba(color, opacity) : hexToRgba(color, opacity);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = tool === "highlight" ? strokeWidth * 4 : strokeWidth;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
    } else if (tool === "text") {
      const text = window.prompt("اكتب النص:", "");
      startRef.current = null;
      if (!text) { prevSnapshotRef.current = null; return; }
      ctx.fillStyle = hexToRgba(color, Math.max(opacity, 0.9));
      ctx.font = `bold ${fontSize}px 'Noto Naskh Arabic','Amiri', serif`;
      ctx.textBaseline = "top";
      // background box for readability
      const metrics = ctx.measureText(text);
      const pad = 6;
      const bh = fontSize + pad * 2;
      const bw = metrics.width + pad * 2;
      ctx.save();
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.fillRect(p.x - pad, p.y - pad, bw, bh);
      ctx.fillStyle = hexToRgba(color, 1);
      ctx.fillText(text, p.x, p.y);
      ctx.restore();
      pushHistory();
    }
    e.preventDefault();
  };

  const onMove = (e) => {
    if (!tool || !startRef.current) return;
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    const p = getPos(e);
    const s = startRef.current;

    if (tool === "highlight" || tool === "freehand") {
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    } else if (tool === "rect") {
      restoreSnapshot(prevSnapshotRef.current);
      ctx.strokeStyle = hexToRgba(color, Math.max(opacity, 0.85));
      ctx.lineWidth = strokeWidth;
      ctx.strokeRect(Math.min(s.x, p.x), Math.min(s.y, p.y), Math.abs(p.x - s.x), Math.abs(p.y - s.y));
    } else if (tool === "arrow") {
      restoreSnapshot(prevSnapshotRef.current);
      drawArrow(ctx, s.x, s.y, p.x, p.y, hexToRgba(color, Math.max(opacity, 0.85)), strokeWidth);
    }
  };

  const onUp = () => {
    if (!tool || !startRef.current) return;
    startRef.current = null;
    prevSnapshotRef.current = null;
    if (tool !== "text") pushHistory();
  };

  const exportDataUrl = () => canvasRef.current?.toDataURL("image/png") || snip.dataUrl;

  // Compose a bigger canvas with the captioned text below the snip image (if enabled)
  const exportWithCaption = () => {
    const baseUrl = exportDataUrl();
    if (!captionEnabled || !captionText.trim()) return baseUrl;
    const src = canvasRef.current;
    if (!src) return baseUrl;
    const w = src.width;
    // Compute text height: wrap lines every ~80 chars, 24px per line + padding
    const lines = captionText.split("\n");
    const approxLineHeight = Math.max(28, Math.round(w / 45));
    const padding = Math.round(approxLineHeight * 0.8);
    const textAreaH = padding * 2 + lines.length * approxLineHeight;
    const outH = src.height + textAreaH;
    const out = document.createElement("canvas");
    out.width = w;
    out.height = outH;
    const ctx = out.getContext("2d");
    // background
    ctx.fillStyle = "#faf5ec";
    ctx.fillRect(0, 0, w, outH);
    // draw image at top
    ctx.drawImage(src, 0, 0);
    // draw separator
    ctx.fillStyle = "#8b6a1c";
    ctx.fillRect(padding, src.height + Math.round(padding / 3), w - 2 * padding, 2);
    // draw text
    ctx.fillStyle = "#1a1613";
    ctx.font = `${Math.round(approxLineHeight * 0.75)}px "Noto Naskh Arabic", "Amiri", serif`;
    ctx.direction = "rtl";
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    lines.forEach((line, i) => {
      ctx.fillText(line, w - padding, src.height + padding + i * approxLineHeight);
    });
    return out.toDataURL("image/png");
  };

  const toolBtn = (key, Icon, label) => (
    <button
      className={`mr-btn ${tool === key ? "mr-btn-active" : ""}`}
      onClick={() => setTool(tool === key ? null : key)}
      data-testid={`mr-snip-tool-${key}`}
      title={label}
    >
      <Icon size={14} /> {label}
    </button>
  );

  return (
    <div className="mr-shortcuts-panel" onClick={onClose} data-testid="mr-snip-preview">
      <div className="mr-shortcuts-card mr-fade" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 980, width: "94%" }}>
        <h2 style={{ fontSize: 18 }}>
          معاينة وتحرير اللقطة
          <span style={{ fontSize: 13, color: "var(--amber)", marginInlineStart: 12, fontFamily: "inherit" }}>
            {snip.folio} · سطر {snip.line}
          </span>
        </h2>

        <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
          {toolBtn("rect", Square, "إطار")}
          {toolBtn("arrow", ArrowUpRight, "سهم")}
          {toolBtn("freehand", Pencil, "قلم حر")}

          <div style={{ display: "flex", gap: 4, alignItems: "center", marginInlineStart: 10 }}>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>اللون:</span>
            {["#e63946", "#f2c14e", "#2a9d8f", "#264653", "#000000", "#ffffff"].map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                title={c}
                data-testid={`mr-snip-color-${c}`}
                style={{
                  width: 22, height: 22, borderRadius: 4, border: color === c ? "2px solid var(--amber)" : "1px solid var(--line)",
                  background: c, cursor: "pointer",
                }}
              />
            ))}
          </div>

          <div style={{ display: "flex", gap: 6, alignItems: "center", marginInlineStart: 10 }}>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>الشفافية: <b style={{ color: "var(--amber)" }}>{Math.round(opacity * 100)}%</b></span>
            <input type="range" min="10" max="100" value={Math.round(opacity * 100)} onChange={(e) => setOpacity(Number(e.target.value) / 100)} data-testid="mr-snip-opacity" style={{ width: 90 }} />
          </div>

          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>السماكة: <b style={{ color: "var(--amber)" }}>{strokeWidth}</b></span>
            <input type="range" min="1" max="16" value={strokeWidth} onChange={(e) => setStrokeWidth(Number(e.target.value))} data-testid="mr-snip-stroke" style={{ width: 80 }} />
          </div>

          {tool === "text" && false && (
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <span style={{ fontSize: 11, color: "var(--muted)" }}>حجم الخط:</span>
              <input type="number" min="10" max="80" value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))} style={{ width: 55, padding: "2px 6px", borderRadius: 4, background: "var(--ink-3)", color: "var(--parchment)", border: "1px solid var(--line)", fontSize: 12 }} />
            </div>
          )}

          <button
            className="mr-btn"
            onClick={undo}
            disabled={history.length <= 1}
            data-testid="mr-snip-undo"
            title="تراجع (Ctrl+Z)"
            style={{ marginInlineStart: "auto" }}
          >
            <RotateCcw size={13} /> تراجع
          </button>
        </div>

        <div style={{ background: "#0a0806", border: "1px solid var(--line)", borderRadius: 8, padding: 6, textAlign: "center", maxHeight: "50vh", overflow: "auto" }}>
          <canvas
            ref={canvasRef}
            onMouseDown={onDown}
            onMouseMove={onMove}
            onMouseUp={onUp}
            onMouseLeave={onUp}
            style={{ maxWidth: "100%", cursor: tool ? "crosshair" : "default" }}
          />
        </div>

        <div className="mr-field" style={{ marginTop: 8 }}>
          <label style={{ cursor: "pointer", flexDirection: "row", justifyContent: "flex-start", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={captionEnabled}
              onChange={(e) => setCaptionEnabled(e.target.checked)}
              data-testid="mr-snip-caption-enable"
              style={{ accentColor: "var(--amber)" }}
            />
            <span>إضافة شرح نصيّ أسفل اللقطة</span>
          </label>
        </div>
        {captionEnabled && (
          <textarea
            value={captionText}
            onChange={(e) => setCaptionText(e.target.value)}
            placeholder="اكتب شرحاً أو ملاحظة لتظهر أسفل اللقطة عند الحفظ"
            rows={2}
            data-testid="mr-snip-caption-text"
            style={{ padding: "8px 10px", borderRadius: 6, background: "var(--ink-3)", color: "var(--parchment)", border: "1px solid var(--line)", fontFamily: "inherit", fontSize: 13, width: "100%", resize: "vertical" }}
          />
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
          <button className="mr-btn" onClick={onClose} data-testid="mr-snip-close">إغلاق</button>
          <button className="mr-btn" onClick={() => onCopy(exportWithCaption())} data-testid="mr-snip-copy">
            <Copy size={13} /> نسخ إلى الحافظة
          </button>
          <button className="mr-btn mr-btn-primary" onClick={() => onSave(exportWithCaption(), snip.filename)} data-testid="mr-snip-save">
            <Download size={13} /> حفظ PNG
          </button>
        </div>
      </div>
    </div>
  );
}

export const SHORTCUTS = [
  { desc: "فتح ملف", keys: ["Ctrl", "O"] },
  { desc: "تحريك المسطرة سطراً لأسفل", keys: ["↓"] },
  { desc: "تحريك المسطرة سطراً لأعلى", keys: ["↑"] },
  { desc: "الصفحة التالية", keys: ["Page Down"] },
  { desc: "الصفحة السابقة", keys: ["Page Up"] },
  { desc: "تكبير", keys: ["Ctrl", "+"] },
  { desc: "تصغير", keys: ["Ctrl", "−"] },
  { desc: "تكبير/تصغير بعجلة الفأرة", keys: ["Ctrl", "عجلة"] },
  { desc: "تدوير 90°", keys: ["R"] },
  { desc: "إظهار/إخفاء المسطرة", keys: ["H"] },
  { desc: "إضافة تعليق على المخطوط", keys: ["Ctrl", "F"] },
  { desc: "إضافة عنوان (فهرس)", keys: ["Ctrl", "B"] },
  { desc: "التقاط لقطة من الصفحة", keys: ["Ctrl", "S"] },
  { desc: "فتح/إغلاق قائمة العلامات", keys: ["Ctrl", "G"] },
  { desc: "ملء الشاشة", keys: ["F11"] },
  { desc: "فتح/إغلاق نافذة الاختصارات", keys: ["؟"] },
  { desc: "إغلاق النوافذ", keys: ["Esc"] },
];


export function AboutModal({ onClose }) {
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const iconGuide = [
    { icon: "📂", name: "فتح مخطوط", desc: "فتح ملف PDF أو أرشيف صور (ZIP/RAR/7z) أو صور مفردة، والوصول إلى قائمة آخر المخطوطات المفتوحة." },
    { icon: "📖", name: "البطاقة", desc: "بطاقة معلومات المخطوط: العنوان، المؤلف، الناسخ، المكتبة، رقم النسخة، تاريخ النسخ… مع نسخها كجدول لأغراض التوثيق." },
    { icon: "🔍", name: "تصفح", desc: "التكبير حتى 1000%، التدوير، الأداة اليدوية، ووصفة «توضيح المخطوط» التي تسوّي الإضاءة وتزيل اصفرار الورق وتمدّ التباين، مع تعديلات يدوية منفصلة." },
    { icon: "🗂️", name: "ترتيب", desc: "ترتيب صفحات المخطوط قبل الترقيم: نقل الصفحة، إخفاؤها، استرجاعها، أو عكس ترتيب المخطوط كله — للمخطوطات المصوّرة بترتيب خاطئ." },
    { icon: "🔢", name: "ترقيم", desc: "معالج ذكي مكوّن من خطوات لقص الصفحات المزدوجة من المنتصف — بخط مستقيم أو مائل يتبع ميل التصوير — ثم ترقيم الأوراق بترقيم المخطوطات المعتمد (1/أ، 1/ب…)." },
    { icon: "📏", name: "المسطرة", desc: "إظهار/إخفاء المسطرة الأفقية الشفافة للمساعدة في المقابلة سطراً بسطر، مع تخصيص شكلها وارتفاعها وعرضها وتشغيلها تلقائياً." },
    { icon: "💬", name: "تعليق", desc: "إضافة تعليقات محدّدة على مناطق من المخطوط مع العزو التلقائي إلى رقم الورقة (فوليو)، وإضافة عناوين/فهرس ملاحظات." },
    { icon: "📤", name: "تصدير", desc: "تصدير المخطوط إلى PDF مفهرس بالعناوين والتعليقات، وتصدير التعليقات والعناوين إلى ملفات Word حقيقية (.docx)، وضغط الصور مع حساب الحجم المتوقع قبل التصدير." },
    { icon: "📷", name: "لقطة", desc: "أداة القصّ (Snip): تحديد أي منطقة من المخطوط، إضافة شرح نصي عليها، ثم حفظها كصورة PNG أو نسخها إلى الحافظة." },
  ];

  return (
    <div className="mr-shortcuts-panel" onClick={onClose} data-testid="mr-about-modal">
      <div
        className="mr-shortcuts-card mr-fade"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 720, maxHeight: "88vh", overflowY: "auto", position: "relative", padding: "22px 26px" }}
      >
        <button className="mr-modal-x" onClick={onClose} data-testid="mr-about-close" title="إغلاق"><X size={16} /></button>

        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
          <img src={`${process.env.PUBLIC_URL || "."}/app-icon.png`} alt="app" style={{ width: 56, height: 56, borderRadius: 10, boxShadow: "0 2px 12px rgba(0,0,0,.35)" }} />
          <div>
            <h2 style={{ fontSize: 22, margin: 0, color: "var(--amber)" }}>
              متصفح المخطوطات <span style={{ fontSize: 14, color: "var(--parchment)" }}>— إصدار 2</span>
            </h2>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>أداة متخصصة للباحثين في المخطوطات</div>
          </div>
        </div>

        <section style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: 15, color: "var(--amber)", margin: "0 0 8px" }}>الجديد في الإصدار الثاني</h3>
          <ul style={{ margin: 0, paddingInlineStart: 20, fontSize: 13, lineHeight: 1.9 }}>
            <li><b>ترتيب الصفحات</b> — نقل الصفحات وإخفاؤها واسترجاعها قبل الترقيم، للمخطوطات المصوّرة بترتيب خاطئ.</li>
            <li><b>توضيح المخطوط</b> — وصفة معالجة مركّبة: تسوية الإضاءة، إزالة اصفرار الورق، تمديد التباين، الحدّة، وفصل الحبر — تُضبط على ورقة وتُطبَّق على المخطوط كله.</li>
            <li><b>قصّ مائل</b> — خط الشقّ يتبع ميل الطيّة في التصوير بدل أن ينزل عمودياً.</li>
            <li><b>تصدير Word حقيقي</b> — ملفات ‎.docx‎ بدل صفحات HTML، مع عناوين كتب المجموع التي كانت تسقط.</li>
            <li><b>التعليقات في PDF المفهرس</b> — تُكتب الآن في الملف كتعليقات حقيقية وفي الفهرس الجانبي.</li>
            <li><b>حساب حجم التصدير</b> — قياس فعلي لعيّنة من الصفحات، مع توصية بإعدادات لا تُضيّع تفاصيل الحبر.</li>
            <li><b>تحميل تدريجي للأرشيفات</b> — فتح فوري للأرشيفات الكبيرة بدل فكّ ضغط كل الصفحات مقدّماً.</li>
            <li><b>نسخ إلى الحافظة</b> — البطاقة كجدول واللقطات كصور، بعد أن كان لا يعمل.</li>
            <li><b>اختصارات لوحة المفاتيح</b> — تعمل الآن، ومع لوحة المفاتيح العربية أيضاً.</li>
            <li><b>لا اتصال بالإنترنت</b> — أُزيل كل ما كان يتصل بخوادم خارجية عند التشغيل.</li>
            <li>وإصلاحات في الذاكرة والأداء: الصفحات المقسومة عند التكبير العالي، ودقّة اللقطة والتعتيم، وتحرير الذاكرة عند إغلاق التبويبات.</li>
          </ul>
        </section>

        <section style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: 15, color: "var(--amber)", marginBottom: 6, borderBottom: "1px solid var(--line)", paddingBottom: 4 }}>نبذة عن البرنامج</h3>
          <p style={{ fontSize: 13.5, lineHeight: 1.9, color: "var(--parchment)", margin: 0, textAlign: "justify" }}>
            هو أداة صغيرة مصمّمة لتصفّح ملفات مصوّرات المخطوطات ومساعدة الباحثين على دراستها والعزو لها في بحوثهم ومنشوراتهم.
            يتيح للمستخدمين إمكانيات قصّ صفحات المخطوط من المنتصف، وترقيم أوراق المخطوط بترقيم الأوراق المعتمَد في المخطوطات،
            وكتابة بيانات فهرسة المخطوط، والمساعدة على مقابلة المخطوط بتركيز عبر أداة المسطرة، والتعليق على المخطوط ووضع عناوين له،
            والعزو إلى هذه التعليقات في المخطوط برقم الورقة، وتصدير هذه التعليقات والعناوين إلى ملفات Word لأغراض دراسة المخطوط،
            واقتصاص الصور من المخطوط وكتابة الشروح على الصور، وضغط أحجام مصوّرات المخطوطات كبيرة الحجم.
          </p>
        </section>

        <section style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: 15, color: "var(--amber)", marginBottom: 8, borderBottom: "1px solid var(--line)", paddingBottom: 4 }}>دليل الأيقونات</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
            {iconGuide.map((g) => (
              <div
                key={g.name}
                style={{
                  display: "flex",
                  gap: 12,
                  alignItems: "flex-start",
                  background: "var(--ink-3)",
                  border: "1px solid var(--line)",
                  borderRadius: 8,
                  padding: "10px 12px",
                }}
              >
                <div style={{ fontSize: 22, flexShrink: 0, width: 32, textAlign: "center" }}>{g.icon}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5, color: "var(--amber)", marginBottom: 2 }}>{g.name}</div>
                  <div style={{ fontSize: 12.5, lineHeight: 1.75, color: "var(--parchment)" }}>{g.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section style={{ marginBottom: 6 }}>
          <h3 style={{ fontSize: 15, color: "var(--amber)", marginBottom: 8, borderBottom: "1px solid var(--line)", paddingBottom: 4 }}>
            للملاحظات والاقتراحات
          </h3>
          <div style={{ background: "var(--ink-3)", border: "1px solid var(--line)", borderRadius: 8, padding: "12px 14px", fontSize: 13.5, lineHeight: 2 }}>
            <div style={{ marginBottom: 6 }}>
              تواصل مع مصمّم البرنامج:
            </div>
            <div style={{ fontWeight: 700, color: "var(--amber)", fontSize: 14 }}>
              د. محمد عمر أحمد الكاف
            </div>
            <div style={{ color: "var(--muted)", fontSize: 12.5, marginBottom: 8 }}>
              اختصاصيّ مخطوطات
            </div>
            <div style={{ display: "grid", gap: 4 }}>
              <div>
                <span style={{ color: "var(--muted)" }}>تلجرام: </span>
                <a
                  href="https://t.me/MOAKAF"
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "var(--amber)", textDecoration: "none", direction: "ltr", unicodeBidi: "embed" }}
                  data-testid="mr-about-telegram"
                >
                  @MOAKAF
                </a>
              </div>
              <div>
                <span style={{ color: "var(--muted)" }}>البريد الإلكتروني: </span>
                <a
                  href="mailto:moakaf2025@gmail.com"
                  style={{ color: "var(--amber)", textDecoration: "none", direction: "ltr", unicodeBidi: "embed" }}
                  data-testid="mr-about-email"
                >
                  moakaf2025@gmail.com
                </a>
              </div>
            </div>
          </div>
        </section>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
          <button className="mr-btn mr-btn-primary" onClick={onClose} data-testid="mr-about-ok">حسناً</button>
        </div>
      </div>
    </div>
  );
}
