import React, { useEffect, useRef, useState } from "react";
import { Columns, Square } from "lucide-react";
import ManuscriptRuler from "@/components/ManuscriptRuler";

/**
 * SplitView renders 1 or 2 ManuscriptRuler panes side-by-side.
 * - Every pane is an iframe, single-pane mode included, so each gets its own
 *   document, keyboard focus and localStorage namespace (`#ns=A` / `#ns=B`).
 * - Pane A's iframe therefore stays mounted across a mode switch, which is what
 *   keeps the open manuscript and its reading position alive when the user
 *   toggles between one and two panes. Rendering it directly in single-pane mode
 *   would save one app instance in memory but drop the loaded document on every
 *   toggle — the trade was made deliberately in favour of not losing the file.
 * - Users can drag the vertical divider to resize.
 */
export default function SplitView() {
  const isChild = (() => {
    try {
      if (new URLSearchParams(window.location.search).get("ns")) return true;
      return /[#&?]ns=/.test(window.location.hash || "");
    } catch { return false; }
  })();

  const [panes, setPanes] = useState(1); // 1 | 2
  const [sizes, setSizes] = useState([100]);
  const containerRef = useRef(null);
  const dragRef = useRef(null);

  useEffect(() => {
    if (panes === 1) setSizes([100]);
    else setSizes([50, 50]);
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

  return <SplitShell panes={panes} setPanes={setPanes} sizes={sizes} beginDrag={beginDrag} containerRef={containerRef} />;
}

function SplitShell({ panes, setPanes, sizes, beginDrag, containerRef }) {
  const frameARef = React.useRef(null);

  // Keyboard shortcuts live in the pane, and a pane is an iframe, so the pane has
  // to hold focus for a key press to reach it. On load focus sits on this outer
  // document instead, which meant no shortcut worked until the reader happened to
  // click on the page — and the same after every alt-tab back into the window.
  React.useEffect(() => {
    const focusPane = () => {
      try { frameARef.current?.contentWindow?.focus(); } catch { /* cross-origin, cannot happen here */ }
    };
    focusPane();
    const t = setTimeout(focusPane, 500); // again once the pane document is up
    window.addEventListener("focus", focusPane);
    return () => { clearTimeout(t); window.removeEventListener("focus", focusPane); };
  }, []);

  // Compute iframe URLs. Use base + `#ns=A|B` so each pane gets its own localStorage.
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
        <span className="sv-bar-hint">اسحب الحدّ الفاصل لضبط حجم كل مخطوط</span>
      </div>

      <div className="sv-body" ref={containerRef} data-testid="sv-body">
        {/* Pane A: always mounted so its state persists across mode switches */}
        <div className="sv-pane" style={{ flex: `0 0 ${panes === 1 ? 100 : sizes[0]}%` }} data-testid="sv-pane-A">
          <iframe
            key="pane-A"
            ref={frameARef}
            title="مخطوط A"
            src={`${baseHref}#ns=A`}
            className="sv-frame"
            onLoad={() => { try { frameARef.current?.contentWindow?.focus(); } catch { /* noop */ } }}
            allow="clipboard-write; clipboard-read; fullscreen *"
          />
        </div>
        {panes === 2 && (
          <>
            <div
              className="sv-divider"
              onMouseDown={beginDrag(0)}
              data-testid="sv-divider-0"
              title="اسحب للتحكم في حجم المخطوطات"
            />
            <div className="sv-pane" style={{ flex: `0 0 ${sizes[1]}%` }} data-testid="sv-pane-B">
              <iframe
                key="pane-B"
                title="مخطوط B"
                src={`${baseHref}#ns=B`}
                className="sv-frame"
                allow="clipboard-write; clipboard-read; fullscreen *"
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
