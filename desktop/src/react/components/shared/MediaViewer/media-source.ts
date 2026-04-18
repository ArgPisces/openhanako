import type { FileRef } from '../../../types/file-ref';

export interface MediaSource {
  url: string;
  cleanup?: () => void;
}

function mimeFromImageOrSvg(kind: 'image' | 'svg', ext: string | undefined): string {
  if (kind === 'svg') return 'image/svg+xml';
  const e = (ext || 'png').toLowerCase();
  return `image/${e === 'jpg' ? 'jpeg' : e}`;
}

export async function loadMediaSource(ref: FileRef): Promise<MediaSource> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- window.platform 的运行时存在性要在这里显式校验
  const platform = (window as any).platform;
  if (!platform) throw new Error('platform not available');

  // 1) inline data 优先（screenshot 等无 path 的场景）
  if (ref.inlineData) {
    return { url: `data:${ref.inlineData.mimeType};base64,${ref.inlineData.base64}` };
  }

  // 2) 视频走 platform.getFileUrl —— 禁止前端手拼 file://
  if (ref.kind === 'video') {
    if (typeof platform.getFileUrl !== 'function') {
      throw new Error('platform.getFileUrl not available (preload.cjs 未实现)');
    }
    const url = platform.getFileUrl(ref.path);
    return { url };
  }

  // 3) 图片 / SVG 读 base64
  if (ref.kind === 'image' || ref.kind === 'svg') {
    if (typeof platform.readFileBase64 !== 'function') {
      throw new Error('platform.readFileBase64 not available');
    }
    const base64 = await platform.readFileBase64(ref.path);
    if (base64 == null) {
      throw new Error(`读取媒体失败: ${ref.path}`);
    }
    const mime = ref.mime ?? mimeFromImageOrSvg(ref.kind, ref.ext);
    return { url: `data:${mime};base64,${base64}` };
  }

  throw new Error(`unsupported media kind: ${ref.kind}`);
}
