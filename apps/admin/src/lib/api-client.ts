const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

const ACCESS_TOKEN_KEY = 'qennect.accessToken';
const REFRESH_TOKEN_KEY = 'qennect.refreshToken';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function getTokens(): { accessToken: string | null; refreshToken: string | null } {
  if (typeof window === 'undefined') return { accessToken: null, refreshToken: null };
  return {
    accessToken: window.localStorage.getItem(ACCESS_TOKEN_KEY),
    refreshToken: window.localStorage.getItem(REFRESH_TOKEN_KEY),
  };
}

export function setTokens(accessToken: string, refreshToken: string): void {
  window.localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  window.localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
}

export function clearTokens(): void {
  window.localStorage.removeItem(ACCESS_TOKEN_KEY);
  window.localStorage.removeItem(REFRESH_TOKEN_KEY);
}

async function rawRequest(path: string, options: RequestInit, accessToken: string | null): Promise<Response> {
  return fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...options.headers,
    },
  });
}

/** Typed fetch wrapper. On a 401 it attempts exactly one refresh-and-retry before giving up
 *  and clearing the stored session, so an expired access token doesn't force a manual login
 *  on every page unless the refresh token itself is also invalid. */
export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const tokens = getTokens();
  const { refreshToken } = tokens;
  let accessToken = tokens.accessToken;

  let response = await rawRequest(path, options, accessToken);

  if (response.status === 401 && refreshToken) {
    const refreshRes = await rawRequest(
      '/auth/refresh',
      { method: 'POST', body: JSON.stringify({ refreshToken }) },
      null,
    );
    if (refreshRes.ok) {
      const tokens = await refreshRes.json();
      setTokens(tokens.accessToken, tokens.refreshToken);
      accessToken = tokens.accessToken;
      response = await rawRequest(path, options, accessToken);
    } else {
      clearTokens();
    }
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: response.statusText }));
    throw new ApiError(response.status, body.message ?? 'Request failed');
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
