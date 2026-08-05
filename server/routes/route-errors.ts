/**
 * route 层错误 → HTTP 响应的统一构造。
 *
 * 分工是固定的：抛错点负责判断"这是什么错、该回什么状态码"，把 code 和 status 挂在
 * Error 上（唯一正道，见 routeError）；这里只负责忠实透传，不猜、不兜底、不按文案正则
 * 反推语义。少了 code，前端就只能把一切失败糊成同一句不可行动的英文原文。
 *
 * 新写的路由 catch 一律用 bodyFromRouteError + statusFromRouteError，
 * 不要手写 `c.json({ error: err.message }, 500)`——那会把抛错点已经表达清楚的语义压平。
 */

/** 造一个带 code 和 status 的错误，供路由内部 throw，最终被下面两个函数原样透传。 */
export function routeError(message, code, status) {
  const err: any = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

export function statusFromRouteError(err) {
  return Number.isInteger(err?.status) ? err.status : 500;
}

export function bodyFromRouteError(err) {
  return {
    error: err?.message || String(err),
    ...(err?.code ? { code: err.code } : {}),
    ...(err?.sessionId ? { sessionId: err.sessionId } : {}),
    ...(err?.currentPath ? { currentPath: err.currentPath } : {}),
    ...(err?.requestedPath ? { requestedPath: err.requestedPath } : {}),
    ...(err?.lifecycle ? { lifecycle: err.lifecycle } : {}),
  };
}
