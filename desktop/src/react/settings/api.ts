/**
 * Settings window API utilities
 * 从 settings store 读 port/token，独立于主窗口
 */
import { useSettingsStore } from './store';
import {
  appendConnectionAuth,
  buildConnectionUrl,
  requireServerConnection,
} from '../services/server-connection';
import { errorWithCode } from '../errors/error-presenter';
import { errorCodeFromResponseBody } from '../../../../shared/error-user-messages.ts';

const DEFAULT_TIMEOUT = 30_000;

export function hanaUrl(path: string): string {
  const connection = requireServerConnection(
    useSettingsStore.getState(),
    `settings hanaUrl ${path}: server connection not ready`,
  );
  return buildConnectionUrl(connection, path, { includeTokenQuery: true });
}

export async function hanaFetch(
  path: string,
  opts: RequestInit & { timeout?: number } = {},
): Promise<Response> {
  const connection = requireServerConnection(
    useSettingsStore.getState(),
    `settings hanaFetch ${path}: server connection not ready`,
  );
  const headers = appendConnectionAuth(connection, opts.headers);

  const { timeout = DEFAULT_TIMEOUT, signal: callerSignal, ...fetchOpts } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  // If caller provided a signal, forward its abort to our controller
  if (callerSignal) {
    if (callerSignal.aborted) { controller.abort(); }
    else { callerSignal.addEventListener('abort', () => controller.abort(), { once: true }); }
  }

  try {
    const res = await fetch(buildConnectionUrl(connection, path), {
      ...fetchOpts,
      headers,
      signal: controller.signal,
    });
    if (!res.ok) {
      // 错误码在这里就得挂到异常上。调用方拿到的是抛出来的 Error，不是响应体——
      // 一旦这里只带走那句英文，后面再想把失败翻成人话就没有依据了。
      const { message, code } = await readErrorResponse(res);
      throw errorWithCode(message || `hanaFetch ${path}: ${res.status} ${res.statusText}`, code);
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 读错误响应：给调用方一句话，外加一个错误码。
 *
 * 提码走 shared 的 errorCodeFromResponseBody，跟其它消费点认的是同一套形状
 * （既认 `{error, code}`，也认少数老路由把码直接塞进 error 字段的写法）。
 * body 读不出来或不是 JSON 时没有码，那种情况的文案跟以前一样。
 */
async function readErrorResponse(res: Response): Promise<{ message: string | null; code: string | null }> {
  try {
    const text = await res.text();
    if (!text) return { message: null, code: null };
    try {
      const data = JSON.parse(text);
      const code = errorCodeFromResponseBody(data);
      if (typeof data?.error === 'string' && data.error.trim()) return { message: data.error.trim(), code };
      if (typeof data?.message === 'string' && data.message.trim()) return { message: data.message.trim(), code };
      return { message: text.trim() || null, code };
    } catch {
      return { message: text.trim() || null, code: null };
    }
  } catch {
    return { message: null, code: null };
  }
}

/** 根据 yuan 类型返回 fallback 头像路径 */
export function yuanFallbackAvatar(yuan?: string): string {
  const t = window.t || ((k: string) => k);
  const types = (t('yuan.types') || {}) as Record<string, { avatar?: string }>;
  const entry = types[yuan || 'hanako'];
  return `assets/${entry?.avatar || 'Hanako.png'}`;
}
