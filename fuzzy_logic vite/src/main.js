import './style.css'

// Use /api prefix for Vercel deployment, or localhost for development
const API_BASE = import.meta.env.VITE_API_BASE || (import.meta.env.DEV ? 'http://localhost:8000' : '/api')

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
          <h2>Matches</h2>
          <span id="matchCount" class="pill">0</span>
        </div>
        <div class="table-wrap" id="matchesTable"></div>
      </div>
      <div class="result-block">
        <div class="result-header">
          <h2>Unmatched Vendors</h2>
          <span id="unmatchedCount" class="pill pill-warn">0</span>
        </div>
        <div class="table-wrap" id="unmatchedTable"></div>
      </div>
    </section>
  </div>
`

const statusEl = document.getElementById('status')
const downloadsEl = document.getElementById('downloads')
const resultsEl = document.getElementById('results')
const matchesTable = document.getElementById('matchesTable')
const unmatchedTable = document.getElementById('unmatchedTable')
const matchCount = document.getElementById('matchCount')
const unmatchedCount = document.getElementById('unmatchedCount')

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

function renderTable(target, rows, columns) {
  if (!rows || rows.length === 0) {
    target.innerHTML = '<p class="muted">No rows</p>'
    return
  }

  const header = columns.map((c) => `<th>${c.label}</th>`).join('')
  const body = rows
    .map((row) => {
      const tds = columns.map((c) => `<td>${row[c.key] ?? ''}</td>`).join('')
      return `<tr>${tds}</tr>`
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

  if (!universalFile || !vendorFile) {
    setStatus('Please select both files.', 'warn')
    return
  }

  setStatus('Uploading and processing...', 'info')
  downloadsEl.innerHTML = ''
  resultsEl.hidden = true

  const formData = new FormData()
  formData.append('universal_file', universalFile)
  formData.append('vendor_file', vendorFile)
  if (universalSheet) formData.append('universal_sheet', universalSheet)
  if (vendorSheet) formData.append('vendor_sheet', vendorSheet)

  try {
    const res = await fetch(`${API_BASE}/process`, {
      method: 'POST',
      body: formData,
    })

    if (!res.ok) {
      let errorMessage = `Server error: ${res.status} ${res.statusText}`
      try {
        const errorData = await res.json()
        errorMessage = errorData.detail || errorData.message || errorMessage
      } catch (e) {
        // If response isn't JSON, try text
        try {
          const errorText = await res.text()
          if (errorText) {
            // Try to parse as JSON
            try {
              const parsed = JSON.parse(errorText)
              errorMessage = parsed.detail || parsed.message || errorText
            } catch {
              errorMessage = errorText || errorMessage
            }
          }
        } catch (e2) {
          console.error('Failed to read error response:', e2)
        }
      }
      console.error('API Error:', {
        status: res.status,
        statusText: res.statusText,
        message: errorMessage
      })
      throw new Error(errorMessage)
    }

    const data = await res.json()

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
    if (data.unmatched_csv_b64) {
      const blob = base64ToBlob(data.unmatched_csv_b64, 'text/csv')
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = data.unmatched_filename || 'unmatched_vendors.csv'
      a.textContent = 'Download unmatched vendors log'
      a.className = 'button ghost'
      links.push(a)
    }
    downloadsEl.innerHTML = ''
    links.forEach((el) => downloadsEl.appendChild(el))

    // Tables
    const matches = data.matches || []
    const unmatched = data.unmatched || []
    matchCount.textContent = matches.length
    unmatchedCount.textContent = unmatched.length

    renderTable(matchesTable, matches, [
      { key: 'vendor', label: 'Vendor' },
      { key: 'supplier', label: 'Supplier' },
      { key: 'match_type', label: 'Type' },
      { key: 'score', label: 'Score' },
      { key: 'amount_added', label: 'Amount Added' },
    ])

    renderTable(unmatchedTable, unmatched, [
      { key: 'vendor', label: 'Vendor' },
      { key: 'amount', label: 'Amount' },
    ])

    resultsEl.hidden = false
    setStatus('Done. Files ready to download.', 'success')
  } catch (err) {
    console.error(err)
    setStatus(`Error: ${err.message}`, 'error')
  }
}

document.getElementById('processBtn').addEventListener('click', processFiles)
