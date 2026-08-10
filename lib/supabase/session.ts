import type { User } from "@supabase/supabase-js";
import { createClient } from "./client";

/**
 * The signed-in user, signing in anonymously if there isn't one.
 *
 * There is no sign-in UI yet, but every table keys off `auth.uid()`, so the
 * session has to be a real `auth.users` row rather than a placeholder. An
 * anonymous user can later be upgraded to an email account with
 * `linkIdentity()`, keeping every document and source it already owns — so
 * this is the temporary *interface*, not a temporary data model.
 *
 * `getUser()` validates against the server; `getSession()` only decodes what is
 * in cookie storage, and a stored session can outlive the user it names.
 */
export async function ensureUser(): Promise<User> {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) return user;

  // Drop any stale token first; signing in on top of one is not reliable.
  await supabase.auth.signOut({ scope: "local" }).catch(() => {});

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  if (!data.user) throw new Error("No Supabase user after sign-in");

  return data.user;
}
