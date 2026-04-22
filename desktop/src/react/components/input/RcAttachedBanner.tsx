/**
 * RcAttachedBanner —— 当前桌面 session 正被 bridge 平台（TG / Feishu / ...）
 * 远程接管的提示横幅。
 *
 * 渲染条件：store.rcAttached 里存在当前 sessionPath 的条目
 * 位置：InputArea.tsx 里放在 input-wrapper 上方（与输入框等宽）
 * 样式：accent 减淡底色 + 圆角 + 流布局（把原本在上方的内容顶上去）
 *
 * 桌面用户输入不锁（用户决策），横幅仅作状态提示。
 */

import { useStore } from '../../stores';
import styles from './InputArea.module.css';

const PLATFORM_LABELS: Record<string, string> = {
  tg: 'Telegram',
  telegram: 'Telegram',
  feishu: '飞书',
  qq: 'QQ',
  wechat: '微信',
  bridge: 'Bridge',
};

function formatPlatform(platform: string): string {
  const lower = platform.toLowerCase();
  return PLATFORM_LABELS[lower] || platform;
}

export function RcAttachedBanner() {
  const currentSessionPath = useStore(s => s.currentSessionPath);
  const rcAttached = useStore(s => s.rcAttached);
  const info = currentSessionPath ? rcAttached[currentSessionPath] : null;
  if (!info) return null;

  const platform = formatPlatform(info.platform);

  return (
    <div className={styles['rc-attached-banner']} role="status" aria-live="polite">
      <span className={styles['rc-attached-icon']} aria-hidden="true">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      </span>
      <span className={styles['rc-attached-text']}>
        此会话正被 {platform} 远程接管中
      </span>
    </div>
  );
}
