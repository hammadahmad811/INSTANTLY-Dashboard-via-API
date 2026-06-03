#!/bin/bash
# start.command — Mac/Linux launcher for Instantly Dashboard
# Double-click this file in Finder to start the dashboard.
# (If macOS blocks it: right-click → Open → Open anyway)

# Change to the folder this script is in
cd "$(dirname "$0")"

echo ""
echo "============================================"
echo "  Instantly Dashboard"
echo "============================================"
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "ERROR: Node.js is not installed."
    echo ""
    echo "Please install Node.js from: https://nodejs.org (LTS version)"
    echo "Then double-click this file again."
    echo ""
    read -p "Press Enter to close..."
    exit 1
fi

# Check required files
if [ ! -f "app.js" ]; then
    echo "ERROR: app.js not found."
    echo "Make sure start.command and app.js are in the same folder."
    echo ""
    read -p "Press Enter to close..."
    exit 1
fi

if [ ! -f "dashboard.html" ]; then
    echo "ERROR: dashboard.html not found."
    echo "Make sure all files are in the same folder."
    echo ""
    read -p "Press Enter to close..."
    exit 1
fi

echo "Starting server... (browser will open automatically)"
echo ""
echo "To stop, press Ctrl+C or close this window."
echo ""

# Start the server (app.js auto-opens the browser)
node app.js
