#!/bin/bash

# Telegram Bot Quick Start Script

echo "🚀 Starting Telegram Airdrop Bot..."
echo "📊 User Export Configuration:"
echo "  - Interval: ${USER_DATA_EXPORT_INTERVAL:-1h}"
echo "  - Enabled: ${ENABLE_USER_DATA_EXPORT:-true}"
echo ""

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Build TypeScript files
echo "🔨 Building TypeScript files..."
npm run build

# Start the bot
echo "🤖 Starting bot..."
npm start