import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    environmentOptions: { jsdom: { url: "http://localhost/" } },
    // Node 25+ has its own localStorage global, unset without a file; let jsdom's show.
    execArgv: ["--no-experimental-webstorage"],
  },
});
