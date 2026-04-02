// ── Platform Bridge API（preload → window.hana / window.platform）──

export interface PlatformApi {
  writeFile: (filePath: string, content: string) => Promise<boolean>;
  writeFileBinary: (filePath: string, base64Data: string) => Promise<boolean>;
  readFile: (filePath: string) => Promise<string | null>;
  readFileBase64: (filePath: string) => Promise<string | null>;
  // Additional methods exposed by preload are accessed dynamically
  [key: string]: unknown;
}

// ── Plugin Card Protocol ──

export interface PluginCardDetails {
  type: string;           // "iframe" | future types (e.g. "kuro")
  pluginId: string;
  route: string;
  title?: string;
  description: string;    // IM fallback / degradation text
  aspectRatio?: string;   // e.g. "16:9", "3:4", "1:1" — hint for initial container sizing
  [key: string]: unknown; // extensible: plugins can pass arbitrary data
}

// ── 插件 UI 信息 ──

export interface PluginPageInfo {
  pluginId: string;
  title: string | Record<string, string>;
  icon: string | null;
  routeUrl: string;
}

export interface PluginWidgetInfo {
  pluginId: string;
  title: string | Record<string, string>;
  icon: string | null;
  routeUrl: string;
}
