import { describe, expect, it, vi } from "vitest";
import { widgetThemes } from "../src/themes";
import { resolveConfig } from "../src/core/config";
import { WidgetController } from "../src/core/controller";
import type { WidgetColors, WidgetConfig } from "../src/types";

const config: WidgetConfig = {
  projectId: `0x${"ab".repeat(32)}`,
  network: "testnet",
};
describe("semantic colors", () => {
  it("preserves light and dark defaults and legacy primaryColor", () => {
    expect(resolveConfig(config).colors).toMatchObject({
      surface: "#171a20",
      danger: "#f65959",
      primary: "#0099ff",
    });
    expect(resolveConfig({ ...config, theme: "light" }).colors).toMatchObject({
      surface: "#ffffff",
      danger: "#c93636",
    });
    expect(
      resolveConfig({ ...config, primaryColor: "#123456" }).colors.primary,
    ).toBe("#123456");
  });
  it("applies partial overrides with primary precedence and isolated defaults", () => {
    const a = resolveConfig({
      ...config,
      primaryColor: "#123456",
      colors: { primary: "#ABCDEF", text: "#112233" },
    });
    expect(a.colors.primary).toBe("#ABCDEF");
    expect(a.colors.text).toBe("#112233");
    expect(a.colors.surface).toBe("#171a20");
    a.colors.surface = "#000000";
    expect(resolveConfig(config).colors.surface).toBe("#171a20");
  });
  for (const key of Object.keys(
    resolveConfig(config).colors,
  ) as (keyof WidgetColors)[]) {
    it(`validates colors.${key}`, () => {
      for (const value of [
        "#fff",
        "#11223344",
        "red",
        "var(--host)",
        "",
        null,
        123,
      ]) {
        expect(() =>
          resolveConfig({
            ...config,
            colors: { [key]: value } as Partial<WidgetColors>,
          }),
        ).toThrow(
          expect.objectContaining({
            code: "INVALID_CONFIG",
            message: `colors.${key} must be a six-digit hex color.`,
          }),
        );
      }
    });
  }
  it("replaces overrides on update without refreshing protocol state", () => {
    const controller = new WidgetController({
      config: { ...config, colors: { primary: "#123456", text: "#abcdef" } },
    });
    const refresh = vi.spyOn(controller, "refresh");
    try {
      controller.update({
        config: { ...config, theme: "light", colors: { primary: "#654321" } },
      });
      expect(controller.config.colors.text).toBe("#192c43");
      controller.update({ config });
      expect(controller.config.colors.primary).toBe("#0099ff");
      expect(refresh).not.toHaveBeenCalled();
      expect(() =>
        controller.update({
          config: { ...config, colors: { primary: "red" } },
        }),
      ).toThrow();
      expect(controller.config.colors.primary).toBe("#0099ff");
    } finally {
      controller.destroy();
    }
  });
});

describe("theme presets", () => {
  it.each(Object.entries(widgetThemes))(
    "%s supplies a complete valid palette",
    (_name, preset) => {
      const resolved = resolveConfig({ ...config, ...preset });
      expect(resolved.theme).toBe(preset.theme);
      expect(resolved.colors).toEqual(preset.colors);
      expect(Object.keys(preset.colors).sort()).toEqual(
        Object.keys(widgetThemes.dark.colors).sort(),
      );
      for (const value of Object.values(preset.colors))
        expect(value).toMatch(/^#[\da-f]{6}$/i);
    },
  );
  it("keeps default palettes compatible and supports individual overrides", () => {
    for (const theme of ["light", "dark"] as const) {
      expect(resolveConfig({ ...config, theme }).colors).toEqual(
        widgetThemes[theme].colors,
      );
    }
    expect(
      resolveConfig({
        ...config,
        ...widgetThemes.midnight,
        colors: { ...widgetThemes.midnight.colors, primary: "#abcdef" },
      }).colors,
    ).toEqual({ ...widgetThemes.midnight.colors, primary: "#abcdef" });
  });
  it("protects shared presets and resolves independent copies", () => {
    expect(Object.isFrozen(widgetThemes)).toBe(true);
    for (const preset of Object.values(widgetThemes)) {
      expect(Object.isFrozen(preset)).toBe(true);
      expect(Object.isFrozen(preset.colors)).toBe(true);
      const resolved = resolveConfig({ ...config, ...preset });
      resolved.colors.primary = "#123456";
      expect(preset.colors.primary).not.toBe("#123456");
    }
  });
});
