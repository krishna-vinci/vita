import { useState } from "react";

/** "Show details" is remembered per browser, never required. */
export function useDetails(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem("vita:details") === "1";
    } catch {
      return false;
    }
  });
  return [
    on,
    (next) => {
      setOn(next);
      try {
        localStorage.setItem("vita:details", next ? "1" : "0");
      } catch {
        /* Not remembered. */
      }
    },
  ];
}
