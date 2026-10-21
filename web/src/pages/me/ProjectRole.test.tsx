import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "@/api/client";
import { ProjectRole } from "./ProjectRole";

afterEach(cleanup);

function mount(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

it("shows the GitHub suggestion without saving it", async () => {
  vi.spyOn(api.research, "ownership").mockResolvedValue({
    suggestion: "sole",
    reason: "You made 92% of the commits.",
    ownerLogin: "krishna",
    userLogin: "krishna",
    commitShare: 0.92,
    contributors: 3,
  });
  const save = vi.spyOn(api.projects, "setRelationship");
  mount(<ProjectRole slug="app" repoUrl="https://github.com/krishna/app" />);
  expect(await screen.findByText(/Suggested: Sole developer\. You made 92% of the commits\./)).toBeTruthy();
  expect(api.research.ownership).toHaveBeenCalledWith("krishna/app", expect.anything());
  expect(save).not.toHaveBeenCalled();
});

it("asks for a contribution for Team member and saves it", async () => {
  vi.spyOn(api.research, "ownership").mockResolvedValue({
    suggestion: "unknown",
    reason: "",
    ownerLogin: "someone",
    userLogin: null,
    commitShare: null,
    contributors: 5,
  });
  const save = vi.spyOn(api.projects, "setRelationship").mockResolvedValue({ markdown: "", hash: null, sha: null });
  mount(<ProjectRole slug="app" repoUrl="https://github.com/someone/app" />);
  expect(screen.queryByLabelText("What did you build or own?")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Team member" }));
  fireEvent.change(screen.getByLabelText("What did you build or own?"), { target: { value: "Built the API" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith("app", { relationship: "team", contribution: "Built the API" }),
  );
});
