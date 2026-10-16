export interface MockReply {
  status?: number;
  body?: unknown;
}

export interface RecordedCall {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: Record<string, unknown> | undefined;
}

/**
 * Fake fetch keyed by "METHOD /path". A route may hold a single reply (reused)
 * or a list of replies (consumed in order, the last one repeats).
 */
export function mockFetch(routes: Record<string, MockReply | MockReply[]>) {
  const calls: RecordedCall[] = [];
  const counters = new Map<string, number>();

  const fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const method = (init.method ?? 'GET').toUpperCase();
    const key = `${method} ${url.pathname}`;
    const route = routes[key];

    calls.push({
      method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      headers: { ...(init.headers as Record<string, string>) },
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    });

    if (!route) {
      return new Response(JSON.stringify({ code: 'NOT_MOCKED', key }), { status: 404 });
    }

    const index = counters.get(key) ?? 0;
    counters.set(key, index + 1);
    const reply = Array.isArray(route) ? route[Math.min(index, route.length - 1)] : route;
    const status = reply?.status ?? 200;
    const body = reply?.body === undefined || status === 204 ? null : JSON.stringify(reply.body);
    return new Response(body, { status });
  }) as typeof globalThis.fetch;

  const callsTo = (method: string, path: string) =>
    calls.filter((call) => call.method === method && call.path === path);

  return { fetch, calls, callsTo };
}
