import type { TrackerStatus } from "@vita/shared";

export const statusLabel: Record<TrackerStatus, string> = {
  draft: "Drafting",
  ready: "Ready to send",
  applied: "Applied",
  screening: "Screening",
  interviewing: "Interviewing",
  offer: "Offer",
  accepted: "Accepted",
  rejected: "Not selected",
  withdrawn: "Withdrawn",
  ghosted: "No reply",
};
export const allStatuses = Object.keys(statusLabel) as TrackerStatus[];

/** Board columns: the quiet ones are grouped so the board stays readable on a phone. */
export const boardColumns: { title: string; statuses: TrackerStatus[] }[] = [
  { title: "Getting ready", statuses: ["draft", "ready"] },
  { title: "Applied", statuses: ["applied"] },
  { title: "Screening", statuses: ["screening"] },
  { title: "Interviewing", statuses: ["interviewing"] },
  { title: "Offer", statuses: ["offer", "accepted"] },
  { title: "Closed", statuses: ["rejected", "withdrawn", "ghosted"] },
];

export const today = (): string => new Date().toISOString().slice(0, 10);
export const isDue = (date: string | null): boolean => !!date && date.slice(0, 10) <= today();
