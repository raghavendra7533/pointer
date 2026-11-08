// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { collectAttributes, sanitizeHtmlString, sanitizeUrl, serializeElement, truncate, visibleText } from "../src/sanitize.ts";
import { LIMITS } from "../src/schema.ts";

function el(html: string): Element {
  const d = document.createElement("div");
  d.innerHTML = html;
  return d.firstElementChild!;
}

describe("sanitizer", () => {
  it("replaces svg bodies and data: URIs with placeholders", () => {
    const out = sanitizeHtmlString('<div><svg viewBox="0 0 1 1"><path d="M0 0"/></svg><img src="data:image/png;base64,AAAA"></div>');
    expect(out).toContain('<svg viewBox="0 0 1 1">…</svg>');
    expect(out).not.toContain("<path");
    expect(out).toContain('src="data:…"');
    expect(out).not.toContain("AAAA");
  });

  it("truncates html to the cap", () => {
    expect(sanitizeHtmlString("<p>" + "x".repeat(9000) + "</p>").length).toBeLessThanOrEqual(LIMITS.html);
    expect(truncate("abcdef", 4)).toBe("abc…");
  });

  it("never serialises form values", () => {
    const form = el(
      '<form><input name="a" value="hunter2"><textarea>secret note</textarea><select><option selected value="x">X</option></select><input type="password" name="pw" value="p@ss" id="p"></form>',
    );
    const out = serializeElement(form);
    expect(out).not.toContain("hunter2");
    expect(out).not.toContain("secret note");
    expect(out).not.toContain("p@ss");
    expect(out).not.toContain('name="pw"');
    expect(out).toContain('type="password"');
  });

  it("masks the element itself when it is a password input", () => {
    const out = serializeElement(el('<input type="password" value="p@ss" name="pw">'));
    expect(out).toBe('<input type="password">');
  });

  it("does not collect values, inline handlers or data: payloads as attributes", () => {
    const attrs = collectAttributes(el('<input value="x" onclick="evil()" data-x="data:text/plain;base64,QUJD" class="a">'));
    expect(attrs).toEqual({ "data-x": "data:…", class: "a" });
  });

  it("returns no text for form controls", () => {
    expect(visibleText(el("<textarea>top secret</textarea>"))).toBe("");
    expect(visibleText(el("<p>  hello \n world </p>"))).toBe("hello world");
  });

  it("redacts secret-looking query params and drops credentials and hash", () => {
    const out = sanitizeUrl("http://u:p@localhost:3000/a?token=abc&page=2#frag");
    expect(out).toBe("http://localhost:3000/a?token=%5Bredacted%5D&page=2");
  });
});
