#!/bin/bash

# sync_data.sh
# This script triggers a sync with the SFC API via the local backend,
# copies the resulting data.json to the public directory, and pushes it to GitHub.

# Ensure we're in the right directory
REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_DIR" || exit 1

echo "Triggering SFC data sync via local backend..."
# Hit the local backend's sync endpoint to ensure the data is fresh
curl -s -X POST http://localhost:3068/api/production/sync > /dev/null

echo "Copying data.json to public directory..."
# Copy the updated data.json to the public folder so Vite serves it statically
cp data.json public/data.json

# Basic validation
if grep -q "workOrders" public/data.json; then
    echo "Data fetched and copied successfully."
    
    # Check if there are changes
    if git diff --quiet public/data.json; then
        echo "No changes detected. Skipping commit."
    else
        echo "Changes detected. Committing to GitHub..."
        git add public/data.json
        git commit -m "chore(data): auto-update dashboard data for $(date +"%Y-%m-%d %H:%M")"
        git push origin main
        echo "Push complete! Vercel will now rebuild."
    fi
else
    echo "Failed to validate data.json."
    exit 1
fi
