import { type RefObject, useEffect } from "react";
import { useLocation } from "react-router-dom";

const prefix = "vita:scroll:";

/**
 * Puts a scrolling element back where it was (stored in this tab, under `key`) and remembers where it goes next.
 * Returns the cleanup. Storage can be blocked, in which case nothing is remembered.
 */
export function rememberScroll(element: HTMLElement, key: string, bottomByDefault = false): () => void {
  let frame = 0;
  let restore = 0;
  try {
    const saved = Number(sessionStorage.getItem(prefix + key));
    // Wait a frame so the content has its height before scrolling.
    if (saved > 0) restore = requestAnimationFrame(() => element.scrollTo?.({ top: saved }));
    else if (bottomByDefault) restore = requestAnimationFrame(() => element.scrollTo?.({ top: element.scrollHeight }));
  } catch {
    /* Not restored. */
  }
  const onScroll = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      try {
        sessionStorage.setItem(prefix + key, String(Math.round(element.scrollTop)));
      } catch {
        /* Not remembered. */
      }
    });
  };
  element.addEventListener("scroll", onScroll, { passive: true });
  return () => {
    cancelAnimationFrame(frame);
    cancelAnimationFrame(restore);
    element.removeEventListener("scroll", onScroll);
  };
}

/** The same for a pane that scrolls on its own (not the window), per route. Pass `ready` false until it has content. */
export function useScrollMemory(
  ref: RefObject<HTMLElement | null>,
  name: string,
  ready = true,
  bottomByDefault = false,
) {
  const { pathname } = useLocation();
  useEffect(() => {
    if (!ref.current || !ready) return;
    return rememberScroll(ref.current, `${name}:${pathname}`, bottomByDefault);
  }, [ref, name, pathname, ready, bottomByDefault]);
}

/**
 * React Router's `<ScrollRestoration />` scrolls once, when the route changes. Our pages fill in after their data
 * arrives, so the page is still short and the scroll is clamped to the top. This keeps the page's position per
 * path in this tab and re-applies it as the page grows, until the person scrolls themselves.
 */
export function useWindowScrollMemory() {
  const { pathname } = useLocation();
  useEffect(() => {
    const key = `${prefix}window:${pathname}`;
    let target = 0;
    try {
      target = Number(sessionStorage.getItem(key)) || 0;
    } catch {
      /* Not restored. */
    }
    let restoring = target > 0;
    let frame = 0;
    let save = 0;
    const stop = () => {
      restoring = false;
    };
    const started = performance.now();
    const step = () => {
      if (!restoring) return;
      window.scrollTo(0, target);
      // Done when we got there, or the page never grew enough.
      if (Math.abs(window.scrollY - target) < 2 || performance.now() - started > 4000) {
        restoring = false;
        return;
      }
      frame = requestAnimationFrame(step);
    };
    if (restoring) frame = requestAnimationFrame(step);
    const onScroll = () => {
      if (restoring) return;
      cancelAnimationFrame(save);
      save = requestAnimationFrame(() => {
        try {
          sessionStorage.setItem(key, String(Math.round(window.scrollY)));
        } catch {
          /* Not remembered. */
        }
      });
    };
    const events = ["wheel", "touchstart", "keydown", "mousedown"] as const;
    for (const name of events) window.addEventListener(name, stop, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(save);
      for (const name of events) window.removeEventListener(name, stop);
      window.removeEventListener("scroll", onScroll);
    };
  }, [pathname]);
}
