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
  ChevronDown,
  Sliders,
  Play,
  Pause,
  Ruler,
  Camera,
} from "lucide-react";
import * as pdfjsLib from "pdfjs-dist/build/pdf.mjs";
import JSZip from "jszip";
import { buildDocFromFile, toggleSplitDoc, formatFolio, exportDocAsPdf } from "./manuscriptDoc";
import { PDFDocument } from "pdf-lib";

pdfjsLib.GlobalWorkerOptions.workerSrc = `${process.env.PUBLIC_URL || "."}/pdf.worker.min.mjs`;

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
const ZOOM_LEVELS = [0.1, 0.15, 0.2, 0.25, 0.35, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 6, 8, 10];

const DEFAULT_STATE = {
  fileName: "",
  fileKey: "",
  fileType: "", // 'image' | 'pdf' | 'zip'
  page: 1,
  zoomIdx: 7,  // index of 1.0 in ZOOM_LEVELS
  rotation: 0,
  rulerY: 100,
  rulerHeight: 32,
  rulerWidth: 100,        // % of page width (10-100)
  rulerAlign: "center",   // "start" | "center" | "end"
  rulerStep: 32,
  rulerColor: "#f2c14e",
  rulerOpacity: 0.42,
  rulerVisible: true,
  rulerShape: "band",     // "band" | "line" | "parallelogram"
  rulerTilt: 0,           // degrees -15..+15
  rulerAutoSpeed: 0,      // px/sec (0 = paused)
  rulerAutoPlaying: false,
  dimAlpha: 0.28,
  dimEnabled: true,
  brightness: 100,
  contrast: 100,
  saturate: 100,
  sharpen: 0,             // 0..100 (pixel-level unsharp mask)
  denoise: 0,             // 0..100 (box blur)
  invert: false,
  invertR: false,
  invertG: false,
  invertB: false,
  splitPages: false,
  splitFrom: 1,
  splitTo: 999,
  folioMode: true,
  folioStart: 1,
  folioOffset: 0,
  exportMaxSize: 4000,
  exportQuality: 95,
  exportFormat: "zip",
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

const RECENTS_KEY = "manuscriptRulerRecents.v1" + _NS_SUFFIX;
const AUTO_BM_KEY = "manuscriptRulerAutoBM.v1" + _NS_SUFFIX;
const PER_FILE_SETTINGS_KEY = "manuscriptRulerPerFileSettings.v1" + _NS_SUFFIX;

const EMPTY_INFO = {
  type: "single",     // "single" | "collection"
  number: "",         // manuscript number (auto from filename)
  library: "",        // library name (auto from filename if present)
  title: "",          // used in single mode
  author: "",         // used in single mode
  copyist: "",        // used in single mode
  copyDate: "",       // used in single mode
  titlesList: "",     // used in collection mode
  notes: "",          // both modes
};

// Parse filename → {library, number}
// If filename has a name + number pattern like "الأزهر 325425" or "Cairo 12/3",
// treat first non-digit token(s) as library and digit portion as number.
function parseFilenameForCard(nameNoExt) {
  const s = String(nameNoExt || "").trim();
  if (!s) return { library: "", number: "" };
  // Extract the last space-separated token that contains digits
  const tokens = s.split(/\s+/);
  if (tokens.length === 1) {
    // Only one token: if all-digits it's the number, else keep whole as number
    return { library: "", number: tokens[0] };
  }
  // Find token(s) that contain digits, from the end
  let numIdx = -1;
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (/\d/.test(tokens[i])) { numIdx = i; break; }
  }
  if (numIdx <= 0) {
    return { library: "", number: s };
  }
  const number = tokens.slice(numIdx).join(" ");
  const library = tokens.slice(0, numIdx).join(" ");
  return { library, number };
}

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
  const [showAbout, setShowAbout] = useState(false);
  const [tabs, setTabs] = useState([]);
  const [headingsMap, setHeadingsMap] = useState(() => loadKV(HEADINGS_KEY));
  const [foldOverridesMap, setFoldOverridesMap] = useState(() => loadKV(FOLD_OVERRIDES_KEY));
  // A stable ref that createSplittingDoc will read from at render-time, so slider
  // adjustments take effect without recreating the doc every keystroke.
  const foldOverridesForCurrentFileRef = useRef({});
  const [showHeadings, setShowHeadings] = useState(false);
  const [showThumbs, setShowThumbs] = useState(false);
  const [thumbUrls, setThumbUrls] = useState([]);
  // New: grouped-toolbar popover states
  const [openGroup, setOpenGroup] = useState(null); // 'open' | 'card' | 'browse' | 'number' | 'ruler' | 'comment' | 'export' | null
  const [numberStep, setNumberStep] = useState(1); // 1..3 wizard
  const [recentFiles, setRecentFiles] = useState(() => {
    try { return JSON.parse(localStorage.getItem(RECENTS_KEY) || "[]"); } catch { return []; }
  });
  const [thumbsDirection, setThumbsDirection] = useState("vertical"); // 'vertical' | 'horizontal'
  const [thumbsWidth, setThumbsWidth] = useState(() => {
    const v = Number(localStorage.getItem("mrThumbsWidth" + _NS_SUFFIX));
    return v > 80 && v < 800 ? v : 150;
  });
  const thumbsDragRef = useRef(null);
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
  const openAddHeadingRef = useRef(() => {});
  const snipRef = useRef(() => {});
  const renderPageRef = useRef(() => {});

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
    // Keep the "current file" ref in sync so createSplittingDoc reads latest overrides.
    foldOverridesForCurrentFileRef.current = foldOverridesMap[state.fileKey] || {};
  }, [foldOverridesMap, state.fileKey]);

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

      // Auto-fill library + number from filename when card is empty
      const nameNoExt = file.name.replace(/\.[^.]+$/, "");
      const parsed = parseFilenameForCard(nameNoExt);
      setInfoMap((m) => {
        if (m[fileKey] && (m[fileKey].number || m[fileKey].library)) return m;
        return {
          ...m,
          [fileKey]: {
            ...EMPTY_INFO,
            ...(m[fileKey] || {}),
            number: parsed.number,
            library: parsed.library,
          },
        };
      });

      // Update recents (last 5 fileKeys → names + path if available)
      try {
        const raw = localStorage.getItem(RECENTS_KEY);
        const recents = raw ? JSON.parse(raw) : [];
        const filtered = recents.filter((r) => r.fileKey !== fileKey);
        // Electron 32+: File.path removed; use webUtils via preload.
        // Browser: file paths are not exposed for security reasons.
        let filePath = "";
        try {
          if (window.msElectron?.getFilePath) filePath = window.msElectron.getFilePath(file) || "";
        } catch {}
        if (!filePath) filePath = file.path || file.webkitRelativePath || "";
        const next = [{ fileKey, name: file.name, path: filePath, at: Date.now() }, ...filtered].slice(0, 5);
        localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
      } catch { /* noop */ }

      // Restore auto-bookmark if exists
      let restoredPage = 1;
      let restoredY = 0;
      try {
        const raw = localStorage.getItem(AUTO_BM_KEY);
        if (raw) {
          const map = JSON.parse(raw);
          if (map[fileKey]) {
            restoredPage = Math.min(wrapped.numPages, Math.max(1, map[fileKey].page || 1));
            restoredY = map[fileKey].y || 0;
          }
        }
      } catch { /* noop */ }

      // Restore per-file image/browse settings if exists
      let restoredSettings = null;
      try {
        const raw = localStorage.getItem(PER_FILE_SETTINGS_KEY);
        if (raw) {
          const map = JSON.parse(raw);
          restoredSettings = map[fileKey] || null;
        }
      } catch { /* noop */ }

      // Add/update tab
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.fileKey === fileKey);
        const tabObj = { fileName: file.name, fileKey, baseDoc: baseD, doc: wrapped, pageCount: wrapped.numPages, page: restoredPage, rulerY: restoredY, splitPages: false, splitFrom: 1, splitTo: baseD.numPages };
        if (idx >= 0) {
          const copy = [...prev];
          copy[idx] = tabObj;
          return copy;
        }
        return [...prev, tabObj];
      });

      setState((s) => ({ ...s, ...(restoredSettings || {}), fileName: file.name, fileKey, fileType: ft, page: restoredPage, rulerY: restoredY, splitPages: false, splitFrom: 1, splitTo: baseD.numPages }));
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
        // Apply pixel-level filters: RGB channel inverts + sharpen + denoise
        try {
          const st = stateRef.current;
          const needsChannelInvert = st.invertR || st.invertG || st.invertB;
          const needsSharpen = (st.sharpen || 0) > 0;
          const needsDenoise = (st.denoise || 0) > 0;
          if (needsChannelInvert || needsSharpen || needsDenoise) {
            const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const d = imgData.data;
            if (needsChannelInvert) {
              for (let i = 0; i < d.length; i += 4) {
                if (st.invertR) d[i] = 255 - d[i];
                if (st.invertG) d[i + 1] = 255 - d[i + 1];
                if (st.invertB) d[i + 2] = 255 - d[i + 2];
              }
            }
            if (needsDenoise) {
              // Simple 3x3 box blur, strength scaled 0..1
              const strength = st.denoise / 100;
              boxBlur3x3(d, canvas.width, canvas.height, strength);
            }
            if (needsSharpen) {
              // 3x3 unsharp mask kernel, strength 0..1
              const strength = st.sharpen / 100;
              sharpen3x3(d, canvas.width, canvas.height, strength);
            }
            ctx.putImageData(imgData, 0, 0);
          }
        } catch (err) { /* ignore filter errors */ }
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
    renderPageRef.current = renderPage;
  }, [doc, state.page, state.rotation, state.zoomIdx, state.invertR, state.invertG, state.invertB, state.sharpen, state.denoise, renderPage]);

  // Thumbs strip drag-resize
  useEffect(() => {
    const onMove = (e) => {
      if (!thumbsDragRef.current) return;
      const isRtl = getComputedStyle(document.body).direction === "rtl";
      const dx = e.clientX - thumbsDragRef.current.startX;
      // in RTL, moving mouse LEFT expands the right-side strip. But our strip is at inset-inline-start (RTL: right).
      // So dragging left (dx negative) means EXPAND. Compute accordingly.
      const delta = isRtl ? -dx : dx;
      const next = Math.min(600, Math.max(90, thumbsDragRef.current.startW + delta));
      setThumbsWidth(next);
    };
    const onUp = () => {
      if (thumbsDragRef.current) {
        try { localStorage.setItem("mrThumbsWidth" + _NS_SUFFIX, String(thumbsWidth)); } catch {}
      }
      thumbsDragRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [thumbsWidth]);

  // Save current image/browse/ruler settings per file so they restore next time
  useEffect(() => {
    if (!state.fileKey) return;
    const perFileKeys = [
      "brightness", "contrast", "saturate", "sharpen", "denoise",
      "invert", "invertR", "invertG", "invertB",
      "zoomIdx", "rotation",
      "rulerHeight", "rulerWidth", "rulerAlign", "rulerColor", "rulerOpacity", "rulerShape", "rulerTilt", "dimAlpha", "dimEnabled",
      "folioMode", "folioStart", "folioOffset",
    ];
    try {
      const raw = localStorage.getItem(PER_FILE_SETTINGS_KEY);
      const map = raw ? JSON.parse(raw) : {};
      const patch = {};
      for (const k of perFileKeys) patch[k] = state[k];
      map[state.fileKey] = patch;
      localStorage.setItem(PER_FILE_SETTINGS_KEY, JSON.stringify(map));
    } catch { /* noop */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    state.fileKey, state.brightness, state.contrast, state.saturate, state.sharpen, state.denoise,
    state.invert, state.invertR, state.invertG, state.invertB,
    state.zoomIdx, state.rotation,
    state.rulerHeight, state.rulerWidth, state.rulerAlign, state.rulerColor, state.rulerOpacity,
    state.rulerShape, state.rulerTilt, state.dimAlpha, state.dimEnabled,
    state.folioMode, state.folioStart, state.folioOffset,
  ]);

  useEffect(() => {
    const persist = () => {
      if (!state.fileKey) return;
      try {
        const raw = localStorage.getItem(AUTO_BM_KEY);
        const map = raw ? JSON.parse(raw) : {};
        map[state.fileKey] = { page: state.page, y: state.rulerY, at: Date.now() };
        localStorage.setItem(AUTO_BM_KEY, JSON.stringify(map));
      } catch { /* noop */ }
    };
    window.addEventListener("beforeunload", persist);
    window.addEventListener("pagehide", persist);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") persist();
    });
    return () => {
      window.removeEventListener("beforeunload", persist);
      window.removeEventListener("pagehide", persist);
    };
  }, [state.fileKey, state.page, state.rulerY]);

  // Auto-activate hand tool when zoomed to ≥100%
  useEffect(() => {
    if (scale >= 1 && !handTool) {
      setHandTool(true);
    } else if (scale < 1 && handTool) {
      setHandTool(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale]);

  // Auto-hide grouped popovers when ruler auto-scroll is playing
  useEffect(() => {
    if (state.rulerAutoPlaying) setOpenGroup(null);
  }, [state.rulerAutoPlaying]);

  // Refresh recents whenever storage changes locally
  useEffect(() => {
    try { setRecentFiles(JSON.parse(localStorage.getItem(RECENTS_KEY) || "[]")); } catch { /* noop */ }
  }, [state.fileKey]);

  // Ruler auto-scroll effect
  useEffect(() => {
    if (!state.rulerAutoPlaying || !hasFile) return;
    let raf;
    let last = performance.now();
    const tick = (now) => {
      const dt = (now - last) / 1000;
      last = now;
      setState((s) => {
        if (!s.rulerAutoSpeed) return s; // paused via speed=0
        const maxY = Math.max(0, pageSizeRef.current.h - s.rulerHeight);
        const nextY = s.rulerY + s.rulerAutoSpeed * dt;
        if (maxY <= 0) return s; // page not measured yet
        if (nextY >= maxY) {
          if (s.page < pageCount) {
            return { ...s, page: s.page + 1, rulerY: 0 };
          }
          return { ...s, rulerAutoPlaying: false };
        }
        return { ...s, rulerY: nextY };
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.rulerAutoPlaying, hasFile, pageCount]);

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

  // Hand-tool + drag-select overlay state
  const [handTool, setHandTool] = useState(false);
  const [selectMode, setSelectMode] = useState(null); // 'comment' | 'heading' | null
  const [selectingRect, setSelectingRect] = useState(null); // current drag rect (px)
  const [activeBubbleId, setActiveBubbleId] = useState(null);
  const [activeHeadingId, setActiveHeadingId] = useState(null);
  const panDragRef = useRef(null);
  const selectDragRef = useRef(null);

  const onPageMouseDown = (e) => {
    if (e.target.closest("[data-ruler]")) return;
    if (e.target.closest("[data-bubble]") || e.target.closest("[data-heading-rect]")) return;
    if (selectMode && pageWrapRef.current) {
      e.preventDefault();
      const rect = pageWrapRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      selectDragRef.current = { startX: x, startY: y };
      setSelectingRect({ x, y, w: 0, h: 0 });
      return;
    }
    if (handTool && scrollRef.current) {
      e.preventDefault();
      panDragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        scrollL: scrollRef.current.scrollLeft,
        scrollT: scrollRef.current.scrollTop,
      };
    }
  };

  useEffect(() => {
    const onMove = (e) => {
      if (selectDragRef.current && pageWrapRef.current) {
        const rect = pageWrapRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const sx = selectDragRef.current.startX;
        const sy = selectDragRef.current.startY;
        setSelectingRect({
          x: Math.min(sx, x),
          y: Math.min(sy, y),
          w: Math.abs(x - sx),
          h: Math.abs(y - sy),
        });
        return;
      }
      if (!panDragRef.current || !scrollRef.current) return;
      const dx = e.clientX - panDragRef.current.startX;
      const dy = e.clientY - panDragRef.current.startY;
      scrollRef.current.scrollLeft = panDragRef.current.scrollL - dx;
      scrollRef.current.scrollTop = panDragRef.current.scrollT - dy;
    };
    const onUp = () => {
      panDragRef.current = null;
      if (selectDragRef.current && selectingRect && pageWrapRef.current) {
        const rect = pageWrapRef.current.getBoundingClientRect();
        const r = selectingRect;
        selectDragRef.current = null;
        // require a minimum size to avoid accidental single-clicks
        if (r.w > 12 && r.h > 12) {
          const norm = {
            x: r.x / rect.width,
            y: r.y / rect.height,
            w: r.w / rect.width,
            h: r.h / rect.height,
          };
          if (selectMode === "comment") {
            setCommentModal({ editingId: null, page: state.page, text: "", bubble: true, rect: norm });
          } else if (selectMode === "heading") {
            setHeadingModal({ editingId: null, page: state.page, title: "", level: 1, rect: norm });
          }
        }
        setSelectingRect(null);
        setSelectMode(null);
      } else if (selectDragRef.current) {
        selectDragRef.current = null;
        setSelectingRect(null);
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [selectMode, selectingRect, state.page]);

  const onPageClick = (e) => {
    if (!pageWrapRef.current) return;
    // if we just finished a drag selection, don't move the ruler
    if (selectingRect || selectMode) {
      setOpenGroup(null);
      return;
    }
    setOpenGroup(null);
    if (e.target.closest("[data-ruler]")) return;
    if (e.target.closest("[data-bubble]") || e.target.closest("[data-heading-rect]")) return;
    if (handTool) return;
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
      const wrapped = toggleSplitDoc(baseDoc, next, range, foldOverridesForCurrentFileRef);
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
      const wrapped = toggleSplitDoc(baseDoc, true, range, foldOverridesForCurrentFileRef);
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

  const _fallbackCopy = async (text) => {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand && document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch { return false; }
  };

  const _safeCopyText = async (text) => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch { /* fallback below */ }
    return _fallbackCopy(text);
  };

  const copyInfoAsTable = async () => {
    const info = currentInfo;
    const rows = [];
    rows.push(["رقم النسخة", info.number]);
    rows.push(["المكتبة", info.library]);
    if ((info.type || "single") === "single") {
      rows.push(["عنوان المخطوط", info.title]);
      rows.push(["المؤلف", info.author]);
      rows.push(["الناسخ", info.copyist]);
      rows.push(["تاريخ النسخ", info.copyDate]);
    } else {
      rows.push(["نوع المخطوط", "مجموع"]);
      if (info.titlesList) rows.push(["عناوين المجموع", info.titlesList]);
    }
    if (info.notes) rows.push(["ملاحظات ووصف", info.notes]);
    const filtered = rows.filter(([, v]) => v && String(v).trim());
    if (filtered.length === 0) {
      showToast("لا توجد بيانات لنسخها. عبّئ البطاقة أولاً.");
      return;
    }
    const tsv = filtered.map(([k, v]) => `${k}\t${String(v).replace(/\n/g, " ")}`).join("\n");
    // Try rich HTML copy first for Word/Excel; fall back to plain text
    try {
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        const html = `<table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse;direction:rtl">${
          filtered.map(([k, v]) => `<tr><td><b>${escapeHtml(k)}</b></td><td>${escapeHtml(v).replace(/\n/g,"<br>")}</td></tr>`).join("")
        }</table>`;
        await navigator.clipboard.write([new ClipboardItem({
          "text/plain": new Blob([tsv], { type: "text/plain" }),
          "text/html": new Blob([html], { type: "text/html" }),
        })]);
        showToast("نُسخت البطاقة كجدول");
        return;
      }
    } catch { /* fall through to plain-text */ }
    const ok = await _safeCopyText(tsv);
    showToast(ok ? "نُسخت البطاقة (نص عادي)" : "تعذّر النسخ إلى الحافظة");
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
    setSelectMode("heading");
    setOpenGroup(null);
    showToast("اسحب مربعاً أزرق حول عنوان لتحديده");
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
      const newH = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, page: headingModal.page, title: t, level, rect: headingModal.rect };
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
  const exportCroppedPdf = async () => {
    if (!doc) return;
    setLoading(true);
    setLoadingMsg("تصدير المخطوط المقصوص… قد يستغرق وقتاً");
    try {
      const { PDFDocument } = await import("pdf-lib");
      const pdfDoc = await PDFDocument.create();
      const quality = 0.95;
      const maxSize = 4000;
      for (let i = 1; i <= pageCount; i++) {
        setLoadingMsg(`صفحة ${i} / ${pageCount}…`);
        const page = await doc.getPage(i);
        const vp = page.getViewport({ scale: 1, rotation: 0 });
        const targetScale = Math.min(2, maxSize / Math.max(vp.width, vp.height));
        const rvp = page.getViewport({ scale: targetScale, rotation: 0 });
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(rvp.width);
        canvas.height = Math.floor(rvp.height);
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport: rvp }).promise;
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        const bytes = Uint8Array.from(atob(dataUrl.split(",")[1]), (c) => c.charCodeAt(0));
        const img = await pdfDoc.embedJpg(bytes);
        const pg = pdfDoc.addPage([img.width, img.height]);
        pg.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
      }
      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([pdfBytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const base = (state.fileName || "manuscript").replace(/\.[^.]+$/, "").replace(/[/\\?%*:|"<>]/g, "-");
      a.download = `${base} - مقصوص.pdf`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 8000);
      showToast(`تم تصدير المخطوط المقصوص (${pageCount} صفحة)`);
    } catch (e) {
      console.error(e);
      showToast("تعذّر تصدير PDF");
    } finally {
      setLoading(false);
      setLoadingMsg("");
    }
  };

  const exportAsIndexedPdf = async () => {
    if (!doc) return;
    setLoading(true);
    setLoadingMsg("جارٍ إنشاء PDF مفهرس…");
    try {
      const { PDFDocument, PDFName, PDFDict, PDFArray, PDFRef, PDFHexString, PDFString } = await import("pdf-lib");
      const pdfDoc = await PDFDocument.create();
      const quality = 0.95; // high JPEG quality — preserve source resolution as much as possible
      const maxSize = 4000; // allow up to 4000px longest side (was capped too aggressively)
      const pageRefs = [];
      for (let i = 1; i <= pageCount; i++) {
        setLoadingMsg(`تجهيز صفحة ${i} / ${pageCount}…`);
        const page = await doc.getPage(i);
        const vp = page.getViewport({ scale: 1, rotation: 0 });
        // Use the ORIGINAL resolution up to 4000px (no downscaling for typical manuscript scans)
        const targetScale = Math.min(2, maxSize / Math.max(vp.width, vp.height));
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
    const ok = await _safeCopyText(citation);
    showToast(ok ? "نُسخ العزو: " + citation : "تعذّر النسخ إلى الحافظة");
  };

  // ---------------- Comments ----------------
  const currentComments = state.fileKey ? (commentsMap[state.fileKey] || []) : [];

  const openAddComment = () => {
    if (!state.fileKey) return;
    setSelectMode("comment");
    setOpenGroup(null);
    showToast("اسحب مربعاً أصفر حول الكلمة أو الفقرة لوضع تعليق");
  };

  const openEditComment = (c) => {
    const folio = c.folio || formatFolio(c.page, { startFolio: state.folioStart, offset: state.folioOffset });
    setCommentModal({
      editingId: c.id,
      page: c.page,
      folio,
      line: c.line || 1,
      y: c.y,
      x: c.x,
      bubble: c.x != null,
      text: c.text,
    });
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
    const folio = commentModal.folio || formatFolio(commentModal.page, { startFolio: state.folioStart, offset: state.folioOffset });
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
        folio,
        line: commentModal.line,
        y: commentModal.y,
        x: commentModal.x, // legacy: single-point bubble
        rect: commentModal.rect, // new: highlight rectangle {x, y, w, h} as ratios
        text: t,
        createdAt: new Date().toISOString(),
      };
      return { ...m, [state.fileKey]: [...list, newComment] };
    });
    setCommentModal(null);
    showToast(commentModal.editingId ? "تم تعديل التعليق" : "أُضيف التعليق");
  };

  const copyCommentCitation = async (c) => {
    const info = currentInfo;
    const parts = [];
    if (info.library) parts.push(info.library);
    if (info.number) parts.push(info.number);
    parts.push(`ورقة ${c.folio || formatFolio(c.page, { startFolio: state.folioStart, offset: state.folioOffset })}`);
    const citation = `(${parts.join(" ")})`;
    const full = `${c.text}\n\n${citation}`;
    const ok = await _safeCopyText(full);
    showToast(ok ? "نُسخ التعليق مع العزو" : "تعذّر النسخ إلى الحافظة");
  };

  const deleteComment = (id) => {
    setCommentsMap((m) => ({
      ...m,
      [state.fileKey]: (m[state.fileKey] || []).filter((c) => c.id !== id),
    }));
  };

  const goToComment = (c) => {
    setState((s) => ({ ...s, page: c.page, rulerY: c.y != null ? c.y : s.rulerY }));
    setShowComments(false);
    if (c.x != null) setActiveBubbleId(c.id);
  };

  const exportHeadingsAsWord = () => {
    if (!currentHeadings.length) {
      showToast("لا توجد عناوين لتصديرها");
      return;
    }
    const info = currentInfo;
    const sorted = [...currentHeadings].sort((a, b) => a.page - b.page);
    const rows = sorted.map((h, i) => {
      const folio = formatFolio(h.page, { startFolio: state.folioStart, offset: state.folioOffset });
      const indent = "&nbsp;".repeat((h.level - 1) * 4);
      return `<tr><td>${i + 1}</td><td>${escapeHtml(folio)}</td><td>${indent}${escapeHtml(h.title)}</td><td>${h.level}</td></tr>`;
    }).join("\n");
    const html = `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8" />
<title>عناوين المخطوط - ${escapeHtml(info.title || state.fileName || "بدون عنوان")}</title>
<style>body{font-family:'Traditional Arabic','Amiri','Noto Naskh Arabic',serif;font-size:14pt;line-height:1.8;padding:30px}h1{font-size:22pt;border-bottom:2px solid #333;padding-bottom:10px}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border:1px solid #999;padding:8px 10px;text-align:right}th{background:#eee}</style></head>
<body><h1>عناوين المخطوط</h1>
<p><b>المكتبة:</b> ${escapeHtml(info.library || "-")} — <b>رقم النسخة:</b> ${escapeHtml(info.number || "-")}</p>
${info.title ? `<p><b>العنوان:</b> ${escapeHtml(info.title)}</p>` : ""}
<table><thead><tr><th>#</th><th>الورقة</th><th>العنوان</th><th>المستوى</th></tr></thead><tbody>${rows}</tbody></table>
</body></html>`;
    const blob = new Blob(["\ufeff" + html], { type: "application/msword;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const base = (info.title || state.fileName || "manuscript").replace(/\.[^.]+$/, "").replace(/[/\\?%*:|"<>]/g, "-");
    a.download = `${base}-عناوين.doc`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    showToast("تم تصدير العناوين");
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

  // ---------------- Keyboard navigation (ruler + pages) ----------------
  useEffect(() => {
    const onKey = (e) => {
      // ignore typing in inputs
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      if (e.key === "Escape") {
        setSelectMode((m) => (m ? null : m));
        setSelectingRect(null);
        setActiveBubbleId(null);
        setActiveHeadingId(null);
        setShowSettings(false);
        setOpenGroup(null);
        return;
      }
      // Space toggles ruler auto-scroll
      if ((e.code === "Space" || e.key === " ") && hasFileRef.current) {
        e.preventDefault();
        setState((s) => {
          const next = !s.rulerAutoPlaying;
          const speed = next && !s.rulerAutoSpeed ? 20 : s.rulerAutoSpeed;
          return { ...s, rulerAutoPlaying: next, rulerAutoSpeed: speed };
        });
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
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.rulerStep, state.fileType, pageCount]);

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
    openAddHeadingRef.current = openAddHeading;
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

      <div className="mr-topbar mr-topbar-v2" data-testid="mr-topbar">
        <div className="mr-brand">
          <img src={`${process.env.PUBLIC_URL || "."}/app-icon.png`} alt="M" className="mr-brand-mark" />
          <div className="mr-brand-name">متصفح المخطوطات</div>
        </div>

        {/* 1. فتح المخطوط */}
        <div className="mr-group">
          <button
            className="mr-gbtn mr-gbtn-primary"
            onClick={openFile}
            data-testid="mr-btn-open"
            title="فتح ملف"
          >
            <FolderOpen size={22} />
            <span>فتح مخطوط</span>
          </button>
          <button
            className="mr-gbtn-arrow"
            onClick={() => setOpenGroup(openGroup === "open" ? null : "open")}
            title="آخر المخطوطات المفتوحة"
            data-testid="mr-btn-open-arrow"
          >
            <ChevronDown size={14} />
          </button>
          {openGroup === "open" && (
            <div className="mr-popover" data-testid="mr-pop-open">
              <button className="mr-pop-x" onClick={() => setOpenGroup(null)} data-testid="mr-pop-open-close" title="إغلاق"><X size={14} /></button>
              <div className="mr-pop-title">آخر المخطوطات ({recentFiles.length}):</div>
              {recentFiles.length === 0 && <div className="mr-pop-empty">لا توجد ملفات سابقة</div>}
              {recentFiles.slice(0, 5).map((r) => (
                <div key={r.fileKey} className="mr-pop-item mr-pop-item-recent" data-testid="mr-pop-recent">
                  <FileText size={13} />
                  <div style={{ display: "flex", flexDirection: "column", overflow: "hidden", flex: 1 }}>
                    <span title={r.name} style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</span>
                    {r.path && (
                      <span
                        title={r.path}
                        style={{ fontSize: 10, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", direction: "ltr", textAlign: "start" }}
                      >
                        📁 {r.path}
                      </span>
                    )}
                  </div>
                </div>
              ))}
              <div className="mr-pop-hint">
                {window.msElectron
                  ? "أسماء الملفات مع مساراتها الكاملة تظهر هنا لتذكيرك بموقعها."
                  : "أسماء الملفات السابقة تظهر هنا للتذكير. لأسباب أمنية في المتصفح، لا يستطيع البرنامج معرفة المسار الكامل — استعمل نسخة سطح المكتب لعرض المسار."}
              </div>
            </div>
          )}
        </div>

        {/* 2. بطاقة المخطوط */}
        <div className="mr-group">
          <button
            className={`mr-gbtn ${showInfoCard ? "mr-gbtn-active" : ""}`}
            onClick={() => hasFile && setShowInfoCard((v) => !v)}
            disabled={!hasFile}
            title="إظهار/إخفاء بطاقة المخطوط"
            data-testid="mr-btn-info"
          >
            <BookOpen size={22} />
            <span>البطاقة</span>
          </button>
          <button
            className="mr-gbtn-arrow"
            onClick={() => hasFile && setOpenGroup(openGroup === "card" ? null : "card")}
            disabled={!hasFile}
            data-testid="mr-btn-card-arrow"
          >
            <ChevronDown size={14} />
          </button>
          {openGroup === "card" && (
            <div className="mr-popover" data-testid="mr-pop-card">
              <button className="mr-pop-x" onClick={() => setOpenGroup(null)} title="إغلاق"><X size={14} /></button>
              <button className="mr-pop-item" onClick={() => { setShowInfoEditor(true); setOpenGroup(null); }} data-testid="mr-pop-card-edit">
                <Edit3 size={13} /> تحرير البطاقة
              </button>
              <button className="mr-pop-item" onClick={() => { copyInfoAsTable(); setOpenGroup(null); }} data-testid="mr-pop-card-copy">
                <Copy size={13} /> نسخ البطاقة كجدول
              </button>
              <button className="mr-pop-item" onClick={() => { setShowInfoCard((v) => !v); setOpenGroup(null); }}>
                <Eye size={13} /> {showInfoCard ? "إخفاء البطاقة" : "إظهار البطاقة"}
              </button>
            </div>
          )}
        </div>

        {/* 3. تصفح المخطوط */}
        <div className="mr-group">
          <button
            className="mr-gbtn"
            onClick={() => hasFile && setOpenGroup(openGroup === "browse" ? null : "browse")}
            disabled={!hasFile}
            data-testid="mr-btn-browse"
            title="أدوات تصفح المخطوط (تكبير/تدوير/فلاتر)"
          >
            <Eye size={22} />
            <span>تصفح</span>
            <ChevronDown size={12} />
          </button>
          {openGroup === "browse" && (
            <div className="mr-popover mr-popover-wide" data-testid="mr-pop-browse">
              <button className="mr-pop-x" onClick={() => setOpenGroup(null)} title="إغلاق"><X size={14} /></button>
              <div className="mr-pop-title">التكبير: {Math.round(scale * 100)}%</div>
              <div className="mr-pop-row">
                <button className="mr-btn" onClick={zoomOut} data-testid="mr-btn-zoom-out"><ZoomOut size={14} /> تصغير</button>
                <button className="mr-btn" onClick={zoomIn} data-testid="mr-btn-zoom-in"><ZoomIn size={14} /> تكبير</button>
                <button className="mr-btn" onClick={rotate} data-testid="mr-btn-rotate"><RotateCw size={14} /> تدوير</button>
              </div>
              <div className="mr-pop-row">
                <button
                  className={`mr-btn ${handTool ? "mr-btn-active" : ""}`}
                  onClick={() => setHandTool((v) => !v)}
                  data-testid="mr-btn-hand"
                  title="أداة اليد: اسحب المخطوط للتنقل عند التكبير"
                  style={{ flex: 1, justifyContent: "center" }}
                >
                  ✋ {handTool ? "أوقف أداة اليد" : "أداة اليد (للتنقل)"}
                </button>
              </div>
              <div className="mr-pop-title">فلاتر الصورة:</div>
              <div className="mr-field">
                <label>السطوع <span className="val">{state.brightness}%</span></label>
                <input type="range" min="30" max="220" value={state.brightness}
                  onChange={(e) => setState((s) => ({ ...s, brightness: Number(e.target.value) }))} data-testid="mr-set-brightness" />
              </div>
              <div className="mr-field">
                <label>التباين <span className="val">{state.contrast}%</span></label>
                <input type="range" min="30" max="280" value={state.contrast}
                  onChange={(e) => setState((s) => ({ ...s, contrast: Number(e.target.value) }))} data-testid="mr-set-contrast" />
              </div>
              <div className="mr-field">
                <label>الإشباع <span className="val">{state.saturate}%</span></label>
                <input type="range" min="0" max="300" value={state.saturate}
                  onChange={(e) => setState((s) => ({ ...s, saturate: Number(e.target.value) }))} data-testid="mr-set-saturate" />
              </div>
              <div className="mr-field">
                <label>الحدة (Sharpen) <span className="val">{state.sharpen}%</span></label>
                <input type="range" min="0" max="100" value={state.sharpen}
                  onChange={(e) => setState((s) => ({ ...s, sharpen: Number(e.target.value) }))} data-testid="mr-set-sharpen" />
              </div>
              <div className="mr-field">
                <label>إزالة التشويش <span className="val">{state.denoise}%</span></label>
                <input type="range" min="0" max="100" value={state.denoise}
                  onChange={(e) => setState((s) => ({ ...s, denoise: Number(e.target.value) }))} data-testid="mr-set-denoise" />
              </div>
              <div className="mr-pop-title">عكس الألوان:</div>
              <div className="mr-pop-row">
                <button className={`mr-btn ${state.invert ? "mr-btn-active" : ""}`} onClick={() => setState((s) => ({ ...s, invert: !s.invert }))} data-testid="mr-set-invert">
                  <SunMedium size={12} /> نيجاتيف كامل
                </button>
                <button className={`mr-btn ${state.invertR ? "mr-btn-active" : ""}`} onClick={() => setState((s) => ({ ...s, invertR: !s.invertR }))} data-testid="mr-set-invert-r" style={{color: state.invertR ? "#ff6b6b" : undefined}}>R</button>
                <button className={`mr-btn ${state.invertG ? "mr-btn-active" : ""}`} onClick={() => setState((s) => ({ ...s, invertG: !s.invertG }))} data-testid="mr-set-invert-g" style={{color: state.invertG ? "#5cff8f" : undefined}}>G</button>
                <button className={`mr-btn ${state.invertB ? "mr-btn-active" : ""}`} onClick={() => setState((s) => ({ ...s, invertB: !s.invertB }))} data-testid="mr-set-invert-b" style={{color: state.invertB ? "#6ba8ff" : undefined}}>B</button>
              </div>
            </div>
          )}
        </div>

        {/* 4. ترقيم المخطوط */}
        <div className="mr-group">
          <button
            className={`mr-gbtn ${state.splitPages ? "mr-gbtn-active" : ""}`}
            onClick={() => { if (!hasFile) return; setShowFolioSettings(true); setNumberStep(1); setOpenGroup(null); }}
            disabled={!hasFile}
            data-testid="mr-btn-number"
            title="تقسيم الصفحات وترقيم الأوراق (أ/ب)"
          >
            <Hash size={22} />
            <span>ترقيم</span>
          </button>
        </div>

        {/* 5. مقابلة المخطوط (المسطرة) */}
        <div className="mr-group">
          <button
            className={`mr-gbtn ${state.rulerVisible ? "mr-gbtn-active" : ""}`}
            onClick={() => hasFile && toggleRuler()}
            disabled={!hasFile}
            data-testid="mr-btn-toggle-ruler"
            title="إظهار/إخفاء المسطرة (H)"
          >
            <Ruler size={22} />
            <span>مقابلة</span>
          </button>
          <button
            className="mr-gbtn-arrow"
            onClick={() => hasFile && setOpenGroup(openGroup === "ruler" ? null : "ruler")}
            disabled={!hasFile}
            data-testid="mr-btn-ruler-arrow"
          >
            <ChevronDown size={14} />
          </button>
          {openGroup === "ruler" && (
            <div className="mr-popover mr-popover-wide" data-testid="mr-pop-ruler">
              <button className="mr-pop-x" onClick={() => setOpenGroup(null)} title="إغلاق"><X size={14} /></button>
              <div className="mr-pop-title">شكل المسطرة:</div>
              <div className="mr-pop-row">
                {[
                  { v: "band", lbl: "شريط" },
                  { v: "line", lbl: "خط" },
                  { v: "parallelogram", lbl: "متوازي" },
                ].map((sh) => (
                  <button key={sh.v}
                    className={`mr-btn ${state.rulerShape === sh.v ? "mr-btn-active" : ""}`}
                    onClick={() => setState((s) => ({ ...s, rulerShape: sh.v }))}
                    data-testid={`mr-ruler-shape-${sh.v}`}>
                    {sh.lbl}
                  </button>
                ))}
              </div>
              <div className="mr-field">
                <label>ارتفاع المسطرة <span className="val">{state.rulerHeight}px</span></label>
                <input type="range" min="4" max="200" value={state.rulerHeight}
                  onChange={(e) => setState((s) => ({ ...s, rulerHeight: Number(e.target.value) }))} data-testid="mr-set-height" />
              </div>
              <div className="mr-field">
                <label>عرض المسطرة <span className="val">{state.rulerWidth}%</span></label>
                <input type="range" min="10" max="100" value={state.rulerWidth}
                  onChange={(e) => setState((s) => ({ ...s, rulerWidth: Number(e.target.value) }))} data-testid="mr-set-width" />
              </div>
              <div className="mr-field">
                <label>محاذاة المسطرة</label>
                <div className="mr-pop-row">
                  {[
                    { v: "start", lbl: "يمين" },
                    { v: "center", lbl: "وسط" },
                    { v: "end", lbl: "يسار" },
                  ].map((a) => (
                    <button key={a.v}
                      className={`mr-btn ${state.rulerAlign === a.v ? "mr-btn-active" : ""}`}
                      onClick={() => setState((s) => ({ ...s, rulerAlign: a.v }))}
                      data-testid={`mr-ruler-align-${a.v}`}>{a.lbl}</button>
                  ))}
                </div>
              </div>
              <div className="mr-field">
                <label>زاوية الميلان <span className="val">{state.rulerTilt}°</span></label>
                <input type="range" min="-15" max="15" step="0.5" value={state.rulerTilt}
                  onChange={(e) => setState((s) => ({ ...s, rulerTilt: Number(e.target.value) }))} data-testid="mr-set-tilt" />
              </div>
              <div className="mr-field">
                <label>لون المسطرة <span className="val">{state.rulerColor}</span></label>
                <input type="color" value={state.rulerColor}
                  onChange={(e) => setState((s) => ({ ...s, rulerColor: e.target.value }))} data-testid="mr-set-color" />
              </div>
              <div className="mr-field">
                <label>شفافية المسطرة <span className="val">{Math.round(state.rulerOpacity * 100)}%</span></label>
                <input type="range" min="10" max="90" value={Math.round(state.rulerOpacity * 100)}
                  onChange={(e) => setState((s) => ({ ...s, rulerOpacity: Number(e.target.value) / 100 }))} data-testid="mr-set-opacity" />
              </div>
              <div className="mr-field">
                <label>تعتيم ما حول السطر <span className="val">{Math.round(state.dimAlpha * 100)}%</span></label>
                <input type="range" min="0" max="80" value={Math.round(state.dimAlpha * 100)}
                  onChange={(e) => setState((s) => ({ ...s, dimAlpha: Number(e.target.value) / 100, dimEnabled: Number(e.target.value) > 0 }))} data-testid="mr-set-dim" />
              </div>
              <div className="mr-pop-title">التمرير التلقائي:</div>
              <div className="mr-field">
                <label>السرعة <span className="val">{state.rulerAutoSpeed} px/ث</span></label>
                <input type="range" min="0" max="120" step="1" value={state.rulerAutoSpeed}
                  onChange={(e) => setState((s) => ({ ...s, rulerAutoSpeed: Number(e.target.value) }))} data-testid="mr-set-auto-speed" />
              </div>
              <div className="mr-pop-row">
                <button
                  className={`mr-btn mr-btn-primary`}
                  onClick={() => setState((s) => {
                    const next = !s.rulerAutoPlaying;
                    // If turning on and speed is 0, seed a sensible default
                    const speed = next && !s.rulerAutoSpeed ? 20 : s.rulerAutoSpeed;
                    return { ...s, rulerAutoPlaying: next, rulerAutoSpeed: speed };
                  })}
                  data-testid="mr-btn-auto-toggle">
                  {state.rulerAutoPlaying ? <><Pause size={14} /> إيقاف</> : <><Play size={14} /> تشغيل</>}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 6. التعليق على المخطوط */}
        <div className="mr-group">
          <button
            className="mr-gbtn"
            onClick={() => hasFile && setOpenGroup(openGroup === "comment" ? null : "comment")}
            disabled={!hasFile}
            data-testid="mr-btn-comment"
            title="التعليقات والعناوين"
          >
            <MessagesSquare size={22} />
            <span>تعليق</span>
            {(currentComments.length + currentHeadings.length) > 0 && (
              <span className="mr-badge">{currentComments.length + currentHeadings.length}</span>
            )}
          </button>
          {openGroup === "comment" && (
            <div className="mr-popover" data-testid="mr-pop-comment">
              <button className="mr-pop-x" onClick={() => setOpenGroup(null)} title="إغلاق"><X size={14} /></button>
              <button className="mr-pop-item" onClick={() => { openAddComment(); setOpenGroup(null); }} data-testid="mr-pop-add-comment">
                <MessageSquarePlus size={13} /> إضافة تعليق
              </button>
              <button className="mr-pop-item" onClick={() => { setShowComments(true); setOpenGroup(null); }} data-testid="mr-pop-list-comments">
                <MessagesSquare size={13} /> قائمة التعليقات ({currentComments.length})
              </button>
              <div className="mr-pop-sep" />
              <button className="mr-pop-item" onClick={() => { openAddHeading(); setOpenGroup(null); }} data-testid="mr-pop-add-heading">
                <Plus size={13} /> إضافة عنوان
              </button>
              <button className="mr-pop-item" onClick={() => { setShowHeadings(true); setOpenGroup(null); }} data-testid="mr-pop-list-headings">
                <List size={13} /> قائمة العناوين ({currentHeadings.length})
              </button>
              <div className="mr-pop-sep" />
              <button className="mr-pop-item" onClick={() => { addBookmark(); setOpenGroup(null); }} data-testid="mr-pop-add-bm">
                <BookmarkPlus size={13} /> إضافة علامة مرجعية
              </button>
              <button className="mr-pop-item" onClick={() => { setShowBookmarks(true); setOpenGroup(null); }} data-testid="mr-pop-list-bm">
                <Bookmark size={13} /> قائمة العلامات ({currentBookmarks.length})
              </button>
            </div>
          )}
        </div>

        {/* 7. التصدير */}
        <div className="mr-group">
          <button
            className="mr-gbtn"
            onClick={() => hasFile && setOpenGroup(openGroup === "export" ? null : "export")}
            disabled={!hasFile}
            data-testid="mr-btn-export"
            title="تصدير المخطوط"
          >
            <Download size={22} />
            <span>تصدير</span>
            <ChevronDown size={12} />
          </button>
          {openGroup === "export" && (
            <div className="mr-popover" data-testid="mr-pop-export">
              <button className="mr-pop-x" onClick={() => setOpenGroup(null)} title="إغلاق"><X size={14} /></button>
              <button className="mr-pop-item" onClick={() => { setState((s) => ({ ...s, exportFormat: "zip" })); setShowExport(true); setOpenGroup(null); }} data-testid="mr-exp-zip">
                <Archive size={13} /> صور مضغوطة في ملف ZIP
              </button>
              <button className="mr-pop-item" onClick={() => { exportAsIndexedPdf(); setOpenGroup(null); }} data-testid="mr-exp-pdf-indexed">
                <FileText size={13} /> PDF مفهرس بالعناوين والتعليقات
              </button>
              <button className="mr-pop-item" onClick={() => { setState((s) => ({ ...s, exportFormat: "pdf" })); setShowExport(true); setOpenGroup(null); }} data-testid="mr-exp-pdf-comp">
                <FileText size={13} /> PDF مضغوط (تصغير الحجم)
              </button>
              <div className="mr-pop-sep" />
              <button className="mr-pop-item" onClick={() => { exportCommentsAsWord(); setOpenGroup(null); }} data-testid="mr-exp-word-comments">
                <FileText size={13} /> تصدير التعليقات إلى Word
              </button>
              <button className="mr-pop-item" onClick={() => { exportHeadingsAsWord(); setOpenGroup(null); }} data-testid="mr-exp-word-headings">
                <FileText size={13} /> تصدير العناوين إلى Word
              </button>
              <div className="mr-pop-sep" />
              <button className="mr-pop-item" onClick={() => { beginSnip(); setOpenGroup(null); }} data-testid="mr-exp-snip">
                <Scissors size={13} /> التقاط لقطة مع شرح
              </button>
            </div>
          )}
        </div>

        {/* 8. التقاط لقطة (Snip with caption) */}
        <div className="mr-group">
          <button
            className={`mr-gbtn ${snipping ? "mr-gbtn-active" : ""}`}
            onClick={() => hasFile && beginSnip()}
            disabled={!hasFile}
            data-testid="mr-btn-snip-top"
            title="التقاط لقطة مع شرح نصيّ"
          >
            <Camera size={22} />
            <span>لقطة</span>
          </button>
        </div>

        <button
          className="mr-btn mr-btn-icon"
          onClick={toggleFullscreen}
          title="ملء الشاشة (F11)"
          data-testid="mr-btn-fullscreen"
        >
          {isFs ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
        </button>

        <button
          className="mr-btn mr-btn-icon"
          onClick={() => setShowAbout(true)}
          title="عن البرنامج"
          data-testid="mr-btn-about"
        >
          <Info size={18} />
        </button>

        <div className="mr-info">
          {hasFile && (
            <>
              <button className="mr-btn mr-btn-icon" onClick={firstPage} disabled={state.page <= 1} title="أول المخطوط" data-testid="mr-btn-first"><ChevronsRight size={18} /></button>
              <button className="mr-btn mr-btn-icon" onClick={prevPage} disabled={state.page <= 1} title="الصفحة السابقة" data-testid="mr-btn-prev"><ChevronRight size={18} /></button>
              <span className="mr-info-chip" data-testid="mr-page-label">
                {state.folioMode ? formatFolio(state.page, { startFolio: state.folioStart, offset: state.folioOffset }) : `صفحة ${state.page}`}
                {" · "}
                <input
                  type="number"
                  min="1"
                  max={pageCount}
                  value={state.page}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (v >= 1 && v <= pageCount) {
                      setState((s) => ({ ...s, page: v, rulerY: 0 }));
                    }
                  }}
                  className="mr-page-input"
                  data-testid="mr-page-input"
                  title="اكتب رقم الصفحة للانتقال إليها مباشرة"
                />
                /{pageCount}
              </span>
              <button className="mr-btn mr-btn-icon" onClick={nextPage} disabled={state.page >= pageCount} title="الصفحة التالية" data-testid="mr-btn-next"><ChevronLeft size={18} /></button>
              <button className="mr-btn mr-btn-icon" onClick={lastPage} disabled={state.page >= pageCount} title="آخر المخطوط" data-testid="mr-btn-last"><ChevronsLeft size={18} /></button>
              <span className="mr-info-chip" title={state.fileName} data-testid="mr-file-label">
                {state.fileName.length > 30 ? state.fileName.slice(0, 30) + "…" : state.fileName}
              </span>
            </>
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
          <div className="mr-empty mr-fade mr-empty-splash">
            <img
              src={`${process.env.PUBLIC_URL || "."}/splash.png`}
              alt="متصفح المخطوطات"
              className="mr-splash-img"
              data-testid="mr-splash-img"
            />
            {!window.msElectron && !NS && (
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
                }}
                download
              >
                <Download size={16} />
                تنزيل نسخة سطح المكتب لويندوز (Portable)
              </a>
            )}
          </div>
        )}

        {hasFile && (
          <div className="mr-scroll" ref={scrollRef} data-testid="mr-scroll">
            <div
              className="mr-page-wrap"
              ref={pageWrapRef}
              onClick={onPageClick}
              onMouseDown={onPageMouseDown}
              style={{
                width: pageSize.w || undefined,
                height: pageSize.h || undefined,
                cursor: selectMode ? "crosshair" : (handTool ? (panDragRef.current ? "grabbing" : "grab") : undefined),
              }}
              data-testid="mr-page-wrap"
            >
              <div
                className="mr-page-filter"
                style={{
                  position: "absolute",
                  inset: 0,
                  filter: `brightness(${state.brightness}%) contrast(${state.contrast}%) saturate(${state.saturate}%) ${state.invert ? "invert(1) hue-rotate(180deg)" : ""}`,
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
              {state.rulerVisible && pageSize.h > 0 && (() => {
                const w = pageSize.w || 0;
                const rulerW = Math.max(20, (state.rulerWidth / 100) * w);
                let leftOff = 0;
                if (state.rulerAlign === "center") leftOff = (w - rulerW) / 2;
                else if (state.rulerAlign === "end") leftOff = w - rulerW;
                const tilt = state.rulerTilt || 0;
                const shape = state.rulerShape || "band";
                return (
                  <div
                    data-ruler
                    className={`mr-ruler mr-ruler-${shape} ${rulerDragRef.current.dragging ? "dragging" : ""}`}
                    style={{
                      top: state.rulerY,
                      left: leftOff,
                      width: rulerW,
                      height: state.rulerHeight,
                      color: rulerColorRGBA,
                      transform: tilt ? `skewY(${tilt}deg)` : undefined,
                      transformOrigin: "center",
                    }}
                    onMouseDown={onRulerMouseDown}
                    data-testid="mr-ruler"
                  >
                    {shape !== "line" && <div className="mr-ruler-band" />}
                    <div className="mr-ruler-edge top" />
                    <div className="mr-ruler-edge bot" />
                  </div>
                );
              })()}

              {/* Bubble comments layer (rect highlights) */}
              {currentComments.filter((c) => c.page === state.page && (c.rect || c.x != null)).map((c) => {
                const r = c.rect;
                const style = r
                  ? {
                      left: `${r.x * 100}%`,
                      top: `${r.y * 100}%`,
                      width: `${r.w * 100}%`,
                      height: `${r.h * 100}%`,
                    }
                  : {
                      left: `${c.x * 100}%`,
                      top: `${c.y * 100}%`,
                      width: "24px",
                      height: "24px",
                      transform: "translate(-50%, -50%)",
                    };
                return (
                  <div
                    key={c.id}
                    data-bubble
                    className={`mr-highlight mr-highlight-comment ${activeBubbleId === c.id ? "active" : ""}`}
                    style={style}
                    title={c.text}
                    data-testid="mr-bubble"
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveBubbleId(activeBubbleId === c.id ? null : c.id);
                      setActiveHeadingId(null);
                    }}
                  >
                    <span className="mr-highlight-icon" aria-hidden><MessageSquarePlus size={13} /></span>
                    {activeBubbleId === c.id && (
                      <div className="mr-bubble-pop" onClick={(e) => e.stopPropagation()}>
                        <div className="mr-bubble-text">{c.text}</div>
                        <div className="mr-bubble-meta">{c.folio || `صفحة ${c.page}`}</div>
                        <div className="mr-bubble-actions">
                          <button className="mr-btn" onClick={() => copyCommentCitation(c)} data-testid="mr-bubble-copy"><Copy size={11} /> نسخ مع العزو</button>
                          <button className="mr-btn" onClick={() => { setActiveBubbleId(null); openEditComment(c); }} data-testid="mr-bubble-edit"><Edit3 size={11} /> تعديل</button>
                          <button className="mr-btn" onClick={() => { deleteComment(c.id); setActiveBubbleId(null); }} data-testid="mr-bubble-delete" style={{ color: "var(--danger)" }}><Trash2 size={11} /> حذف</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Heading rectangles layer */}
              {currentHeadings.filter((h) => h.page === state.page && h.rect).map((h) => {
                const r = h.rect;
                return (
                  <div
                    key={h.id}
                    data-heading-rect
                    className={`mr-highlight mr-highlight-heading ${activeHeadingId === h.id ? "active" : ""}`}
                    style={{
                      left: `${r.x * 100}%`,
                      top: `${r.y * 100}%`,
                      width: `${r.w * 100}%`,
                      height: `${r.h * 100}%`,
                    }}
                    title={h.title}
                    data-testid="mr-heading-rect"
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveHeadingId(activeHeadingId === h.id ? null : h.id);
                      setActiveBubbleId(null);
                    }}
                  >
                    <span className="mr-highlight-icon" aria-hidden><List size={13} /></span>
                    {activeHeadingId === h.id && (
                      <div className="mr-bubble-pop mr-bubble-pop-heading" onClick={(e) => e.stopPropagation()}>
                        <div className="mr-bubble-text" style={{ fontWeight: 700 }}>{h.title}</div>
                        <div className="mr-bubble-meta">{formatFolio(h.page, { startFolio: state.folioStart, offset: state.folioOffset })}</div>
                        <div className="mr-bubble-actions">
                          <button className="mr-btn" onClick={() => { setActiveHeadingId(null); openEditHeading(h); }}><Edit3 size={11} /> تعديل</button>
                          <button className="mr-btn" onClick={() => { deleteHeading(h.id); setActiveHeadingId(null); }} style={{ color: "var(--danger)" }}><Trash2 size={11} /> حذف</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Live drag-select rectangle preview */}
              {selectingRect && (
                <div
                  className={`mr-select-preview mr-select-preview-${selectMode}`}
                  style={{
                    left: selectingRect.x,
                    top: selectingRect.y,
                    width: selectingRect.w,
                    height: selectingRect.h,
                  }}
                />
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
          <div className="mr-settings mr-fade" data-testid="mr-folio-settings" style={{ inset: "auto 10px 10px auto", top: 60, width: 380, maxHeight: "85vh", overflowY: "auto" }}>
            <h3 style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              ترقيم المخطوط
              <button className="mr-btn mr-btn-icon" onClick={() => setShowFolioSettings(false)} title="إغلاق"><X size={14} /></button>
            </h3>

            {/* Step tabs */}
            <div style={{ display: "flex", gap: 4, marginBottom: 4 }}>
              {[
                { s: 1, lbl: "1. التقسيم" },
                { s: 2, lbl: "2. المراجعة" },
                { s: 3, lbl: "3. الترقيم" },
              ].map((st) => (
                <button
                  key={st.s}
                  className={`mr-btn ${numberStep === st.s ? "mr-btn-active" : ""}`}
                  onClick={() => setNumberStep(st.s)}
                  style={{ flex: 1, justifyContent: "center", padding: "6px 4px", fontSize: 12 }}
                  data-testid={`mr-number-step-${st.s}`}
                >
                  {st.lbl}
                </button>
              ))}
            </div>

            {numberStep === 1 && (
              <div style={{ fontSize: 12, color: "var(--parchment-soft)", padding: "8px 10px", background: "var(--ink-3)", borderRadius: 6, border: "1px solid var(--line)", lineHeight: 1.7 }}>
                <b style={{ color: "var(--amber)" }}>الخطوة 1: تفعيل تقسيم الصفحات المزدوجة</b>
                <br />
                فعّل التقسيم من المنتصف، وحدّد أول صفحة يبدأ منها التقسيم وآخر صفحة ينتهي عندها. الصفحات خارج هذا المدى تبقى كاملة (مفيد لصفحات الغلاف ونهاية المخطوط).
              </div>
            )}
            {numberStep === 2 && (
              <div style={{ fontSize: 12, color: "var(--parchment-soft)", padding: "8px 10px", background: "var(--ink-3)", borderRadius: 6, border: "1px solid var(--line)", lineHeight: 1.7 }}>
                <b style={{ color: "var(--amber)" }}>الخطوة 2: مراجعة التقسيم</b>
                <br />
                تنقَّل بين الأوراق. إذا فشل الكشف الذكي في قصّ ورقة معيّنة من المنتصف، انتقل للورقة التي بعدها، واضبطها يدوياً باستخدام «موضع القص للورقة» أدناه، بسحب الشريط لليمين أو لليسار حتى تصل للحد المطلوب.
              </div>
            )}
            {numberStep === 3 && (
              <div style={{ fontSize: 12, color: "var(--parchment-soft)", padding: "8px 10px", background: "var(--ink-3)", borderRadius: 6, border: "1px solid var(--line)", lineHeight: 1.7 }}>
                <b style={{ color: "var(--amber)" }}>الخطوة 3: تفعيل ترقيم الأوراق (أ/ب)</b>
                <br />
                فعّل الترقيم، وحدّد رقم الورقة الأولى من المخطوط وعدد صفحات الغلاف قبل بداية المخطوط.
              </div>
            )}

            {numberStep === 1 && (
              <>
                <div className="mr-field">
                  <label style={{ cursor: "pointer", flexDirection: "row", justifyContent: "space-between" }}>
                    <span>تفعيل تقسيم الصفحات المزدوجة</span>
                    <input type="checkbox" checked={state.splitPages} onChange={toggleSplit} data-testid="mr-num-split-toggle" style={{ accentColor: "var(--amber)" }} />
                  </label>
                </div>
                <div className="mr-field">
                  <label>ابدأ التقسيم من صفحة <span className="val">{state.splitFrom}</span></label>
                  <input type="number" min="1" value={state.splitFrom}
                    onChange={(e) => applySplitRange(Math.max(1, Number(e.target.value) || 1), state.splitTo)}
                    data-testid="mr-split-from" />
                </div>
                <div className="mr-field">
                  <label>انتهِ عند صفحة <span className="val">{Math.min(state.splitTo, baseDoc?.numPages || state.splitTo)}</span></label>
                  <input type="number" min="1" value={state.splitTo}
                    onChange={(e) => applySplitRange(state.splitFrom, Math.max(state.splitFrom, Number(e.target.value) || state.splitFrom))}
                    data-testid="mr-split-to" />
                </div>
                {baseDoc && (
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>إجمالي صفحات الملف الأصلي: <b style={{ color: "var(--parchment)" }}>{baseDoc.numPages}</b></div>
                )}
              </>
            )}

            {numberStep === 2 && state.splitPages && baseDoc && (() => {
              const activeBasePage = Math.ceil(state.page / 2);
              const overrides = foldOverridesMap[state.fileKey] || {};
              const current = overrides[activeBasePage];
              // Read auto-detected value from the doc's cache if no override yet
              let autoVal = 50;
              if (current == null && doc && doc._foldCache && doc._foldCache.has(activeBasePage)) {
                autoVal = Math.round(doc._foldCache.get(activeBasePage) * 100);
              }
              const displayVal = current != null ? Math.round(current * 100) : autoVal;
              return (
                <div className="mr-field">
                  <label>
                    موضع القص للورقة {activeBasePage}
                    <span className="val">{displayVal}%{current == null ? " (تلقائي)" : " (يدوي)"}</span>
                  </label>
                  <input
                    type="range" min="10" max="90" step="0.5" value={displayVal}
                    onChange={(e) => {
                      const v = Number(e.target.value) / 100;
                      setFoldRatio(activeBasePage, v);
                      // Force re-render so getViewport/render read the new override
                      if (renderPageRef.current) renderPageRef.current(state.page);
                    }}
                    data-testid="mr-fold-manual"
                  />
                  <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                    <button
                      className="mr-btn"
                      onClick={() => {
                        setFoldOverridesMap((m) => {
                          const cp = { ...(m[state.fileKey] || {}) };
                          delete cp[activeBasePage];
                          return { ...m, [state.fileKey]: cp };
                        });
                        if (renderPageRef.current) renderPageRef.current(state.page);
                      }}
                      style={{ flex: 1, justifyContent: "center", fontSize: 11 }}
                      data-testid="mr-fold-reset"
                    >
                      <RotateCcw size={12} /> استعادة التلقائي
                    </button>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
                    تنقّل بين الصفحات المزدوجة باستخدام أزرار الصفحات، ثم اضبط الشريط لهذه الورقة. سيُحفظ الضبط تلقائياً لكل ورقة على حِدَة.
                  </div>
                </div>
              );
            })()}

            {numberStep === 2 && !state.splitPages && (
              <div style={{ padding: "10px", color: "var(--muted)", fontSize: 12, textAlign: "center", fontStyle: "italic" }}>
                يجب أولاً تفعيل التقسيم في الخطوة 1.
              </div>
            )}

            {numberStep === 3 && (
              <>
                <div className="mr-field">
                  <label style={{ cursor: "pointer", flexDirection: "row", justifyContent: "space-between" }}>
                    <span>تفعيل ترقيم المخطوط (أ/ب)</span>
                    <input type="checkbox" checked={state.folioMode}
                      onChange={(e) => setState((s) => ({ ...s, folioMode: e.target.checked }))}
                      data-testid="mr-folio-toggle" style={{ accentColor: "var(--amber)" }} />
                  </label>
                </div>
                <div className="mr-field">
                  <label>رقم الورقة الأولى من المخطوط <span className="val">{state.folioStart}</span></label>
                  <input type="number" min="1" value={state.folioStart}
                    onChange={(e) => setState((s) => ({ ...s, folioStart: Math.max(1, Number(e.target.value) || 1) }))}
                    data-testid="mr-folio-start" />
                </div>
                <div className="mr-field">
                  <label>صفحات الغلاف قبل بداية المخطوط <span className="val">{state.folioOffset}</span></label>
                  <input type="number" min="0" value={state.folioOffset}
                    onChange={(e) => setState((s) => ({ ...s, folioOffset: Math.max(0, Number(e.target.value) || 0) }))}
                    data-testid="mr-folio-offset" />
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)", padding: "6px 8px", background: "var(--ink-3)", borderRadius: 6, border: "1px solid var(--line)" }}>
                  الصفحة الحالية:{" "}
                  <span style={{ color: "var(--amber)", fontWeight: 600 }}>
                    {state.folioMode ? formatFolio(state.page, { startFolio: state.folioStart, offset: state.folioOffset }) : `صفحة ${state.page}`}
                  </span>
                </div>
              </>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
              <div style={{ display: "flex", gap: 6 }}>
                {numberStep > 1 && (
                  <button className="mr-btn" onClick={() => setNumberStep(numberStep - 1)} style={{ flex: 1, justifyContent: "center" }} data-testid="mr-num-prev">
                    ← السابق
                  </button>
                )}
                {numberStep < 3 && (
                  <button className="mr-btn mr-btn-primary" onClick={() => setNumberStep(numberStep + 1)} style={{ flex: 1, justifyContent: "center" }} data-testid="mr-num-next">
                    التالي ←
                  </button>
                )}
              </div>
              {numberStep === 3 && (
                <>
                  <button className="mr-btn" onClick={() => { showToast("تم حفظ إعدادات الترقيم"); setShowFolioSettings(false); }} style={{ justifyContent: "center" }} data-testid="mr-num-save">
                    <Save size={13} /> حفظ الإعدادات
                  </button>
                  <button className="mr-btn mr-btn-primary" onClick={() => exportCroppedPdf()} style={{ justifyContent: "center" }} data-testid="mr-num-export-pdf">
                    <Download size={13} /> تصدير المخطوط المقصوص PDF
                  </button>
                  <div style={{ fontSize: 11, color: "var(--muted)", padding: "6px 8px", background: "var(--ink-3)", borderRadius: 6, border: "1px solid var(--line)", lineHeight: 1.6 }}>
                    ملاحظة: حجم الملف سيكون كبيراً (بالجودة الأصلية)، ويمكنك تصغيره لاحقاً من خيار «PDF مضغوط» في قسم التصدير.
                  </div>
                </>
              )}
            </div>
          </div>
        )}


        {showExport && (
          <div className="mr-settings mr-fade" data-testid="mr-export-panel" style={{ inset: "auto 10px 10px auto", top: 60, width: 320 }}>
            <h3 style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              تصدير المخطوط
              <button className="mr-btn mr-btn-icon" onClick={() => setShowExport(false)} title="إغلاق" data-testid="mr-export-close"><X size={14} /></button>
            </h3>

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
                type="range" min="800" max="6000" step="200"
                value={state.exportMaxSize}
                onChange={(e) => setState((s) => ({ ...s, exportMaxSize: Number(e.target.value) }))}
                data-testid="mr-export-size"
              />
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                للحصول على أعلى جودة، اترك القيمة عند 4000 أو أكثر.
              </div>
            </div>

            <div className="mr-field">
              <label>جودة JPEG <span className="val">{state.exportQuality}%</span></label>
              <input
                type="range" min="50" max="98"
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
              {currentInfo.number && (
                <div><span className="k">رقم النسخة:</span> {currentInfo.number}</div>
              )}
              {currentInfo.library && (
                <div><span className="k">المكتبة:</span> {currentInfo.library}</div>
              )}
              {(currentInfo.type || "single") === "single" && (
                <>
                  {currentInfo.author && (
                    <div><span className="k">المؤلف:</span> {currentInfo.author}</div>
                  )}
                  {currentInfo.copyist && (
                    <div><span className="k">الناسخ:</span> {currentInfo.copyist}</div>
                  )}
                  {currentInfo.copyDate && (
                    <div><span className="k">تاريخ النسخ:</span> {currentInfo.copyDate}</div>
                  )}
                </>
              )}
              {currentInfo.type === "collection" && currentInfo.titlesList && (
                <div style={{ maxHeight: 100, overflowY: "auto", padding: "2px 4px", background: "var(--ink-3)", borderRadius: 4, marginTop: 3 }}>
                  <span className="k">المجموع:</span>
                  <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: 11, lineHeight: 1.6 }}>{currentInfo.titlesList}</pre>
                </div>
              )}
              {currentInfo.notes && (
                <div style={{ maxHeight: 80, overflowY: "auto", padding: "2px 4px", background: "var(--ink-3)", borderRadius: 4, marginTop: 3 }}>
                  <span className="k">ملاحظات:</span>
                  <div style={{ fontSize: 11, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{currentInfo.notes}</div>
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
              إضافة تعليق للموضع الحالي
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

        {/* About the App Modal */}
        {showAbout && (
          <AboutModal onClose={() => setShowAbout(false)} />
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
            <button className="mr-btn" onClick={exportHeadingsAsWord} style={{ justifyContent: "center", marginTop: 6 }} data-testid="mr-export-headings-word">
              <FileText size={14} /> تصدير الفهرس إلى Word
            </button>
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
          <div
            className="mr-thumbs"
            data-testid="mr-thumbs-strip"
            style={{ width: thumbsWidth }}
          >
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
            <div
              className="mr-thumbs-resizer"
              data-testid="mr-thumbs-resizer"
              onMouseDown={(e) => {
                e.preventDefault();
                thumbsDragRef.current = { startX: e.clientX, startW: thumbsWidth };
              }}
              title="اسحب لتغيير حجم شريط المصغّرات"
            />
          </div>
        )}

        {loading && <div className="mr-loading" data-testid="mr-loading">{loadingMsg}</div>}
        {toast && <div className="mr-toast" data-testid="mr-toast">{toast}</div>}
        {selectMode && (
          <div className={`mr-select-banner mr-select-banner-${selectMode}`} data-testid="mr-select-banner">
            {selectMode === "comment"
              ? "🟡 اسحب مربعاً حول الكلمة أو الفقرة التي تريد التعليق عليها — Esc للإلغاء"
              : "🔵 اسحب مربعاً حول العنوان الذي تريد تحديده — Esc للإلغاء"}
          </div>
        )}
        {state.rulerAutoPlaying && (
          <button
            className="mr-floating-pause"
            onClick={() => setState((s) => ({ ...s, rulerAutoPlaying: false }))}
            data-testid="mr-floating-pause"
            title="إيقاف التمرير التلقائي (اضغط مسافة)"
          >
            <Pause size={22} />
            <span>إيقاف · Space</span>
          </button>
        )}

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

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function hasInfoFilled(info) {
  if (!info) return false;
  return Boolean(info.title || info.number || info.library || info.notes || info.titlesList);
}

// 3x3 box blur (denoise) — strength 0..1 (fraction blended with original)
function boxBlur3x3(data, w, h, strength) {
  const src = new Uint8ClampedArray(data);
  const k = 1 / 9;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            sum += src[((y + dy) * w + (x + dx)) * 4 + c];
          }
        }
        const blurred = sum * k;
        data[i + c] = src[i + c] * (1 - strength) + blurred * strength;
      }
    }
  }
}

// 3x3 unsharp mask sharpen — strength 0..1
function sharpen3x3(data, w, h, strength) {
  const src = new Uint8ClampedArray(data);
  // Kernel: center 5, edges -1 for cardinal directions
  const s = strength;
  const kCenter = 1 + 4 * s;
  const kEdge = -s;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const center = src[i + c];
        const top = src[((y - 1) * w + x) * 4 + c];
        const bot = src[((y + 1) * w + x) * 4 + c];
        const lft = src[(y * w + (x - 1)) * 4 + c];
        const rgt = src[(y * w + (x + 1)) * 4 + c];
        const v = kCenter * center + kEdge * (top + bot + lft + rgt);
        data[i + c] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    }
  }
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

function HeadingModal({ initial, onSave, onCancel }) {
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
  { desc: "إضافة تعليق على المخطوط", keys: ["Ctrl", "F"] },
  { desc: "إضافة عنوان (فهرس)", keys: ["Ctrl", "B"] },
  { desc: "التقاط لقطة من الصفحة", keys: ["Ctrl", "S"] },
  { desc: "فتح/إغلاق قائمة العلامات", keys: ["Ctrl", "G"] },
  { desc: "ملء الشاشة", keys: ["F11"] },
  { desc: "فتح/إغلاق نافذة الاختصارات", keys: ["؟"] },
  { desc: "إغلاق النوافذ", keys: ["Esc"] },
];


function AboutModal({ onClose }) {
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const iconGuide = [
    { icon: "📂", name: "فتح مخطوط", desc: "فتح ملف PDF أو أرشيف صور (ZIP/RAR/7z) أو صور مفردة، والوصول إلى قائمة آخر المخطوطات المفتوحة." },
    { icon: "📖", name: "البطاقة", desc: "بطاقة معلومات المخطوط: العنوان، المؤلف، الناسخ، المكتبة، رقم النسخة، تاريخ النسخ… مع نسخها كجدول لأغراض التوثيق." },
    { icon: "🔍", name: "تصفح", desc: "أدوات التصفح: التكبير حتى 1000%، التدوير، فلاتر الصورة (عكس ألوان، تنعيم، حدّة، تشبّع) والأداة اليدوية (Hand) للتنقل." },
    { icon: "🔢", name: "ترقيم", desc: "معالج ذكي مكوّن من خطوات لقص الصفحات المزدوجة من المنتصف، ثم ترقيم الأوراق بترقيم المخطوطات المعتمد (1/أ، 1/ب…)." },
    { icon: "📏", name: "المسطرة", desc: "إظهار/إخفاء المسطرة الأفقية الشفافة للمساعدة في المقابلة سطراً بسطر، مع تخصيص شكلها وارتفاعها وعرضها وتشغيلها تلقائياً." },
    { icon: "💬", name: "تعليق", desc: "إضافة تعليقات محدّدة على مناطق من المخطوط مع العزو التلقائي إلى رقم الورقة (فوليو)، وإضافة عناوين/فهرس ملاحظات." },
    { icon: "📤", name: "تصدير", desc: "تصدير المخطوط المرقّم إلى PDF، وتصدير التعليقات والعناوين إلى Word مع الترقيم العربي الصحيح، وضغط الصور." },
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
            <h2 style={{ fontSize: 22, margin: 0, color: "var(--amber)" }}>متصفح المخطوطات</h2>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>أداة متخصصة للباحثين في المخطوطات</div>
          </div>
        </div>

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
