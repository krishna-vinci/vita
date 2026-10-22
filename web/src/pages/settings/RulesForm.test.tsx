import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "@/api/client";
import { RulesForm } from "./RulesForm";

afterEach(cleanup);

it("saves the fill rule as a fraction of the page", async () => {
  vi.spyOn(api.rules, "get").mockResolvedValue({
    rules: { max_pages: 1, min_fill: 0.85 },
    effectiveRules: { max_pages: 1, min_fill: 0.85 },
    locked: false,
    hash: "h1",
  } as never);
  const save = vi.spyOn(api.rules, "save").mockResolvedValue({ rules: {}, hash: "h2", sha: null } as never);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <RulesForm />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const fill = await screen.findByLabelText("Fill at least (% of page)");
  expect((fill as HTMLInputElement).value).toBe("85");
  fireEvent.change(fill, { target: { value: "90" } });
  fireEvent.click(screen.getByRole("button", { name: "Save rules" }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ rules: expect.objectContaining({ max_pages: 1, min_fill: 0.9 }) }),
      expect.anything(),
    ),
  );
});

it("keeps How strict under a collapsed Advanced, and still saves its value", async () => {
  vi.spyOn(api.rules, "get").mockResolvedValue({
    rules: { max_pages: 1, min_fill: 0.85, honesty: "strict" },
    effectiveRules: { max_pages: 1, min_fill: 0.85, honesty: "strict" },
    locked: false,
    hash: "h1",
  } as never);
  const save = vi.spyOn(api.rules, "save").mockResolvedValue({ rules: {}, hash: "h2", sha: null } as never);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <RulesForm />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const advanced = await screen.findByRole("button", { name: "Advanced" });
  expect(advanced.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByRole("combobox", { name: "How strict" })).toBeNull();
  fireEvent.click(advanced);
  expect(advanced.getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByRole("combobox", { name: "How strict" }).textContent).toContain("Strict");
  fireEvent.click(screen.getByRole("button", { name: "Save rules" }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ rules: expect.objectContaining({ honesty: "strict" }) }),
      expect.anything(),
    ),
  );
});
