"use client";

import {
  useCallback,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import {
  clampMargin,
  LETTER_PAGE,
  PX_PER_IN,
  type Margins,
  type PageSettings,
} from "@/lib/pageSettings";

const RULER_HEIGHT = 26;
const PAGE_WIDTH = LETTER_PAGE.width; // 816px (8.5in @ 96dpi)
const TOTAL_HALVES = Math.round((PAGE_WIDTH / PX_PER_IN) * 2);
const SNAP_IN = 1 / 8;
/** Keep at least this much writable width (inches) between the margins. */
const MIN_CONTENT_IN = 1;

type DragTarget = "leftMargin" | "rightMargin" | "leftIndent" | "firstLine";

interface Tick {
  x: number;
  height: number;
  label: number | null;
}

// A tick every half inch: taller on whole inches, shorter on the halves.
function buildTicks(): Tick[] {
  const ticks: Tick[] = [];
  for (let i = 0; i <= TOTAL_HALVES; i++) {
    const inches = i / 2;
    const isInch = i % 2 === 0;
    ticks.push({
      x: inches * PX_PER_IN,
      height: isInch ? 7 : 4,
      // Label interior whole-inch marks only (skip the two page edges).
      label: isInch && inches > 0 && i < TOTAL_HALVES ? inches : null,
    });
  }
  return ticks;
}

const TICKS = buildTicks();

function snapInches(value: number): number {
  return Number((Math.round(value / SNAP_IN) * SNAP_IN).toFixed(3));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export default function Ruler({
  editor,
  margins,
  setPageSettings,
}: {
  editor: Editor;
  margins: Margins;
  setPageSettings: Dispatch<SetStateAction<PageSettings>>;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<DragTarget | null>(null);
  const indent = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => {
      const attrs = currentEditor.state.selection.$from.parent.attrs;
      const left = Number(attrs.leftIndent);
      const firstLine = Number(attrs.firstLineIndent);
      return {
        left: Number.isFinite(left) ? left : 0,
        firstLine: Number.isFinite(firstLine) ? firstLine : 0,
      };
    },
  });

  const leftPx = margins.left * PX_PER_IN;
  const rightBoundaryPx = PAGE_WIDTH - margins.right * PX_PER_IN;
  const leftIndentPx = leftPx + indent.left * PX_PER_IN;
  const firstLinePx = leftIndentPx + indent.firstLine * PX_PER_IN;

  const updateSelectedIndent = useCallback(
    (next: Partial<{ leftIndent: number; firstLineIndent: number }>) => {
      const { state, view } = editor;
      const { from, to } = state.selection;
      const tr = state.tr;

      state.doc.descendants((node, pos) => {
        if (node.type.name !== "paragraph" && node.type.name !== "heading") {
          return true;
        }
        const selected =
          from === to
            ? pos < from && pos + node.nodeSize >= from
            : pos < to && pos + node.nodeSize > from;
        if (selected) {
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...next });
        }
        return false;
      });

      if (tr.docChanged) view.dispatch(tr);
    },
    [editor],
  );

  const moveDrag = useCallback(
    (target: DragTarget, clientX: number) => {
      const track = trackRef.current;
      if (!track) return;
      const x = clientX - track.getBoundingClientRect().left;

      if (target === "leftIndent") {
        const contentWidth = (rightBoundaryPx - leftPx) / PX_PER_IN;
        const min = Math.max(-indent.firstLine, 0);
        const max =
          contentWidth - 0.25 - Math.max(indent.firstLine, 0);
        updateSelectedIndent({
          leftIndent: clamp(
            snapInches((x - leftPx) / PX_PER_IN),
            min,
            max,
          ),
        });
        return;
      }

      if (target === "firstLine") {
        const contentWidth = (rightBoundaryPx - leftPx) / PX_PER_IN;
        updateSelectedIndent({
          firstLineIndent: clamp(
            snapInches((x - leftIndentPx) / PX_PER_IN),
            -indent.left,
            contentWidth - indent.left - 0.25,
          ),
        });
        return;
      }

      setPageSettings((prev) => {
        if (target === "leftMargin") {
          const max =
            PAGE_WIDTH / PX_PER_IN -
            prev.margins.right -
            MIN_CONTENT_IN;
          return {
            ...prev,
            margins: {
              ...prev.margins,
              left: clampMargin(
                clamp(snapInches(x / PX_PER_IN), 0, max),
              ),
            },
          };
        }
        const max =
          PAGE_WIDTH / PX_PER_IN -
          prev.margins.left -
          MIN_CONTENT_IN;
        return {
          ...prev,
          margins: {
            ...prev.margins,
            right: clampMargin(
              clamp(
                snapInches((PAGE_WIDTH - x) / PX_PER_IN),
                0,
                max,
              ),
            ),
          },
        };
      });
    },
    [
      indent.firstLine,
      indent.left,
      leftIndentPx,
      leftPx,
      rightBoundaryPx,
      setPageSettings,
      updateSelectedIndent,
    ],
  );

  const finishDrag = () => {
    setDrag(null);
    editor.view.focus();
  };

  return (
    <div className="sticky top-0 z-20 bg-[var(--doc-canvas)]">
      <div className="flex justify-center px-6 pb-1 pt-2">
        <div
          ref={trackRef}
          className="relative select-none"
          style={{ width: PAGE_WIDTH, height: RULER_HEIGHT }}
        >
        {/* Subtle tick lines every half inch, with faint inch labels. */}
        <svg
          className="absolute inset-0 h-full w-full text-white/20"
          width={PAGE_WIDTH}
          height={RULER_HEIGHT}
        >
          {TICKS.map((tick, i) => (
            <line
              key={i}
              x1={tick.x}
              x2={tick.x}
              y1={RULER_HEIGHT}
              y2={RULER_HEIGHT - tick.height}
              stroke="currentColor"
              strokeWidth={1}
              shapeRendering="crispEdges"
            />
          ))}
          {TICKS.map((tick, i) =>
            tick.label === null ? null : (
              <text
                key={`l${i}`}
                x={tick.x}
                y={8}
                textAnchor="middle"
                className="fill-white/25"
                style={{ fontSize: 8.5 }}
              >
                {tick.label}
              </text>
            ),
          )}
        </svg>

        <MarginHandle
          side="left"
          x={leftPx}
          active={drag === "leftMargin"}
          onGrab={() => setDrag("leftMargin")}
          onDrag={(clientX) => moveDrag("leftMargin", clientX)}
          onRelease={finishDrag}
        />
        <MarginHandle
          side="right"
          x={rightBoundaryPx}
          active={drag === "rightMargin"}
          onGrab={() => setDrag("rightMargin")}
          onDrag={(clientX) => moveDrag("rightMargin", clientX)}
          onRelease={finishDrag}
        />
        <IndentHandle
          kind="firstLine"
          x={firstLinePx}
          value={indent.firstLine}
          active={drag === "firstLine"}
          onGrab={() => setDrag("firstLine")}
          onDrag={(clientX) => moveDrag("firstLine", clientX)}
          onRelease={finishDrag}
        />
        <IndentHandle
          kind="leftIndent"
          x={leftIndentPx}
          value={indent.left}
          active={drag === "leftIndent"}
          onGrab={() => setDrag("leftIndent")}
          onDrag={(clientX) => moveDrag("leftIndent", clientX)}
          onRelease={finishDrag}
        />
        </div>
      </div>
    </div>
  );
}

function MarginHandle({
  side,
  x,
  active,
  onGrab,
  onDrag,
  onRelease,
}: {
  side: "left" | "right";
  x: number;
  active: boolean;
  onGrab: () => void;
  onDrag: (clientX: number) => void;
  onRelease: () => void;
}) {
  const inches = side === "left" ? x / PX_PER_IN : (PAGE_WIDTH - x) / PX_PER_IN;
  return (
    <div
      role="slider"
      aria-label={`${side === "left" ? "Left" : "Right"} margin`}
      aria-valuenow={Number(inches.toFixed(2))}
      title={`${side === "left" ? "Left" : "Right"} margin: ${inches.toFixed(2)}"  (drag to adjust)`}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        onGrab();
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) onDrag(e.clientX);
      }}
      onPointerUp={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
        onRelease();
      }}
      onPointerCancel={onRelease}
      className="group absolute top-1/2 z-20 flex h-2.5 w-5 touch-none -translate-x-1/2 -translate-y-1/2 cursor-col-resize items-stretch justify-center"
      style={{ left: x }}
    >
      <span
        className={`w-px transition-colors ${
          active ? "bg-white/55" : "bg-white/25 group-hover:bg-white/45"
        }`}
      />
      <span
        className={`absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full transition-colors ${
          active ? "bg-white/70" : "bg-white/35 group-hover:bg-white/60"
        }`}
      />
      {active && <RulerValue value={inches} />}
    </div>
  );
}

function IndentHandle({
  kind,
  x,
  value,
  active,
  onGrab,
  onDrag,
  onRelease,
}: {
  kind: "leftIndent" | "firstLine";
  x: number;
  value: number;
  active: boolean;
  onGrab: () => void;
  onDrag: (clientX: number) => void;
  onRelease: () => void;
}) {
  const firstLine = kind === "firstLine";
  const label = firstLine ? "First-line indent" : "Left indent";

  return (
    <div
      role="slider"
      aria-label={label}
      aria-valuenow={Number(value.toFixed(2))}
      title={`${label}: ${value.toFixed(2)}"`}
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        onGrab();
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          onDrag(event.clientX);
        }
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        onRelease();
      }}
      onPointerCancel={onRelease}
      className={`group absolute z-10 flex h-2/5 w-6 touch-none -translate-x-1/2 cursor-col-resize justify-center ${
        firstLine ? "top-0 items-start" : "bottom-0 items-end"
      }`}
      style={{ left: x }}
    >
      <svg
        viewBox="0 0 12 8"
        className={`h-2.5 w-3 transition-colors ${
          active
            ? "text-white/75"
            : "text-white/35 group-hover:text-white/60"
        } ${firstLine ? "" : "rotate-180"}`}
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M1 1h10L6 7 1 1Z" />
      </svg>
      {!firstLine && (
        <span
          className={`absolute bottom-0 h-1 w-3 rounded-[1px] transition-colors ${
            active
              ? "bg-white/75"
              : "bg-white/35 group-hover:bg-white/60"
          }`}
        />
      )}
      {active && <RulerValue value={value} />}
    </div>
  );
}

function RulerValue({ value }: { value: number }) {
  return (
    <span className="pointer-events-none absolute left-1/2 top-[calc(100%+6px)] z-30 -translate-x-1/2 whitespace-nowrap rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-zinc-100 shadow-md ring-1 ring-white/10">
      {value.toFixed(3).replace(/\.?0+$/, "")}&quot;
    </span>
  );
}
