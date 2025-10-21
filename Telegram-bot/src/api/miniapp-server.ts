import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import path from 'path';

import { logger } from '../services/logger';
import { config } from '../config';
import { miniappRoutes } from './miniapp-routes';

// Using CommonJS __dirname provided by the build configuration

const app = express();
const PORT = config.server.ports.miniapp;

// CORS Configuration - Only allow trusted origins (similar to old-bot)
const allowedOrigins = [
    config.server.urls.frontend,
    config.server.urls.adminPanel,
    config.server.urls.miniapp,
    'http://localhost:3001',
    'http://localhost:5174',
    'https://localhost:3001',
    'https://localhost:5174'
];

const corsOptions = {
    origin: function (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        
        if (allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            logger.warn(`🚨 CORS: Blocked request from unauthorized origin: ${origin}`);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
};

app.use(cors(corsOptions));

// Security headers
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https:; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://telegram.org https://core.telegram.org; connect-src 'self' https: wss: data:; img-src 'self' data: blob: https:;");
    next();
});

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting middleware
const createRateLimit = (windowMs: number, max: number) => {
    return rateLimit({
        windowMs: windowMs,
        max: max,
        message: {
            success: false,
            message: "Too many requests, please try again later."
        },
        standardHeaders: true,
        legacyHeaders: false,
        handler: (req, res) => {
            logger.warn(`Rate limit exceeded for IP: ${req.ip}`);
            res.status(429).json({
                success: false,
                message: "Too many requests, please try again later."
            });
        }
    });
};

// Apply rate limiting to API routes
app.use('/api/', createRateLimit(15 * 60 * 1000, 100)); // 100 requests per 15 minutes

// Request logging middleware
app.use((req, res, next) => {
    logger.info(`${req.method} ${req.path} - IP: ${req.ip}`);
    next();
});

// API Routes
app.use('/api/miniapp', miniappRoutes);

// Serve static files from miniapp-captcha directory
const miniappPath = path.join(__dirname, '../miniapp-captcha');
app.use(express.static(miniappPath));

// Serve the main miniapp
app.get('/', (req, res) => {
    res.sendFile(path.join(miniappPath, 'index.html'));
});

// Serve the verification page (same as main miniapp)
app.get('/verify', (req, res) => {
    res.sendFile(path.join(miniappPath, 'index.html'));
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        service: 'miniapp-api-server'
    });
});

// Error handling middleware
app.use((error: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    logger.error('Unhandled error:', error);
    res.status(500).json({
        success: false,
        message: 'Internal server error'
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: 'Endpoint not found'
    });
});

// Start server
export function startMiniappServer() {
    return new Promise<void>((resolve, reject) => {
        try {
            app.listen(PORT, () => {
                logger.info(`🚀 MiniApp API Server running on port ${PORT}`);
                logger.info(`📱 MiniApp available at: http://localhost:${PORT}`);
                logger.info(`🔧 API endpoints available at: http://localhost:${PORT}/api/miniapp`);
                resolve();
            });
        } catch (error) {
            logger.error(`❌ Failed to start MiniApp server:`, error);
            reject(error);
        }
    });
}

// Graceful shutdown
process.on('SIGINT', () => {
    logger.info('🛑 Shutting down MiniApp API server gracefully...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    logger.info('🛑 Shutting down MiniApp API server gracefully...');
    process.exit(0);
});

export { app as miniappServer };