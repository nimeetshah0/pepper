import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Mirrors Plasmo's `data-text:` import scheme so the content script test can read
// the stylesheet the same way the extension bundle does.
function dataText() {
  return {
    name: "data-text",
    resolveId(source: string, importer?: string) {
      if (!source.startsWith("data-text:") || !importer) return null;
      const file = resolve(
        dirname(importer),
        source.slice("data-text:".length),
      );
      return `\0data-text:${file}`;
    },
    load(id: string) {
      if (!id.startsWith("\0data-text:")) return null;
      const file = id.slice("\0data-text:".length);
      return `export default ${JSON.stringify(readFileSync(file, "utf8"))}`;
    },
  };
}

export default defineConfig({
  plugins: [dataText()],
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
