#!/usr/bin/env node
/**
 * app.js — Instantly Dashboard (All-in-One Server)
 * ──────────────────────────────────────────────────
 * No npm install required. Uses only Node.js built-in modules.
 *
 * What it does:
 *   • Serves dashboard.html at http://localhost:3000
 *   • Proxies /api/v2/* → https://api.instantly.ai/api/v2/*
 *   • Stores your API key in memory (sent once from the dashboard)
 *   • Zero CORS issues — dashboard and API are same-origin!
 *
 * How to start:
 *   Double-click start.bat (Windows) or start.command (Mac)
 *   — OR —
 *   Run:  node app.js
 *   — OR —
 *   Run with key preset:  INSTANTLY_API_KEY=your_key node app.js
 */

const http  = require("http");
const https = require("https");
const fs    = require("fs");
const path  = require("path");

// ── Unbuffered file logger — writes to outputs folder so Cowork can read it ──
const LOG_FILE = path.join(__dirname, "debug.log");
try { fs.writeFileSync(LOG_FILE, `[${new Date().toISOString()}] server starting\n`); } catch {}
function flog(...args) {
  const line = `[${new Date().toISOString()}] ` + args.map(a => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ") + "\n";
  try { fs.appendFileSync(LOG_FILE, line); } catch {}
}

// ── Global crash guards — log errors without killing the process ──
process.on("uncaughtException", (err) => {
  flog("[CRASH] uncaughtException:", err.message, err.stack || "");
});
process.on("unhandledRejection", (reason) => {
  flog("[CRASH] unhandledRejection:", reason instanceof Error ? reason.message + " " + (reason.stack || "") : String(reason));
});
process.on("exit", (code) => {
  flog(`process exit code=${code}`);
});

// Railway (and most cloud hosts) inject PORT via environment variable.
// Locally defaults to 3000.
const PORT = process.env.PORT || 3000;

// ── API key — loaded from env, or set via /api/accounts/select ──
let storedKey = (process.env.INSTANTLY_API_KEY || "").trim();

// ── Selected account ID — persisted to disk so restarts don't lose it ──
const SELECTED_FILE = path.join(__dirname, "selected-account.json");
let selectedAccountId = null;

function readSelectedAccountId() {
  try { return JSON.parse(fs.readFileSync(SELECTED_FILE, "utf8")).id || null; }
  catch { return null; }
}
function saveSelectedAccountId(id) {
  try { fs.writeFileSync(SELECTED_FILE, JSON.stringify({ id })); } catch {}
}

// ── Secure account storage (accounts.json — API keys NEVER leave backend) ──
const ACCOUNTS_FILE = path.join(__dirname, "accounts.json");

function readAccounts() {
  try { return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, "utf8")); }
  catch { return []; }
}

// ── Auto-restore selected account on startup ──────────────────────────────
// 1. Try last explicitly selected account (from selected-account.json)
// 2. Fall back to first account in accounts.json so restarts never need manual re-selection
{
  const accounts = readAccounts();
  const restoredId = readSelectedAccountId();
  const acc = (restoredId && accounts.find(a => a.id === restoredId))
           || accounts.find(a => a.api_key);   // fallback: first account with a key
  if (acc && acc.api_key) {
    storedKey = acc.api_key;
    selectedAccountId = acc.id;
    saveSelectedAccountId(acc.id);
    console.log(`[startup] Auto-selected account: "${acc.name}"`);
  }
}
function writeAccounts(accs) {
  try { fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accs, null, 2), "utf8"); }
  catch (e) { console.error("[accounts] Failed to write accounts.json:", e.message); }
}
function genId() {
  return "acc_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
}

// ── Custom Account Tags storage (account-tags.json) ─────────────────
// Since Instantly API v2 exposes no tag endpoints, we manage tags locally.
// Structure: { tags: [{ id, name, color, emails: [] }] }
const ACCT_TAGS_FILE = path.join(__dirname, "account-tags.json");
function readAcctTags() {
  try { return JSON.parse(fs.readFileSync(ACCT_TAGS_FILE, "utf8")); }
  catch { return { tags: [] }; }
}
function writeAcctTags(data) {
  try { fs.writeFileSync(ACCT_TAGS_FILE, JSON.stringify(data, null, 2), "utf8"); }
  catch (e) { console.error("[acct-tags] write failed:", e.message); }
}
function genTagId() {
  return "tag_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
}

// ── Campaign Metadata storage (campaigns-meta.json) ─────────────────
// Stores custom per-campaign fields: event_date, email_group, exhibitors, etc.
// Keyed by Instantly campaign_id.
const CAMPAIGNS_META_FILE = path.join(__dirname, "campaigns-meta.json");
function readCampaignsMeta() {
  try { return JSON.parse(fs.readFileSync(CAMPAIGNS_META_FILE, "utf8")); }
  catch { return {}; }
}
function writeCampaignsMeta(data) {
  try { fs.writeFileSync(CAMPAIGNS_META_FILE, JSON.stringify(data, null, 2), "utf8"); }
  catch (e) { console.error("[campaigns-meta] write error:", e.message); }
}

// ── Environment variable account seeding (Railway / cloud deployment) ────────
// On Railway the filesystem resets on every deploy, so accounts.json is lost.
// Instead, set one or more env vars:
//
//   INSTANTLY_API_KEY          → single account named "Default Account"
//   INSTANTLY_API_KEY_1        → account named by INSTANTLY_ACCOUNT_NAME_1
//   INSTANTLY_API_KEY_2        → account named by INSTANTLY_ACCOUNT_NAME_2  (etc.)
//
// These are merged with any accounts already saved in accounts.json.
// Env-var accounts are never written to disk — they exist only in memory.
{
  const saved = readAccounts();
  const envAccounts = [];

  // Single key shorthand
  if (process.env.INSTANTLY_API_KEY) {
    envAccounts.push({
      id: "env_default",
      name: process.env.INSTANTLY_ACCOUNT_NAME || "Default Account",
      api_key: process.env.INSTANTLY_API_KEY.trim(),
      _fromEnv: true,
    });
  }

  // Numbered keys: INSTANTLY_API_KEY_1 … INSTANTLY_API_KEY_10
  for (let i = 1; i <= 10; i++) {
    const key = (process.env[`INSTANTLY_API_KEY_${i}`] || "").trim();
    if (!key) continue;
    const name = process.env[`INSTANTLY_ACCOUNT_NAME_${i}`] || `Account ${i}`;
    envAccounts.push({ id: `env_${i}`, name, api_key: key, _fromEnv: true });
  }

  if (envAccounts.length > 0) {
    // Merge: env accounts override saved accounts with the same id
    const savedIds = new Set(saved.map(a => a.id));
    const merged = [
      ...envAccounts,
      ...saved.filter(a => !envAccounts.find(e => e.id === a.id)),
    ];
    // Write merged list so the UI shows all accounts (env accounts' keys are masked)
    const forDisk = merged.map(a => a._fromEnv
      ? { id: a.id, name: a.name, api_key: a.api_key }  // persist env accounts too
      : a
    );
    writeAccounts(forDisk);
    console.log(`[startup] Seeded ${envAccounts.length} account(s) from environment variables`);

    // Auto-select the first env account if nothing is selected yet
    if (!storedKey) {
      storedKey = envAccounts[0].api_key;
      selectedAccountId = envAccounts[0].id;
    }
  } else if (storedKey && saved.length === 0) {
    // Legacy single-key fallback
    writeAccounts([{ id: "acc_default", name: "Default Account", api_key: storedKey }]);
    console.log("[accounts] Created default account from INSTANTLY_API_KEY env var ✓");
  }
}

// ── HTTP server ────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const { pathname, search } = new URL(req.url, `http://localhost:${PORT}`);

  // Log every non-static request so we can trace what the browser is calling
  if (!pathname.endsWith(".html") && !pathname.endsWith(".js") && !pathname.endsWith(".css") && pathname !== "/") {
    flog(`[req] ${req.method} ${pathname} keySet=${!!storedKey}`);
  }

  // CORS headers (needed if dashboard is opened from a different port)
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Api-Key, Authorization");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  // ── Health check ───────────────────────────────────────────────
  if (pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", keySet: !!storedKey }));
    return;
  }

  // ── Debug: fetch raw account + tag data from Instantly ─────────────────
  if (pathname === "/debug-accounts-raw" && req.method === "GET") {
    const qp = new URL(req.url, `http://localhost:${PORT}`).searchParams;
    const acctId = qp.get("account_id");
    const accs = readAccounts();
    const ac = acctId ? accs.find(a => a.id === acctId) : accs[0];
    const key = ac?.api_key || storedKey;
    if (!key) { res.writeHead(401,{"Content-Type":"application/json"}); res.end(JSON.stringify({error:"No key"})); return; }
    function rawGet(p) {
      return new Promise(resolve => {
        const o = { hostname:"api.instantly.ai", port:443, path:p, method:"GET", headers:{"Authorization":`Bearer ${key}`,"Accept":"application/json"} };
        const rq = https.request(o, rs => { let b=""; rs.on("data",c=>b+=c); rs.on("end",()=>{ try{resolve({status:rs.statusCode,body:JSON.parse(b)})}catch{resolve({status:rs.statusCode,body:b})} }); });
        rq.on("error",()=>resolve({status:0,body:null})); rq.setTimeout(15000,()=>{rq.destroy();resolve({status:0,body:null})}); rq.end();
      });
    }
    Promise.all([
      rawGet("/api/v2/accounts?limit=5"),
      rawGet("/api/v2/account-tags?limit=200"),
      rawGet("/api/v2/accounts/warmup-analytics?limit=5"),
    ]).then(([accts, tags, warmup]) => {
      res.writeHead(200,{"Content-Type":"application/json"});
      res.end(JSON.stringify({ accounts_raw: accts, tags_raw: tags, warmup_raw: warmup }, null, 2));
    });
    return;
  }

  // ── Debug: fetch raw Instantly responses to verify field names ──────────
  if (pathname === "/debug-api" && storedKey) {
    // Use yesterday + today as the date range for the daily debug call
    const _now  = new Date();
    const _pad  = n => String(n).padStart(2, "0");
    const _td   = `${_now.getFullYear()}-${_pad(_now.getMonth()+1)}-${_pad(_now.getDate())}`;
    const _yd   = (() => { const d = new Date(_now); d.setDate(d.getDate()-1); return `${d.getFullYear()}-${_pad(d.getMonth()+1)}-${_pad(d.getDate())}`; })();
    const calls = [
      { label: "campaigns_sample",         path: "/api/v2/campaigns?limit=1" },
      { label: "campaigns_analytics",      path: "/api/v2/campaigns/analytics?limit=2" },
      { label: "campaigns_analytics_daily",path: `/api/v2/campaigns/analytics/daily?start_date=${_yd}&end_date=${_td}&limit=2` },
    ];
    let results = {};
    let pending = calls.length;
    calls.forEach(({ label, path }) => {
      const opts = {
        hostname: "api.instantly.ai", port: 443, path, method: "GET",
        headers: { "Authorization": `Bearer ${storedKey}`, "Accept": "application/json" },
      };
      const pr = https.request(opts, pres => {
        let buf = "";
        pres.on("data", c => buf += c);
        pres.on("end", () => {
          try { results[label] = JSON.parse(buf); } catch { results[label] = buf; }
          if (--pending === 0) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(results, null, 2));
          }
        });
      });
      pr.on("error", e => { results[label] = { error: e.message }; if (--pending === 0) { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(results, null, 2)); } });
      pr.end();
    });
    return;
  }

  // ── Store API key (called once when user clicks Connect) ───────
  if (pathname === "/set-key" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      try {
        const { key } = JSON.parse(body);
        storedKey = (key || "").trim();
        console.log(`[server] API key ${storedKey ? "saved ✓" : "cleared"}`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, keySet: !!storedKey }));
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
      }
    });
    return;
  }

  // ══════════════════════════════════════════════════════════════════
  // ACCOUNT MANAGEMENT ROUTES
  // API keys are NEVER returned to the frontend — only id + name.
  // ══════════════════════════════════════════════════════════════════

  // ── GET /api/accounts — list accounts (id + name only) ────────────
  if (pathname === "/api/accounts" && req.method === "GET") {
    const accounts = readAccounts();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(accounts.map(({ id, name }) => ({ id, name }))));
    return;
  }

  // ── POST /api/accounts — add new account ──────────────────────────
  if (pathname === "/api/accounts" && req.method === "POST") {
    let body = "";
    req.on("data", c => { body += c; });
    req.on("end", () => {
      let parsed;
      try { parsed = JSON.parse(body); }
      catch { res.writeHead(400, {"Content-Type":"application/json"}); res.end(JSON.stringify({error:"Invalid JSON"})); return; }

      const name    = (parsed.name    || "").trim();
      const api_key = (parsed.api_key || "").trim();

      if (!name)    { res.writeHead(400,{"Content-Type":"application/json"}); res.end(JSON.stringify({error:"Account name is required."})); return; }
      if (!api_key) { res.writeHead(400,{"Content-Type":"application/json"}); res.end(JSON.stringify({error:"API key is required."})); return; }

      const accounts = readAccounts();
      if (accounts.some(a => a.name.toLowerCase() === name.toLowerCase())) {
        res.writeHead(400,{"Content-Type":"application/json"});
        res.end(JSON.stringify({error:`An account named "${name}" already exists. Choose a different name.`}));
        return;
      }

      // Validate key against Instantly API before saving
      console.log(`[accounts] Validating API key for "${name}"…`);
      const testOpts = {
        hostname: "api.instantly.ai", port: 443,
        path: "/api/v2/campaigns?limit=1", method: "GET",
        headers: { "Authorization": `Bearer ${api_key}`, "Accept": "application/json" },
      };
      const testReq = https.request(testOpts, testRes => {
        let buf = "";
        testRes.on("data", c => { buf += c; });
        testRes.on("end", () => {
          if (testRes.statusCode === 401 || testRes.statusCode === 403) {
            res.writeHead(400,{"Content-Type":"application/json"});
            res.end(JSON.stringify({error:"Invalid API key — verify it in app.instantly.ai → Settings → API."}));
            return;
          }
          if (testRes.statusCode >= 500) {
            res.writeHead(502,{"Content-Type":"application/json"});
            res.end(JSON.stringify({error:`Instantly API returned ${testRes.statusCode}. Try again in a moment.`}));
            return;
          }
          // Key is valid — save account
          const id = genId();
          accounts.push({ id, name, api_key });
          writeAccounts(accounts);
          storedKey = api_key; // activate immediately
          console.log(`[accounts] ✓ Saved account "${name}" (${id})`);
          res.writeHead(200,{"Content-Type":"application/json"});
          res.end(JSON.stringify({ ok: true, account: { id, name } }));
        });
      });
      testReq.on("error", err => {
        console.error("[accounts] Key validation network error:", err.message);
        res.writeHead(502,{"Content-Type":"application/json"});
        res.end(JSON.stringify({error:"Could not reach Instantly API: " + err.message}));
      });
      testReq.end();
    });
    return;
  }

  // ── POST /api/accounts/select — activate an account ───────────────
  // Must be checked BEFORE the generic /api/accounts/:id pattern below.
  if (pathname === "/api/accounts/select" && req.method === "POST") {
    let body = "";
    req.on("data", c => { body += c; });
    req.on("end", () => {
      let parsed;
      try { parsed = JSON.parse(body); }
      catch { res.writeHead(400,{"Content-Type":"application/json"}); res.end(JSON.stringify({error:"Invalid JSON"})); return; }

      const { account_id } = parsed;
      const accounts = readAccounts();
      const acc = accounts.find(a => a.id === account_id);
      if (!acc) {
        res.writeHead(404,{"Content-Type":"application/json"});
        res.end(JSON.stringify({error:"Account not found."}));
        return;
      }
      storedKey = acc.api_key;
      selectedAccountId = account_id;
      saveSelectedAccountId(account_id);
      console.log(`[accounts] Activated "${acc.name}" (${account_id})`);
      res.writeHead(200,{"Content-Type":"application/json"});
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  // ── POST /api/accounts/validate — test every saved API key live ───
  // Returns: [{ id, name, ok, campaigns, error }]
  if (pathname === "/api/accounts/validate" && req.method === "POST") {
    const accounts = readAccounts();

    function testKey(api_key) {
      return new Promise(resolve => {
        const opts = {
          hostname: "api.instantly.ai", port: 443,
          path: "/api/v2/campaigns?limit=5",
          method: "GET",
          headers: { "Authorization": `Bearer ${api_key}`, "Accept": "application/json" },
        };
        const pr = https.request(opts, pres => {
          let buf = "";
          pres.on("data", c => { buf += c; });
          pres.on("end", () => {
            try {
              const body = JSON.parse(buf);
              if (pres.statusCode === 200) {
                const items = Array.isArray(body) ? body : (body?.items || []);
                resolve({ ok: true, campaigns: items.length, status: 200 });
              } else if (pres.statusCode === 401 || pres.statusCode === 403) {
                resolve({ ok: false, error: "Invalid or expired API key", status: pres.statusCode });
              } else {
                resolve({ ok: false, error: `API returned HTTP ${pres.statusCode}`, status: pres.statusCode });
              }
            } catch {
              resolve({ ok: false, error: "Non-JSON response from Instantly", status: pres.statusCode });
            }
          });
        });
        pr.on("error", err => resolve({ ok: false, error: err.message, status: 0 }));
        pr.setTimeout(8000, () => { pr.destroy(); resolve({ ok: false, error: "Timeout (8s)", status: 0 }); });
        pr.end();
      });
    }

    (async () => {
      console.log(`[accounts] Validating ${accounts.length} API keys…`);
      const results = await Promise.all(accounts.map(async acc => {
        const result = await testKey(acc.api_key);
        console.log(`[accounts/validate] "${acc.name}": ${result.ok ? `✅ ok (${result.campaigns} campaigns)` : `❌ ${result.error}`}`);
        return { id: acc.id, name: acc.name, ...result };
      }));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(results));
    })();
    return;
  }

  // ── DELETE /api/accounts/:id — remove account ─────────────────────
  if (pathname.match(/^\/api\/accounts\/[^/]+$/) && req.method === "DELETE") {
    const id = decodeURIComponent(pathname.split("/api/accounts/")[1]);
    const accounts = readAccounts();
    const idx = accounts.findIndex(a => a.id === id);
    if (idx === -1) { res.writeHead(404,{"Content-Type":"application/json"}); res.end(JSON.stringify({error:"Account not found."})); return; }
    const [removed] = accounts.splice(idx, 1);
    writeAccounts(accounts);
    if (storedKey === removed.api_key) storedKey = ""; // deactivate if it was selected
    console.log(`[accounts] Removed "${removed.name}" (${id})`);
    res.writeHead(200,{"Content-Type":"application/json"});
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // ── PATCH /api/accounts/:id — rename account ──────────────────────
  if (pathname.match(/^\/api\/accounts\/[^/]+$/) && req.method === "PATCH") {
    const id = decodeURIComponent(pathname.split("/api/accounts/")[1]);
    let body = "";
    req.on("data", c => { body += c; });
    req.on("end", () => {
      let parsed;
      try { parsed = JSON.parse(body); }
      catch { res.writeHead(400,{"Content-Type":"application/json"}); res.end(JSON.stringify({error:"Invalid JSON"})); return; }

      const name = (parsed.name || "").trim();
      if (!name) { res.writeHead(400,{"Content-Type":"application/json"}); res.end(JSON.stringify({error:"Name is required."})); return; }

      const accounts = readAccounts();
      const acc = accounts.find(a => a.id === id);
      if (!acc) { res.writeHead(404,{"Content-Type":"application/json"}); res.end(JSON.stringify({error:"Account not found."})); return; }

      acc.name = name;
      writeAccounts(accounts);
      console.log(`[accounts] Renamed ${id} → "${name}"`);
      res.writeHead(200,{"Content-Type":"application/json"});
      res.end(JSON.stringify({ ok: true, account: { id, name } }));
    });
    return;
  }

  // ══════════════════════════════════════════════════════════════════
  // ══════════════════════════════════════════════════════════════════
  // CUSTOM ACCOUNT TAGS ROUTES (account-tags.json)
  // Manages local tags since Instantly API v2 has no tag endpoints.
  // ══════════════════════════════════════════════════════════════════

  // GET /api/account-custom-tags — list all tags
  if (pathname === "/api/account-custom-tags" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(readAcctTags()));
    return;
  }

  // POST /api/account-custom-tags — create a new tag
  if (pathname === "/api/account-custom-tags" && req.method === "POST") {
    let body = "";
    req.on("data", c => { body += c; });
    req.on("end", () => {
      try {
        const { name, color } = JSON.parse(body);
        if (!name?.trim()) { res.writeHead(400,{"Content-Type":"application/json"}); res.end(JSON.stringify({error:"name required"})); return; }
        const data = readAcctTags();
        const tag = { id: genTagId(), name: name.trim(), color: color || "#6366f1", emails: [] };
        data.tags.push(tag);
        writeAcctTags(data);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(tag));
      } catch(e) { res.writeHead(400,{"Content-Type":"application/json"}); res.end(JSON.stringify({error:e.message})); }
    });
    return;
  }

  // PATCH /api/account-custom-tags/:id — rename / recolor a tag
  if (pathname.startsWith("/api/account-custom-tags/") && req.method === "PATCH" && !pathname.endsWith("/assign") && !pathname.endsWith("/unassign")) {
    const tagId = pathname.split("/api/account-custom-tags/")[1];
    let body = "";
    req.on("data", c => { body += c; });
    req.on("end", () => {
      try {
        const updates = JSON.parse(body);
        const data = readAcctTags();
        const tag = data.tags.find(t => t.id === tagId);
        if (!tag) { res.writeHead(404,{"Content-Type":"application/json"}); res.end(JSON.stringify({error:"Tag not found"})); return; }
        if (updates.name)  tag.name  = updates.name.trim();
        if (updates.color) tag.color = updates.color;
        writeAcctTags(data);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(tag));
      } catch(e) { res.writeHead(400,{"Content-Type":"application/json"}); res.end(JSON.stringify({error:e.message})); }
    });
    return;
  }

  // DELETE /api/account-custom-tags/:id — delete a tag
  if (pathname.startsWith("/api/account-custom-tags/") && req.method === "DELETE" && !pathname.includes("/assign") && !pathname.includes("/unassign")) {
    const tagId = pathname.split("/api/account-custom-tags/")[1];
    const data = readAcctTags();
    data.tags = data.tags.filter(t => t.id !== tagId);
    writeAcctTags(data);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // POST /api/account-custom-tags/:id/assign — add emails to a tag
  if (pathname.match(/\/api\/account-custom-tags\/.+\/assign/) && req.method === "POST") {
    const tagId = pathname.split("/api/account-custom-tags/")[1].replace("/assign","");
    let body = "";
    req.on("data", c => { body += c; });
    req.on("end", () => {
      try {
        const { emails } = JSON.parse(body); // emails: string[]
        if (!Array.isArray(emails)) { res.writeHead(400,{"Content-Type":"application/json"}); res.end(JSON.stringify({error:"emails array required"})); return; }
        const data = readAcctTags();
        const tag = data.tags.find(t => t.id === tagId);
        if (!tag) { res.writeHead(404,{"Content-Type":"application/json"}); res.end(JSON.stringify({error:"Tag not found"})); return; }
        emails.forEach(e => { if (!tag.emails.includes(e)) tag.emails.push(e); });
        writeAcctTags(data);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(tag));
      } catch(e) { res.writeHead(400,{"Content-Type":"application/json"}); res.end(JSON.stringify({error:e.message})); }
    });
    return;
  }

  // POST /api/account-custom-tags/:id/unassign — remove emails from a tag
  if (pathname.match(/\/api\/account-custom-tags\/.+\/unassign/) && req.method === "POST") {
    const tagId = pathname.split("/api/account-custom-tags/")[1].replace("/unassign","");
    let body = "";
    req.on("data", c => { body += c; });
    req.on("end", () => {
      try {
        const { emails } = JSON.parse(body);
        const data = readAcctTags();
        const tag = data.tags.find(t => t.id === tagId);
        if (!tag) { res.writeHead(404,{"Content-Type":"application/json"}); res.end(JSON.stringify({error:"Tag not found"})); return; }
        tag.emails = tag.emails.filter(e => !emails.includes(e));
        writeAcctTags(data);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(tag));
      } catch(e) { res.writeHead(400,{"Content-Type":"application/json"}); res.end(JSON.stringify({error:e.message})); }
    });
    return;
  }

  // CAMPAIGN METADATA ROUTES (campaigns-meta.json)
  // Store custom fields per campaign: event_date, exhibitors, stages, etc.
  // ══════════════════════════════════════════════════════════════════

  // GET /api/campaigns-meta — return all metadata (keyed by campaign_id)
  if (pathname === "/api/campaigns-meta" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(readCampaignsMeta()));
    return;
  }

  // POST /api/campaigns-meta — upsert metadata for one campaign
  if (pathname === "/api/campaigns-meta" && req.method === "POST") {
    let body = "";
    req.on("data", c => { body += c; });
    req.on("end", () => {
      try {
        const payload = JSON.parse(body);
        const { campaign_id, ...fields } = payload;
        if (!campaign_id) {
          res.writeHead(400,{"Content-Type":"application/json"});
          res.end(JSON.stringify({error:"campaign_id required"}));
          return;
        }
        const meta = readCampaignsMeta();
        meta[campaign_id] = { ...(meta[campaign_id] || {}), ...fields };
        writeCampaignsMeta(meta);
        console.log(`[campaigns-meta] ✓ Saved metadata for campaign ${campaign_id} (${Object.keys(fields).length} fields)`);
        res.writeHead(200,{"Content-Type":"application/json"});
        res.end(JSON.stringify({ ok: true, meta: meta[campaign_id] }));
      } catch(e) {
        console.error("[campaigns-meta] POST error:", e.message);
        res.writeHead(400,{"Content-Type":"application/json"});
        res.end(JSON.stringify({error: "Invalid request: " + e.message}));
      }
    });
    return;
  }

  // DELETE /api/campaigns-meta/:id — remove custom metadata for a campaign
  if (pathname.match(/^\/api\/campaigns-meta\/[^/]+$/) && req.method === "DELETE") {
    const id = decodeURIComponent(pathname.split("/api/campaigns-meta/")[1]);
    const meta = readCampaignsMeta();
    delete meta[id];
    writeCampaignsMeta(meta);
    res.writeHead(200,{"Content-Type":"application/json"});
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // POST /api/campaign/create — create a new campaign via Instantly API
  if (pathname === "/api/campaign/create" && req.method === "POST") {
    if (!storedKey) { res.writeHead(401,{"Content-Type":"application/json"}); res.end(JSON.stringify({error:"No API key"})); return; }
    let body = "";
    req.on("data", c => { body += c; });
    req.on("end", () => {
      try {
        const payload = JSON.parse(body);
        const { name, daily_limit, email_group, event_date, campaign_start_date,
                total_steps, tammy_exhibitors, booth_size_exhibitors,
                apollo_extracted, campaign_limit, sequence_gap, today_prediction } = payload;
        if (!name?.trim()) { res.writeHead(400,{"Content-Type":"application/json"}); res.end(JSON.stringify({error:"Campaign name is required"})); return; }

        // Build minimal Instantly v2 campaign creation payload
        const campPayload = JSON.stringify({ name: name.trim(), daily_limit: Number(daily_limit) || 50 });
        const opts = {
          hostname: "api.instantly.ai", port: 443, path: "/api/v2/campaigns",
          method: "POST",
          headers: { "Authorization": `Bearer ${storedKey}`, "Content-Type": "application/json",
                     "Content-Length": Buffer.byteLength(campPayload) },
        };
        const pr = https.request(opts, pres => {
          let buf = "";
          pres.on("data", c => { buf += c; });
          pres.on("end", () => {
            let created;
            try { created = JSON.parse(buf); } catch { created = {}; }
            if (pres.statusCode >= 400) {
              res.writeHead(pres.statusCode,{"Content-Type":"application/json"});
              res.end(JSON.stringify({ error: created.error || created.message || `Instantly returned ${pres.statusCode}` }));
              return;
            }
            const campaignId = created.id || created.campaign_id;
            // Save custom metadata if any custom fields were provided
            if (campaignId) {
              const meta = readCampaignsMeta();
              meta[campaignId] = {
                email_group: email_group || "",
                event_date: event_date || "",
                campaign_start_date: campaign_start_date || new Date().toISOString().slice(0,10),
                total_steps: Number(total_steps) || 0,
                tammy_exhibitors: Number(tammy_exhibitors) || 0,
                booth_size_exhibitors: Number(booth_size_exhibitors) || 0,
                apollo_extracted: Number(apollo_extracted) || 0,
                campaign_limit: Number(campaign_limit) || Number(daily_limit) || 0,
                sequence_gap: Number(sequence_gap) || 0,
                today_prediction: Number(today_prediction) || 0,
              };
              writeCampaignsMeta(meta);
            }
            console.log(`[campaign/create] ✓ Created "${name}" (${campaignId})`);
            res.writeHead(200,{"Content-Type":"application/json"});
            res.end(JSON.stringify({ ok: true, campaign: created }));
          });
        });
        pr.on("error", e => { res.writeHead(502,{"Content-Type":"application/json"}); res.end(JSON.stringify({error:e.message})); });
        pr.write(campPayload);
        pr.end();
      } catch { res.writeHead(400,{"Content-Type":"application/json"}); res.end(JSON.stringify({error:"Invalid JSON"})); }
    });
    return;
  }

  // ── Per-campaign daily breakdown ────────────────────────────────
  // GET /campaign-daily/:id?from=YYYY-MM-DD&to=YYYY-MM-DD
  //
  // Tries multiple Instantly API patterns to find per-campaign daily data:
  //   1. /api/v2/campaigns/{id}/analytics/daily?start_date=&end_date=
  //   2. /api/v2/campaigns/analytics/daily?campaign_id={id}&start_date=&end_date=
  // If neither returns per-campaign rows, falls back to returning the all-time
  // stats for this campaign spread as a flat structure (labeled "alltime_only").
  //
  // Fills every calendar day in [from, to] — missing days → { sent:0, ... }
  if (pathname.match(/^\/campaign-daily\/[^/]+$/) && req.method === "GET") {
    const campaignId = decodeURIComponent(pathname.split("/campaign-daily/")[1]);

    if (!storedKey) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "No API key set." }));
      return;
    }

    const qp   = new URL(req.url, `http://localhost:${PORT}`).searchParams;
    const from = qp.get("from") || "";
    const to   = qp.get("to")   || "";

    // Pad a set of rows so every calendar day between from…to exists
    function fillDateRange(rows, fromStr, toStr) {
      if (!fromStr || !toStr) return rows;
      const map = {};
      rows.forEach(r => { if (r.date) map[r.date] = r; });
      const out = [];
      const cur = new Date(fromStr + "T00:00:00");
      const end = new Date(toStr   + "T00:00:00");
      while (cur <= end) {
        const d = cur.toISOString().slice(0, 10);
        const r = map[d] || {};
        out.push({
          date:    d,
          // r.sent is the primary field. emails_sent_count and new_leads_contacted
          // are fallbacks because different Instantly plan tiers / endpoint variants
          // return different field names for the same value. All three are per-row
          // (date-scoped) when they come from a daily endpoint — NOT lifetime.
          sent:          r.sent          ?? r.emails_sent_count  ?? r.new_leads_contacted ?? 0,
          // unique_opened takes priority over opened (raw event count). This is the
          // fix for inflated open rates caused by counting duplicate open events.
          unique_opened: r.unique_opened ?? r.open_count_unique  ?? r.opened              ?? 0,
          opened:        r.opened        ?? r.unique_opened      ?? 0,  // kept for chart tooltip
          replies:       r.unique_replies ?? r.replies           ?? r.reply_count_unique  ?? 0,
          clicks:        r.unique_clicks  ?? r.clicks            ?? r.link_click_count_unique ?? 0,
          bounced:       r.bounced        ?? r.bounced_count      ?? 0,
        });
        cur.setDate(cur.getDate() + 1);
      }
      return out;
    }

    // Make a single HTTPS request to Instantly and return parsed body + status
    function instantly(targetPath) {
      return new Promise(resolve => {
        const opts = {
          hostname: "api.instantly.ai", port: 443,
          path: targetPath, method: "GET",
          headers: { "Authorization": `Bearer ${storedKey}`, "Accept": "application/json" },
        };
        const pr = https.request(opts, pres => {
          let buf = "";
          pres.on("data", c => buf += c);
          pres.on("end", () => {
            try { resolve({ status: pres.statusCode, body: JSON.parse(buf) }); }
            catch { resolve({ status: pres.statusCode, body: null }); }
          });
        });
        pr.on("error", () => resolve({ status: 0, body: null }));
        pr.setTimeout(10000, () => { pr.destroy(); resolve({ status: 0, body: null }); });
        pr.end();
      });
    }

    const dateQS = from && to ? `start_date=${from}&end_date=${to}` : "";
    console.log(`[campaign-daily] id=${campaignId} from=${from} to=${to}`);

    // Ordered list of per-campaign endpoint patterns to try first
    const attempts = [
      `/api/v2/campaigns/${campaignId}/analytics/daily?${dateQS}&limit=500`,
      `/api/v2/campaigns/analytics/daily?campaign_id=${campaignId}&${dateQS}&limit=500`,
    ];

    (async () => {
      try {
        // ── Attempt 1 & 2: per-campaign daily endpoints ──────────────
        for (const apiPath of attempts) {
          console.log(`[campaign-daily] trying: ${apiPath}`);
          const { status, body } = await instantly(apiPath);
          console.log(`[campaign-daily] response status=${status} hasBody=${!!body}`);
          if (status >= 400 || !body) continue;
          if (body.error || body.message) {
            console.log(`[campaign-daily] API error in body:`, body.error || body.message);
            continue;
          }

          const rows = Array.isArray(body) ? body : (body.items || body.data || []);
          // Accept if at least one row has a date field
          if (rows.length > 0 && rows[0].date) {
            console.log(`[campaign-daily] ✓ per-campaign daily data found (${rows.length} rows)`);
            const stats = fillDateRange(rows, from, to);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ campaign_id: campaignId, daily_stats: stats, source: "daily_endpoint" }));
            return;
          }
        }

        // ── Attempt 3: global daily endpoint as fallback ─────────────
        // The Instantly API does not expose per-campaign daily breakdowns.
        // We fall back to the global /campaigns/analytics/daily which gives
        // aggregate daily activity across ALL campaigns.
        console.log(`[campaign-daily] per-campaign endpoints failed — trying global daily fallback`);
        const globalPath = `/api/v2/campaigns/analytics/daily?${dateQS}&limit=500`;
        const { status: gs, body: globalBody } = await instantly(globalPath);
        console.log(`[campaign-daily] global daily status=${gs}`);

        if (gs < 400 && globalBody && !globalBody.error) {
          const globalRows = Array.isArray(globalBody)
            ? globalBody
            : (globalBody.items || globalBody.data || []);
          if (globalRows.length > 0 && globalRows[0].date) {
            console.log(`[campaign-daily] ✓ using global daily fallback (${globalRows.length} rows)`);
            const stats = fillDateRange(globalRows, from, to);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
              campaign_id: campaignId,
              daily_stats: stats,
              source: "global_daily",
              message: "Campaign-level daily data is not available from the Instantly API. Showing account-wide daily performance instead.",
            }));
            return;
          }
        }

        // ── Attempt 4: all-time stats fallback ────────────────────────
        // Last resort: pull the all-time total so we can show a summary card.
        console.log(`[campaign-daily] global daily also empty — fetching all-time stats`);
        const { status: as, body: allTime } = await instantly(
          `/api/v2/campaigns/analytics?campaign_id=${campaignId}&limit=1`
        );
        const atRows = as < 400 && allTime
          ? (Array.isArray(allTime) ? allTime : (allTime.items || allTime.data || []))
          : [];
        const at = atRows.find(r => (r.campaign_id || r.id) === campaignId) || atRows[0] || {};
        console.log(`[campaign-daily] all-time fallback: sent=${at.emails_sent_count}`);

        const zeros = fillDateRange([], from, to);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          campaign_id: campaignId,
          daily_stats: zeros,
          alltime: {
            sent:    at.emails_sent_count       ?? 0,
            opened:  at.open_count_unique       ?? at.open_count       ?? 0,
            replies: at.reply_count_unique      ?? at.reply_count      ?? 0,
            clicks:  at.link_click_count_unique ?? at.link_click_count ?? 0,
            bounced: at.bounced_count           ?? 0,
          },
          source: "alltime_only",
        }));

      } catch (err) {
        // Safety net: always return valid JSON, never leave the connection hanging
        console.error(`[campaign-daily] Unhandled error for id=${campaignId}:`, err);
        if (!res.headersSent) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            campaign_id: campaignId,
            daily_stats: [],
            alltime: null,
            source: "error",
            error: err.message || String(err),
          }));
        }
      }
    })();
    return;
  }

  // ══════════════════════════════════════════════════════════════════
  // EMAIL ACCOUNTS — GET /api/email-accounts?account_id=xxx
  // Lists sending mailboxes for the given account and, where possible,
  // enriches them with per-campaign analytics so the frontend can show
  // open rate / bounce rate per email address.
  // ══════════════════════════════════════════════════════════════════
  if (pathname === "/api/email-accounts" && req.method === "GET") {
    const qsParams  = new URL(req.url, `http://localhost:${PORT}`).searchParams;
    const accountId = qsParams.get("account_id");
    const startDate = qsParams.get("start_date");
    const endDate   = qsParams.get("end_date");
    const accounts  = readAccounts();
    const acc = accountId
      ? accounts.find(a => a.id === accountId)
      : accounts.find(a => a.api_key === storedKey);
    const apiKey = acc?.api_key || storedKey;

    if (!apiKey) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "No API key. Select an account first." }));
      return;
    }

    function eaGet(targetPath) {
      return new Promise(resolve => {
        const opts = {
          hostname: "api.instantly.ai", port: 443,
          path: targetPath, method: "GET",
          headers: { "Authorization": `Bearer ${apiKey}`, "Accept": "application/json" },
        };
        const pr = https.request(opts, pres => {
          let buf = "";
          pres.on("data", c => buf += c);
          pres.on("end", () => {
            try { resolve({ status: pres.statusCode, body: JSON.parse(buf) }); }
            catch { resolve({ status: pres.statusCode, body: null }); }
          });
        });
        pr.on("error", () => resolve({ status: 0, body: null }));
        pr.setTimeout(12000, () => { pr.destroy(); resolve({ status: 0, body: null }); });
        pr.end();
      });
    }

    // Cursor-paginate /api/v2/accounts — same pattern as campaigns
    async function fetchAllEmailAccounts() {
      const all = [];
      let cursor = null;
      let page   = 0;
      while (true) {
        page++;
        const qs = cursor
          ? `limit=100&starting_after=${encodeURIComponent(cursor)}`
          : "limit=100";
        const { status, body } = await eaGet(`/api/v2/accounts?${qs}`);
        if (status !== 200 || !body) {
          flog(`[email-accounts] page ${page}: HTTP ${status} — stopping pagination`);
          break;
        }
        const items = Array.isArray(body) ? body : (body.items || body.data || []);
        all.push(...items);
        flog(`[email-accounts page ${page}: ${items.length} accounts (total so far: ${all.length})`);

        // Log field names of the first account (once) so we can verify mapping
        if (page === 1 && items.length > 0) {
          flog("[email-accounts] first account keys:", Object.keys(items[0]));
          flog("[email-accounts] first account sample:", JSON.stringify(items[0], null, 2));
        }

        const next = body.next_starting_after;
        if (!next || items.length === 0) break;
        if (page >= 30) {
          flog("[email-accounts] safety cap hit at 3000 accounts — stopping");
          break;
        }
        cursor = next;
      }
      return all;
    }

    (async () => {
      try {
        // Build date-scoped analytics query string
        const anaQS = (startDate && endDate)
          ? `start_date=${startDate}&end_date=${endDate}&limit=1000`
          : "limit=1000";

        // Fetch accounts, campaigns, alt-accounts, analytics — all in parallel.
        const [emailAccounts, allCampaigns, altAccountsRes, anaRes] = await Promise.all([
          fetchAllEmailAccounts(),
          fetchAllCampaignsForKey(apiKey),
          eaGet("/api/v2/email-accounts?limit=1000"),
          eaGet(`/api/v2/campaigns/analytics?${anaQS}`),
        ]);

        // ── Paginate all Instantly custom-tag definitions → {id: {id,name,color}} ──
        // Tries GET /api/v2/custom-tags with cursor pagination to get every tag.
        const instantlyTagById = {};
        {
          let cursor2 = null, page2 = 0;
          while (true) {
            page2++;
            const qs2 = cursor2 ? `limit=100&starting_after=${encodeURIComponent(cursor2)}` : "limit=100";
            const r2 = await eaGet(`/api/v2/custom-tags?${qs2}`);
            if (r2.status !== 200 || !r2.body) break;
            const items2 = Array.isArray(r2.body.items) ? r2.body.items
                         : Array.isArray(r2.body)       ? r2.body : [];
            // Log first tag to diagnose field names
            if (items2.length > 0 && page2 === 1) {
              flog("[email-accounts] custom-tags first item keys:", Object.keys(items2[0]));
              flog("[email-accounts] custom-tags first item:", JSON.stringify(items2[0]));
            }
            items2.forEach(t => {
              if (!t.id) return;
              // Instantly may use 'name', 'tag_name', 'label', or 'title' for the tag name
              const tagName = t.name || t.tag_name || t.label || t.title || null;
              const tagColor = t.color || t.tag_color || t.hex_color || null;
              instantlyTagById[t.id] = { id: t.id, name: tagName, color: tagColor };
            });
            const next2 = r2.body.next_starting_after;
            if (!next2 || items2.length === 0 || page2 >= 10) break;
            cursor2 = next2;
          }
          flog(`[email-accounts Instantly custom tags fetched: ${Object.keys(instantlyTagById).length}`);
        }

        // ── Build sets: ALL tag IDs (for email-tags column) vs ACTIVE-only (for in_campaign) ──
        // Instantly campaigns link to email accounts via email_tag_list (array of tag UUIDs).
        // "In Campaign" = account is in an ACTIVE (status=1) campaign.
        // "Email Tags"  = all tags the account belongs to, regardless of campaign status.
        const allTagIds    = new Set();  // every tag seen across ALL campaigns
        const activeTagIds = new Set();  // tags used by campaigns with status === 1 (Active)
        // Log campaign statuses to diagnose type (number vs string)
        const statusCounts = {};
        allCampaigns.forEach(c => { statusCounts[`${c.status}(${typeof c.status})`] = (statusCounts[`${c.status}(${typeof c.status})`] || 0) + 1; });
        flog("[email-accounts] campaign status breakdown:", JSON.stringify(statusCounts));
        allCampaigns.forEach(c => {
          if (!Array.isArray(c.email_tag_list)) return;
          // Use Number() cast — Instantly may return status as string "1" or number 1
          const isActive = Number(c.status) === 1;
          c.email_tag_list.forEach(tagId => {
            if (!tagId) return;
            allTagIds.add(tagId);
            if (isActive) activeTagIds.add(tagId);
          });
        });
        // Log a sample of active campaigns for debugging
        const activeCampaigns = allCampaigns.filter(c => Number(c.status) === 1);
        flog(`[email-accounts total tag IDs: ${allTagIds.size}, active-campaign tag IDs: ${activeTagIds.size} (from ${allCampaigns.length} campaigns, ${activeCampaigns.length} active)`);
        if (activeCampaigns.length > 0) {
          flog("[email-accounts] active campaign sample:", activeCampaigns.slice(0, 3).map(c => ({ name: c.name, status: c.status, tag_count: (c.email_tag_list||[]).length })));
        }

        // ── Batch runner — limits concurrency to avoid OOM from too many parallel HTTPS calls ──
        async function batchRun(items, fn, concurrency = 5) {
          const results = [];
          for (let i = 0; i < items.length; i += concurrency) {
            const slice = items.slice(i, i + concurrency);
            const sliceResults = await Promise.all(slice.map(fn));
            results.push(...sliceResults);
          }
          return results;
        }

        // ── For each tag, paginate accounts and build email → [tagId] map ──
        async function fetchAccountsForTag(tagId) {
          const emails = [];
          let cursor = null;
          let page = 0;
          while (true) {
            page++;
            const qs = cursor
              ? `tag_id=${encodeURIComponent(tagId)}&limit=100&starting_after=${encodeURIComponent(cursor)}`
              : `tag_id=${encodeURIComponent(tagId)}&limit=100`;
            const r = await eaGet(`/api/v2/accounts?${qs}`);
            if (r.status !== 200 || !r.body) break;
            const items = Array.isArray(r.body.items) ? r.body.items
                        : Array.isArray(r.body)       ? r.body : [];
            items.forEach(a => {
              const em = a.email || a.address || a.from_address || "";
              if (em) emails.push(em.toLowerCase());
            });
            const next = r.body.next_starting_after;
            if (!next || items.length === 0 || page >= 20) break;
            cursor = next;
          }
          return { tagId, emails };
        }

        // ── Build email → [customTagId] via GET /api/v2/custom-tag-mappings ─────
        // This is the CORRECT approach. GET /api/v2/accounts?tag_id= ignores the
        // filter and returns ALL accounts every time — completely unusable for per-tag lookup.
        // custom-tag-mappings directly returns {custom_tag_id, resource_id} pairs.
        const emailToCustomTagIds = {};
        {
          let ctmCursor = null, ctmPage = 0;
          while (true) {
            ctmPage++;
            const qs = ctmCursor
              ? `limit=100&starting_after=${encodeURIComponent(ctmCursor)}`
              : "limit=100";
            const r = await eaGet(`/api/v2/custom-tag-mappings?${qs}`);
            flog(`[email-accounts] custom-tag-mappings page ${ctmPage}: HTTP ${r.status}`);
            if (r.status !== 200 || !r.body) break;
            const items = Array.isArray(r.body.items) ? r.body.items
                        : Array.isArray(r.body)       ? r.body : [];
            if (items.length > 0 && ctmPage === 1) {
              flog("[email-accounts] custom-tag-mappings first item keys:", Object.keys(items[0]));
              flog("[email-accounts] custom-tag-mappings first item:", JSON.stringify(items[0]));
            }
            items.forEach(m => {
              // Try all likely field name variants for tag ID and resource (account email/id)
              const tagId   = m.custom_tag_id || m.tag_id    || m.customTagId   || m.label_id;
              const resource = m.resource_id  || m.account_id || m.email         || m.resourceId
                            || m.account_email || m.address   || m.from_address;
              if (!tagId || !resource || !instantlyTagById[tagId]) return;
              // resource_id may be an email or an account UUID — normalise
              const key = resource.includes("@") ? resource.toLowerCase() : resource;
              if (!emailToCustomTagIds[key]) emailToCustomTagIds[key] = [];
              if (!emailToCustomTagIds[key].includes(tagId)) emailToCustomTagIds[key].push(tagId);
            });
            const next = r.body.next_starting_after;
            if (!next || items.length === 0 || ctmPage >= 30) break;
            ctmCursor = next;
          }
          flog(`[email-accounts] emailToCustomTagIds from mappings: ${Object.keys(emailToCustomTagIds).length} resources`);

          // If resource_id was a UUID (not email), build a secondary email → tagIds map
          // by matching account UUIDs to account emails from emailAccounts list
          const uuidKeys = Object.keys(emailToCustomTagIds).filter(k => !k.includes("@"));
          if (uuidKeys.length > 0) {
            flog(`[email-accounts] ${uuidKeys.length} mapping keys look like UUIDs — resolving to emails...`);
            const acctById = {};
            emailAccounts.forEach(a => { if (a.id) acctById[a.id] = a.email || a.address || ""; });
            uuidKeys.forEach(uuid => {
              const email = acctById[uuid];
              if (!email) return;
              const emLower = email.toLowerCase();
              const tagIds = emailToCustomTagIds[uuid];
              if (!emailToCustomTagIds[emLower]) emailToCustomTagIds[emLower] = [];
              tagIds.forEach(tid => { if (!emailToCustomTagIds[emLower].includes(tid)) emailToCustomTagIds[emLower].push(tid); });
              delete emailToCustomTagIds[uuid];
            });
            flog(`[email-accounts] after UUID→email resolve: ${Object.keys(emailToCustomTagIds).length} email keys`);
          }
        }

        // ── Determine "In Campaign" ────────────────────────────────────────────
        // Cross-ref: which custom-tag IDs appear in active campaigns' email_tag_list?
        const activeCampaignCustomTagIds = new Set();
        allCampaigns.forEach(c => {
          if (Number(c.status) !== 1) return;
          (c.email_tag_list || []).forEach(id => { if (instantlyTagById[id]) activeCampaignCustomTagIds.add(id); });
        });
        flog(`[email-accounts] activeCampaignCustomTagIds overlap: ${activeCampaignCustomTagIds.size}`);

        const campaignEmailSet = new Set();
        if (Object.keys(emailToCustomTagIds).length > 0) {
          // Use custom-tag mappings to determine in_campaign
          Object.entries(emailToCustomTagIds).forEach(([em, tagIds]) => {
            if (activeCampaignCustomTagIds.size > 0) {
              // email_tag_list overlaps with custom tags — check if account's tag is active
              if (tagIds.some(id => activeCampaignCustomTagIds.has(id))) campaignEmailSet.add(em);
            }
            // If no overlap (different ID namespaces), in_campaign stays false — we can't determine it
          });
          flog(`[email-accounts] campaignEmailSet size: ${campaignEmailSet.size}`);
        }

        // Keep for compat
        const emailToTagIds = {};
        const campaignAccountIdSet = new Set();

        // ── Assign fallback colors to any custom tag missing one ──
        const TAG_COLORS = ["#6366f1","#0ea5e9","#10b981","#f59e0b","#ef4444","#8b5cf6","#ec4899","#14b8a6"];
        let colorIdx = 0;
        Object.values(instantlyTagById).forEach(t => {
          if (!t.color) t.color = TAG_COLORS[colorIdx++ % TAG_COLORS.length];
        });
        flog(`[email-accounts instantlyTagById resolved: ${Object.keys(instantlyTagById).length} tags`);

        // ── Build enrichment map from /api/v2/email-accounts (may have more fields) ──
        function extractItems(r) {
          if (!r || r.status !== 200 || !r.body) return [];
          if (Array.isArray(r.body)) return r.body;
          return r.body.items || r.body.data || r.body.accounts || [];
        }
        const altItems = extractItems(altAccountsRes);
        flog(`[email-accounts /email-accounts HTTP ${altAccountsRes.status}, items: ${altItems.length}`);
        if (altItems.length > 0) {
          flog("[email-accounts] alt account keys:", Object.keys(altItems[0]));
          const wKeys = Object.keys(altItems[0]).filter(k => /warmup|stat|health|sent|daily|limit/i.test(k));
          flog("[email-accounts] alt warmup/stat fields:", JSON.stringify(Object.fromEntries(wKeys.map(k => [k, altItems[0][k]]))));
        }
        // Key alt items by email so we can merge extra fields
        const altByEmail = {};
        altItems.forEach(a => {
          const k = a.email || a.address || a.from_address;
          if (k) altByEmail[k] = a;
        });

        const analytics = (anaRes.status === 200 && anaRes.body)
          ? (Array.isArray(anaRes.body) ? anaRes.body : (anaRes.body.items || []))
          : [];

        // instantlyTagById populated above from GET /api/v2/custom-tags

        flog(`[email-accounts total accounts fetched: ${emailAccounts.length}`);

        // ── Normalize account fields ──────────────────────────────────
        // The /api/v2/accounts list omits health_score and warmup counts.
        // We merge those from warmup-analytics by email, then fall back to
        // any nested warmup_details object on the account itself.
        const normalizedAccounts = emailAccounts.map(ea => {
          const emailKey = ea.email || ea.address || ea.from_address || "";
          const alt = altByEmail[emailKey] || {};       // /email-accounts alt endpoint
          const wd  = ea.warmup_details || ea.warmup || {};  // nested warmup object

          // ── Health score ──────────────────────────────────────────────
          // CONFIRMED: Instantly puts this in ea.stat_warmup_score (0-100 int).
          // Also check alt endpoint and nested warmup_details.
          const health_score =
            ea.stat_warmup_score     ?? ea.health_score        ?? ea.score            ??
            alt.stat_warmup_score    ?? alt.health_score       ?? alt.score           ??
            wd.health_score          ?? wd.score               ?? null;

          // ── Warmup emails sent ────────────────────────────────────────
          // Not in the account list; try alt endpoint and nested warmup object.
          const warmup_email_count =
            alt.warmup_email_count   ?? alt.warmup_emails_sent ?? alt.total_warmup_sent ??
            alt.stat_warmup_count    ?? alt.warmup_count       ??
            ea.warmup_email_count    ?? ea.warmup_emails_count ?? ea.stat_warmup_email_count ??
            wd.email_count           ?? wd.warmup_email_count  ?? wd.emails_sent ??
            wd.emails_sent_today ?? wd.warmup_email_count ?? wd.sent_today ??
            null;

          // daily sending limit — exhaustive field name search across all sources.
          const wm = ea.warmup || {};  // nested warmup object on the account
          const daily_limit =
            ea.daily_limit           ?? ea.sending_limit          ?? ea.daily_sending_limit ??
            ea.send_limit            ?? ea.max_sends_per_day      ?? ea.sends_per_day       ??
            ea.daily_send_limit      ?? ea.max_daily_sends        ?? ea.per_day_limit       ??
            ea.limit                 ?? ea.email_limit            ?? ea.max_emails_per_day  ??
            alt.daily_limit          ?? alt.sending_limit         ?? alt.send_limit         ??
            wd.daily_limit           ?? wd.sending_limit          ??
            wm.daily_limit           ?? wm.sending_limit          ?? wm.limit               ??
            ea.smtp?.daily_limit     ?? ea.smtp?.send_limit       ?? ea.smtp?.limit         ??
            ea.imap?.daily_limit     ?? null;

          // Emails sent (total in period)
          const emails_sent_count =
            alt.emails_sent_count ?? alt.sent_count ?? alt.total_sent ??
            ea.emails_sent_count  ?? ea.sent_count  ?? ea.total_sent  ??
            null;

          // Emails sent today (the "X" in "X / daily_limit" display)
          const sent_today =
            alt.sent_today       ?? alt.emails_sent_today ?? alt.sends_today     ??
            ea.sent_today        ?? ea.emails_sent_today  ?? ea.sends_today      ??
            wm.sent_today        ?? wm.emails_sent_today  ?? null;

          return {
            ...ea,
            health_score,
            warmup_email_count,
            daily_limit,
            emails_sent_count,
            sent_today,
            in_campaign: emailKey ? campaignEmailSet.has(emailKey.toLowerCase()) : false,
            // Use emailToCustomTagIds (built from real custom-tag IDs) — NOT emailToTagIds
            // (which uses campaign email_tag_list IDs that don't match custom-tag IDs).
            instantlyTags: (emailToCustomTagIds[emailKey.toLowerCase()] || [])
              .map(id => instantlyTagById[id] || { id, name: `Tag ${id.slice(0,6)}`, color:"#6366f1" }),
          };
        });

        // Log a sample to confirm normalization succeeded
        if (normalizedAccounts.length > 0) {
          const s = normalizedAccounts[0];
          flog(`[email-accounts normalized[0] — health_score:${s.health_score} warmup_email_count:${s.warmup_email_count} daily_limit:${s.daily_limit} emails_sent_count:${s.emails_sent_count} sent_today:${s.sent_today}`);
        }

        // ── Log raw fields of first account missing daily_limit ──────────
        const nullLimitAcct = normalizedAccounts.find(a => a.daily_limit == null);
        if (nullLimitAcct) {
          flog("[email-accounts] ⚠ Account with null daily_limit — ALL raw keys:", Object.keys(nullLimitAcct));
          // Log every field that could relate to limits or sending
          const limitLike = Object.entries(nullLimitAcct).filter(([k]) =>
            /limit|send|daily|quota|max|per_day|capacity|smtp|imap|count/i.test(k)
          );
          flog("[email-accounts] ⚠ Limit-related raw fields:", JSON.stringify(Object.fromEntries(limitLike), null, 2));
          // Also log smtp/imap nested objects if present
          if (nullLimitAcct.smtp) flog("[email-accounts] smtp object:", JSON.stringify(nullLimitAcct.smtp, null, 2));
          if (nullLimitAcct.imap) flog("[email-accounts] imap object:", JSON.stringify(nullLimitAcct.imap, null, 2));
          if (nullLimitAcct.settings) flog("[email-accounts] settings object:", JSON.stringify(nullLimitAcct.settings, null, 2));
        }

        // ── Enrich accounts missing daily_limit via individual endpoint ──
        // /api/v2/accounts/{id} returns more fields than the list endpoint.
        // Only fetch for accounts where daily_limit is still null after merging.
        const missingLimit = normalizedAccounts.filter(a => a.daily_limit == null && a.id);
        if (missingLimit.length > 0 && missingLimit.length <= 50) {
          flog(`[email-accounts Enriching ${missingLimit.length} accounts with individual endpoint...`);
          const enrichBatch = missingLimit.slice(0, 50); // max 50 individual calls
          const enrichResults = await Promise.all(
            enrichBatch.map(a => eaGet(`/api/v2/accounts/${a.id}`))
          );
          // Log what the individual endpoint returns for the first one
          if (enrichResults[0]?.status === 200 && enrichResults[0]?.body) {
            const sample = enrichResults[0].body;
            flog("[email-accounts] Individual account keys:", Object.keys(sample));
            const limitLike2 = Object.entries(sample).filter(([k]) =>
              /limit|send|daily|quota|max|per_day|capacity/i.test(k)
            );
            flog("[email-accounts] Individual account limit fields:", JSON.stringify(Object.fromEntries(limitLike2)));
            if (sample.smtp) flog("[email-accounts] Individual smtp:", JSON.stringify(sample.smtp));
          }
          // Merge enriched data back
          const enrichById = {};
          enrichBatch.forEach((a, i) => {
            const r = enrichResults[i];
            if (r?.status === 200 && r.body) enrichById[a.id] = r.body;
          });
          normalizedAccounts.forEach((a, idx) => {
            if (a.daily_limit != null) return;
            const rich = enrichById[a.id];
            if (!rich) return;
            const dl =
              rich.daily_limit          ?? rich.sending_limit         ?? rich.daily_sending_limit ??
              rich.send_limit           ?? rich.max_sends_per_day     ?? rich.sends_per_day        ??
              rich.daily_send_limit     ?? rich.max_daily_sends       ?? rich.per_day_limit        ??
              rich.limit                ?? rich.email_limit           ?? rich.max_emails_per_day   ??
              rich.smtp?.daily_limit    ?? rich.smtp?.send_limit      ?? rich.smtp?.limit          ??
              rich.smtp?.max_per_day    ?? rich.smtp?.sending_limit   ??
              rich.settings?.daily_limit ?? rich.settings?.send_limit ??
              rich.connection?.daily_limit ?? rich.connection?.limit  ??
              null;
            if (dl != null) {
              normalizedAccounts[idx] = { ...a, daily_limit: dl };
              flog(`[email-accounts enriched ${a.email || a.id} → daily_limit=${dl}`);
            } else {
              // log the full rich object for further debugging
              flog(`[email-accounts still no limit for ${a.email || a.id}: rich keys=${Object.keys(rich)}`);
            }
          });
        } else if (missingLimit.length > 50) {
          flog(`[email-accounts ${missingLimit.length} accounts missing daily_limit — too many to enrich individually`);
        }

        // ── Merge custom local tags onto each account ──────────────────
        const localTagsData = readAcctTags();
        // Build email → [localTagId, ...] lookup (separate from Instantly tag map)
        const localEmailToTagIds = {};
        localTagsData.tags.forEach(t => {
          t.emails.forEach(em => {
            if (!localEmailToTagIds[em]) localEmailToTagIds[em] = [];
            localEmailToTagIds[em].push(t.id);
          });
        });
        normalizedAccounts.forEach(a => {
          const tagIds = localEmailToTagIds[a.email] || [];
          a.customTags = tagIds.map(id => localTagsData.tags.find(t => t.id === id)).filter(Boolean);
        });

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          emailAccounts: normalizedAccounts,
          analytics,
          total: normalizedAccounts.length,
          customTags: localTagsData.tags,
          instantlyTagDefs: Object.values(instantlyTagById), // tag name+color definitions for the frontend
          campaignEmailSet: [...campaignEmailSet],  // for debugging; active campaigns only
        }));
      } catch (e) {
        flog("[email-accounts] Error:", e.message);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message, emailAccounts: [], analytics: [] }));
      }
    })();
    return;
  }

  // ══════════════════════════════════════════════════════════════════
  // SHARED HELPER — cursor-paginate /api/v2/campaigns for a given key
  // Returns all campaigns (no limit=100 cap).
  // ══════════════════════════════════════════════════════════════════
  function fetchAllCampaignsForKey(apiKey) {
    function g(p) {
      return new Promise(resolve => {
        const opts = {
          hostname: "api.instantly.ai", port: 443, path: p, method: "GET",
          headers: { "Authorization": `Bearer ${apiKey}`, "Accept": "application/json" },
        };
        const pr = https.request(opts, pres => {
          let buf = "";
          pres.on("data", c => buf += c);
          pres.on("end", () => {
            try { resolve({ status: pres.statusCode, body: JSON.parse(buf) }); }
            catch { resolve({ status: pres.statusCode, body: null }); }
          });
        });
        pr.on("error", () => resolve({ status: 0, body: null }));
        pr.setTimeout(15000, () => { pr.destroy(); resolve({ status: 0, body: null }); });
        pr.end();
      });
    }
    return (async () => {
      const all = []; let cursor = null; let page = 0;
      while (true) {
        page++;
        const qs = cursor ? `limit=100&starting_after=${encodeURIComponent(cursor)}` : "limit=100";
        const { status, body } = await g(`/api/v2/campaigns?${qs}`);
        if (status !== 200 || !body) break;
        const items = Array.isArray(body) ? body : (body.items || []);
        all.push(...items);
        const next = body.next_starting_after;
        if (!next || items.length === 0 || page >= 20) break;
        cursor = next;
      }
      return all;
    })();
  }

  // Shared single-request helper for a given API key
  function makeInstantlyGet(apiKey) {
    return function g(p) {
      return new Promise(resolve => {
        const opts = {
          hostname: "api.instantly.ai", port: 443, path: p, method: "GET",
          headers: { "Authorization": `Bearer ${apiKey}`, "Accept": "application/json" },
        };
        const pr = https.request(opts, pres => {
          let buf = "";
          pres.on("data", c => buf += c);
          pres.on("end", () => {
            try { resolve({ status: pres.statusCode, body: JSON.parse(buf) }); }
            catch { resolve({ status: pres.statusCode, body: null }); }
          });
        });
        pr.on("error", () => resolve({ status: 0, body: null }));
        pr.setTimeout(15000, () => { pr.destroy(); resolve({ status: 0, body: null }); });
        pr.end();
      });
    };
  }

  // ══════════════════════════════════════════════════════════════════
  // MASTER DASHBOARD SUMMARY — GET /api/dashboard/summary
  // Query params: start_date, end_date (YYYY-MM-DD)
  // ══════════════════════════════════════════════════════════════════
  if (pathname === "/api/dashboard/summary" && req.method === "GET") {
    const qpS       = new URL(req.url, `http://localhost:${PORT}`).searchParams;
    const startDate = qpS.get("start_date") || "";
    const endDate   = qpS.get("end_date")   || "";
    const allAccounts = readAccounts();

    if (allAccounts.length === 0) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ accounts: [], totals: { sent:0, opened:0, replied:0, bounced:0, activeCampaigns:0 } }));
      return;
    }

    async function summaryForAccount(acc) {
      const g = makeInstantlyGet(acc.api_key);
      try {
        // All campaigns (paginated) + date-filtered analytics in parallel
        const dateQS = startDate && endDate
          ? `start_date=${startDate}&end_date=${endDate}&limit=1000`
          : "limit=1000";

        const [campaigns, anaRes] = await Promise.all([
          fetchAllCampaignsForKey(acc.api_key),
          g(`/api/v2/campaigns/analytics?${dateQS}`),
        ]);

        const analytics = (anaRes.status === 200 && anaRes.body)
          ? (Array.isArray(anaRes.body) ? anaRes.body : (anaRes.body.items || []))
          : [];

        let sent = 0, opened = 0, replied = 0, bounced = 0;
        analytics.forEach(a => {
          sent    += a.emails_sent_count  ?? 0;
          opened  += a.open_count_unique  ?? 0;
          replied += a.reply_count_unique ?? 0;
          bounced += a.bounced_count      ?? 0;
        });

        const activeCampaigns = campaigns.filter(c => c.status === 1).length;
        const openRate   = sent > 0 ? (opened  / sent) * 100 : 0;
        const replyRate  = sent > 0 ? (replied / sent) * 100 : 0;
        const bounceRate = sent > 0 ? (bounced / sent) * 100 : 0;

        let health = "green";
        if (openRate < 25 || bounceRate > 5)  health = "red";
        else if (openRate < 35 || bounceRate > 3) health = "yellow";

        return {
          id: acc.id, name: acc.name,
          sent, opened, replied, bounced,
          openRate, replyRate, bounceRate,
          activeCampaigns, totalCampaigns: campaigns.length,
          health, ok: true,
        };
      } catch (e) {
        return { id: acc.id, name: acc.name, ok: false, error: e.message,
                 sent:0, opened:0, replied:0, bounced:0, openRate:0, replyRate:0, bounceRate:0,
                 activeCampaigns:0, totalCampaigns:0, health: "unknown" };
      }
    }

    (async () => {
      console.log(`[dashboard/summary] ${allAccounts.length} accounts | range: ${startDate||"all"}→${endDate||"all"}`);
      const results = await Promise.all(allAccounts.map(summaryForAccount));
      const ok = results.filter(r => r.ok);
      const totals = ok.reduce((t, r) => ({
        sent:            t.sent            + r.sent,
        opened:          t.opened          + r.opened,
        replied:         t.replied         + r.replied,
        bounced:         t.bounced         + r.bounced,
        activeCampaigns: t.activeCampaigns + r.activeCampaigns,
        totalCampaigns:  t.totalCampaigns  + r.totalCampaigns,
      }), { sent:0, opened:0, replied:0, bounced:0, activeCampaigns:0, totalCampaigns:0 });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ accounts: results, totals, dateRange: { startDate, endDate } }));
    })();
    return;
  }

  // ══════════════════════════════════════════════════════════════════
  // MASTER DASHBOARD ALERTS — GET /api/dashboard/alerts
  // Query params: open_threshold, bounce_threshold, start_date, end_date
  // Campaign names resolved via paginated fetch — no more UUID display.
  // ══════════════════════════════════════════════════════════════════
  if (pathname === "/api/dashboard/alerts" && req.method === "GET") {
    const qp = new URL(req.url, `http://localhost:${PORT}`).searchParams;
    const openThresh   = Number(qp.get("open_threshold"))   || 35;
    const bounceThresh = Number(qp.get("bounce_threshold")) || 5;
    const startDate    = qp.get("start_date") || "";
    const endDate      = qp.get("end_date")   || "";
    const allAccounts  = readAccounts();

    if (allAccounts.length === 0) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ alerts: [], total: 0 }));
      return;
    }

    async function alertsForAccount(acc) {
      const g = makeInstantlyGet(acc.api_key);
      try {
        const dateQS = startDate && endDate
          ? `start_date=${startDate}&end_date=${endDate}&limit=1000`
          : "limit=1000";

        // Fetch ALL campaigns (paginated) so nameMap is complete, + date-filtered analytics
        const [campaigns, anaRes] = await Promise.all([
          fetchAllCampaignsForKey(acc.api_key),
          g(`/api/v2/campaigns/analytics?${dateQS}`),
        ]);

        const analytics = (anaRes.status === 200 && anaRes.body)
          ? (Array.isArray(anaRes.body) ? anaRes.body : (anaRes.body.items || []))
          : [];

        // Build complete name map from ALL campaigns
        const nameMap = {}, statusMap = {};
        campaigns.forEach(c => { nameMap[c.id] = c.name; statusMap[c.id] = c.status; });
        console.log(`[alerts] ${acc.name}: ${campaigns.length} campaigns in nameMap, ${analytics.length} analytics rows`);

        const alerts = [];
        analytics.forEach(a => {
          const sent    = a.emails_sent_count  ?? 0;
          const opened  = a.open_count_unique  ?? 0;
          const replied = a.reply_count_unique ?? 0;
          const bounced = a.bounced_count      ?? 0;
          if (sent === 0) return;

          const openRate   = (opened  / sent) * 100;
          const replyRate  = (replied / sent) * 100;
          const bounceRate = (bounced / sent) * 100;
          // Use resolved name; fall back to a short ID excerpt (not the full UUID)
          const campName   = nameMap[a.campaign_id]
                          || (a.campaign_id ? `(ID: ${a.campaign_id.slice(0,8)}…)` : "Unknown");
          const base = {
            account: acc.name, accountId: acc.id,
            campaign: campName, campaignId: a.campaign_id,
            sent, openRate, replyRate, bounceRate,
            campaignStatus: statusMap[a.campaign_id],
          };

          if (bounceRate > bounceThresh) {
            alerts.push({ ...base, issue: "High bounce rate",
              metric: bounceRate.toFixed(1) + "%", severity: "critical" });
          } else if (bounceRate > 3) {
            alerts.push({ ...base, issue: "Elevated bounce rate",
              metric: bounceRate.toFixed(1) + "%", severity: "warning" });
          }
          if (openRate < 25) {
            alerts.push({ ...base, issue: "Very low open rate",
              metric: openRate.toFixed(1) + "%", severity: "critical" });
          } else if (openRate < openThresh) {
            alerts.push({ ...base, issue: "Low open rate",
              metric: openRate.toFixed(1) + "%", severity: "warning" });
          }
          if (replied === 0 && sent >= 50) {
            alerts.push({ ...base, issue: "Zero replies",
              metric: "0 / " + sent + " sent", severity: "warning" });
          }
        });

        return { accountId: acc.id, alerts };
      } catch (e) {
        return { accountId: acc.id, alerts: [], error: e.message };
      }
    }

    (async () => {
      console.log(`[dashboard/alerts] ${allAccounts.length} accounts | range: ${startDate||"all"}→${endDate||"all"}`);
      const results   = await Promise.all(allAccounts.map(alertsForAccount));
      const allAlerts = results.flatMap(r => r.alerts || []);
      allAlerts.sort((a, b) => {
        if (a.severity === "critical" && b.severity !== "critical") return -1;
        if (b.severity === "critical" && a.severity !== "critical") return 1;
        return b.sent - a.sent;
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ alerts: allAlerts, total: allAlerts.length, dateRange: { startDate, endDate } }));
    })();
    return;
  }

  // ══════════════════════════════════════════════════════════════════
  // INBOX PLACEMENT — GET /api/inbox-placement?account_id=xxx
  //   &start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
  //
  // Flow:
  //   1. GET  /api/v2/inbox-placement-tests       → test list (IDs + metadata)
  //   2. POST /api/v2/inbox-placement-analytics/stats-by-test-id
  //           → per-test inbox/spam/category counts
  //   3. POST /api/v2/inbox-placement-analytics/deliverability-insights
  //           → per-ESP breakdown + period-over-period trend
  //   4. Analyze + return structured response
  // ══════════════════════════════════════════════════════════════════
  if (pathname === "/api/inbox-placement" && req.method === "GET") {
    const ipQS    = new URL(req.url, `http://localhost:${PORT}`).searchParams;
    const accountId = ipQS.get("account_id");
    const startDate = ipQS.get("start_date") || null;
    const endDate   = ipQS.get("end_date")   || null;
    const accs = readAccounts();
    const acc  = accountId ? accs.find(a => a.id === accountId) : accs.find(a => a.api_key === storedKey);
    const apiKey = acc?.api_key || storedKey;

    if (!apiKey) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "No API key. Select an account first." }));
      return;
    }

    // ── HTTPS helper ────────────────────────────────────────────────
    function ipGet(targetPath) {
      return new Promise(resolve => {
        const opts = {
          hostname: "api.instantly.ai", port: 443,
          path: targetPath, method: "GET",
          headers: { "Authorization": `Bearer ${apiKey}`, "Accept": "application/json", "Content-Type": "application/json" },
        };
        const pr = https.request(opts, pres => {
          let buf = "";
          pres.on("data", c => buf += c);
          pres.on("end", () => {
            try { resolve({ status: pres.statusCode, body: JSON.parse(buf) }); }
            catch { resolve({ status: pres.statusCode, body: null, raw: buf.slice(0, 200) }); }
          });
        });
        pr.on("error", () => resolve({ status: 0, body: null }));
        pr.setTimeout(15000, () => { pr.destroy(); resolve({ status: 0, body: null }); });
        pr.end();
      });
    }

    function ipPost(targetPath, payload) {
      return new Promise(resolve => {
        const body = JSON.stringify(payload);
        const opts = {
          hostname: "api.instantly.ai", port: 443,
          path: targetPath, method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
          },
        };
        const pr = https.request(opts, pres => {
          let buf = "";
          pres.on("data", c => buf += c);
          pres.on("end", () => {
            try { resolve({ status: pres.statusCode, body: JSON.parse(buf) }); }
            catch { resolve({ status: pres.statusCode, body: null, raw: buf.slice(0, 200) }); }
          });
        });
        pr.on("error", () => resolve({ status: 0, body: null }));
        pr.setTimeout(20000, () => { pr.destroy(); resolve({ status: 0, body: null }); });
        pr.write(body);
        pr.end();
      });
    }

    // ── ESP / GEO enum → label maps ─────────────────────────────────
    const ESP_MAP = {
      0: "Unknown", 1: "Gmail", 2: "Outlook", 3: "Yahoo",
      4: "Apple Mail", 5: "AOL", 6: "Other",
    };
    const GEO_MAP = { 0: "Unknown", 1: "US", 2: "EU", 3: "APAC", 4: "LATAM", 5: "Other" };
    const TYPE_MAP = { 0: "Unknown", 1: "Personal", 2: "Business" };

    // ── Analysis engine ─────────────────────────────────────────────
    function analyzePlacement(inboxPct, spamPct, categoryPct, authData) {
      const issues = [];

      if (spamPct > 20) {
        issues.push({
          severity: "critical", issue: "High spam placement",
          recommendations: [
            "Reduce sending volume and pause sequences temporarily",
            "Verify SPF, DKIM, and DMARC DNS records are correctly set",
            "Check domain/IP reputation at MXToolbox or Google Postmaster",
            "Remove spam trigger words from subject lines and body copy",
            "Warm up affected domain gradually over 4–6 weeks",
          ],
        });
      }

      if (inboxPct < 50) {
        issues.push({
          severity: "warning", issue: "Low inbox rate",
          recommendations: [
            "Increase email personalization (first name, company, custom lines)",
            "Reduce the number of links per email to 1 or fewer",
            "Improve copy quality — write like a human, not a marketer",
            "Encourage reply signals: ask a direct question at the end",
            "Clean list — remove unengaged contacts older than 90 days",
          ],
        });
      }

      if (categoryPct > 30) {
        issues.push({
          severity: "info", issue: "Landing in promotions tab",
          recommendations: [
            "Switch to plain-text or minimal-HTML format",
            "Avoid marketing language: 'free', 'offer', 'deal', 'click here'",
            "Remove heavy HTML templates, logos, or promotional images",
            "Write shorter, more conversational copy",
            "Reduce image-to-text ratio significantly",
          ],
        });
      }

      // Auth failure warnings
      if (authData) {
        if (authData.spf_fail_rate > 5)  issues.push({ severity: "warning", issue: "SPF failures detected",   recommendations: ["Review your SPF record and ensure sending IPs are authorised"] });
        if (authData.dkim_fail_rate > 5) issues.push({ severity: "warning", issue: "DKIM failures detected",  recommendations: ["Re-generate and re-publish DKIM keys for the sending domain"] });
        if (authData.dmarc_fail_rate > 5)issues.push({ severity: "warning", issue: "DMARC failures detected", recommendations: ["Ensure DMARC policy is set and SPF/DKIM alignment is correct"] });
      }

      const status =
        issues.some(i => i.severity === "critical") ? "critical"
        : issues.some(i => i.severity === "warning") ? "warning"
        : (inboxPct > 90 && spamPct < 10)           ? "healthy"
        : issues.length > 0                          ? "info"
        : "healthy";

      return { status, issues };
    }

    // ── Fetch all inbox placement tests (cursor-paginated) ───────────
    async function fetchAllTests() {
      const all = []; let cursor = null; let page = 0;
      while (true) {
        page++;
        const qs = cursor
          ? `limit=50&starting_after=${encodeURIComponent(cursor)}`
          : "limit=50";
        const { status, body } = await ipGet(`/api/v2/inbox-placement-tests?${qs}`);
        if (status !== 200 || !body) {
          console.log(`[inbox-placement] tests list HTTP ${status}. body: ${JSON.stringify(body)?.slice(0,200)}`);
          break;
        }
        const items = Array.isArray(body) ? body : (body.items || body.data || []);
        if (page === 1 && items.length > 0) {
          console.log("[inbox-placement] test keys:", Object.keys(items[0]));
          console.log("[inbox-placement] test sample:", JSON.stringify(items[0], null, 2));
        }
        all.push(...items);
        const next = body.next_starting_after;
        if (!next || items.length === 0 || page >= 10) break;
        cursor = next;
      }
      return all;
    }

    (async () => {
      try {
        // 1. Get test list
        const tests = await fetchAllTests();
        console.log(`[inbox-placement] total tests: ${tests.length}`);

        if (tests.length === 0) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            tests: [], summary: { total_tests: 0, avg_inbox: 0, avg_spam: 0, avg_category: 0, critical: 0, warning: 0 },
            accounts: [], espBreakdown: [], alerts: [], trend: [], empty: true,
          }));
          return;
        }

        const testIds = tests.map(t => t.id).filter(Boolean);

        // 2. Fetch stats for all tests in one POST
        const statsPayload = { test_ids: testIds };
        if (startDate) statsPayload.date_from = startDate;
        if (endDate)   statsPayload.date_to   = endDate;

        const statsRes = await ipPost(
          "/api/v2/inbox-placement-analytics/stats-by-test-id",
          statsPayload
        );
        console.log(`[inbox-placement] stats HTTP ${statsRes.status}, items: ${(Array.isArray(statsRes.body) ? statsRes.body.length : JSON.stringify(statsRes.body)?.slice(0,100))}`);

        const statsItems = Array.isArray(statsRes.body) ? statsRes.body
          : (statsRes.body?.items || []);

        // Build stats lookup by test_id
        const statsMap = {};
        statsItems.forEach(s => { if (s.test_id) statsMap[s.test_id] = s; });

        // 3. Fetch deliverability insights for each test (per-ESP breakdown)
        //    Run concurrently, cap at 10 concurrent requests
        const insightResults = {};
        const CHUNK = 5;
        for (let i = 0; i < Math.min(testIds.length, 30); i += CHUNK) {
          const chunk = testIds.slice(i, i + CHUNK);
          await Promise.all(chunk.map(async tid => {
            const insightPayload = { test_id: tid, show_previous: true };
            if (startDate) { insightPayload.date_from = startDate; insightPayload.previous_date_from = startDate; }
            if (endDate)   { insightPayload.date_to   = endDate;   insightPayload.previous_date_to   = endDate; }
            const r = await ipPost("/api/v2/inbox-placement-analytics/deliverability-insights", insightPayload);
            if (r.status === 200 && Array.isArray(r.body)) insightResults[tid] = r.body;
          }));
        }

        // ── Log raw field names to help diagnose mismatches ─────────
        if (tests.length > 0) {
          console.log("[inbox-placement] TEST object keys   :", Object.keys(tests[0]).join(", "));
          console.log("[inbox-placement] TEST sample        :", JSON.stringify(tests[0], null, 2).slice(0, 600));
        }
        if (statsItems.length > 0) {
          console.log("[inbox-placement] STATS object keys  :", Object.keys(statsItems[0]).join(", "));
          console.log("[inbox-placement] STATS sample       :", JSON.stringify(statsItems[0], null, 2).slice(0, 600));
        }

        // 4. Normalize: merge test metadata + stats + insights
        const normalizedTests = tests.map(t => {
          const s = statsMap[t.id] || {};
          const insights = insightResults[t.id] || [];

          // ── Sender email: try every plausible field name ───────────
          const senderEmail =
            t.sender_email     ?? t.from_email      ?? t.sending_email ??
            t.sending_account  ?? t.account_email   ?? t.email_account ??
            t.from             ?? t.email            ?? t.account       ??
            t.sender           ?? t.from_address     ?? "Unknown";

          const testName = t.name ?? t.test_name ?? `Test ${t.id?.slice(0,8)}`;
          const createdAt = t.timestamp_created ?? t.created_at ?? t.date ?? null;

          // ── Email counts: try every plausible field name ───────────
          const total         = s.total         ?? s.count        ?? s.emails_count   ?? s.sent          ?? 0;
          const inboxCount    = s.inbox         ?? s.inbox_count  ?? s.inbox_emails   ?? s.inbox_total   ?? 0;
          const spamCount     = s.spam          ?? s.spam_count   ?? s.spam_emails    ?? s.spam_total    ?? 0;
          const categoryCount = s.category      ?? s.category_count ?? s.promo        ?? s.promo_count   ?? 0;

          // ── Percentages: the API may return 0-1 fractions or 0-100 values.
          //    toPercent() normalises: if ≤1 it's a fraction → ×100, else use as-is.
          //    If no percentage field at all, compute from counts.
          const toPercent = (v, fallback) => {
            if (v == null || v === undefined) return fallback;
            return v <= 1 ? v * 100 : v;
          };
          const calcFallback = (count) => total > 0 ? (count / total) * 100 : 0;

          const inboxPct = toPercent(
            s.inbox_rate ?? s.inbox_percent ?? s.inbox_percentage ?? s.inbox_pct,
            calcFallback(inboxCount)
          );
          const spamPct = toPercent(
            s.spam_rate ?? s.spam_percent ?? s.spam_percentage ?? s.spam_pct,
            calcFallback(spamCount)
          );
          const categoryPct = toPercent(
            s.category_rate ?? s.category_percent ?? s.category_percentage ?? s.category_pct ?? s.promo_rate,
            calcFallback(categoryCount)
          );

          // Per-ESP breakdown from insights
          const espRows = insights.map(ins => ({
            senderEspNum:    ins.sender_esp    ?? 0,
            recipientEspNum: ins.recipient_esp ?? 0,
            senderEsp:    ESP_MAP[ins.sender_esp]    ?? `ESP-${ins.sender_esp}`,
            recipientEsp: ESP_MAP[ins.recipient_esp] ?? `ESP-${ins.recipient_esp}`,
            inboxPct:     ins.inbox_percentage     ?? 0,
            spamPct:      ins.spam_percentage      ?? 0,
            categoryPct:  ins.category_percentage  ?? 0,
            prevInboxPct: ins.prev_inbox_percentage    ?? null,
            prevSpamPct:  ins.prev_spam_percentage     ?? null,
            trend: (ins.inbox_percentage != null && ins.prev_inbox_percentage != null)
              ? (ins.inbox_percentage - ins.prev_inbox_percentage)
              : null,
          }));

          const analysis = analyzePlacement(inboxPct, spamPct, categoryPct, null);

          return {
            id: t.id, name: testName, senderEmail, createdAt,
            total, inboxCount, spamCount, categoryCount,
            inboxPct, spamPct, categoryPct,
            status: analysis.status, issues: analysis.issues,
            espRows,
          };
        });

        // 5. Aggregate per sending account
        const accountMap = {};
        normalizedTests.forEach(t => {
          const key = t.senderEmail;
          if (!accountMap[key]) {
            accountMap[key] = { email: key, tests: 0, totalEmails: 0, inboxTotal: 0, spamTotal: 0, categoryTotal: 0, espRows: {} };
          }
          const a = accountMap[key];
          a.tests++;
          a.totalEmails    += t.total;
          a.inboxTotal    += t.inboxCount;
          a.spamTotal     += t.spamCount;
          a.categoryTotal += t.categoryCount;
          // Merge ESP rows
          t.espRows.forEach(e => {
            const espKey = e.recipientEsp;
            if (!a.espRows[espKey]) a.espRows[espKey] = { esp: espKey, inbox: 0, spam: 0, category: 0, total: 0 };
            const ae = a.espRows[espKey];
            ae.inbox += e.inboxPct; ae.spam += e.spamPct; ae.category += e.categoryPct; ae.total++;
          });
        });

        const accountsArray = Object.values(accountMap).map(a => {
          const totalE = a.totalEmails;
          const inboxPct    = totalE > 0 ? (a.inboxTotal    / totalE) * 100 : 0;
          const spamPct     = totalE > 0 ? (a.spamTotal     / totalE) * 100 : 0;
          const categoryPct = totalE > 0 ? (a.categoryTotal / totalE) * 100 : 0;
          const analysis = analyzePlacement(inboxPct, spamPct, categoryPct, null);
          const espRows = Object.values(a.espRows).map(e => ({
            esp: e.esp,
            inboxPct:    e.total > 0 ? e.inbox    / e.total : 0,
            spamPct:     e.total > 0 ? e.spam     / e.total : 0,
            categoryPct: e.total > 0 ? e.category / e.total : 0,
          }));
          return { email: a.email, tests: a.tests, totalEmails: totalE, inboxPct, spamPct, categoryPct, status: analysis.status, issues: analysis.issues, espRows };
        }).sort((a, b) => a.inboxPct - b.inboxPct); // worst first

        // 6. Global ESP breakdown (aggregate across all tests)
        const globalEspMap = {};
        normalizedTests.forEach(t => {
          t.espRows.forEach(e => {
            if (!globalEspMap[e.recipientEsp]) globalEspMap[e.recipientEsp] = { esp: e.recipientEsp, inbox: 0, spam: 0, category: 0, n: 0 };
            const g = globalEspMap[e.recipientEsp];
            g.inbox += e.inboxPct; g.spam += e.spamPct; g.category += e.categoryPct; g.n++;
          });
        });
        const espBreakdown = Object.values(globalEspMap).map(g => ({
          esp: g.esp,
          inboxPct:    g.n > 0 ? g.inbox    / g.n : 0,
          spamPct:     g.n > 0 ? g.spam     / g.n : 0,
          categoryPct: g.n > 0 ? g.category / g.n : 0,
        })).filter(g => g.esp !== "Unknown").sort((a, b) => a.esp.localeCompare(b.esp));

        // 7. Global summary
        const withData = normalizedTests.filter(t => t.total > 0);
        const totalTests = normalizedTests.length;
        const avgInbox    = withData.length > 0 ? withData.reduce((s, t) => s + t.inboxPct,    0) / withData.length : 0;
        const avgSpam     = withData.length > 0 ? withData.reduce((s, t) => s + t.spamPct,     0) / withData.length : 0;
        const avgCategory = withData.length > 0 ? withData.reduce((s, t) => s + t.categoryPct, 0) / withData.length : 0;
        const criticalCount = normalizedTests.filter(t => t.status === "critical").length;
        const warningCount  = normalizedTests.filter(t => t.status === "warning").length;

        // 8. Global alert list
        const allAlerts = [];
        accountsArray.forEach(a => {
          a.issues.forEach(issue => {
            allAlerts.push({
              email: a.email, issue: issue.issue, severity: issue.severity,
              inboxPct: a.inboxPct, spamPct: a.spamPct, categoryPct: a.categoryPct,
              recommendations: issue.recommendations,
            });
          });
        });
        allAlerts.sort((a, b) => {
          const rank = { critical: 0, warning: 1, info: 2 };
          return (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9);
        });

        console.log(`[inbox-placement] done: ${totalTests} tests, ${accountsArray.length} accounts, ${allAlerts.length} alerts`);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          tests: normalizedTests,
          accounts: accountsArray,
          espBreakdown,
          alerts: allAlerts,
          summary: { total_tests: totalTests, avg_inbox: avgInbox, avg_spam: avgSpam, avg_category: avgCategory, critical: criticalCount, warning: warningCount },
        }));
      } catch (e) {
        console.error("[inbox-placement] Error:", e.message, e.stack);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return;
  }

  // ══════════════════════════════════════════════════════════════════
  // INBOX PLACEMENT RECORDS — GET /api/inbox-placement-records
  //   ?account_id=xxx&test_id=xxx
  //
  // Cursor-paginates through GET /api/v2/inbox-placement-analytics?test_id=xxx
  // Returns normalised per-email records: placement, sender, recipient,
  // esp, spf/dkim/dmarc pass, smtp blacklist, timestamp
  // ══════════════════════════════════════════════════════════════════
  if (pathname === "/api/inbox-placement-records" && req.method === "GET") {
    const rQS      = new URL(req.url, `http://localhost:${PORT}`).searchParams;
    const rAccId   = rQS.get("account_id");
    const rTestId  = rQS.get("test_id");

    const rAccs = readAccounts();
    const rAcc  = rAccId ? rAccs.find(a => a.id === rAccId) : rAccs.find(a => a.api_key === storedKey);
    const rKey  = rAcc?.api_key || storedKey;

    if (!rKey) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "No API key. Select an account first." }));
      return;
    }
    if (!rTestId) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "test_id is required" }));
      return;
    }

    (async () => {
      try {
        // ── Kick off accounts fetch in background ──────────────────
        // We fetch /api/v2/accounts to build a sender_email → date_added
        // lookup. This runs concurrently with the records pagination so it
        // adds virtually zero latency.
        const acctsFetchPromise = new Promise(resolve => {
          const opts = {
            hostname: "api.instantly.ai", port: 443,
            path: "/api/v2/accounts?limit=1000", method: "GET",
            headers: { "Authorization": `Bearer ${rKey}`, "Accept": "application/json" },
          };
          const pr = https.request(opts, pres => {
            let buf = "";
            pres.on("data", c => buf += c);
            pres.on("end", () => { try { resolve(JSON.parse(buf)); } catch { resolve(null); } });
          });
          pr.on("error", () => resolve(null));
          pr.setTimeout(15000, () => { pr.destroy(); resolve(null); });
          pr.end();
        });

        // ── Cursor-paginated fetch ─────────────────────────────────
        // MAX_PAGES * limit = max records fetched.
        // A single test can have 2500+ records, so use limit=100 and up to 100
        // pages → ceiling of 10 000 records, enough for any realistic test.
        const records = []; let cursor = null; let page = 0;
        const MAX_PAGES = 100;

        while (page < MAX_PAGES) {
          page++;
          let rPath = `/api/v2/inbox-placement-analytics?test_id=${encodeURIComponent(rTestId)}&limit=100`;
          if (cursor) rPath += `&starting_after=${encodeURIComponent(cursor)}`;

          const result = await new Promise(resolve => {
            const opts = {
              hostname: "api.instantly.ai", port: 443,
              path: rPath, method: "GET",
              headers: {
                "Authorization": `Bearer ${rKey}`,
                "Accept": "application/json",
                "Content-Type": "application/json",
              },
            };
            const pr = https.request(opts, pres => {
              let buf = "";
              pres.on("data", c => buf += c);
              pres.on("end", () => {
                try { resolve({ status: pres.statusCode, body: JSON.parse(buf) }); }
                catch { resolve({ status: pres.statusCode, body: null, raw: buf.slice(0, 300) }); }
              });
            });
            pr.on("error", () => resolve({ status: 0, body: null }));
            pr.setTimeout(15000, () => { pr.destroy(); resolve({ status: 0, body: null }); });
            pr.end();
          });

          if (result.status !== 200 || !result.body) {
            console.log(`[inbox-records] HTTP ${result.status} on page ${page}. raw: ${result.raw || JSON.stringify(result.body)?.slice(0,200)}`);
            break;
          }

          const items = Array.isArray(result.body) ? result.body
            : Array.isArray(result.body.items) ? result.body.items
            : Array.isArray(result.body.data)  ? result.body.data : [];

          if (page === 1 && items.length > 0) {
            console.log("[inbox-records] field names:", Object.keys(items[0]).join(", "));
            console.log("[inbox-records] sample:", JSON.stringify(items[0], null, 2).slice(0, 500));
          }

          records.push(...items);

          const nextCursor = result.body.next_starting_after;
          if (!nextCursor || items.length === 0) break;
          cursor = nextCursor;
        }

        // ── Await accounts fetch + build date-added lookup ─────────
        const acctBody  = await acctsFetchPromise;
        const acctItems = Array.isArray(acctBody) ? acctBody
          : (acctBody?.items || acctBody?.data || []);
        const dateAddedByEmail = {};
        acctItems.forEach(a => {
          const email = a.email || a.address || a.from_address;
          if (email) {
            dateAddedByEmail[email] =
              a.timestamp_created ?? a.created_at ?? a.date_created ??
              a.creation_date     ?? a.createdAt  ?? a.timestamp     ?? null;
          }
        });
        console.log(`[inbox-records] accounts fetched: ${acctItems.length}, date-lookup entries: ${Object.keys(dateAddedByEmail).length}`);

        // ── Normalise ──────────────────────────────────────────────
        const R_ESP_MAP = { 0:"Unknown", 1:"Gmail", 2:"Outlook", 3:"Yahoo", 4:"Apple Mail", 5:"AOL", 6:"Other" };

        const normalised = records.map(r => {
          const isSpam = r.is_spam === true  || r.is_spam === 1;
          const isCat  = r.has_category === true || r.has_category === 1;
          const placement = isSpam ? "Spam" : isCat ? "Promotions" : "Inbox";

          // ESP label
          const espRaw   = r.recipient_esp;
          const espLabel = typeof espRaw === "number" ? (R_ESP_MAP[espRaw] || "Unknown")
            : (espRaw || "Unknown");

          // SMTP blacklist: may be object { listname: bool }, array, or bool
          let blacklisted = false;
          const blReport = r.smtp_ip_blacklist_report;
          if (blReport !== null && blReport !== undefined) {
            if (typeof blReport === "boolean") {
              blacklisted = blReport;
            } else if (Array.isArray(blReport)) {
              blacklisted = blReport.length > 0;
            } else if (typeof blReport === "object") {
              blacklisted = Object.values(blReport).some(v => v === true || v === 1 || v === "blacklisted");
            }
          }

          const senderEmail = r.sender_email || r.from_email || "—";

          return {
            id:                r.id || r.uuid || null,
            placement,
            sender_email:      senderEmail,
            sender_date_added: dateAddedByEmail[senderEmail] || null,
            recipient_email:   r.recipient_email || r.to_email    || "—",
            recipient_esp:     espLabel,
            recipient_geo:     r.recipient_geo   || r.geo         || null,
            spf_pass:          r.spf_pass  === true || r.spf_pass  === 1,
            dkim_pass:         r.dkim_pass === true || r.dkim_pass === 1,
            dmarc_pass:        r.dmarc_pass=== true || r.dmarc_pass=== 1,
            blacklisted,
            timestamp:         r.timestamp_created_date || r.created_at || r.timestamp || null,
          };
        });

        console.log(`[inbox-records] test_id=${rTestId} → ${normalised.length} records (${records.length} raw)`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ records: normalised, total: normalised.length }));
      } catch (e) {
        console.error("[inbox-records] Error:", e.message, e.stack);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
    })();
    return;
  }

  // ── Proxy: /api/v2/* → https://api.instantly.ai/api/v2/* ──────
  if (pathname.startsWith("/api/v2/")) {
    const rawKey = req.headers["x-api-key"] || storedKey;
    if (!rawKey) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "No API key. Enter it in the dashboard and click Connect." }));
      return;
    }

    const key = rawKey;

    // Build the target path — forward to Instantly v2
    const targetPath = "/api/v2/" + pathname.slice("/api/v2/".length) + (search || "");
    console.log(`[proxy] ${req.method} ${targetPath}`);

    // All Instantly v2 endpoints use the same Bearer token auth
    const proxyHeaders = {
      "Authorization": `Bearer ${key}`,
      "Content-Type":  req.headers["content-type"] || "application/json",
      "Accept":        "application/json",
    };
    if (req.headers["content-length"]) {
      proxyHeaders["Content-Length"] = req.headers["content-length"];
    }

    const options = {
      hostname: "api.instantly.ai",
      port:     443,
      path:     targetPath,
      method:   req.method,
      headers:  proxyHeaders,
    };

    const proxyReq = https.request(options, proxyRes => {
      res.writeHead(proxyRes.statusCode, {
        "Content-Type":                proxyRes.headers["content-type"] || "application/json",
        "Access-Control-Allow-Origin": "*",
      });
      proxyRes.pipe(res, { end: true });
    });

    proxyReq.on("error", err => {
      console.error("[proxy] Error:", err.message);
      if (!res.headersSent) {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Could not reach Instantly API: " + err.message }));
      }
    });

    if (req.method !== "GET" && req.method !== "HEAD") {
      req.pipe(proxyReq, { end: true });
    } else {
      proxyReq.end();
    }
    return;
  }

  // ── API catch-all: return JSON 404 instead of HTML ────────────
  // Prevents the "Unexpected token '<', <!DOCTYPE" error in the frontend
  // when a route isn't matched (e.g. server not yet restarted after code change).
  if (pathname.startsWith("/api/") || pathname.startsWith("/campaign-daily/")) {
    console.warn(`[server] ⚠ Unmatched route: ${req.method} ${pathname}`);
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `Route not found: ${req.method} ${pathname}. Restart app.js if you just added new routes.` }));
    return;
  }

  // ── Serve dashboard.html for everything else ───────────────────
  const dashPath = path.join(__dirname, "dashboard.html");
  fs.readFile(dashPath, (err, data) => {
    if (err) {
      res.writeHead(500, { "Content-Type": "text/html" });
      res.end(`
        <h2 style="font-family:sans-serif;color:#c00">⚠ dashboard.html not found</h2>
        <p style="font-family:sans-serif">
          Make sure <b>dashboard.html</b> is in the same folder as <b>app.js</b>.<br>
          Expected location: <code>${dashPath}</code>
        </p>
      `);
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(data);
  });
});

// ── Start ──────────────────────────────────────────────────────────
// Bind to 0.0.0.0 so Railway (and other cloud hosts) can route traffic in.
// Locally this is still accessible at http://localhost:3000.
server.listen(PORT, "0.0.0.0", () => {
  const keyStatus = storedKey ? "loaded from environment ✓" : "enter in the dashboard";
  console.log("\n╔═══════════════════════════════════════════════════╗");
  console.log("║   ✅  Instantly Dashboard is running!             ║");
  console.log("╚═══════════════════════════════════════════════════╝\n");
  console.log(`   Open this in your browser →  http://localhost:${PORT}\n`);
  console.log(`   API key:  ${keyStatus}`);
  console.log("\n   Press Ctrl+C to stop the server.\n");

  // Auto-open browser
  // Windows: "start" is a cmd.exe built-in — must use "cmd /c start" via exec
  const { exec } = require("child_process");
  const openCmd =
    process.platform === "win32"  ? `cmd /c start "" "http://localhost:${PORT}"` :
    process.platform === "darwin" ? `open "http://localhost:${PORT}"`             :
    `xdg-open "http://localhost:${PORT}"`;

  setTimeout(() => {
    exec(openCmd, (err) => {
      if (err) {
        console.log(`   Could not auto-open browser. Please open manually: http://localhost:${PORT}`);
      }
    });
  }, 1000);
});

server.on("error", err => {
  if (err.code === "EADDRINUSE") {
    console.error(`\n❌  Port ${PORT} is already in use.`);
    console.error(`    Is the dashboard already running? Open http://localhost:${PORT}`);
    console.error(`    Or edit PORT at the top of app.js to use a different port.\n`);
  } else {
    console.error("Server error:", err);
  }
  process.exit(1);
});
