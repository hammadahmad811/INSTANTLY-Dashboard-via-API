# Instantly Analytics Dashboard

A zero-dependency Node.js dashboard for Instantly.ai — campaign analytics, email account management, and a campaign tracker.

## Running Locally

```bash
node app.js
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Deploying to Railway

### 1. Push to GitHub

```bash
# In your project folder (e.g. D:\My Apps - GitHuB\instantly-dashboard)
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

### 2. Create a Railway project

1. Go to [railway.app](https://railway.app) and sign in with GitHub
2. Click **New Project → Deploy from GitHub repo**
3. Select your repository
4. Railway will auto-detect Node.js and deploy

### 3. Set your API keys as environment variables

Railway's filesystem resets on every deploy, so API keys must live in environment variables — **not** in `accounts.json`.

In your Railway project dashboard → **Variables** tab, add:

| Variable | Value | Description |
|---|---|---|
| `INSTANTLY_API_KEY_1` | `your_key_here` | First Instantly account API key |
| `INSTANTLY_ACCOUNT_NAME_1` | `Client - PE` | Display name for account 1 |
| `INSTANTLY_API_KEY_2` | `your_key_here` | Second account (optional) |
| `INSTANTLY_ACCOUNT_NAME_2` | `Buzznation` | Display name for account 2 |

Add as many numbered pairs as you have accounts (up to 10).

> **Note:** You can also use a single `INSTANTLY_API_KEY` variable if you only have one account.

### 4. Get your Railway URL

After deploy, Railway gives you a public URL like:  
`https://instantly-dashboard-production.up.railway.app`

Open it in your browser — the dashboard will load with your accounts already connected.

---

## Campaign metadata persistence

`campaigns-meta.json` (event dates, email groups, etc.) is saved to disk and **will reset** on Railway deploys. To preserve it:

- Export your tracker data to CSV before redeploying
- Or upgrade to a Railway volume (persistent disk) in the Railway dashboard → **Add Volume** → mount at `/app`

---

## Environment variables reference

| Variable | Required | Description |
|---|---|---|
| `PORT` | Auto (Railway sets this) | Server port |
| `INSTANTLY_API_KEY` | Optional | Single account key shorthand |
| `INSTANTLY_ACCOUNT_NAME` | Optional | Name for the single account |
| `INSTANTLY_API_KEY_N` | Optional | Nth account key (N = 1–10) |
| `INSTANTLY_ACCOUNT_NAME_N` | Optional | Nth account display name |
