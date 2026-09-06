/**
 * @file Tests for inject overlay template vars and message normalization.
 */

import { describe, expect, it } from "vitest";

import {
  CUSTOM_HITL_DISMISS,
  DEFAULT_HITL_BODY,
  DEFAULT_HITL_DISMISS,
  DEFAULT_WAIT_BODY,
  normalizeInjectMessage,
  overlayTemplateVars,
} from "../src/inject-mode.js";

describe("overlayTemplateVars", () => {
  it("hides dialogs and shows work when inject is off", () => {
    expect(overlayTemplateVars(undefined, "/x")).toEqual({
      waitStyle: "display:none",
      hitlStyle: "display:none",
      workStyle: "",
      dismissHref: "/x",
      waitBody: DEFAULT_WAIT_BODY,
      hitlBody: DEFAULT_HITL_BODY,
      hitlDismissLabel: DEFAULT_HITL_DISMISS,
    });
  });

  it("shows wait and hides work", () => {
    expect(overlayTemplateVars("wait", "/x?inject=clear").waitStyle).toBe("");
    expect(overlayTemplateVars("wait", "/x?inject=clear").workStyle).toBe(
      "display:none",
    );
  });

  it("uses custom wait body and keeps default HITL chrome unused", () => {
    const vars = overlayTemplateVars("wait", "/x", "Host is busy");
    expect(vars.waitBody).toBe("Host is busy");
    expect(vars.hitlBody).toBe(DEFAULT_HITL_BODY);
    expect(vars.hitlDismissLabel).toBe(DEFAULT_HITL_DISMISS);
  });

  it("uses custom HITL body and the human-interacted dismiss label", () => {
    const vars = overlayTemplateVars(
      "hitl",
      "/x",
      "Permission required to access loan details",
    );
    expect(vars.hitlBody).toBe("Permission required to access loan details");
    expect(vars.hitlDismissLabel).toBe(CUSTOM_HITL_DISMISS);
    expect(vars.waitBody).toBe(DEFAULT_WAIT_BODY);
  });
});

describe("normalizeInjectMessage", () => {
  it("returns undefined for blank input", () => {
    expect(normalizeInjectMessage("")).toBeUndefined();
    expect(normalizeInjectMessage("   ")).toBeUndefined();
  });

  it("collapses whitespace and caps length", () => {
    expect(normalizeInjectMessage("  a\n\tb  ")).toBe("a b");
    expect(normalizeInjectMessage("x".repeat(250))?.length).toBe(200);
  });
});
