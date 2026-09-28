import type { WidgetThemeName } from "../dist/index.js";

export function ThemeSelector({
  value,
  onChange,
}: {
  value: WidgetThemeName;
  onChange: (name: WidgetThemeName) => void;
}) {
  return (
    <div className="theme-preview">
      <label htmlFor="theme">Widget theme</label>
      <select
        id="theme"
        value={value}
        onChange={(event) => onChange(event.target.value as WidgetThemeName)}
      >
        <option value="dark">Default dark · 默认暗色</option>
        <option value="light">Default light · 默认亮色</option>
        <option value="midnight">Midnight dark · 午夜蓝暗色</option>
        <option value="lavender">Lavender light · 薰衣草亮色</option>
      </select>
      <p>
        Switch themes to preview the widget instantly. 切换主题，即时预览效果。
      </p>
    </div>
  );
}
