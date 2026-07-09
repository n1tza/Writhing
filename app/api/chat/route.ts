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
          "- Make all the edits for a single user request in ONE response (you may call multiple tools at once). After your edits, stop. Do not keep adding more text unless the user asks again.",
          "",
        ];

  const docSection = [
    "=== CURRENT DOCUMENT ===",
    document.trim().length > 0 ? document : "(the document is empty)",
    "=== END DOCUMENT ===",
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
    selection = "",
    mode = "agent",
  }: {
    messages: UIMessage[];
    document?: string;
    selection?: string;
    mode?: ChatMode;
  } = await req.json();

  const result = streamText({
    model: openrouter(MODEL),
    system: systemPrompt(document, selection, mode),
    messages: await convertToModelMessages(messages),
    tools: mode === "ask" ? undefined : editorTools,
    stopWhen: isStepCount(6),
  });

  return result.toUIMessageStreamResponse();
}
