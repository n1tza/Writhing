"use client";

import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { type Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import { exportDocument, type ExportFormat } from "@/lib/export";
import {
  clampMargin,
  LINE_SPACING_OPTIONS,
  MARGIN_PRESETS,
  type Margins,
  type PageSettings,
} from "@/lib/pageSettings";

function ToolbarButton({
  onClick,
  active = false,
  disabled = false,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`flex h-8 w-8 items-center justify-center rounded-md text-zinc-300 transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${
        active
          ? "bg-white/[0.12] text-white"
          : "hover:bg-white/[0.07] hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div className="mx-1 h-5 w-px shrink-0 bg-white/10" />;
}

/** Small popover that closes on outside click / Escape. */
function Popover({
  open,
  onClose,
  children,
  align = "left",
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  align?: "left" | "right";
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      ref={ref}
      className={`absolute top-full z-30 mt-1 min-w-[10rem] overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--panel-elevated)] py-1 shadow-xl ${
        align === "right" ? "right-0" : "left-0"
      }`}
    >
      {children}
    </div>
  );
}

function MenuItem({
  onClick,
  active = false,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-white/[0.07] ${
        active ? "text-white" : "text-zinc-300"
      }`}
    >
      {children}
    </button>
  );
}

// Saturated inks that stay readable as text on a white page.
const TEXT_COLORS = [
  "#1b1b1b",
  "#6b7280",
  "#b91c1c",
  "#c2410c",
  "#a16207",
  "#15803d",
  "#1d4ed8",
  "#6d28d9",
];

// Light highlighter tones that keep black text legible on white.
const HIGHLIGHT_COLORS = [
  "#fde68a",
  "#a7f3d0",
  "#bae6fd",
  "#fbcfe8",
  "#ddd6fe",
  "#fecaca",
];

const FONT_FAMILIES: { label: string; value: string | null }[] = [
  { label: "Default", value: null },
  { label: "Sans Serif", value: "ui-sans-serif, system-ui, Arial, sans-serif" },
  { label: "Serif", value: "Georgia, ui-serif, serif" },
  { label: "Monospace", value: "ui-monospace, SFMono-Regular, Menlo, monospace" },
  { label: "Arial", value: "Arial, Helvetica, sans-serif" },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Times New Roman", value: "'Times New Roman', Times, serif" },
  { label: "Courier New", value: "'Courier New', Courier, monospace" },
];

// Font sizes are in points (pt), matching word processors and the PDF/DOCX
// export. 12pt is a standard body size (= 16px on screen at 96dpi).
const DEFAULT_FONT_SIZE = 12;
const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 30, 36, 48, 60, 72];

export default function EditorToolbar({
  editor,
  pageSettings,
  setPageSettings,
}: {
  editor: Editor;
  pageSettings: PageSettings;
  setPageSettings: Dispatch<SetStateAction<PageSettings>>;
}) {
  const [fontOpen, setFontOpen] = useState(false);
  const [sizeOpen, setSizeOpen] = useState(false);
  const [colorOpen, setColorOpen] = useState(false);
  const [highlightOpen, setHighlightOpen] = useState(false);
  const [pageOpen, setPageOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState<ExportFormat | null>(null);

  const state = useEditorState({
    editor,
    selector: ({ editor }) => ({
      canUndo: editor.can().chain().undo().run(),
      canRedo: editor.can().chain().redo().run(),
      isBold: editor.isActive("bold"),
      isItalic: editor.isActive("italic"),
      isUnderline: editor.isActive("underline"),
      isStrike: editor.isActive("strike"),
      isCode: editor.isActive("code"),
      isBulletList: editor.isActive("bulletList"),
      isOrderedList: editor.isActive("orderedList"),
      isBlockquote: editor.isActive("blockquote"),
      isCodeBlock: editor.isActive("codeBlock"),
      isLink: editor.isActive("link"),
      alignLeft: editor.isActive({ textAlign: "left" }),
      alignCenter: editor.isActive({ textAlign: "center" }),
      alignRight: editor.isActive({ textAlign: "right" }),
      alignJustify: editor.isActive({ textAlign: "justify" }),
      color: editor.getAttributes("textStyle").color as string | undefined,
      highlight: editor.getAttributes("highlight").color as string | undefined,
      fontFamily: editor.getAttributes("textStyle").fontFamily as
        | string
        | undefined,
      fontSize: editor.getAttributes("textStyle").fontSize as
        | string
        | undefined,
    }),
  });

  const chain = () => editor.chain().focus();

  const activeFont =
    FONT_FAMILIES.find((f) => f.value === state.fontFamily) ?? FONT_FAMILIES[0];

  const currentSize = state.fontSize
    ? parseInt(state.fontSize, 10)
    : DEFAULT_FONT_SIZE;

  const applyFontSize = (size: number) => {
    const clamped = Math.min(Math.max(size, 6), 96);
    chain().setFontSize(`${clamped}pt`).run();
  };

  const setLink = () => {
    const previous = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", previous ?? "https://");
    if (url === null) return;
    if (url.trim() === "") {
      chain().unsetLink().run();
      return;
    }
    chain().extendMarkRange("link").setLink({ href: url.trim() }).run();
  };

  const setMargin = (side: keyof Margins, value: number) => {
    setPageSettings((prev) => ({
      ...prev,
      margins: { ...prev.margins, [side]: clampMargin(value) },
    }));
  };

  const setLineHeight = (value: number) => {
    setPageSettings((prev) => ({ ...prev, lineHeight: value }));
  };

  const setParagraphSpacing = (value: number) => {
    const clamped = Number.isNaN(value) ? 0 : Math.min(Math.max(value, 0), 72);
    setPageSettings((prev) => ({ ...prev, paragraphSpacing: clamped }));
  };

  const applyPreset = (margins: Margins) => {
    setPageSettings((prev) => ({ ...prev, margins }));
  };

  const runExport = async (format: ExportFormat) => {
    setExportOpen(false);
    setExporting(format);
    try {
      await exportDocument(editor, format, pageSettings);
    } catch (err) {
      console.error("Export failed", err);
      window.alert("Sorry, the export failed. Please try again.");
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="sticky top-0 z-20 flex flex-wrap items-center gap-0.5 border-b border-[var(--border-subtle)] bg-[var(--panel-bg)]/95 px-2 py-1.5 backdrop-blur">
      <ToolbarButton
        title="Undo"
        onClick={() => chain().undo().run()}
        disabled={!state.canUndo}
      >
        <Icon path="M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-1" />
      </ToolbarButton>
      <ToolbarButton
        title="Redo"
        onClick={() => chain().redo().run()}
        disabled={!state.canRedo}
      >
        <Icon path="M11 14l5-5-5-5M16 9H5a5 5 0 0 0 0 10h1" />
      </ToolbarButton>

      <Divider />

      {/* Font family dropdown */}
      <div className="relative">
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setFontOpen((o) => !o)}
          className="flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm text-zinc-300 transition-colors hover:bg-white/[0.07] hover:text-white"
        >
          <span
            className="min-w-[6rem] text-left"
            style={{ fontFamily: activeFont.value ?? undefined }}
          >
            {activeFont.label}
          </span>
          <Chevron />
        </button>
        <Popover open={fontOpen} onClose={() => setFontOpen(false)}>
          {FONT_FAMILIES.map((font) => (
            <MenuItem
              key={font.label}
              active={activeFont.label === font.label}
              onClick={() => {
                if (font.value === null) chain().unsetFontFamily().run();
                else chain().setFontFamily(font.value).run();
                setFontOpen(false);
              }}
            >
              <span style={{ fontFamily: font.value ?? undefined }}>
                {font.label}
              </span>
            </MenuItem>
          ))}
        </Popover>
      </div>

      {/* Font size stepper + dropdown */}
      <div className="ml-1 flex items-center gap-0.5">
        <ToolbarButton
          title="Decrease font size"
          onClick={() => applyFontSize(currentSize - 1)}
        >
          <Icon path="M5 12h14" />
        </ToolbarButton>
        <div className="relative">
          <button
            type="button"
            title="Font size"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setSizeOpen((o) => !o)}
            className="flex h-8 w-10 items-center justify-center rounded-md text-sm text-zinc-200 transition-colors hover:bg-white/[0.07] hover:text-white"
          >
            {currentSize}
          </button>
          <Popover open={sizeOpen} onClose={() => setSizeOpen(false)}>
            <div className="max-h-64 overflow-y-auto">
              {FONT_SIZES.map((size) => (
                <MenuItem
                  key={size}
                  active={size === currentSize}
                  onClick={() => {
                    applyFontSize(size);
                    setSizeOpen(false);
                  }}
                >
                  {size}
                </MenuItem>
              ))}
            </div>
          </Popover>
        </div>
        <ToolbarButton
          title="Increase font size"
          onClick={() => applyFontSize(currentSize + 1)}
        >
          <Icon path="M12 5v14M5 12h14" />
        </ToolbarButton>
      </div>

      <Divider />

      <ToolbarButton
        title="Bold"
        active={state.isBold}
        onClick={() => chain().toggleBold().run()}
      >
        <span className="text-[15px] font-bold">B</span>
      </ToolbarButton>
      <ToolbarButton
        title="Italic"
        active={state.isItalic}
        onClick={() => chain().toggleItalic().run()}
      >
        <span className="text-[15px] font-serif italic">I</span>
      </ToolbarButton>
      <ToolbarButton
        title="Underline"
        active={state.isUnderline}
        onClick={() => chain().toggleUnderline().run()}
      >
        <span className="text-[15px] underline">U</span>
      </ToolbarButton>
      <ToolbarButton
        title="Strikethrough"
        active={state.isStrike}
        onClick={() => chain().toggleStrike().run()}
      >
        <span className="text-[15px] line-through">S</span>
      </ToolbarButton>
      <ToolbarButton
        title="Inline code"
        active={state.isCode}
        onClick={() => chain().toggleCode().run()}
      >
        <Icon path="M8 6l-5 6 5 6M16 6l5 6-5 6" />
      </ToolbarButton>

      <Divider />

      {/* Text color */}
      <div className="relative">
        <button
          type="button"
          title="Text color"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setColorOpen((o) => !o)}
          className="flex h-8 w-8 flex-col items-center justify-center rounded-md text-zinc-300 transition-colors hover:bg-white/[0.07] hover:text-white"
        >
          <span className="text-[13px] font-semibold leading-none">A</span>
          <span
            className="mt-0.5 h-1 w-4 rounded-sm"
            style={{ background: state.color ?? "#1b1b1b" }}
          />
        </button>
        <Popover open={colorOpen} onClose={() => setColorOpen(false)}>
          <div className="grid grid-cols-4 gap-1.5 p-2">
            {TEXT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                title={c}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  chain().setColor(c).run();
                  setColorOpen(false);
                }}
                className="h-6 w-6 rounded-md ring-1 ring-white/15 transition-transform hover:scale-110"
                style={{ background: c }}
              />
            ))}
          </div>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              chain().unsetColor().run();
              setColorOpen(false);
            }}
            className="w-full px-3 py-1.5 text-left text-sm text-zinc-300 transition-colors hover:bg-white/[0.07]"
          >
            Reset color
          </button>
        </Popover>
      </div>

      {/* Highlight */}
      <div className="relative">
        <button
          type="button"
          title="Highlight"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setHighlightOpen((o) => !o)}
          className="flex h-8 w-8 flex-col items-center justify-center rounded-md text-zinc-300 transition-colors hover:bg-white/[0.07] hover:text-white"
        >
          <Icon path="M4 20h16M13 4l4 4-8 8H5v-4l8-8z" className="h-4 w-4" />
        </button>
        <Popover open={highlightOpen} onClose={() => setHighlightOpen(false)}>
          <div className="grid grid-cols-3 gap-1.5 p-2">
            {HIGHLIGHT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                title={c}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  chain().setHighlight({ color: c }).run();
                  setHighlightOpen(false);
                }}
                className="h-6 w-6 rounded-md ring-1 ring-white/15 transition-transform hover:scale-110"
                style={{ background: c }}
              />
            ))}
          </div>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              chain().unsetHighlight().run();
              setHighlightOpen(false);
            }}
            className="w-full px-3 py-1.5 text-left text-sm text-zinc-300 transition-colors hover:bg-white/[0.07]"
          >
            Remove highlight
          </button>
        </Popover>
      </div>

      <Divider />

      <ToolbarButton
        title="Bullet list"
        active={state.isBulletList}
        onClick={() => chain().toggleBulletList().run()}
      >
        <Icon path="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
      </ToolbarButton>
      <ToolbarButton
        title="Numbered list"
        active={state.isOrderedList}
        onClick={() => chain().toggleOrderedList().run()}
      >
        <Icon path="M10 6h11M10 12h11M10 18h11M4 6h1v4M4 10h2M6 15.5A1.5 1.5 0 1 0 4.5 17H6l-2 2h2" />
      </ToolbarButton>
      <ToolbarButton
        title="Quote"
        active={state.isBlockquote}
        onClick={() => chain().toggleBlockquote().run()}
      >
        <Icon path="M6 17h3l2-4V7H5v6h3zM14 17h3l2-4V7h-6v6h3z" />
      </ToolbarButton>
      <ToolbarButton
        title="Code block"
        active={state.isCodeBlock}
        onClick={() => chain().toggleCodeBlock().run()}
      >
        <Icon path="M7 8l-4 4 4 4M17 8l4 4-4 4M14 4l-4 16" />
      </ToolbarButton>

      <Divider />

      <ToolbarButton
        title="Align left"
        active={state.alignLeft}
        onClick={() => chain().setTextAlign("left").run()}
      >
        <Icon path="M3 6h18M3 12h12M3 18h15" />
      </ToolbarButton>
      <ToolbarButton
        title="Align center"
        active={state.alignCenter}
        onClick={() => chain().setTextAlign("center").run()}
      >
        <Icon path="M3 6h18M6 12h12M4 18h16" />
      </ToolbarButton>
      <ToolbarButton
        title="Align right"
        active={state.alignRight}
        onClick={() => chain().setTextAlign("right").run()}
      >
        <Icon path="M3 6h18M9 12h12M6 18h15" />
      </ToolbarButton>
      <ToolbarButton
        title="Justify"
        active={state.alignJustify}
        onClick={() => chain().setTextAlign("justify").run()}
      >
        <Icon path="M3 6h18M3 12h18M3 18h18" />
      </ToolbarButton>

      <Divider />

      <ToolbarButton title="Link" active={state.isLink} onClick={setLink}>
        <Icon path="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
      </ToolbarButton>
      <ToolbarButton
        title="Horizontal rule"
        onClick={() => chain().setHorizontalRule().run()}
      >
        <Icon path="M3 12h18" />
      </ToolbarButton>
      <ToolbarButton
        title="Clear formatting"
        onClick={() => chain().unsetAllMarks().clearNodes().run()}
      >
        <Icon path="M4 7V5h13M9 5l-4 14M14 11l6 6M20 11l-6 6" />
      </ToolbarButton>

      <div className="ml-auto flex items-center gap-1 pl-2">
        {/* Page setup: margins + line/paragraph spacing */}
        <div className="relative">
          <button
            type="button"
            title="Page setup"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setPageOpen((o) => !o)}
            className="flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm text-zinc-300 transition-colors hover:bg-white/[0.07] hover:text-white"
          >
            <Icon
              path="M4 4h16v16H4zM4 8h16M8 4v16"
              className="h-4 w-4"
            />
            <span className="hidden sm:inline">Layout</span>
            <Chevron />
          </button>
          <Popover open={pageOpen} onClose={() => setPageOpen(false)} align="right">
            <div className="w-64 p-3">
              <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-zinc-500">
                Margins (inches)
              </div>
              <div className="mb-2 flex flex-wrap gap-1">
                {MARGIN_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => applyPreset(preset.margins)}
                    className="rounded-md border border-[var(--border-subtle)] px-2 py-1 text-xs text-zinc-300 transition-colors hover:bg-white/[0.07] hover:text-white"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <MarginField
                  label="Top"
                  value={pageSettings.margins.top}
                  onChange={(v) => setMargin("top", v)}
                />
                <MarginField
                  label="Bottom"
                  value={pageSettings.margins.bottom}
                  onChange={(v) => setMargin("bottom", v)}
                />
                <MarginField
                  label="Left"
                  value={pageSettings.margins.left}
                  onChange={(v) => setMargin("left", v)}
                />
                <MarginField
                  label="Right"
                  value={pageSettings.margins.right}
                  onChange={(v) => setMargin("right", v)}
                />
              </div>

              <div className="mb-1.5 mt-3 text-xs font-medium uppercase tracking-wide text-zinc-500">
                Line spacing
              </div>
              <div className="flex flex-wrap gap-1">
                {LINE_SPACING_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setLineHeight(option.value)}
                    className={`rounded-md border px-2 py-1 text-xs transition-colors ${
                      pageSettings.lineHeight === option.value
                        ? "border-white/20 bg-white/[0.12] text-white"
                        : "border-[var(--border-subtle)] text-zinc-300 hover:bg-white/[0.07] hover:text-white"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              <div className="mb-1.5 mt-3 text-xs font-medium uppercase tracking-wide text-zinc-500">
                Paragraph spacing (pt)
              </div>
              <input
                type="number"
                min={0}
                max={72}
                step={1}
                value={pageSettings.paragraphSpacing}
                onChange={(e) => setParagraphSpacing(e.target.valueAsNumber)}
                className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--panel-bg)] px-2 py-1 text-sm text-zinc-100 outline-none focus:border-white/25"
              />
            </div>
          </Popover>
        </div>

        <div className="relative">
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setExportOpen((o) => !o)}
            disabled={exporting !== null}
            className="flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-subtle)] px-3 text-sm text-zinc-200 transition-colors hover:bg-white/[0.07] hover:text-white disabled:opacity-50"
          >
            <Icon
              path="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"
              className="h-4 w-4"
            />
            {exporting ? "Exporting..." : "Export"}
            <Chevron />
          </button>
          <Popover
            open={exportOpen}
            onClose={() => setExportOpen(false)}
            align="right"
          >
            <MenuItem onClick={() => runExport("pdf")}>PDF (.pdf)</MenuItem>
            <MenuItem onClick={() => runExport("docx")}>Word (.docx)</MenuItem>
            <MenuItem onClick={() => runExport("markdown")}>
              Markdown (.md)
            </MenuItem>
            <MenuItem onClick={() => runExport("txt")}>Plain text (.txt)</MenuItem>
          </Popover>
        </div>
      </div>
    </div>
  );
}

function Icon({ path, className = "h-4 w-4" }: { path: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={path} />
    </svg>
  );
}

function MarginField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-zinc-400">
      <span className="w-12 shrink-0">{label}</span>
      <input
        type="number"
        min={0}
        max={3}
        step={0.1}
        value={value}
        onChange={(e) => onChange(e.target.valueAsNumber)}
        className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--panel-bg)] px-2 py-1 text-sm text-zinc-100 outline-none focus:border-white/25"
      />
    </label>
  );
}

function Chevron() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-3.5 w-3.5 opacity-70"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
