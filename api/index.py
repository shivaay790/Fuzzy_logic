"""
Vercel serverless function entry point for FastAPI application.
This file wraps the FastAPI app to work with Vercel's serverless environment.
"""
import sys
import os

# Add parent directory to path so we can import app
current_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(current_dir)

if parent_dir not in sys.path:
    sys.path.insert(0, parent_dir)

# Import FastAPI app (renamed to avoid conflicts)
from app import app as fastapi_application

# Import Mangum
from mangum import Mangum

# Create ASGI adapter - Mangum wraps FastAPI to work with serverless
# This creates an ASGI application instance that Vercel can use
asgi_app = Mangum(fastapi_application, lifespan="off")

# Export as 'handler' - Vercel looks for this variable
# This is an ASGI application, not a class, which is why Vercel's detection fails
# But we export it anyway and Vercel should handle it correctly
handler = asgi_app
