import './style.css'

// Use /api prefix for Vercel deployment, or localhost for development
const API_BASE = import.meta.env.VITE_API_BASE || (import.meta.env.DEV ? 'http://localhost:8000/api' : '/api')

const app = document.querySelector('#app')

app.innerHTML = `
  <div class="page">
    <header class="hero">
      <div>
        <p class="eyebrow">Vendor Invoice Matcher</p>
        <h1>Update your Universal Database from vendor totals</h1>
        <p class="subtext">Upload the Universal Database and a vendor invoice sheet. We’ll match vendors (exact, substring, fuzzy), sum totals, and return an updated file.</p>
      </div>
    </header>

    <section class="card grid">
      <div class="field">
        <label>Universal Database file (CSV/XLSX)</label>
        <input type="file" id="universalFile" accept=".csv,.xls,.xlsx" />
      </div>
      <div class="field">
        <label>Vendor invoice file (CSV/XLSX)</label>
        <input type="file" id="vendorFile" accept=".csv,.xls,.xlsx" />
      </div>
      <div class="field">
        <label>Universal sheet name (optional)</label>
        <input type="text" id="universalSheet" placeholder="e.g. Sheet1" />
      </div>
      <div class="field">
        <label>Vendor sheet name (optional)</label>
        <input type="text" id="vendorSheet" placeholder="e.g. The Maxwell Hotel" />
      </div>
      <div class="field">
        <label>Matching Method</label>
        <select id="matchingMethod" style="width: 100%; padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px;">
          <option value="fuzzy">Fuzzy Logic (Fuse.js) - Fast & Accurate</option>
          <option value="llm">LLM (Gemini AI) - Intelligent Matching</option>
        </select>
        <small style="display: block; margin-top: 0.25rem; color: #666; font-size: 0.875rem;">
          Choose between fuzzy string matching or AI-powered matching
        </small>
      </div>
      <div class="field">
        <label>Similarity Threshold (0-100)</label>
        <input type="number" id="similarityThreshold" min="0" max="100" value="85" />
        <small style="display: block; margin-top: 0.25rem; color: #666; font-size: 0.875rem;">
          Higher values = stricter matching (default: 85). Lower values = more lenient matching.
        </small>
      </div>
      <div class="actions">
        <button id="processBtn">Process</button>
      </div>
    </section>

    <section class="card status-card">
      <div id="status">Waiting for files...</div>
      <div class="downloads" id="downloads"></div>
    </section>

    <section class="card results" id="results" hidden>
      <div class="result-block">
        <div class="result-header">
          <h2>All Vendor Matches</h2>
          <span id="allMatchesCount" class="pill">0</span>
        </div>
        <div class="table-wrap" id="allMatchesTable"></div>
      </div>
    </section>
  </div>
`

const statusEl = document.getElementById('status')
const downloadsEl = document.getElementById('downloads')
const resultsEl = document.getElementById('results')
const allMatchesTable = document.getElementById('allMatchesTable')
const allMatchesCount = document.getElementById('allMatchesCount')

function setStatus(message, tone = 'info') {
  statusEl.textContent = message
  statusEl.className = `status ${tone}`
}

function base64ToBlob(base64, mime) {
  const bytes = atob(base64)
  const len = bytes.length
  const out = new Uint8Array(len)
  for (let i = 0; i < len; i++) out[i] = bytes.charCodeAt(i)
  return new Blob([out], { type: mime })
}

function renderTable(target, rows, columns, showNumbers = false) {
  if (!rows || rows.length === 0) {
    target.innerHTML = '<p class="muted">No rows</p>'
    return
  }

  const headerCells = showNumbers 
    ? ['<th>#</th>', ...columns.map((c) => `<th>${c.label}</th>`)]
    : columns.map((c) => `<th>${c.label}</th>`)
  const header = headerCells.join('')
  
  const body = rows
    .map((row, index) => {
      const numberCell = showNumbers ? `<td>${index + 1}</td>` : ''
      const tds = columns.map((c) => `<td>${row[c.key] ?? ''}</td>`).join('')
      return `<tr>${numberCell}${tds}</tr>`
    })
    .join('')

  target.innerHTML = `
    <table>
      <thead><tr>${header}</tr></thead>
      <tbody>${body}</tbody>
    </table>
  `
}

async function processFiles() {
  const universalFile = document.getElementById('universalFile').files[0]
  const vendorFile = document.getElementById('vendorFile').files[0]
  const universalSheet = document.getElementById('universalSheet').value.trim()
  const vendorSheet = document.getElementById('vendorSheet').value.trim()
  const similarityThreshold = document.getElementById('similarityThreshold').value
  const matchingMethod = document.getElementById('matchingMethod').value

  if (!universalFile || !vendorFile) {
    setStatus('Please select both files.', 'warn')
    return
  }

  // Validate threshold
  const threshold = parseFloat(similarityThreshold)
  if (isNaN(threshold) || threshold < 0 || threshold > 100) {
    setStatus('Similarity threshold must be a number between 0 and 100.', 'warn')
    return
  }

  const methodName = matchingMethod === 'llm' ? 'Gemini AI' : 'Fuzzy Logic'
  setStatus(`Uploading and processing with ${methodName}...`, 'info')
  downloadsEl.innerHTML = ''
  resultsEl.hidden = true

  const formData = new FormData()
  formData.append('universal_file', universalFile)
  formData.append('vendor_file', vendorFile)
  if (universalSheet) formData.append('universal_sheet', universalSheet)
  if (vendorSheet) formData.append('vendor_sheet', vendorSheet)
  formData.append('similarity_threshold', similarityThreshold)
  formData.append('method', matchingMethod) // 'fuzzy' or 'llm'

  try {
    const res = await fetch(`${API_BASE}/process`, {
      method: 'POST',
      body: formData,
    })

    if (!res.ok) {
      // Clone response to read it multiple times if needed
      const clonedRes = res.clone()
      let errorMessage = `Server error: ${res.status} ${res.statusText}`
      
      try {
        // Try to get error message from response
        const errorText = await res.text()
        if (errorText) {
          try {
            // Try parsing as JSON
            const errorData = JSON.parse(errorText)
            errorMessage = errorData.detail || errorData.message || errorText
          } catch {
            // Not JSON, use text as is
            errorMessage = errorText || errorMessage
          }
        }
      } catch (e) {
        console.error('Failed to read error response:', e)
        // Use status text as fallback
        errorMessage = `Server error: ${res.status} ${res.statusText}`
      }
      
      console.error('API Error:', {
        status: res.status,
        statusText: res.statusText,
        message: errorMessage
      })
      throw new Error(errorMessage)
    }

    const data = await res.json()
    
    console.log('[DEBUG] Received data:', {
      all_matches: data.all_matches?.length || 0
    })

    // Downloads
    const links = []
    if (data.updated_universal_excel_b64) {
      const blob = base64ToBlob(data.updated_universal_excel_b64, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = data.updated_universal_filename || 'updated_universal_database.xlsx'
      a.textContent = 'Download updated Universal Database'
      a.className = 'button link'
      links.push(a)
    }
    downloadsEl.innerHTML = ''
    links.forEach((el) => downloadsEl.appendChild(el))

    // Tables
    // All matches (individual vendor entries matched to closest suppliers)
    const allMatches = (data.all_matches || []).sort((a, b) => {
      // Exact matches first
      if (a.match_type === 'exact' && b.match_type !== 'exact') return -1
      if (a.match_type !== 'exact' && b.match_type === 'exact') return 1
      
      // Then sort by score descending
      const scoreA = a.score || 0
      const scoreB = b.score || 0
      return scoreB - scoreA
    })
    
    // Count all matches (including no_match entries)
    allMatchesCount.textContent = allMatches.length

    // Render all matches table with numbering - sorted by score 100 to 0
    renderTable(allMatchesTable, allMatches, [
      { key: 'vendor', label: 'Vendor' },
      { key: 'supplier', label: 'Supplier' },
      { key: 'match_type', label: 'Type' },
      { key: 'score', label: 'Score' },
    ], true)

    resultsEl.hidden = false
    setStatus('Done. Files ready to download.', 'success')
  } catch (err) {
    console.error(err)
    setStatus(`Error: ${err.message}`, 'error')
  }
}

document.getElementById('processBtn').addEventListener('click', processFiles)
