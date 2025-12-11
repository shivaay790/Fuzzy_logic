"""Script to run Streamlit app with ngrok tunnel."""
import subprocess
import sys
import time
from pyngrok import ngrok

# Start Streamlit in background
print("Starting Streamlit app...")
streamlit_process = subprocess.Popen(
    [sys.executable, "-m", "streamlit", "run", "app.py", "--server.port=8501"],
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
)

# Wait a moment for Streamlit to start
time.sleep(3)

# Create ngrok tunnel
print("Creating ngrok tunnel...")
tunnel = ngrok.connect(8501)
public_url = tunnel.public_url
print(f"\n{'='*60}")
print(f"Streamlit app is running!")
print(f"Local URL: http://localhost:8501")
print(f"Public URL: {public_url}")
print(f"{'='*60}\n")
print("Press Ctrl+C to stop both Streamlit and ngrok")

try:
    # Keep the script running
    streamlit_process.wait()
except KeyboardInterrupt:
    print("\nShutting down...")
    ngrok.kill()
    streamlit_process.terminate()
    print("Stopped.")

