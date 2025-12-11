# Quick Start - Vercel Deployment

## What Was Fixed

Your FastAPI + Vite application is now configured for Vercel deployment. The main changes:

1. **Created `api/index.py`** - Wraps FastAPI with Mangum for serverless
2. **Created `vercel.json`** - Configures routing and builds
3. **Updated `requirements.txt`** - Added `mangum` dependency
4. **Updated frontend** - Uses `/api` prefix in production

## Deploy Now

```bash
# Install Vercel CLI (if needed)
npm install -g vercel

# Deploy
vercel

# Or deploy to production
vercel --prod
```

## How It Works

- **Frontend**: Vite app in `fuzzy_logic vite/` builds to `dist/` and is served at root
- **Backend**: FastAPI in `app.py` is wrapped in `api/index.py` and served at `/api/*`
- **Routing**: `vercel.json` routes `/api/*` to Python function, everything else to frontend

## Test After Deployment

1. Visit your Vercel URL (e.g., `https://your-app.vercel.app`)
2. Test `/api/health` - should return `{"status": "ok"}`
3. Test the file upload functionality

## If Still Not Working

1. Check Vercel build logs in dashboard
2. Verify all files are committed to git
3. Ensure `requirements.txt` has all dependencies
4. Check that `api/index.py` can import `app.py` correctly

