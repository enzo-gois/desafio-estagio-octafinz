// Relative by default: in dev the Vite proxy forwards /api to the API (vite.config.ts) and in
// production a reverse proxy does the same, so one build serves every environment. Read at build
// time: changing VITE_API_URL needs a new build.
export const API_BASE_URL = (import.meta.env.VITE_API_URL ?? '/api').replace(/\/+$/, '');
