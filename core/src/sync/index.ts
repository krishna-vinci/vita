export type { SyncSuggestion } from "@vita/shared";
export { SyncConflictError } from "./context.js";
export { applySuggestions, pendingSyncSuggestions, suggestDownstream } from "./downstream.js";
export { promoteBullet } from "./promote.js";
export { syncStatus } from "./status.js";
