/**
 * Typed fetch wrapper for the CarrierPay API.
 * - Sends the session cookie automatically (`credentials: 'include'`).
 * - Attaches the CSRF token (issued at login/setup) to unsafe methods.
 * - Normalizes error responses into `ApiError`.
 */
const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api/v1';

let csrfToken: string | null = null;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}
export function getCsrfToken(): string | null {
  return csrfToken;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
    public fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query } = opts;
  let url = `${API_BASE}${path}`;
  if (query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) params.set(k, String(v));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;

  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'include',
  });

  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const errBody = (data ?? {}) as { error?: { code?: string; message?: string; fieldErrors?: Record<string, string[]> } };
    const code = errBody.error?.code ?? 'ERROR';
    const message = errBody.error?.message ?? res.statusText;
    if (res.status === 401) {
      window.dispatchEvent(new CustomEvent('carrierpay:unauthorized'));
    }
    throw new ApiError(message, res.status, code, errBody.error?.fieldErrors);
  }
  return data as T;
}
