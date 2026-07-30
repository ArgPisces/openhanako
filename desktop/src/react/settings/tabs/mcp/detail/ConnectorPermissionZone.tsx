import React, { useState } from 'react';
import { SelectWidget, Toggle } from '@/ui';
import { SettingsRow } from '../../../components/SettingsRow';
import { ExpandableRow } from '../../../components/ExpandableRow';
import { NumberInput } from '../../../components/NumberInput';
import { t } from '../../../helpers';
import styles from '../../../Settings.module.css';
import type { McpConnector, McpPermissionMode } from '../types';

interface ConnectorPermissionZoneProps {
  connector: McpConnector;
  deferEnabled: boolean;
  deferThreshold: number;
  disabled: boolean;
  busy: boolean;
  onPermissionModeChange: (mode: McpPermissionMode) => void;
  onTrustReadOnlyChange: (trust: boolean) => void;
  onDeferChange: (patch: { deferEnabled?: boolean; deferThreshold?: number }) => void;
}

/**
 * Where the connector's review policy lives, plus the deferred-loading knobs.
 *
 * Deferred loading is global rather than per-connector, and the copy says so:
 * it sits behind a disclosure here because this is where a user comes looking
 * for it, not because it belongs to this connector.
 */
export function ConnectorPermissionZone({
  connector,
  deferEnabled,
  deferThreshold,
  disabled,
  busy,
  onPermissionModeChange,
  onTrustReadOnlyChange,
  onDeferChange,
}: ConnectorPermissionZoneProps) {
  const [threshold, setThreshold] = useState(deferThreshold);
  const locked = disabled || busy;
  const allowlist = connector.permissionMode === 'allowlist';

  return (
    <>
      <SettingsRow
        label={t('settings.mcp.permissionMode')}
        hint={t('settings.mcp.permissionModeHint')}
        control={(
          <SelectWidget
            value={connector.permissionMode || 'review-all'}
            disabled={locked}
            onChange={(value) => onPermissionModeChange(value as McpPermissionMode)}
            options={[
              { value: 'review-all', label: t('settings.mcp.permissionReviewAll') },
              { value: 'allowlist', label: t('settings.mcp.permissionAllowlist') },
            ]}
          />
        )}
      />
      <SettingsRow
        label={t('settings.mcp.trustReadOnly')}
        hint={t('settings.mcp.trustReadOnlyHint')}
        hintVariant="warn"
        control={(
          <Toggle
            on={connector.trustReadOnlyHint === true}
            // Only meaningful inside an allowlist: review-all reviews everything
            // regardless of what the server declares.
            disabled={locked || !allowlist}
            ariaLabel={t('settings.mcp.trustReadOnly')}
            onChange={onTrustReadOnlyChange}
          />
        )}
      />

      <ExpandableRow label={t('settings.mcp.deferTitle')}>
        <p className={styles['settings-form-hint']}>{t('settings.mcp.deferScopeNote')}</p>
        <SettingsRow
          label={t('settings.mcp.deferEnabled')}
          hint={t('settings.mcp.deferEnabledHint')}
          control={(
            <Toggle
              on={deferEnabled}
              disabled={locked}
              ariaLabel={t('settings.mcp.deferEnabled')}
              onChange={(on) => onDeferChange({ deferEnabled: on })}
            />
          )}
        />
        <SettingsRow
          label={t('settings.mcp.deferThreshold')}
          hint={t('settings.mcp.deferThresholdHint')}
          control={(
            <NumberInput
              value={threshold}
              min={1}
              step={1}
              precision="int"
              disabled={locked || !deferEnabled}
              onChange={(value) => {
                setThreshold(value);
                // A threshold below one is not a stricter setting, it is a
                // meaningless one; refuse rather than quietly substitute.
                if (Number.isSafeInteger(value) && value > 0) onDeferChange({ deferThreshold: value });
              }}
            />
          )}
        />
      </ExpandableRow>
    </>
  );
}
