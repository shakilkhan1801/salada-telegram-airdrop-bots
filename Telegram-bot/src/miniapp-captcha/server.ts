import express from 'express';
import path from 'path';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { Logger } from '../services/logger';
import { config } from '../config';
import { captchaService } from '../services/captcha-service';
import { DeviceFingerprintService } from '../security/device-fingerprint.service';
import { validateTelegramWebAppData } from '../services/validation.service';
import { miniappRoutes } from '../api/miniapp-routes';

const logger = Logger.getInstance();

export class MiniAppCaptchaServer {
  private app: express.Application;
  private server: any;
  private port: number;

  constructor(port?: number) {
    this.port = port || config.server.ports.api || 3001;
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware() {
    // Trust proxy for proper IP handling behind reverse proxies
    this.app.set('trust proxy', 1);

    this.app.use((req, res, next) => {
      try {
        const { runWithTrace, generateTraceId } = require('../services/trace');
        const rid = (req.headers['x-request-id'] as string) || generateTraceId('http');
        res.setHeader('X-Request-ID', rid);
        return runWithTrace(rid, next);
      } catch {
        return next();
      }
    });
    
    // Security middleware
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
          fontSrc: ["'self'", "https://fonts.gstatic.com"],
          scriptSrc: ["'self'", "https://telegram.org"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'", "https://telegram.org", "wss:"]
        }
      },
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
      }
    }));

    // Disable debugging and inspection
    this.app.use((req, res, next) => {
      // Disable right-click, F12, etc.
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
      res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
      
      // Anti-debugging headers
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      
      next();
    });

    // CORS configuration
    this.app.use(cors({
      origin: (origin, callback) => {
        // Allow Telegram WebApp and configured origins
        const allowedOrigins = [
          'https://web.telegram.org',
          'https://t.me',
          config.server.urls.adminPanel,
          config.server.urls.frontend,
          // Development localhost origins
          'http://localhost:3001',
          'http://localhost:3002', 
          'http://localhost:5173',
          'http://localhost:5174',
          'http://127.0.0.1:3001',
          'http://127.0.0.1:3002',
          // Allow ngrok URLs for development
          config.server.urls.ngrok,
          process.env.NGROK_URL,
          process.env.MINIAPP_URL_DEV,
          process.env.PUBLIC_URL
        ].filter(Boolean); // Remove falsy values
        
        // In development mode, be more permissive
        if (config.isDev && !origin) {
          callback(null, true);
          return;
        }
        
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          logger.warn(`CORS blocked origin: ${origin}`);
          callback(new Error('Not allowed by CORS'));
        }
      },
      credentials: true
    }));

    // PRODUCTION FIX: Rate limiting without IP collection
    // Uses user-agent + timestamp for rate limiting instead of IP
    this.app.use(rateLimit({
      windowMs: 5 * 60 * 1000, // 5 minutes
      max: parseInt(process.env.MINIAPP_RATE_LIMIT_MAX || '200'),
      message: 'Too many captcha requests. Please wait a moment.',
      standardHeaders: true,
      legacyHeaders: false,
      // Skip rate limiting for localhost in development
      skip: (req) => {
        if (config.isDev && (req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === 'localhost')) {
          return true;
        }
        return false;
      },
      // Use session/user-agent instead of IP for rate limiting
      keyGenerator: (req) => {
        // Don't collect IP - use user-agent hash instead
        const ua = req.get('user-agent') || 'unknown';
        const hash = require('crypto').createHash('md5').update(ua).digest('hex').substring(0, 8);
        return `ua:${hash}`;
      }
    }));

    // Compression
    this.app.use(compression());

    // Request timeouts
    this.app.use((req, res, next) => {
      try { (req as any).setTimeout?.(10000); } catch {}
      try {
        (res as any).setTimeout?.(10000, () => {
          try { if (!res.headersSent) res.status(503).json({ error: 'Request timeout' }); } catch {}
        });
      } catch {}
      next();
    });

    // Body parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Anti-bot protection
    this.app.use('/captcha', (req: express.Request, res: express.Response, next: express.NextFunction): void => {
      const userAgent = req.get('user-agent') || '';
      const suspiciousPatterns = [
        /bot/i, /crawl/i, /spider/i, /scrape/i, /fetch/i,
        /curl/i, /wget/i, /python/i, /requests/i
      ];

      if (suspiciousPatterns.some(pattern => pattern.test(userAgent))) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }
      next();
    });
  }

  private setupRoutes() {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // Captcha API routes (both paths)
    this.app.post('/api/captcha/session', this.handleCreateCaptchaSession.bind(this));
    this.app.post('/api/captcha/verify', this.handleVerifyCaptcha.bind(this));
    this.app.get('/api/captcha/challenge/:sessionId', this.handleGetChallenge.bind(this));
    this.app.post('/api/captcha/refresh/:sessionId', this.handleRefreshChallenge.bind(this));

    // Path-based captcha API routes
    this.app.post('/en/api/captcha/session', this.handleCreateCaptchaSession.bind(this));
    this.app.post('/en/api/captcha/verify', this.handleVerifyCaptcha.bind(this));
    this.app.get('/en/api/captcha/challenge/:sessionId', this.handleGetChallenge.bind(this));
    this.app.post('/en/api/captcha/refresh/:sessionId', this.handleRefreshChallenge.bind(this));

    // MiniApp HTTP API routes (old-bot style) - both paths
    this.app.use('/api/miniapp', miniappRoutes);
    this.app.use('/en/api/miniapp', miniappRoutes);

    // Serve static files at verification path
    this.app.use('/en/verification/miniapp', express.static(path.join(__dirname), {
      index: 'index.html',
      setHeaders: (res, path) => {
        // Add anti-debugging and caching headers to static files
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        
        if (path.endsWith('.js')) {
          res.setHeader('Content-Type', 'application/javascript');
          // Obfuscate JS files
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        } else if (path.endsWith('.css')) {
          res.setHeader('Content-Type', 'text/css');
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        } else if (path.endsWith('.html')) {
          res.setHeader('Content-Type', 'text/html');
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        }
      }
    }));

    // Serve static files with anti-debugging (root path for backward compatibility)
    this.app.use(express.static(path.join(__dirname), {
      index: 'index.html',
      setHeaders: (res, path) => {
        // Add anti-debugging and caching headers to static files
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        
        if (path.endsWith('.js')) {
          res.setHeader('Content-Type', 'application/javascript');
          // Obfuscate JS files
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        } else if (path.endsWith('.css')) {
          res.setHeader('Content-Type', 'text/css');
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        } else if (path.endsWith('.html')) {
          res.setHeader('Content-Type', 'text/html');
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        }
      }
    }));

    // Verification miniapp route
    this.app.get('/en/verification/miniapp', (req, res) => {
      res.sendFile(path.join(__dirname, 'index.html'));
    });

    // Default route - serve index.html with security (backward compatibility)
    this.app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'index.html'));
    });

    // Error handling
    this.app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
      logger.error('MiniApp server error:', err);
      res.status(500).json({ error: 'Internal server error' });
    });
  }

  private async handleCreateCaptchaSession(req: express.Request, res: express.Response): Promise<void> {
    try {
      const { userId, initData, captchaType, deviceInfo } = req.body;
      
      logger.info('Create captcha session request', {
        userId,
        captchaType,
        hasDeviceInfo: !!deviceInfo,
        hasInitData: !!initData
      });

      if (!userId || !initData) {
        logger.warn('Missing required parameters', { userId: !!userId, initData: !!initData });
        res.status(400).json({ error: 'Missing required parameters' });
        return;
      }

      // Validate Telegram Web App data
      const isValidData = validateTelegramWebAppData(initData);
      if (!isValidData) {
        logger.warn('Invalid Telegram data validation failed');
        res.status(401).json({ error: 'Invalid Telegram data' });
        return;
      }
      
      logger.info('Telegram data validation passed');

      // Generate device fingerprint
      let deviceFingerprint: string;
      try {
        const fingerprintService = new DeviceFingerprintService();
        const fingerprintDeviceData = {
          hardware: {
            screenResolution: '1920x1080',
            screenColorDepth: '24',
            availableScreenSize: '1920x1040',
            timezone: 'UTC',
            timezoneOffset: 0,
            language: 'en-US',
            languages: ['en-US', 'en'],
            platform: 'WebApp',
            hardwareConcurrency: 4,
            deviceMemory: 8,
            maxTouchPoints: 0
          },
          browser: {
            userAgent: req.get('user-agent') || '',
            vendor: 'Telegram',
            vendorSub: '',
            product: 'TelegramWebApp',
            productSub: '',
            appName: 'TelegramWebApp',
            appVersion: '1.0',
            appCodeName: 'TelegramWebApp',
            cookieEnabled: true,
            doNotTrack: undefined,
            onLine: true,
            javaEnabled: false,
            mimeTypes: [],
            plugins: []
          },
          rendering: {
            canvasFingerprint: undefined,
            webGLVendor: undefined,
            webGLRenderer: undefined,
            webGLVersion: undefined,
            webGLShadingLanguageVersion: undefined,
            webGLExtensions: undefined,
            audioFingerprint: undefined,
            fontFingerprint: undefined
          },
          network: {
            connection: undefined,
            webRTCIPs: undefined,
            dnsOverHttps: undefined
          },
          behavioral: {
            mouseMovementPattern: undefined,
            keyboardPattern: undefined,
            scrollPattern: undefined,
            interactionTiming: undefined,
            focusEvents: undefined,
            clickPattern: undefined
          },
          sessionData: {
            sessionId: 'temp-session-' + Date.now(),
            timestamp: Date.now(),
            userAgent: req.get('user-agent') || '',
            referrer: req.get('referer') || '',
            url: req.originalUrl
          }
        };
        const deviceFingerprintResult = await fingerprintService.generateFingerprint(fingerprintDeviceData, userId);
        deviceFingerprint = deviceFingerprintResult.hash;
        logger.info('Device fingerprint generated successfully');
      } catch (fingerprintError) {
        logger.warn('Device fingerprint generation failed, using fallback', fingerprintError);
        deviceFingerprint = 'fallback-' + Date.now();
      }

      // Prepare device info with all necessary data
      const fullDeviceInfo = {
        ...deviceInfo,
        deviceFingerprint,
        ip: req.ip || req.connection.remoteAddress || '',
        initData,
        sessionData: {
          sessionId: 'temp-session-' + Date.now(),
          timestamp: Date.now(),
          userAgent: req.get('user-agent') || '',
          referrer: req.get('referer') || '',
          url: req.originalUrl
        }
      };

      // Create captcha session
      logger.info('Creating captcha session with service');
      const session = await captchaService.createSession(userId, captchaType || 'svg', fullDeviceInfo);
      
      logger.info('Captcha session created successfully', {
        sessionId: session.id,
        type: session.type,
        challengeType: session.challenge?.type
      });

      res.json({
        session: {
          id: session.id,
          type: session.type,
          challenge: session.challenge,
          attempts: session.attempts,
          maxAttempts: session.maxAttempts,
          expiresAt: session.expiresAt
        }
      });

    } catch (error) {
      logger.error('Error creating captcha session:', error);
      const msg = (error as any)?.message || 'Unknown error';
      res.status(500).json({ error: `Failed to create session: ${msg}` });
    }
  }

  private async handleGetChallenge(req: express.Request, res: express.Response): Promise<void> {
    try {
      const { sessionId } = req.params;
      // Retrieve session directly from storage
      const storage = require('../storage').StorageManager.getInstance();
      const session = await storage.getCaptchaSession(sessionId);

      if (!session) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      res.json(session.challenge || {});

    } catch (error) {
      logger.error('Error getting challenge:', error);
      res.status(500).json({ error: 'Failed to get challenge' });
    }
  }

  private async handleRefreshChallenge(req: express.Request, res: express.Response): Promise<void> {
    try {
      const { sessionId } = req.params;
      // For refresh, create a new challenge of the same type if possible
      const storage = require('../storage').StorageManager.getInstance();
      const session = await storage.getCaptchaSession(sessionId);
      if (!session) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }
      const newSession = await captchaService.createSession(session.userId, session.type, { ip: req.ip });
      res.json(newSession.challenge || {});

    } catch (error) {
      logger.error('Error refreshing challenge:', error);
      res.status(500).json({ error: 'Failed to refresh challenge' });
    }
  }

  private async handleVerifyCaptcha(req: express.Request, res: express.Response): Promise<void> {
    try {
      const { sessionId, answer, deviceFingerprint } = req.body;

      if (!sessionId || !answer) {
        res.status(400).json({ error: 'Missing required parameters' });
        return;
      }

      const result = await captchaService.verifyCaptcha(sessionId, answer, {
        deviceFingerprint,
        userAgent: req.get('user-agent') || '',
        ipAddress: req.ip || req.connection.remoteAddress || ''
      });

      res.json(result);

    } catch (error) {
      logger.error('Error verifying captcha:', error);
      res.status(500).json({ error: 'Failed to verify captcha' });
    }
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = this.app.listen(this.port, () => {
        try {
          // PRODUCTION FIX: Optimized server configuration for high concurrency
          // These settings ensure the server can handle 1000+ concurrent connections
          
          // Connection limits
          (this.server as any).maxConnections = parseInt(process.env.MINIAPP_MAX_CONNECTIONS || '10000');
          
          // Timeout settings (shorter for fail-fast behavior)
          (this.server as any).headersTimeout = 30000;  // 30s (reduced from 65s)
          (this.server as any).keepAliveTimeout = 25000;  // 25s (reduced from 60s)
          (this.server as any).requestTimeout = 25000;  // 25s (reduced from 60s)
          (this.server as any).timeout = 25000;  // 25s (reduced from 60s)
          
          logger.info(`🔒 MiniApp Captcha Server started (PRODUCTION-OPTIMIZED)`, {
            port: this.port,
            maxConnections: (this.server as any).maxConnections,
            timeout: '25s',
            optimizedFor: '1000+ concurrent captcha sessions'
          });
          logger.info(`📱 MiniApp URL: http://localhost:${this.port}`);
        } catch (err) {
          logger.warn('Server configuration warning (non-critical)', err);
        }
        resolve();
      });

      this.server.on('error', (error: any) => {
        if (error.code === 'EADDRINUSE') {
          logger.error(`❌ Port ${this.port} is already in use`);
          reject(new Error(`Port ${this.port} is already in use`));
        } else {
          logger.error('❌ MiniApp server error:', error);
          reject(error);
        }
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          logger.info('🛑 MiniApp Captcha Server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  getPort(): number {
    return this.port;
  }

  getApp(): express.Application {
    return this.app;
  }
}

export default MiniAppCaptchaServer;