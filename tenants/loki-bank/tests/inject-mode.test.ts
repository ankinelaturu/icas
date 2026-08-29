/**
 * @file Tests for inject overlay template vars.
 */

import { describe, expect, it } from "vitest";

import { overlayTemplateVars } from "../src/inject-mode.js";

describe("overlayTemplateVars", () => {
  it("hides dialogs and shows work when inject is off", () => {
    expect(overlayTemplateVars(undefined, "/x")).toEqual({
      waitStyle: "display:none",
      hitlStyle: "display:none",
      workStyle: "",
      dismissHref: "/x",
    });
  });

  it("shows hitl and hides work", () => {
    expect(overlayTemplateVars("hitl", "/x?inject=clear").hitlStyle).toBe("");
    expect(overlayTemplateVars("hitl", "/x?inject=clear").workStyle).toBe(
      "display:none",
    );
  });
});
