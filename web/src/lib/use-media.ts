import { useEffect, useState } from "react";

/** Whether the window is at least `px` wide, kept current as it resizes. False where `matchMedia` is missing. */
export function useMinWidth(px: number): boolean {
  const query = `(min-width: ${px}px)`;
  const read = () => (typeof matchMedia === "function" ? matchMedia(query).matches : false);
  const [matches, setMatches] = useState(read);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const list = matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener?.("change", update);
    return () => list.removeEventListener?.("change", update);
  }, [query]);
  return matches;
}
