// Load environment variables from .env file
require('dotenv').config();

const express = require('express');
const multer = require('multer');
const cors = require('cors');
const XLSX = require('xlsx');
const Fuse = require('fuse.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// Initialize Gemini client if API key is provided
const genAI = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;

// CORS middleware
app.use(cors());
app.use(express.json());

const DEFAULT_SIMILARITY_THRESHOLD = 85;
const MIN_SUBSTRING_LENGTH = 4; // Minimum length for substring matching to avoid false positives

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
 * Check if a string contains another as a complete word (not just substring)
 * @param {string} text - The text to search in
 * @param {string} search - The text to search for
 * @returns {boolean} - True if search appears as a complete word in text
 */
function containsAsWord(text, search) {
  if (!text || !search) return false;
  
  // Early return if search is too short
  if (search.length < MIN_SUBSTRING_LENGTH) return false;
  
  // Split into words
  const textWords = text.split(/\s+/);
  const searchWords = search.split(/\s+/);
  
  // If search is a single word, check if it appears as a complete word in text
  if (searchWords.length === 1) {
    const searchWord = searchWords[0];
    // Must be at least MIN_SUBSTRING_LENGTH characters
    if (searchWord.length < MIN_SUBSTRING_LENGTH) return false;
    
    // Check if it appears as a complete word (word boundary match)
    // This ensures "win" won't match "wine" because of word boundaries
    const wordBoundaryRegex = new RegExp(`\\b${searchWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    return wordBoundaryRegex.test(text);
  }
  
  // If search is multiple words, check if all words appear in order
  if (searchWords.length > 1) {
    // All search words must be at least MIN_SUBSTRING_LENGTH
    if (searchWords.some(word => word.length < MIN_SUBSTRING_LENGTH)) return false;
    
    // Check if all words appear in text in order with word boundaries
    let textIndex = 0;
    for (const searchWord of searchWords) {
      const wordRegex = new RegExp(`\\b${searchWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      const matchIndex = text.substring(textIndex).search(wordRegex);
      if (matchIndex === -1) return false;
      textIndex += matchIndex + searchWord.length;
    }
    return true;
  }
  
  return false;
}

/**
 * Improved substring matching that avoids false positives
 * Only matches if:
 * 1. The shorter string is at least MIN_SUBSTRING_LENGTH characters
 * 2. The shorter string appears as complete words in the longer string
 * 3. Or the strings share significant common words
 */
function smartSubstringMatch(vendorNorm, supplierNorm) {
  if (!vendorNorm || !supplierNorm) return false;
  
  // Early return if either string is too short overall
  if (vendorNorm.length < MIN_SUBSTRING_LENGTH || supplierNorm.length < MIN_SUBSTRING_LENGTH) {
    return false;
  }
  
  const vendorWords = vendorNorm.split(/\s+/).filter(w => w.length >= MIN_SUBSTRING_LENGTH);
  const supplierWords = supplierNorm.split(/\s+/).filter(w => w.length >= MIN_SUBSTRING_LENGTH);
  
  // If either has no qualifying words, skip substring matching
  if (vendorWords.length === 0 || supplierWords.length === 0) return false;
  
  // Check if vendor name contains supplier as words (vendor is longer)
  // Only check if supplier has at least one qualifying word
  if (vendorNorm.length > supplierNorm.length && supplierWords.length > 0) {
    // Reconstruct supplier from qualifying words only
    const supplierQualified = supplierWords.join(' ');
    if (supplierQualified.length >= MIN_SUBSTRING_LENGTH && containsAsWord(vendorNorm, supplierQualified)) {
      return true;
    }
  }
  
  // Check if supplier name contains vendor as words (supplier is longer)
  // Only check if vendor has at least one qualifying word
  if (supplierNorm.length > vendorNorm.length && vendorWords.length > 0) {
    // Reconstruct vendor from qualifying words only
    const vendorQualified = vendorWords.join(' ');
    if (vendorQualified.length >= MIN_SUBSTRING_LENGTH && containsAsWord(supplierNorm, vendorQualified)) {
      return true;
    }
  }
  
  // Check for significant word overlap - require at least 2 words AND they must be meaningful
  // Exclude common words like "foods", "beverages", "inc", "llc", "corp" etc.
  const commonStopWords = ['foods', 'beverages', 'inc', 'llc', 'corp', 'company', 'co', 'ltd', 'limited'];
  const meaningfulVendorWords = vendorWords.filter(w => !commonStopWords.includes(w));
  const meaningfulSupplierWords = supplierWords.filter(w => !commonStopWords.includes(w));
  const commonWords = meaningfulVendorWords.filter(word => meaningfulSupplierWords.includes(word));
  
  // Require at least 2 meaningful words to match (not just generic terms)
  if (commonWords.length >= 2 && meaningfulVendorWords.length >= 2 && meaningfulSupplierWords.length >= 2) {
    return true;
  }
  
  // Check if one is a significant prefix/suffix of the other
  // Only if both have qualifying words
  const minLength = Math.min(vendorNorm.length, supplierNorm.length);
  if (minLength >= MIN_SUBSTRING_LENGTH * 2 && vendorWords.length > 0 && supplierWords.length > 0) {
    // Check prefix match (first MIN_SUBSTRING_LENGTH*2 characters)
    const vendorPrefix = vendorNorm.substring(0, MIN_SUBSTRING_LENGTH * 2);
    const supplierPrefix = supplierNorm.substring(0, MIN_SUBSTRING_LENGTH * 2);
    if (vendorPrefix === supplierPrefix) return true;
    
    // Check suffix match (last MIN_SUBSTRING_LENGTH*2 characters)
    const vendorSuffix = vendorNorm.substring(vendorNorm.length - MIN_SUBSTRING_LENGTH * 2);
    const supplierSuffix = supplierNorm.substring(supplierNorm.length - MIN_SUBSTRING_LENGTH * 2);
    if (vendorSuffix === supplierSuffix) return true;
  }
  
  return false;
}

/**
 * Process matches between vendor and universal databases
 * @param {Array} universalData - Universal database rows
 * @param {Array} vendorData - Vendor invoice rows
 * @param {number} similarityThreshold - Fuzzy matching threshold (0-100)
 */
function processMatches(universalData, vendorData, similarityThreshold = DEFAULT_SIMILARITY_THRESHOLD) {
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
  // BUT: Don't forward-fill rows that look like totals (empty vendor but have Invoice Amount)
  const vendorWork = vendorData.map(row => ({
    Vendor: row.Vendor,
    'Invoice Amount': parseAmount(row['Invoice Amount']),
    _isTotalRow: false // Will mark total rows
  }));
  
  // Forward-fill vendor names, but skip rows that look like totals
  let lastVendor = null;
  for (let i = 0; i < vendorWork.length; i++) {
    const vendorName = String(vendorWork[i].Vendor || '').trim();
    const hasAmount = vendorWork[i]['Invoice Amount'] !== null && vendorWork[i]['Invoice Amount'] !== 0;
    
    if (vendorName) {
      lastVendor = vendorWork[i].Vendor;
    } else if (lastVendor && hasAmount) {
      // This row has an amount but no vendor - it's likely a total row
      // Don't forward-fill it, mark it as a total row
      vendorWork[i]._isTotalRow = true;
    } else if (lastVendor && !hasAmount) {
      // Empty vendor, no amount - might be a header or separator, forward-fill it
      vendorWork[i].Vendor = lastVendor;
    }
  }
  
  // Remove rows without vendor (but keep total rows for now)
  const vendorFiltered = vendorWork.filter(row => row.Vendor && String(row.Vendor).trim() !== '');
  
  // Note: Removed vendorGrouped logic - we only process all_matches now
  
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

  const allMatchesLog = []; // Track all individual vendor entries matched to closest suppliers
  
  console.log('[DEBUG] Processing unique vendors for all_matches');
  let processedCount = 0;
  
  // Process only unique vendors (not every entry) to avoid millions of matches
  // Get unique vendors with their total amount from the row AFTER the last occurrence
  // The total is in the "Invoice Amount" column of the row immediately following the last vendor row
  const uniqueVendorMap = new Map();
  
  // First, find the last occurrence index of each vendor in vendorWork
  // Skip total rows when finding last occurrence
  const lastOccurrenceIndex = new Map();
  for (let i = 0; i < vendorWork.length; i++) {
    const vendorRow = vendorWork[i];
    // Skip total rows and rows without vendor
    if (vendorRow._isTotalRow) continue;
    
    const vendorName = String(vendorRow.Vendor || '').trim();
    if (!vendorName) continue;
    
    const vendorNorm = normalizeName(vendorName);
    lastOccurrenceIndex.set(vendorNorm, i); // Keep updating to get the last occurrence
  }
  
  // Now get the total amount from the row AFTER each vendor's last occurrence
  for (const [vendorNorm, lastIndex] of lastOccurrenceIndex.entries()) {
    const lastVendorRow = vendorWork[lastIndex];
    const vendorName = String(lastVendorRow.Vendor).trim();
    
    // Look for the total row AFTER the last occurrence
    // The total row is the next row that has an Invoice Amount but empty/no vendor
    let totalAmount = 0;
    let foundTotal = false;
    
    // Search forward from the last occurrence to find the total row
    for (let i = lastIndex + 1; i < vendorWork.length; i++) {
      const nextRow = vendorWork[i];
      const nextVendorName = String(nextRow.Vendor || '').trim();
      
      // If we hit another vendor, stop searching
      if (nextVendorName && normalizeName(nextVendorName) !== vendorNorm) {
        break;
      }
      
      // If this row is marked as a total row or has amount but no vendor, it's the total
      if (nextRow._isTotalRow || (!nextVendorName && nextRow['Invoice Amount'] !== null)) {
        const parsedAmount = parseAmount(nextRow['Invoice Amount']);
        if (parsedAmount !== null) {
          totalAmount = parsedAmount;
          foundTotal = true;
          break;
        }
      }
    }
    
    // If no total found, use 0 (or could use sum of individual amounts)
    if (!foundTotal) {
      totalAmount = 0;
    }
    
    // Store unique vendor with total amount from the row after last occurrence
    uniqueVendorMap.set(vendorNorm, {
      name: vendorName,
      amount: totalAmount
    });
  }
  
  // Process each unique vendor once
  const totalUniqueVendors = uniqueVendorMap.size;
  for (const [vendorNorm, vendorData] of uniqueVendorMap.entries()) {
    processedCount++;
    const vendorName = vendorData.name;
    const vendorAmount = vendorData.amount;
    
    // Log progress every 10 unique vendors
    if (processedCount % 10 === 0 || processedCount === totalUniqueVendors) {
      console.log(`[PROGRESS] Processed ${processedCount}/${totalUniqueVendors} unique vendors (${Math.round((processedCount / totalUniqueVendors) * 100)}% complete)`);
    }
    
    // Exact match
    if (supplierIndexMap[vendorNorm]) {
      const idx = supplierIndexMap[vendorNorm][0];
      // For exact match, add it to allMatchesLog
      allMatchesLog.push({
        vendor: vendorName,
        supplier: universalWork[idx].Supplier,
        match_type: 'exact',
        score: 100,
        amount_added: vendorAmount
      });
    } else {
      // Use fuzzy matching to get the BEST match (highest score) only
      if (supplierNormList.length > 0) {
        const fuse = new Fuse(supplierNormList, {
          threshold: 1.0, // Get all matches, we'll take the best one
          includeScore: true,
          minMatchCharLength: 3 // Require at least 3 characters to match
        });
        const results = fuse.search(vendorNorm);
        
        if (results.length > 0) {
          // Take only the BEST match (highest score = lowest Fuse score)
          const bestMatch = results[0];
          const matchedNorm = bestMatch.item;
          const score = Math.round((1 - bestMatch.score) * 100);
          const idx = supplierIndexMap[matchedNorm][0];
          allMatchesLog.push({
            vendor: vendorName,
            supplier: universalWork[idx].Supplier,
            match_type: 'fuzzy',
            score: score,
            amount_added: vendorAmount
          });
        } else {
          // No fuzzy match found, but still show the vendor entry
          allMatchesLog.push({
            vendor: vendorName,
            supplier: null,
            match_type: 'no_match',
            score: 0,
            amount_added: vendorAmount
          });
        }
      } else {
        // No suppliers available, but still show the vendor entry
        allMatchesLog.push({
          vendor: vendorName,
          supplier: null,
          match_type: 'no_match',
          score: 0,
          amount_added: vendorAmount
        });
      }
    }
  }
  
  console.log(`[DEBUG] Created ${allMatchesLog.length} entries in allMatchesLog (processed ${totalUniqueVendors} unique vendors)`);
  
  // Update invoice totals based on allMatchesLog (only for matched vendors)
  for (const match of allMatchesLog) {
    if (match.match_type !== 'no_match' && match.supplier) {
      // Find the supplier index
      const supplierNorm = normalizeName(match.supplier);
      if (supplierIndexMap[supplierNorm]) {
        const idx = supplierIndexMap[supplierNorm][0];
        invoiceTotals[idx] += match.amount_added || 0;
      }
    }
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
    all_matches: allMatchesLog // All individual vendor entries matched to closest suppliers
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

/**
 * Convert data array to CSV string
 */
function dataToCsvString(data) {
  if (!data || data.length === 0) return '';
  const headers = Object.keys(data[0]);
  const rows = data.map(row => 
    headers.map(header => {
      const value = row[header];
      // Escape CSV values (handle commas, quotes, newlines)
      if (value === null || value === undefined) return '';
      const str = String(value);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    }).join(',')
  );
  return [headers.join(','), ...rows].join('\n');
}

/**
 * Process matches using Gemini AI
 * Takes CSV data and uses LLM to match vendors to suppliers
 */
async function processMatchesWithGemini(universalData, vendorData, similarityThreshold = 85) {
  if (!genAI) {
    throw new Error('Gemini API key not configured. Please set GEMINI_API_KEY environment variable.');
  }

  // Available Gemini models (as of 2024):
  // - gemini-3-pro-preview: Intelligent, complex reasoning
  // - gemini-2.5-pro: Complex tasks, 1M token context
  // - gemini-2.5-flash: Fast, balanced intelligence (recommended)
  // - gemini-2.5-flash-lite: Efficient, cost-effective
  // - gemini-2.0-flash: Multimodal, cost-effective
  // - gemini-2.0-flash-lite: Cost-effective (may require paid tier)
  // - gemini-1.5-flash: Free tier compatible (fallback)
  
  // Using gemini-2.5-flash for best balance of speed and accuracy
  // If you hit quota issues, try: gemini-2.0-flash or gemini-1.5-flash
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  // Prepare data summaries for the prompt
  const universalSample = universalData.slice(0, 5).map(row => ({
    Supplier: row.Supplier,
    'Default payment method': row['Default payment method'],
    'Invoice Total': row['Invoice Total']
  }));

  const vendorSample = vendorData.slice(0, 5).map(row => ({
    Vendor: row.Vendor,
    'Invoice Amount': row['Invoice Amount']
  }));

  // Get unique vendors with their total amounts (from row after last occurrence)
  const uniqueVendorMap = new Map();
  const vendorWork = vendorData.map(row => ({
    ...row,
    'Invoice Amount': parseAmount(row['Invoice Amount']),
    _isTotalRow: false
  }));
  
  // Forward-fill vendor names, but skip rows that look like totals
  let lastVendor = null;
  for (let i = 0; i < vendorWork.length; i++) {
    const vendorName = String(vendorWork[i].Vendor || '').trim();
    const hasAmount = vendorWork[i]['Invoice Amount'] !== null && vendorWork[i]['Invoice Amount'] !== 0;
    
    if (vendorName) {
      lastVendor = vendorWork[i].Vendor;
    } else if (lastVendor && hasAmount) {
      // This row has an amount but no vendor - it's likely a total row
      vendorWork[i]._isTotalRow = true;
    } else if (lastVendor && !hasAmount) {
      vendorWork[i].Vendor = lastVendor;
    }
  }
  
  // Find last occurrence of each vendor (skip total rows)
  const lastOccurrenceIndex = new Map();
  for (let i = 0; i < vendorWork.length; i++) {
    if (vendorWork[i]._isTotalRow) continue;
    const vendorName = String(vendorWork[i].Vendor || '').trim();
    if (!vendorName) continue;
    const vendorNorm = normalizeName(vendorName);
    lastOccurrenceIndex.set(vendorNorm, i);
  }
  
  // Get total from row after last occurrence
  for (const [vendorNorm, lastIndex] of lastOccurrenceIndex.entries()) {
    const vendorName = String(vendorWork[lastIndex].Vendor).trim();
    let totalAmount = 0;
    let foundTotal = false;
    
    // Search forward from the last occurrence to find the total row
    for (let i = lastIndex + 1; i < vendorWork.length; i++) {
      const nextRow = vendorWork[i];
      const nextVendorName = String(nextRow.Vendor || '').trim();
      
      // If we hit another vendor, stop searching
      if (nextVendorName && normalizeName(nextVendorName) !== vendorNorm) {
        break;
      }
      
      // If this row is marked as a total row or has amount but no vendor, it's the total
      if (nextRow._isTotalRow || (!nextVendorName && nextRow['Invoice Amount'] !== null)) {
        const parsedAmount = parseAmount(nextRow['Invoice Amount']);
        if (parsedAmount !== null) {
          totalAmount = parsedAmount;
          foundTotal = true;
          break;
        }
      }
    }
    
    uniqueVendorMap.set(vendorNorm, {
      name: vendorName,
      amount: totalAmount
    });
  }

  const uniqueVendors = Array.from(uniqueVendorMap.values()).map(v => v.name);
  const uniqueSuppliers = [...new Set(universalData.map(row => row.Supplier))];

  console.log(`[GEMINI] Processing ${uniqueVendors.length} unique vendors against ${uniqueSuppliers.length} suppliers`);

  // Convert data to CSV format for better LLM processing
  const universalCsv = dataToCsvString(universalData);
  const vendorCsv = dataToCsvString(vendorData);
  
  // Create prompt for Gemini with CSV data
  const prompt = `You are a vendor-supplier matching expert. Your task is to match vendor names from a vendor invoice file to supplier names in a universal database.

UNIVERSAL DATABASE (CSV format - ${universalData.length} suppliers):
\`\`\`csv
${universalCsv.substring(0, 5000)}${universalCsv.length > 5000 ? '\n... (truncated for display)' : ''}
\`\`\`

VENDOR INVOICE (CSV format - ${vendorData.length} rows):
\`\`\`csv
${vendorCsv.substring(0, 5000)}${vendorCsv.length > 5000 ? '\n... (truncated for display)' : ''}
\`\`\`

UNIQUE VENDORS TO MATCH (${uniqueVendors.length}):
${uniqueVendors.map((v, i) => {
  const vendorData = uniqueVendorMap.get(normalizeName(v));
  const amount = vendorData ? vendorData.amount : 0;
  return `${i + 1}. "${v}" (Amount: ${amount})`;
}).join('\n')}

UNIQUE SUPPLIERS AVAILABLE (${uniqueSuppliers.length}):
${uniqueSuppliers.slice(0, 100).map((s, i) => `${i + 1}. "${s}"`).join('\n')}
${uniqueSuppliers.length > 100 ? `... and ${uniqueSuppliers.length - 100} more suppliers` : ''}

INSTRUCTIONS:
1. Match each unique vendor (from the UNIQUE VENDORS list above) to the most appropriate supplier from the universal database
2. Consider:
   - Exact name matches (highest priority, score: 100)
   - Abbreviations (e.g., "LLC" = "Limited Liability Company", "Inc" = "Incorporated")
   - Common variations (e.g., "&" = "and", "Co" = "Company")
   - Similar business names (e.g., "ABC Foods" might match "ABC Food Services")
   - Industry context and business type
   - Partial matches where one name contains the other
3. For each vendor, provide:
   - vendor: The exact vendor name from the UNIQUE VENDORS list
   - supplier: The matched supplier name (must be EXACT name from universal database, case-sensitive)
   - match_type: "exact" (100% match), "fuzzy" (similar but not exact), or "no_match" (no good match found)
   - score: 0-100 (100 for exact, 85-99 for very similar, 70-84 for somewhat similar, <70 for poor matches)
   - amount: The total invoice amount for this vendor (from the vendor data)
4. IMPORTANT: 
   - Only match if confidence score >= ${similarityThreshold}%
   - If no good match exists (score < ${similarityThreshold}%), use match_type: "no_match" and supplier: null
   - The supplier name MUST match exactly (case-sensitive) a supplier from the universal database
   - Return matches for ALL ${uniqueVendors.length} unique vendors

Return ONLY a valid JSON array with this exact format (no markdown, no explanations):
[
  {
    "vendor": "Vendor Name",
    "supplier": "Supplier Name from Universal DB",
    "match_type": "exact|fuzzy|no_match",
    "score": 85,
    "amount": 1234.56
  },
  ...
]

Do not include any explanation, markdown, or additional text. Only return the JSON array.`;

  try {
    console.log('[GEMINI] Sending request to Gemini API...');
    
    // Retry logic for rate limits
    let result;
    let retries = 3;
    let lastError;
    
    while (retries > 0) {
      try {
        result = await model.generateContent(prompt);
        break; // Success, exit retry loop
      } catch (error) {
        lastError = error;
        const errorMessage = error.message || '';
        
        // Check if it's a rate limit error
        if (errorMessage.includes('429') || errorMessage.includes('quota') || errorMessage.includes('rate limit')) {
          retries--;
          if (retries > 0) {
            const waitTime = 15; // Wait 15 seconds
            console.log(`[GEMINI] Rate limit hit. Waiting ${waitTime} seconds before retry (${retries} retries left)...`);
            await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
            continue;
          }
        }
        // If not a rate limit error, throw immediately
        throw error;
      }
    }
    
    if (!result) {
      throw lastError || new Error('Failed to get response from Gemini after retries');
    }
    
    const response = await result.response;
    const text = response.text();
    
    // Clean the response (remove markdown code blocks if present)
    let jsonText = text.trim();
    if (jsonText.startsWith('```json')) {
      jsonText = jsonText.replace(/^```json\n?/, '').replace(/\n?```$/, '');
    } else if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```\n?/, '').replace(/\n?```$/, '');
    }
    
    console.log('[GEMINI] Received response from Gemini');
    const matches = JSON.parse(jsonText);
    
    // Validate and process matches
    const allMatchesLog = [];
    
    // Prepare supplier lookup
    const supplierMap = new Map();
    universalData.forEach((row, idx) => {
      const supplier = row.Supplier;
      if (!supplierMap.has(supplier)) {
        supplierMap.set(supplier, idx);
      }
    });
    
    // Initialize invoice totals
    const invoiceTotals = universalData.map(row => {
      const val = parseAmount(row['Invoice Total']);
      return val !== null ? val : 0;
    });
    const originalInvoiceNulls = universalData.map(row => 
      row['Invoice Total'] === null || row['Invoice Total'] === undefined || String(row['Invoice Total']).trim() === ''
    );
    
    // Process Gemini matches
    for (const match of matches) {
      if (!match.vendor) continue;
      
      const vendorName = match.vendor;
      const supplierName = match.supplier;
      const matchType = match.match_type || 'fuzzy';
      const score = match.score || 0;
      const amount = match.amount || 0;
      
      // Add to allMatchesLog (one entry per vendor)
      if (matchType === 'no_match' || !supplierName) {
        allMatchesLog.push({
          vendor: vendorName,
          supplier: null,
          match_type: 'no_match',
          score: 0,
          amount_added: amount
        });
      } else {
        // Find supplier in universal database
        const supplierIdx = supplierMap.get(supplierName);
        if (supplierIdx !== undefined) {
          invoiceTotals[supplierIdx] += amount;
          
          allMatchesLog.push({
            vendor: vendorName,
            supplier: supplierName,
            match_type: matchType,
            score: score,
            amount_added: amount
          });
        } else {
          // Supplier not found in database
          allMatchesLog.push({
            vendor: vendorName,
            supplier: null,
            match_type: 'no_match',
            score: 0,
            amount_added: amount
          });
        }
      }
    }
    
    // Update invoice totals, preserving nulls
    const updatedUniversal = universalData.map((row, idx) => {
      const updated = { ...row };
      if (originalInvoiceNulls[idx] && invoiceTotals[idx] === 0) {
        updated['Invoice Total'] = null;
      } else {
        updated['Invoice Total'] = invoiceTotals[idx];
      }
      return updated;
    });
    
    return {
      updatedUniversal,
      all_matches: allMatchesLog
    };
    
  } catch (error) {
    console.error('[GEMINI] Error processing with Gemini:', error);
    const errorMessage = error.message || String(error);
    
    // Provide helpful error messages
    if (errorMessage.includes('429') || errorMessage.includes('quota') || errorMessage.includes('rate limit')) {
      throw new Error(`Gemini API quota exceeded. Please wait a few minutes and try again, or upgrade to a paid plan. Error: ${errorMessage.substring(0, 200)}`);
    } else if (errorMessage.includes('API key') || errorMessage.includes('401') || errorMessage.includes('403')) {
      throw new Error(`Gemini API authentication failed. Please check your GEMINI_API_KEY. Error: ${errorMessage.substring(0, 200)}`);
    } else if (errorMessage.includes('gemini-2.0-flash-lite') || errorMessage.includes('gemini-2.5') || errorMessage.includes('gemini-3')) {
      throw new Error(`This model may not be available on the free tier. Try switching to 'gemini-1.5-flash' or 'gemini-2.0-flash', or upgrade to a paid plan.`);
    } else {
      throw new Error(`Gemini API error: ${errorMessage.substring(0, 300)}`);
    }
  }
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
    
    // Matching method: 'fuzzy' (default) or 'llm'/'gemini'
    const methodRaw = (req.body?.method || 'fuzzy').toString().toLowerCase();
    const method = ['llm', 'gemini'].includes(methodRaw) ? 'llm' : 'fuzzy';
    
    // Get similarity threshold from request (default: 85)
    let similarityThreshold = DEFAULT_SIMILARITY_THRESHOLD;
    if (req.body?.similarity_threshold) {
      const threshold = parseFloat(req.body.similarity_threshold);
      if (!isNaN(threshold) && threshold >= 0 && threshold <= 100) {
        similarityThreshold = threshold;
      }
    }
    
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
    
    console.log(`[DEBUG] Processing matches with threshold: ${similarityThreshold}% using ${method.toUpperCase()} method...`);
    let result;
    try {
      if (method === 'llm' || method === 'gemini') {
        // Use Gemini AI for matching
        result = await processMatchesWithGemini(universalData, vendorData, similarityThreshold);
      } else {
        // Use fuzzy logic (Fuse.js) for matching
        result = processMatches(universalData, vendorData, similarityThreshold);
      }
    } catch (error) {
      console.error(`[ERROR] Failed to process matches: ${error.message}`);
      return res.status(400).json({ detail: `Processing error: ${error.message}` });
    }
    
    console.log(`[DEBUG] Processing complete: ${result.all_matches?.length || 0} all matches`);
    
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
      all_matches: result.all_matches || [] // All individual vendor entries matched to closest suppliers
    };
    
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

// Run as standalone server if executed directly
if (require.main === module) {
  const PORT = process.env.PORT || 8000;
  const server = app.listen(PORT, () => {
    console.log(`API server running on http://localhost:${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/api/health`);
    console.log(`Process endpoint: http://localhost:${PORT}/api/process`);
  });
  
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n❌ ERROR: Port ${PORT} is already in use!`);
      console.error(`\nTo fix this, you can:`);
      console.error(`1. Kill the process using port ${PORT}:`);
      console.error(`   Windows PowerShell: Get-Process -Id (Get-NetTCPConnection -LocalPort ${PORT}).OwningProcess | Stop-Process -Force`);
      console.error(`   Or find the process: netstat -ano | findstr :${PORT}`);
      console.error(`\n2. Use a different port by setting PORT environment variable:`);
      console.error(`   $env:PORT=8001; npm run start:api`);
      console.error(`\n3. Or modify the default port in api/index.js\n`);
      process.exit(1);
    } else {
      console.error(`\n❌ Server error: ${err.message}`);
      process.exit(1);
    }
  });
}

