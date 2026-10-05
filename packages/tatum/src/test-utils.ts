/**
 * Test-only fake `fetch`. Routes are keyed "METHOD /path" (matched against
 * the URL's pathname, any host) or "METHOD https://full/url". A route value is
 * either a JSON body (200), `{ status, body }`, or a function of the parsed
 * request body returning a JSON body.
 */
export type FakeRoute = unknown | ((body: unknown) => unknown);
export type FakeRoutes = Record<string, FakeRoute>;

export interface FakeCall {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

function isStatusBody(v: unknown): v is { status: number; body: unknown } {
  return (
    typeof v === "object" && v !== null && "status" in v && "body" in v && typeof (v as { status: unknown }).status === "number"
  );
}

export function fakeFetch(routes: FakeRoutes): { fetch: typeof fetch; calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  const impl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    calls.push({ method, url, headers, body });

    const parsed = new URL(url);
    const route = routes[`${method} ${url}`] ?? routes[`${method} ${parsed.pathname}`];
    if (route === undefined) {
      return new Response(JSON.stringify({ message: `no fake route for ${method} ${url}` }), { status: 404 });
    }
    const value = typeof route === "function" ? (route as (b: unknown) => unknown)(body) : route;
    if (isStatusBody(value)) {
      return new Response(value.body === undefined ? null : JSON.stringify(value.body), { status: value.status });
    }
    return new Response(value === undefined ? null : JSON.stringify(value), {
      status: value === undefined ? 204 : 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch: impl as typeof fetch, calls };
}
