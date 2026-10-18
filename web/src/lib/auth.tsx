import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, getToken, setToken, setUnauthorizedHandler } from "./api";

export interface User { id: number; email: string; name: string; role: "user" | "admin" }
interface AuthState {
  user: User | null; onboarded: boolean; loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  signup: (name: string, email: string, password: string) => Promise<User>;
  logout: () => void; refresh: () => Promise<void>;
}
const Ctx = createContext<AuthState>(null as any);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [onboarded, setOnboarded] = useState(false);
  const [loading, setLoading] = useState(!!getToken());
  const qc = useQueryClient();

  const logout = useCallback(() => { setToken(null); setUser(null); setOnboarded(false); qc.clear(); }, [qc]);
  const refresh = useCallback(async () => {
    if (!getToken()) { setLoading(false); return; }
    try {
      const r = await api.get<{ user: User; onboarded: boolean }>("/auth/me");
      setUser(r.user); setOnboarded(r.onboarded);
    } catch { setToken(null); setUser(null); } finally { setLoading(false); }
  }, []);

  useEffect(() => { setUnauthorizedHandler(logout); void refresh(); }, [logout, refresh]);

  const value = useMemo<AuthState>(() => ({
    user, onboarded, loading, logout, refresh,
    login: async (email, password) => {
      const r = await api.post<{ token: string; user: User }>("/auth/login", { email, password });
      setToken(r.token); qc.clear(); setUser(r.user); await refresh(); return r.user;
    },
    signup: async (name, email, password) => {
      const r = await api.post<{ token: string; user: User }>("/auth/signup", { name, email, password });
      setToken(r.token); qc.clear(); setUser(r.user); await refresh(); return r.user;
    },
  }), [user, onboarded, loading, logout, refresh, qc]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
