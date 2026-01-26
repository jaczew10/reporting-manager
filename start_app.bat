@echo off
:: Change to the script's directory (absolute path)
cd /d "%~dp0"

echo ==========================================
echo      Reporting Manager - Uruchamianie
echo ==========================================

:: 1. Check for Virtual Environment and activate
if exist ".venv\Scripts\activate.bat" (
    echo [INFO] Aktywacja srodowiska wirtualnego...
    call ".venv\Scripts\activate.bat"
) else (
    echo [WARNING] Brak folderu .venv. Probuje uzyc globalnego Pythona.
)

:: 2. Ensure dependencies are installed
echo [INFO] Sprawdzanie bibliotek...
pip install -r backend\requirements.txt

:: 4. Start Server (Blocking, via PowerShell to avoid Batch Terminate prompt)
echo [INFO] Uruchamianie serwera...
echo [TIP]  Aby zamknac, uzyj Ctrl+C
echo.
cd backend
powershell -NoProfile -ExecutionPolicy Bypass -Command "& { . '..\.venv\Scripts\Activate.ps1'; python -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload }"
