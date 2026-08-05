/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectorList } from '../ConnectorList';
import type { McpConnector } from '../types';

vi.mock('../../../helpers', () => {
  // Keys still render as themselves, which is what the label assertions below
  // rely on. Keys the component fills in carry a stand-in template with the
  // same placeholders as the shipped strings, substituted the way the real
  // translator does, so what the component computed can be asserted on.
  const templates: Record<string, string> = {
    'settings.mcp.toolCollisionNotice': '{a} and {b} collide',
  };
  return {
    t: (key: string, params?: Record<string, any>) => Object.entries(params || {}).reduce(
      (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
      templates[key] ?? key,
    ),
  };
});

function connector(overrides: Partial<McpConnector> = {}): McpConnector {
  return {
    id: 'alpha',
    name: 'Alpha',
    transport: 'remote',
    url: 'https://alpha.example.com/mcp',
    status: 'stopped',
    tools: [],
    ...overrides,
  };
}

function renderList(props: Partial<React.ComponentProps<typeof ConnectorList>> = {}) {
  const onOpen = vi.fn();
  const onAction = vi.fn();
  const onRemove = vi.fn();
  render(
    <ConnectorList
      connectors={[connector()]}
      globalEnabled
      busyKeys={new Set()}
      agentConfig={{ connectors: {} }}
      onOpen={onOpen}
      onAction={onAction}
      onRemove={onRemove}
      {...props}
    />,
  );
  return { onOpen, onAction, onRemove };
}

afterEach(cleanup);

describe('ConnectorList', () => {
  it('shows the runtime error a failed connector recorded', () => {
    renderList({
      connectors: [connector({ status: 'failed', error: 'spawn ENOENT' })],
    });

    // "failed" on its own says nothing actionable; the recorded reason is the
    // point of looking at the row.
    expect(screen.getByTestId('mcp-connector-error-alpha').textContent).toBe('spawn ENOENT');
  });

  it('does not render an error line for a healthy connector', () => {
    renderList({ connectors: [connector({ status: 'running' })] });

    expect(screen.queryByTestId('mcp-connector-error-alpha')).toBeNull();
  });

  it('names both sides of a dropped tool whose id is ambiguous', () => {
    renderList({
      connectors: [connector({
        status: 'running',
        collisions: [{
          canonical: 'alpha_moneyflow_hsgt',
          toolName: 'moneyflow_hsgt',
          otherConnectorId: 'alpha',
          otherToolName: 'moneyflow_hsgt_backup',
        }],
      })],
    });

    // Without the notice the tool is simply absent, which is indistinguishable
    // from a server that never offered it. Naming both claimants is what tells
    // the user which of the two names to change.
    const notice = screen.getByTestId('mcp-connector-collisions-alpha').textContent || '';
    expect(notice).toContain('alpha/moneyflow_hsgt');
    expect(notice).toContain('alpha/moneyflow_hsgt_backup');
  });

  it('renders no collision notice when nothing is ambiguous', () => {
    renderList({ connectors: [connector({ status: 'running' })] });

    expect(screen.queryByTestId('mcp-connector-collisions-alpha')).toBeNull();
  });

  it('opens the detail view when the row is clicked', () => {
    const { onOpen } = renderList();

    fireEvent.click(screen.getByTestId('mcp-connector-row-alpha'));

    expect(onOpen).toHaveBeenCalledWith('alpha');
  });

  it('opens the detail view from the keyboard', () => {
    const { onOpen } = renderList();

    fireEvent.keyDown(screen.getByTestId('mcp-connector-row-alpha'), { key: 'Enter' });

    expect(onOpen).toHaveBeenCalledWith('alpha');
  });

  it('hands removal to the caller rather than deciding by itself', () => {
    const { onRemove } = renderList();

    fireEvent.click(screen.getByText('common.remove'));

    // The row asks; the confirmation is a real dialog owned by the tab, not a
    // blocking window.confirm.
    expect(onRemove).toHaveBeenCalledWith('alpha');
  });

  it('keeps one connector busy from disabling another', () => {
    renderList({
      connectors: [connector(), connector({ id: 'beta', name: 'Beta' })],
      busyKeys: new Set(['start-alpha']),
    });

    const startButtons = screen.getAllByText('settings.mcp.start') as HTMLButtonElement[];
    expect(startButtons[0].disabled).toBe(true);
    expect(startButtons[1].disabled).toBe(false);
  });

  it('does not disable edit and remove through one shared key', () => {
    renderList({ busyKeys: new Set(['remove-alpha']) });

    const manage = screen.getByText('settings.mcp.manage') as HTMLButtonElement;
    const remove = screen.getByText('common.remove') as HTMLButtonElement;
    expect(remove.disabled).toBe(true);
    // Managing a connector is a read; a pending removal has no reason to block it.
    expect(manage.disabled).toBe(false);
  });

  it('counts the agents the connector is enabled for', () => {
    renderList({
      connectors: [connector({ tools: [{ name: 'search' }] })],
      agentConfig: { connectors: { alpha: { enabled: true } } },
    });

    expect(screen.getByText(/1 settings\.mcp\.enabledAgentsCount/)).toBeTruthy();
  });

  it('offers stop instead of start once the connector is live', () => {
    renderList({ connectors: [connector({ status: 'running' })] });

    expect(screen.queryByText('settings.mcp.start')).toBeNull();
    expect(screen.getByText('settings.mcp.stop')).toBeTruthy();
  });
});
