/**
 * Backend gateway URL, configurable via the frontend .env file.
 *
 * Frontend unlike backend env vars must be plain shell env (route handlers
 * run server-side, so no NEXT_PUBLIC_ prefix is needed — this value never
 * ships to the browser).
 *
 * frontend/.env:
 *   API_URL=http://127.0.0.1:8000
 */
export const API_URL = process.env.API_URL ?? "http://127.0.0.1:8000";
