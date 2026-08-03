import { createContext, useContext, useEffect, useCallback, useState, type ReactNode } from 'react';
import type { MeResponse } from '@carrierpay/shared';
import { api, setCsrfToken, ApiError } from '../api/client';

interface AuthContextValue {
  me: MeResponse | null;
  loading: boolean;
  setupRequired: boolean | null;
  login: (identifier: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<MeResponse | null>;
  completeSetup: (payload: unknown) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [setupRequired, setSetupRequired] = useState<boolean | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await api<MeResponse>('/me');
      setMe(data);
      setLoading(false);
      return data;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setMe(null);
        setCsrfToken(null);
      } else {
        setMe(null);
      }
      setLoading(false);
      return null;
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const status = await api<{ required: boolean }>('/setup/status');
        if (alive) setSetupRequired(status.required);
      } catch {
        if (alive) setSetupRequired(false);
      }
      if (alive) await refresh();
      if (alive) setLoading(false);
    })();
    const onUnauthorized = () => {
      setMe(null);
      setCsrfToken(null);
      setLoading(false);
    };
    window.addEventListener('carrierpay:unauthorized', onUnauthorized);
    return () => {
      alive = false;
      window.removeEventListener('carrierpay:unauthorized', onUnauthorized);
    };
  }, [refresh]);

  const login = useCallback(
    async (identifier: string, password: string) => {
      const data = await api<{ ok: boolean; csrfToken: string }>('/auth/login', {
        method: 'POST',
        body: { identifier, password },
      });
      setCsrfToken(data.csrfToken);
      await refresh();
    },
    [refresh],
  );

  const completeSetup = useCallback(
    async (payload: unknown) => {
      const data = await api<{ ok: boolean; csrfToken: string }>('/setup', { method: 'POST', body: payload });
      setCsrfToken(data.csrfToken);
      setSetupRequired(false);
      await refresh();
    },
    [refresh],
  );

  const logout = useCallback(async () => {
    try {
      await api<{ ok: boolean }>('/auth/logout', { method: 'POST' });
    } catch {
      // Ignore — session may already be invalid.
    }
    setCsrfToken(null);
    setMe(null);
  }, []);

  return (
    <AuthContext.Provider value={{ me, loading, setupRequired, login, logout, refresh, completeSetup }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
