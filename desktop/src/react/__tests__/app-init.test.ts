import { beforeEach, describe, expect, it, vi } from 'vitest';

type MockState = Record<string, unknown>;

const mockState: MockState = {};

const mockHanaFetch = vi.fn();
const mockApplyAgentIdentity = vi.fn(async () => {});
const mockLoadAgents = vi.fn(async () => {});
const mockLoadAvatars = vi.fn();
const mockLoadSessions = vi.fn(async () => {});
const mockConnectWebSocket = vi.fn();
const mockGetWebSocket = vi.fn(() => null);
const mockSetStatus = vi.fn();
const mockLoadModels = vi.fn(async () => {});
const mockInitJian = vi.fn();
const mockLoadDeskFiles = vi.fn();
const mockLoadChannels = vi.fn();
const mockInitViewerEvents = vi.fn();
const mockUpdateLayout = vi.fn();
const mockInitErrorBusBridge = vi.fn();
const mockRefreshPluginUI = vi.fn();

vi.mock('../stores', () => ({
  useStore: {
    getState: () => mockState,
    setState: (patch: MockState | ((s: MockState) => MockState)) => {
      const next = typeof patch === 'function' ? patch(mockState) : patch;
      Object.assign(mockState, next);
    },
  },
}));

vi.mock('../hooks/use-hana-fetch', () => ({
  hanaFetch: mockHanaFetch,
}));

vi.mock('../stores/agent-actions', () => ({
  applyAgentIdentity: mockApplyAgentIdentity,
  loadAgents: mockLoadAgents,
  loadAvatars: mockLoadAvatars,
}));

vi.mock('../stores/session-actions', () => ({
  loadSessions: mockLoadSessions,
}));

vi.mock('../services/websocket', () => ({
  connectWebSocket: mockConnectWebSocket,
  getWebSocket: mockGetWebSocket,
}));

vi.mock('../utils/ui-helpers', () => ({
  setStatus: mockSetStatus,
  loadModels: mockLoadModels,
}));

vi.mock('../stores/desk-actions', () => ({
  initJian: mockInitJian,
  loadDeskFiles: mockLoadDeskFiles,
}));

vi.mock('../stores/channel-actions', () => ({
  loadChannels: mockLoadChannels,
}));

vi.mock('../stores/artifact-actions', () => ({
  initViewerEvents: mockInitViewerEvents,
}));

vi.mock('../components/SidebarLayout', () => ({
  updateLayout: mockUpdateLayout,
}));

vi.mock('../errors/error-bus-bridge', () => ({
  initErrorBusBridge: mockInitErrorBusBridge,
}));

vi.mock('../stores/plugin-ui-actions', () => ({
  refreshPluginUI: mockRefreshPluginUI,
}));

vi.mock('../../../../shared/error-bus.js', () => ({
  errorBus: { report: vi.fn() },
}));

vi.mock('../../../../shared/errors.js', () => ({
  AppError: { wrap: (x: unknown) => x },
}));

function jsonResponse(body: unknown): Response {
  return { json: async () => body } as unknown as Response;
}

describe('initApp bridge indicator', () => {
  beforeEach(() => {
    Object.keys(mockState).forEach(k => delete mockState[k]);
    mockHanaFetch.mockReset();
    mockApplyAgentIdentity.mockReset();
    mockLoadAgents.mockReset();
    mockLoadAvatars.mockReset();
    mockLoadSessions.mockReset();
    mockConnectWebSocket.mockReset();
    mockGetWebSocket.mockReset();
    mockSetStatus.mockReset();
    mockLoadModels.mockReset();
    mockInitJian.mockReset();
    mockLoadDeskFiles.mockReset();
    mockLoadChannels.mockReset();
    mockInitViewerEvents.mockReset();
    mockUpdateLayout.mockReset();
    mockInitErrorBusBridge.mockReset();
    mockRefreshPluginUI.mockReset();
    vi.resetModules();
  });

  it('treats wechat as a connected bridge when bootstrapping the sidebar dot', async () => {
    const listeners: Record<string, Array<(data?: unknown) => void>> = {};
    (globalThis as Record<string, unknown>).window = {
      addEventListener: vi.fn((type: string, cb: (data?: unknown) => void) => {
        listeners[type] ||= [];
        listeners[type].push(cb);
      }),
      platform: {
        getServerPort: vi.fn(async () => 62950),
        getServerToken: vi.fn(async () => 'token'),
        appReady: vi.fn(),
        onSettingsChanged: vi.fn(),
        openSettings: vi.fn(),
      },
      dispatchEvent: vi.fn(),
    };
    (globalThis as Record<string, unknown>).document = {
      addEventListener: vi.fn(),
    };
    (globalThis as Record<string, unknown>).i18n = {
      locale: 'zh-CN',
      defaultName: 'Hanako',
      load: vi.fn(async () => {}),
    };
    (globalThis as Record<string, unknown>).t = vi.fn((key: string) => key);

    mockHanaFetch
      .mockResolvedValueOnce(jsonResponse({ agent: 'Hanako', user: 'User', avatars: {} }))
      .mockResolvedValueOnce(jsonResponse({ locale: 'zh-CN', desk: { home_folder: null }, cwd_history: [] }))
      .mockResolvedValueOnce(jsonResponse({ jobs: [] }))
      .mockResolvedValueOnce(jsonResponse({
        telegram: { status: 'disconnected' },
        feishu: { status: 'disconnected' },
        qq: { status: 'disconnected' },
        wechat: { status: 'connected' },
      }));

    const { initApp } = await import('../app-init');
    await initApp();

    expect(mockState.bridgeDotConnected).toBe(true);
  });
});
