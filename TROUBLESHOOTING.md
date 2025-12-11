# Troubleshooting FUNCTION_INVOCATION_FAILED Error

## Current Issue
The API is returning a 500 error with `FUNCTION_INVOCATION_FAILED`. This means the Python serverless function is crashing.

## Steps to Debug

### 1. Check Vercel Logs
Go to your Vercel dashboard → Your Project → Functions tab → View logs
Look for Python errors, import errors, or stack traces.

### 2. Common Causes

#### Import Errors
- `app.py` not found
- Missing dependencies
- Path resolution issues

#### Dependency Issues
- Pandas/numpy compatibility
- Missing system libraries
- Version conflicts

#### Runtime Errors
- Memory limits
- Timeout issues
- File system access

### 3. Test the API Directly

Try accessing these endpoints:
- `https://your-app.vercel.app/api/health` - Should return `{"status": "ok"}`
- `https://your-app.vercel.app/api/test` - Test endpoint (if added)

### 4. Verify Requirements

Make sure `requirements.txt` has:
- All dependencies with versions
- Compatible versions for serverless

### 5. Check the Handler

The `api/index.py` file should:
- Import `app` from the parent directory
- Wrap it with Mangum
- Handle errors gracefully

## Quick Fixes to Try

1. **Simplify the handler** - Remove error handling temporarily to see the actual error
2. **Check Vercel logs** - The actual error will be in the function logs
3. **Test with minimal app** - Create a simple FastAPI app to test if the issue is with dependencies
4. **Verify file structure** - Ensure `app.py` is in the root directory

## Next Steps

1. Check Vercel function logs for the actual error message
2. Share the error from logs so we can fix the specific issue
3. Try deploying with a minimal FastAPI app first to isolate the problem

