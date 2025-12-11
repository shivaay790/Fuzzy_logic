"""
Simple health check endpoint to test if Python functions work on Vercel
"""
def handler(request):
    return {
        "statusCode": 200,
        "headers": {"Content-Type": "application/json"},
        "body": '{"status": "ok", "message": "Health check works"}'
    }

