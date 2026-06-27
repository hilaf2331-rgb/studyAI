import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { apiUrl } from "./api-base";

const TOKEN_KEY = "studyai_token";
const USER_KEY = "studyai_user";

// Set right after a successful registration (see register() below), read by
// the Dashboard to show a one-time "Welcome Package" popup with the new
// user's starter token balance. sessionStorage (not localStorage) so it
// only ever fires once per registration, not on every future visit.
export const WELCOME_PENDING_KEY = "studyai_welcome_pending";

export type Gender = "male" | "female" | "other";

export interface AuthUser {
  id: number;
  email: string;
  name?: string | null;
  role?: string;
  subscriptionTier?: string;
  isPremium?: boolean;
  gender?: Gender;
}

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name?: string) => Promise<void>;
  logout: () => void;
  updateUser: (updates: Partial<Pick<AuthUser, "name" | "gender">>) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // `user` is hydrated first because a corrupted USER_KEY entry clears both
  // keys -- TOKEN_KEY must be read afterwards so the two states never
  // disagree about whether the session is valid.
  const [user, setUser] = useState<AuthUser | null>(() => {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      // Corrupted entry (e.g. from an old schema) would otherwise throw
      // during this synchronous mount-time hydration and crash the whole
      // app into the error boundary instead of just logging the user out.
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      return null;
    }
  });
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [isLoading, setIsLoading] = useState(false);

  const saveAuth = (newToken: string, newUser: AuthUser) => {
    localStorage.setItem(TOKEN_KEY, newToken);
    localStorage.setItem(USER_KEY, JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);
  };

  const clearAuth = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setToken(null);
    setUser(null);
  }, []);

  const login = async (email: string, password: string) => {
    setIsLoading(true);
    try {
      const res = await fetch(apiUrl("/api/auth/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Login failed");
      saveAuth(data.token, data.user);
    } finally {
      setIsLoading(false);
    }
  };

  const register = async (email: string, password: string, name?: string) => {
    setIsLoading(true);
    try {
      const res = await fetch(apiUrl("/api/auth/register"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Registration failed");
      saveAuth(data.token, data.user);
      sessionStorage.setItem(WELCOME_PENDING_KEY, "1");
    } finally {
      setIsLoading(false);
    }
  };

  const logout = clearAuth;

  const updateUser = useCallback((updates: Partial<Pick<AuthUser, "name" | "gender">>) => {
    setUser((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...updates };
      localStorage.setItem(USER_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, isLoading, login, register, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
