import type { PluginPageInfo, PluginWidgetInfo } from '../types';

export interface PluginUiSlice {
  pluginPages: PluginPageInfo[];
  pluginWidgets: PluginWidgetInfo[];
  tabOrder: string[];
  pinnedWidgets: string[];
  jianView: string;

  setPluginPages(pages: PluginPageInfo[]): void;
  setPluginWidgets(widgets: PluginWidgetInfo[]): void;
  setTabOrder(order: string[]): void;
  setPinnedWidgets(ids: string[]): void;
  setJianView(view: string): void;
}

export const createPluginUiSlice = (
  set: (partial: Partial<PluginUiSlice>) => void,
): PluginUiSlice => ({
  pluginPages: [],
  pluginWidgets: [],
  tabOrder: [],
  pinnedWidgets: [],
  jianView: 'desk',

  setPluginPages: (pages) => set({ pluginPages: pages }),
  setPluginWidgets: (widgets) => set({ pluginWidgets: widgets }),
  setTabOrder: (order) => set({ tabOrder: order }),
  setPinnedWidgets: (ids) => set({ pinnedWidgets: ids }),
  setJianView: (view) => set({ jianView: view }),
});
