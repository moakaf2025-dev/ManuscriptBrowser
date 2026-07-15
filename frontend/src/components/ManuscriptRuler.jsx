import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  FolderOpen,
  ZoomIn,
  ZoomOut,
  RotateCw,
  Settings,
  Maximize2,
  Minimize2,
  Eye,
  EyeOff,
  ChevronRight,
  ChevronLeft,
  Keyboard,
  X,
  Bookmark,
  BookmarkPlus,
  Trash2,
  SunMedium,
} from "lucide-react";
import * as pdfjsLib from "pdfjs-dist/build/pdf.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = `${process.env.PUBLIC_URL || ""}/pdf.worker.min.mjs`;

const STORAGE_KEY = "manuscriptRulerState.v1";
const BOOKMARKS_KEY = "manuscriptRulerBookmarks.v1";
const ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];

const DEFAULT_STATE = {
  fileName: "",
  fileKey: "",
  fileType: "", // 'image' | 'pdf'
  page: 1,
  zoomIdx: 2,
  rotation: 0,
  rulerY: 100,
  rulerHeight: 32,
  rulerStep: 32,
  rulerColor: "#f2c14e",
  rulerOpacity: 0.42,
  rulerVisible: true,
  dimAlpha: 0.28,
  dimEnabled: true,
  brightness: 100,
  contrast: 100,
  invert: false,
};

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_STATE };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_STATE, ...parsed };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function saveState(state) {
  const toSave = { ...state };
  delete toSave.__pdfDoc;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
}

function loadBookmarks() {
  try {
    const raw = localStorage.getItem(BOOKMARKS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) || {};
  } catch {
    return {};
  }
}

function saveBookmarks(map) {
  localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(map));
}

export default function ManuscriptRuler() {
  const [state, setState] = useState(loadState);
  const [pdfDoc, setPdfDoc] = useState(null);
  const [imageUrl, setImageUrl] = useState("");
  const [pageCount, setPageCount] = useState(0);
  const [pageSize, setPageSize] = useState({ w: 0, h: 0 });
  const [loading, setLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [bookmarksMap, setBookmarksMap] = useState(loadBookmarks);
  const [bookmarkModal, setBookmarkModal] = useState(null); // {label} when open
  const [toast, setToast] = useState("");
  const [isFs, setIsFs] = useState(false);

  const canvasRef = useRef(null);
  const imgRef = useRef(null);
  const pageWrapRef = useRef(null);
  const scrollRef = useRef(null);
  const fileInputRef = useRef(null);
  const rulerDragRef = useRef({ dragging: false, offsetY: 0 });
  const stateRef = useRef(state);
  const hasFileRef = useRef(false);
  const addBookmarkRef = useRef(() => {});
  const pageSizeRef = useRef({ w: 0, h: 0 });

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    pageSizeRef.current = pageSize;
  }, [pageSize]);

  // Persist state & bookmarks
  useEffect(() => {
    saveState(state);
  }, [state]);

  useEffect(() => {
    saveBookmarks(bookmarksMap);
  }, [bookmarksMap]);

  const showToast = (msg) => {
    setToast(msg);
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => setToast(""), 1600);
  };

  const scale = ZOOM_LEVELS[state.zoomIdx];

  // ---------------- File handling ----------------
  const openFile = () => fileInputRef.current?.click();

  const handleFile = async (file) => {
    if (!file) return;
    const name = file.name.toLowerCase();
    setLoading(true);
    try {
      const fileKey = `${file.name}|${file.size}|${file.lastModified || 0}`;
      if (name.endsWith(".pdf")) {
        const buffer = await file.arrayBuffer();
        const doc = await pdfjsLib.getDocument({ data: buffer }).promise;
        setPdfDoc(doc);
        setImageUrl("");
        setPageCount(doc.numPages);
        setState((s) => ({
          ...s,
          fileName: file.name,
          fileKey,
          fileType: "pdf",
          page: 1,
        }));
      } else if (/\.(jpe?g|png|tiff?|bmp|webp|gif)$/i.test(name)) {
        const url = URL.createObjectURL(file);
        setImageUrl(url);
        setPdfDoc(null);
        setPageCount(1);
        setState((s) => ({
          ...s,
          fileName: file.name,
          fileKey,
          fileType: "image",
          page: 1,
        }));
      } else {
        showToast("صيغة الملف غير مدعومة");
      }
    } catch (e) {
      console.error(e);
      showToast("تعذّر فتح الملف");
    } finally {
      setLoading(false);
    }
  };

  const onFileInputChange = (e) => {
    const f = e.target.files?.[0];
    handleFile(f);
    e.target.value = "";
  };

  // ---------------- PDF rendering ----------------
  const renderPdfPage = useCallback(
    async (pageNum) => {
      if (!pdfDoc || !canvasRef.current) return;
      setLoading(true);
      try {
        const page = await pdfDoc.getPage(pageNum);
        const baseViewport = page.getViewport({ scale: 1, rotation: state.rotation });
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const renderScale = 1.5 * scale; // crisp
        const viewport = page.getViewport({ scale: renderScale, rotation: state.rotation });
        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d");
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        await page.render({ canvasContext: ctx, viewport }).promise;
        setPageSize({ w: viewport.width, h: viewport.height });
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    },
    [pdfDoc, state.rotation, scale]
  );

  useEffect(() => {
    if (state.fileType === "pdf" && pdfDoc) {
      renderPdfPage(state.page);
    }
  }, [pdfDoc, state.page, state.rotation, state.zoomIdx, state.fileType, renderPdfPage]);

  // ---------------- Image rendering ----------------
  const onImgLoad = () => {
    const img = imgRef.current;
    if (!img) return;
    const w = img.naturalWidth * scale;
    const h = img.naturalHeight * scale;
    setPageSize({ w, h });
  };

  useEffect(() => {
    if (state.fileType === "image" && imgRef.current?.naturalWidth) {
      onImgLoad();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.zoomIdx, state.fileType]);

  // ---------------- Ruler interactions ----------------
  const clampRuler = useCallback(
    (y) => {
      const max = Math.max(0, pageSize.h - state.rulerHeight);
      return Math.min(Math.max(0, y), max);
    },
    [pageSize.h, state.rulerHeight]
  );

  const moveRulerBy = (delta) => {
    setState((s) => ({ ...s, rulerY: clampRuler(s.rulerY + delta) }));
  };

  const onRulerMouseDown = (e) => {
    if (!pageWrapRef.current) return;
    rulerDragRef.current.dragging = true;
    const rect = pageWrapRef.current.getBoundingClientRect();
    const yInPage = e.clientY - rect.top;
    rulerDragRef.current.offsetY = yInPage - state.rulerY;
    e.preventDefault();
  };

  useEffect(() => {
    const onMove = (e) => {
      if (!rulerDragRef.current.dragging || !pageWrapRef.current) return;
      const rect = pageWrapRef.current.getBoundingClientRect();
      const y = e.clientY - rect.top - rulerDragRef.current.offsetY;
      setState((s) => ({ ...s, rulerY: clampRuler(y) }));
    };
    const onUp = () => {
      rulerDragRef.current.dragging = false;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [clampRuler]);

  const onPageClick = (e) => {
    if (!pageWrapRef.current) return;
    // ignore if clicking the ruler itself
    if (e.target.closest("[data-ruler]")) return;
    const rect = pageWrapRef.current.getBoundingClientRect();
    const y = e.clientY - rect.top - state.rulerHeight / 2;
    setState((s) => ({ ...s, rulerY: clampRuler(y) }));
  };

  // ---------------- Zoom / Rotate / Nav ----------------
  const zoomIn = () =>
    setState((s) => ({ ...s, zoomIdx: Math.min(ZOOM_LEVELS.length - 1, s.zoomIdx + 1) }));
  const zoomOut = () =>
    setState((s) => ({ ...s, zoomIdx: Math.max(0, s.zoomIdx - 1) }));
  const rotate = () =>
    setState((s) => ({ ...s, rotation: (s.rotation + 90) % 360 }));
  const nextPage = () => {
    if (state.fileType !== "pdf") return;
    setState((s) => ({ ...s, page: Math.min(pageCount, s.page + 1) }));
  };
  const prevPage = () => {
    if (state.fileType !== "pdf") return;
    setState((s) => ({ ...s, page: Math.max(1, s.page - 1) }));
  };
  const toggleRuler = () => setState((s) => ({ ...s, rulerVisible: !s.rulerVisible }));

  // ---------------- Bookmarks ----------------
  const currentBookmarks = state.fileKey ? (bookmarksMap[state.fileKey] || []) : [];

  const addBookmark = () => {
    if (!state.fileKey) return;
    // Open custom in-app modal (prompts are blocked in many iframe contexts)
    const defaultLabel = `صفحة ${state.page}`;
    setBookmarkModal({
      label: defaultLabel,
      page: state.page,
      y: state.rulerY,
    });
  };

  const confirmBookmark = (label) => {
    if (!bookmarkModal || !state.fileKey) {
      setBookmarkModal(null);
      return;
    }
    const finalLabel = (label || "").trim() || `صفحة ${bookmarkModal.page}`;
    const bm = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      page: bookmarkModal.page,
      y: bookmarkModal.y,
      label: finalLabel,
      createdAt: new Date().toISOString(),
    };
    setBookmarksMap((m) => ({
      ...m,
      [state.fileKey]: [...(m[state.fileKey] || []), bm],
    }));
    setBookmarkModal(null);
    showToast("أُضيفت العلامة المرجعية");
  };

  const goToBookmark = (bm) => {
    setState((s) => ({ ...s, page: bm.page, rulerY: bm.y }));
    setShowBookmarks(false);
  };

  const deleteBookmark = (id) => {
    setBookmarksMap((m) => ({
      ...m,
      [state.fileKey]: (m[state.fileKey] || []).filter((b) => b.id !== id),
    }));
  };

  const toggleFullscreen = async () => {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen().catch(() => {});
    } else {
      await document.exitFullscreen().catch(() => {});
    }
  };

  useEffect(() => {
    const onFs = () => setIsFs(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  // ---------------- Keyboard shortcuts ----------------
  useEffect(() => {
    const onKey = (e) => {
      if (showShortcuts && e.key === "Escape") {
        setShowShortcuts(false);
        return;
      }
      // ignore typing in inputs
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      if (e.ctrlKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        openFile();
        return;
      }
      if (e.ctrlKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        if (hasFileRef.current) addBookmarkRef.current();
        return;
      }
      if (e.ctrlKey && e.key.toLowerCase() === "g") {
        e.preventDefault();
        if (hasFileRef.current) setShowBookmarks((v) => !v);
        return;
      }
      if (e.ctrlKey && (e.key === "+" || e.key === "=")) {
        e.preventDefault();
        zoomIn();
        return;
      }
      if (e.ctrlKey && (e.key === "-" || e.key === "_")) {
        e.preventDefault();
        zoomOut();
        return;
      }
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setState((s) => {
            const max = Math.max(0, pageSizeRef.current.h - s.rulerHeight);
            return { ...s, rulerY: Math.min(max, Math.max(0, s.rulerY + s.rulerStep)) };
          });
          break;
        case "ArrowUp":
          e.preventDefault();
          setState((s) => {
            const max = Math.max(0, pageSizeRef.current.h - s.rulerHeight);
            return { ...s, rulerY: Math.min(max, Math.max(0, s.rulerY - s.rulerStep)) };
          });
          break;
        case "PageDown":
          e.preventDefault();
          nextPage();
          break;
        case "PageUp":
          e.preventDefault();
          prevPage();
          break;
        case "r":
        case "R":
          rotate();
          break;
        case "h":
        case "H":
          toggleRuler();
          break;
        case "F11":
          e.preventDefault();
          toggleFullscreen();
          break;
        case "?":
          setShowShortcuts((v) => !v);
          break;
        case "Escape":
          setShowSettings(false);
          setShowShortcuts(false);
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.rulerStep, state.fileType, pageCount, showShortcuts]);

  // Ctrl + wheel zoom
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e) => {
      if (e.ctrlKey) {
        e.preventDefault();
        if (e.deltaY < 0) zoomIn();
        else zoomOut();
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rulerColorRGBA = (() => {
    // hex -> rgba with opacity
    const hex = state.rulerColor.replace("#", "");
    const bigint = parseInt(hex, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgba(${r},${g},${b},${state.rulerOpacity})`;
  })();

  const hasFile = Boolean(pdfDoc || imageUrl);

  useEffect(() => {
    hasFileRef.current = hasFile;
  }, [hasFile]);

  useEffect(() => {
    addBookmarkRef.current = addBookmark;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.fileKey, state.page, state.rulerY]);

  return (
    <div className={`mr-app ${isFs ? "mr-hide-chrome" : ""}`} data-testid="mr-app">
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,image/*"
        style={{ display: "none" }}
        onChange={onFileInputChange}
        data-testid="mr-file-input"
      />

      <div className="mr-topbar" data-testid="mr-topbar">
        <div className="mr-brand">
          <div className="mr-brand-mark">م</div>
          <div className="mr-brand-name">مسطرة المخطوطات</div>
        </div>

        <button className="mr-btn mr-btn-primary" onClick={openFile} data-testid="mr-btn-open">
          <FolderOpen size={16} />
          فتح ملف
        </button>

        <button
          className="mr-btn mr-btn-icon"
          onClick={zoomOut}
          disabled={!hasFile}
          title="تصغير (Ctrl -)"
          data-testid="mr-btn-zoom-out"
        >
          <ZoomOut size={16} />
        </button>
        <span className="mr-info-chip" data-testid="mr-zoom-label">{Math.round(scale * 100)}%</span>
        <button
          className="mr-btn mr-btn-icon"
          onClick={zoomIn}
          disabled={!hasFile}
          title="تكبير (Ctrl +)"
          data-testid="mr-btn-zoom-in"
        >
          <ZoomIn size={16} />
        </button>

        <button
          className="mr-btn mr-btn-icon"
          onClick={rotate}
          disabled={!hasFile}
          title="تدوير (R)"
          data-testid="mr-btn-rotate"
        >
          <RotateCw size={16} />
        </button>

        <button
          className="mr-btn mr-btn-icon"
          onClick={toggleRuler}
          disabled={!hasFile}
          title="إظهار/إخفاء المسطرة (H)"
          data-testid="mr-btn-toggle-ruler"
        >
          {state.rulerVisible ? <Eye size={16} /> : <EyeOff size={16} />}
        </button>

        <button
          className="mr-btn mr-btn-icon"
          onClick={() => setShowSettings((v) => !v)}
          title="إعدادات المسطرة"
          data-testid="mr-btn-settings"
        >
          <Settings size={16} />
        </button>

        <button
          className="mr-btn mr-btn-icon"
          onClick={() => hasFile && addBookmark()}
          disabled={!hasFile}
          title="إضافة علامة مرجعية (Ctrl+B)"
          data-testid="mr-btn-add-bookmark"
        >
          <BookmarkPlus size={16} />
        </button>

        <button
          className="mr-btn mr-btn-icon"
          onClick={() => setShowBookmarks((v) => !v)}
          disabled={!hasFile}
          title="قائمة العلامات المرجعية (Ctrl+G)"
          data-testid="mr-btn-bookmarks"
        >
          <Bookmark size={16} />
          {currentBookmarks.length > 0 && (
            <span style={{ fontSize: 11, marginInlineStart: 2 }}>{currentBookmarks.length}</span>
          )}
        </button>

        <button
          className="mr-btn mr-btn-icon"
          onClick={() => setShowShortcuts(true)}
          title="اختصارات لوحة المفاتيح (؟)"
          data-testid="mr-btn-shortcuts"
        >
          <Keyboard size={16} />
        </button>

        <button
          className="mr-btn mr-btn-icon"
          onClick={toggleFullscreen}
          title="ملء الشاشة (F11)"
          data-testid="mr-btn-fullscreen"
        >
          {isFs ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>

        <div className="mr-info">
          {state.fileType === "pdf" && hasFile && (
            <>
              <button
                className="mr-btn mr-btn-icon"
                onClick={prevPage}
                disabled={state.page <= 1}
                title="الصفحة السابقة (Page Up)"
                data-testid="mr-btn-prev"
              >
                <ChevronRight size={16} />
              </button>
              <span className="mr-info-chip" data-testid="mr-page-label">
                صفحة {state.page} / {pageCount}
              </span>
              <button
                className="mr-btn mr-btn-icon"
                onClick={nextPage}
                disabled={state.page >= pageCount}
                title="الصفحة التالية (Page Down)"
                data-testid="mr-btn-next"
              >
                <ChevronLeft size={16} />
              </button>
            </>
          )}
          {hasFile && (
            <span className="mr-info-chip" title={state.fileName} data-testid="mr-file-label">
              {state.fileName.length > 40 ? state.fileName.slice(0, 40) + "…" : state.fileName}
            </span>
          )}
        </div>
      </div>

      <div className="mr-viewer" data-testid="mr-viewer">
        {!hasFile && (
          <div className="mr-empty mr-fade">
            <div className="mr-empty-mark">م</div>
            <h1>مسطرة قراءة المخطوطات</h1>
            <p>
              أداة بسيطة لعرض صور المخطوطات وملفات PDF مع مسطرة أفقية شفافة تُحرَّك يدوياً
              سطراً سطراً، لتوجيه النظر وتقليل التشتت أثناء المقابلة والقراءة.
            </p>
            <button className="mr-btn mr-btn-primary" onClick={openFile} data-testid="mr-empty-open">
              <FolderOpen size={16} />
              افتح ملف صورة أو PDF
            </button>
            <div className="mr-empty-hints">
              <span className="mr-kbd">↑ ↓ لتحريك المسطرة</span>
              <span className="mr-kbd">Page Up/Down للتنقل</span>
              <span className="mr-kbd">Ctrl + / − للتكبير</span>
              <span className="mr-kbd">H لإخفاء المسطرة</span>
              <span className="mr-kbd">؟ للاختصارات</span>
            </div>
          </div>
        )}

        {hasFile && (
          <div className="mr-scroll" ref={scrollRef} data-testid="mr-scroll">
            <div
              className="mr-page-wrap"
              ref={pageWrapRef}
              onClick={onPageClick}
              style={{ width: pageSize.w || undefined, height: pageSize.h || undefined }}
              data-testid="mr-page-wrap"
            >
              <div
                className="mr-page-filter"
                style={{
                  position: "absolute",
                  inset: 0,
                  filter: `brightness(${state.brightness}%) contrast(${state.contrast}%) ${state.invert ? "invert(1) hue-rotate(180deg)" : ""}`,
                }}
              >
                {state.fileType === "pdf" && <canvas ref={canvasRef} className="mr-page-canvas" />}
                {state.fileType === "image" && (
                  <img
                    ref={imgRef}
                    src={imageUrl}
                    onLoad={onImgLoad}
                    alt="manuscript"
                    className="mr-page-img"
                    style={{
                      width: pageSize.w || "auto",
                      height: pageSize.h || "auto",
                      transform: `rotate(${state.rotation}deg)`,
                      transformOrigin: "center center",
                    }}
                  />
                )}
              </div>

              {/* Dim overlays above & below ruler */}
              {state.rulerVisible && state.dimEnabled && pageSize.h > 0 && (
                <>
                  <div
                    className="mr-dim"
                    style={{
                      top: 0,
                      height: Math.max(0, state.rulerY),
                      "--dim-alpha": state.dimAlpha,
                    }}
                  />
                  <div
                    className="mr-dim"
                    style={{
                      top: state.rulerY + state.rulerHeight,
                      height: Math.max(0, pageSize.h - state.rulerY - state.rulerHeight),
                      "--dim-alpha": state.dimAlpha,
                    }}
                  />
                </>
              )}

              {/* Ruler band */}
              {state.rulerVisible && pageSize.h > 0 && (
                <div
                  data-ruler
                  className={`mr-ruler ${rulerDragRef.current.dragging ? "dragging" : ""}`}
                  style={{
                    top: state.rulerY,
                    height: state.rulerHeight,
                    color: rulerColorRGBA,
                  }}
                  onMouseDown={onRulerMouseDown}
                  data-testid="mr-ruler"
                >
                  <div className="mr-ruler-band" />
                  <div className="mr-ruler-edge top" />
                  <div className="mr-ruler-edge bot" />
                </div>
              )}
            </div>
          </div>
        )}

        {showSettings && (
          <div className="mr-settings mr-fade" data-testid="mr-settings">
            <h3>إعدادات المسطرة</h3>

            <div className="mr-field">
              <label>
                ارتفاع المسطرة (السطر) <span className="val">{state.rulerHeight}px</span>
              </label>
              <input
                type="range"
                min="8"
                max="120"
                value={state.rulerHeight}
                onChange={(e) =>
                  setState((s) => ({ ...s, rulerHeight: Number(e.target.value) }))
                }
                data-testid="mr-set-height"
              />
            </div>

            <div className="mr-field">
              <label>
                قفزة السطر (سهم لأسفل/أعلى) <span className="val">{state.rulerStep}px</span>
              </label>
              <input
                type="range"
                min="4"
                max="120"
                value={state.rulerStep}
                onChange={(e) =>
                  setState((s) => ({ ...s, rulerStep: Number(e.target.value) }))
                }
                data-testid="mr-set-step"
              />
            </div>

            <div className="mr-field">
              <label>
                لون المسطرة <span className="val">{state.rulerColor}</span>
              </label>
              <input
                type="color"
                value={state.rulerColor}
                onChange={(e) => setState((s) => ({ ...s, rulerColor: e.target.value }))}
                data-testid="mr-set-color"
              />
            </div>

            <div className="mr-field">
              <label>
                شفافية المسطرة <span className="val">{Math.round(state.rulerOpacity * 100)}%</span>
              </label>
              <input
                type="range"
                min="10"
                max="90"
                value={Math.round(state.rulerOpacity * 100)}
                onChange={(e) =>
                  setState((s) => ({ ...s, rulerOpacity: Number(e.target.value) / 100 }))
                }
                data-testid="mr-set-opacity"
              />
            </div>

            <div className="mr-field">
              <label>
                تعتيم ما حول السطر <span className="val">{Math.round(state.dimAlpha * 100)}%</span>
              </label>
              <input
                type="range"
                min="0"
                max="80"
                value={Math.round(state.dimAlpha * 100)}
                onChange={(e) =>
                  setState((s) => ({
                    ...s,
                    dimAlpha: Number(e.target.value) / 100,
                    dimEnabled: Number(e.target.value) > 0,
                  }))
                }
                data-testid="mr-set-dim"
              />
            </div>

            <div className="mr-field">
              <label>
                السطوع <span className="val">{state.brightness}%</span>
              </label>
              <input
                type="range"
                min="50"
                max="200"
                value={state.brightness}
                onChange={(e) => setState((s) => ({ ...s, brightness: Number(e.target.value) }))}
                data-testid="mr-set-brightness"
              />
            </div>

            <div className="mr-field">
              <label>
                التباين <span className="val">{state.contrast}%</span>
              </label>
              <input
                type="range"
                min="50"
                max="250"
                value={state.contrast}
                onChange={(e) => setState((s) => ({ ...s, contrast: Number(e.target.value) }))}
                data-testid="mr-set-contrast"
              />
            </div>

            <div className="mr-field">
              <label style={{ cursor: "pointer" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <SunMedium size={14} /> عكس الألوان (للمخطوطات الباهتة)
                </span>
                <input
                  type="checkbox"
                  checked={state.invert}
                  onChange={(e) => setState((s) => ({ ...s, invert: e.target.checked }))}
                  data-testid="mr-set-invert"
                  style={{ accentColor: "var(--amber)" }}
                />
              </label>
            </div>

            <button
              className="mr-btn"
              onClick={() => setState((s) => ({ ...s, ...pickRulerDefaults() }))}
              data-testid="mr-set-reset"
            >
              إعادة الافتراضي
            </button>
          </div>
        )}

        {showBookmarks && (
          <div className="mr-settings mr-fade" data-testid="mr-bookmarks" style={{ inset: "auto 10px 10px auto", top: 60 }}>
            <h3>العلامات المرجعية</h3>
            {currentBookmarks.length === 0 && (
              <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>
                لا توجد علامات بعد. اضغط <span className="mr-kbd">Ctrl + B</span> لإضافة علامة عند موضع المسطرة الحالي.
              </p>
            )}
            {currentBookmarks.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 320, overflowY: "auto" }}>
                {currentBookmarks.map((bm) => (
                  <div
                    key={bm.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "8px 10px",
                      background: "var(--ink-3)",
                      border: "1px solid var(--line)",
                      borderRadius: 8,
                    }}
                    data-testid="mr-bookmark-item"
                  >
                    <button
                      className="mr-btn"
                      style={{ flex: 1, justifyContent: "flex-start", padding: "4px 8px" }}
                      onClick={() => goToBookmark(bm)}
                      data-testid="mr-bookmark-go"
                    >
                      <Bookmark size={13} />
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
                        <span style={{ fontSize: 13 }}>{bm.label}</span>
                        <span style={{ fontSize: 11, color: "var(--muted)" }}>
                          صفحة {bm.page} · Y {Math.round(bm.y)}
                        </span>
                      </div>
                    </button>
                    <button
                      className="mr-btn mr-btn-icon"
                      onClick={() => deleteBookmark(bm.id)}
                      title="حذف"
                      data-testid="mr-bookmark-delete"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {showShortcuts && (
          <div className="mr-shortcuts-panel" onClick={() => setShowShortcuts(false)}>
            <div
              className="mr-shortcuts-card mr-fade"
              onClick={(e) => e.stopPropagation()}
              data-testid="mr-shortcuts"
            >
              <h2>
                اختصارات لوحة المفاتيح
                <button
                  className="mr-btn mr-btn-icon"
                  onClick={() => setShowShortcuts(false)}
                  data-testid="mr-shortcuts-close"
                >
                  <X size={16} />
                </button>
              </h2>
              <div className="mr-shortcuts-list">
                {SHORTCUTS.map((row) => (
                  <div className="mr-shortcut-row" key={row.desc}>
                    <span className="desc">{row.desc}</span>
                    <span className="keys">
                      {row.keys.map((k, i) => (
                        <span className="mr-kbd" key={i}>{k}</span>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {loading && <div className="mr-loading" data-testid="mr-loading">جارٍ تحميل الصفحة…</div>}
        {toast && <div className="mr-toast" data-testid="mr-toast">{toast}</div>}

        {bookmarkModal && (
          <BookmarkModal
            initialLabel={bookmarkModal.label}
            onCancel={() => setBookmarkModal(null)}
            onConfirm={confirmBookmark}
          />
        )}
      </div>
    </div>
  );
}

function pickRulerDefaults() {
  return {
    rulerHeight: DEFAULT_STATE.rulerHeight,
    rulerStep: DEFAULT_STATE.rulerStep,
    rulerColor: DEFAULT_STATE.rulerColor,
    rulerOpacity: DEFAULT_STATE.rulerOpacity,
    dimAlpha: DEFAULT_STATE.dimAlpha,
    dimEnabled: true,
    brightness: 100,
    contrast: 100,
    invert: false,
  };
}

function BookmarkModal({ initialLabel, onConfirm, onCancel }) {
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
      <div
        className="mr-shortcuts-card mr-fade"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 420 }}
      >
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
            style={{
              padding: "8px 10px",
              borderRadius: 6,
              background: "var(--ink-3)",
              color: "var(--parchment)",
              border: "1px solid var(--line)",
              fontFamily: "inherit",
              fontSize: 14,
              width: "100%",
            }}
          />
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
          <button className="mr-btn" onClick={onCancel} data-testid="mr-bookmark-cancel">
            إلغاء
          </button>
          <button
            className="mr-btn mr-btn-primary"
            onClick={() => onConfirm(label)}
            data-testid="mr-bookmark-confirm"
          >
            حفظ
          </button>
        </div>
      </div>
    </div>
  );
}

const SHORTCUTS = [
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
  { desc: "إضافة علامة مرجعية", keys: ["Ctrl", "B"] },
  { desc: "فتح/إغلاق قائمة العلامات", keys: ["Ctrl", "G"] },
  { desc: "ملء الشاشة", keys: ["F11"] },
  { desc: "فتح/إغلاق نافذة الاختصارات", keys: ["؟"] },
  { desc: "إغلاق النوافذ", keys: ["Esc"] },
];
