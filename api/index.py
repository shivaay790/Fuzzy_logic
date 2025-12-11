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

# Create the ASGI adapter (callable)
asgi_adapter = Mangum(fastapi_application, lifespan="off")


def handler(event, context):
    """
    Vercel Python function handler.
    Exposes a plain function so Vercel's detection doesn't try issubclass on an instance.
    """
    return asgi_adapter(event, context)


# Optional: also export ASGI app for compatibility (not used by Vercel function handler)
app = asgi_adapter
