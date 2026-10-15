import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@/helpers": path.resolve(import.meta.dirname, "helpers"),
      "@": path.resolve(import.meta.dirname, "core"),
    },
    dedupe: ["react", "react-dom", "@headlessui/react"],
  },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
  },
});
