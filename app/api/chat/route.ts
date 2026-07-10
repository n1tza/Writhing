import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import {
  convertToModelMessages,
  isStepCount,
  streamText,
  type UIMessage,
} from "ai";
import { editorTools } from "@/lib/tools";

export const maxDuration = 30;

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

const MODEL = process.env.OPENROUTER_MODEL ?? "anthropic/claude-sonnet-4.5";

type ChatMode = "agent" | "ask";

function systemPrompt(
  document: string,
  documentHtml: string,
  selection: string,
  mode: ChatMode,
): string {
  const intro = [
    "You are Writhing, an AI writing partner embedded in a document editor (think Cursor, but for prose instead of code).",
    "You help the user draft, revise, expand, tighten, and restructure their writing.",
    "",
  ];

  const modeSection =
    mode === "ask"
      ? [
          "You are in ASK mode: you are READ-ONLY and cannot edit the document.",
          "Do NOT attempt to make edits. Instead, answer questions, give feedback, brainstorm, and suggest changes in the chat.",
          "If the user wants you to actually apply edits, tell them to switch to Agent mode.",
          "",
        ]
      : [
          "You are in AGENT mode: you can edit the document using tools:",
          "- editDocument: replace an exact snippet of existing text. The 'find' value MUST be copied verbatim from the current document, and should be a short, unique snippet.",
          "- insertText: add new text at the cursor or the end of the document.",
          "- rewriteDocument: replace the whole document (use sparingly, only for full rewrites).",
          "- planTasks: break a complex/multi-step request into an ordered task list.",
          "",
          "Formatting: the text you write in these tools is interpreted as Markdown, so you CAN format the writing. Use **bold**, *italic*, ~~strikethrough~~, `code`, headings (#, ##, ###), bullet lists (-), numbered lists (1.), and > blockquotes as appropriate. To format existing text (e.g. 'make X bold'), use editDocument with the same words wrapped in Markdown.",
          "",
          "MATCHING FONTS, SIZES, AND COLORS:",
          "- Below the plain-text document you are also given the document's HTML (=== DOCUMENT HTML ===). This shows the EXACT formatting in use: font families, font sizes, colors, highlights, bold/italic, and headings.",
          "- Whenever you add or change text, MATCH the formatting of the surrounding/comparable content. Inspect the HTML to see what font-family, font-size, and color similar elements use, and replicate them precisely.",
          "- PREFERRED WAY to apply a font/size/color: set the tool's `formatting` field ({ fontFamily, fontSize, color }). It is applied uniformly to EVERY paragraph you insert or replace. ALWAYS use this when your inserted text is more than one paragraph, or whenever the whole insertion shares one style. Copy fontFamily and fontSize verbatim from a comparable element in the DOCUMENT HTML (e.g. fontFamily: \"'Times New Roman', Times, serif\", fontSize: \"14px\").",
          "- Do NOT wrap multi-paragraph text in a single <span> — a span is inline and cannot cross paragraph breaks, so only the first paragraph would get styled. Use the `formatting` field instead.",
          "- Only use inline HTML for styling PART of a paragraph differently: `<span style=\"color: #f87171\">word</span>` for a colored word, or `<mark style=\"background-color: #fde68a\">word</mark>` for a highlight.",
          "- Example: if body text in the HTML uses `font-family: 'Times New Roman', Times, serif; font-size: 14px`, then to add three new body paragraphs, call insertText with the three paragraphs as plain Markdown AND formatting: { fontFamily: \"'Times New Roman', Times, serif\", fontSize: \"14px\" }.",
          "- If the document has no explicit font/size styling, just use plain Markdown and omit `formatting`.",
          "- 'Monospace' means an actual monospaced font family, e.g. fontFamily: \"ui-monospace, 'SF Mono', 'Cascadia Code', Menlo, Consolas, monospace\" — NOT Arial or any sans/serif font.",
          "- To restyle existing paragraphs (e.g. 'make the body monospace and white'), keep the same words but set the `formatting` field. Do one editDocument per paragraph (find that paragraph's exact text), or use rewriteDocument with `formatting` when restyling the entire document at once.",
          "",
          "TASK WORKFLOW (for complex or multi-step requests):",
          "- If a request has multiple distinct parts, or later steps depend on earlier ones, FIRST call planTasks with an ordered list of tasks — and call NOTHING else in that turn (no edits yet).",
          "- Order tasks so that any step depending on a previous one comes AFTER it. For example, renaming a heading must come BEFORE coloring that new heading, because you can only find-and-replace text that already exists in the document.",
          "- After planTasks, you will be prompted to complete ONE task at a time. For each prompt, make only that task's edits, then stop and wait. Do not jump ahead to other tasks.",
          "- Between tasks, the CURRENT DOCUMENT is refreshed to include the edits already accepted, so always copy 'find' snippets from the latest CURRENT DOCUMENT — never from text you proposed but that has not been applied yet.",
          "- For a single, simple request, skip planTasks and just make the edit.",
          "",
          "Guidelines:",
          "- When the user asks you to change the writing, make the edit with a tool rather than only describing it.",
          "- Prefer small, targeted editDocument calls over rewriting everything.",
          "- Each edit is shown to the user as a diff they can accept or reject, so keep edits focused and explain your reasoning briefly in the tool's 'reason'.",
          "- When the user just asks a question or wants feedback, answer in chat without calling a tool.",
          "- Match the user's voice and tone unless they ask you to change it.",
          "",
          "CRITICAL - avoiding duplication and loops:",
          "- The CURRENT DOCUMENT shown below is always the latest version, already including any edits the user has accepted. Trust it as the source of truth.",
          "- NEVER add text that already appears in the document. Before inserting, check that the content is not already present.",
          "- When continuing or extending writing, only add the NEW portion. Do not repeat existing sentences.",
          "- For a single request, make all the edits in ONE response (you may call multiple tools at once) unless you used planTasks, in which case make only the current task's edits. After your edits, stop. Do not keep adding more text unless the user asks again.",
          "- If an edit repeatedly fails because the 'find' text can't be located, STOP retrying the same snippet: re-read the CURRENT DOCUMENT and either copy a shorter exact snippet or take a different approach.",
          "",
        ];

  const docSection = [
    "=== CURRENT DOCUMENT ===",
    document.trim().length > 0 ? document : "(the document is empty)",
    "=== END DOCUMENT ===",
    "",
    "=== DOCUMENT HTML (shows the exact formatting: fonts, sizes, colors) ===",
    documentHtml.trim().length > 0 ? documentHtml : "(the document is empty)",
    "=== END DOCUMENT HTML ===",
    selection.trim().length > 0
      ? `\nThe user currently has this text selected:\n"""${selection}"""`
      : "",
  ];

  return [...intro, ...modeSection, ...docSection].join("\n");
}

export async function POST(req: Request) {
  const {
    messages,
    document = "",
    documentHtml = "",
    selection = "",
    mode = "agent",
  }: {
    messages: UIMessage[];
    document?: string;
    documentHtml?: string;
    selection?: string;
    mode?: ChatMode;
  } = await req.json();

  const result = streamText({
    model: openrouter(MODEL),
    system: systemPrompt(document, documentHtml, selection, mode),
    messages: await convertToModelMessages(messages),
    tools: mode === "ask" ? undefined : editorTools,
    stopWhen: isStepCount(8),
  });

  return result.toUIMessageStreamResponse();
}
