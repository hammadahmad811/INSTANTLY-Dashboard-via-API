#!/usr/bin/env node
/**
 * proxy.js — Zero-dependency CORS proxy for Instantly API
 * ─────────────────────────────────────────────────────────
 * No npm install required. Uses only Node.js built-in modules.
 *
 * Usage (pick one):
 *   node proxy.js                                  ← key entered in dashboard
 *   INSTANTLY_API_KEY=your_key node proxy.js       ← key from environment (Mac/Linux)
 *   set INSTANTLY_API_KEY=your_key && node proxy.js ← key from environment (Windows)
 *
 * Then open your dashboard and click Connect.
 * ─────────────────────────────────────────────────────────
 * Why this is needed:
 *   Instantly's API doesn't send CORS headers, so browsers block
 *   direct calls. This proxy sits at localhost:3333 and forwards
 *   requests to api.instantly.ai — adding CORS headers so your
 *   dashboard can talk to it freely.
 */

const http  = require("http");
const https = require("https");
const PORT  = 3333;

const server = http.createServer((req, res) => {

  // ── CORS headers — allow browser requests from any origin ──────
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Api-Key");

  // Preflight request — browsers send this before the real request
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // ── Health check ───────────────────────────────────────────────
  if (req.url === "/" || req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", proxy: "Instantly CORS Proxy v1", port: PORT }));
    return;
  }

  // ── Resolve API key ────────────────────────────────────────────
  // Priority: environment variable → X-Api-Key header → Authorization header
  const envKey    = process.env.INSTANTLY_API_KEY || "";
  const headerKey = req.headers["x-api-key"]      || "";
  const authKey   = (req.headers["authorization"] || "").replace(/^Bearer\s+/i, "");
  const apiKey    = envKey || headerKey || authKey;

  if (!apiKey) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      error: "No API key provided.",
      hint:  "Set INSTANTLY_API_KEY env var OR enter your key in the dashboard.",
    }));
    return;
  }

  // ── Forward request to Instantly API v2 ───────────────────────
  // e.g. GET /campaign?limit=1  →  GET https://api.instantly.ai/api/v2/campaign?limit=1
  const targetPath = `/api/v2${req.url}`;

  console.log(`[proxy] ${req.method} ${targetPath}`);

  const options = {
    hostname: "api.instantly.ai",
    port:     443,
    path:     targetPath,
    method:   req.method,
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type":  "application/json",
      "Accept":        "application/json",
    },
  };

  const proxyReq = https.request(options, (proxyRes) => {
    // Forward status + CORS header back to browser
    res.writeHead(proxyRes.statusCode, {
      "Content-Type":                proxyRes.headers["content-type"] || "application/json",
      "Access-Control-Allow-Origin": "*",
    });
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on("error", (err) => {
    console.error("[proxy] Upstream error:", err.message);
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Could not reach Instantly API: " + err.message }));
    }
  });

  // For POST/PUT requests, pipe the request body through
  if (req.method !== "GET" && req.method !== "HEAD") {
    req.pipe(proxyReq, { end: true });
  } else {
    proxyReq.end();
  }
});

// ── Start ──────────────────────────────────────────────────────────
server.listen(PORT, "127.0.0.1", () => {
  const keyStatus = process.env.INSTANTLY_API_KEY
    ? "loaded from environment ✓"
    : "will be sent by the dashboard";

  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║   ✅  Instantly CORS Proxy is running!           ║");
  console.log("╚══════════════════════════════════════════════════╝\n");
  console.log(`   Listening on:  http://localhost:${PORT}`);
  console.log(`   API key:       ${keyStatus}`);
  console.log("\n   ➜  Open your dashboard and click Connect.\n");
  console.log("   Press Ctrl+C to stop.\n");
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\n❌  Port ${PORT} is already in use.`);
    console.error(`    Stop the other process or edit PORT at the top of proxy.js.\n`);
  } else {
    console.error("Server error:", err);
  }
  process.exit(1);
});
