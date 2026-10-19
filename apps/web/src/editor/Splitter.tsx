import type { KeyboardEvent, PointerEvent } from "react";

interface Props {
  label: string;
  value: number;
  min: number;
  max: number;
  /** True when dragging right should shrink the pane (pane is right of the splitter). */
  invert?: boolean;
  onChange: (value: number) => void;
}

/** A vertical drag handle; also adjustable with the arrow keys. */
export function Splitter({
  label,
  value,
  min,
  max,
  invert = false,
  onChange,
}: Props) {
  const clamp = (v: number) => Math.min(max, Math.max(min, v));

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    const startX = e.clientX;
    const start = value;
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const onMove = (ev: globalThis.PointerEvent) => {
      const delta = ev.clientX - startX;
      onChange(clamp(start + (invert ? -delta : delta)));
    };
    const onUp = () => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const step = e.key === "ArrowLeft" ? -16 : e.key === "ArrowRight" ? 16 : 0;
    if (step) {
      e.preventDefault();
      onChange(clamp(value + (invert ? -step : step)));
    }
  }

  return (
    <div
      className="splitter"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    />
  );
}
