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

try:
    from mangum import Mangum
    from app import app
    
    # Mangum is an ASGI adapter that allows FastAPI to run on AWS Lambda/Vercel
    # Strip /api prefix since Vercel routes /api/* to this handler
    # but FastAPI routes are defined without /api prefix
    handler = Mangum(app, lifespan="off", strip_base_path="/api")
except ImportError as e:
    # If import fails, create a handler that returns the error
    import traceback
    error_detail = traceback.format_exc()
    print(f"Import error: {e}", file=sys.stderr)
    print(error_detail, file=sys.stderr)
    
    def handler(event, context):
        return {
            "statusCode": 500,
            "headers": {"Content-Type": "application/json"},
            "body": f'{{"error": "Import failed", "detail": "{str(e)}"}}'
        }
except Exception as e:
    # For any other initialization error
    import traceback
    error_detail = traceback.format_exc()
    print(f"Initialization error: {e}", file=sys.stderr)
    print(error_detail, file=sys.stderr)
    
    def handler(event, context):
        return {
            "statusCode": 500,
            "headers": {"Content-Type": "application/json"},
            "body": f'{{"error": "Initialization failed", "detail": "{str(e)}"}}'
        }
