// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { SessionConfirmationPrompt } from '../../components/input/SessionConfirmationPrompt';
import type { SessionConfirmationBlock } from '../../stores/chat-types';

const hanaFetchMock = vi.fn<(path: string, opts?: RequestInit) => Promise<Response>>(
  async () => new Response('{}', { status: 200 }),
);

vi.mock('../../hooks/use-hana-fetch', () => ({
  hanaFetch: (path: string, opts?: RequestInit) => hanaFetchMock(path, opts),
  hanaUrl: (path: string) => `http://127.0.0.1:3210${path}`,
}));

function elicitationBlock(requestedSchema: unknown): SessionConfirmationBlock {
  return {
    type: 'session_confirmation',
    confirmId: 'confirm-1',
    kind: 'mcp_elicitation',
    surface: 'input',
    status: 'pending',
    title: 'Remote Service',
    body: 'Please provide your GitHub username',
    subject: { label: 'Remote Service', detail: 'deploy' },
    severity: 'normal',
    actions: { confirmLabel: 'Approve', rejectLabel: 'Deny' },
    payload: {
      connectorName: 'Remote Service',
      toolName: 'deploy',
      message: 'Please provide your GitHub username',
      requestedSchema,
    },
  };
}

function lastConfirmBody() {
  const call = hanaFetchMock.mock.calls.at(-1);
  return JSON.parse(String(call?.[1]?.body));
}

describe('mcp_elicitation confirmation prompt', () => {
  beforeEach(() => {
    hanaFetchMock.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders one input per requested field and submits the collected values', async () => {
    render(
      <SessionConfirmationPrompt
        block={elicitationBlock({
          type: 'object',
          properties: {
            name: { type: 'string', title: 'Username' },
            age: { type: 'number', title: 'Age' },
            subscribe: { type: 'boolean', title: 'Subscribe' },
          },
          required: ['name'],
        })}
      />,
    );

    // The server's own explanation is what the user reads before answering.
    expect(screen.getByText('Please provide your GitHub username')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'octocat' } });
    fireEvent.change(screen.getByLabelText('Age'), { target: { value: '30' } });
    fireEvent.click(screen.getByLabelText('Subscribe'));
    fireEvent.click(screen.getByText('Approve'));

    await waitFor(() => expect(hanaFetchMock).toHaveBeenCalled());
    const [path] = hanaFetchMock.mock.calls.at(-1)!;
    expect(path).toBe('/api/confirm/confirm-1');
    expect(lastConfirmBody()).toEqual({
      action: 'confirmed',
      value: { name: 'octocat', age: 30, subscribe: true },
    });
  });

  it('rejects without collecting any values', async () => {
    render(<SessionConfirmationPrompt block={elicitationBlock({
      type: 'object',
      properties: { name: { type: 'string' } },
    })} />);

    fireEvent.click(screen.getByText('Deny'));

    await waitFor(() => expect(hanaFetchMock).toHaveBeenCalled());
    expect(lastConfirmBody()).toEqual({ action: 'rejected' });
  });

  it('refuses to submit a field type it cannot render', async () => {
    render(<SessionConfirmationPrompt block={elicitationBlock({
      type: 'object',
      properties: {
        name: { type: 'string', title: 'Username' },
        tags: { type: 'array', title: 'Tags' },
      },
    })} />);

    expect(screen.getByTestId('elicitation-unsupported')).toBeTruthy();
    // Submitting a form we cannot faithfully fill would send the server a
    // half-answer, so approval is blocked rather than silently incomplete.
    const approve = screen.getByText('Approve') as HTMLButtonElement;
    expect(approve.disabled).toBe(true);

    // Declining stays available: the user can always get out.
    fireEvent.click(screen.getByText('Deny'));
    await waitFor(() => expect(hanaFetchMock).toHaveBeenCalled());
    expect(lastConfirmBody()).toEqual({ action: 'rejected' });
  });

  it('falls back to the property name when the schema gives no title', () => {
    render(<SessionConfirmationPrompt block={elicitationBlock({
      type: 'object',
      properties: { github_login: { type: 'string' } },
    })} />);

    expect(screen.getByLabelText('github_login')).toBeTruthy();
  });

  it('leaves other confirmation kinds untouched', () => {
    render(
      <SessionConfirmationPrompt
        block={{
          ...elicitationBlock({ type: 'object', properties: { name: { type: 'string' } } }),
          kind: 'tool_action_approval',
        }}
      />,
    );

    expect(screen.queryByLabelText('name')).toBeNull();
  });
});
