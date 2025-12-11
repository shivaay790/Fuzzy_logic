"""
Vercel serverless function entry point for the FastAPI application.
Using Mangum with a function handler to avoid Vercel's handler detection issues.
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
    import traceback
    print(f"Import error: {e}", file=sys.stderr)
    traceback.print_exc(file=sys.stderr)
    raise

# Import Mangum at module level
from mangum import Mangum

# Create Mangum adapter instance
asgi_adapter = Mangum(fastapi_app, lifespan="off")

# Export as a function handler - this avoids the issubclass check
# Vercel expects a callable function, not a class instance
def handler(event, context):
    """
    AWS Lambda-style handler function.
    This function format avoids Vercel's problematic issubclass check.
    """
    return asgi_adapter(event, context)

# Also export the app for ASGI autodetection (fallback)
app = fastapi_app
