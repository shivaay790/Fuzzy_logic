const express = require('express');
const multer = require('multer');
const cors = require('cors');
const XLSX = require('xlsx');
const Fuse = require('fuse.js');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// CORS middleware
app.use(cors());
app.use(express.json());

const SIMILARITY_THRESHOLD = 85;

/**
 * Normalize supplier/vendor names for comparison
 */
function normalizeName(value) {
  const text = String(value).trim().toLowerCase();
  return text
    .replace(/[-_]+/g, ' ') // treat hyphen/underscore as space
    .replace(/[^\w\s]/g, ' ') // drop punctuation
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');
}

/**
 * Parse currency-like strings into float; returns null if unusable
 */
function parseAmount(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  
  let text = String(value).trim();
  if (text === '') {
    return null;
  }
  
  // Handle parentheses as negative numbers
  const isNegative = text.startsWith('(') && text.endsWith(')');
  text = text.replace(/^\(|\)$/g, '');
  
  // Remove currency symbols and thousands separators
  text = text.replace(/[^\d.\-]/g, '').replace(/,/g, '');
  
  if (text === '' || text === '-' || text === '.' || text === '-.') {
    return null;
  }
  
  const number = parseFloat(text);
  if (isNaN(number)) {
    return null;
  }
  
  return isNegative ? -number : number;
}

/**
 * Load spreadsheet from buffer (CSV or Excel)
 */
function loadSpreadsheet(buffer, filename, sheetName = null) {
  const name = filename.toLowerCase();
  
  if (name.endsWith('.csv')) {
    // For CSV files, read directly as CSV
    const csvString = buffer.toString('utf-8');
    const workbook = XLSX.read(csvString, { type: 'string', raw: false });
    const firstSheetName = workbook.SheetNames[0];
    return XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName], { defval: null });
  } else {
    // For Excel files, read as buffer
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const targetSheet = sheetName || workbook.SheetNames[0];
    if (!workbook.Sheets[targetSheet]) {
      throw new Error(`Sheet "${targetSheet}" not found. Available sheets: ${workbook.SheetNames.join(', ')}`);
    }
    return XLSX.utils.sheet_to_json(workbook.Sheets[targetSheet], { defval: null });
  }
}

/**
 * Process matches between vendor and universal databases
 */
function processMatches(universalData, vendorData) {
  // Check required columns
  const requiredUniversalCols = ['Supplier', 'Default payment method', 'Invoice Total'];
  const requiredVendorCols = ['Vendor', 'Invoice Amount'];
  
  const universalCols = Object.keys(universalData[0] || {});
  const vendorCols = Object.keys(vendorData[0] || {});
  
  const missingUniversal = requiredUniversalCols.filter(col => !universalCols.includes(col));
  const missingVendor = requiredVendorCols.filter(col => !vendorCols.includes(col));
  
  if (missingUniversal.length > 0) {
    throw new Error(`Universal Database missing columns: ${missingUniversal.join(', ')}`);
  }
  
  if (missingVendor.length > 0) {
    throw new Error(`Vendor sheet missing columns: ${missingVendor.join(', ')}`);
  }
  
  // Clean vendor data: forward-fill vendor names and parse amounts
  const vendorWork = vendorData.map(row => ({
    Vendor: row.Vendor,
    'Invoice Amount': parseAmount(row['Invoice Amount'])
  }));
  
  // Forward-fill vendor names
  let lastVendor = null;
  for (let i = 0; i < vendorWork.length; i++) {
    if (vendorWork[i].Vendor && String(vendorWork[i].Vendor).trim() !== '') {
      lastVendor = vendorWork[i].Vendor;
    } else if (lastVendor) {
      vendorWork[i].Vendor = lastVendor;
    }
  }
  
  // Remove rows without vendor
  const vendorFiltered = vendorWork.filter(row => row.Vendor && String(row.Vendor).trim() !== '');
  
  // Group by vendor sections and get last amount per section
  const sectionTotals = {};
  let currentSection = 0;
  let lastVendorInSection = null;
  
  for (let i = 0; i < vendorFiltered.length; i++) {
    const vendor = String(vendorFiltered[i].Vendor).trim();
    if (vendor !== lastVendorInSection) {
      currentSection++;
      lastVendorInSection = vendor;
    }
    
    const sectionKey = `${currentSection}_${vendor}`;
    if (!sectionTotals[sectionKey]) {
      sectionTotals[sectionKey] = {
        Vendor: vendor,
        amounts: []
      };
    }
    
    if (vendorFiltered[i]['Invoice Amount'] !== null) {
      sectionTotals[sectionKey].amounts.push(vendorFiltered[i]['Invoice Amount']);
    }
  }
  
  // Sum amounts per vendor
  const vendorGrouped = {};
  for (const [key, data] of Object.entries(sectionTotals)) {
    if (data.amounts.length > 0) {
      const vendor = data.Vendor;
      const total = data.amounts.reduce((sum, amt) => sum + amt, 0);
      vendorGrouped[vendor] = (vendorGrouped[vendor] || 0) + total;
    }
  }
  
  // Prepare supplier lookup
  const universalWork = universalData.map((row, idx) => ({
    ...row,
    _index: idx,
    _originalInvoiceTotal: row['Invoice Total'],
    _normalizedSupplier: normalizeName(row.Supplier)
  }));
  
  const supplierIndexMap = {};
  const supplierNormList = [];
  
  universalWork.forEach((row, idx) => {
    const norm = row._normalizedSupplier;
    if (!supplierIndexMap[norm]) {
      supplierIndexMap[norm] = [];
      supplierNormList.push(norm);
    }
    supplierIndexMap[norm].push(idx);
  });
  
  // Initialize invoice totals
  const invoiceTotals = universalWork.map(row => {
    const val = parseAmount(row['Invoice Total']);
    return val !== null ? val : 0;
  });
  const originalInvoiceNulls = universalWork.map(row => row['Invoice Total'] === null || row['Invoice Total'] === undefined || String(row['Invoice Total']).trim() === '');
  
  const matchesLog = [];
  const unmatchedLog = [];
  
  // Process each vendor
  for (const [vendorName, amount] of Object.entries(vendorGrouped)) {
    const vendorNorm = normalizeName(vendorName);
    
    // Exact match first
    if (supplierIndexMap[vendorNorm]) {
      const idx = supplierIndexMap[vendorNorm][0];
      invoiceTotals[idx] += amount;
      matchesLog.push({
        vendor: vendorName,
        supplier: universalWork[idx].Supplier,
        match_type: 'exact',
        score: 100,
        amount_added: amount
      });
      continue;
    }
    
    // Substring match
    let substringIdx = null;
    for (const [normName, indices] of Object.entries(supplierIndexMap)) {
      if (vendorNorm && (normName.includes(vendorNorm) || vendorNorm.includes(normName))) {
        substringIdx = indices[0];
        break;
      }
    }
    
    if (substringIdx !== null) {
      invoiceTotals[substringIdx] += amount;
      matchesLog.push({
        vendor: vendorName,
        supplier: universalWork[substringIdx].Supplier,
        match_type: 'substring',
        score: 100,
        amount_added: amount
      });
      continue;
    }
    
    // Fuzzy match fallback
    if (supplierNormList.length > 0) {
      const fuse = new Fuse(supplierNormList, {
        threshold: (100 - SIMILARITY_THRESHOLD) / 100,
        includeScore: true
      });
      
      const results = fuse.search(vendorNorm);
      
      if (results.length > 0 && results[0].score <= (100 - SIMILARITY_THRESHOLD) / 100) {
        const matchedNorm = results[0].item;
        const score = Math.round((1 - results[0].score) * 100);
        const idx = supplierIndexMap[matchedNorm][0];
        invoiceTotals[idx] += amount;
        matchesLog.push({
          vendor: vendorName,
          supplier: universalWork[idx].Supplier,
          match_type: 'fuzzy',
          score: score,
          amount_added: amount
        });
        continue;
      }
    }
    
    // No match found
    unmatchedLog.push({
      vendor: vendorName,
      amount: amount
    });
  }
  
  // Update invoice totals, preserving nulls where original was null and no amount was added
  const updatedUniversal = universalWork.map((row, idx) => {
    const updated = { ...row };
    if (originalInvoiceNulls[idx] && invoiceTotals[idx] === 0) {
      updated['Invoice Total'] = null;
    } else {
      updated['Invoice Total'] = invoiceTotals[idx];
    }
    delete updated._index;
    delete updated._originalInvoiceTotal;
    delete updated._normalizedSupplier;
    return updated;
  });
  
  return {
    updatedUniversal,
    matches: matchesLog,
    unmatched: unmatchedLog
  };
}

/**
 * Convert data to Excel buffer
 */
function toExcelBuffer(data, sheetName = 'Universal Database') {
  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

/**
 * Convert data to CSV buffer
 */
function toCsvBuffer(data) {
  if (data.length === 0) return Buffer.from('');
  const worksheet = XLSX.utils.json_to_sheet(data);
  return Buffer.from(XLSX.utils.sheet_to_csv(worksheet));
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    runtime: 'nodejs',
    version: process.version
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    runtime: 'nodejs',
    version: process.version
  });
});

// Test endpoint
app.get('/api/test', (req, res) => {
  res.json({
    status: 'ok',
    message: 'API is working',
    runtime: 'nodejs',
    version: process.version,
    xlsx_available: true
  });
});

// Shared handler function for processing files
async function handleProcessFiles(req, res) {
  try {
    const universalFile = req.files?.universal_file?.[0];
    const vendorFile = req.files?.vendor_file?.[0];
    const universalSheet = req.body?.universal_sheet || null;
    const vendorSheet = req.body?.vendor_sheet || null;
    
    if (!universalFile || !vendorFile) {
      return res.status(400).json({ detail: 'Both universal_file and vendor_file are required' });
    }
    
    console.log(`[DEBUG] Received files: ${universalFile.originalname}, ${vendorFile.originalname}`);
    console.log(`[DEBUG] File sizes: universal=${universalFile.size} bytes, vendor=${vendorFile.size} bytes`);
    
    // Validate file sizes (10MB limit)
    const MAX_SIZE = 10 * 1024 * 1024;
    if (universalFile.size > MAX_SIZE) {
      return res.status(413).json({ detail: `Universal file too large: ${universalFile.size} bytes (max ${MAX_SIZE})` });
    }
    if (vendorFile.size > MAX_SIZE) {
      return res.status(413).json({ detail: `Vendor file too large: ${vendorFile.size} bytes (max ${MAX_SIZE})` });
    }
    
    console.log('[DEBUG] Loading spreadsheets...');
    let universalData, vendorData;
    try {
      universalData = loadSpreadsheet(universalFile.buffer, universalFile.originalname, universalSheet);
      vendorData = loadSpreadsheet(vendorFile.buffer, vendorFile.originalname, vendorSheet);
    } catch (error) {
      console.error(`[ERROR] Failed to load spreadsheets: ${error.message}`);
      return res.status(400).json({ detail: `Failed to read files: ${error.message}` });
    }
    
    console.log(`[DEBUG] Data loaded: universal=${universalData.length} rows, vendor=${vendorData.length} rows`);
    console.log(`[DEBUG] Universal columns: ${Object.keys(universalData[0] || {}).join(', ')}`);
    console.log(`[DEBUG] Vendor columns: ${Object.keys(vendorData[0] || {}).join(', ')}`);
    
    console.log('[DEBUG] Processing matches...');
    let result;
    try {
      result = processMatches(universalData, vendorData);
    } catch (error) {
      console.error(`[ERROR] Failed to process matches: ${error.message}`);
      return res.status(400).json({ detail: `Processing error: ${error.message}` });
    }
    
    console.log(`[DEBUG] Processing complete: ${result.matches.length} matches, ${result.unmatched.length} unmatched`);
    
    console.log('[DEBUG] Creating Excel file...');
    let excelBuffer;
    try {
      excelBuffer = toExcelBuffer(result.updatedUniversal, universalSheet || 'Universal Database');
    } catch (error) {
      console.error(`[ERROR] Failed to create Excel: ${error.message}`);
      return res.status(500).json({ detail: `Failed to create output file: ${error.message}` });
    }
    
    const response = {
      updated_universal_excel_b64: excelBuffer.toString('base64'),
      updated_universal_filename: 'updated_universal_database.xlsx',
      matches: result.matches,
      unmatched: result.unmatched
    };
    
    if (result.unmatched.length > 0) {
      try {
        const csvBuffer = toCsvBuffer(result.unmatched);
        response.unmatched_csv_b64 = csvBuffer.toString('base64');
        response.unmatched_filename = 'unmatched_vendors.csv';
      } catch (error) {
        console.warn(`[WARN] Failed to create CSV: ${error.message}`);
      }
    }
    
    console.log('[DEBUG] Returning response');
    res.json(response);
  } catch (error) {
    console.error(`[ERROR] Unexpected error: ${error.message}`);
    console.error(error.stack);
    res.status(500).json({ detail: `Server error: ${error.message}` });
  }
}

// Main processing endpoint
app.post('/api/process', upload.fields([
  { name: 'universal_file', maxCount: 1 },
  { name: 'vendor_file', maxCount: 1 }
]), handleProcessFiles);

// Also support /process for local development
app.post('/process', upload.fields([
  { name: 'universal_file', maxCount: 1 },
  { name: 'vendor_file', maxCount: 1 }
]), handleProcessFiles);

// Export for Vercel serverless
module.exports = app;

