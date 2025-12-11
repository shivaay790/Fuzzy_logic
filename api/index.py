"""
Vercel serverless function entry point for the FastAPI application.
Expose the FastAPI ASGI app directly; Vercel automatically wraps ASGI apps.
"""
import sys
import os

# Add parent directory to path so we can import app.py
current_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(current_dir)

if parent_dir not in sys.path:
    sys.path.insert(0, parent_dir)

try:
    from app import app as fastapi_app
except ImportError as e:
    # Fallback for debugging
    import traceback
    print(f"Import error: {e}")
    traceback.print_exc()
    raise

# Vercel detects ASGI apps when exported as `app`
# The path that reaches FastAPI will include /api prefix
app = fastapi_app

# Alias for environments that look for `handler`
handler = fastapi_app

