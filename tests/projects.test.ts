import { describe, expect, it } from "vitest";
import { resolveConfig } from "../src/core/config";
import { resolveProjects } from "../src/core/projects";
import type { Hex } from "viem";
const projectId = `0x${"ab".repeat(32)}` as Hex;
describe("project metadata", () => {
  it("merges case-insensitive overrides without losing translations", () => {
    const original = resolveProjects()[0];
    const result = resolveProjects([
      {
        projectId: original.projectId.toUpperCase() as Hex,
        name: "Custom",
        description: { zh: "自定义" },
        logo: "",
      },
    ]);
    expect(result[0]).toMatchObject({
      name: "Custom",
      logo: "",
      repayUrl: original.repayUrl,
      description: { en: original.description?.en, zh: "自定义" },
    });
    expect(resolveProjects()[0]).toEqual(original);
  });
  it("adds custom projects through widget configuration", () => {
    expect(
      resolveConfig({
        network: "testnet",
        projectId,
        projects: [{ projectId, name: "Partner" }],
      }).projects,
    ).toContainEqual({ projectId, name: "Partner", description: {} });
  });
  it.each([
    "javascript:alert(1)",
    "http://example.com",
    "https://user:secret@example.com",
    "/relative",
  ])("rejects unsafe URLs: %s", (repayUrl) => {
    expect(() => resolveProjects([{ projectId, repayUrl }])).toThrow();
    expect(() => resolveProjects([{ projectId, logo: repayUrl }])).toThrow();
  });
  it("rejects invalid IDs and description values", () => {
    expect(() => resolveProjects([{ projectId: "0x123" }])).toThrow();
    expect(() =>
      resolveProjects([{ projectId, description: { en: 123 } } as never]),
    ).toThrow();
  });
});
