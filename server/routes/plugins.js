import { Hono } from "hono";

/**
 * Create a catch-all Hono route that proxies /plugins/:pluginId/* to the
 * corresponding plugin sub-app in routeRegistry.
 *
 * Mount example (server entry):
 *   app.route("/api", createPluginProxyRoute(pluginManager.routeRegistry));
 *
 * @param {Map<string, import("hono").Hono>} routeRegistry
 * @returns {import("hono").Hono}
 */
export function createPluginProxyRoute(routeRegistry) {
  const route = new Hono();

  route.all("/plugins/:pluginId/*", async (c) => {
    const pluginId = c.req.param("pluginId");
    const pluginApp = routeRegistry.get(pluginId);
    if (!pluginApp) {
      return c.json({ error: `Plugin "${pluginId}" not found` }, 404);
    }

    // Strip the /api/plugins/:pluginId prefix so the sub-app sees a clean path.
    // We use the raw URL so query strings are preserved.
    const url = new URL(c.req.url);
    const prefix = `/plugins/${pluginId}`;
    const prefixIndex = url.pathname.indexOf(prefix);
    const subPath = prefixIndex !== -1
      ? url.pathname.slice(prefixIndex + prefix.length) || "/"
      : "/";
    url.pathname = subPath;

    const subReq = new Request(url.toString(), {
      method: c.req.method,
      headers: c.req.raw.headers,
      body: c.req.method !== "GET" && c.req.method !== "HEAD"
        ? c.req.raw.body
        : undefined,
    });
    return pluginApp.fetch(subReq);
  });

  return route;
}
