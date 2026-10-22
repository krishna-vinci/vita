import { useQueryClient } from "@tanstack/react-query";
import type { InfoView } from "@vita/shared";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ApiError, api } from "@/api/client";
import { queryKeys, useCascade } from "@/api/queries";
import { readDraft, useJsonDraft } from "@/lib/use-draft";

export interface InfoContext {
  view: InfoView;
  /** Runs one write, then swaps in the fresh view. Throws a readable ApiError (a 409 reloads first). */
  mutate: (call: () => Promise<InfoView>) => Promise<InfoView>;
  /** Cards tell the page when they hold unsaved text, so leaving can be guarded. */
  reportDirty: (card: string, dirty: boolean) => void;
}
const Context = createContext<InfoContext | null>(null);
export const InfoProvider = Context.Provider;
export function useInfoContext(): InfoContext {
  const value = useContext(Context);
  if (!value) throw new Error("InfoProvider is missing");
  return value;
}

/** The mutate function for the page: saved toast, "Update resumes" when resumes went stale, 409 reload. */
export function useInfoMutate(): InfoContext["mutate"] {
  const client = useQueryClient();
  const cascade = useCascade();
  const updateResumes = useCallback(
    () =>
      cascade.mutate(undefined, {
        onSuccess: (result) => toast.success(`Updating ${result.jobIds.length} resume(s)…`),
        onError: (error) => toast.error(error instanceof Error ? error.message : "Could not update your resumes."),
      }),
    [cascade],
  );
  return useCallback(
    async (call) => {
      let view: InfoView;
      try {
        view = await call();
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          await client.invalidateQueries({ queryKey: queryKeys.info });
          throw new ApiError(
            409,
            error.code,
            error.code === "ambiguous"
              ? error.message
              : "This changed somewhere else, so Vita reloaded it. Your edits are kept here: check them and save again.",
          );
        }
        throw error;
      }
      client.setQueryData(queryKeys.info, view);
      void client.invalidateQueries({ queryKey: queryKeys.workspace });
      const stale = await client
        .fetchQuery({ queryKey: queryKeys.syncStatus, queryFn: ({ signal }) => api.sync.status(signal), staleTime: 0 })
        .then((status) => status.stale.length > 0)
        .catch(() => false);
      toast.success("Saved", stale ? { action: { label: "Update resumes", onClick: updateResumes } } : undefined);
      return view;
    },
    [client, updateResumes],
  );
}

/** A card's save state: saving, the last error's message, and a helper that runs a write. */
export function useCardSave() {
  const { mutate } = useInfoContext();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(
    async (call: () => Promise<InfoView>): Promise<InfoView | null> => {
      setSaving(true);
      setError(null);
      try {
        return await mutate(call);
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : "Could not save.");
        return null;
      } finally {
        setSaving(false);
      }
    },
    [mutate],
  );
  return { saving, error, run, clearError: () => setError(null) };
}

/**
 * Unsaved card text, kept per entity (`key` includes the entity id). `initial` is the saved copy;
 * `body` turns a draft into the comparable, trimmed shape that decides whether the card is dirty.
 */
export function useCardDraft<T>(key: string, initial: T, body: (draft: T) => unknown, card: string) {
  const { reportDirty } = useInfoContext();
  const draftKey = `info:${key}`;
  const [restored, setRestored] = useState(() => readDraft(draftKey) !== null);
  const [draft, setDraft, clear] = useJsonDraft<T>(draftKey, initial);
  const dirty = JSON.stringify(body(draft)) !== JSON.stringify(body(initial));
  useEffect(() => {
    reportDirty(card, dirty);
    return () => reportDirty(card, false);
  }, [card, dirty, reportDirty]);
  return useMemo(
    () => ({
      draft,
      set: (patch: Partial<T>) => setDraft((current) => ({ ...current, ...patch })),
      dirty,
      restored: restored && dirty,
      dismissRestored: () => setRestored(false),
      reset: () => {
        clear();
        setRestored(false);
      },
    }),
    [draft, setDraft, dirty, restored, clear],
  );
}
