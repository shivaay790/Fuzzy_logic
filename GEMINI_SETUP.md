# Gemini API Setup Guide

This application supports two matching methods:
1. **Fuzzy Logic (Fuse.js)** - Fast, algorithm-based string matching
2. **LLM (Gemini AI)** - AI-powered intelligent matching

## Setting Up Gemini API

### Step 1: Get Your API Key

1. Go to [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Sign in with your Google account
3. Click "Create API Key"
4. Copy your API key

### Step 2: Configure the API Key

#### For Local Development:

Create a `.env` file in the root directory:

```env
GEMINI_API_KEY=your_api_key_here
```

Or set it as an environment variable:

**Windows (PowerShell):**
```powershell
$env:GEMINI_API_KEY="your_api_key_here"
```

**Windows (CMD):**
```cmd
set GEMINI_API_KEY=your_api_key_here
```

**Linux/Mac:**
```bash
export GEMINI_API_KEY="your_api_key_here"
```

#### For Vercel Deployment:

1. Go to your Vercel project settings
2. Navigate to "Environment Variables"
3. Add a new variable:
   - **Name:** `GEMINI_API_KEY`
   - **Value:** Your Gemini API key
   - **Environment:** Production, Preview, Development (select all)
4. Redeploy your application

### Step 3: Using the Application

1. Start the API server:
   ```bash
   npm run start:api
   ```

2. Open the frontend (Vite app):
   ```bash
   cd "fuzzy_logic vite"
   npm run dev
   ```

3. In the web interface:
   - Select your matching method: "Fuzzy Logic" or "LLM (Gemini AI)"
   - Upload your files
   - Click "Process"

## How It Works

### Fuzzy Logic Method
- Uses Fuse.js library for fast string matching
- Processes data locally (no API calls)
- Fast and efficient for large datasets
- Best for exact and near-exact matches

### LLM (Gemini) Method
- Uses Google's Gemini AI model
- Sends data to Gemini API for intelligent matching
- Better at understanding context, abbreviations, and business names
- May take longer but provides more intelligent matches
- Requires internet connection and API key

## Data Format

Both methods accept:
- **Universal Database:** Excel/CSV file with `Supplier` column
- **Vendor File:** Excel/CSV file with `Vendor` column

The output format is identical for both methods:
- Matched vendors with suppliers
- Match type (exact/fuzzy/no_match)
- Confidence score (0-100)
- Amount information

## Troubleshooting

### "Gemini API key not configured" Error
- Make sure `GEMINI_API_KEY` environment variable is set
- Restart the API server after setting the variable
- For Vercel, ensure the variable is added in project settings

### API Rate Limits
- Gemini API has rate limits based on your Google Cloud quota
- If you hit limits, switch to Fuzzy Logic method
- Consider upgrading your Google Cloud plan for higher limits

### Slow Processing with LLM
- LLM method is slower than Fuzzy Logic
- For large datasets (>1000 vendors), consider using Fuzzy Logic
- LLM is better for complex matching scenarios

