export interface BridgeIncomingMessage {
  platform: string;
  sessionKey: string;
  direction: string;
  sender: string;
  text: string;
  isGroup: boolean;
  ts: number;
  agentId?: string;
}

/** 某桌面 session 被 bridge 远程接管的元信息 */
export interface RcAttachmentInfo {
  sessionKey: string;
  platform: string;
  title?: string;
}

export interface BridgeSlice {
  /** 最新收到的 bridge 消息（ws-message-handler 写入，BridgePanel 订阅） */
  bridgeLatestMessage: BridgeIncomingMessage | null;
  /** 递增计数器，每次 bridge_status 事件 +1，代替 loadStatus 回调 */
  bridgeStatusTrigger: number;
  /**
   * 当前被 bridge 远程接管的桌面 session，key 为桌面 session 绝对路径。
   * 由 ws-message-handler 消费 bridge_rc_attached / bridge_rc_detached 事件维护。
   * 多个 bridge 端同时接管在一期被禁止（/rc 会拒绝已 attached 的再次 /rc），
   * 因此 value 总是单一 RcAttachmentInfo。
   */
  rcAttached: Record<string, RcAttachmentInfo>;
  /** 写入一条 bridge 消息 */
  addBridgeMessage: (msg: BridgeIncomingMessage) => void;
  /** 触发 bridge 状态重载 */
  triggerBridgeReload: () => void;
  /** 标记某桌面 session 正被 bridge 接管（ws bridge_rc_attached 触发） */
  setRcAttached: (sessionPath: string, info: RcAttachmentInfo) => void;
  /** 清除接管标记（ws bridge_rc_detached 触发） */
  clearRcAttached: (sessionPath: string) => void;
}

export const createBridgeSlice = (
  set: (partial: Partial<BridgeSlice> | ((s: BridgeSlice) => Partial<BridgeSlice>)) => void,
): BridgeSlice => ({
  bridgeLatestMessage: null,
  bridgeStatusTrigger: 0,
  rcAttached: {},
  addBridgeMessage: (msg) => set({ bridgeLatestMessage: msg }),
  triggerBridgeReload: () =>
    set((s) => ({ bridgeStatusTrigger: s.bridgeStatusTrigger + 1 })),
  setRcAttached: (sessionPath, info) => set((s) => ({
    rcAttached: { ...s.rcAttached, [sessionPath]: info },
  })),
  clearRcAttached: (sessionPath) => set((s) => {
    if (!(sessionPath in s.rcAttached)) return {};
    const next = { ...s.rcAttached };
    delete next[sessionPath];
    return { rcAttached: next };
  }),
});
