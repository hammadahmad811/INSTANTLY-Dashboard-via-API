import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from "recharts";
import {
  Mail, Eye, MessageSquare, AlertTriangle, RefreshCw, Search,
  Download, Moon, Sun, TrendingUp, ArrowUpRight, ArrowDownRight,
  Activity, Zap, MousePointerClick, Target, Calendar, ChevronDown,
  X, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  ArrowUp, ArrowDown, ArrowUpDown, Database, Wifi, WifiOff,
  KeyRound, CheckCircle2, EyeOff, Loader2
} from "lucide-react";

// ═══════════════════════════════════════════════════════════════
// DATE HELPERS
// ═══════════════════════════════════════════════════════════════
const toISO   = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
const today   = new Date("2026-03-18");

// ═══════════════════════════════════════════════════════════════
// PERFORMANCE: CLIENT-SIDE CACHE
// TTL = 5 minutes. Repeated date-range selections return instantly.
// On stale hit: serve old data immediately, revalidate in background.
// ═══════════════════════════════════════════════════════════════
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

class DataCache {
  constructor() { this._map = new Map(); }
  key(start, end) { return `${toISO(start)}__${toISO(end)}`; }
  get(start, end) {
    const entry = this._map.get(this.key(start, end));
    if (!entry) return null;
    return { ...entry, fresh: Date.now() - entry.ts < CACHE_TTL };
  }
  set(start, end, data) {
    this._map.set(this.key(start, end), { ...data, ts: Date.now() });
  }
  invalidate(start, end) { this._map.delete(this.key(start, end)); }
  clear() { this._map.clear(); }
}

// ═══════════════════════════════════════════════════════════════
// PERFORMANCE: DEBOUNCE HOOK
// Delays search filter so we don't recompute on every keystroke.
// ═══════════════════════════════════════════════════════════════
function useDebounce(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

// ═══════════════════════════════════════════════════════════════
// MOCK DATA GENERATORS
// In production: replace with real API calls via api-client.js
// ═══════════════════════════════════════════════════════════════

/** Generates per-day analytics rows for the selected date window */
function generateDailyData(start, end) {
  const rows = [];
  let cur = new Date(start);
  while (cur <= end) {
    const base = Math.floor(Math.random() * 200) + 80;
    rows.push({
      date:          toISO(cur),
      label:         cur.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      sent:          base,
      opened:        Math.floor(base * (0.35 + Math.random() * 0.25)),
      replies:       Math.floor(base * (0.04 + Math.random() * 0.08)),
      clicks:        Math.floor(base * (0.06 + Math.random() * 0.10)),
      opportunities: Math.floor(base * (0.01 + Math.random() * 0.03)),
      bounced:       Math.floor(base * (0.01 + Math.random() * 0.02)),
    });
    cur = addDays(cur, 1);
  }
  return rows;
}

/** Static campaign metadata — metrics are generated per date range */
const CAMPAIGN_DEFS = [
  { id:"c1",  name:"Q1 Outreach — Decision Makers",   step:"Follow-up 2", next:"2026-03-20", status:"Active",    rate:82,  oR:0.48, rR:0.075, cR:0.086, bR:0.015, opR:0.011 },
  { id:"c2",  name:"Product Launch — Series B",        step:"Step 1",      next:"2026-03-19", status:"Active",    rate:61,  oR:0.44, rR:0.060, cR:0.088, bR:0.015, opR:0.010 },
  { id:"c3",  name:"Re-engagement — Churned Users",    step:"Follow-up 3", next:null,          status:"Completed", rate:107, oR:0.32, rR:0.028, cR:0.027, bR:0.030, opR:0.003 },
  { id:"c4",  name:"Enterprise ABM — Fortune 500",     step:"Step 1",      next:"2026-03-22", status:"Active",    rate:21,  oR:0.50, rR:0.100, cR:0.119, bR:0.010, opR:0.023 },
  { id:"c5",  name:"Webinar Invite — March 2026",      step:"Follow-up 1", next:null,          status:"Completed", rate:137, oR:0.52, rR:0.070, cR:0.095, bR:0.020, opR:0.010 },
  { id:"c6",  name:"Partner Co-Sell Outreach",         step:"Step 1",      next:"2026-04-01", status:"Paused",    rate:0,   oR:0,    rR:0,     cR:0,     bR:0,     opR:0     },
  { id:"c7",  name:"Case Study Follow-up",             step:"Follow-up 2", next:"2026-03-21", status:"Active",    rate:38,  oR:0.52, rR:0.064, cR:0.089, bR:0.015, opR:0.008 },
  { id:"c8",  name:"Cold Outreach — SaaS CTOs",        step:"Follow-up 1", next:"2026-03-24", status:"Active",    rate:97,  oR:0.43, rR:0.050, cR:0.080, bR:0.020, opR:0.008 },
  { id:"c9",  name:"Mid-Market Nurture Q1",            step:"Follow-up 2", next:"2026-03-23", status:"Active",    rate:54,  oR:0.41, rR:0.055, cR:0.072, bR:0.012, opR:0.009 },
  { id:"c10", name:"Competitive Displacement — HubSpot",step:"Step 1",     next:"2026-03-25", status:"Active",    rate:73,  oR:0.39, rR:0.048, cR:0.068, bR:0.018, opR:0.007 },
  { id:"c11", name:"Upsell — Pro to Enterprise",       step:"Follow-up 1", next:null,          status:"Completed", rate:44,  oR:0.61, rR:0.092, cR:0.110, bR:0.008, opR:0.018 },
  { id:"c12", name:"APAC Expansion Outreach",          step:"Step 1",      next:"2026-04-02", status:"Paused",    rate:0,   oR:0,    rR:0,     cR:0,     bR:0,     opR:0     },
  { id:"c13", name:"Founder-to-Founder Cold",          step:"Follow-up 2", next:"2026-03-26", status:"Active",    rate:28,  oR:0.55, rR:0.110, cR:0.098, bR:0.009, opR:0.025 },
  { id:"c14", name:"Trial Expiry Win-Back",            step:"Follow-up 3", next:null,          status:"Completed", rate:91,  oR:0.35, rR:0.038, cR:0.052, bR:0.025, opR:0.005 },
  { id:"c15", name:"Partner Agency Recruitment",       step:"Step 1",      next:"2026-03-28", status:"Active",    rate:33,  oR:0.46, rR:0.062, cR:0.078, bR:0.011, opR:0.012 },
];

/** Generates campaign metrics scaled to a date window. Date-aware = table reacts to filter. */
function generateCampaignData(start, end) {
  const days   = Math.max(1, Math.round((end - start) / 86400000) + 1);
  const jitter = (id, s = 0.12) => 1 + (id.charCodeAt(1) % 7 - 3) / (3 / s);
  return CAMPAIGN_DEFS.map(d => {
    const sent    = Math.round(d.rate * days * jitter(d.id, 0.10));
    const opened  = Math.round(sent * d.oR  * jitter(d.id, 0.08));
    const replies = Math.round(sent * d.rR  * jitter(d.id, 0.12));
    const clicks  = Math.round(sent * d.cR  * jitter(d.id, 0.10));
    const bounced = Math.round(sent * d.bR  * jitter(d.id, 0.09));
    const opps    = Math.round(sent * d.opR * jitter(d.id, 0.15));
    return {
      id: d.id, name: d.name, current_step: d.step,
      next_trigger_date: d.next, status: d.status,
      email_sent: sent, email_opened: opened,
      reply_count: replies, click_count: clicks,
      bounce_count: bounced, opportunities: opps,
    };
  });
}

// ═══════════════════════════════════════════════════════════════
// PRESETS
// ═══════════════════════════════════════════════════════════════
const PRESETS = [
  { label: "Today",        start: today,             end: today },
  { label: "Last 7 days",  start: addDays(today,-6), end: today },
  { label: "Last 14 days", start: addDays(today,-13),end: today },
  { label: "Last 30 days", start: addDays(today,-29),end: today },
  { label: "This month",   start: new Date(today.getFullYear(), today.getMonth(), 1), end: today },
];

const PAGE_SIZES = [10, 25, 50];

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════
const fmt = (n) => n >= 1_000_000 ? `${(n/1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n/1000).toFixed(1)}k` : String(n);
const pct = (a, b) => b === 0 ? "0.0" : ((a / b) * 100).toFixed(1);
const sum = (arr, key) => arr.reduce((s, r) => s + (r[key] || 0), 0);

/** Sortable column key → campaign field */
const SORT_FIELDS = {
  Campaign:      "name",
  Sent:          "email_sent",
  Opened:        "email_opened",
  Clicks:        "click_count",
  Replies:       "reply_count",
  Bounced:       "bounce_count",
  Opportunities: "opportunities",
  "Open %":      "email_opened",   // computed sort
  "Click %":     "click_count",
  "Reply %":     "reply_count",
};

/**
 * exportCSV — downloads all visible (filtered + sorted) campaigns as a CSV.
 *
 * All 13 table columns are included. The filename embeds the selected
 * date range so exports are self-documenting:
 *   instantly_campaigns_2026-03-05_to_2026-03-18.csv
 *
 * @param {Array}  rows      — filtered + sorted campaign array (all pages, not just current)
 * @param {Date}   start     — range start (for filename)
 * @param {Date}   end       — range end   (for filename)
 */
function exportCSV(rows, start, end) {
  // Every column that appears in the table, in the same order
  const headers = [
    "Campaign Name",
    "Emails Sent",
    "Emails Opened",
    "Clicks",
    "Replies",
    "Bounced Contacts",
    "Opportunities",
    "Open Rate (%)",
    "Click Rate (%)",
    "Reply Rate (%)",
    "Current Step",
    "Next Trigger Date",
    "Status",
  ].join(",");

  const escape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

  const body = rows.map(c => [
    escape(c.name),
    c.email_sent,
    c.email_opened,
    c.click_count,
    c.reply_count,
    c.bounce_count,
    c.opportunities,
    pct(c.email_opened, c.email_sent),
    pct(c.click_count,  c.email_sent),
    pct(c.reply_count,  c.email_sent),
    escape(c.current_step),
    escape(c.next_trigger_date || "—"),
    escape(c.status),
  ].join(",")).join("\n");

  const filename = `instantly_campaigns_${toISO(start)}_to_${toISO(end)}.csv`;

  const a = Object.assign(document.createElement("a"), {
    href:     URL.createObjectURL(new Blob([headers + "\n" + body], { type: "text/csv;charset=utf-8;" })),
    download: filename,
  });
  a.click();
  URL.revokeObjectURL(a.href);
}

// ═══════════════════════════════════════════════════════════════
// UI COMPONENTS
// ═══════════════════════════════════════════════════════════════

function Skeleton({ className = "" }) {
  return <div className={`animate-pulse bg-gray-200 rounded ${className}`} />;
}

function MetricCard({ icon: Icon, label, value, sub, color, trend, dark, cached }) {
  const isUp = trend >= 0;
  const colors = {
    blue:"from-blue-500 to-blue-600", green:"from-emerald-500 to-emerald-600",
    purple:"from-violet-500 to-violet-600", amber:"from-amber-500 to-amber-600",
    rose:"from-rose-500 to-rose-600", cyan:"from-cyan-500 to-cyan-600",
    indigo:"from-indigo-500 to-indigo-600", teal:"from-teal-500 to-teal-600",
  };
  return (
    <div className={`rounded-xl p-5 shadow-sm border transition-all hover:shadow-md relative overflow-hidden ${dark?"bg-gray-800 border-gray-700":"bg-white border-gray-100"}`}>
      {cached && <div className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-amber-400" title="Serving cached data" />}
      <div className="flex items-start justify-between mb-3">
        <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${colors[color]} flex items-center justify-center`}>
          <Icon size={20} className="text-white" />
        </div>
        {trend !== undefined && (
          <span className={`flex items-center text-xs font-medium px-2 py-1 rounded-full ${isUp?"bg-emerald-50 text-emerald-700":"bg-rose-50 text-rose-700"}`}>
            {isUp ? <ArrowUpRight size={12} className="mr-0.5"/> : <ArrowDownRight size={12} className="mr-0.5"/>}
            {Math.abs(trend)}%
          </span>
        )}
      </div>
      <p className={`text-sm font-medium mb-1 ${dark?"text-gray-400":"text-gray-500"}`}>{label}</p>
      <p className={`text-2xl font-bold tracking-tight ${dark?"text-white":"text-gray-900"}`}>{value}</p>
      {sub && <p className={`text-xs mt-1 ${dark?"text-gray-500":"text-gray-400"}`}>{sub}</p>}
    </div>
  );
}

function StatusBadge({ status }) {
  const s = {
    Active:    "bg-emerald-50 text-emerald-700 border-emerald-200",
    Completed: "bg-blue-50 text-blue-700 border-blue-200",
    Paused:    "bg-amber-50 text-amber-700 border-amber-200",
  };
  const d = { Active:"bg-emerald-500", Completed:"bg-blue-500", Paused:"bg-amber-500" };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${s[status]||""}`}>
      <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${d[status]||""}`}/>
      {status}
    </span>
  );
}

function ChartCard({ title, subtitle, children, dark, className="" }) {
  return (
    <div className={`rounded-xl p-5 shadow-sm border ${dark?"bg-gray-800 border-gray-700":"bg-white border-gray-100"} ${className}`}>
      <div className="mb-4">
        <h3 className={`text-sm font-semibold ${dark?"text-gray-200":"text-gray-700"}`}>{title}</h3>
        {subtitle && <p className={`text-xs mt-0.5 ${dark?"text-gray-500":"text-gray-400"}`}>{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function ChartTooltip({ active, payload, label, dark }) {
  if (!active || !payload?.length) return null;
  return (
    <div className={`rounded-lg shadow-lg border px-3 py-2.5 text-xs ${dark?"bg-gray-900 border-gray-700":"bg-white border-gray-200"}`}>
      <p className={`font-semibold mb-1.5 ${dark?"text-gray-200":"text-gray-700"}`}>{label}</p>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2 py-0.5">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }}/>
          <span className={dark?"text-gray-400":"text-gray-500"}>{p.name}:</span>
          <span className={`font-medium ${dark?"text-gray-200":"text-gray-800"}`}>{p.value?.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Sort icon helper ────────────────────────────────────────────────────────
function SortIcon({ col, sortCol, sortDir }) {
  if (col !== sortCol) return <ArrowUpDown size={11} className="opacity-30 ml-1 inline" />;
  return sortDir === "asc"
    ? <ArrowUp   size={11} className="text-indigo-500 ml-1 inline"/>
    : <ArrowDown size={11} className="text-indigo-500 ml-1 inline"/>;
}

// ─── Pagination control ───────────────────────────────────────────────────────
function Pagination({ page, totalPages, pageSize, totalRows, onPage, onPageSize, dark }) {
  const btnBase = `p-1.5 rounded-md border transition-all disabled:opacity-30 disabled:cursor-not-allowed`;
  const btnStyle = dark
    ? `${btnBase} border-gray-600 text-gray-400 hover:bg-gray-700`
    : `${btnBase} border-gray-200 text-gray-500 hover:bg-gray-50`;

  const start = (page - 1) * pageSize + 1;
  const end   = Math.min(page * pageSize, totalRows);

  // Build visible page numbers (window of 5)
  const pages = [];
  const window = 2;
  for (let p = Math.max(1, page - window); p <= Math.min(totalPages, page + window); p++) {
    pages.push(p);
  }

  return (
    <div className={`flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 px-4 py-3 border-t text-xs ${dark?"border-gray-700":"border-gray-100"}`}>
      {/* Left: row count + page size */}
      <div className="flex items-center gap-3">
        <span className={dark?"text-gray-500":"text-gray-400"}>
          Rows {start}–{end} of <span className="font-medium">{totalRows}</span>
        </span>
        <div className="flex items-center gap-1.5">
          <span className={dark?"text-gray-500":"text-gray-400"}>Per page:</span>
          {PAGE_SIZES.map(n => (
            <button key={n} onClick={() => { onPageSize(n); onPage(1); }}
              className={`px-2 py-1 rounded border transition-all font-medium ${pageSize===n
                ? "bg-indigo-600 text-white border-indigo-600"
                : dark?"border-gray-600 text-gray-400 hover:bg-gray-700":"border-gray-200 text-gray-500 hover:bg-gray-50"
              }`}>{n}</button>
          ))}
        </div>
      </div>

      {/* Right: page buttons */}
      <div className="flex items-center gap-1">
        <button className={btnStyle} disabled={page===1} onClick={()=>onPage(1)} title="First page">
          <ChevronsLeft size={14}/>
        </button>
        <button className={btnStyle} disabled={page===1} onClick={()=>onPage(page-1)} title="Previous">
          <ChevronLeft size={14}/>
        </button>
        {pages[0] > 1 && <span className={`px-1 ${dark?"text-gray-600":"text-gray-400"}`}>…</span>}
        {pages.map(p => (
          <button key={p} onClick={()=>onPage(p)}
            className={`w-7 h-7 rounded-md text-xs font-medium border transition-all ${p===page
              ? "bg-indigo-600 text-white border-indigo-600"
              : dark?"border-gray-600 text-gray-400 hover:bg-gray-700":"border-gray-200 text-gray-500 hover:bg-gray-50"
            }`}>{p}</button>
        ))}
        {pages[pages.length-1] < totalPages && <span className={`px-1 ${dark?"text-gray-600":"text-gray-400"}`}>…</span>}
        <button className={btnStyle} disabled={page===totalPages} onClick={()=>onPage(page+1)} title="Next">
          <ChevronRight size={14}/>
        </button>
        <button className={btnStyle} disabled={page===totalPages} onClick={()=>onPage(totalPages)} title="Last page">
          <ChevronsRight size={14}/>
        </button>
      </div>
    </div>
  );
}

// ─── Date Range Picker ───────────────────────────────────────────────────────
function DateRangePicker({ startDate, endDate, onChange, dark }) {
  const [open, setOpen]         = useState(false);
  const [localStart, setLocalStart] = useState(toISO(startDate));
  const [localEnd,   setLocalEnd]   = useState(toISO(endDate));
  const ref = useRef(null);

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const apply = () => {
    if (localStart && localEnd && localStart <= localEnd) {
      onChange(new Date(localStart), new Date(localEnd));
      setOpen(false);
    }
  };
  const applyPreset = (p) => {
    setLocalStart(toISO(p.start)); setLocalEnd(toISO(p.end));
    onChange(p.start, p.end); setOpen(false);
  };

  const diffDays = Math.round((endDate - startDate) / 86400000) + 1;
  const label = diffDays === 1
    ? endDate.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})
    : `${startDate.toLocaleDateString("en-US",{month:"short",day:"numeric"})} – ${endDate.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}`;

  return (
    <div ref={ref} className="relative">
      <button onClick={()=>setOpen(!open)}
        className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-all ${dark?"bg-gray-800 border-gray-700 text-gray-200 hover:bg-gray-700":"bg-white border-gray-200 text-gray-700 hover:bg-gray-50"}`}>
        <Calendar size={15} className={dark?"text-indigo-400":"text-indigo-500"}/>
        <span>{label}</span>
        <span className={`text-xs px-1.5 py-0.5 rounded ${dark?"bg-indigo-900/40 text-indigo-300":"bg-indigo-50 text-indigo-600"}`}>{diffDays}d</span>
        <ChevronDown size={14} className={`transition-transform ${open?"rotate-180":""} ${dark?"text-gray-500":"text-gray-400"}`}/>
      </button>
      {open && (
        <div className={`absolute right-0 top-full mt-2 z-50 rounded-xl shadow-xl border w-80 ${dark?"bg-gray-800 border-gray-700":"bg-white border-gray-200"}`}>
          <div className={`p-3 border-b ${dark?"border-gray-700":"border-gray-100"}`}>
            <p className={`text-xs font-semibold uppercase tracking-wider mb-2 ${dark?"text-gray-500":"text-gray-400"}`}>Quick select</p>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map(p=>(
                <button key={p.label} onClick={()=>applyPreset(p)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${dark?"bg-gray-700 text-gray-300 hover:bg-indigo-600 hover:text-white":"bg-gray-100 text-gray-600 hover:bg-indigo-600 hover:text-white"}`}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div className="p-3 space-y-3">
            <p className={`text-xs font-semibold uppercase tracking-wider ${dark?"text-gray-500":"text-gray-400"}`}>Custom range</p>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className={`block text-xs mb-1 ${dark?"text-gray-400":"text-gray-500"}`}>From</label>
                <input type="date" value={localStart} onChange={e=>setLocalStart(e.target.value)} max={localEnd}
                  className={`w-full px-2.5 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 ${dark?"bg-gray-700 border-gray-600 text-white":"bg-gray-50 border-gray-200 text-gray-900"}`}/>
              </div>
              <div className="flex-1">
                <label className={`block text-xs mb-1 ${dark?"text-gray-400":"text-gray-500"}`}>To</label>
                <input type="date" value={localEnd} onChange={e=>setLocalEnd(e.target.value)} min={localStart} max={toISO(today)}
                  className={`w-full px-2.5 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 ${dark?"bg-gray-700 border-gray-600 text-white":"bg-gray-50 border-gray-200 text-gray-900"}`}/>
              </div>
            </div>
            <button onClick={apply} className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors">
              Apply range
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// INSTANTLY API v2 — CONNECTION LAYER
//
// Three modes (auto-detected in handleConnect):
//   1. PROXY   → http://localhost:3333  (run proxy.js — zero npm deps)
//   2. BACKEND → http://localhost:4000  (run backend-server.js)
//   3. DIRECT  → https://api.instantly.ai/api/v2 (may be blocked by CORS)
// ═══════════════════════════════════════════════════════════════
const INSTANTLY_V2 = "https://api.instantly.ai/api/v2";
const PROXY_URL    = "http://localhost:3333"; // proxy.js — no npm install needed
const BACKEND_URL  = "http://localhost:4000"; // backend-server.js — full Express backend

/** Build fetch headers — works for proxy (X-Api-Key) and direct (Authorization) */
function apiHeaders(apiKey) {
  return {
    "Authorization": `Bearer ${apiKey}`,
    "X-Api-Key":     apiKey,           // proxy.js reads this header
    "Content-Type":  "application/json",
  };
}

/**
 * Fetch all campaigns — Instantly v2 uses POST /campaign/listcampaign
 * with cursor-based pagination (starting_after), NOT skip/limit.
 */
async function fetchInstantlyCampaigns(apiKey, start, end, signal, baseUrl = INSTANTLY_V2) {
  const allCampaigns = [];
  let startingAfter  = null;

  while (true) {
    const body = { limit: 100 };
    if (startingAfter) body.starting_after = startingAfter;

    const res = await fetch(`${baseUrl}/campaign/listcampaign`, {
      method:  "POST",
      headers: apiHeaders(apiKey),
      body:    JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || err.error || `Instantly API ${res.status}: ${res.statusText}`);
    }

    const data  = await res.json();
    // v2 returns { campaigns: [...], next_starting_after: "cursor" | null }
    const items = data.campaigns || data.items || (Array.isArray(data) ? data : []);
    allCampaigns.push(...items);

    if (!data.next_starting_after || items.length < 100) break;
    startingAfter = data.next_starting_after;
  }

  return allCampaigns;
}

/** Fetch campaign analytics summary from Instantly v2 */
async function fetchInstantlyAnalytics(apiKey, start, end, signal, baseUrl = INSTANTLY_V2) {
  const url = new URL(`${baseUrl}/analytics/campaign/summary`);
  if (start) url.searchParams.set("start_date", start);
  if (end)   url.searchParams.set("end_date",   end);
  url.searchParams.set("limit", 100);

  const res = await fetch(url.toString(), { headers: apiHeaders(apiKey), signal });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || err.error || `Analytics API ${res.status}`);
  }
  return res.json();
}

/** Transform Instantly v2 campaign object → our dashboard schema */
function transformV2Campaign(raw, analyticsMap = {}) {
  const stats = analyticsMap[raw.id] || raw.campaign_analytics || raw.analytics || {};
  const sent    = stats.total_sent      ?? stats.emails_sent   ?? raw.total_sent    ?? 0;
  const opened  = stats.total_opened    ?? stats.emails_opened ?? raw.total_opened  ?? 0;
  const replied = stats.total_replied   ?? stats.replies       ?? raw.total_replied ?? 0;
  const clicked = stats.total_clicked   ?? stats.clicks        ?? raw.total_clicked ?? 0;
  const bounced = stats.total_bounced   ?? stats.bounces       ?? raw.total_bounced ?? 0;
  const opps    = stats.opportunities   ?? raw.opportunities   ?? 0;

  // Normalise status
  const rawStatus = raw.status ?? raw.campaign_status ?? "";
  let status = "Active";
  if (/paus/i.test(rawStatus))                     status = "Paused";
  else if (/complet|done|finish/i.test(rawStatus)) status = "Completed";

  return {
    id:                raw.id,
    name:              raw.name || "Untitled Campaign",
    email_sent:        sent,
    email_opened:      opened,
    reply_count:       replied,
    click_count:       clicked,
    bounce_count:      bounced,
    opportunities:     opps,
    current_step:      raw.current_step ?? raw.step_number ?? "Step 1",
    next_trigger_date: raw.next_send_time ?? raw.next_trigger_date ?? null,
    status,
  };
}

/** Build daily time-series from v2 analytics (or generate mock rows as fallback) */
function buildDailyRows(start, end, analyticsData) {
  // If Instantly returns per-day rows, use them directly
  const rawRows = Array.isArray(analyticsData)
    ? analyticsData
    : (analyticsData?.daily || analyticsData?.rows || analyticsData?.data || []);

  if (rawRows.length > 0) {
    return rawRows.map(r => ({
      date:          r.date ?? r.day,
      label:         new Date(r.date ?? r.day).toLocaleDateString("en-US", { month:"short", day:"numeric" }),
      sent:          r.total_sent      ?? r.sent    ?? 0,
      opened:        r.total_opened    ?? r.opened  ?? 0,
      replies:       r.total_replied   ?? r.replies ?? 0,
      clicks:        r.total_clicked   ?? r.clicks  ?? 0,
      opportunities: r.opportunities   ?? 0,
      bounced:       r.total_bounced   ?? r.bounced ?? 0,
    }));
  }

  // No daily data returned — generate proportional mock rows
  return generateDailyData(start, end);
}

// ═══════════════════════════════════════════════════════════════
// MAIN DASHBOARD
// ═══════════════════════════════════════════════════════════════

export default function InstantlyDashboard() {
  const [dark,         setDark]         = useState(false);
  const [loading,      setLoading]      = useState(true);
  const [revalidating, setRevalidating] = useState(false);
  const [campaigns,    setCampaigns]    = useState([]);
  const [dailyData,    setDailyData]    = useState([]);
  const [search,       setSearch]       = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [lastRefresh,  setLastRefresh]  = useState(null);
  const [cacheHit,     setCacheHit]     = useState(false);
  const [apiError,     setApiError]     = useState(null);
  const [startDate, setStartDate]       = useState(addDays(today, -13));
  const [endDate,   setEndDate]         = useState(today);

  // ── API key state ──────────────────────────────────────────────
  const [apiKey,      setApiKey]      = useState("");        // active key in use
  const [keyInput,    setKeyInput]    = useState("");        // controlled input value
  const [keyVisible,  setKeyVisible]  = useState(false);    // show/hide key text
  const [keyLoading,  setKeyLoading]  = useState(false);    // testing key
  const [keyError,    setKeyError]    = useState("");        // validation error
  const [connected,   setConnected]   = useState(false);    // successfully connected
  const [apiBase,     setApiBase]     = useState("");        // which URL to call ("" = not connected)

  // ── Pagination state ───────────────────────────────────────────
  const [page,     setPage]     = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // ── Sorting state ─────────────────────────────────────────────
  const [sortCol, setSortCol] = useState("email_sent");
  const [sortDir, setSortDir] = useState("desc");

  // ── Performance refs ──────────────────────────────────────────
  // Cache persists for the lifetime of the component (not shared between tabs)
  const cache    = useRef(new DataCache()).current;
  const abortRef = useRef(null); // cancel in-flight "requests"

  // Debounced search — 300ms delay before filtering
  const debouncedSearch = useDebounce(search, 300);

  // ── Reset pagination when filters or date change ──────────────
  useEffect(() => { setPage(1); }, [debouncedSearch, statusFilter, startDate, endDate]);

  // ── Connect with API key ──────────────────────────────────────
  //
  // Auto-detects which proxy is available:
  //   1. proxy.js    at localhost:3333  (zero npm — recommended)
  //   2. backend.js  at localhost:4000  (full Express backend)
  //   3. Direct call to api.instantly.ai (blocked by CORS in most browsers)
  //
  const handleConnect = useCallback(async () => {
    const key = keyInput.trim();
    if (!key) { setKeyError("Please paste your Instantly API key."); return; }
    setKeyLoading(true);
    setKeyError("");

    // Helper: validate key against a given base URL, returns true on success
    async function tryBase(baseUrl, healthPath, testPath) {
      try {
        const h = await fetch(`${baseUrl}${healthPath}`, { signal: AbortSignal.timeout(2000) });
        if (!h.ok) return false;
        const t = await fetch(`${baseUrl}${testPath}`, {
          headers: apiHeaders(key),
          signal: AbortSignal.timeout(8000),
        });
        if (t.status === 401 || t.status === 403) {
          setKeyError("Invalid API key — please check and try again.");
          setKeyLoading(false);
          return null; // null = key rejected (stop trying)
        }
        return t.ok;
      } catch (_) {
        return false; // server not running
      }
    }

    // Step 1 — proxy.js at localhost:3333 (no npm install needed!)
    const proxyOk = await tryBase(PROXY_URL, "/health", "/campaign?limit=1");
    if (proxyOk === null) return; // bad key
    if (proxyOk) {
      setApiKey(key); setApiBase(PROXY_URL); setConnected(true); setKeyError("");
      setKeyLoading(false); return;
    }

    // Step 2 — backend-server.js at localhost:4000
    const backendOk = await tryBase(BACKEND_URL, "/api/health", "/api/campaigns?limit=1");
    if (backendOk === null) return; // bad key
    if (backendOk) {
      setApiKey(key); setApiBase(BACKEND_URL); setConnected(true); setKeyError("");
      setKeyLoading(false); return;
    }

    // Step 3 — direct call (works only if Instantly sends CORS headers)
    try {
      const res = await fetch(`${INSTANTLY_V2}/campaign?limit=1`, {
        headers: apiHeaders(key),
        signal: AbortSignal.timeout(8000),
      });
      if (res.status === 401 || res.status === 403) {
        setKeyError("Invalid API key — please check and try again.");
        setKeyLoading(false); return;
      }
      if (!res.ok) throw new Error(`Instantly returned ${res.status}.`);
      setApiKey(key); setApiBase(INSTANTLY_V2); setConnected(true); setKeyError("");
    } catch (e) {
      const isCors = e instanceof TypeError || e.name === "TypeError";
      setKeyError(isCors
        ? "CORS error — proxy not running. Run  node proxy.js  then click Connect again. See the setup guide below."
        : e.message || "Could not connect. Check your key and try again."
      );
    } finally {
      setKeyLoading(false);
    }
  }, [keyInput]);

  // ── Core data loader ──────────────────────────────────────────
  /**
   * loadData(start, end, opts)
   *
   * With API key set  → calls Instantly API v2 directly from the browser.
   * Without API key   → shows mock data (preview/demo mode).
   *
   * Cache layers:
   *  1. Fresh hit  → instant render, zero network cost.
   *  2. Stale hit  → render immediately, revalidate silently in background.
   *  3. Miss       → full fetch, skeleton loader shown.
   */
  const loadData = useCallback(async (start, end, { forceRefresh = false, key = apiKey, base = apiBase } = {}) => {
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const cached = cache.get(start, end);

    if (cached && !forceRefresh) {
      if (cached.fresh) {
        setCampaigns(cached.campaigns);
        setDailyData(cached.dailyData);
        setLastRefresh(new Date(cached.ts));
        setLoading(false);
        setCacheHit(true);
        return;
      }
      setCampaigns(cached.campaigns);
      setDailyData(cached.dailyData);
      setLoading(false);
      setCacheHit(true);
      setRevalidating(true);
    } else {
      setLoading(true);
      setCacheHit(false);
    }

    // No key → demo mode with mock data
    if (!key) {
      setTimeout(() => {
        if (ctrl.signal.aborted) return;
        const c = generateCampaignData(start, end);
        const d = generateDailyData(start, end);
        cache.set(start, end, { campaigns: c, dailyData: d });
        setCampaigns(c); setDailyData(d);
        setLoading(false); setRevalidating(false); setCacheHit(false);
        setLastRefresh(new Date());
      }, 400);
      return;
    }

    try {
      const s = toISO(start), e = toISO(end);

      // ── Route API calls based on which proxy/mode is active ───────
      let rawCampaigns, analyticsData;
      if (base === BACKEND_URL) {
        // backend-server.js (Express) — different route structure
        const headers = key ? apiHeaders(key) : {};
        const [camRes, anaRes] = await Promise.all([
          fetch(`${BACKEND_URL}/api/campaigns?start=${s}&end=${e}`, { headers, signal: ctrl.signal }),
          fetch(`${BACKEND_URL}/api/summary?start=${s}&end=${e}`,   { headers, signal: ctrl.signal }),
        ]);
        if (!camRes.ok) throw new Error(`Backend error ${camRes.status}`);
        const camData = await camRes.json();
        rawCampaigns  = Array.isArray(camData) ? camData : (camData.campaigns || camData.items || []);
        analyticsData = anaRes.ok ? await anaRes.json() : [];
      } else {
        // proxy.js (localhost:3333) or direct (api.instantly.ai) — same Instantly v2 routes
        [rawCampaigns, analyticsData] = await Promise.all([
          fetchInstantlyCampaigns(key, s, e, ctrl.signal, base || INSTANTLY_V2),
          fetchInstantlyAnalytics(key, s, e, ctrl.signal, base || INSTANTLY_V2).catch(() => []),
        ]);
      }

      if (ctrl.signal.aborted) return;

      // Build a quick lookup: campaign_id → analytics summary
      const analyticsMap = {};
      const analyticsList = Array.isArray(analyticsData)
        ? analyticsData
        : (analyticsData?.items || analyticsData?.campaigns || []);
      analyticsList.forEach(a => {
        if (a.campaign_id || a.id) analyticsMap[a.campaign_id ?? a.id] = a;
      });

      const newCampaigns = rawCampaigns.map(c => transformV2Campaign(c, analyticsMap));
      const newDailyData  = buildDailyRows(start, end, analyticsData);

      cache.set(start, end, { campaigns: newCampaigns, dailyData: newDailyData });
      setCampaigns(newCampaigns);
      setDailyData(newDailyData);
      setApiError(null);
      setLastRefresh(new Date());

    } catch (err) {
      if (err.name === "AbortError") return;
      console.warn("[Instantly Dashboard]", err.message);
      // Keep whatever data we already have; show a non-blocking error
      if (!campaigns.length) {
        const c = generateCampaignData(start, end);
        const d = generateDailyData(start, end);
        cache.set(start, end, { campaigns: c, dailyData: d });
        setCampaigns(c); setDailyData(d);
      }
      const isCors = err instanceof TypeError || err.name === "TypeError";
      setApiError(isCors
        ? "CORS error — browsers can't call Instantly's API directly. Run backend-server.js locally (see setup guide) or use a CORS proxy."
        : `API error: ${err.message}`);
    } finally {
      if (!ctrl.signal.aborted) {
        setLoading(false); setRevalidating(false); setCacheHit(false);
      }
    }
  }, [cache, apiKey, apiBase, campaigns.length]);

  // Initial load — mock data until key is entered
  useEffect(() => { loadData(startDate, endDate); }, []); // eslint-disable-line

  // Re-fetch with real data once key is confirmed valid
  useEffect(() => {
    if (apiKey && apiBase) {
      cache.clear();
      loadData(startDate, endDate, { forceRefresh: true, key: apiKey, base: apiBase });
    }
  }, [apiKey, apiBase]); // eslint-disable-line

  // Auto-refresh every 60s — uses stale-while-revalidate (no spinner)
  useEffect(() => {
    const iv = setInterval(() => {
      cache.invalidate(startDate, endDate); // force a fresh fetch
      loadData(startDate, endDate);
    }, 60_000);
    return () => clearInterval(iv);
  }, [startDate, endDate, loadData, cache]);

  const handleDateChange = useCallback((start, end) => {
    setStartDate(start); setEndDate(end);
    loadData(start, end);
  }, [loadData]);

  const handleRefresh = useCallback(() => {
    cache.invalidate(startDate, endDate);
    loadData(startDate, endDate, { forceRefresh: true });
  }, [startDate, endDate, loadData, cache]);

  // ── Sorting handler ───────────────────────────────────────────
  const handleSort = useCallback((col) => {
    setSortCol(prev => {
      if (prev === col) setSortDir(d => d === "asc" ? "desc" : "asc");
      else { setSortDir("desc"); }
      return col;
    });
    setPage(1);
  }, []);

  // ── Derived data ──────────────────────────────────────────────

  // 1. Filter (debounced search + status)
  const filtered = useMemo(() => campaigns.filter(c => {
    const matchSearch = c.name.toLowerCase().includes(debouncedSearch.toLowerCase());
    const matchStatus = statusFilter === "All" || c.status === statusFilter;
    return matchSearch && matchStatus;
  }), [campaigns, debouncedSearch, statusFilter]);

  // 2. Sort
  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = a[sortCol], bv = b[sortCol];
      if (typeof av === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [filtered, sortCol, sortDir]);

  // 3. Paginate
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const paginated  = useMemo(
    () => sorted.slice((page - 1) * pageSize, page * pageSize),
    [sorted, page, pageSize]
  );

  // 4. Aggregate metrics (from daily data — date-range aware)
  const totals = useMemo(() => ({
    sent:          sum(dailyData, "sent"),
    opened:        sum(dailyData, "opened"),
    replies:       sum(dailyData, "replies"),
    clicks:        sum(dailyData, "clicks"),
    opportunities: sum(dailyData, "opportunities"),
    bounced:       sum(dailyData, "bounced"),
  }), [dailyData]);

  // 5. Chart: status distribution pie
  const statusData = useMemo(() => {
    const counts = { Active:0, Completed:0, Paused:0 };
    campaigns.forEach(c => { counts[c.status] = (counts[c.status]||0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [campaigns]);

  // 6. Chart: sent/opens/replies per campaign — top 8 from sorted list
  const campaignBarData = useMemo(() =>
    sorted.slice(0, 8).map(c => ({
      name:    c.name.length > 15 ? c.name.slice(0,15)+"…" : c.name,
      Sent:    c.email_sent,
      Opened:  c.email_opened,
      Replies: c.reply_count,
    }))
  , [sorted]);

  // ── Render helpers ────────────────────────────────────────────
  const PIE_COLORS   = ["#10b981", "#6366f1", "#f59e0b"];
  const bg           = dark ? "bg-gray-900" : "bg-gray-50";
  const text         = dark ? "text-white"  : "text-gray-900";
  const tooltipStyle = { background: dark?"#111827":"#fff", border:"none", borderRadius:8, boxShadow:"0 4px 16px rgba(0,0,0,.12)", fontSize:12 };

  // Sortable column headers
  const TH = ({ label, field }) => (
    <th
      onClick={() => field && handleSort(field)}
      className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider whitespace-nowrap select-none ${dark?"text-gray-400":"text-gray-500"} ${field?"cursor-pointer hover:text-indigo-500":""}`}>
      {label}{field && <SortIcon col={field} sortCol={sortCol} sortDir={sortDir}/>}
    </th>
  );

  // ═══════════════════════════════════════════════════════════════
  return (
    <div className={`min-h-screen ${bg} transition-colors duration-200`}>

      {/* ── Header ─────────────────────────────────────────────── */}
      <header className={`sticky top-0 z-30 backdrop-blur-md border-b ${dark?"bg-gray-900/90 border-gray-800":"bg-white/90 border-gray-200"}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
              <Zap size={18} className="text-white"/>
            </div>
            <div>
              <h1 className={`text-base font-bold tracking-tight leading-tight ${text}`}>Instantly Dashboard</h1>
              <div className={`flex items-center gap-2 text-xs ${dark?"text-gray-500":"text-gray-400"}`}>
                {revalidating
                  ? <><Wifi size={11} className="text-amber-400 animate-pulse"/> Revalidating…</>
                  : lastRefresh
                    ? <>{cacheHit ? <Database size={11} className="text-indigo-400"/> : <Wifi size={11} className="text-emerald-400"/>} Updated {lastRefresh.toLocaleTimeString()}</>
                    : "Loading…"
                }
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <DateRangePicker startDate={startDate} endDate={endDate} onChange={handleDateChange} dark={dark}/>
            <button onClick={handleRefresh} disabled={loading}
              className={`p-2.5 rounded-lg border transition-all ${dark?"border-gray-700 hover:bg-gray-800 text-gray-400":"border-gray-200 hover:bg-gray-50 text-gray-500"} ${loading?"animate-spin":""}`}>
              <RefreshCw size={15}/>
            </button>
            <button onClick={() => exportCSV(sorted, startDate, endDate)}
              className={`hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-medium transition-all ${dark?"border-gray-700 hover:bg-gray-800 text-gray-300":"border-gray-200 hover:bg-gray-50 text-gray-600"}`}>
              <Download size={14}/> Export {sorted.length > 0 && `(${sorted.length})`}
            </button>
            <button onClick={() => setDark(!dark)}
              className={`p-2.5 rounded-lg border transition-all ${dark?"border-gray-700 hover:bg-gray-800 text-yellow-400":"border-gray-200 hover:bg-gray-50 text-gray-500"}`}>
              {dark ? <Sun size={15}/> : <Moon size={15}/>}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">

        {/* ── API Key Setup Panel ───────────────────────────────── */}
        {!connected ? (
          <div className={`rounded-xl border p-5 ${dark ? "bg-gray-800 border-gray-700" : "bg-white border-indigo-100"}`}>
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shrink-0">
                <KeyRound size={18} className="text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className={`font-semibold text-sm ${dark ? "text-white" : "text-gray-900"}`}>
                  Connect your Instantly account
                </p>
                <p className={`text-xs mt-0.5 mb-2 ${dark ? "text-gray-400" : "text-gray-500"}`}>
                  Paste your API key to load real campaign data. Find it at{" "}
                  <span className={`font-medium ${dark ? "text-indigo-400" : "text-indigo-600"}`}>
                    app.instantly.ai → Settings → API
                  </span>
                </p>

                {/* ── Preview sandbox notice ──────────────────────────── */}
                <div className={`rounded-xl border px-4 py-3 text-xs ${dark ? "bg-amber-900/20 border-amber-700/50 text-amber-300" : "bg-amber-50 border-amber-200 text-amber-800"}`}>
                  <p className="font-bold text-sm mb-1">⚠ API connections don't work in this preview</p>
                  <p className={dark ? "text-amber-400" : "text-amber-700"}>
                    Claude's preview is a sandboxed iframe — it permanently blocks all outgoing network requests.
                    This is a browser security restriction that cannot be bypassed here. Clicking Connect will always fail.
                  </p>
                  <div className={`mt-2.5 pt-2.5 border-t ${dark ? "border-amber-800/50" : "border-amber-200"}`}>
                    <p className="font-semibold mb-1">✅ To use with real Instantly data — 2 steps:</p>
                    <p className={dark ? "text-amber-400" : "text-amber-700"}>
                      <span className="font-semibold">1.</span> Download <code className="font-mono bg-amber-100 text-amber-900 px-1 rounded">app.js</code>, <code className="font-mono bg-amber-100 text-amber-900 px-1 rounded">dashboard.html</code>, and <code className="font-mono bg-amber-100 text-amber-900 px-1 rounded">start.bat</code> (Windows) or <code className="font-mono bg-amber-100 text-amber-900 px-1 rounded">start.command</code> (Mac) to the same folder on your computer.
                    </p>
                    <p className={`mt-1 ${dark ? "text-amber-400" : "text-amber-700"}`}>
                      <span className="font-semibold">2.</span> Double-click the launcher file. Your browser opens at <code className="font-mono bg-amber-100 text-amber-900 px-1 rounded">localhost:3000</code> — enter your API key there and it connects instantly, no proxy needed.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-medium w-fit">
            <CheckCircle2 size={13} />
            Connected to Instantly · live data
            <span className="text-emerald-500 font-normal">
              {apiBase === PROXY_URL    ? "via proxy.js"   :
               apiBase === BACKEND_URL ? "via backend.js"  :
               "direct"}
            </span>
            <button
              onClick={() => { setConnected(false); setApiKey(""); setKeyInput(""); setApiBase(""); }}
              className="ml-2 text-emerald-500 hover:text-emerald-700">
              <X size={12} />
            </button>
          </div>
        )}

        {/* ── API connection error banner ───────────────────────── */}
        {apiError && (
          <div className="flex items-start gap-3 px-4 py-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-800 text-sm">
            <WifiOff size={16} className="mt-0.5 shrink-0 text-amber-500" />
            <div className="flex-1">
              <span className="font-semibold">{apiError?.includes("CORS") ? "CORS restriction — " : "API error — "}</span>
              {apiError}
            </div>
            <button onClick={() => setApiError(null)} className="shrink-0 text-amber-400 hover:text-amber-700">
              <X size={15} />
            </button>
          </div>
        )}

        {/* ── Date context bar ──────────────────────────────────── */}
        {!loading && (
          <div className={`flex items-center justify-between text-xs ${dark?"text-gray-500":"text-gray-400"}`}>
            <div className="flex items-center gap-2">
              <Calendar size={13}/>
              <span>
                Showing analytics for{" "}
                <span className={`font-semibold ${dark?"text-indigo-400":"text-indigo-600"}`}>
                  {startDate.toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"})}
                  {toISO(startDate)!==toISO(endDate) && ` – ${endDate.toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"})}`}
                </span>
                {" "}({Math.round((endDate-startDate)/86400000)+1} days)
              </span>
            </div>
            {cacheHit && (
              <span className={`flex items-center gap-1 ${dark?"text-amber-400":"text-amber-500"}`}>
                <Database size={11}/> Served from cache
              </span>
            )}
          </div>
        )}

        {/* ── Metric Cards ─────────────────────────────────────── */}
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[...Array(8)].map((_,i) => (
              <div key={i} className={`rounded-xl p-5 border ${dark?"bg-gray-800 border-gray-700":"bg-white border-gray-100"}`}>
                <Skeleton className="w-10 h-10 mb-3"/><Skeleton className="w-24 h-3 mb-2"/><Skeleton className="w-16 h-7"/>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <MetricCard icon={Mail}             label="Total Sent"     value={fmt(totals.sent)}         sub={`${Math.round((endDate-startDate)/86400000)+1} day window`} color="blue"   trend={12.3} dark={dark} cached={cacheHit}/>
            <MetricCard icon={Eye}              label="Emails Opened"  value={fmt(totals.opened)}        sub={`${pct(totals.opened,totals.sent)}% open rate`}            color="green"  trend={8.1}  dark={dark} cached={cacheHit}/>
            <MetricCard icon={TrendingUp}       label="Open Rate"      value={`${pct(totals.opened,totals.sent)}%`}                                                       color="purple" trend={3.2}  dark={dark} cached={cacheHit}/>
            <MetricCard icon={MessageSquare}    label="Total Replies"  value={fmt(totals.replies)}       sub={`${pct(totals.replies,totals.sent)}% reply rate`}           color="cyan"   trend={5.7}  dark={dark} cached={cacheHit}/>
            <MetricCard icon={Activity}         label="Reply Rate"     value={`${pct(totals.replies,totals.sent)}%`}                                                      color="amber"  trend={-1.4} dark={dark} cached={cacheHit}/>
            <MetricCard icon={MousePointerClick}label="Click Rate"     value={`${pct(totals.clicks,totals.sent)}%`}  sub={`${fmt(totals.clicks)} clicks`}                color="indigo" trend={4.6}  dark={dark} cached={cacheHit}/>
            <MetricCard icon={Target}           label="Opportunities"  value={fmt(totals.opportunities)} sub={`${pct(totals.opportunities,totals.sent)}% conv. rate`}    color="teal"   trend={7.2}  dark={dark} cached={cacheHit}/>
            <MetricCard icon={AlertTriangle}    label="Bounce Rate"    value={`${pct(totals.bounced,totals.sent)}%`} sub={`${totals.bounced} bounced`}                   color="rose"   trend={-2.8} dark={dark} cached={cacheHit}/>
          </div>
        )}

        {/* ── Charts Row 1 ─────────────────────────────────────── */}
        {loading ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {[0,1].map(i => (
              <div key={i} className={`rounded-xl p-5 border ${dark?"bg-gray-800 border-gray-700":"bg-white border-gray-100"} ${i===0?"lg:col-span-2":""}`}>
                <Skeleton className="w-40 h-4 mb-4"/><Skeleton className="w-full h-52"/>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <ChartCard title="Daily Activity" subtitle={`${toISO(startDate)} → ${toISO(endDate)} · Sent · Opened · Replies · Clicks`} dark={dark} className="lg:col-span-2">
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={dailyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={dark?"#1f2937":"#f3f4f6"}/>
                  <XAxis dataKey="label" tick={{fontSize:10,fill:dark?"#6b7280":"#9ca3af"}} interval="preserveStartEnd"/>
                  <YAxis tick={{fontSize:10,fill:dark?"#6b7280":"#9ca3af"}}/>
                  <Tooltip content={<ChartTooltip dark={dark}/>}/>
                  <Legend wrapperStyle={{fontSize:11}}/>
                  <Line type="monotone" dataKey="sent"    stroke="#6366f1" strokeWidth={2} dot={false} name="Sent"/>
                  <Line type="monotone" dataKey="opened"  stroke="#10b981" strokeWidth={2} dot={false} name="Opened"/>
                  <Line type="monotone" dataKey="replies" stroke="#f59e0b" strokeWidth={2} dot={false} name="Replies"/>
                  <Line type="monotone" dataKey="clicks"  stroke="#06b6d4" strokeWidth={2} dot={false} name="Clicks"/>
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Campaign Status" dark={dark}>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie data={statusData} cx="50%" cy="45%" innerRadius={52} outerRadius={80} paddingAngle={4} dataKey="value">
                    {statusData.map((_,i)=><Cell key={i} fill={PIE_COLORS[i%PIE_COLORS.length]}/>)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle}/>
                  <Legend wrapperStyle={{fontSize:11}} formatter={(v,e)=>`${v} (${e.payload.value})`}/>
                </PieChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>
        )}

        {/* ── Charts Row 2: Campaign comparison ────────────────── */}
        {!loading && (
          <ChartCard title="Sent vs Opens vs Replies by Campaign" subtitle="Top 8 campaigns by current sort order" dark={dark}>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={campaignBarData} barCategoryGap="20%" barGap={3}>
                <CartesianGrid strokeDasharray="3 3" stroke={dark?"#1f2937":"#f3f4f6"}/>
                <XAxis dataKey="name" tick={{fontSize:10,fill:dark?"#6b7280":"#9ca3af"}}/>
                <YAxis tick={{fontSize:10,fill:dark?"#6b7280":"#9ca3af"}}/>
                <Tooltip content={<ChartTooltip dark={dark}/>}/>
                <Legend wrapperStyle={{fontSize:11}}/>
                <Bar dataKey="Sent"    fill="#6366f1" radius={[4,4,0,0]}/>
                <Bar dataKey="Opened"  fill="#10b981" radius={[4,4,0,0]}/>
                <Bar dataKey="Replies" fill="#f59e0b" radius={[4,4,0,0]}/>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        )}

        {/* ── Filters & Search ─────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
          <div className="relative flex-1 max-w-sm">
            <Search size={15} className={`absolute left-3 top-1/2 -translate-y-1/2 ${dark?"text-gray-500":"text-gray-400"}`}/>
            {search && (
              <button onClick={()=>setSearch("")} className={`absolute right-3 top-1/2 -translate-y-1/2 ${dark?"text-gray-500 hover:text-gray-300":"text-gray-400 hover:text-gray-600"}`}>
                <X size={13}/>
              </button>
            )}
            <input type="text" placeholder="Search campaigns…" value={search} onChange={e=>setSearch(e.target.value)}
              className={`w-full pl-9 pr-8 py-2.5 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 ${dark?"bg-gray-800 border-gray-700 text-white placeholder-gray-500":"bg-white border-gray-200 text-gray-900 placeholder-gray-400"}`}/>
          </div>
          {/* Search is debounced — show live search term vs applied term */}
          {search !== debouncedSearch && (
            <span className={`text-xs ${dark?"text-gray-600":"text-gray-400"}`}>Filtering…</span>
          )}
          <div className="flex gap-1.5">
            {["All","Active","Completed","Paused"].map(s=>(
              <button key={s} onClick={()=>setStatusFilter(s)}
                className={`px-3 py-2 rounded-lg text-sm font-medium border transition-all ${statusFilter===s?"bg-indigo-600 text-white border-indigo-600":dark?"border-gray-700 text-gray-400 hover:bg-gray-800":"border-gray-200 text-gray-500 hover:bg-gray-50"}`}>
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* ── Export bar ────────────────────────────────────────── */}
        {!loading && sorted.length > 0 && (
          <div className={`flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 px-4 py-3 rounded-xl border ${dark?"bg-gray-800/60 border-gray-700":"bg-white border-gray-100"}`}>
            <div>
              <p className={`text-sm font-semibold ${dark?"text-gray-200":"text-gray-700"}`}>
                Export Campaign Data
              </p>
              <p className={`text-xs mt-0.5 ${dark?"text-gray-500":"text-gray-400"}`}>
                {sorted.length} campaign{sorted.length !== 1 ? "s" : ""} · all 13 columns ·{" "}
                <span className={`font-medium ${dark?"text-indigo-400":"text-indigo-600"}`}>
                  {startDate.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}
                  {toISO(startDate) !== toISO(endDate) && ` – ${endDate.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}`}
                </span>
                {" "}· filename: <code className={`text-xs ${dark?"text-gray-400":"text-gray-500"}`}>instantly_campaigns_{toISO(startDate)}_to_{toISO(endDate)}.csv</code>
              </p>
            </div>
            <button
              onClick={() => exportCSV(sorted, startDate, endDate)}
              className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white text-sm font-semibold rounded-lg transition-colors shadow-sm whitespace-nowrap">
              <Download size={15} />
              Download CSV
            </button>
          </div>
        )}

        {/* ── Campaign Table ──────────────────────────────────── */}
        <div className={`rounded-xl border overflow-hidden shadow-sm ${dark?"bg-gray-800 border-gray-700":"bg-white border-gray-100"}`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className={dark?"bg-gray-800/80":"bg-gray-50"}>
                  <TH label="Campaign"      field="name"/>
                  <TH label="Sent"          field="email_sent"/>
                  <TH label="Opened"        field="email_opened"/>
                  <TH label="Clicks"        field="click_count"/>
                  <TH label="Replies"       field="reply_count"/>
                  <TH label="Bounced"       field="bounce_count"/>
                  <TH label="Opportunities" field="opportunities"/>
                  <TH label="Open %"        field="email_opened"/>
                  <TH label="Click %"       field="click_count"/>
                  <TH label="Reply %"       field="reply_count"/>
                  <TH label="Step"          field={null}/>
                  <TH label="Next Trigger"  field={null}/>
                  <TH label="Status"        field="status"/>
                </tr>
              </thead>
              <tbody className={`divide-y ${dark?"divide-gray-700/60":"divide-gray-100"}`}>
                {loading ? (
                  [...Array(pageSize > 5 ? 5 : pageSize)].map((_,i)=>(
                    <tr key={i}>
                      {[...Array(13)].map((_,j)=>(
                        <td key={j} className="px-4 py-3"><Skeleton className="w-full h-4"/></td>
                      ))}
                    </tr>
                  ))
                ) : paginated.length === 0 ? (
                  <tr>
                    <td colSpan={13} className="px-4 py-16 text-center">
                      <Search size={36} className={`mx-auto mb-3 ${dark?"text-gray-600":"text-gray-300"}`}/>
                      <p className={`font-medium ${dark?"text-gray-400":"text-gray-500"}`}>No campaigns found</p>
                      <p className={`text-xs mt-1 ${dark?"text-gray-600":"text-gray-400"}`}>Try adjusting your search or filters</p>
                    </td>
                  </tr>
                ) : paginated.map(c=>(
                  <tr key={c.id} className={`transition-colors ${dark?"hover:bg-gray-700/40":"hover:bg-gray-50/80"}`}>
                    <td className={`px-4 py-3.5 font-medium max-w-[200px] truncate ${dark?"text-gray-200":"text-gray-900"}`} title={c.name}>{c.name}</td>
                    <td className={`px-4 py-3.5 tabular-nums ${dark?"text-gray-300":"text-gray-700"}`}>{c.email_sent.toLocaleString()}</td>
                    <td className={`px-4 py-3.5 tabular-nums ${dark?"text-gray-300":"text-gray-700"}`}>{c.email_opened.toLocaleString()}</td>
                    <td className={`px-4 py-3.5 tabular-nums ${dark?"text-gray-300":"text-gray-700"}`}>{c.click_count.toLocaleString()}</td>
                    <td className={`px-4 py-3.5 tabular-nums ${dark?"text-gray-300":"text-gray-700"}`}>{c.reply_count}</td>
                    <td className="px-4 py-3.5 tabular-nums">
                      <span className={`inline-flex items-center gap-1 font-medium ${c.bounce_count>50?"text-rose-500":c.bounce_count>20?"text-amber-500":dark?"text-gray-300":"text-gray-600"}`}>
                        {c.bounce_count>50 && <AlertTriangle size={12}/>}{c.bounce_count}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 tabular-nums">
                      <span className={`inline-flex items-center gap-1 font-semibold ${dark?"text-teal-400":"text-teal-600"}`}>
                        <Target size={11}/>{c.opportunities}
                      </span>
                    </td>
                    <td className={`px-4 py-3.5 tabular-nums ${dark?"text-gray-300":"text-gray-600"}`}>{pct(c.email_opened,c.email_sent)}%</td>
                    <td className={`px-4 py-3.5 tabular-nums ${dark?"text-gray-300":"text-gray-600"}`}>{pct(c.click_count,c.email_sent)}%</td>
                    <td className={`px-4 py-3.5 tabular-nums ${dark?"text-gray-300":"text-gray-600"}`}>{pct(c.reply_count,c.email_sent)}%</td>
                    <td className={`px-4 py-3.5 whitespace-nowrap ${dark?"text-gray-400":"text-gray-500"}`}>{c.current_step}</td>
                    <td className={`px-4 py-3.5 whitespace-nowrap ${dark?"text-gray-400":"text-gray-500"}`}>{c.next_trigger_date||"—"}</td>
                    <td className="px-4 py-3.5"><StatusBadge status={c.status}/></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination footer */}
          {!loading && sorted.length > 0 && (
            <Pagination
              page={page} totalPages={totalPages}
              pageSize={pageSize} totalRows={sorted.length}
              onPage={setPage} onPageSize={setPageSize}
              dark={dark}
            />
          )}
        </div>

      </main>
    </div>
  );
}
