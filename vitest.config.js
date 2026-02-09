import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.js"],
    testTimeout: 120_000, // generous timeout for auth + real page interaction
    hookTimeout: 130_000, // beforeAll needs time for auth wait
  },
});
