import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api/events": { target: "http://127.0.0.1:4317", timeout: 0 },
      "/api": { target: "http://127.0.0.1:4317" },
    },
  },
  test: { environment: "jsdom", restoreMocks: true },
});
