import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * One value kept in the URL (`?tab=letter`), so reload, Back and Forward keep it and links can be shared.
 * The default value is left out of the URL. `replace` (the default) makes a toggle not add a Back step;
 * pass `replace: false` for a real view the person expects Back to return to.
 */
export function useUrlParam<T extends string>(
  name: string,
  fallback: T,
  allowed?: readonly T[],
  { replace = true }: { replace?: boolean } = {},
): [T, (next: T) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get(name);
  const value = raw !== null && (!allowed || (allowed as readonly string[]).includes(raw)) ? (raw as T) : fallback;
  const set = useCallback(
    (next: T) =>
      setParams(
        (current) => {
          const copy = new URLSearchParams(current);
          if (next === fallback) copy.delete(name);
          else copy.set(name, next);
          return copy;
        },
        { replace },
      ),
    [name, fallback, replace, setParams],
  );
  return [value, set];
}

/** A yes/no switch kept in the URL (`?archived=1`). */
export function useUrlFlag(name: string, options?: { replace?: boolean }): [boolean, (on: boolean) => void] {
  const [value, set] = useUrlParam<"1" | "0">(name, "0", ["1", "0"], options);
  return [value === "1", (on) => set(on ? "1" : "0")];
}
