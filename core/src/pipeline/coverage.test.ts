import { expect, it } from "vitest";
import { answerFact, expandGroup, gapQuestion, requirementCoveredByText } from "./coverage.js";

it("expands phrases to their distinctive words and drops generic ones", () => {
  expect(expandGroup(["Linux system administration"])).toEqual(["Linux system administration", "Linux"]);
  expect(expandGroup(["AWS"])).toEqual(["AWS"]);
});

it("treats keyword groups as alternatives", () => {
  const requirement = {
    id: "r",
    text: "Cloud platforms such as AWS, GCP or Azure",
    importance: "must" as const,
    keywords: [["cloud platforms"], ["AWS"], ["GCP"], ["Azure"]],
  };
  expect(requirementCoveredByText("Deployed services on AWS with Terraform.", requirement)).toBe(true);
  expect(requirementCoveredByText("Deployed services on a laptop.", requirement)).toBe(false);
  expect(
    requirementCoveredByText("Run Linux servers with systemd.", {
      ...requirement,
      keywords: [["Linux system administration"]],
    }),
  ).toBe(true);
});

it("asks with the short label and reads yes answers as facts", () => {
  expect(
    gapQuestion({
      id: "r",
      text: "Use container orchestration tools such as Kubernetes.",
      label: "Kubernetes",
      importance: "must",
      keywords: [],
    }),
  ).toBe("Have you worked with Kubernetes?");
  expect(answerFact("Yes: I run 2 Proxmox hosts")).toBe("I run 2 Proxmox hosts");
  expect(answerFact("yes")).toBe("Yes");
  expect(answerFact("no")).toBeNull();
  expect(answerFact("skip")).toBeNull();
});
