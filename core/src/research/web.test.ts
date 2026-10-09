import { expect, it, vi } from "vitest";
import { fetchWebText, MAX_FETCH_BYTES } from "./web.js";

it("rejects unlisted URLs and redirects before fetching their destinations", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://private.test/secret" } }));
  await expect(fetchWebText("https://private.test/secret", ["https://allowed.test/"], fetcher)).rejects.toThrow(
    "allow-list",
  );
  expect(fetcher).not.toHaveBeenCalled();
  await expect(fetchWebText("https://allowed.test/", ["https://allowed.test/"], fetcher)).rejects.toThrow("allow-list");
  expect(fetcher).toHaveBeenCalledTimes(1);
  await expect(fetchWebText("file:///etc/passwd", [], fetcher)).rejects.toThrow("HTTP(S)");
});

it("enforces the byte cap for both declared and streamed sizes and refuses binary content", async () => {
  const fetcher = vi.fn<typeof fetch>();
  fetcher.mockResolvedValueOnce(new Response("small", { headers: { "content-length": String(MAX_FETCH_BYTES + 1) } }));
  await expect(fetchWebText("https://allowed.test/", ["https://allowed.test/"], fetcher)).rejects.toThrow("200 KB");
  fetcher.mockResolvedValueOnce(new Response("x".repeat(MAX_FETCH_BYTES + 1)));
  await expect(fetchWebText("https://allowed.test/", ["https://allowed.test/"], fetcher)).rejects.toThrow("200 KB");
  fetcher.mockResolvedValueOnce(new Response("binary", { headers: { "content-type": "application/pdf" } }));
  await expect(fetchWebText("https://allowed.test/", ["https://allowed.test/"], fetcher)).rejects.toThrow(
    "text content",
  );
});

it("extracts readable HTML, follows allow-listed redirects and handles cancellation", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "/doc" } }))
    .mockResolvedValueOnce(
      new Response("<style>bad</style><script>bad</script><p>Two &#50; &amp; receipts</p>", {
        headers: { "content-type": "text/html" },
      }),
    );
  expect(
    await fetchWebText("https://allowed.test/", ["https://allowed.test/", "https://allowed.test/doc"], fetcher),
  ).toBe("Two 2 & receipts");
  await expect(
    fetchWebText("https://allowed.test/", ["https://allowed.test/"], fetcher, AbortSignal.abort()),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(fetcher).toHaveBeenCalledTimes(2);
});
