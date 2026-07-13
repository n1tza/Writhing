export const PAGE_SETTINGS_KEY = "writhing:pageSettings";

/** Pixels per CSS inch at 96dpi (the browser's reference resolution). */
export const PX_PER_IN = 96;
/** Twips (twentieths of a point) per inch, used by DOCX export. */
export const TWIPS_PER_IN = 1440;

/**
 * The canvas color behind the white page(s). Kept in sync with `--doc-canvas`
 * in globals.css so the pagination gaps blend into the surrounding canvas.
 */
export const DOC_CANVAS = "#26272b";

/** US Letter at 96dpi: 8.5in x 11in. */
export const LETTER_PAGE = {
  width: 8.5 * PX_PER_IN, // 816
  height: 11 * PX_PER_IN, // 1056
};

export interface Margins {
  /** In inches. */
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface PageSettings {
  /** Page margins, in inches. */
  margins: Margins;
  /** Line-height multiplier (e.g. 1.15, 1.5, 2). */
  lineHeight: number;
  /** Space after each paragraph, in points. */
  paragraphSpacing: number;
}

export const DEFAULT_PAGE_SETTINGS: PageSettings = {
  margins: { top: 1, bottom: 1, left: 1, right: 1 },
  lineHeight: 1.15,
  paragraphSpacing: 8,
};

export const MARGIN_PRESETS: { label: string; margins: Margins }[] = [
  { label: "Normal", margins: { top: 1, bottom: 1, left: 1, right: 1 } },
  { label: "Narrow", margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 } },
  { label: "Wide", margins: { top: 1, bottom: 1, left: 1.5, right: 1.5 } },
];

export const LINE_SPACING_OPTIONS: { label: string; value: number }[] = [
  { label: "Single", value: 1 },
  { label: "1.15", value: 1.15 },
  { label: "1.5", value: 1.5 },
  { label: "Double", value: 2 },
];

export function inToPx(inches: number): number {
  return Math.round(inches * PX_PER_IN);
}

export function inToTwips(inches: number): number {
  return Math.round(inches * TWIPS_PER_IN);
}

/** Clamp a margin (inches) to a sane printable range. */
export function clampMargin(inches: number): number {
  if (Number.isNaN(inches)) return 0;
  return Math.min(Math.max(inches, 0), 3);
}

function sanitize(raw: unknown): PageSettings {
  const base = DEFAULT_PAGE_SETTINGS;
  if (typeof raw !== "object" || raw === null) return base;
  const obj = raw as Record<string, unknown>;
  const m = (obj.margins ?? {}) as Record<string, unknown>;

  const num = (value: unknown, fallback: number) =>
    typeof value === "number" && Number.isFinite(value) ? value : fallback;

  return {
    margins: {
      top: clampMargin(num(m.top, base.margins.top)),
      bottom: clampMargin(num(m.bottom, base.margins.bottom)),
      left: clampMargin(num(m.left, base.margins.left)),
      right: clampMargin(num(m.right, base.margins.right)),
    },
    lineHeight: num(obj.lineHeight, base.lineHeight),
    paragraphSpacing: num(obj.paragraphSpacing, base.paragraphSpacing),
  };
}

export function loadPageSettings(): PageSettings {
  if (typeof window === "undefined") return DEFAULT_PAGE_SETTINGS;
  try {
    const stored = window.localStorage.getItem(PAGE_SETTINGS_KEY);
    if (!stored) return DEFAULT_PAGE_SETTINGS;
    return sanitize(JSON.parse(stored));
  } catch {
    return DEFAULT_PAGE_SETTINGS;
  }
}

export function savePageSettings(settings: PageSettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PAGE_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Ignore write failures (e.g. storage full or disabled).
  }
}
