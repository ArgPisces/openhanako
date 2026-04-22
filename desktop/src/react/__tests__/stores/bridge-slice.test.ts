import { describe, it, expect, beforeEach } from 'vitest';
import { createBridgeSlice, type BridgeSlice } from '../../stores/bridge-slice';

function makeSlice(): BridgeSlice {
  let state: BridgeSlice;
  const set = (partial: Partial<BridgeSlice> | ((s: BridgeSlice) => Partial<BridgeSlice>)) => {
    const patch = typeof partial === 'function' ? partial(state) : partial;
    state = { ...state, ...patch };
  };
  state = createBridgeSlice(set);
  return new Proxy({} as BridgeSlice, {
    get: (_, key: string) => (state as unknown as Record<string, unknown>)[key],
  });
}

describe('bridge-slice', () => {
  let slice: BridgeSlice;

  beforeEach(() => {
    slice = makeSlice();
  });

  it('初始状态', () => {
    expect(slice.bridgeLatestMessage).toBeNull();
    expect(slice.bridgeStatusTrigger).toBe(0);
  });

  it('addBridgeMessage 设置最新消息', () => {
    const msg = { platform: 'telegram', sessionKey: 'tg_123', direction: 'in', sender: 'user1', text: 'hello', isGroup: false, ts: Date.now() };
    slice.addBridgeMessage(msg);
    expect(slice.bridgeLatestMessage).toEqual(msg);
  });

  it('addBridgeMessage 连续调用覆盖前一条', () => {
    slice.addBridgeMessage({ platform: 'telegram', sessionKey: 'a', direction: 'in', sender: 'u1', text: '1', isGroup: false, ts: 1 });
    slice.addBridgeMessage({ platform: 'telegram', sessionKey: 'b', direction: 'out', sender: 'u2', text: '2', isGroup: false, ts: 2 });
    expect(slice.bridgeLatestMessage?.sessionKey).toBe('b');
    expect(slice.bridgeLatestMessage?.text).toBe('2');
  });

  it('triggerBridgeReload 递增计数器', () => {
    slice.triggerBridgeReload();
    expect(slice.bridgeStatusTrigger).toBe(1);
    slice.triggerBridgeReload();
    expect(slice.bridgeStatusTrigger).toBe(2);
  });

  it('addBridgeMessage 和 triggerBridgeReload 互不干扰', () => {
    slice.addBridgeMessage({ platform: 'telegram', sessionKey: 'x', direction: 'in', sender: 'u1', text: 'msg', isGroup: false, ts: 1 });
    slice.triggerBridgeReload();
    expect(slice.bridgeLatestMessage?.text).toBe('msg');
    expect(slice.bridgeStatusTrigger).toBe(1);
  });

  // ── Phase 2-D: rcAttached 态管理 ──

  it('rcAttached 初始为空对象', () => {
    expect(slice.rcAttached).toEqual({});
  });

  it('setRcAttached 按 sessionPath 写入接管信息', () => {
    slice.setRcAttached('/p/s.jsonl', { sessionKey: 'tg_dm_1@a1', platform: 'tg', title: '架构讨论' });
    expect(slice.rcAttached['/p/s.jsonl']).toEqual({
      sessionKey: 'tg_dm_1@a1', platform: 'tg', title: '架构讨论',
    });
  });

  it('setRcAttached 覆盖同 sessionPath 的旧条目', () => {
    slice.setRcAttached('/p/s.jsonl', { sessionKey: 'tg_dm_1@a1', platform: 'tg' });
    slice.setRcAttached('/p/s.jsonl', { sessionKey: 'feishu_dm_2@a1', platform: 'feishu' });
    expect(slice.rcAttached['/p/s.jsonl'].platform).toBe('feishu');
  });

  it('多 sessionPath 独立存在', () => {
    slice.setRcAttached('/p/a.jsonl', { sessionKey: 'k1', platform: 'tg' });
    slice.setRcAttached('/p/b.jsonl', { sessionKey: 'k2', platform: 'feishu' });
    expect(Object.keys(slice.rcAttached)).toEqual(expect.arrayContaining(['/p/a.jsonl', '/p/b.jsonl']));
  });

  it('clearRcAttached 删除指定 sessionPath', () => {
    slice.setRcAttached('/p/a.jsonl', { sessionKey: 'k1', platform: 'tg' });
    slice.setRcAttached('/p/b.jsonl', { sessionKey: 'k2', platform: 'feishu' });
    slice.clearRcAttached('/p/a.jsonl');
    expect(slice.rcAttached['/p/a.jsonl']).toBeUndefined();
    expect(slice.rcAttached['/p/b.jsonl']).toBeDefined();
  });

  it('clearRcAttached 对不存在的 sessionPath 是 no-op', () => {
    slice.setRcAttached('/p/a.jsonl', { sessionKey: 'k1', platform: 'tg' });
    slice.clearRcAttached('/p/nope.jsonl');
    expect(slice.rcAttached['/p/a.jsonl']).toBeDefined();
  });
});
