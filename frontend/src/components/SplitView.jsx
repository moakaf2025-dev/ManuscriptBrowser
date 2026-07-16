import React, { useEffect, useRef, useState } from "react";
import { Columns, Square, LayoutPanelTop } from "lucide-react";
import ManuscriptRuler from "@/components/ManuscriptRuler";

/**
 * SplitView renders 1, 2 or 3 ManuscriptRuler panes side-by-side.
 * - Single pane (default): renders the component directly (no iframes, best perf).
 * - Multi pane: renders iframes so each has its own document + localStorage namespace.
 * - Users can drag the vertical dividers to resize each pane.
 */
export default function SplitView() {
  // If we're inside an iframe (namespace given), render only the ruler.
  const isChild = (() => {
    try {
      if (new URLSearchParams(window.location.search).get("ns")) return true;
      return /[#&?]ns=/.test(window.location.hash || "");
    } catch { return false; }
  })();

  const [panes, setPanes] = useState(1); // 1 | 2 | 3
  const [sizes, setSizes] = useState([100]); // flex percentages that sum to 100
  const containerRef = useRef(null);
  const dragRef = useRef(null);

  useEffect(() => {
    if (panes === 1) setSizes([100]);
    else if (panes === 2) setSizes([50, 50]);
    else setSizes([34, 33, 33]);
  }, [panes]);

  const beginDrag = (idx) => (e) => {
    e.preventDefault();
    dragRef.current = { idx, startX: e.clientX, startSizes: [...sizes] };
  };

  useEffect(() => {
    if (isChild) return;
    const onMove = (e) => {
      if (!dragRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const totalPx = rect.width;
      const dx = e.clientX - dragRef.current.startX;
      const isRtl = getComputedStyle(document.body).direction === "rtl";
      const deltaPct = ((isRtl ? -dx : dx) / totalPx) * 100;
      const { idx, startSizes } = dragRef.current;
      const next = [...startSizes];
      const a = next[idx] + deltaPct;
      const b = next[idx + 1] - deltaPct;
      const MIN = 10;
      if (a < MIN || b < MIN) return;
      next[idx] = a;
      next[idx + 1] = b;
      setSizes(next);
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [sizes, isChild]);

  if (isChild) return <ManuscriptRuler />;

  // Compute iframe URLs. Use base + `?ns=A|B|C` so each pane gets its own localStorage.
  const paneKeys = ["A", "B", "C"].slice(0, panes);
  const baseHref = (() => {
    try {
      const u = new URL(window.location.href);
      u.search = "";
      u.hash = "";
      return u.toString();
    } catch {
      return window.location.pathname;
    }
  })();

  return (
    <div className="sv-root" data-testid="sv-root">
      <div className="sv-bar" data-testid="sv-bar">
        <span className="sv-bar-label">وضع العرض:</span>
        <button
          className={`mr-btn ${panes === 1 ? "mr-btn-active" : ""}`}
          onClick={() => setPanes(1)}
          data-testid="sv-panes-1"
          title="مخطوط واحد"
        >
          <Square size={14} /> مخطوط واحد
        </button>
        <button
          className={`mr-btn ${panes === 2 ? "mr-btn-active" : ""}`}
          onClick={() => setPanes(2)}
          data-testid="sv-panes-2"
          title="مخطوطان جنباً إلى جنب"
        >
          <Columns size={14} /> مخطوطان
        </button>
        <button
          className={`mr-btn ${panes === 3 ? "mr-btn-active" : ""}`}
          onClick={() => setPanes(3)}
          data-testid="sv-panes-3"
          title="ثلاثة مخطوطات"
        >
          <LayoutPanelTop size={14} /> ثلاثة
        </button>
        <span className="sv-bar-hint">اسحب الحدّ الفاصل لضبط حجم كل مخطوط</span>
      </div>

      <div className="sv-body" ref={containerRef} data-testid="sv-body">
        {panes === 1 && (
          <div className="sv-pane" style={{ flex: "1 1 100%" }}>
            <ManuscriptRuler />
          </div>
        )}
        {panes > 1 && paneKeys.map((k, i) => (
          <React.Fragment key={k}>
            <div className="sv-pane" style={{ flex: `0 0 ${sizes[i]}%` }} data-testid={`sv-pane-${k}`}>
              <iframe
                title={`مخطوط ${k}`}
                src={`${baseHref}#ns=${k}`}
                className="sv-frame"
                allow="clipboard-write; clipboard-read; display-capture *; fullscreen *"
              />
            </div>
            {i < panes - 1 && (
              <div
                className="sv-divider"
                onMouseDown={beginDrag(i)}
                data-testid={`sv-divider-${i}`}
                title="اسحب للتحكم في حجم المخطوطات"
              />
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}
