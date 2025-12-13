# Environment Variable Setup Guide

## Where to Put Your Environment Variables

### For Local Development:

**Option 1: Create a `.env` file in the root directory** (Recommended)

1. Create a file named `.env` in the root directory (same folder as `package.json`)
2. Add your Gemini API key:
   ```
   GEMINI_API_KEY=your_api_key_here
   ```
3. The `.env` file will be automatically loaded when you run the API

**Location:**
```
fuzzy_macth/
├── .env                    ← Create this file here
├── package.json
├── api/
│   └── index.js
└── ...
```

**Example `.env` file:**
```env
GEMINI_API_KEY=AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
PORT=8000
```

**Option 2: Set environment variable directly (Windows PowerShell)**
```powershell
$env:GEMINI_API_KEY="your_api_key_here"
npm run start:api
```

**Option 3: Set environment variable directly (Windows CMD)**
```cmd
set GEMINI_API_KEY=your_api_key_here
npm run start:api
```

**Option 4: Set environment variable directly (Linux/Mac)**
```bash
export GEMINI_API_KEY="your_api_key_here"
npm run start:api
```

### For Vercel Deployment:

1. Go to your Vercel project dashboard
2. Click on **Settings**
3. Click on **Environment Variables** in the left sidebar
4. Click **Add New**
5. Enter:
   - **Name:** `GEMINI_API_KEY`
   - **Value:** Your Gemini API key
   - **Environment:** Select all (Production, Preview, Development)
6. Click **Save**
7. **Redeploy** your application for changes to take effect

## Getting Your Gemini API Key

1. Visit [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Sign in with your Google account
3. Click **"Create API Key"**
4. Copy the generated key
5. Paste it into your `.env` file or Vercel environment variables

## Important Notes

- **Never commit `.env` files to Git** - They contain sensitive information
- The `.env` file is already in `.gitignore` (if you have one)
- For Vercel, environment variables are encrypted and secure
- If you don't set the API key, the **Fuzzy Logic** method will still work
- The **LLM (Gemini)** method requires the API key to function

## Testing

After setting up your environment variable:

1. Restart your API server:
   ```bash
   npm run start:api
   ```

2. Check the console - you should see the API starting without errors

3. Try using the LLM method in the frontend - it should work now!

