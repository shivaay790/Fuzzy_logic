/**
 * Express server with CORS for local development
 * This can serve as a proxy or development server
 */

const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// CORS configuration
const corsConfig = {
  origin: "*",
  credential: true,
  methods: ["GET", "POST", "PUT", "DELETE"]
};

// Handle preflight OPTIONS requests
app.options("*", cors(corsConfig));

// Enable CORS for all routes
app.use(cors(corsConfig));

// Parse JSON bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Fuzzy Match Application',
    status: 'running',
    backend: 'Python FastAPI (api/index.py)',
    frontend: 'Vite app (fuzzy_logic vite/)'
  });
});

// Start server
app.listen(PORT, () => {
  console.log('Fuzzy Match Application');
  console.log('======================');
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('');
  console.log('Backend API: Python FastAPI (api/index.py)');
  console.log('Frontend: Vite app (fuzzy_logic vite/)');
  console.log('');
  console.log('To run locally:');
  console.log('  - Backend: python -m uvicorn app:app --reload');
  console.log('  - Frontend: cd "fuzzy_logic vite" && npm run dev');
  console.log('');
});

module.exports = app;

