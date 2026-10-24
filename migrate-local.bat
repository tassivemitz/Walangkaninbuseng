@echo off
REM Local Migration Script for Windows
REM Run this on your local Windows machine

echo ==========================================
echo Infinite Trading Local Migration Helper
echo ==========================================
echo.

echo Choose an option:
echo 1. Migrate GitHub repository to new account
echo 2. Upload database to VPS
echo 3. Both (1 and 2)
echo 4. Exit
echo.

set /p choice="Enter your choice (1-4): "

if "%choice%"=="1" goto github
if "%choice%"=="2" goto upload
if "%choice%"=="3" goto both
if "%choice%"=="4" goto end
goto invalid

:github
echo.
echo ==========================================
echo GitHub Repository Migration
echo ==========================================
echo.

set /p new_username="Enter your NEW GitHub username: "
set /p new_repo="Enter new repository name (default: infinitetrading): "

if "%new_repo%"=="" set new_repo=infinitetrading

echo.
echo Removing old remote...
git remote remove origin

echo.
echo Adding new remote: https://github.com/%new_username%/%new_repo%.git
git remote add origin https://github.com/%new_username%/%new_repo%.git

echo.
echo Verifying remote...
git remote -v

echo.
echo Pushing to new repository...
git push -u origin --all
git push -u origin --tags

echo.
echo ==========================================
echo GitHub Migration Complete!
echo ==========================================
echo.
echo Verify at: https://github.com/%new_username%/%new_repo%
echo.
goto end

:upload
echo.
echo ==========================================
echo Database Upload to VPS
echo ==========================================
echo.

set /p vps_ip="Enter your NEW VPS IP address: "

echo.
echo Uploading database file...
scp "F:\Infinite Trading\data\store.json" root@%vps_ip%:/var/www/infinite-trading/data/

if %errorlevel% equ 0 (
    echo.
    echo ==========================================
    echo Database Upload Complete!
    echo ==========================================
) else (
    echo.
    echo ==========================================
    echo Upload Failed!
    echo ==========================================
    echo.
    echo Make sure:
    echo 1. You have scp installed (Git Bash or OpenSSH)
    echo 2. The VPS IP is correct
    echo 3. You can SSH to the VPS
    echo.
)
goto end

:both
call :github
call :upload
goto end

:invalid
echo.
echo Invalid choice. Please run the script again.
goto end

:end
echo.
echo Press any key to exit...
pause >nul
