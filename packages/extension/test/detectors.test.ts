// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { resolveSource } from "../src/page/detectors.ts";

const ex = (el: Element, k: string, v: unknown) => ((el as any)[k] = v);

function mount(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body.firstElementChild as HTMLElement;
}

beforeEach(() => {
  delete (window as any).ng;
  delete (window as any).__POINTER_SOURCE__;
});

describe("React", () => {
  it("maps the chain, shifting _debugSource up to the owning component", () => {
    const btn = mount("<button>Go</button>");
    const app = { tag: 0, type: { name: "App" }, _debugSource: { fileName: "/src/main.tsx", lineNumber: 9 }, return: null };
    const card = { tag: 0, type: { name: "PricingCard" }, _debugSource: { fileName: "/src/App.tsx", lineNumber: 20 }, return: app };
    ex(btn, "__reactFiber$abc", { tag: 5, type: "button", _debugSource: { fileName: "/src/PricingCard.tsx", lineNumber: 42 }, return: card });
    const r = resolveSource(btn);
    expect(r.framework).toBe("react");
    expect(r.confidence).toBe("exact");
    expect(r.components).toEqual([
      { name: "PricingCard", file: "src/PricingCard.tsx", line: 42 },
      { name: "App", file: "src/App.tsx", line: 20 },
    ]);
  });

  it("supports memo/forwardRef and skips host and anonymous fibers", () => {
    const el = mount("<div></div>");
    const memo = { tag: 14, type: { type: { name: "Fancy" } }, return: { tag: 5, type: "div", return: { tag: 11, type: { render: { name: "Ref" } }, return: { tag: 0, type: { name: "Anonymous" }, return: null } } } };
    ex(el, "__reactFiber$x", { tag: 5, return: memo });
    expect(resolveSource(el).components.map((c) => c.name)).toEqual(["Fancy", "Ref"]);
  });

  it("is component-only with no file when React 19 gives no source", () => {
    const el = mount("<div></div>");
    ex(el, "__reactFiber$x", { tag: 5, return: { tag: 0, type: { name: "Card" }, return: null } });
    const r = resolveSource(el);
    expect(r.confidence).toBe("component-only");
    expect(r.components[0]).toEqual({ name: "Card" });
  });

  it("falls back to the creation stack for the file, without a trusted line", () => {
    const el = mount("<div></div>");
    const stack = ["Error", "    at jsxDEV (http://localhost:5173/node_modules/.vite/deps/react_jsx-dev-runtime.js?v=1:200:5)", "    at Card (http://localhost:5173/src/Card.tsx?t=17:12:7)"].join("\n");
    ex(el, "__reactFiber$x", { tag: 5, _debugStack: { stack }, return: { tag: 0, type: { name: "Card" }, return: null } });
    expect(resolveSource(el).components[0]).toEqual({ name: "Card", file: "src/Card.tsx" });
  });
});

describe("Vue", () => {
  it("reads Vue 3 component chain and __file", () => {
    const el = mount("<span></span>");
    const root = { type: { name: "App", __file: "src/App.vue" }, parent: null };
    ex(el, "__vueParentComponent", { type: { __name: "PricingCard", __file: "src/PricingCard.vue" }, parent: root });
    const r = resolveSource(el);
    expect(r.framework).toBe("vue");
    expect(r.confidence).toBe("exact");
    expect(r.components.map((c) => [c.name, c.file])).toEqual([["PricingCard", "src/PricingCard.vue"], ["App", "src/App.vue"]]);
  });
  it("reads Vue 2 via __vue__", () => {
    const el = mount("<span></span>");
    ex(el, "__vue__", { $options: { name: "Card", __file: "src/Card.vue" }, $parent: null });
    expect(resolveSource(el).components).toEqual([{ name: "Card", file: "src/Card.vue" }]);
  });
});

describe("Svelte", () => {
  it("reads __svelte_meta from an ancestor, including Svelte 5 parent chain", () => {
    const wrap = mount('<div><p id="t">x</p></div>');
    ex(wrap, "__svelte_meta", { loc: { file: "src/lib/Card.svelte", line: 8, column: 2 }, parent: { file: "src/routes/+page.svelte", line: 3, column: 0 } });
    const r = resolveSource(wrap.querySelector("#t")!);
    expect(r.framework).toBe("svelte");
    expect(r.components[0]).toEqual({ name: "Card", file: "src/lib/Card.svelte", line: 8, column: 2 });
    expect(r.components[1]?.file).toBe("src/routes/+page.svelte");
  });
});

describe("Angular", () => {
  it("walks owning components through the dev-mode ng global", () => {
    const host = mount('<app-shell><x-card id="t"></x-card></app-shell>');
    class Shell {}
    class Card {}
    (window as any).ng = {
      getOwningComponent: (e: Element) => (e.id === "t" ? new Card() : e.tagName === "APP-SHELL" ? null : new Shell()),
      getHostElement: (c: unknown) => (c instanceof Card ? host.querySelector("#t") : host),
    };
    const r = resolveSource(host.querySelector("#t")!);
    expect(r.framework).toBe("angular");
    expect(r.components.map((c) => c.name)).toContain("Card");
    expect(r.confidence).toBe("component-only");
  });
});

describe("attribute conventions (any compile-time plugin)", () => {
  it.each([
    ['<div data-astro-source-file="/src/pages/index.astro" data-astro-source-loc="12:5"></div>', "astro", "src/pages/index.astro", 12],
    ['<div data-v-inspector="src/App.vue:12:5"></div>', "vue", "src/App.vue", 12],
    ['<div data-insp-path="src/App.tsx:7:3:div"></div>', "source-inspector", "src/App.tsx", 7],
    ['<div data-inspector-relative-path="src/A.jsx" data-inspector-line="4" data-inspector-column="1"></div>', "source-inspector", "src/A.jsx", 4],
    ['<div data-source="src/Solid.tsx:30"></div>', "source-inspector", "src/Solid.tsx", 30],
  ])("%s", (html, fw, file, line) => {
    const el = mount(html);
    const r = resolveSource(el);
    expect(r.framework).toBe(fw);
    expect(r.components[0]).toMatchObject({ file, line });
    expect(r.confidence).toBe("exact");
  });
  it("finds the attribute on an ancestor", () => {
    const wrap = mount('<section data-source="src/Page.tsx:2"><p id="t">x</p></section>');
    expect(resolveSource(wrap.querySelector("#t")!).components[0]?.file).toBe("src/Page.tsx");
  });
});

describe("web components and the custom resolver", () => {
  it("names custom elements across shadow roots", () => {
    const host = mount('<my-card id="h"></my-card>');
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = '<button id="b">x</button>';
    const r = resolveSource(root.querySelector("#b")!);
    expect(r.framework).toBe("web-components");
    expect(r.components[0]?.name).toBe("my-card");
    expect(r.confidence).toBe("component-only");
  });

  it("lets any stack plug in with window.__POINTER_SOURCE__ and prefers the richer result", () => {
    const el = mount("<my-card><b id='t'>x</b></my-card>");
    (window as any).__POINTER_SOURCE__ = () => ({ framework: "solid", components: [{ name: "Card", file: "/src/Card.tsx", line: 5 }] });
    const r = resolveSource(el.querySelector("#t")!);
    expect(r.framework).toBe("solid");
    expect(r.components[0]).toEqual({ name: "Card", file: "src/Card.tsx", line: 5 });
  });

  it("ignores a throwing or malformed custom resolver", () => {
    const el = mount("<div></div>");
    (window as any).__POINTER_SOURCE__ = () => {
      throw new Error("boom");
    };
    expect(resolveSource(el).confidence).toBe("none");
    (window as any).__POINTER_SOURCE__ = () => ({ components: "nope" });
    expect(resolveSource(el).confidence).toBe("none");
  });
});

describe("no metadata", () => {
  it("returns none honestly", () => {
    expect(resolveSource(mount("<div></div>"))).toEqual({ framework: "none", components: [], confidence: "none" });
  });
});
