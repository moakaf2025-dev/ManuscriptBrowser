import React, { useEffect, useRef, useState } from "react";
import { X, Camera, Trash2, FileDown, Monitor, Play, RotateCcw } from "lucide-react";
import { PDFDocument } from "pdf-lib";
import JSZip from "jszip";

const isElectron = () => Boolean(window.msElectron);

/**
 * Global screen capture tool.
 *  1) User picks a screen/window (Electron: via desktopCapturer; Web: via getDisplayMedia).
 *  2) Live preview appears. User clicks "التقاط" to freeze current frame.
 *  3) User crops (drag rectangle) or takes full frame. Snip added to gallery.
 *  4) User can capture more, or finish -> save PNG snips + compiled PDF to chosen folder.
 */
export default function WebSnipTool({ onClose, onToast }) {
  const [phase, setPhase] = useState("pick"); // pick | live | crop | done
  const [sources, setSources] = useState([]); // Electron sources list
  const [selectedSourceId, setSelectedSourceId] = useState("");
  const [stream, setStream] = useState(null);
  const [frozenFrame, setFrozenFrame] = useState(null); // dataUrl of frozen frame
  const [cropRect, setCropRect] = useState(null); // {x,y,w,h} in image coords
  const [snips, setSnips] = useState([]); // [{id, dataUrl, w, h}]
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const videoRef = useRef(null);
  const previewCanvasRef = useRef(null);
  const dragRef = useRef(null);

  const cleanup = () => {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
    }
  };

  useEffect(() => () => cleanup(), [stream]);

  const loadSources = async () => {
    setError("");
    if (isElectron()) {
      try {
        const srcs = await window.msElectron.getSources();
        setSources(srcs);
      } catch (e) {
        setError("تعذّر جلب مصادر الشاشة: " + (e.message || e));
      }
    }
  };

  useEffect(() => {
    loadSources();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startCaptureElectron = async (sourceId) => {
    setSelectedSourceId(sourceId);
    setError("");
    try {
      // eslint-disable-next-line no-undef
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: "desktop",
            chromeMediaSourceId: sourceId,
            maxWidth: 3840,
            maxHeight: 2160,
          },
        },
      });
      setStream(mediaStream);
      setPhase("live");
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
          videoRef.current.play().catch(() => {});
        }
      }, 50);
    } catch (e) {
      setError("تعذّر بدء الالتقاط: " + (e.message || e));
    }
  };

  const startCaptureWeb = async () => {
    setError("");
    try {
      const mediaStream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: "always" },
        audio: false,
      });
      setStream(mediaStream);
      setPhase("live");
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
          videoRef.current.play().catch(() => {});
        }
      }, 50);
      mediaStream.getVideoTracks()[0].addEventListener("ended", () => {
        setStream(null);
        setPhase("pick");
      });
    } catch (e) {
      setError("تعذّر بدء الالتقاط: " + (e.message || e));
    }
  };

  const freezeFrame = () => {
    const video = videoRef.current;
    if (!video) return;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, w, h);
    const dataUrl = canvas.toDataURL("image/png");
    setFrozenFrame({ dataUrl, w, h });
    setCropRect(null);
    setPhase("crop");
  };

  // Draw the frozen frame + crop rectangle onto the preview canvas
  useEffect(() => {
    if (phase !== "crop" || !frozenFrame || !previewCanvasRef.current) return;
    const canvas = previewCanvasRef.current;
    const maxW = Math.min(1100, window.innerWidth - 120);
    const maxH = Math.min(600, window.innerHeight - 260);
    const scale = Math.min(maxW / frozenFrame.w, maxH / frozenFrame.h, 1);
    canvas.width = Math.floor(frozenFrame.w * scale);
    canvas.height = Math.floor(frozenFrame.h * scale);
    canvas.style.width = canvas.width + "px";
    canvas.style.height = canvas.height + "px";
    canvas.dataset.scale = String(scale);
    const ctx = canvas.getContext("2d");
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      if (cropRect) {
        const s = scale;
        ctx.save();
        // dim outside area
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        // clear crop area
        ctx.clearRect(cropRect.x * s, cropRect.y * s, cropRect.w * s, cropRect.h * s);
        ctx.drawImage(
          img,
          cropRect.x,
          cropRect.y,
          cropRect.w,
          cropRect.h,
          cropRect.x * s,
          cropRect.y * s,
          cropRect.w * s,
          cropRect.h * s,
        );
        // border
        ctx.strokeStyle = "#d4a250";
        ctx.lineWidth = 2;
        ctx.strokeRect(cropRect.x * s, cropRect.y * s, cropRect.w * s, cropRect.h * s);
        ctx.restore();
      }
    };
    img.src = frozenFrame.dataUrl;
  }, [phase, frozenFrame, cropRect]);

  const canvasToImageCoords = (e) => {
    const canvas = previewCanvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scale = parseFloat(canvas.dataset.scale) || 1;
    const x = (e.clientX - rect.left) / scale;
    const y = (e.clientY - rect.top) / scale;
    return { x, y };
  };

  const onCanvasMouseDown = (e) => {
    if (!frozenFrame) return;
    const { x, y } = canvasToImageCoords(e);
    dragRef.current = { startX: x, startY: y };
    setCropRect({ x, y, w: 0, h: 0 });
  };
  const onCanvasMouseMove = (e) => {
    if (!dragRef.current) return;
    const { x, y } = canvasToImageCoords(e);
    const sx = dragRef.current.startX;
    const sy = dragRef.current.startY;
    setCropRect({
      x: Math.min(sx, x),
      y: Math.min(sy, y),
      w: Math.abs(x - sx),
      h: Math.abs(y - sy),
    });
  };
  const onCanvasMouseUp = () => {
    dragRef.current = null;
  };

  const acceptSnip = (useFullFrame = false) => {
    if (!frozenFrame) return;
    const canvas = document.createElement("canvas");
    if (useFullFrame || !cropRect || cropRect.w < 5 || cropRect.h < 5) {
      canvas.width = frozenFrame.w;
      canvas.height = frozenFrame.h;
      const img = new Image();
      img.onload = () => {
        canvas.getContext("2d").drawImage(img, 0, 0);
        const dataUrl = canvas.toDataURL("image/png");
        setSnips((s) => [...s, { id: Date.now() + "-" + Math.random(), dataUrl, w: canvas.width, h: canvas.height }]);
        setFrozenFrame(null);
        setCropRect(null);
        setPhase("live");
      };
      img.src = frozenFrame.dataUrl;
      return;
    }
    canvas.width = Math.max(1, Math.floor(cropRect.w));
    canvas.height = Math.max(1, Math.floor(cropRect.h));
    const img = new Image();
    img.onload = () => {
      canvas.getContext("2d").drawImage(
        img,
        cropRect.x, cropRect.y, cropRect.w, cropRect.h,
        0, 0, canvas.width, canvas.height,
      );
      const dataUrl = canvas.toDataURL("image/png");
      setSnips((s) => [...s, { id: Date.now() + "-" + Math.random(), dataUrl, w: canvas.width, h: canvas.height }]);
      setFrozenFrame(null);
      setCropRect(null);
      setPhase("live");
    };
    img.src = frozenFrame.dataUrl;
  };

  const removeSnip = (id) => setSnips((s) => s.filter((x) => x.id !== id));
  const moveSnip = (idx, dir) => {
    setSnips((s) => {
      const arr = [...s];
      const j = idx + dir;
      if (j < 0 || j >= arr.length) return arr;
      [arr[idx], arr[j]] = [arr[j], arr[idx]];
      return arr;
    });
  };

  const dataUrlToBytes = (dataUrl) => {
    const b64 = dataUrl.split(",")[1];
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  };

  const buildPdfBytes = async () => {
    const pdfDoc = await PDFDocument.create();
    for (const s of snips) {
      const bytes = dataUrlToBytes(s.dataUrl);
      const img = await pdfDoc.embedPng(bytes);
      const page = pdfDoc.addPage([img.width, img.height]);
      page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    }
    return await pdfDoc.save();
  };

  const finishAndSave = async () => {
    if (snips.length === 0) {
      onToast?.("لا توجد لقطات لحفظها");
      return;
    }
    setSaving(true);
    try {
      const pdfBytes = await buildPdfBytes();
      const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const baseName = `WebSnips-${ts}`;

      if (isElectron()) {
        const folder = await window.msElectron.chooseSaveFolder();
        if (!folder) {
          setSaving(false);
          return;
        }
        const subFolderName = baseName;
        // save each PNG
        for (let i = 0; i < snips.length; i++) {
          const bytes = Array.from(dataUrlToBytes(snips[i].dataUrl));
          await window.msElectron.saveFile({
            folder,
            subFolder: subFolderName,
            filename: `snip-${String(i + 1).padStart(3, "0")}.png`,
            bytes,
          });
        }
        // save PDF
        await window.msElectron.saveFile({
          folder,
          subFolder: subFolderName,
          filename: `${baseName}.pdf`,
          bytes: Array.from(pdfBytes),
        });
        onToast?.(`تم حفظ ${snips.length} لقطة + PDF في المجلد المختار`);
        cleanup();
        onClose();
      } else {
        // Web fallback: download ZIP + PDF individually
        const zip = new JSZip();
        snips.forEach((s, i) => {
          zip.file(`snip-${String(i + 1).padStart(3, "0")}.png`, dataUrlToBytes(s.dataUrl));
        });
        zip.file(`${baseName}.pdf`, pdfBytes);
        const blob = await zip.generateAsync({ type: "blob" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${baseName}.zip`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        onToast?.(`تم تنزيل ${snips.length} لقطة + PDF كأرشيف`);
        cleanup();
        onClose();
      }
    } catch (e) {
      console.error(e);
      onToast?.("تعذّر الحفظ: " + (e.message || e));
    } finally {
      setSaving(false);
    }
  };

  const restartCapture = () => {
    cleanup();
    setStream(null);
    setFrozenFrame(null);
    setCropRect(null);
    setPhase("pick");
    loadSources();
  };

  return (
    <div className="ws-overlay" data-testid="ws-overlay" onClick={(e) => { if (e.target.classList.contains("ws-overlay")) { cleanup(); onClose(); } }}>
      <div className="ws-modal">
        <div className="ws-header">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Monitor size={18} />
            <strong>أداة الالتقاط من الشاشة/المتصفح</strong>
            <span className="ws-badge">
              {isElectron() ? "وضع سطح المكتب" : "وضع المتصفح"}
            </span>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {snips.length > 0 && (
              <button className="mr-btn" onClick={restartCapture} data-testid="ws-restart">
                <RotateCcw size={13} /> تغيير الشاشة
              </button>
            )}
            <button className="mr-btn mr-btn-icon" onClick={() => { cleanup(); onClose(); }} data-testid="ws-close">
              <X size={16} />
            </button>
          </div>
        </div>

        {error && (
          <div className="ws-error">{error}</div>
        )}

        {phase === "pick" && (
          <div className="ws-pick">
            <p style={{ color: "var(--parchment-soft)", fontSize: 13, margin: "0 0 8px", lineHeight: 1.8 }}>
              اختر الشاشة أو النافذة (متصفح، برنامج…) التي تريد الالتقاط منها. ستظهر معاينة حيّة، واضغط <b style={{ color: "var(--amber)" }}>التقاط</b> عند وجود الصفحة المطلوبة. يمكنك اقتصاص جزء أو أخذ الشاشة كاملة، وتكرار العملية لأخذ عدة لقطات متتالية.
            </p>
            {!isElectron() && (
              <button className="mr-btn mr-btn-primary" onClick={startCaptureWeb} data-testid="ws-start-web" style={{ justifyContent: "center", padding: "10px 16px" }}>
                <Play size={16} /> بدء الالتقاط (سيطلب المتصفح تحديد الشاشة)
              </button>
            )}
            {isElectron() && (
              <>
                <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>المصادر المتاحة ({sources.length}):</div>
                <div className="ws-sources">
                  {sources.map((s) => (
                    <button
                      key={s.id}
                      className="ws-source"
                      onClick={() => startCaptureElectron(s.id)}
                      data-testid="ws-source"
                    >
                      {s.thumbnail && <img src={s.thumbnail} alt={s.name} />}
                      <div className="ws-source-name" title={s.name}>{s.name}</div>
                    </button>
                  ))}
                </div>
                <button className="mr-btn" onClick={loadSources} data-testid="ws-refresh" style={{ marginTop: 8 }}>
                  <RotateCcw size={13} /> تحديث القائمة
                </button>
              </>
            )}
          </div>
        )}

        {phase === "live" && (
          <div className="ws-live">
            <video ref={videoRef} className="ws-video" data-testid="ws-video" />
            <div className="ws-actions">
              <button className="mr-btn mr-btn-primary" onClick={freezeFrame} data-testid="ws-freeze" style={{ padding: "8px 18px" }}>
                <Camera size={16} /> التقاط الآن
              </button>
              <button className="mr-btn" onClick={restartCapture} data-testid="ws-change">
                <Monitor size={14} /> تغيير الشاشة
              </button>
              {snips.length > 0 && (
                <button className="mr-btn" onClick={finishAndSave} disabled={saving} data-testid="ws-finish-live">
                  <FileDown size={14} /> إنهاء وحفظ PDF ({snips.length})
                </button>
              )}
            </div>
          </div>
        )}

        {phase === "crop" && frozenFrame && (
          <div className="ws-crop">
            <div style={{ fontSize: 13, color: "var(--parchment-soft)", marginBottom: 6 }}>
              اسحب مستطيلاً لتحديد منطقة القص، أو اضغط «الإطار كاملاً» لأخذ الصورة كلها. يمكنك إعادة السحب لتغيير التحديد.
            </div>
            <canvas
              ref={previewCanvasRef}
              className="ws-canvas"
              onMouseDown={onCanvasMouseDown}
              onMouseMove={onCanvasMouseMove}
              onMouseUp={onCanvasMouseUp}
              onMouseLeave={onCanvasMouseUp}
              data-testid="ws-crop-canvas"
            />
            <div className="ws-actions">
              <button className="mr-btn mr-btn-primary" onClick={() => acceptSnip(false)} disabled={!cropRect || cropRect.w < 5 || cropRect.h < 5} data-testid="ws-accept-crop">
                <Camera size={14} /> إضافة القص المحدد
              </button>
              <button className="mr-btn" onClick={() => acceptSnip(true)} data-testid="ws-accept-full">
                إضافة الإطار كاملاً
              </button>
              <button className="mr-btn" onClick={() => { setFrozenFrame(null); setCropRect(null); setPhase("live"); }} data-testid="ws-cancel-crop">
                إلغاء
              </button>
            </div>
          </div>
        )}

        {snips.length > 0 && (
          <div className="ws-gallery">
            <div className="ws-gallery-header">
              <strong>اللقطات المجموعة ({snips.length})</strong>
              <button className="mr-btn mr-btn-primary" onClick={finishAndSave} disabled={saving} data-testid="ws-finish">
                <FileDown size={14} /> {saving ? "جارٍ الحفظ…" : (isElectron() ? "حفظ في مجلد + تصدير PDF" : "تنزيل الأرشيف + PDF")}
              </button>
            </div>
            <div className="ws-gallery-grid">
              {snips.map((s, i) => (
                <div key={s.id} className="ws-snip" data-testid="ws-snip">
                  <img src={s.dataUrl} alt={`snip-${i + 1}`} />
                  <div className="ws-snip-overlay">
                    <span className="ws-snip-idx">{i + 1}</span>
                    <div style={{ display: "flex", gap: 3 }}>
                      <button className="mr-btn mr-btn-icon" style={{ width: 22, height: 22 }} onClick={() => moveSnip(i, -1)} disabled={i === 0} title="لأعلى">↑</button>
                      <button className="mr-btn mr-btn-icon" style={{ width: 22, height: 22 }} onClick={() => moveSnip(i, 1)} disabled={i === snips.length - 1} title="لأسفل">↓</button>
                      <button className="mr-btn mr-btn-icon" style={{ width: 22, height: 22 }} onClick={() => removeSnip(s.id)} title="حذف" data-testid="ws-remove-snip">
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
