/**
 * Vercel serverless function handler
 * This handles API requests for the application
 */

// CORS configuration
const corsConfig = {
  origin: "*",
  credential: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
};

// Helper function to set CORS headers
function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', corsConfig.origin);
  res.setHeader('Access-Control-Allow-Credentials', corsConfig.credential ? 'true' : 'false');
  res.setHeader('Access-Control-Allow-Methods', corsConfig.methods.join(', '));
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

module.exports = async (req, res) => {
  // Set CORS headers
  setCorsHeaders(res);

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Health check endpoint
  if (req.method === 'GET' && (req.url === '/api/health' || req.url === '/health')) {
    return res.status(200).json({ status: 'ok' });
  }

  // Process endpoint - would need to implement the Python logic here
  // For now, return a message indicating the endpoint exists
  if (req.method === 'POST' && (req.url === '/api/process' || req.url === '/process')) {
    return res.status(501).json({ 
      error: 'Not implemented', 
      message: 'This endpoint requires the Python backend. Please use the FastAPI server for processing.' 
    });
  }

  // Default 404
  return res.status(404).json({ error: 'Not found' });
};

