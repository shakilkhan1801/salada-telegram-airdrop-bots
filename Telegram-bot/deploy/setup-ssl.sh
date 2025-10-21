#!/bin/bash

echo "🔐 Setting up SSL certificates..."

# Install certbot if not installed
if ! command -v certbot &> /dev/null; then
    echo "📦 Installing certbot..."
    apt update
    apt install -y certbot python3-certbot-nginx
fi

# Get SSL certificate for gamelabs.space (without www)
echo "📜 Getting SSL for gamelabs.space..."
certbot certonly --standalone -d gamelabs.space \
    --non-interactive --agree-tos --email admin@gamelabs.space \
    --pre-hook "systemctl stop nginx" \
    --post-hook "systemctl start nginx"

# Get SSL certificate for bot.gamelabs.space
echo "📜 Getting SSL for bot.gamelabs.space..."
certbot certonly --standalone -d bot.gamelabs.space \
    --non-interactive --agree-tos --email admin@gamelabs.space \
    --pre-hook "systemctl stop nginx" \
    --post-hook "systemctl start nginx"

echo "✅ SSL certificates installed!"
echo "🔄 Setting up auto-renewal..."
systemctl enable certbot.timer
systemctl start certbot.timer

echo "✅ SSL setup complete!"
