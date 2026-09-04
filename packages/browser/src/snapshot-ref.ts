/**
 * @file Snapshot-ref helpers — resolve a Playwright AI aria-ref on the live page.
 *
 * Discovery observes with `ariaSnapshot({ mode: "ai" })`, which stamps `[ref=eN]`
 * on interactable nodes. Those refs die with the session. This module locates
 * the live node for execute and can derive CSS/`label` identity. Catalog
 * phrases come from the model, not from the node's concatenated innerText.
 */

import { isSnapshotRef, type TargetDescriptor } from "@icas/capability";
import type { Locator, Page } from "playwright";

import { SurfaceError } from "./surface-error.js";

/**
 * ARIA roles that are too broad for a durable `roleText` locator.
 *
 * `generic` / `paragraph` / static `text` match too many nodes on a bank
 * screen. Prefer a labelled widget role, then inner text.
 */
const WEAK_ROLES = new Set([
  "generic",
  "none",
  "presentation",
  "text",
  "paragraph",
  "group",
  "list",
  "listitem",
  "document",
  "image",
]);

/**
 * Safe fragment for `#id` and `[name="…"]` selectors. Reject anything that
 * would need CSS escaping.
 */
const SAFE_CSS_IDENT = /^[A-Za-z][\w-]*$/;

/**
 * Tags that commonly carry a `name=` used as a durable CSS locator on core
 * banking screens (Helix `txtMember`, ICAS Bank `txtAcct`).
 */
const NAMED_CONTROL_TAGS = new Set(["input", "select", "textarea", "button"]);

/**
 * First line of a locator `ariaSnapshot()`: role plus optional quoted name.
 *
 * Playwright prints `- link "Payoff":` or `- button "Lending"`.
 */
const ARIA_ROOT_LINE =
  /^-\s+([A-Za-z0-9]+)(?:\s+"((?:\\.|[^"\\])*)")?/;

/**
 * Build a Playwright locator for a snapshot ref from the last AI observe.
 *
 * @param page - Open page that still holds the observe() aria-ref stamps
 * @param ref - `e12` or iframe-prefixed `f1e2`
 * @returns Locator for `aria-ref=<ref>`
 * @throws {SurfaceError} `TARGET_NOT_FOUND` when the token is not a snapshot ref
 */
export function locatorForSnapshotRef(page: Page, ref: string): Locator {
  if (!isSnapshotRef(ref)) {
    throw new SurfaceError(
      `TARGET_NOT_FOUND: invalid snapshot ref ${ref}`,
      "TARGET_NOT_FOUND",
    );
  }
  return page.locator(`aria-ref=${ref}`);
}

/**
 * Derive ranked catalog locators from the live node a snapshot ref resolved to.
 *
 * Prefers `roleText` using implicit/ARIA role plus accessible name (aria-label
 * or collapsed descendant text, matching the AI snapshot name). Adds CSS `#id`
 * and `[name=]` when those attributes are simple identifiers. Associated
 * `<label>` text becomes a `label` strategy. Falls back to visibleText.
 *
 * Empty unlabeled inputs have no accessible name. Core banking inquiry fields
 * still expose `name=` (`txtAcct`, `txtMember`); that is enough for a catalog
 * locator. Discovery also keeps the model's `relative` caption as a later rank.
 *
 * @param locator - Visible node from {@link locatorForSnapshotRef}
 * @returns Catalog target with at least one strategy
 * @throws {SurfaceError} `TARGET_NOT_FOUND` when no durable locator can be built
 */
export async function descriptorFromLocator(
  locator: Locator,
): Promise<TargetDescriptor> {
  const strategies: TargetDescriptor["strategies"] = [];
  const parsed = await roleAndNameFromNode(locator);
  if (
    parsed.name.length > 0 &&
    !WEAK_ROLES.has(parsed.role)
  ) {
    strategies.push({ type: "roleText", role: parsed.role, text: parsed.name });
  }
  if (parsed.id.length > 0 && SAFE_CSS_IDENT.test(parsed.id)) {
    strategies.push({ type: "css", selector: `#${parsed.id}` });
  }
  // Helix/ICAS Bank search fields: empty textbox, caption in a sibling cell,
  // identity on `name=` rather than `id` or aria-label.
  if (
    parsed.nameAttr.length > 0 &&
    SAFE_CSS_IDENT.test(parsed.nameAttr) &&
    NAMED_CONTROL_TAGS.has(parsed.tag)
  ) {
    strategies.push({
      type: "css",
      selector: `${parsed.tag}[name="${parsed.nameAttr}"]`,
    });
  }
  if (parsed.label.length > 0) {
    strategies.push({ type: "label", label: parsed.label });
  }
  if (strategies.length === 0 && parsed.name.length > 0) {
    strategies.push({ type: "visibleText", text: parsed.name });
  }
  if (strategies.length === 0) {
    throw new SurfaceError(
      "TARGET_NOT_FOUND: snapshot ref bound to a node with no durable locator",
      "TARGET_NOT_FOUND",
    );
  }
  return { strategies };
}

/**
 * Role, accessible name, and id from a live element.
 *
 * Do not call `locator.ariaSnapshot()` here: the default wait can consume the
 * full test timeout. Collapse descendant text the same way the AI snapshot
 * concatenates names (newlines become spaces).
 *
 * @param locator - Visible node
 */
async function roleAndNameFromNode(
  locator: Locator,
): Promise<{
  role: string;
  name: string;
  id: string;
  tag: string;
  nameAttr: string;
  label: string;
}> {
  return await locator.evaluate((el) => {
    const tag = el.tagName.toLowerCase();
    const type = el.getAttribute("type");
    const implicit =
      tag === "a"
        ? "link"
        : tag === "button"
          ? "button"
          : tag === "select"
            ? "combobox"
            : tag === "textarea"
              ? "textbox"
              : tag === "input"
                ? type === "checkbox"
                  ? "checkbox"
                  : type === "radio"
                    ? "radio"
                    : type === "submit" || type === "button"
                      ? "button"
                      : "textbox"
                : "generic";
    const role = el.getAttribute("role") ?? implicit;
    const labelled = el.getAttribute("aria-label");
    const raw =
      labelled !== null && labelled.length > 0
        ? labelled
        : el instanceof HTMLElement
          ? el.innerText
          : (el.textContent ?? "");
    const name = raw.replace(/\s+/g, " ").trim();
    const labelEl =
      "labels" in el && el.labels instanceof NodeList
        ? el.labels[0]
        : null;
    const label =
      labelEl instanceof HTMLElement
        ? labelEl.innerText.replace(/\s+/g, " ").trim()
        : "";
    return {
      role,
      name,
      id: el.id,
      tag,
      nameAttr: el.getAttribute("name") ?? "",
      label,
    };
  });
}

/**
 * Parse the root role and accessible name from a node's aria snapshot.
 *
 * @param snapshot - `locator.ariaSnapshot()` YAML
 * @returns Role and optional name, or undefined when the first line is not a node
 */
export function parseAriaRoot(
  snapshot: string,
): { role: string; name: string | undefined } | undefined {
  const first = snapshot.split("\n")[0]?.trim();
  if (first === undefined) {
    return undefined;
  }
  const match = ARIA_ROOT_LINE.exec(first);
  if (match === null) {
    return undefined;
  }
  const role = match[1];
  const rawName = match[2];
  if (role === undefined) {
    return undefined;
  }
  if (rawName === undefined) {
    return { role, name: undefined };
  }
  return { role, name: rawName.replace(/\\"/g, '"') };
}
