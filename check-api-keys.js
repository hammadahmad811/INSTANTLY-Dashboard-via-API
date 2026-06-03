#!/usr/bin/env node
/**
 * check-api-keys.js — Instantly API Key Diagnostic Tool
 * ─────────────────────────────────────────────────────
 * Tests every account in accounts.json:
 *   • Verifies the API key is valid
 *   • Fetches campaign list (count)
 *   • Fetches analytics for yesterday and today
 *   • Shows per-campaign sent / opened / replied counts
 *
 * Usage:
 *   node check-api-keys.js
 *   node check-api-keys.js --date 2026-04-15        (specific date)
 *   node check-api-keys.js --from 2026-04-10 --to 2026-04-16
 */

const https = require("https");
const fs    = require("fs");
const path  = require("path");

// ── Date helpers ─────────────────────────────────────────────────────────────
function toISO(d) {
  const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,"0");
  return `${y}-${m}-${String(d.getDate()).padStart(2,"0")}`;
}
const TODAY     = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
const YESTERDAY = new Date(TODAY); YESTERDAY.setDate(YESTERDAY.getDate() - 1);

// ── Parse CLI args ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let fromDate = YESTERDAY, toDate = TODAY;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--date")  { fromDate = toDate = new Date(args[i+1]+"T00:00:00"); i++; }
  if (args[i] === "--from")  { fromDate = new Date(args[i+1]+"T00:00:00"); i++; }
  if (args[i] === "--to")    { toDate   = new Date(args[i+1]+"T00:00:00"); i++; }
}
const FROM = toISO(fromDate), TO = toISO(toDate);

// ── Instantly API call ────────────────────────────────────────────────────────
function apiCall(apiKey, pathAndQuery) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: "api.instantly.ai", port: 443,
      path: pathAndQuery, method: "GET",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Accept":        "application/json",
      },
    };
    const req = https.request(opts, res => {
      let buf = "";
      res.on("data", c => { buf += c; });
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(buf) });
        } catch {
          resolve({ status: res.statusCode, body: buf });
        }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

// ── Fetch all campaigns (cursor-paginated) ────────────────────────────────────
async function fetchAllCampaigns(apiKey) {
  const all = [];
  let cursor = null;
  let page   = 0;
  while (true) {
    page++;
    const qs  = cursor ? `limit=100&starting_after=${cursor}` : "limit=100";
    const { status, body } = await apiCall(apiKey, `/api/v2/campaigns?${qs}`);
    if (status !== 200) return { error: `HTTP ${status}: ${JSON.stringify(body)}` };
    const items = Array.isArray(body) ? body : (body?.items || []);
    all.push(...items);
    const next = body?.next_starting_after;
    if (!next || items.length === 0) break;
    if (page > 20) break; // safety cap
    cursor = next;
  }
  return { campaigns: all };
}

// ── Fetch per-campaign analytics ──────────────────────────────────────────────
async function fetchAnalytics(apiKey, from, to) {
  const { status, body } = await apiCall(
    apiKey,
    `/api/v2/campaigns/analytics?start_date=${from}&end_date=${to}&limit=1000`
  );
  if (status !== 200) return { error: `HTTP ${status}: ${JSON.stringify(body)}` };
  const items = Array.isArray(body) ? body : (body?.items || []);
  // Build map keyed by campaign_id
  const map = {};
  items.forEach(a => { map[a.campaign_id || a.id] = a; });
  return { map, count: items.length };
}

// ── Fetch aggregate daily analytics ──────────────────────────────────────────
async function fetchDailySummary(apiKey, from, to) {
  const { status, body } = await apiCall(
    apiKey,
    `/api/v2/campaigns/analytics/daily?start_date=${from}&end_date=${to}&limit=500`
  );
  if (status !== 200) return { error: `HTTP ${status}` };
  const rows = Array.isArray(body) ? body : (body?.items || body?.data || []);
  const total = rows.reduce((acc, r) => ({
    sent:    acc.sent    + (r.sent    ?? r.new_leads_contacted ?? 0),
    opened:  acc.opened  + (r.unique_opened ?? r.opened ?? 0),
    replies: acc.replies + (r.unique_replies ?? r.replies ?? 0),
    bounced: acc.bounced + (r.bounced ?? 0),
  }), { sent: 0, opened: 0, replies: 0, bounced: 0 });
  return { rows: rows.length, total };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const accountsPath = path.join(__dirname, "accounts.json");
  if (!fs.existsSync(accountsPath)) {
    console.error("❌ accounts.json not found. Run from the same folder as app.js.");
    process.exit(1);
  }
  const accounts = JSON.parse(fs.readFileSync(accountsPath, "utf8"));

  console.log("╔══════════════════════════════════════════════════════════════════════╗");
  console.log("║         Instantly API Key Diagnostic — " + new Date().toLocaleString().padEnd(31) + "║");
  console.log("║  Date range: " + `${FROM} → ${TO}`.padEnd(57) + "║");
  console.log("╚══════════════════════════════════════════════════════════════════════╝");
  console.log();

  for (const acc of accounts) {
    console.log(`▶  ${acc.name}`);
    console.log(`   Key: ...${acc.api_key.slice(-12)}`);

    // ── Step 1: Fetch campaigns ──
    process.stdout.write("   Campaigns: ");
    const campResult = await fetchAllCampaigns(acc.api_key);
    if (campResult.error) {
      console.log(`❌ FAILED — ${campResult.error}`);
      console.log();
      continue;
    }
    const campaigns = campResult.campaigns;
    const active = campaigns.filter(c => c.status === 1).length;
    console.log(`✅ ${campaigns.length} total (${active} active)`);

    // ── Step 2: Fetch analytics ──
    process.stdout.write(`   Analytics (${FROM}→${TO}): `);
    const anaResult = await fetchAnalytics(acc.api_key, FROM, TO);
    if (anaResult.error) {
      console.log(`❌ FAILED — ${anaResult.error}`);
    } else {
      console.log(`✅ ${anaResult.count} campaigns with data`);

      // Show per-campaign breakdown (only active or campaigns with data)
      const withData = campaigns.filter(c => {
        const a = anaResult.map[c.id];
        return a && (a.emails_sent_count > 0 || a.open_count_unique > 0);
      });

      if (withData.length > 0) {
        console.log();
        console.log("   ┌─────────────────────────────────────────────────────────────────┐");
        console.log("   │  Campaign Name                    Sent   Opened  Replied  Bounce│");
        console.log("   ├─────────────────────────────────────────────────────────────────┤");
        withData.forEach(c => {
          const a    = anaResult.map[c.id] || {};
          const sent = a.emails_sent_count       ?? 0;
          const open = a.open_count_unique       ?? 0;
          const rep  = a.reply_count_unique      ?? 0;
          const bou  = a.bounced_count           ?? 0;
          const openPct = sent > 0 ? `${((open/sent)*100).toFixed(1)}%` : "—";
          const name = c.name.substring(0, 34).padEnd(34);
          console.log(`   │  ${name} ${String(sent).padStart(5)}  ${String(open).padStart(5)}   ${String(rep).padStart(5)}   ${String(bou).padStart(4)} │`);
        });
        console.log("   └─────────────────────────────────────────────────────────────────┘");
      } else {
        console.log(`   ℹ  No campaigns with activity in this date range`);
      }

      // ── Step 3: Daily aggregate ──
      process.stdout.write(`\n   Daily totals (${FROM}→${TO}): `);
      const dailyResult = await fetchDailySummary(acc.api_key, FROM, TO);
      if (dailyResult.error) {
        console.log(`❌ FAILED — ${dailyResult.error}`);
      } else {
        const t = dailyResult.total;
        const openPct = t.sent > 0 ? `${((t.opened/t.sent)*100).toFixed(1)}% open` : "—";
        console.log(`✅ ${dailyResult.rows} day(s) | Sent=${t.sent}, Opened=${t.opened} (${openPct}), Replies=${t.replies}, Bounced=${t.bounced}`);
      }
    }

    console.log();
  }

  console.log("═══════════════════════════════════════════════════════════════════════");
  console.log("Done. Compare 'Sent' column above with Instantly's Analytics tab.");
  console.log("Note: 'Sent' = emails_sent_count from /campaigns/analytics (date-filtered).");
  console.log("      If this doesn't match Instantly's UI, check which metric Instantly");
  console.log("      shows — 'Emails Sent' vs 'Sequence Started' are different numbers.");
  console.log("═══════════════════════════════════════════════════════════════════════");
}

main().catch(e => { console.error("Fatal error:", e); process.exit(1); });
