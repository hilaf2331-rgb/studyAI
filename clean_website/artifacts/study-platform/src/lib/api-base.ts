// Base URL for the API server (Render). Set VITE_API_URL in Vercel's
// environment variables, e.g. https://studyai-zhyy.onrender.com
// Falls back to a relative path for local dev (where Vite can proxy /api).
export const API_BASE_URL = import.meta.env.VITE_API_URL ?? "";

export function apiUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}
