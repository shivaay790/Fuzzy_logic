"""
Simple test endpoint to verify Vercel Python functions work
"""
def handler(event, context):
    return {
        "statusCode": 200,
        "headers": {"Content-Type": "application/json"},
        "body": '{"status": "ok", "message": "Test endpoint works"}'
    }

