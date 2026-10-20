import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "next/link": path.resolve(import.meta.dirname, "app/compat/next/link.tsx"),
      "next/navigation": path.resolve(import.meta.dirname, "app/compat/next/navigation.ts"),
      "next/script": path.resolve(import.meta.dirname, "app/compat/next/script.tsx"),
      "@/helpers": path.resolve(import.meta.dirname, "helpers"),
      "@/plane-web": path.resolve(import.meta.dirname, "ce"),
      "@": path.resolve(import.meta.dirname, "core"),
    },
    dedupe: ["react", "react-dom", "@headlessui/react"],
  },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
  },
});
