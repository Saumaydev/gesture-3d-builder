@echo off
echo ======================================
echo   Starting Backend Server
echo ======================================

cd /d %~dp0




:: Go to backend
cd backend

echo.
echo 🚀 Backend running at: http://localhost:8000
echo 📖 Docs: http://localhost:8000/docs
echo.

:: Start server
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload

pause