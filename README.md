# Vendor Invoice Matcher - Deployment Guide & Learnings

A full-stack application for matching vendor invoices to suppliers using fuzzy matching, originally built with Python/FastAPI and converted to Node.js/Express for better Vercel compatibility.

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Build frontend
npm run build

# Run locally (if you have a local server setup)
npm start
```

## 📚 Table of Contents

- [Project Overview](#project-overview)
- [Tech Stack](#tech-stack)
- [Vercel Language Support](#vercel-language-support)
- [Conversion Journey: Python → Node.js](#conversion-journey-python--nodejs)
- [Key Learnings](#key-learnings)
- [Architecture](#architecture)
- [API Endpoints](#api-endpoints)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)

## 📋 Project Overview

This application processes vendor invoices and matches them to a universal supplier database using:
- **Exact matching**: Case-insensitive exact name matches
- **Substring matching**: Handles variations with hyphens/underscores
- **Fuzzy matching**: Uses Fuse.js for similarity-based matching (85% threshold)

The application updates invoice totals in the universal database and provides detailed match reports.

## 🛠 Tech Stack

### Frontend
- **Vite** - Build tool and dev server
- **Vanilla JavaScript** - No framework dependencies
- **Modern CSS** - Responsive design

### Backend (Current - Node.js)
- **Express.js** - Web framework
- **Multer** - File upload handling
- **XLSX** - Excel/CSV processing
- **Fuse.js** - Fuzzy string matching
- **CORS** - Cross-origin resource sharing

### Backend (Previous - Python)
- **FastAPI** - Web framework
- **Pandas** - Data processing
- **OpenPyXL** - Excel file handling
- **RapidFuzz** - Fuzzy string matching
- **Mangum** - ASGI adapter for serverless

## 🌐 Vercel Language Support

**Vercel supports multiple languages and runtimes:**

### ✅ Fully Supported
1. **JavaScript/TypeScript (Node.js)**
   - Native support, best performance
   - Automatic detection of `package.json`
   - Supports all Node.js versions
   - **Recommended for most projects**

2. **Python**
   - Supported via `@vercel/python` runtime
   - Requires `requirements.txt` or `Pipfile`
   - Supports Python 3.9, 3.10, 3.11, 3.12
   - Can use FastAPI, Flask, Django
   - **Note**: More complex setup, potential compatibility issues

3. **Go**
   - Native support
   - Automatic detection of `.go` files
   - Excellent performance

4. **Ruby**
   - Supported via `@vercel/ruby`
   - Requires `Gemfile`

5. **PHP**
   - Supported via `@vercel/php`
   - Requires `composer.json`

### ⚠️ Python on Vercel: Challenges We Encountered

While Vercel **does support Python**, we encountered several issues:

1. **Handler Detection Issues**
   - Error: `TypeError: issubclass() arg 1 must be a class`
   - Vercel's internal handler detection conflicted with ASGI apps
   - Required complex workarounds with Mangum adapter

2. **Dependency Management**
   - Large dependencies (pandas, numpy) increase cold start times
   - Some packages have compatibility issues with serverless environment
   - Build time can be significantly longer

3. **Configuration Complexity**
   - Required `vercel.json` with `builds` section
   - Needed separate `api/requirements.txt`
   - Runtime version conflicts

4. **Debugging Difficulty**
   - Less clear error messages
   - Harder to troubleshoot serverless function issues

### 💡 Why We Switched to Node.js

1. **Native Support**: Node.js is Vercel's primary platform, best optimized
2. **Faster Deployments**: No Python runtime overhead
3. **Better Error Messages**: Clearer debugging experience
4. **Smaller Bundle Size**: JavaScript libraries are generally lighter
5. **Easier Configuration**: Auto-detection works seamlessly
6. **Better Performance**: Lower cold start times

## 🔄 Conversion Journey: Python → Node.js

### Original Python Implementation

```python
# FastAPI with pandas and rapidfuzz
from fastapi import FastAPI, File, UploadFile
import pandas as pd
from rapidfuzz import fuzz, process

app = FastAPI()

@app.post("/api/process")
async def process_files(
    universal_file: UploadFile = File(...),
    vendor_file: UploadFile = File(...)
):
    # Process with pandas
    universal_df = pd.read_excel(universal_file.file)
    # ... matching logic with rapidfuzz
```

### Converted Node.js Implementation

```javascript
// Express with xlsx and fuse.js
const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const Fuse = require('fuse.js');

const app = express();

app.post('/api/process', upload.fields([...]), async (req, res) => {
    // Process with xlsx
    const universalData = loadSpreadsheet(universalFile.buffer, ...);
    // ... matching logic with fuse.js
});
```

### Key Conversion Mappings

| Python Library | Node.js Equivalent | Purpose |
|---------------|-------------------|---------|
| `pandas` | `xlsx` | Excel/CSV processing |
| `openpyxl` | `xlsx` | Excel file reading/writing |
| `rapidfuzz` | `fuse.js` | Fuzzy string matching |
| `FastAPI` | `Express.js` | Web framework |
| `python-multipart` | `multer` | File upload handling |
| `Mangum` | Native Express | Serverless adapter (not needed) |

## 🎓 Key Learnings

### 1. Serverless Function Architecture

**What we learned:**
- Vercel functions are stateless
- Each request is a new function invocation
- Cold starts can be slow (especially with Python)
- Keep dependencies minimal for faster cold starts

**Best practices:**
- Use lightweight libraries
- Cache expensive operations when possible
- Keep function code focused and small

### 2. File Upload Handling

**Python (FastAPI):**
```python
@app.post("/api/process")
async def process_files(universal_file: UploadFile = File(...)):
    bytes = await universal_file.read()
```

**Node.js (Express):**
```javascript
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

app.post('/api/process', upload.fields([...]), (req, res) => {
    const buffer = req.files.universal_file[0].buffer;
});
```

**Key difference:** Node.js uses middleware for file uploads, Python uses async file reading.

### 3. Excel Processing

**Python (pandas):**
```python
df = pd.read_excel(buffer, sheet_name="Sheet1")
df.to_excel(buffer, sheet_name="Sheet1")
```

**Node.js (xlsx):**
```javascript
const workbook = XLSX.read(buffer, { type: 'buffer' });
const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
const newWorkbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(newWorkbook, worksheet, sheetName);
```

**Key difference:** 
- Pandas provides DataFrame operations (groupby, merge, etc.)
- XLSX is lower-level, requires manual data manipulation
- Both work, but pandas is more feature-rich for complex operations

### 4. Fuzzy Matching

**Python (rapidfuzz):**
```python
from rapidfuzz import fuzz, process

candidate = process.extractOne(
    vendor_name,
    supplier_list,
    scorer=fuzz.token_sort_ratio,
    score_cutoff=85
)
```

**Node.js (fuse.js):**
```javascript
const Fuse = require('fuse.js');

const fuse = new Fuse(supplierList, {
    threshold: (100 - 85) / 100,  // 0.15 = 85% similarity
    includeScore: true
});

const results = fuse.search(vendorName);
```

**Key difference:**
- RapidFuzz uses percentage scores (0-100)
- Fuse.js uses distance scores (0-1, lower is better)
- Both achieve similar results with different APIs

### 5. Data Processing Patterns

**Python (pandas):**
```python
# Forward fill
vendor_df["Vendor"] = vendor_df["Vendor"].ffill()

# Group by and aggregate
section_totals = vendor_df.groupby("section_id").agg(...)
```

**Node.js (manual):**
```javascript
// Forward fill
let lastVendor = null;
for (let i = 0; i < vendorData.length; i++) {
    if (vendorData[i].Vendor) lastVendor = vendorData[i].Vendor;
    else if (lastVendor) vendorData[i].Vendor = lastVendor;
}

// Group by and aggregate
const grouped = {};
vendorData.forEach(row => {
    if (!grouped[row.section_id]) grouped[row.section_id] = [];
    grouped[row.section_id].push(row);
});
```

**Key difference:**
- Pandas provides high-level operations
- Node.js requires manual implementation
- Trade-off: More control vs. more code

### 6. Error Handling

**Python (FastAPI):**
```python
from fastapi import HTTPException

raise HTTPException(status_code=400, detail="Error message")
```

**Node.js (Express):**
```javascript
res.status(400).json({ detail: "Error message" });
```

**Key difference:** Both are straightforward, but FastAPI provides automatic OpenAPI docs.

### 7. Vercel Configuration

**Python (vercel.json):**
```json
{
  "builds": [
    {
      "src": "api/index.py",
      "use": "@vercel/python"
    }
  ],
  "functions": {
    "api/index.py": {
      "runtime": "python3.9"
    }
  }
}
```

**Node.js (vercel.json):**
```json
{
  "routes": [
    {
      "src": "/api/(.*)",
      "dest": "/api/index.js"
    }
  ]
}
```

**Key difference:**
- Python requires explicit build configuration
- Node.js uses auto-detection (can omit builds section)

## 🏗 Architecture

```
┌─────────────────┐
│   Frontend       │
│   (Vite/JS)      │
└────────┬─────────┘
         │
         │ HTTP POST /api/process
         │ (multipart/form-data)
         ▼
┌─────────────────┐
│   Vercel        │
│   Serverless    │
│   Function      │
└────────┬─────────┘
         │
         │ api/index.js
         │ (Express.js)
         ▼
┌─────────────────┐
│   Processing    │
│   - Load files  │
│   - Match logic │
│   - Generate    │
│     Excel/CSV   │
└────────┬─────────┘
         │
         │ JSON Response
         │ (base64 files)
         ▼
┌─────────────────┐
│   Frontend      │
│   - Display     │
│   - Download    │
└─────────────────┘
```

## 📡 API Endpoints

### `GET /api/health`
Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "runtime": "nodejs",
  "version": "v22.x.x"
}
```

### `GET /api/test`
Test endpoint to verify dependencies.

**Response:**
```json
{
  "status": "ok",
  "message": "API is working",
  "runtime": "nodejs",
  "xlsx_available": true
}
```

### `POST /api/process`
Main processing endpoint.

**Request:**
- `universal_file` (file): Universal database Excel/CSV
- `vendor_file` (file): Vendor invoice Excel/CSV
- `universal_sheet` (optional string): Sheet name for universal file
- `vendor_sheet` (optional string): Sheet name for vendor file

**Response:**
```json
{
  "updated_universal_excel_b64": "base64_encoded_excel_file",
  "updated_universal_filename": "updated_universal_database.xlsx",
  "matches": [
    {
      "vendor": "Vendor Name",
      "supplier": "Supplier Name",
      "match_type": "exact|substring|fuzzy",
      "score": 100,
      "amount_added": 1234.56
    }
  ],
  "unmatched": [
    {
      "vendor": "Unmatched Vendor",
      "amount": 789.01
    }
  ],
  "unmatched_csv_b64": "base64_encoded_csv_file",
  "unmatched_filename": "unmatched_vendors.csv"
}
```

## 🚀 Deployment

### Prerequisites
- Node.js 22.x
- npm or yarn
- Vercel account

### Steps

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Build frontend:**
   ```bash
   npm run build
   ```

3. **Deploy to Vercel:**
   ```bash
   # Using Vercel CLI
   vercel
   
   # Or connect GitHub repo in Vercel dashboard
   ```

4. **Vercel will automatically:**
   - Detect Node.js runtime
   - Install dependencies
   - Build frontend
   - Deploy serverless functions
   - Configure routes

### Environment Variables

No environment variables required for basic functionality.

## 🐛 Troubleshooting

### Common Issues

1. **"Module not found" errors**
   - Ensure all dependencies are in `package.json`
   - Run `npm install` before deploying

2. **File upload size limits**
   - Default limit: 10MB per file
   - Adjust `MAX_SIZE` in `api/index.js` if needed

3. **Excel parsing errors**
   - Ensure files are valid Excel/CSV format
   - Check sheet names match if using custom sheet names

4. **Fuzzy matching not working**
   - Verify Fuse.js is installed
   - Check similarity threshold (default: 85%)

5. **CORS errors**
   - CORS is enabled for all origins
   - If issues persist, check Vercel function logs

### Debugging

1. **Check Vercel Function Logs:**
   - Vercel Dashboard → Your Project → Functions → View Logs
   - Look for `[DEBUG]` and `[ERROR]` messages

2. **Test endpoints locally:**
   ```bash
   # If you set up local Express server
   node api/index.js
   # Then test with curl or Postman
   ```

3. **Verify file formats:**
   - Ensure Excel files are `.xlsx` format
   - CSV files should be UTF-8 encoded

## 📝 Code Examples

### Normalizing Names

```javascript
function normalizeName(value) {
  const text = String(value).trim().toLowerCase();
  return text
    .replace(/[-_]+/g, ' ')      // hyphens/underscores → spaces
    .replace(/[^\w\s]/g, ' ')    // remove punctuation
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');
}
```

### Parsing Currency Amounts

```javascript
function parseAmount(value) {
  if (!value) return null;
  
  let text = String(value).trim();
  const isNegative = text.startsWith('(') && text.endsWith(')');
  text = text.replace(/^\(|\)$/g, '');
  text = text.replace(/[^\d.\-]/g, '').replace(/,/g, '');
  
  const number = parseFloat(text);
  return isNaN(number) ? null : (isNegative ? -number : number);
}
```

### Fuzzy Matching

```javascript
const fuse = new Fuse(supplierList, {
  threshold: 0.15,  // 85% similarity (100 - 85) / 100
  includeScore: true
});

const results = fuse.search(vendorName);
if (results.length > 0) {
  const match = results[0];
  const score = Math.round((1 - match.score) * 100);
  // Use match.item and score
}
```

## 🔮 Future Improvements

1. **Database Integration**: Store matches in a database for history
2. **User Authentication**: Add login/authentication
3. **Batch Processing**: Process multiple vendor files at once
4. **Match Confidence**: Add confidence scores to all match types
5. **Export Formats**: Support PDF, JSON exports
6. **Real-time Updates**: WebSocket for progress updates
7. **Machine Learning**: Train model for better matching accuracy

## 📚 Resources

- [Vercel Documentation](https://vercel.com/docs)
- [Express.js Guide](https://expressjs.com/)
- [XLSX Library](https://sheetjs.com/)
- [Fuse.js Documentation](https://fusejs.io/)
- [Vite Documentation](https://vitejs.dev/)

## 📄 License

This project is for internal use.

## 👥 Contributors

- Initial Python implementation
- Node.js conversion and optimization

---

**Last Updated:** December 2024
**Version:** 2.0.0 (Node.js)

