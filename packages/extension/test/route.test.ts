// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { pickPageFile, resolvePageRoute } from "../src/page/route.ts";

const w = window as any;

function at(url: string) {
  w.happyDOM.setURL(url);
}

beforeEach(() => {
  for (const k of ["__NEXT_DATA__", "next", "__next_f", "__POINTER_PAGE__"]) delete w[k];
  document.head.innerHTML = "";
  at("http://localhost:3000/");
});

describe("pickPageFile", () => {
  it("takes the outermost component whose file is a route file", () => {
    expect(
      pickPageFile([
        { name: "AccountSheet", file: "src/components/AccountSheet.tsx" },
        { name: "AccountPage", file: "app/account/page.tsx" },
        { name: "RootLayout", file: "app/layout.tsx" },
      ]),
    ).toEqual({ file: "app/account/page.tsx", inferred: false });
  });
  it("recognises other route conventions and ignores plain components", () => {
    expect(pickPageFile([{ name: "Page", file: "src/routes/+page.svelte" }])?.file).toBe("src/routes/+page.svelte");
    expect(pickPageFile([{ name: "Card", file: "src/components/Card.tsx" }])).toBeNull();
    expect(pickPageFile([{ name: "NoFile" }])).toBeNull();
  });
});

describe("resolvePageRoute", () => {
  it("is null for an unknown stack", () => {
    expect(resolvePageRoute(window)).toBeNull();
  });
  it("trusts window.__POINTER_PAGE__ as a string or function, on any stack", () => {
    w.__POINTER_PAGE__ = "/src/routes/account.tsx";
    expect(resolvePageRoute(window)).toEqual({ file: "src/routes/account.tsx", inferred: false });
    w.__POINTER_PAGE__ = () => ({ file: "src/pages/Home.vue" });
    expect(resolvePageRoute(window)).toEqual({ file: "src/pages/Home.vue", inferred: false });
    w.__POINTER_PAGE__ = () => {
      throw new Error("boom");
    };
    expect(resolvePageRoute(window)).toBeNull();
  });
  it("Next.js pages router: exact route, unknown extension", () => {
    w.__NEXT_DATA__ = { page: "/dashboard/accounts/[id]" };
    expect(resolvePageRoute(window)).toEqual({ file: "pages/dashboard/accounts/[id].*", inferred: true });
    w.__NEXT_DATA__ = { page: "/" };
    expect(resolvePageRoute(window)?.file).toBe("pages/index.*");
  });
  it("Next.js app router: infers from the URL and masks data-looking segments", () => {
    w.next = {};
    at("http://localhost:3000/dashboard/accounts/41e10262-22e3-4fd4-843c-35730bf85c6d?from=signals");
    expect(resolvePageRoute(window)).toEqual({ file: "app/dashboard/accounts/[param]/page.*", inferred: true });
    at("http://localhost:3000/");
    expect(resolvePageRoute(window)?.file).toBe("app/page.*");
  });
});
