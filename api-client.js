/**
 * API Client — Frontend integration layer
 *
 * Drop this into your React app's src/ folder.
 * It talks to the Express backend (backend-server.js),
 * which proxies requests to the Instantly API.
 *
 * Usage:
 *   import { fetchCampaigns, fetchSummary } from "./api-client";
 *   const { campaigns } = await fetchCampaigns({ status: "Active" });
 */

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000";

async function request(path, params = {}) {
  const url = new URL(`${API_BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
  });

  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `API error: ${res.status}`);
  }
  return res.json();
}

/** Fetch all campaigns with optional filters and date range */
export async function fetchCampaigns({ status, search, start, end } = {}) {
  return request("/api/campaigns", { status, search, start, end });
}

/**
 * Fetch per-day analytics for a date range.
 * @param {string} start  YYYY-MM-DD
 * @param {string} end    YYYY-MM-DD
 */
export async function fetchDailyAnalytics(start, end) {
  return request("/api/analytics/daily", { start, end });
}

/** Fetch analytics for a single campaign */
export async function fetchCampaignAnalytics(campaignId) {
  return request(`/api/campaigns/${campaignId}/analytics`);
}

/** Fetch aggregated summary metrics */
export async function fetchSummary() {
  return request("/api/summary");
}

/** Health check */
export async function healthCheck() {
  return request("/api/health");
}
