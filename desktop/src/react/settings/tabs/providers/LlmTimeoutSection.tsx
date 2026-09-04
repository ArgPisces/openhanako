import React, { useEffect, useState } from 'react';
import { useSettingsStore } from '../../store';
import { t, autoSaveGlobalModels } from '../../helpers';
import styles from '../../Settings.module.css';

/**
 * LLM 超时设置（供应商页「全局模型分配」下方）
 *
 * 两项运行时默认超时，保存即热生效（服务端推送模块默认值），无需重启平台：
 * - call_text_timeout_ms：callText 默认 fetch 超时（内置 60000）。历史 60s 硬编码
 *   钳制长任务（LLM_TIMEOUT 根因），现可调。
 * - bus_request_timeout_ms：EventBus request 默认等待（内置 30000）。插件经总线
 *   调用平台接口未显式传 timeout 时的上限。
 * 输入留空/非法 → 保存 null → 服务端重置为内置默认。
 */
export function LlmTimeoutSection() {
  const globalModelsConfig = useSettingsStore(s => s.globalModelsConfig);
  const timeouts = globalModelsConfig?.timeouts || {};

  const [callTextMs, setCallTextMs] = useState('');
  const [busMs, setBusMs] = useState('');

  // 配置加载/刷新后同步到输入框（未配置显示空 → 占位符展示内置默认）
  useEffect(() => {
    setCallTextMs(timeouts.call_text_timeout_ms != null ? String(timeouts.call_text_timeout_ms) : '');
    setBusMs(timeouts.bus_request_timeout_ms != null ? String(timeouts.bus_request_timeout_ms) : '');
  }, [timeouts.call_text_timeout_ms, timeouts.bus_request_timeout_ms]);

  // 提交单个字段：合法整数 → 保存毫秒数；清空 → 保存 null（恢复内置默认）
  const commit = (field: 'call_text_timeout_ms' | 'bus_request_timeout_ms', raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === '') {
      if (timeouts[field] == null) return; // 原本就是默认，无需保存
      autoSaveGlobalModels({ timeouts: { [field]: null } });
      return;
    }
    const n = Number(trimmed);
    if (!Number.isInteger(n) || n < 1000 || n > 600000) return; // 非法输入不提交（服务端也会拒绝）
    if (timeouts[field] === n) return;
    autoSaveGlobalModels({ timeouts: { [field]: n } });
  };

  return (
    <div style={{ padding: 'var(--space-16)' }}>
      <span className={styles['settings-form-hint']}>{t('settings.llmTimeout.sectionHint')}</span>
      <div className={styles['settings-form-grid']}>
        <div className={`${styles['settings-form-field']} ${styles['settings-form-field-half']}`}>
          <label className={styles['settings-form-label']}>{t('settings.llmTimeout.callTextTimeout')}</label>
          <input
            className={styles['settings-input']}
            value={callTextMs}
            inputMode="numeric"
            placeholder="60000"
            onChange={(e) => setCallTextMs(e.target.value)}
            onBlur={() => commit('call_text_timeout_ms', callTextMs)}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          />
          <span className={styles['settings-form-hint']}>{t('settings.llmTimeout.callTextTimeoutHint')}</span>
        </div>
        <div className={`${styles['settings-form-field']} ${styles['settings-form-field-half']}`}>
          <label className={styles['settings-form-label']}>{t('settings.llmTimeout.busRequestTimeout')}</label>
          <input
            className={styles['settings-input']}
            value={busMs}
            inputMode="numeric"
            placeholder="30000"
            onChange={(e) => setBusMs(e.target.value)}
            onBlur={() => commit('bus_request_timeout_ms', busMs)}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          />
          <span className={styles['settings-form-hint']}>{t('settings.llmTimeout.busRequestTimeoutHint')}</span>
        </div>
      </div>
    </div>
  );
}
