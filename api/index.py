"""
Vercel serverless function entry point for FastAPI application.
This file wraps the FastAPI app to work with Vercel's serverless environment.
"""
import sys
import os

# Add parent directory to path so we can import app
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from mangum import Mangum
from app import app

# Mangum is an ASGI adapter that allows FastAPI to run on AWS Lambda/Vercel
# Strip /api prefix since Vercel routes /api/* to this handler
# but FastAPI routes are defined without /api prefix
handler = Mangum(app, lifespan="off", strip_base_path="/api")

