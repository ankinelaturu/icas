/**
 * @file Catalog path helpers — keep capability ids and tenant names inside the registry root.
 *
 * Ids become directory names under `capabilities/`. Restrict the charset so
 * `../` or `/` cannot escape the injectable root. There is one base file per
 * id (`capability.json`); tenant names use the same charset for override files.
 */

const ID_PATTERN = /^[A-Za-z0-9._-]+$/;

/**
 * Return a catalog-safe capability id.
 *
 * Also used for tenant names in override filenames and for `baseCapability`
 * (the id only; no `@version` pin). The same charset keeps every path
 * segment inside the registry root.
 *
 * @throws {Error} When the id would escape the registry root
 */
export function assertCatalogId(id: string): string {
  if (!ID_PATTERN.test(id)) {
    throw new Error(`invalid capability id "${id}"`);
  }
  return id;
}
