import { useCallback, useEffect, useRef, useState } from "react";

const prefix = "vita:draft:";

/** Reads a stored draft. Storage can be blocked or full, so a failure just means "nothing saved". */
export function readDraft(key: string): string | null {
  try {
    return sessionStorage.getItem(prefix + key);
  } catch {
    return null;
  }
}
export function writeDraft(key: string, value: string | null): void {
  try {
    if (value === null) sessionStorage.removeItem(prefix + key);
    else sessionStorage.setItem(prefix + key, value);
  } catch {
    /* Not remembered. */
  }
}

/**
 * Text the person has typed but not sent. It survives a reload and Back/Forward inside the tab,
 * per page and per resource id (put both in `key`). Call `clear` after a successful submit.
 */
export function useDraft(key: string, initial = ""): [string, (value: string) => void, () => void] {
  const [state, setState] = useState(() => ({ key, value: readDraft(key) ?? initial }));
  // A different resource shows its own draft.
  const value = state.key === key ? state.value : (readDraft(key) ?? initial);
  const latest = useRef({ key, initial });
  latest.current = { key, initial };
  useEffect(() => {
    setState((current) => (current.key === key ? current : { key, value: readDraft(key) ?? initial }));
  }, [key, initial]);
  const set = useCallback((next: string) => {
    const { key: at, initial: start } = latest.current;
    setState({ key: at, value: next });
    writeDraft(at, next === start ? null : next);
  }, []);
  const clear = useCallback(() => {
    const { key: at, initial: start } = latest.current;
    setState({ key: at, value: start });
    writeDraft(at, null);
  }, []);
  return [value, set, clear];
}

/** Same as `useDraft` for small structured values (choices, form fields). */
export function useJsonDraft<T>(key: string, initial: T): [T, (value: T | ((current: T) => T)) => void, () => void] {
  const [text, setText, clear] = useDraft(key, "");
  let value = initial;
  if (text) {
    try {
      value = JSON.parse(text) as T;
    } catch {
      /* A broken draft is ignored. */
    }
  }
  const current = useRef(value);
  current.current = value;
  const set = useCallback(
    (next: T | ((current: T) => T)) => {
      const resolved = typeof next === "function" ? (next as (current: T) => T)(current.current) : next;
      current.current = resolved;
      setText(JSON.stringify(resolved));
    },
    [setText],
  );
  return [value, set, clear];
}
