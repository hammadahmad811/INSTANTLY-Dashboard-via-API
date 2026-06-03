# Instantly Dashboard — Setup Guide

## Project Structure

```
instantly-dashboard/
├── backend-server.js        # Express API (proxies Instantly API)
├── api-client.js             # Frontend fetch helpers (drop into src/)
├── instantly-dashboard.jsx   # Full React dashboard component
├── .env.example              # Environment variable template
└── package.json              # (you'll create this)
```

## Quick Start

### 1. Initialize & Install

```bash
mkdir instantly-dashboard && cd instantly-dashboard
npm init -y
npm install express cors axios dotenv
```

### 2. Configure API Key

```bash
cp .env.example .env
# Edit .env and paste your Instantly API key
```

### 3. Start the Backend

```bash
node backend-server.js
# → http://localhost:4000
```

### 4. Frontend Setup (Vite + React)

```bash
npm create vite@latest frontend -- --template react
cd frontend
npm install recharts lucide-react
npm install -D tailwindcss @tailwindcss/vite
```

Copy `instantly-dashboard.jsx` into `frontend/src/` and import it in `App.jsx`.

To connect to real data, replace the mock data imports with calls from `api-client.js`.

### 5. Connecting Real Data

In the dashboard component, replace the mock `useEffect` with:

```jsx
import { fetchCampaigns, fetchSummary } from "./api-client";

useEffect(() => {
  async function load() {
    const { campaigns } = await fetchCampaigns();
    setCampaigns(campaigns);
    setLoading(false);
    setLastRefresh(new Date());
  }
  load();
}, []);
```

## API Endpoints (Backend)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/campaigns` | All campaigns (supports `?status=` and `?search=`) |
| GET | `/api/campaigns/:id/analytics` | Single campaign analytics |
| GET | `/api/summary` | Aggregated metrics |
| GET | `/api/health` | Connectivity check |
