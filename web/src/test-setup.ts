import { afterEach } from "vitest";

// Drafts and scroll positions live in sessionStorage; tests must not see each other's.
afterEach(() => {
  try {
    sessionStorage.clear();
  } catch {
    /* Storage is blocked in this test. */
  }
});
