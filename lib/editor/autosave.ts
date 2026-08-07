import type { Editor } from "@tiptap/core";
import { extractBlocks } from "./extract-blocks";
import { createClient } from "@/lib/supabase/client";

/**
 * Persist the document: one immutable `document_versions` snapshot of the full
 * Tiptap JSON, plus a reconcile of `document_blocks` keyed by stable `blockId`
 * — present blocks upserted, absent ones soft-deleted.
 */
export async function saveDocument(
  editor: Editor,
  documentId: string,
): Promise<void> {
  const supabase = createClient();
  const fullJson = editor.getJSON();
  const blocks = extractBlocks(editor, documentId);

  const { data: version, error: versionError } = await supabase
    .from("document_versions")
    .insert({
      document_id: documentId,
      full_json: fullJson,
      // Monotonic across clients without a read-modify-write round trip.
      version_number: Date.now(),
    })
    .select("id")
    .single();

  if (versionError) throw versionError;

  // Not skipped when empty: clearing the document is exactly the case where
  // every remaining block needs to be soft-deleted.
  const { error: blocksError } = await supabase.rpc("save_document_blocks", {
    p_document_id: documentId,
    p_version_id: version.id,
    p_blocks: blocks.map((block) => ({
      id: block.id,
      block_type: block.blockType,
      content: block.content,
      parent_heading: block.parentHeading,
      position: block.position,
    })),
  });

  if (blocksError) throw blocksError;
}
