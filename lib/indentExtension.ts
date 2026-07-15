import { Extension } from "@tiptap/core";

const INDENTED_NODES = ["paragraph", "heading"];

function cssLengthToInches(value: string): number {
  const match = value.trim().match(/^(-?\d*\.?\d+)(in|px)?$/);
  if (!match) return 0;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return 0;
  return match[2] === "px" ? amount / 96 : amount;
}

function readStyleInches(element: HTMLElement, property: string): number {
  const styles = element.getAttribute("style") ?? "";
  const match = styles.match(new RegExp(`${property}\\s*:\\s*([^;]+)`, "i"));
  return match ? cssLengthToInches(match[1]) : 0;
}

function inches(value: unknown): string | null {
  const amount = typeof value === "number" ? value : Number(value);
  return Number.isFinite(amount) && Math.abs(amount) > 0.001
    ? `${amount.toFixed(3)}in`
    : null;
}

/**
 * Persists paragraph ruler indents as inline styles so they survive local
 * storage and remain available to HTML-based exports.
 */
export const IndentExtension = Extension.create({
  name: "documentIndent",

  addGlobalAttributes() {
    return [
      {
        types: INDENTED_NODES,
        attributes: {
          leftIndent: {
            default: 0,
            parseHTML: (element) =>
              readStyleInches(element as HTMLElement, "margin-left"),
            renderHTML: (attributes) => {
              const value = inches(attributes.leftIndent);
              return value ? { style: `margin-left: ${value}` } : {};
            },
          },
          firstLineIndent: {
            default: 0,
            parseHTML: (element) =>
              readStyleInches(element as HTMLElement, "text-indent"),
            renderHTML: (attributes) => {
              const value = inches(attributes.firstLineIndent);
              return value ? { style: `text-indent: ${value}` } : {};
            },
          },
        },
      },
    ];
  },
});
