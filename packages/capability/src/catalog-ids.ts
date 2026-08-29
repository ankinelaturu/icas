/**
 * @file Catalog path helpers — keep capability ids, versions, and tenant names inside the registry root.
 */

const ID_PATTERN = /^[A-Za-z0-9._-]+$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

/**
 * Compare two three-part capability versions.
 *
 * @returns Negative when `a` is older, positive when `a` is newer, `0` when equal
 */
export function compareCapabilityVersion(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  for (let index = 0; index < 3; index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    if (delta !== 0) {
      return delta;
    }
  }
  return 0;
}

/**
 * Return a catalog-safe capability id.
 *
 * @throws {Error} When the id would escape the registry root
 */
export function assertCatalogId(id: string): string {
  if (!ID_PATTERN.test(id)) {
    throw new Error(`invalid capability id "${id}"`);
  }
  return id;
}

/**
 * Return a catalog-safe capability version.
 *
 * @throws {Error} When the version is not three-part semver
 */
export function assertCatalogVersion(version: string): string {
  if (!VERSION_PATTERN.test(version)) {
    throw new Error(`invalid capability version "${version}"`);
  }
  return version;
}

/**
 * Split a `baseCapability` pin (`id@version`) into catalog id and version.
 *
 * @throws {Error} When the pin is missing a three-part version
 */
export function parseBaseCapabilityPin(pin: string): {
  id: string;
  version: string;
} {
  const separator = pin.lastIndexOf("@");
  if (separator <= 0 || separator === pin.length - 1) {
    throw new Error(
      `baseCapability must pin a version, e.g. "loan-payoff@1.0.0"`,
    );
  }
  return {
    id: assertCatalogId(pin.slice(0, separator)),
    version: assertCatalogVersion(pin.slice(separator + 1)),
  };
}

function parseVersion(version: string): [number, number, number] {
  const parts = version.split(".");
  return [Number(parts[0]), Number(parts[1]), Number(parts[2])];
}
