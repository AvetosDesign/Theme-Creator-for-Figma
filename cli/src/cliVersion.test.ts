import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getCliVersion } from "./cliVersion.ts";

describe("getCliVersion", () => {
  it("resolves the version from this package's own package.json", () => {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { name: string; version: string };
    expect(pkg.name).toBe("wp-figma-gen");
    expect(getCliVersion()).toBe(pkg.version);
  });

  it("returns a non-empty, cached string on repeated calls", () => {
    const first = getCliVersion();
    const second = getCliVersion();
    expect(first).toBe(second);
    expect(first.length).toBeGreaterThan(0);
  });
});
