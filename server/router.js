/** Router minúsculo com padrões tipo /api/lectures/:id/chunk */
export function createRouter() {
  const routes = [];

  function add(method, pattern, handler) {
    const keys = [];
    const regex = new RegExp(
      '^' + pattern.replace(/\/:([A-Za-z0-9_]+)/g, (_, key) => { keys.push(key); return '/([^/]+)'; }) + '/?$',
    );
    routes.push({ method, regex, keys, handler });
  }

  const router = {
    get: (p, h) => add('GET', p, h),
    post: (p, h) => add('POST', p, h),
    patch: (p, h) => add('PATCH', p, h),
    put: (p, h) => add('PUT', p, h),
    delete: (p, h) => add('DELETE', p, h),
    match(method, pathname) {
      for (const route of routes) {
        if (route.method !== method) continue;
        const found = route.regex.exec(pathname);
        if (!found) continue;
        const params = {};
        route.keys.forEach((key, i) => { params[key] = decodeURIComponent(found[i + 1]); });
        return { handler: route.handler, params };
      }
      return null;
    },
    has(pathname) {
      return routes.some((route) => route.regex.test(pathname));
    },
  };
  return router;
}
