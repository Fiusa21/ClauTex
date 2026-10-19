import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useEffect, useRef, useState } from "react";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const ZOOMS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 3];

interface PageSize {
  width: number;
  height: number;
}

/**
 * Renders a PDF with pdf.js: pages render lazily as they scroll into view; zoom and page navigation; the scroll
 * position is kept (proportionally) when a new build replaces the document.
 */
export function PdfViewer({ url }: { url: string }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [sizes, setSizes] = useState<PageSize[]>([]);
  // "fit" follows the pane width; buttons switch to fixed steps.
  const [zoomSetting, setZoomSetting] = useState<number | "fit">("fit");
  const [paneWidth, setPaneWidth] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const scrollRatio = useRef(0);

  // The previous document stays visible until the new one is ready.
  const shownTask = useRef<pdfjs.PDFDocumentLoadingTask | null>(null);

  useEffect(() => {
    let cancelled = false;
    const task = pdfjs.getDocument({ url });
    task.promise.then(
      async (loaded) => {
        const pageSizes: PageSize[] = [];
        for (let i = 1; i <= loaded.numPages; i++) {
          const p = await loaded.getPage(i);
          const vp = p.getViewport({ scale: 1 });
          pageSizes.push({ width: vp.width, height: vp.height });
        }
        if (cancelled) return;
        const previous = shownTask.current;
        shownTask.current = task;
        setError(null);
        setSizes(pageSizes);
        setDoc(loaded);
        void previous?.destroy();
      },
      (err: unknown) => {
        if (!cancelled)
          setError(
            err instanceof Error ? err.message : "Could not load the PDF.",
          );
      },
    );
    return () => {
      cancelled = true;
      if (shownTask.current !== task) void task.destroy();
    };
  }, [url]);

  useEffect(
    () => () => {
      void shownTask.current?.destroy();
    },
    [],
  );

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      setPaneWidth(el.clientWidth);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, []);

  const widest = Math.max(1, ...sizes.map((s) => s.width));
  const fitZoom = paneWidth > 0 ? Math.max(0.25, (paneWidth - 32) / widest) : 1;
  const zoom = zoomSetting === "fit" ? fitZoom : zoomSetting;

  // Restore the reading position after a new document or zoom level is laid out.
  useEffect(() => {
    const el = scroller.current;
    if (el && doc)
      el.scrollTop = scrollRatio.current * (el.scrollHeight - el.clientHeight);
  }, [doc, zoom]);

  function onScroll() {
    const el = scroller.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    scrollRatio.current = max > 0 ? el.scrollTop / max : 0;
    const pages = el.querySelectorAll<HTMLElement>("[data-page]");
    const mid = el.scrollTop + el.clientHeight / 3;
    for (const p of pages) {
      if (p.offsetTop + p.offsetHeight > mid) {
        setPage(Number(p.dataset.page));
        break;
      }
    }
  }

  function goTo(n: number) {
    const target = scroller.current?.querySelector<HTMLElement>(
      `[data-page="${String(n)}"]`,
    );
    target?.scrollIntoView({ block: "start" });
  }

  const smaller = [...ZOOMS].reverse().find((z) => z < zoom - 0.01);
  const larger = ZOOMS.find((z) => z > zoom + 0.01);

  return (
    <div className="pdf-viewer">
      <div className="pdf-toolbar" role="toolbar" aria-label="PDF controls">
        <button
          type="button"
          className="icon-button"
          aria-label="Previous page"
          disabled={page <= 1}
          onClick={() => {
            goTo(page - 1);
          }}
        >
          ‹
        </button>
        <span className="pdf-page" data-testid="pdf-page">
          {sizes.length ? `${String(page)} / ${String(sizes.length)}` : "–"}
        </span>
        <button
          type="button"
          className="icon-button"
          aria-label="Next page"
          disabled={page >= sizes.length}
          onClick={() => {
            goTo(page + 1);
          }}
        >
          ›
        </button>
        <span className="pdf-spacer" />
        <button
          type="button"
          className="icon-button"
          aria-label="Zoom out"
          disabled={smaller === undefined}
          onClick={() => {
            if (smaller !== undefined) setZoomSetting(smaller);
          }}
        >
          −
        </button>
        <button
          type="button"
          className="icon-button pdf-zoom"
          title="Fit to width"
          aria-pressed={zoomSetting === "fit"}
          onClick={() => {
            setZoomSetting("fit");
          }}
        >
          {zoomSetting === "fit" ? "Fit" : `${String(Math.round(zoom * 100))}%`}
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Zoom in"
          disabled={larger === undefined}
          onClick={() => {
            if (larger !== undefined) setZoomSetting(larger);
          }}
        >
          +
        </button>
        <a
          className="icon-button"
          href={`${url}?download=true`}
          aria-label="Download PDF"
          title="Download PDF"
        >
          ↓
        </a>
      </div>
      {error && (
        <p className="form-error pdf-message" role="alert">
          {error}
        </p>
      )}
      <div
        className="pdf-pages"
        ref={scroller}
        onScroll={onScroll}
        data-testid="pdf-pages"
      >
        {doc &&
          sizes.map((size, i) => (
            <PdfPage
              key={`${url}-${String(i)}`}
              doc={doc}
              number={i + 1}
              size={size}
              zoom={zoom}
            />
          ))}
      </div>
    </div>
  );
}

function PdfPage(props: {
  doc: pdfjs.PDFDocumentProxy;
  number: number;
  size: PageSize;
  zoom: number;
}) {
  const { doc, number, size, zoom } = props;
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setVisible(true);
      },
      { rootMargin: "400px 0px" },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!visible || !canvas.current) return;
    const target = canvas.current;
    let task: pdfjs.RenderTask | undefined;
    let cancelled = false;
    void doc.getPage(number).then((p) => {
      if (cancelled) return;
      const ratio = window.devicePixelRatio || 1;
      const viewport = p.getViewport({ scale: zoom * ratio });
      target.width = Math.floor(viewport.width);
      target.height = Math.floor(viewport.height);
      task = p.render({ canvas: target, viewport });
      task.promise.catch(() => {
        // cancelled by a newer render
      });
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, number, visible, zoom]);

  return (
    <div
      ref={box}
      className="pdf-page-box"
      data-page={number}
      style={{ width: size.width * zoom, height: size.height * zoom }}
    >
      <canvas
        ref={canvas}
        aria-label={`Page ${String(number)}`}
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
}
