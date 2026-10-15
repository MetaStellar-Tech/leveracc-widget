import type { ProjectInfo } from "../types";
import { invariant } from "./errors";
const defaults: readonly ProjectInfo[] = [
  {
    projectId:
      "0xb5aa45fa7dc556ccc2af82c0a6bb44407b32634c9b384862a27ccae5486fef91",
    name: "LeverAcc",
    logo: "https://app.leveracc.xyz/images/leveracc-logo.png",
    description: {
      en: "A trading and lending platform in the Hyperliquid ecosystem.",
      zh: "Hyperliquid 生态交易与借贷平台。",
    },
    repayUrl: "https://app.leveracc.xyz/en/borrow",
  },
  {
    projectId:
      "0x59be6da7a2e2ec60b55f1c2f9525aa3bd6c2b41fce0920633f89063b199115a8",
    name: "Owly",
    logo: "https://app.leveracc.xyz/images/integrators/owly.svg",
    description: {
      en: "Owly is the ultimate asset management layer on Hyperliquid, featuring AI-powered copy trading and automated strategies.",
      zh: "Owly 是 Hyperliquid 上的资产管理层，提供 AI 驱动的跟单交易和自动化策略。",
    },
    repayUrl: "https://app.owly.fi/accounts",
  },
];

export function resolveProjects(
  entries: readonly ProjectInfo[] = [],
): ProjectInfo[] {
  invariant(
    Array.isArray(entries),
    "INVALID_CONFIG",
    "projects must be an array.",
  );
  const result = new Map(
    defaults.map((p) => [
      p.projectId.toLowerCase(),
      { ...p, description: { ...p.description } },
    ]),
  );
  for (const entry of entries) {
    invariant(
      entry && /^0x[\da-f]{64}$/i.test(entry.projectId),
      "INVALID_CONFIG",
      "Invalid project ID.",
    );
    for (const key of ["name", "logo", "repayUrl"] as const) {
      invariant(
        entry[key] === undefined || typeof entry[key] === "string",
        "INVALID_CONFIG",
        `Invalid project ${key}.`,
      );
    }
    for (const key of ["logo", "repayUrl"] as const) {
      if (!entry[key]) continue;
      let valid = false;
      try {
        const u = new URL(entry[key]);
        valid = u.protocol === "https:" && !u.username && !u.password;
      } catch {}
      invariant(
        valid,
        "INVALID_CONFIG",
        `Project ${key} must be an absolute HTTPS URL.`,
      );
    }
    invariant(
      entry.description === undefined ||
        (entry.description !== null &&
          typeof entry.description === "object" &&
          !Array.isArray(entry.description) &&
          Object.entries(entry.description).every(
            ([key, value]) =>
              ["en", "zh"].includes(key) && typeof value === "string",
          )),
      "INVALID_CONFIG",
      "Invalid project description.",
    );
    const id = entry.projectId.toLowerCase();
    const previous = result.get(id);
    const supplied = Object.fromEntries(
      Object.entries(entry).filter(([, value]) => value !== undefined),
    );
    result.set(id, {
      ...previous,
      ...supplied,
      projectId: id as ProjectInfo["projectId"],
      description: { ...previous?.description, ...entry.description },
    });
  }
  return [...result.values()];
}
