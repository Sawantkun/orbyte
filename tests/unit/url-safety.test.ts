import { describe, expect, it } from "vitest";
import { checkRequestUrl, isPrivateIPv4, isPrivateIPv6 } from "@/lib/workflow/url-safety";
import { extractRefs, templateVariables } from "@/lib/workflow/templates";

describe("url safety", () => {
  it.each([
    "http://127.0.0.1/",
    "http://10.1.2.3/",
    "http://172.16.0.1/",
    "http://192.168.1.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://0.0.0.0/",
    "http://2130706433/", // 127.0.0.1 as an integer
    "http://0x7f000001/",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[fd00::1]/",
    "http://metadata.google.internal/",
    "http://foo.localhost/",
    "ftp://example.com/",
    "javascript:alert(1)",
    "https://user:pass@example.com/",
    "",
  ])("blocks %s", (url) => {
    expect(checkRequestUrl(url).ok).toBe(false);
  });

  it.each(["https://api.openai.com/v1/models", "http://example.com/path?q={{topic}}", "https://8.8.8.8/"])("allows %s", (url) => {
    expect(checkRequestUrl(url)).toEqual({ ok: true, dynamicHost: false });
  });

  it("defers templated hosts to run time", () => {
    expect(checkRequestUrl("https://{{host}}/x")).toEqual({ ok: true, dynamicHost: true });
  });

  it("classifies IP ranges", () => {
    expect(isPrivateIPv4("100.64.0.1")).toBe(true);
    expect(isPrivateIPv4("100.128.0.1")).toBe(false);
    expect(isPrivateIPv6("2606:4700::1111")).toBe(false);
    expect(isPrivateIPv6("fe80::1")).toBe(true);
  });
});

describe("template references", () => {
  it("extracts roots and paths", () => {
    expect(extractRefs("Hi {{ name }} and {{text_1.text}} {{a.b.c}} {{bad-ref}}")).toEqual([
      { raw: "{{ name }}", root: "name", path: [] },
      { raw: "{{text_1.text}}", root: "text_1", path: ["text"] },
      { raw: "{{a.b.c}}", root: "a", path: ["b", "c"] },
    ]);
    expect(templateVariables("{{product_name}} for {{target_audience}}, {{product_name}}")).toEqual(["product_name", "target_audience"]);
  });
});
