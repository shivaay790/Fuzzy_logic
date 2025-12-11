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

from mangum import Mangum
from app import app

# Export the Mangum handler directly
# Vercel's Python runtime should detect this as an ASGI application
handler = Mangum(app, lifespan="off")
