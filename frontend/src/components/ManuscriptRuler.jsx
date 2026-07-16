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
  ChevronsRight,
  ChevronsLeft,
  Keyboard,
  X,
  Bookmark,
  BookmarkPlus,
  Trash2,
  SunMedium,
  Download,
  SplitSquareHorizontal,
  Hash,
  Archive,
  FileText,
  BookOpen,
  MessageSquarePlus,
  MessagesSquare,
  Info,
  Edit3,
  Save,
  ExternalLink,
  Scissors,
  Copy,
  Highlighter,
  Square,
  ArrowUpRight,
  Type,
  Pencil,
  RotateCcw,
  List,
  LayoutGrid,
  Plus,
  Camera,
  Monitor,
} from "lucide-react";
import WebSnipTool from "./WebSnipTool";
import * as pdfjsLib from "pdfjs-dist/build/pdf.mjs";
import JSZip from "jszip";
import { buildDocFromFile, toggleSplitDoc, formatFolio, exportDocAsPdf } from "./manuscriptDoc";
import { PDFDocument } from "pdf-lib";

pdfjsLib.GlobalWorkerOptions.workerSrc = `${process.env.PUBLIC_URL || ""}/pdf.worker.min.mjs`;

// Namespace via URL param (search or hash) so each iframe pane keeps its own state.
const NS = (() => {
  try {
    const q = new URLSearchParams(window.location.search).get("ns");
    if (q) return q;
    // Also support hash-based ns (works reliably in file:// URLs)
    const h = window.location.hash || "";
    const m = h.match(/[#&?]ns=([A-Za-z0-9_-]+)/);
    return m ? m[1] : "";
  } catch { return ""; }
})();
const _NS_SUFFIX = NS ? "." + NS : "";
const STORAGE_KEY = "manuscriptRulerState.v1" + _NS_SUFFIX;
const BOOKMARKS_KEY = "manuscriptRulerBookmarks.v1" + _NS_SUFFIX;
const COMMENTS_KEY = "manuscriptRulerComments.v1" + _NS_SUFFIX;
const INFO_KEY = "manuscriptRulerInfo.v1" + _NS_SUFFIX;
const HEADINGS_KEY = "manuscriptRulerHeadings.v1" + _NS_SUFFIX;
const FOLD_OVERRIDES_KEY = "manuscriptRulerFoldOverrides.v1" + _NS_SUFFIX;
const ZOOM_LEVELS = [0.1, 0.15, 0.2, 0.25, 0.35, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];

const DEFAULT_STATE = {
  fileName: "",
  fileKey: "",
  fileType: "", // 'image' | 'pdf' | 'zip'
  page: 1,
  zoomIdx: 7,  // index of 1.0 in ZOOM_LEVELS
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
  splitPages: false,
  splitFrom: 1,
  splitTo: 999,
  folioMode: true,        // when true, show as 1a/1b instead of "صفحة 1"
  folioStart: 1,          // starting folio number
  folioOffset: 0,         // number of front pages before manuscript begins
  exportMaxSize: 2000,
  exportQuality: 82,
  exportFormat: "zip",    // "zip" | "pdf"
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

function loadKV(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) || {} : {};
  } catch {
    return {};
  }
}
function saveKV(key, data) {
  localStorage.setItem(key, JSON.stringify(data));
}

const EMPTY_INFO = {
  title: "",
  altTitle: "",
  author: "",
  copyist: "",
  copyDate: "",
  era: "",
  number: "",
  library: "",
  catalog: "",
  language: "العربية",
  script: "",
  subject: "",
  foliosCount: "",
  dimensions: "",
  downloadUrl: "",
  notes: "",
};

export default function ManuscriptRuler() {
  const [state, setState] = useState(loadState);
  const [baseDoc, setBaseDoc] = useState(null); // raw doc (pdf or images)
  const [doc, setDoc] = useState(null); // possibly wrapped with split
  const [pageCount, setPageCount] = useState(0);
  const [pageSize, setPageSize] = useState({ w: 0, h: 0 });
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("جارٍ تحميل الصفحة…");
  const [showSettings, setShowSettings] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [showFolioSettings, setShowFolioSettings] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [bookmarksMap, setBookmarksMap] = useState(loadBookmarks);
  const [bookmarkModal, setBookmarkModal] = useState(null);
  const [commentsMap, setCommentsMap] = useState(() => loadKV(COMMENTS_KEY));
  const [infoMap, setInfoMap] = useState(() => loadKV(INFO_KEY));
  const [showComments, setShowComments] = useState(false);
  const [showInfoCard, setShowInfoCard] = useState(true);
  const [showInfoEditor, setShowInfoEditor] = useState(false);
  const [commentModal, setCommentModal] = useState(null); // {editingId?, page, folio, y, text}
  const [snipping, setSnipping] = useState(false);
  const [snipResult, setSnipResult] = useState(null); // {dataUrl, folio, line, filename}
  const [tabs, setTabs] = useState([]);
  const [headingsMap, setHeadingsMap] = useState(() => loadKV(HEADINGS_KEY));
  const [foldOverridesMap, setFoldOverridesMap] = useState(() => loadKV(FOLD_OVERRIDES_KEY));
  const [showHeadings, setShowHeadings] = useState(false);
  const [showThumbs, setShowThumbs] = useState(false);
  const [showWebSnip, setShowWebSnip] = useState(false);
  const [thumbUrls, setThumbUrls] = useState([]); // dataUrls of page thumbnails for active doc
  const [headingModal, setHeadingModal] = useState(null); // {editingId?, page, title, level}
  const [toast, setToast] = useState("");

  const hasFile = Boolean(doc);

  // ---------------- Tabs ----------------
  const switchToTab = (idx) => {
    if (idx < 0 || idx >= tabs.length) return;
    // Save current active tab state
    setTabs((prev) => {
      const copy = [...prev];
      const active = copy.findIndex((t) => t.fileKey === state.fileKey);
      if (active >= 0) {
        copy[active] = {
          ...copy[active],
          page: state.page,
          rulerY: state.rulerY,
          splitPages: state.splitPages,
          splitFrom: state.splitFrom,
          splitTo: state.splitTo,
          doc: doc,
          baseDoc: baseDoc,
          pageCount: pageCount,
        };
      }
      const target = copy[idx];
      // Apply target tab state after this update
      setBaseDoc(target.baseDoc);
      setDoc(target.doc);
      setPageCount(target.pageCount);
      const ft = target.baseDoc?.kind === "pdf" ? "pdf" : "archive";
      setState((s) => ({ ...s, fileName: target.fileName, fileKey: target.fileKey, fileType: ft, page: target.page, rulerY: target.rulerY, splitPages: target.splitPages, splitFrom: target.splitFrom, splitTo: target.splitTo }));
      return copy;
    });
  };

  const closeTab = (idx) => {
    setTabs((prev) => {
      const copy = prev.filter((_, i) => i !== idx);
      const closingActive = prev[idx].fileKey === state.fileKey;
      if (closingActive) {
        if (copy.length > 0) {
          const target = copy[Math.min(idx, copy.length - 1)];
          setBaseDoc(target.baseDoc);
          setDoc(target.doc);
          setPageCount(target.pageCount);
          setState((s) => ({ ...s, fileName: target.fileName, fileKey: target.fileKey, page: target.page, rulerY: target.rulerY, splitPages: target.splitPages, splitFrom: target.splitFrom, splitTo: target.splitTo }));
        } else {
          setBaseDoc(null);
          setDoc(null);
          setPageCount(0);
          setState((s) => ({ ...s, fileName: "", fileKey: "", fileType: "", page: 1, rulerY: 0 }));
        }
      }
      return copy;
    });
  };
  const [isFs, setIsFs] = useState(false);

  const canvasRef = useRef(null);
  const pageWrapRef = useRef(null);
  const scrollRef = useRef(null);
  const fileInputRef = useRef(null);
  const rulerDragRef = useRef({ dragging: false, offsetY: 0 });
  const stateRef = useRef(state);
  const hasFileRef = useRef(false);
  const addBookmarkRef = useRef(() => {});
  const pageSizeRef = useRef({ w: 0, h: 0 });
  const nextPageRef = useRef(() => {});
  const prevPageRef = useRef(() => {});
  const zoomInRef = useRef(() => {});
  const zoomOutRef = useRef(() => {});
  const openAddCommentRef = useRef(() => {});
  const snipRef = useRef(() => {});

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

  useEffect(() => {
    saveKV(COMMENTS_KEY, commentsMap);
  }, [commentsMap]);

  useEffect(() => {
    saveKV(INFO_KEY, infoMap);
  }, [infoMap]);

  useEffect(() => {
    saveKV(HEADINGS_KEY, headingsMap);
  }, [headingsMap]);

  useEffect(() => {
    saveKV(FOLD_OVERRIDES_KEY, foldOverridesMap);
  }, [foldOverridesMap]);

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
    setLoading(true);
    setLoadingMsg("جارٍ فتح الملف…");
    try {
      const fileKey = `${file.name}|${file.size}|${file.lastModified || 0}`;
      const isArchive = /\.(zip|rar|7z|tar|tar\.gz|tgz|tar\.bz2)$/i.test(file.name);
      if (isArchive) setLoadingMsg("جارٍ فك ضغط الملف…");
      const baseD = await buildDocFromFile(file, { pdfjsLib, JSZip, splitPages: false });
      const range = { from: 1, to: baseD.numPages };
      const wrapped = baseD; // always start without splitting; user opts in
      setBaseDoc(baseD);
      setDoc(wrapped);
      setPageCount(wrapped.numPages);
      const ft = baseD.kind === "pdf" ? "pdf" : isArchive ? "archive" : "image";

      // Auto-fill manuscript number from filename (without extension) if not already set
      const nameNoExt = file.name.replace(/\.[^.]+$/, "");
      setInfoMap((m) => {
        if (m[fileKey] && m[fileKey].number) return m;
        return { ...m, [fileKey]: { ...EMPTY_INFO, ...(m[fileKey] || {}), number: nameNoExt } };
      });

      // Add/update tab
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.fileKey === fileKey);
        const tabObj = { fileName: file.name, fileKey, baseDoc: baseD, doc: wrapped, pageCount: wrapped.numPages, page: 1, rulerY: 0, splitPages: false, splitFrom: 1, splitTo: baseD.numPages };
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = tabObj;
          return copy;
        }
        return [...prev, tabObj];
      });

      setState((s) => ({ ...s, fileName: file.name, fileKey, fileType: ft, page: 1, rulerY: 0, splitPages: false, splitFrom: 1, splitTo: baseD.numPages }));
    } catch (e) {
      console.error(e);
      showToast(e.message || "تعذّر فتح الملف");
    } finally {
      setLoading(false);
      setLoadingMsg("جارٍ تحميل الصفحة…");
    }
  };

  const onFileInputChange = (e) => {
    const f = e.target.files?.[0];
    handleFile(f);
    e.target.value = "";
  };

  // ---------------- Unified page rendering ----------------
  const renderPage = useCallback(
    async (pageNum) => {
      if (!doc || !canvasRef.current) return;
      setLoading(true);
      try {
        const page = await doc.getPage(pageNum);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const renderScale = 1.5 * scale;
        const viewport = page.getViewport({ scale: renderScale, rotation: state.rotation });
        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d");
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, viewport.width, viewport.height);
        await page.render({ canvasContext: ctx, viewport }).promise;
        setPageSize({ w: viewport.width, h: viewport.height });
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc, state.rotation, state.zoomIdx]
  );

  useEffect(() => {
    if (doc) renderPage(state.page);
  }, [doc, state.page, state.rotation, state.zoomIdx, renderPage]);

  // Scroll viewer to top whenever page changes
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [state.page]);

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
    if (!doc) return;
    setState((s) => ({ ...s, page: Math.min(pageCount, s.page + 1), rulerY: 0 }));
  };
  const prevPage = () => {
    if (!doc) return;
    setState((s) => ({ ...s, page: Math.max(1, s.page - 1), rulerY: 0 }));
  };
  const firstPage = () => {
    if (!doc) return;
    setState((s) => ({ ...s, page: 1, rulerY: 0 }));
  };
  const lastPage = () => {
    if (!doc) return;
    setState((s) => ({ ...s, page: pageCount, rulerY: 0 }));
  };
  const toggleRuler = () => setState((s) => ({ ...s, rulerVisible: !s.rulerVisible }));

  // ---------------- Split pages (smart fold detection) ----------------
  const toggleSplit = async () => {
    if (!baseDoc) return;
    const next = !state.splitPages;
    setLoading(true);
    setLoadingMsg(next ? "جارٍ الكشف عن خط طي الصفحات…" : "جارٍ استعادة الصفحات الأصلية…");
    try {
      const range = { from: state.splitFrom, to: Math.min(state.splitTo, baseDoc.numPages) };
      const wrapped = toggleSplitDoc(baseDoc, next, range);
      setDoc(wrapped);
      setPageCount(wrapped.numPages);
      setState((s) => ({
        ...s,
        splitPages: next,
        page: 1,
        rulerY: 0,
      }));
    } finally {
      setLoading(false);
      setLoadingMsg("جارٍ تحميل الصفحة…");
    }
  };

  // Re-wrap doc when split range changes while split is active
  const applySplitRange = async (from, to) => {
    if (!baseDoc || !state.splitPages) {
      setState((s) => ({ ...s, splitFrom: from, splitTo: to }));
      return;
    }
    setLoading(true);
    setLoadingMsg("جارٍ إعادة تطبيق التقسيم…");
    try {
      const range = { from, to: Math.min(to, baseDoc.numPages) };
      const wrapped = toggleSplitDoc(baseDoc, true, range);
      setDoc(wrapped);
      setPageCount(wrapped.numPages);
      setState((s) => ({ ...s, splitFrom: from, splitTo: to, page: 1, rulerY: 0 }));
    } finally {
      setLoading(false);
      setLoadingMsg("جارٍ تحميل الصفحة…");
    }
  };

  // ---------------- Export / Compress ----------------
  const exportCompressed = async () => {
    if (!doc) return;
    setLoading(true);
    setLoadingMsg("جارٍ التصدير…");
    try {
      const maxSize = state.exportMaxSize;
      const quality = state.exportQuality / 100;
      const base = (state.fileName || "manuscript").replace(/\.[^.]+$/, "");

      if (state.exportFormat === "pdf") {
        const blob = await exportDocAsPdf(doc, {
          PDFDocument,
          maxSize,
          quality,
          onProgress: (i, total) => setLoadingMsg(`جارٍ إنشاء PDF: صفحة ${i} / ${total}…`),
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${base}-compressed.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        showToast("تم تصدير PDF بنجاح");
      } else {
        // ZIP export
        const zip = new JSZip();
        const pad = String(pageCount).length;
        for (let i = 1; i <= pageCount; i++) {
          setLoadingMsg(`جارٍ معالجة صفحة ${i} / ${pageCount}…`);
          const page = await doc.getPage(i);
          const vp = page.getViewport({ scale: 1, rotation: 0 });
          const targetScale = Math.min(1, maxSize / Math.max(vp.width, vp.height));
          const rvp = page.getViewport({ scale: targetScale, rotation: 0 });
          const off = document.createElement("canvas");
          off.width = Math.floor(rvp.width);
          off.height = Math.floor(rvp.height);
          const ctx = off.getContext("2d");
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, off.width, off.height);
          await page.render({ canvasContext: ctx, viewport: rvp }).promise;
          const blob = await new Promise((r) => off.toBlob(r, "image/jpeg", quality));
          const label = state.folioMode
            ? formatFolio(i, { startFolio: state.folioStart, offset: state.folioOffset })
            : `page-${String(i).padStart(pad, "0")}`;
          const safeLabel = label.replace(/[\/\\[\]]/g, "-");
          zip.file(`${String(i).padStart(pad, "0")}_${safeLabel}.jpg`, blob);
        }
        setLoadingMsg("جارٍ إنشاء الملف المضغوط…");
        const zipBlob = await zip.generateAsync({ type: "blob" });
        const url = URL.createObjectURL(zipBlob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${base}-compressed.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        showToast("تم التصدير بنجاح");
      }
    } catch (e) {
      console.error(e);
      showToast("تعذّر التصدير");
    } finally {
      setLoading(false);
      setLoadingMsg("جارٍ تحميل الصفحة…");
    }
  };

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

  // ---------------- Manuscript info ----------------
  const currentInfo = state.fileKey ? (infoMap[state.fileKey] || { ...EMPTY_INFO }) : { ...EMPTY_INFO };

  const saveInfo = (newInfo) => {
    if (!state.fileKey) return;
    setInfoMap((m) => ({ ...m, [state.fileKey]: newInfo }));
    setShowInfoEditor(false);
    showToast("تم حفظ بيانات المخطوط");
  };

  const copyInfoAsTable = async () => {
    const info = currentInfo;
    const rows = [
      ["عنوان المخطوط", info.title],
      ["عناوين أخرى", info.altTitle],
      ["المؤلف", info.author],
      ["الناسخ", info.copyist],
      ["تاريخ النسخ", info.copyDate],
      ["العصر/القرن", info.era],
      ["رقم المخطوط", info.number],
      ["المكتبة", info.library],
      ["الفهرسة", info.catalog],
      ["الموضوع", info.subject],
      ["اللغة", info.language],
      ["نوع الخط", info.script],
      ["عدد الأوراق", info.foliosCount],
      ["الأبعاد", info.dimensions],
      ["رابط التحميل", info.downloadUrl],
      ["ملاحظات", info.notes],
    ].filter(([, v]) => v && String(v).trim());
    const tsv = rows.map(([k, v]) => `${k}\t${String(v).replace(/\n/g, " ")}`).join("\n");
    const html = `<table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse;direction:rtl">${
      rows.map(([k, v]) => `<tr><td><b>${escapeHtml(k)}</b></td><td>${escapeHtml(v).replace(/\n/g,"<br>")}</td></tr>`).join("")
    }</table>`;
    try {
      await navigator.clipboard.write([new ClipboardItem({
        "text/plain": new Blob([tsv], { type: "text/plain" }),
        "text/html": new Blob([html], { type: "text/html" }),
      })]);
      showToast("نُسخت البطاقة كجدول");
    } catch {
      await navigator.clipboard.writeText(tsv);
      showToast("نُسخت البطاقة");
    }
  };

  // ---------------- Snip (screenshot) ----------------
  const beginSnip = () => {
    if (!doc) return;
    setSnipping(true);
    showToast("اسحب مستطيلاً على الصفحة لالتقاط لقطة");
  };

  // ---------------- Headings (TOC) ----------------
  const currentHeadings = state.fileKey ? (headingsMap[state.fileKey] || []) : [];

  const openAddHeading = () => {
    if (!state.fileKey) return;
    setHeadingModal({ editingId: null, page: state.page, title: "", level: 1 });
  };
  const openEditHeading = (h) => {
    setHeadingModal({ editingId: h.id, page: h.page, title: h.title, level: h.level });
  };
  const saveHeading = (title, level) => {
    if (!headingModal || !state.fileKey) { setHeadingModal(null); return; }
    const t = (title || "").trim();
    if (!t) { setHeadingModal(null); return; }
    setHeadingsMap((m) => {
      const list = m[state.fileKey] || [];
      if (headingModal.editingId) {
        return { ...m, [state.fileKey]: list.map((h) => h.id === headingModal.editingId ? { ...h, title: t, level } : h) };
      }
      const newH = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, page: headingModal.page, title: t, level };
      return { ...m, [state.fileKey]: [...list, newH] };
    });
    setHeadingModal(null);
    showToast(headingModal.editingId ? "تم تعديل العنوان" : "أُضيف العنوان");
  };
  const deleteHeading = (id) => {
    setHeadingsMap((m) => ({ ...m, [state.fileKey]: (m[state.fileKey] || []).filter((h) => h.id !== id) }));
  };
  const goToHeading = (h) => {
    setState((s) => ({ ...s, page: h.page, rulerY: 0 }));
    setShowHeadings(false);
  };

  // ---------------- Manual fold overrides ----------------
  const setFoldRatio = (basePage, ratio) => {
    setFoldOverridesMap((m) => ({
      ...m,
      [state.fileKey]: { ...(m[state.fileKey] || {}), [basePage]: ratio },
    }));
  };

  // ---------------- Thumbnails generation ----------------
  const generateThumbs = async () => {
    if (!doc) return;
    const thumbs = [];
    for (let i = 1; i <= pageCount; i++) {
      const page = await doc.getPage(i);
      const vp = page.getViewport({ scale: 1, rotation: 0 });
      const targetW = 120;
      const scale = targetW / vp.width;
      const rvp = page.getViewport({ scale, rotation: 0 });
      const off = document.createElement("canvas");
      off.width = Math.floor(rvp.width);
      off.height = Math.floor(rvp.height);
      const ctx = off.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, off.width, off.height);
      await page.render({ canvasContext: ctx, viewport: rvp }).promise;
      thumbs.push(off.toDataURL("image/jpeg", 0.6));
    }
    setThumbUrls(thumbs);
  };

  useEffect(() => {
    if (showThumbs && doc && thumbUrls.length !== pageCount) {
      generateThumbs();
    }
    if (!showThumbs) setThumbUrls([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showThumbs, doc, pageCount]);

  // ---------------- Export as indexed PDF with bookmarks ----------------
  const exportAsIndexedPdf = async () => {
    if (!doc) return;
    setLoading(true);
    setLoadingMsg("جارٍ إنشاء PDF مفهرس…");
    try {
      const { PDFDocument, PDFName, PDFDict, PDFArray, PDFRef, PDFHexString, PDFString } = await import("pdf-lib");
      const pdfDoc = await PDFDocument.create();
      const quality = state.exportQuality / 100;
      const maxSize = state.exportMaxSize;
      const pageRefs = [];
      for (let i = 1; i <= pageCount; i++) {
        setLoadingMsg(`تجهيز صفحة ${i} / ${pageCount}…`);
        const page = await doc.getPage(i);
        const vp = page.getViewport({ scale: 1, rotation: 0 });
        const targetScale = Math.min(1, maxSize / Math.max(vp.width, vp.height));
        const rvp = page.getViewport({ scale: targetScale, rotation: 0 });
        const off = document.createElement("canvas");
        off.width = Math.floor(rvp.width);
        off.height = Math.floor(rvp.height);
        const ctx = off.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, off.width, off.height);
        await page.render({ canvasContext: ctx, viewport: rvp }).promise;
        const blob = await new Promise((r) => off.toBlob(r, "image/jpeg", quality));
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const img = await pdfDoc.embedJpg(bytes);
        const pdfPage = pdfDoc.addPage([img.width, img.height]);
        pdfPage.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
        pageRefs.push(pdfPage.ref);
      }

      // Build outline (bookmarks) from headings
      const headings = [...currentHeadings].sort((a, b) => a.page - b.page);
      if (headings.length > 0) {
        const context = pdfDoc.context;
        const outlineDict = context.obj({ Type: "Outlines" });
        const outlineRef = context.register(outlineDict);
        const itemRefs = headings.map(() => context.nextRef());
        headings.forEach((h, i) => {
          const pageIdx = Math.max(0, Math.min(pageCount - 1, h.page - 1));
          const item = context.obj({
            Title: PDFHexString.fromText(h.title),
            Parent: outlineRef,
            Dest: [pageRefs[pageIdx], "Fit"],
          });
          if (i > 0) item.set(PDFName.of("Prev"), itemRefs[i - 1]);
          if (i < headings.length - 1) item.set(PDFName.of("Next"), itemRefs[i + 1]);
          context.assign(itemRefs[i], item);
        });
        outlineDict.set(PDFName.of("First"), itemRefs[0]);
        outlineDict.set(PDFName.of("Last"), itemRefs[itemRefs.length - 1]);
        outlineDict.set(PDFName.of("Count"), context.obj(headings.length));
        pdfDoc.catalog.set(PDFName.of("Outlines"), outlineRef);
        pdfDoc.catalog.set(PDFName.of("PageMode"), PDFName.of("UseOutlines"));
      }

      const bytes = await pdfDoc.save();
      const blob = new Blob([bytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const base = (currentInfo.title || state.fileName || "manuscript").replace(/\.[^.]+$/, "").replace(/[/\\?%*:|"<>]/g, "-");
      a.download = `${base}-مفهرس.pdf`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      showToast(`تم تصدير PDF مفهرس (${headings.length} علامة)`);
    } catch (e) {
      console.error(e);
      showToast("تعذّر التصدير: " + (e.message || e));
    } finally {
      setLoading(false);
      setLoadingMsg("جارٍ تحميل الصفحة…");
    }
  };

  const copyCitation = async (comment) => {
    const info = currentInfo;
    const folio = formatFolio(comment.page, {
      startFolio: state.folioStart,
      offset: state.folioOffset,
    });
    // folio like "1/أ" already includes slash
    const parts = [];
    if (info.library) parts.push(info.library);
    if (info.number) parts.push(info.number);
    parts.push(`ورقة ${folio}`);
    const citation = `(${parts.join(" ")})`;
    try {
      await navigator.clipboard.writeText(citation);
      showToast("نُسخ العزو: " + citation);
    } catch {
      showToast("تعذّر النسخ");
    }
  };

  // ---------------- Comments ----------------
  const currentComments = state.fileKey ? (commentsMap[state.fileKey] || []) : [];

  const openAddComment = () => {
    if (!state.fileKey) return;
    const folio = state.folioMode
      ? formatFolio(state.page, { startFolio: state.folioStart, offset: state.folioOffset })
      : `صفحة ${state.page}`;
    const line = Math.max(1, Math.round(state.rulerY / Math.max(1, state.rulerStep)) + 1);
    setCommentModal({
      editingId: null,
      page: state.page,
      folio,
      line,
      y: state.rulerY,
      text: "",
    });
  };

  const openEditComment = (c) => {
    setCommentModal({ editingId: c.id, page: c.page, folio: c.folio, line: c.line || 1, y: c.y, text: c.text });
  };

  const saveComment = (text) => {
    if (!commentModal || !state.fileKey) {
      setCommentModal(null);
      return;
    }
    const t = (text || "").trim();
    if (!t) {
      setCommentModal(null);
      return;
    }
    setCommentsMap((m) => {
      const list = m[state.fileKey] || [];
      if (commentModal.editingId) {
        return {
          ...m,
          [state.fileKey]: list.map((c) => (c.id === commentModal.editingId ? { ...c, text: t } : c)),
        };
      }
      const newComment = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        page: commentModal.page,
        folio: commentModal.folio,
        line: commentModal.line,
        y: commentModal.y,
        text: t,
        createdAt: new Date().toISOString(),
      };
      return { ...m, [state.fileKey]: [...list, newComment] };
    });
    setCommentModal(null);
    showToast(commentModal.editingId ? "تم تعديل التعليق" : "أُضيف التعليق");
  };

  const deleteComment = (id) => {
    setCommentsMap((m) => ({
      ...m,
      [state.fileKey]: (m[state.fileKey] || []).filter((c) => c.id !== id),
    }));
  };

  const goToComment = (c) => {
    setState((s) => ({ ...s, page: c.page, rulerY: c.y }));
    setShowComments(false);
  };

  const exportCommentsAsWord = () => {
    if (!currentComments.length && !hasInfoFilled(currentInfo)) {
      showToast("لا توجد بيانات لتصديرها");
      return;
    }
    const info = currentInfo;
    const sorted = [...currentComments].sort((a, b) => a.page - b.page || a.y - b.y);
    const rows = sorted
      .map((c, i) => {
        const dt = new Date(c.createdAt).toLocaleString("ar-EG");
        const safeText = escapeHtml(c.text).replace(/\n/g, "<br>");
        const ref = c.line ? `${escapeHtml(c.folio)} · س${c.line}` : escapeHtml(c.folio);
        return `<tr><td>${i + 1}</td><td>${ref}</td><td>${safeText}</td><td>${dt}</td></tr>`;
      })
      .join("\n");

    const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<title>تعليقات المخطوط - ${escapeHtml(info.title || state.fileName || "بدون عنوان")}</title>
<style>
  body { font-family: 'Traditional Arabic', 'Amiri', 'Noto Naskh Arabic', serif; font-size: 14pt; line-height: 1.8; padding: 30px; }
  h1 { font-size: 22pt; border-bottom: 2px solid #333; padding-bottom: 10px; }
  h2 { font-size: 16pt; margin-top: 24px; color: #444; border-bottom: 1px solid #999; padding-bottom: 6px; }
  .info { border: 1px solid #ccc; padding: 12px 16px; background: #fafafa; margin-bottom: 20px; }
  .info div { margin: 4px 0; }
  .info b { display: inline-block; min-width: 140px; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  th, td { border: 1px solid #999; padding: 8px 10px; vertical-align: top; text-align: right; }
  th { background: #eee; font-size: 12pt; }
  td:first-child { text-align: center; width: 40px; }
  td:nth-child(2) { text-align: center; width: 80px; font-weight: bold; color: #8b6a1c; }
  td:last-child { width: 140px; font-size: 11pt; color: #666; }
</style>
</head>
<body>
<h1>تعليقات المخطوط</h1>
<div class="info">
  ${info.title ? `<div><b>عنوان المخطوط:</b> ${escapeHtml(info.title)}</div>` : ""}
  ${info.altTitle ? `<div><b>عناوين أخرى:</b> ${escapeHtml(info.altTitle)}</div>` : ""}
  ${info.author ? `<div><b>المؤلف:</b> ${escapeHtml(info.author)}</div>` : ""}
  ${info.copyist ? `<div><b>الناسخ:</b> ${escapeHtml(info.copyist)}</div>` : ""}
  ${info.copyDate ? `<div><b>تاريخ النسخ:</b> ${escapeHtml(info.copyDate)}</div>` : ""}
  ${info.era ? `<div><b>العصر / القرن:</b> ${escapeHtml(info.era)}</div>` : ""}
  ${info.number ? `<div><b>رقم النسخة:</b> ${escapeHtml(info.number)}</div>` : ""}
  ${info.library ? `<div><b>المكتبة:</b> ${escapeHtml(info.library)}</div>` : ""}
  ${info.catalog ? `<div><b>الفهرسة:</b> ${escapeHtml(info.catalog)}</div>` : ""}
  ${info.subject ? `<div><b>الموضوع:</b> ${escapeHtml(info.subject)}</div>` : ""}
  ${info.language ? `<div><b>اللغة:</b> ${escapeHtml(info.language)}</div>` : ""}
  ${info.script ? `<div><b>نوع الخط:</b> ${escapeHtml(info.script)}</div>` : ""}
  ${info.foliosCount ? `<div><b>عدد الأوراق:</b> ${escapeHtml(info.foliosCount)}</div>` : ""}
  ${info.dimensions ? `<div><b>الأبعاد:</b> ${escapeHtml(info.dimensions)}</div>` : ""}
  ${info.downloadUrl ? `<div><b>رابط التحميل:</b> <a href="${escapeHtml(info.downloadUrl)}">${escapeHtml(info.downloadUrl)}</a></div>` : ""}
  ${info.notes ? `<div><b>ملاحظات فهرسة:</b> ${escapeHtml(info.notes).replace(/\n/g, "<br>")}</div>` : ""}
  <div><b>الملف:</b> ${escapeHtml(state.fileName || "")}</div>
  <div><b>تاريخ التصدير:</b> ${new Date().toLocaleString("ar-EG")}</div>
  <div><b>عدد التعليقات:</b> ${sorted.length}</div>
</div>
${sorted.length === 0
  ? "<p><i>لا توجد تعليقات مسجّلة لهذا المخطوط.</i></p>"
  : `<h2>قائمة التعليقات</h2>
     <table>
       <thead><tr><th>#</th><th>العزو (الفوليو)</th><th>نص التعليق</th><th>تاريخ الإضافة</th></tr></thead>
       <tbody>${rows}</tbody>
     </table>`}
</body></html>`;

    const blob = new Blob(["\ufeff" + html], { type: "application/msword;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const base = (info.title || state.fileName || "manuscript").replace(/\.[^.]+$/, "").replace(/[/\\?%*:|"<>]/g, "-");
    a.download = `${base}-تعليقات.doc`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    showToast("تم تصدير التعليقات");
  };

  const performSnip = async (rect) => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const dispW = parseFloat(canvas.style.width) || canvas.width;
    const scaleX = canvas.width / dispW;
    const scaleY = canvas.height / (parseFloat(canvas.style.height) || canvas.height);
    const sx = Math.max(0, Math.floor(rect.x * scaleX));
    const sy = Math.max(0, Math.floor(rect.y * scaleY));
    const sw = Math.max(1, Math.floor(rect.w * scaleX));
    const sh = Math.max(1, Math.floor(rect.h * scaleY));
    const off = document.createElement("canvas");
    off.width = sw;
    off.height = sh;
    const ctx = off.getContext("2d");
    ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);

    const folio = state.folioMode
      ? formatFolio(state.page, { startFolio: state.folioStart, offset: state.folioOffset })
      : `صفحة ${state.page}`;
    const line = Math.max(1, Math.round((rect.y + rect.h / 2) / Math.max(1, state.rulerStep)) + 1);
    const title = currentInfo.title || state.fileName.replace(/\.[^.]+$/, "") || "manuscript";
    const filename = `${title} — ${folio} — س${line}.png`.replace(/[/\\?%*:|"<>]/g, "-");
    const dataUrl = off.toDataURL("image/png");
    setSnipping(false);
    setSnipResult({ dataUrl, folio, line, filename, title });
  };

  const saveSnipToFile = (dataUrl, filename) => {
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast("تم حفظ اللقطة");
  };

  const copySnipToClipboard = async (dataUrl) => {
    try {
      const blob = await (await fetch(dataUrl)).blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      showToast("نُسخت اللقطة إلى الحافظة");
    } catch (e) {
      console.error(e);
      showToast("تعذّر النسخ إلى الحافظة");
    }
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
      if (e.ctrlKey && e.key.toLowerCase() === "m") {
        e.preventDefault();
        if (hasFileRef.current) openAddCommentRef.current();
        return;
      }
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (hasFileRef.current) snipRef.current();
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
        case "Home":
          e.preventDefault();
          firstPage();
          break;
        case "End":
          e.preventDefault();
          lastPage();
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

  // Ctrl + wheel = zoom, plain wheel at edge = navigate pages
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !hasFile) return;
    let lastNavAt = 0;
    const onWheel = (e) => {
      if (e.ctrlKey) {
        e.preventDefault();
        if (e.deltaY < 0) zoomInRef.current();
        else zoomOutRef.current();
        return;
      }
      const atTop = el.scrollTop <= 0;
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
      const now = Date.now();
      if (now - lastNavAt < 350) return;
      if (e.deltaY > 0 && atBottom) {
        e.preventDefault();
        lastNavAt = now;
        nextPageRef.current();
      } else if (e.deltaY < 0 && atTop) {
        e.preventDefault();
        lastNavAt = now;
        prevPageRef.current();
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [hasFile]);

  const rulerColorRGBA = (() => {
    // hex -> rgba with opacity
    const hex = state.rulerColor.replace("#", "");
    const bigint = parseInt(hex, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgba(${r},${g},${b},${state.rulerOpacity})`;
  })();

  useEffect(() => {
    hasFileRef.current = hasFile;
  }, [hasFile]);

  useEffect(() => {
    addBookmarkRef.current = addBookmark;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.fileKey, state.page, state.rulerY]);

  useEffect(() => {
    nextPageRef.current = nextPage;
    prevPageRef.current = prevPage;
    zoomInRef.current = zoomIn;
    zoomOutRef.current = zoomOut;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageCount, doc]);

  useEffect(() => {
    openAddCommentRef.current = openAddComment;
    snipRef.current = beginSnip;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.fileKey, state.page, state.rulerY, state.rulerStep, state.folioMode, state.folioStart, state.folioOffset, doc]);

  return (
    <div className={`mr-app ${isFs ? "mr-hide-chrome" : ""}`} data-testid="mr-app">
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.zip,.rar,.7z,.tar,.tar.gz,.tgz,image/*"
        style={{ display: "none" }}
        onChange={onFileInputChange}
        data-testid="mr-file-input"
      />

      <div className="mr-topbar" data-testid="mr-topbar">
        <div className="mr-brand">
          <div className="mr-brand-mark">م</div>
          <div className="mr-brand-name">متصفح المخطوطات</div>
        </div>

        <button className="mr-btn mr-btn-primary" onClick={openFile} data-testid="mr-btn-open">
          <FolderOpen size={18} />
          فتح ملف
        </button>

        <button
          className="mr-btn mr-btn-icon"
          onClick={zoomOut}
          disabled={!hasFile}
          title="تصغير (Ctrl -)"
          data-testid="mr-btn-zoom-out"
        >
          <ZoomOut size={18} />
        </button>
        <span className="mr-info-chip" data-testid="mr-zoom-label">{Math.round(scale * 100)}%</span>
        <button
          className="mr-btn mr-btn-icon"
          onClick={zoomIn}
          disabled={!hasFile}
          title="تكبير (Ctrl +)"
          data-testid="mr-btn-zoom-in"
        >
          <ZoomIn size={18} />
        </button>

        <button
          className="mr-btn mr-btn-icon"
          onClick={rotate}
          disabled={!hasFile}
          title="تدوير (R)"
          data-testid="mr-btn-rotate"
        >
          <RotateCw size={18} />
        </button>

        <button
          className="mr-btn mr-btn-icon"
          onClick={toggleRuler}
          disabled={!hasFile}
          title="إظهار/إخفاء المسطرة (H)"
          data-testid="mr-btn-toggle-ruler"
        >
          {state.rulerVisible ? <Eye size={18} /> : <EyeOff size={18} />}
        </button>

        <button
          className="mr-btn mr-btn-icon"
          onClick={() => setShowSettings((v) => !v)}
          title="إعدادات المسطرة"
          data-testid="mr-btn-settings"
        >
          <Settings size={18} />
        </button>

        <button
          className="mr-btn mr-btn-icon"
          onClick={() => hasFile && addBookmark()}
          disabled={!hasFile}
          title="إضافة علامة مرجعية (Ctrl+B)"
          data-testid="mr-btn-add-bookmark"
        >
          <BookmarkPlus size={18} />
        </button>

        <button
          className="mr-btn mr-btn-icon"
          onClick={() => setShowBookmarks((v) => !v)}
          disabled={!hasFile}
          title="قائمة العلامات المرجعية (Ctrl+G)"
          data-testid="mr-btn-bookmarks"
        >
          <Bookmark size={18} />
          {currentBookmarks.length > 0 && (
            <span style={{ fontSize: 11, marginInlineStart: 2 }}>{currentBookmarks.length}</span>
          )}
        </button>

        <button
          className={`mr-btn mr-btn-icon ${state.splitPages ? "mr-btn-active" : ""}`}
          onClick={toggleSplit}
          disabled={!hasFile}
          title="تقسيم الصفحة المزدوجة (كشف تلقائي للطي)"
          data-testid="mr-btn-split"
        >
          <SplitSquareHorizontal size={18} />
        </button>

        <button
          className="mr-btn mr-btn-icon"
          onClick={() => setShowFolioSettings((v) => !v)}
          disabled={!hasFile}
          title="ترقيم المخطوطات (a/b)"
          data-testid="mr-btn-folio"
        >
          <Hash size={18} />
        </button>

        <button
          className="mr-btn mr-btn-icon"
          onClick={() => setShowExport((v) => !v)}
          disabled={!hasFile}
          title="تصدير / تصغير الصور"
          data-testid="mr-btn-export"
        >
          <Archive size={18} />
        </button>

        <button
          className={`mr-btn mr-btn-icon ${showInfoCard ? "mr-btn-active" : ""}`}
          onClick={() => setShowInfoCard((v) => !v)}
          disabled={!hasFile}
          title="بطاقة معلومات المخطوط"
          data-testid="mr-btn-info"
        >
          <BookOpen size={18} />
        </button>

        <button
          className="mr-btn mr-btn-icon"
          onClick={openAddComment}
          disabled={!hasFile}
          title="إضافة تعليق (Ctrl+M)"
          data-testid="mr-btn-add-comment"
        >
          <MessageSquarePlus size={18} />
        </button>

        <button
          className="mr-btn mr-btn-icon"
          onClick={() => setShowComments((v) => !v)}
          disabled={!hasFile}
          title="التعليقات وتصديرها"
          data-testid="mr-btn-comments"
        >
          <MessagesSquare size={18} />
          {currentComments.length > 0 && (
            <span style={{ fontSize: 11, marginInlineStart: 2 }}>{currentComments.length}</span>
          )}
        </button>

        <button
          className={`mr-btn mr-btn-icon ${snipping ? "mr-btn-active" : ""}`}
          onClick={beginSnip}
          disabled={!hasFile}
          title="التقاط لقطة (Ctrl+Shift+S)"
          data-testid="mr-btn-snip"
        >
          <Scissors size={18} />
        </button>

        <button
          className={`mr-btn mr-btn-icon ${showHeadings ? "mr-btn-active" : ""}`}
          onClick={() => setShowHeadings((v) => !v)}
          disabled={!hasFile}
          title="فهرس/عناوين المخطوط"
          data-testid="mr-btn-headings"
        >
          <List size={18} />
          {currentHeadings.length > 0 && <span style={{ fontSize: 11, marginInlineStart: 2 }}>{currentHeadings.length}</span>}
        </button>

        <button
          className={`mr-btn mr-btn-icon ${showThumbs ? "mr-btn-active" : ""}`}
          onClick={() => setShowThumbs((v) => !v)}
          disabled={!hasFile}
          title="شريط مصغّرات الصفحات"
          data-testid="mr-btn-thumbs"
        >
          <LayoutGrid size={18} />
        </button>

        <button
          className="mr-btn mr-btn-icon"
          onClick={() => setShowWebSnip(true)}
          title="التقاط لقطات من أي نافذة/شاشة وحفظها كـPDF"
          data-testid="mr-btn-web-snip"
          style={{ color: "var(--amber)" }}
        >
          <Monitor size={18} />
        </button>

        <button
          className="mr-btn mr-btn-icon"
          onClick={toggleFullscreen}
          title="ملء الشاشة (F11)"
          data-testid="mr-btn-fullscreen"
        >
          {isFs ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
        </button>

        <div className="mr-info">
          {hasFile && (
            <>
              <button
                className="mr-btn mr-btn-icon"
                onClick={firstPage}
                disabled={state.page <= 1}
                title="أول المخطوط"
                data-testid="mr-btn-first"
              >
                <ChevronsRight size={18} />
              </button>
              <button
                className="mr-btn mr-btn-icon"
                onClick={prevPage}
                disabled={state.page <= 1}
                title="الصفحة السابقة (Page Up)"
                data-testid="mr-btn-prev"
              >
                <ChevronRight size={18} />
              </button>
              <span className="mr-info-chip" data-testid="mr-page-label">
                {state.folioMode
                  ? formatFolio(state.page, {
                      startFolio: state.folioStart,
                      offset: state.folioOffset,
                    })
                  : `صفحة ${state.page}`}
                {" · "}
                {state.page}/{pageCount}
              </span>
              <button
                className="mr-btn mr-btn-icon"
                onClick={nextPage}
                disabled={state.page >= pageCount}
                title="الصفحة التالية (Page Down)"
                data-testid="mr-btn-next"
              >
                <ChevronLeft size={18} />
              </button>
              <button
                className="mr-btn mr-btn-icon"
                onClick={lastPage}
                disabled={state.page >= pageCount}
                title="آخر المخطوط"
                data-testid="mr-btn-last"
              >
                <ChevronsLeft size={18} />
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

      {tabs.length > 0 && (
        <div className="mr-tabs" data-testid="mr-tabs">
          {tabs.map((t, idx) => {
            const active = t.fileKey === state.fileKey;
            const shortName = t.fileName.length > 24 ? t.fileName.slice(0, 22) + "…" : t.fileName;
            return (
              <div
                key={t.fileKey}
                className={`mr-tab ${active ? "active" : ""}`}
                onClick={() => !active && switchToTab(idx)}
                data-testid="mr-tab"
                title={t.fileName}
              >
                <BookOpen size={12} />
                <span className="mr-tab-name">{shortName}</span>
                <button
                  className="mr-tab-close"
                  onClick={(e) => { e.stopPropagation(); closeTab(idx); }}
                  title="إغلاق"
                  data-testid="mr-tab-close"
                >
                  <X size={11} />
                </button>
              </div>
            );
          })}
          <button className="mr-tab-add" onClick={openFile} title="فتح مخطوط جديد" data-testid="mr-tab-add">
            <FolderOpen size={13} />
            مخطوط جديد
          </button>
        </div>
      )}

      <div className="mr-viewer" data-testid="mr-viewer">
        {!hasFile && (
          <div className="mr-empty mr-fade">
            <div className="mr-empty-mark">م</div>
            <h1>متصفح المخطوطات</h1>
            <p>
              متصفح مخطوطات مساعد للباحثين على تحميل المخطوطات المضغوطة وتصفحها
              وتقسيم صفحاتها وترقيمها وتصغير حجمها ومقابلتها والتعليق عليها وفهرستها.
            </p>
            <button className="mr-btn mr-btn-primary mr-empty-btn" onClick={openFile} data-testid="mr-empty-open">
              <FolderOpen size={20} />
              افتح ملف مخطوط
            </button>
            {!window.msElectron && (
              <a
                href={`${process.env.REACT_APP_BACKEND_URL || ""}/api/download/windows`}
                className="mr-btn"
                data-testid="mr-download-windows"
                style={{
                  padding: "8px 16px",
                  fontSize: 13,
                  gap: 6,
                  color: "var(--amber)",
                  border: "1px solid var(--amber)",
                  textDecoration: "none",
                  marginTop: 4,
                }}
                download
              >
                <Download size={16} />
                تنزيل نسخة سطح المكتب لويندوز (Portable)
              </a>
            )}
            <div className="mr-credits" data-testid="mr-credits">
              فكرة وتصميم: <b>د. محمد عمر أحمد الكاف</b> — اختصاصي مخطوطات
              <br />
              <a href="mailto:moakaf2025@gmail.com">moakaf2025@gmail.com</a>
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
                <canvas ref={canvasRef} className="mr-page-canvas" />
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
                  <X size={18} />
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

        {showFolioSettings && (
          <div className="mr-settings mr-fade" data-testid="mr-folio-settings" style={{ inset: "auto 10px 10px auto", top: 60, width: 340 }}>
            <h3>ترقيم المخطوط + مدى التقسيم</h3>

            <div style={{ fontSize: 12, color: "var(--parchment-soft)", padding: "8px 10px", background: "var(--ink-3)", borderRadius: 6, border: "1px solid var(--line)", lineHeight: 1.7 }}>
              <b style={{ color: "var(--amber)" }}>كيف يعمل الترقيم؟</b>
              <br />
              في علم المخطوطات، كل ورقة لها وجهان: <b>a</b> (recto/الوجه الأيمن) و <b>b</b> (verso/الوجه الأيسر). فالورقة الأولى صفحتاها <b>1a</b> ثم <b>1b</b>، ثم <b>2a</b> و <b>2b</b>… وهكذا.
              <br /><br />
              إذا كان في بداية الملف صفحات غلاف أو فهرسة قبل نص المخطوط، حدّد عددها في «صفحات الغلاف قبل بداية المخطوط»، فيبدأ الترقيم بعدها.
              <br /><br />
              مثال: لديك ملف فيه 3 صفحات غلاف قبل نص المخطوط، ضع القيمة 3، فتصير الصفحة الرابعة <b>1a</b>.
            </div>

            <div className="mr-field">
              <label style={{ cursor: "pointer", flexDirection: "row", justifyContent: "space-between" }}>
                <span>تفعيل ترقيم الفوليو</span>
                <input
                  type="checkbox"
                  checked={state.folioMode}
                  onChange={(e) => setState((s) => ({ ...s, folioMode: e.target.checked }))}
                  data-testid="mr-folio-toggle"
                  style={{ accentColor: "var(--amber)" }}
                />
              </label>
            </div>

            <div className="mr-field">
              <label>رقم الفوليو الأول <span className="val">{state.folioStart}</span></label>
              <input
                type="number" min="1" value={state.folioStart}
                onChange={(e) => setState((s) => ({ ...s, folioStart: Math.max(1, Number(e.target.value) || 1) }))}
                data-testid="mr-folio-start"
              />
            </div>

            <div className="mr-field">
              <label>صفحات الغلاف قبل بداية المخطوط <span className="val">{state.folioOffset}</span></label>
              <input
                type="number" min="0" value={state.folioOffset}
                onChange={(e) => setState((s) => ({ ...s, folioOffset: Math.max(0, Number(e.target.value) || 0) }))}
                data-testid="mr-folio-offset"
              />
            </div>

            <div style={{ fontSize: 12, color: "var(--muted)", padding: "6px 8px", background: "var(--ink-3)", borderRadius: 6, border: "1px solid var(--line)" }}>
              الصفحة الحالية:{" "}
              <span style={{ color: "var(--amber)", fontWeight: 600 }}>
                {state.folioMode
                  ? formatFolio(state.page, { startFolio: state.folioStart, offset: state.folioOffset })
                  : `صفحة ${state.page}`}
              </span>
            </div>

            <h3 style={{ marginTop: 6 }}>مدى التقسيم</h3>
            <div style={{ fontSize: 12, color: "var(--parchment-soft)", padding: "8px 10px", background: "var(--ink-3)", borderRadius: 6, border: "1px solid var(--line)", lineHeight: 1.6 }}>
              حدّد أول وآخر صفحة يُطبَّق عليها التقسيم (رقم الصفحة في <b>الملف الأصلي</b>). الصفحات خارج هذا المدى تبقى بدون تقسيم — مفيد إذا كانت أول صفحة (الغلاف) أو الأخيرة (كولوفون) بلا طية.
            </div>

            <div className="mr-field">
              <label>ابدأ التقسيم من صفحة <span className="val">{state.splitFrom}</span></label>
              <input
                type="number" min="1"
                value={state.splitFrom}
                onChange={(e) => applySplitRange(Math.max(1, Number(e.target.value) || 1), state.splitTo)}
                data-testid="mr-split-from"
              />
            </div>

            <div className="mr-field">
              <label>انتهِ عند صفحة <span className="val">{Math.min(state.splitTo, baseDoc?.numPages || state.splitTo)}</span></label>
              <input
                type="number" min="1"
                value={state.splitTo}
                onChange={(e) => applySplitRange(state.splitFrom, Math.max(state.splitFrom, Number(e.target.value) || state.splitFrom))}
                data-testid="mr-split-to"
              />
            </div>

            {baseDoc && (
              <div style={{ fontSize: 12, color: "var(--muted)" }}>
                إجمالي صفحات الملف الأصلي: <b style={{ color: "var(--parchment)" }}>{baseDoc.numPages}</b>
              </div>
            )}

            {state.splitPages && baseDoc && (
              <>
                <h3 style={{ marginTop: 6 }}>ضبط يدوي لخط الطي</h3>
                <div style={{ fontSize: 12, color: "var(--parchment-soft)", padding: "6px 10px", background: "var(--ink-3)", borderRadius: 6, border: "1px solid var(--line)", lineHeight: 1.6 }}>
                  إذا فشل الكشف الذكي لخط الطي في الصفحة الأصلية الحالية، يمكنك ضبط موضع القص يدوياً. القيمة 50% تعني منتصف الصفحة تماماً.
                </div>
                {(() => {
                  const activeBasePage = Math.ceil(state.page / 2);
                  const overrides = foldOverridesMap[state.fileKey] || {};
                  const current = overrides[activeBasePage];
                  const displayVal = current != null ? Math.round(current * 100) : 50;
                  return (
                    <div className="mr-field">
                      <label>موضع القص للورقة {activeBasePage} <span className="val">{displayVal}%</span></label>
                      <input type="range" min="20" max="80" value={displayVal}
                        onChange={(e) => {
                          const v = Number(e.target.value) / 100;
                          setFoldRatio(activeBasePage, v);
                          // trigger re-render by forcing doc reload
                          if (baseDoc && state.splitPages) {
                            const range = { from: state.splitFrom, to: Math.min(state.splitTo, baseDoc.numPages) };
                            const wrapped = toggleSplitDoc(baseDoc, true, range);
                            // Inject override lookup into wrapped
                            const origGetPage = wrapped.getPage.bind(wrapped);
                            wrapped.getPage = async (n) => {
                              const p = await origGetPage(n);
                              if (p._foldRatio != null) {
                                const bp = Math.ceil((n - state.splitFrom + 1) / 2) + state.splitFrom - 1;
                                const o = (foldOverridesMap[state.fileKey] || {})[bp];
                                if (o != null) p._foldRatio = o;
                              }
                              return p;
                            };
                            setDoc(wrapped);
                          }
                        }}
                        data-testid="mr-fold-manual"
                      />
                    </div>
                  );
                })()}
              </>
            )}
          </div>
        )}

        {showExport && (
          <div className="mr-settings mr-fade" data-testid="mr-export-panel" style={{ inset: "auto 10px 10px auto", top: 60, width: 320 }}>
            <h3>تصدير المخطوط</h3>

            <div className="mr-field">
              <label>صيغة التصدير</label>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  className={`mr-btn ${state.exportFormat === "zip" ? "mr-btn-active" : ""}`}
                  style={{ flex: 1, justifyContent: "center" }}
                  onClick={() => setState((s) => ({ ...s, exportFormat: "zip" }))}
                  data-testid="mr-export-fmt-zip"
                >
                  <Archive size={14} /> ZIP (صور)
                </button>
                <button
                  className={`mr-btn ${state.exportFormat === "pdf" ? "mr-btn-active" : ""}`}
                  style={{ flex: 1, justifyContent: "center" }}
                  onClick={() => setState((s) => ({ ...s, exportFormat: "pdf" }))}
                  data-testid="mr-export-fmt-pdf"
                >
                  <FileText size={14} /> PDF
                </button>
              </div>
            </div>

            <div className="mr-field">
              <label>أقصى بُعد للصورة <span className="val">{state.exportMaxSize}px</span></label>
              <input
                type="range" min="800" max="3600" step="100"
                value={state.exportMaxSize}
                onChange={(e) => setState((s) => ({ ...s, exportMaxSize: Number(e.target.value) }))}
                data-testid="mr-export-size"
              />
            </div>

            <div className="mr-field">
              <label>جودة JPEG <span className="val">{state.exportQuality}%</span></label>
              <input
                type="range" min="50" max="95"
                value={state.exportQuality}
                onChange={(e) => setState((s) => ({ ...s, exportQuality: Number(e.target.value) }))}
                data-testid="mr-export-quality"
              />
            </div>

            <div style={{ fontSize: 12, color: "var(--muted)", padding: "6px 8px", background: "var(--ink-3)", borderRadius: 6, border: "1px solid var(--line)", lineHeight: 1.6 }}>
              {state.exportFormat === "pdf"
                ? `سيُصدَّر المخطوط كملف PDF واحد يحتوي على ${pageCount} صفحة.`
                : `سيُصدَّر المخطوط كملف ZIP فيه ${pageCount} صورة JPEG مرقّمة بالفوليو الحالي.`}
            </div>

            <button
              className="mr-btn mr-btn-primary"
              onClick={exportCompressed}
              data-testid="mr-export-run"
              style={{ justifyContent: "center" }}
            >
              <Download size={14} />
              تصدير الآن
            </button>
          </div>
        )}

        {/* Manuscript Info Card (floating, always-visible when file open) */}
        {hasFile && showInfoCard && (
          <div className="mr-info-card mr-fade" data-testid="mr-info-card">
            <div className="mr-info-card-header">
              <BookOpen size={14} />
              <span className="mr-info-card-title" title={currentInfo.title || "بدون عنوان"} data-testid="mr-info-title">
                {currentInfo.title || "— بدون عنوان —"}
              </span>
              <button
                className="mr-btn mr-btn-icon"
                onClick={copyInfoAsTable}
                title="نسخ البطاقة كجدول"
                data-testid="mr-info-copy"
                style={{ width: 22, height: 22 }}
              >
                <Copy size={12} />
              </button>
              <button
                className="mr-btn mr-btn-icon"
                onClick={() => setShowInfoEditor(true)}
                title="تحرير البطاقة"
                data-testid="mr-info-edit"
                style={{ width: 22, height: 22 }}
              >
                <Edit3 size={12} />
              </button>
              <button
                className="mr-btn mr-btn-icon"
                onClick={() => setShowInfoCard(false)}
                title="إخفاء البطاقة"
                data-testid="mr-info-close"
                style={{ width: 22, height: 22 }}
              >
                <X size={12} />
              </button>
            </div>
            <div className="mr-info-card-body">
              {currentInfo.author && (
                <div><span className="k">المؤلف:</span> {currentInfo.author}</div>
              )}
              {currentInfo.copyist && (
                <div><span className="k">الناسخ:</span> {currentInfo.copyist}</div>
              )}
              {currentInfo.copyDate && (
                <div><span className="k">تاريخ النسخ:</span> {currentInfo.copyDate}</div>
              )}
              {currentInfo.number && (
                <div><span className="k">رقم النسخة:</span> {currentInfo.number}</div>
              )}
              {currentInfo.library && (
                <div><span className="k">المكتبة:</span> {currentInfo.library}</div>
              )}
              {currentInfo.catalog && (
                <div><span className="k">الفهرسة:</span> {currentInfo.catalog}</div>
              )}
              {currentInfo.subject && (
                <div><span className="k">الموضوع:</span> {currentInfo.subject}</div>
              )}
              {currentInfo.script && (
                <div><span className="k">الخط:</span> {currentInfo.script}</div>
              )}
              {currentInfo.foliosCount && (
                <div><span className="k">عدد الأوراق:</span> {currentInfo.foliosCount}</div>
              )}
              {currentInfo.downloadUrl && (
                <div>
                  <span className="k">الرابط:</span>{" "}
                  <a
                    href={currentInfo.downloadUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "var(--amber)" }}
                  >
                    <ExternalLink size={10} style={{ verticalAlign: "middle" }} /> فتح
                  </a>
                </div>
              )}
              {!hasInfoFilled(currentInfo) && (
                <div style={{ color: "var(--muted)", fontStyle: "italic" }}>
                  انقر <Edit3 size={10} style={{ verticalAlign: "middle" }} /> لتعبئة بيانات المخطوط.
                </div>
              )}
            </div>
          </div>
        )}

        {/* Comments panel */}
        {showComments && (
          <div className="mr-settings mr-fade" data-testid="mr-comments-panel" style={{ inset: "auto 10px 10px auto", top: 60, width: 340 }}>
            <h3>
              التعليقات ({currentComments.length})
              <button
                className="mr-btn mr-btn-icon"
                onClick={() => setShowComments(false)}
                data-testid="mr-comments-close"
                style={{ float: "left" }}
              >
                <X size={14} />
              </button>
            </h3>
            <button
              className="mr-btn mr-btn-primary"
              onClick={openAddComment}
              style={{ justifyContent: "center" }}
              data-testid="mr-comments-add"
            >
              <MessageSquarePlus size={14} />
              إضافة تعليق للموضع الحالي (Ctrl+M)
            </button>

            {currentComments.length === 0 && (
              <p style={{ color: "var(--muted)", fontSize: 12, margin: "8px 0 0", lineHeight: 1.6 }}>
                لا توجد تعليقات بعد. حرّك المسطرة إلى السطر الذي تريد التعليق عليه، ثم اضغط{" "}
                <span className="mr-kbd">Ctrl + M</span>.
              </p>
            )}

            {currentComments.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 320, overflowY: "auto" }}>
                {[...currentComments]
                  .sort((a, b) => a.page - b.page || a.y - b.y)
                  .map((c) => (
                    <div
                      key={c.id}
                      style={{
                        padding: "8px 10px",
                        background: "var(--ink-3)",
                        border: "1px solid var(--line)",
                        borderRadius: 8,
                        display: "flex",
                        flexDirection: "column",
                        gap: 4,
                      }}
                      data-testid="mr-comment-item"
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                        <button
                          className="mr-btn"
                          style={{ padding: "2px 8px", background: "var(--amber-2)", color: "var(--ink)", fontWeight: 600 }}
                          onClick={() => goToComment(c)}
                          title="اذهب إلى الموضع"
                        >
                          {c.folio}{c.line ? ` · س${c.line}` : ""}
                        </button>
                        <div style={{ display: "flex", gap: 3 }}>
                          <button
                            className="mr-btn mr-btn-icon"
                            style={{ width: 22, height: 22 }}
                            onClick={() => copyCitation(c)}
                            title="نسخ العزو (المكتبة + رقم المخطوط + ورقة)"
                            data-testid="mr-comment-copy-citation"
                          >
                            <Copy size={11} />
                          </button>
                          <button
                            className="mr-btn mr-btn-icon"
                            style={{ width: 22, height: 22 }}
                            onClick={() => openEditComment(c)}
                            title="تعديل"
                          >
                            <Edit3 size={11} />
                          </button>
                          <button
                            className="mr-btn mr-btn-icon"
                            style={{ width: 22, height: 22 }}
                            onClick={() => deleteComment(c.id)}
                            title="حذف"
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      </div>
                      <div style={{ fontSize: 13, color: "var(--parchment)", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                        {c.text}
                      </div>
                    </div>
                  ))}
              </div>
            )}

            <button
              className="mr-btn"
              onClick={exportCommentsAsWord}
              style={{ justifyContent: "center", marginTop: 4 }}
              disabled={currentComments.length === 0 && !hasInfoFilled(currentInfo)}
              data-testid="mr-comments-export"
            >
              <FileText size={14} />
              تصدير التعليقات + البطاقة (Word)
            </button>
          </div>
        )}

        {/* Info Editor Modal */}
        {showInfoEditor && (
          <InfoEditorModal
            initial={currentInfo}
            onCancel={() => setShowInfoEditor(false)}
            onSave={saveInfo}
          />
        )}

        {/* Comment Modal */}
        {commentModal && (
          <CommentModal
            initial={commentModal}
            onCancel={() => setCommentModal(null)}
            onSave={saveComment}
          />
        )}

        {/* Snip selection overlay */}
        {snipping && hasFile && (
          <SnipOverlay
            pageWrapRef={pageWrapRef}
            onCancel={() => setSnipping(false)}
            onFinish={performSnip}
          />
        )}

        {/* Snip result preview */}
        {snipResult && (
          <SnipPreview
            snip={snipResult}
            onClose={() => setSnipResult(null)}
            onSave={saveSnipToFile}
            onCopy={copySnipToClipboard}
          />
        )}

        {showHeadings && (
          <div className="mr-settings mr-fade" data-testid="mr-headings-panel" style={{ inset: "auto 10px 10px auto", top: 60, width: 340 }}>
            <h3>الفهرس والعناوين ({currentHeadings.length})
              <button className="mr-btn mr-btn-icon" onClick={() => setShowHeadings(false)} style={{ float: "left" }}><X size={14} /></button>
            </h3>
            <button className="mr-btn mr-btn-primary" onClick={openAddHeading} style={{ justifyContent: "center" }} data-testid="mr-headings-add">
              <Plus size={14} /> إضافة عنوان عند الصفحة الحالية
            </button>
            {currentHeadings.length === 0 && (
              <p style={{ color: "var(--muted)", fontSize: 12, margin: "8px 0 0" }}>لا توجد عناوين بعد. عناوين المخطوط (فصول، أبواب…) تُصدَّر كإشارات مرجعية داخل ملف PDF.</p>
            )}
            {currentHeadings.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 260, overflowY: "auto" }}>
                {[...currentHeadings].sort((a,b) => a.page - b.page).map((h) => (
                  <div key={h.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 8px", background: "var(--ink-3)", border: "1px solid var(--line)", borderRadius: 6, fontSize: 13 }} data-testid="mr-heading-item">
                    <button className="mr-btn" style={{ flex: 1, justifyContent: "flex-start", padding: "3px 8px", paddingInlineStart: h.level * 12 }} onClick={() => goToHeading(h)}>
                      <span style={{ color: "var(--amber)", fontSize: 11 }}>ص{h.page}</span>
                      <span>{h.title}</span>
                    </button>
                    <button className="mr-btn mr-btn-icon" style={{ width: 22, height: 22 }} onClick={() => openEditHeading(h)}><Edit3 size={11} /></button>
                    <button className="mr-btn mr-btn-icon" style={{ width: 22, height: 22 }} onClick={() => deleteHeading(h.id)}><Trash2 size={11} /></button>
                  </div>
                ))}
              </div>
            )}
            <button className="mr-btn" onClick={exportAsIndexedPdf} style={{ justifyContent: "center", marginTop: 6 }} data-testid="mr-export-indexed-pdf">
              <FileText size={14} /> تصدير PDF مفهرس (مع bookmarks)
            </button>
          </div>
        )}

        {headingModal && (
          <HeadingModal initial={headingModal} onCancel={() => setHeadingModal(null)} onSave={saveHeading} />
        )}

        {/* Vertical thumbnails strip */}
        {showThumbs && hasFile && (
          <div className="mr-thumbs" data-testid="mr-thumbs-strip">
            {thumbUrls.length === 0 && (
              <div style={{ padding: 20, textAlign: "center", color: "var(--muted)", fontSize: 12 }}>جارٍ إنشاء المصغّرات…</div>
            )}
            {thumbUrls.map((url, i) => {
              const pg = i + 1;
              const isActive = pg === state.page;
              const hasBookmark = currentBookmarks.some((b) => b.page === pg);
              const hasComment = currentComments.some((c) => c.page === pg);
              const hasHeading = currentHeadings.some((h) => h.page === pg);
              return (
                <div key={i} className={`mr-thumb ${isActive ? "active" : ""}`} onClick={() => setState((s) => ({ ...s, page: pg, rulerY: 0 }))} data-testid="mr-thumb">
                  <img src={url} alt={`page ${pg}`} />
                  <div className="mr-thumb-label">
                    {state.folioMode ? formatFolio(pg, { startFolio: state.folioStart, offset: state.folioOffset }) : pg}
                  </div>
                  <div className="mr-thumb-markers">
                    {hasHeading && <span className="marker head" title="عنوان">H</span>}
                    {hasBookmark && <span className="marker bm" title="علامة">★</span>}
                    {hasComment && <span className="marker cm" title="تعليق">💬</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {loading && <div className="mr-loading" data-testid="mr-loading">{loadingMsg}</div>}
        {toast && <div className="mr-toast" data-testid="mr-toast">{toast}</div>}

        {bookmarkModal && (
          <BookmarkModal
            initialLabel={bookmarkModal.label}
            onCancel={() => setBookmarkModal(null)}
            onConfirm={confirmBookmark}
          />
        )}

        {showWebSnip && (
          <WebSnipTool
            onClose={() => setShowWebSnip(false)}
            onToast={showToast}
          />
        )}
      </div>
    </div>
  );
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function hasInfoFilled(info) {
  if (!info) return false;
  return Boolean(info.title || info.number || info.library || info.catalog || info.downloadUrl || info.notes);
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
      <div className="mr-shortcuts-card mr-fade" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
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

function InfoEditorModal({ initial, onSave, onCancel }) {
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
      <div className="mr-shortcuts-card mr-fade" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640, maxHeight: "85vh", overflowY: "auto" }}>
        <h2 style={{ fontSize: 20 }}>بطاقة معلومات المخطوط</h2>

        <div className="mr-field">
          <label>عنوان المخطوط <span style={{ color: "var(--amber)" }}>*</span></label>
          <input ref={firstRef} type="text" value={f.title || ""} onChange={setField("title")} style={inputStyle} data-testid="mr-info-field-title" />
        </div>

        <div className="mr-field">
          <label>عناوين أخرى / عنوان بديل</label>
          <input type="text" value={f.altTitle || ""} onChange={setField("altTitle")} style={inputStyle} data-testid="mr-info-field-altTitle" />
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

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div className="mr-field">
            <label>تاريخ النسخ (هجري/ميلادي)</label>
            <input type="text" value={f.copyDate || ""} onChange={setField("copyDate")} placeholder="مثلاً: 823هـ / 1420م" style={inputStyle} data-testid="mr-info-field-copyDate" />
          </div>
          <div className="mr-field">
            <label>العصر / القرن</label>
            <input type="text" value={f.era || ""} onChange={setField("era")} placeholder="مثلاً: القرن 9 الهجري" style={inputStyle} data-testid="mr-info-field-era" />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div className="mr-field">
            <label>رقم النسخة</label>
            <input type="text" value={f.number || ""} onChange={setField("number")} style={inputStyle} data-testid="mr-info-field-number" />
          </div>
          <div className="mr-field">
            <label>المكتبة</label>
            <input type="text" value={f.library || ""} onChange={setField("library")} style={inputStyle} data-testid="mr-info-field-library" />
          </div>
        </div>

        <div className="mr-field">
          <label>بيانات الفهرسة (رقم الفهرس / كولوفون)</label>
          <input type="text" value={f.catalog || ""} onChange={setField("catalog")} style={inputStyle} data-testid="mr-info-field-catalog" />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div className="mr-field">
            <label>الموضوع / العلم</label>
            <input type="text" value={f.subject || ""} onChange={setField("subject")} placeholder="فقه، نحو، حديث…" style={inputStyle} data-testid="mr-info-field-subject" />
          </div>
          <div className="mr-field">
            <label>اللغة</label>
            <input type="text" value={f.language || ""} onChange={setField("language")} style={inputStyle} data-testid="mr-info-field-language" />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div className="mr-field">
            <label>نوع الخط</label>
            <input type="text" value={f.script || ""} onChange={setField("script")} placeholder="نسخ، مغربي، ثلث…" style={inputStyle} data-testid="mr-info-field-script" />
          </div>
          <div className="mr-field">
            <label>عدد الأوراق</label>
            <input type="text" value={f.foliosCount || ""} onChange={setField("foliosCount")} style={inputStyle} data-testid="mr-info-field-foliosCount" />
          </div>
        </div>

        <div className="mr-field">
          <label>الأبعاد / القياس</label>
          <input type="text" value={f.dimensions || ""} onChange={setField("dimensions")} placeholder="مثلاً: 24 × 17 سم" style={inputStyle} data-testid="mr-info-field-dimensions" />
        </div>

        <div className="mr-field">
          <label>رابط التحميل الأصلي</label>
          <input type="url" value={f.downloadUrl || ""} onChange={setField("downloadUrl")} placeholder="https://…" style={inputStyle} data-testid="mr-info-field-url" />
        </div>

        <div className="mr-field">
          <label>ملاحظات فهرسة إضافية</label>
          <textarea value={f.notes || ""} onChange={setField("notes")} rows={3} style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }} data-testid="mr-info-field-notes" />
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
          <button className="mr-btn" onClick={onCancel} data-testid="mr-info-cancel">إلغاء</button>
          <button className="mr-btn mr-btn-primary" onClick={() => onSave(f)} data-testid="mr-info-save"><Save size={13} /> حفظ</button>
        </div>
      </div>
    </div>
  );
}

function HeadingModal({ initial, onSave, onCancel }) {
  const [title, setTitle] = React.useState(initial?.title || "");
  const [level, setLevel] = React.useState(initial?.level || 1);
  const inputRef = React.useRef(null);
  React.useEffect(() => { const t = setTimeout(() => inputRef.current?.focus(), 40); return () => clearTimeout(t); }, []);
  React.useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); onCancel(); }
      if (e.key === "Enter" && !e.shiftKey) { e.stopPropagation(); onSave(title, level); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [title, level, onSave, onCancel]);
  return (
    <div className="mr-shortcuts-panel" onClick={onCancel} data-testid="mr-heading-modal">
      <div className="mr-shortcuts-card mr-fade" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <h2 style={{ fontSize: 20 }}>{initial?.editingId ? "تعديل العنوان" : "إضافة عنوان"}<span style={{ fontSize: 13, color: "var(--amber)", marginInlineStart: 12 }}>الصفحة {initial?.page}</span></h2>
        <div className="mr-field">
          <label>نص العنوان</label>
          <input ref={inputRef} type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="مثلاً: الباب الأول - في التعريفات" data-testid="mr-heading-input"
            style={{ padding: "8px 10px", borderRadius: 6, background: "var(--ink-3)", color: "var(--parchment)", border: "1px solid var(--line)", fontFamily: "inherit", fontSize: 14, width: "100%" }} />
        </div>
        <div className="mr-field">
          <label>مستوى العنوان (1 = رئيسي، 2 = فرعي…)</label>
          <input type="number" min="1" max="4" value={level} onChange={(e) => setLevel(Math.max(1, Math.min(4, Number(e.target.value) || 1)))}
            style={{ padding: "6px 10px", borderRadius: 6, background: "var(--ink-3)", color: "var(--parchment)", border: "1px solid var(--line)", fontFamily: "inherit", fontSize: 14, width: 100 }} />
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
          <button className="mr-btn" onClick={onCancel}>إلغاء</button>
          <button className="mr-btn mr-btn-primary" onClick={() => onSave(title, level)} data-testid="mr-heading-save"><Save size={13} /> حفظ</button>
        </div>
      </div>
    </div>
  );
}

function CommentModal({ initial, onSave, onCancel }) {
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
      <div className="mr-shortcuts-card mr-fade" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
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

function SnipOverlay({ pageWrapRef, onCancel, onFinish }) {
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

function SnipPreview({ snip, onClose, onSave, onCopy }) {
  const canvasRef = React.useRef(null);
  const baseImgRef = React.useRef(null);
  const [tool, setTool] = React.useState(null); // 'highlight' | 'rect' | 'arrow' | 'text' | 'freehand'
  const [color, setColor] = React.useState("#e63946"); // default red
  const [opacity, setOpacity] = React.useState(0.55);
  const [strokeWidth, setStrokeWidth] = React.useState(4);
  const [fontSize, setFontSize] = React.useState(22);
  const [history, setHistory] = React.useState([]); // canvas snapshots
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

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
          <button className="mr-btn" onClick={onClose} data-testid="mr-snip-close">إغلاق</button>
          <button className="mr-btn" onClick={() => onCopy(exportDataUrl())} data-testid="mr-snip-copy">
            <Copy size={13} /> نسخ إلى الحافظة
          </button>
          <button className="mr-btn mr-btn-primary" onClick={() => onSave(exportDataUrl(), snip.filename)} data-testid="mr-snip-save">
            <Download size={13} /> حفظ PNG
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
  { desc: "إضافة تعليق على السطر الحالي", keys: ["Ctrl", "M"] },
  { desc: "التقاط لقطة من الصفحة", keys: ["Ctrl", "Shift", "S"] },
  { desc: "ملء الشاشة", keys: ["F11"] },
  { desc: "فتح/إغلاق نافذة الاختصارات", keys: ["؟"] },
  { desc: "إغلاق النوافذ", keys: ["Esc"] },
];
