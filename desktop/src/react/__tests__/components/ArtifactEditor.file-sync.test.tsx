/**
 * @vitest-environment jsdom
 */
import { act, cleanup, render } from '@testing-library/react';
import { Transaction } from '@codemirror/state';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArtifactEditor, type ArtifactEditorHandle } from '../../components/ArtifactEditor';
import type { PlatformApi } from '../../types';

vi.mock('../../utils/checkpoints', () => ({
  requestUserEditCheckpoint: vi.fn(async () => undefined),
}));

describe('ArtifactEditor file sync', () => {
  let fileChangedHandler: ((filePath: string) => void) | null;
  let platform: Pick<
    PlatformApi,
    'readFile' | 'writeFile' | 'writeFileIfUnchanged' | 'watchFile' | 'unwatchFile' | 'onFileChanged'
  >;

  beforeEach(() => {
    vi.useFakeTimers();
    fileChangedHandler = null;
    window.t = ((key: string) => key) as typeof window.t;
    Range.prototype.getClientRects = vi.fn(() => [] as unknown as DOMRectList);
    Range.prototype.getBoundingClientRect = vi.fn(() => ({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
      toJSON: () => ({}),
    }));
    platform = {
      readFile: vi.fn(async () => 'external update'),
      writeFile: vi.fn(async () => true),
      writeFileIfUnchanged: vi.fn(async () => ({
        ok: true,
        conflict: false,
        version: { mtimeMs: 2, size: 10, sha256: 'next' },
      })),
      watchFile: vi.fn(async () => true),
      unwatchFile: vi.fn(async () => true),
      onFileChanged: vi.fn((handler: (filePath: string) => void) => {
        fileChangedHandler = handler;
      }),
    };
    window.platform = platform as PlatformApi;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('does not autosave content that arrived from a file watcher reload', async () => {
    const ref = createRef<ArtifactEditorHandle>();

    render(
      <ArtifactEditor
        ref={ref}
        content="original"
        filePath="/tmp/hana-note.md"
        mode="markdown"
      />,
    );

    await act(async () => {
      fileChangedHandler?.('/tmp/hana-note.md');
      await Promise.resolve();
    });

    expect(ref.current?.getView()?.state.doc.toString()).toBe('external update');

    await act(async () => {
      vi.advanceTimersByTime(700);
      await Promise.resolve();
    });

    expect(platform.writeFile).not.toHaveBeenCalled();
  });

  it('saves user edits with the file version that was last loaded from disk', async () => {
    const ref = createRef<ArtifactEditorHandle>();
    const fileVersion = { mtimeMs: 1, size: 8, sha256: 'loaded' };
    const nextVersion = { mtimeMs: 2, size: 10, sha256: 'next' };
    const onContentChange = vi.fn();
    vi.mocked(platform.writeFileIfUnchanged!).mockResolvedValueOnce({
      ok: true,
      conflict: false,
      version: nextVersion,
    });

    render(
      <ArtifactEditor
        ref={ref}
        content="original"
        filePath="/tmp/hana-note.md"
        fileVersion={fileVersion}
        mode="markdown"
        onContentChange={onContentChange}
      />,
    );

    await act(async () => {
      ref.current?.getView()?.dispatch({
        changes: { from: 0, to: 'original'.length, insert: 'user edit' },
        annotations: Transaction.userEvent.of('input.type'),
      });
      vi.advanceTimersByTime(700);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(platform.writeFileIfUnchanged).toHaveBeenCalledWith(
      '/tmp/hana-note.md',
      'user edit',
      fileVersion,
    );
    expect(onContentChange).toHaveBeenLastCalledWith('user edit', nextVersion);
    expect(platform.writeFile).not.toHaveBeenCalled();
  });
});
