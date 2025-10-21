FROM node:20-alpine

# Install dependencies for canvas and other native modules
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    cairo-dev \
    jpeg-dev \
    pango-dev \
    musl-dev \
    giflib-dev \
    pixman-dev \
    pangomm-dev \
    libjpeg-turbo-dev \
    freetype-dev \
    pkgconfig

WORKDIR /app

# Copy package files
COPY Telegram-bot/package*.json ./
RUN npm ci --omit=dev

# Copy source code
COPY Telegram-bot/ ./

# Create logs directory
RUN mkdir -p /app/logs

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S telegram -u 1001 -G nodejs && \
    chown -R telegram:nodejs /app

USER telegram

EXPOSE 3001 3002

CMD ["npm", "start"]
