import { NativeChannelError } from '../errors';

export interface HttpClientOptions {
  baseUrl: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export interface RequestOptions {
  method?: string;
  path: string;
  body?: unknown;
  query?: Record<string, string | undefined>;
  headers?: Record<string, string>;
  token?: string;
}

const ERROR_CODE_KEYS = ['code', 'errorCode', 'reason', 'title'];

export class HttpClient {
  readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor({ baseUrl, timeoutMs = 15_000, fetch: fetchImpl }: HttpClientOptions) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async request<T>({ method = 'GET', path, body, query, headers, token }: RequestOptions): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);

    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) {
        url.searchParams.set(key, value);
      }
    }

    const allHeaders: Record<string, string> = { Accept: 'application/json', ...headers };

    if (body !== undefined) {
      allHeaders['Content-Type'] = 'application/json';
    }

    if (token) {
      allHeaders.Authorization = `Bearer ${token}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(url.toString(), {
        method,
        headers: allHeaders,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw await parseError(response);
      }

      if (response.status === 204) {
        return {} as T;
      }

      const text = await response.text();
      return (text ? JSON.parse(text) : {}) as T;
    } finally {
      clearTimeout(timer);
    }
  }
}

async function parseError(response: Response): Promise<NativeChannelError> {
  let body: Record<string, unknown> = {};

  try {
    const parsed: unknown = JSON.parse(await response.text());

    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      body = parsed as Record<string, unknown>;
    }
  } catch {
    // empty or non-JSON body: keep HTTP_<status> as the code
  }

  let code = `HTTP_${response.status}`;

  for (const key of ERROR_CODE_KEYS) {
    const value = body[key];

    if (typeof value === 'string' && value.trim()) {
      code = value.trim();
      break;
    }
  }

  return new NativeChannelError(response.status, code, body);
}
