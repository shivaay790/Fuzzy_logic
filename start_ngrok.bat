@echo off
echo Installing/Updating pyngrok...
pip install pyngrok

echo.
echo Starting Streamlit with ngrok...
python run_with_ngrok.py

pause

