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

# Import and setup
from mangum import Mangum
from app import app

# Mangum is an ASGI adapter that allows FastAPI to run on AWS Lambda/Vercel
# Note: strip_base_path is not available in this Mangum version
# Instead, we handle the /api prefix in FastAPI routes or via middleware
handler = Mangum(app, lifespan="off")
