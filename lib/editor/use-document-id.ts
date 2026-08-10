"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ensureUser } from "@/lib/supabase/session";

const DOCUMENT_ID_KEY = "writhing:documentId";

/**
 * Resolve the document this browser is editing, creating it if needed.
 *
 * There is no sign-in UI yet, but `documents.user_id` references `auth.users`
 * and every RLS policy keys off it, so the session is established anonymously.
 * That is a real user row, which can later be upgraded to an email account
 * without orphaning any documents written in the meantime.
 */
async function ensureDocument(): Promise<string> {
  const supabase = createClient();
  const user = await ensureUser();

  const stored = window.localStorage.getItem(DOCUMENT_ID_KEY);
  if (stored) {
    // RLS scopes this to the current user, so a document belonging to a
    // previous anonymous session simply comes back empty and is replaced.
    const { data } = await supabase
      .from("documents")
      .select("id")
      .eq("id", stored)
      .maybeSingle();
    if (data) return data.id as string;
  }

  const { data, error } = await supabase
    .from("documents")
    .insert({ user_id: user.id })
    .select("id")
    .single();
  if (error) throw error;

  window.localStorage.setItem(DOCUMENT_ID_KEY, data.id as string);
  return data.id as string;
}

/**
 * The current document id, or undefined while it resolves — or permanently, if
 * Supabase is unreachable. Callers treat undefined as "persist locally only",
 * so a missing or misconfigured backend degrades instead of breaking editing.
 */
export function useDocumentId(): string | undefined {
  const [documentId, setDocumentId] = useState<string>();

  useEffect(() => {
    let cancelled = false;

    ensureDocument()
      .then((id) => {
        if (!cancelled) setDocumentId(id);
      })
      .catch((error) => {
        console.error(
          "Supabase persistence unavailable; editing locally only.",
          error,
        );
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return documentId;
}
