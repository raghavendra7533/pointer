import { describe, expect, it } from "vitest";
import { isDependencyPath, normalizePath } from "../src/paths.ts";

describe("normalizePath", () => {
  it("handles dev-server URLs and query strings", () => {
    expect(normalizePath("http://localhost:5173/src/App.tsx?t=1699")).toBe("src/App.tsx");
    expect(normalizePath("/src/components/Card.vue")).toBe("src/components/Card.vue");
  });
  it("handles webpack schemes", () => {
    expect(normalizePath("webpack-internal:///(app-pages-browser)/./src/app/page.tsx")).toBe("src/app/page.tsx");
    expect(normalizePath("webpack://my-app/./src/index.js")).toBe("src/index.js");
  });
  it("strips the project root from absolute paths", () => {
    expect(normalizePath("/Users/me/proj/src/Card.tsx", "/Users/me/proj")).toBe("src/Card.tsx");
    expect(normalizePath("/@fs/Users/me/proj/src/Card.tsx", "/Users/me/proj/")).toBe("src/Card.tsx");
  });
  it("keeps unknown absolute paths when no root is configured", () => {
    expect(normalizePath("/Users/me/proj/src/Card.tsx")).toBe("/Users/me/proj/src/Card.tsx");
  });
  it("treats /app/... as a Next.js route path, not a filesystem path", () => {
    expect(normalizePath("/app/account/page.tsx")).toBe("app/account/page.tsx");
  });
  it("returns undefined for empty input and detects dependencies", () => {
    expect(normalizePath("  ")).toBeUndefined();
    expect(isDependencyPath("node_modules/foo/index.js")).toBe(true);
    expect(isDependencyPath("src/index.js")).toBe(false);
  });
});
