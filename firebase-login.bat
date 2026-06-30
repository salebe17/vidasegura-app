@echo off
echo ========================================
echo   Firebase Login - VidaSegura
echo ========================================
echo.
echo Se abrira tu navegador para autorizar...
echo.
call npx -y firebase-tools login
echo.
echo ========================================
echo   Login completado! Puedes cerrar esta ventana.
echo ========================================
pause
