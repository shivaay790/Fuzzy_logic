"""
Vercel serverless function entry point for FastAPI application.
This file wraps the FastAPI app to work with Vercel's serverless environment.

Vercel's Python runtime should automatically detect ASGI applications.
We export the Mangum adapter which wraps FastAPI as an ASGI app.
"""
import sys
import os

# Add parent directory to path so we can import app
current_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(current_dir)

if parent_dir not in sys.path:
    sys.path.insert(0, parent_dir)

from mangum import Mangum
from app import app as fastapi_application

# Create the ASGI adapter - Mangum wraps FastAPI to work with serverless
asgi_app = Mangum(fastapi_application, lifespan="off")

# Export as 'app' - Vercel's ASGI detection looks for this variable name first
# This helps Vercel skip the problematic handler detection that causes issubclass errors
app = asgi_app

# Also export as 'handler' for backward compatibility
# Vercel should detect 'app' as ASGI and use that instead
handler = asgi_app
