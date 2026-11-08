// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { buildSelector } from "../src/selector.ts";

describe("buildSelector", () => {
  it("prefers a unique id", () => {
    document.body.innerHTML = '<main><button id="go">Go</button></main>';
    expect(buildSelector(document.getElementById("go")!)).toBe("#go");
  });
  it("prefers stable test attributes", () => {
    document.body.innerHTML = '<main><button data-testid="cta">A</button><button>B</button></main>';
    expect(buildSelector(document.querySelector("[data-testid]")!)).toBe('button[data-testid="cta"]');
  });
  it("produces a selector that resolves back to the element", () => {
    document.body.innerHTML =
      '<main><section class="plans"><div class="card"><button class="btn">1</button></div><div class="card"><button class="btn">2</button></div></section></main>';
    const target = document.querySelectorAll("button")[1]!;
    const sel = buildSelector(target);
    expect(document.querySelectorAll(sel)).toHaveLength(1);
    expect(document.querySelector(sel)).toBe(target);
  });
  it("crosses open shadow roots", () => {
    document.body.innerHTML = '<x-card id="host"></x-card>';
    const host = document.getElementById("host")!;
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = '<span class="inner">hi</span>';
    const sel = buildSelector(root.querySelector("span")!);
    expect(sel).toBe("#host >>> span.inner");
  });
});
