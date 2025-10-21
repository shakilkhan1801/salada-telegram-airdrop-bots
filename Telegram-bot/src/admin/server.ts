import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { rateLimitingService } from '../services/security/rate-limiting.service';
import path from 'path';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import fs from 'fs-extra';
import { config } from '../config';
import { ObjectId } from 'mongodb';
import { logger } from '../services/logger';
import { SystemStatsService } from '../services/admin/system-stats.service';
import { PointsHandler } from '../bot/handlers/points-handler';
import { BroadcastQueueService } from '../services/broadcast-queue.service';
import { storage } from '../storage';
import { TelegramNotifyService } from '../services/telegram-notify.service';
import UserDataExportService from '../services/user-data-export.service';
import { MaintenanceMiddleware } from '../bot/middleware/maintenance.middleware';
import SimpleUserExportScheduler from '../services/simple-user-export-scheduler.service';
import { RedisDistributedCacheService } from '../services/redis-distributed-cache.service';
import { fetchLogs, resolveLogFile, deleteLogs } from '../services/log-viewer.service';
import { databaseErrorLogger } from '../services/database-error-logger.service';
import { botResponseMonitor } from '../services/bot-response-monitor.service';

const parseDurationMs = (v?: string | number): number => {
  if (v === undefined || v === null) return 0;
  if (typeof v === 'number') return v;
  const m = String(v).trim().match(/^(\d+)\s*(ms|s|m|h|d)?$/i);
  if (!m) return 0;
  const n = parseInt(m[1], 10);
  const u = (m[2] || 'ms').toLowerCase();
  if (u === 'ms') return n;
  if (u === 's') return n * 1000;
  if (u === 'm') return n * 60 * 1000;
  if (u === 'h') return n * 60 * 60 * 1000;
  if (u === 'd') return n * 24 * 60 * 60 * 1000;
  return n;
};

export interface AdminServerOptions {
  port?: number;
  corsOrigins?: string[];
}

export class AdminServer {
  private app: express.Express;
  private options: Required<AdminServerOptions>;
  private httpServer: any;
  private initialized = false;
  private stats = new SystemStatsService();

  constructor(opts?: AdminServerOptions) {
    this.app = express();
    this.options = {
      port: opts?.port ?? (config.server.ports.admin || 3002),
      corsOrigins: opts?.corsOrigins ?? (config.admin.corsOrigins || ['http://localhost:3000', 'http://localhost:5173'])
    };
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    if (config.admin.trustProxy) this.app.set('trust proxy', true);

    this.app.use(helmet({
      contentSecurityPolicy: false
    } as any));
    this.app.use(compression());

    const selfOrigins = [
      `http://localhost:${this.options.port}`,
      `http://127.0.0.1:${this.options.port}`,
      `http://[::1]:${this.options.port}`,
      `https://localhost:${this.options.port}`,
      `https://127.0.0.1:${this.options.port}`
    ];

    const corsAllowed = new Set([
      ...this.options.corsOrigins,
      ...selfOrigins,
      config.server.urls.frontend,
      config.server.urls.adminPanel,
      config.server.urls.miniapp,
      'http://localhost:5173',
      'http://localhost:5174',
      'http://localhost:3000',
      'http://localhost:3001'
    ].filter(Boolean));

    this.app.use(cors({
      origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        if (corsAllowed.has(origin)) return cb(null, true);
        
        // Allow requests from any IP with port 3002 (VPS access)
        if (origin) {
          const url = new URL(origin);
          if (url.port === '3002' || url.pathname.includes('/admin')) {
            return cb(null, true);
          }
          
          // Allow requests from common VPS/server ports
          const allowedPorts = ['3002', '3000', '3001', '5173', '5174', '8080', '80', '443'];
          if (allowedPorts.includes(url.port) || url.protocol === 'https:') {
            return cb(null, true);
          }
        }
        
        return cb(new Error('Not allowed by CORS'));
      },
      credentials: true
    }));

    this.app.use(express.json({ limit: '2mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '2mb' }));
    this.app.use(cookieParser());

    // Initialize enterprise rate limiting service with IPv6 support
    rateLimitingService.updateSecurityConfig({
      trustProxy: config.admin.trustProxy || false,
      enableIPv6: true,
      enableFingerprinting: true,
      securityHeaders: true,
      enableSecurityLogging: true,
      whitelist: ['127.0.0.1', '::1'] // Local addresses
    });

    // Create IPv6-safe rate limiting policy for admin endpoints
    const policies = rateLimitingService.getPredefinedPolicies();
    const limiter = rateLimitingService.createRateLimit({
      ...policies.adminStrict,
      maxRequests: config.rateLimit.maxRequests || 100,
      windowMs: 60_000, // 1 minute window
    });
    this.app.use('/api', limiter);

    this.registerApiRoutes();
    this.registerStatic();

    this.app.get('/health', async (_req, res) => {
      try {
        const health = await storage.healthCheck();
        res.json({ status: 'ok', adminPort: this.options.port, storage: health });
      } catch (e) {
        res.status(500).json({ status: 'error' });
      }
    });

    this.app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      logger.error('Admin API error', { message: err?.message });
      res.status(500).json({ success: false, message: 'Internal server error' });
    });

    this.initialized = true;
  }

  async start(): Promise<void> {
    if (!this.initialized) await this.initialize();
    await new Promise<void>((resolve) => {
      this.httpServer = this.app.listen(this.options.port, () => {
        logger.info(`Admin server listening on ${this.options.port}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (this.httpServer) {
      await new Promise<void>((resolve) => this.httpServer.close(() => resolve()));
      this.httpServer = null;
    }
  }

  getApp() {
    return this.app;
  }

  getOptions() {
    return this.options;
  }

  isServerInitialized() {
    return this.initialized;
  }

  getServerStats() {
    return { adminServer: true, port: this.options.port } as any;
  }

  private registerApiRoutes() {
    const router = express.Router();

    // Prevent caching on all Admin API responses
    router.use((_req, res, next) => {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
      next();
    });

    const requireAuth: express.RequestHandler = (req, res, next) => {
      try {
        const header = req.headers.authorization || '';
        const token = header.startsWith('Bearer ') ? header.slice(7) : (req.cookies?.admin_token as string | undefined);
        if (!token) { res.status(401).json({ success: false, message: 'Unauthorized' }); return; }
        const payload = jwt.verify(token, config.jwt.secret as unknown as import('jsonwebtoken').Secret) as any;
        (req as any).admin = payload;
        next();
      } catch {
        res.status(401).json({ success: false, message: 'Unauthorized' }); return;
      }
    };

    const roleOrder: Record<string, number> = { viewer: 1, moderator: 2, admin: 3, super_admin: 4 };
    const requireRole = (minRole: 'viewer' | 'moderator' | 'admin' | 'super_admin'): express.RequestHandler => (req, res, next) => {
      try {
        const role = (((req as any).admin?.role) || 'viewer') as keyof typeof roleOrder;
        if (roleOrder[role] >= roleOrder[minRole]) return next();
      } catch {}
      res.status(403).json({ success: false, message: 'Forbidden' });
    };

    router.get('/logs', requireRole('viewer'), async (req, res) => {
      try {
        const type = req.query.type === 'error' ? 'error' : 'app';
        const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
        const search = typeof req.query.search === 'string' ? req.query.search.trim() : undefined;
        const sinceParam = typeof req.query.since === 'string' ? req.query.since.trim() : undefined;
        const since = sinceParam ? new Date(sinceParam) : undefined;

        // For error logs, fetch from database (ALWAYS error level only)
        if (type === 'error') {
          const { entries, total } = await databaseErrorLogger.getErrors({ limit, search, since });
          // Force all entries to be error level only
          const errorEntries = entries.filter(e => e.level === 'error');
          const result = {
            entries: errorEntries.map(e => ({
              timestamp: e.timestamp,
              level: 'error',
              message: e.message,
              context: e.context,
              raw: { ...e.raw, stack: e.stack, id: e.id }
            })),
            hasMore: total > errorEntries.length,
            fileSize: 0,
            updatedAt: errorEntries.length > 0 ? errorEntries[0].timestamp : null,
            file: 'database'
          };
          res.json({ success: true, data: result });
        } else {
          // For app logs, use file-based approach
          const levelParam = typeof req.query.levels === 'string' ? req.query.levels : '';
          const levels = levelParam ? levelParam.split(',').map((lvl) => lvl.trim()).filter(Boolean) : undefined;
          const result = await fetchLogs({ type, levels, limit, search, since });
          res.json({ success: true, data: result });
        }
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to load logs' });
      }
    });

    router.get('/logs/download', requireRole('viewer'), async (req, res) => {
      try {
        const type = req.query.type === 'error' ? 'error' : 'app';
        const file = resolveLogFile(type);
        const exists = await fs.pathExists(file.path);
        if (!exists) {
          res.status(404).json({ success: false, message: 'Log file not found' });
          return;
        }
        const downloadName = `${file.name.replace('.log', '')}-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
        const stream = fs.createReadStream(file.path);
        stream.on('error', () => {
          res.status(500).end();
        });
        stream.pipe(res);
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to download logs' });
      }
    });

    router.post('/logs/delete', requireAuth, requireRole('moderator'), async (req, res) => {
      try {
        const body = req.body || {};
        const type = body.type === 'error' ? 'error' : 'app';
        
        // For error logs, delete from database using IDs
        if (type === 'error') {
          const ids = Array.isArray(body.ids) ? body.ids.filter((id: any) => typeof id === 'string') : [];
          if (ids.length === 0) {
            res.status(400).json({ success: false, message: 'No IDs provided' });
            return;
          }
          const deleted = await databaseErrorLogger.deleteErrors(ids);
          logger.info(`Admin deleted ${deleted} error log entries from database`, { admin: (req as any).admin?.username });
          res.json({ success: true, deleted });
        } else {
          // For app logs, use file-based deletion
          const timestamps = Array.isArray(body.timestamps) ? body.timestamps.filter((t: any) => typeof t === 'string') : [];
          if (timestamps.length === 0) {
            res.status(400).json({ success: false, message: 'No timestamps provided' });
            return;
          }
          const result = await deleteLogs(type, timestamps);
          logger.info(`Admin deleted ${result.deleted} log entries from ${type}.log`, { admin: (req as any).admin?.username });
          res.json({ success: true, deleted: result.deleted });
        }
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to delete logs' });
      }
    });

    // Health/status routes for admin panel
    router.get('/health', async (_req, res) => {
      try {
        const health = await storage.healthCheck();
        res.json({ success: true, status: 'ok', storage: health });
      } catch (e: any) {
        res.status(500).json({ success: false, status: 'error', message: e?.message || 'health check failed' });
      }
    });
    router.get('/status', async (_req, res) => {
      try {
        res.json({ success: true, status: 'online', time: new Date().toISOString() });
      } catch (e: any) {
        res.status(500).json({ success: false, status: 'error' });
      }
    });

    // Public routes
    router.post('/login/request', async (req, res) => {
      try {
        const { username, password, deviceFingerprint } = req.body || {};

        // Generate one-time credentials if not provided
        const genUsername = () => `admin-${Math.random().toString(36).slice(2, 6)}${Math.floor(Math.random()*90+10)}`;
        const genPassword = () => crypto.randomBytes(12).toString('base64url').replace(/[^A-Za-z0-9]/g, '').slice(0, 12) + Math.floor(Math.random()*90+10);

        const u = (username && String(username).trim()) || genUsername();
        const p = (password && String(password)) || genPassword();

        const requestId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || '';

        const hashed = await bcrypt.hash(p, 10);
        await storage.set('admin_login_requests', {
          id: requestId,
          username: u,
          hashedPassword: hashed,
          generated: !username || !password,
          ip,
          deviceFingerprint: deviceFingerprint || null,
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString()
        }, requestId);

        const lines = [
          '🔐 Admin Panel Login Request',
          `Username: <b>${u}</b>`,
          `Password: <code>${p}</code>`,
          ip ? `IP: <code>${ip}</code>` : '',
          deviceFingerprint ? `Device: <code>${deviceFingerprint}</code>` : '',
          `Time: ${new Date().toLocaleString()}`
        ].filter(Boolean);

        await TelegramNotifyService.sendToAdmins(lines.join('\n'));

        res.json({ success: true, requestId });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to send login request' });
      }
    });

    router.post('/auth/login', async (req, res) => {
      try {
        const { username, password } = req.body || {};
        if (!username || !password) {
          res.status(400).json({ success: false, message: 'Username and password are required' }); return;
        }

        // Try ephemeral credentials first (must have recent request and match)
        const recentWindowMs = 10 * 60 * 1000;
        let matchedRequest: any | null = null;
        try {
          const ids = await storage.list('admin_login_requests');
          for (const id of ids) {
            const reqItem = await storage.get<any>('admin_login_requests', id);
            if (!reqItem) continue;
            if (reqItem.username === username) {
              const ts = new Date(reqItem.createdAt).getTime();
              if (!isNaN(ts) && Date.now() - ts <= recentWindowMs) {
                const hashed = reqItem.hashedPassword as string | undefined;
                const plain = reqItem.password as string | undefined;
                const ok = hashed ? await bcrypt.compare(String(password), hashed) : (plain === String(password));
                if (ok) { matchedRequest = { ...reqItem, id }; break; }
              }
            }
          }
        } catch {}

        if (matchedRequest) {
          const payload = { username, role: 'super_admin', method: 'ephemeral' };
          const token = jwt.sign(payload, config.jwt.secret as unknown as import('jsonwebtoken').Secret, { expiresIn: (config.jwt.adminExpiresIn || '24h') as any });
          const isProd = process.env.NODE_ENV === 'production';
          const ttlMs = parseDurationMs(config.jwt.adminExpiresIn) || 24 * 60 * 60 * 1000;
          res.cookie('admin_token', token, { httpOnly: true, secure: isProd, sameSite: 'strict', maxAge: ttlMs });
          // Mark as used
          try { await storage.update('admin_login_requests', { usedAt: new Date().toISOString() }, matchedRequest.id); } catch {}
          res.json({ success: true, token, user: { username, role: 'super_admin' } }); return;
        }

        // Fallback: persistent admin credentials
        const admins = await storage.listAdminUsers();
        const admin = admins.find(a => a.username?.toLowerCase() === String(username).toLowerCase());
        if (!admin || !admin.isActive) {
          res.status(401).json({ success: false, message: 'Invalid credentials' });
          return;
        }

        const ok = await bcrypt.compare(String(password), admin.hashedPassword);
        if (!ok) {
          res.status(401).json({ success: false, message: 'Invalid credentials' });
          return;
        }

        const payload = { id: admin.id, username: admin.username, role: admin.role, method: 'persistent' };
        const token = jwt.sign(payload, config.jwt.secret as unknown as import('jsonwebtoken').Secret, { expiresIn: (config.jwt.adminExpiresIn || '24h') as any });
        const isProd = process.env.NODE_ENV === 'production';
        const ttlMs = parseDurationMs(config.jwt.adminExpiresIn) || 24 * 60 * 60 * 1000;
        res.cookie('admin_token', token, { httpOnly: true, secure: isProd, sameSite: 'strict', maxAge: ttlMs });
        res.json({ success: true, token, user: { id: admin.id, username: admin.username, role: admin.role } }); return;
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Login failed' });
      }
    });

    router.get('/auth/me', requireAuth, async (req, res) => {
      const me = (req as any).admin;
      res.json({ success: true, user: me });
    });

    router.post('/auth/logout', requireAuth, async (req, res) => {
      res.clearCookie('admin_token');
      res.json({ success: true });
    });

    // System status
    router.use('/system', requireAuth);
    router.get('/system/bot-status', requireRole('admin'), async (_req, res) => {
      try {
        const status = MaintenanceMiddleware.getInstance().getMaintenanceStatus();
        res.json({ success: true, data: status });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to get bot status' });
      }
    });
    router.post('/system/bot-status', requireRole('admin'), async (req, res) => {
      try {
        const { maintenanceMode, botOnline, duration, reason } = req.body || {};
        const mm = MaintenanceMiddleware.getInstance();
        if (typeof maintenanceMode === 'boolean') {
          await mm.setMaintenanceMode(maintenanceMode, duration, reason);
        }
        if (typeof botOnline === 'boolean') {
          await mm.setBotStatus(botOnline);
        }
        const status = mm.getMaintenanceStatus();
        // Persist bot status to DB so it survives restarts
        try {
          const current = await storage.get<any>('system_config', 'global') || {};
          const updated = { ...current, botStatus: status };
          if (current && current.id) await storage.update('system_config', updated, 'global'); else await storage.set('system_config', { ...updated, id: 'global' }, 'global');
        } catch {}
        res.json({ success: true, data: status });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to update bot status' });
      }
    });

    // Withdrawal settings
    router.get('/system/withdraw-settings', requireRole('admin'), async (_req, res) => {
      try {
        res.json({ success: true, data: { minWithdraw: config.points.minWithdraw, conversionRate: config.points.conversionRate, requireChannelJoinForWithdrawal: config.points.requireChannelJoinForWithdrawal, requiredChannelId: config.bot.requiredChannelId, withdrawAlertChannelId: config.bot.withdrawAlertChannelId } });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to get withdraw settings' });
      }
    });
    router.post('/system/withdraw-settings', requireRole('admin'), async (req, res) => {
      try {
        const { minWithdraw, conversionRate, requireChannelJoinForWithdrawal, requiredChannelId, withdrawAlertChannelId } = req.body || {};
        if (minWithdraw !== undefined) {
          const val = Number(minWithdraw);
          if (isNaN(val) || val < 0) { res.status(400).json({ success: false, message: 'Invalid minWithdraw' }); return; }
          config.points.minWithdraw = val;
          process.env.MIN_WITHDRAW_POINTS = String(val);
        }
        if (conversionRate !== undefined) {
          const val = Number(conversionRate);
          if (isNaN(val) || val < 0) { res.status(400).json({ success: false, message: 'Invalid conversionRate' }); return; }
          config.points.conversionRate = val;
          process.env.POINTS_TO_TOKEN_CONVERSION_RATE = String(val);
        }
        if (requireChannelJoinForWithdrawal !== undefined) {
          config.points.requireChannelJoinForWithdrawal = !!requireChannelJoinForWithdrawal;
          process.env.WITHDRAW_REQUIRE_CHANNEL_JOIN = String(!!requireChannelJoinForWithdrawal);
        }
        if (requiredChannelId !== undefined) {
          config.bot.requiredChannelId = String(requiredChannelId || '');
          process.env.REQUIRED_CHANNEL_ID = String(requiredChannelId || '');
        }
        if (withdrawAlertChannelId !== undefined) {
          config.bot.withdrawAlertChannelId = String(withdrawAlertChannelId || '');
          process.env.WITHDRAW_ALERT_CHANNEL_ID = String(withdrawAlertChannelId || '');
        }
        try {
          const current = await storage.get<any>('system_config', 'global') || {};
          const updated = { ...current, points: { ...(current.points||{}), minWithdraw: config.points.minWithdraw, conversionRate: config.points.conversionRate, requireChannelJoinForWithdrawal: config.points.requireChannelJoinForWithdrawal }, bot: { ...(current.bot||{}), requiredChannelId: config.bot.requiredChannelId, withdrawAlertChannelId: config.bot.withdrawAlertChannelId } };
          if (current && current.id) await storage.update('system_config', updated, 'global'); else await storage.set('system_config', { ...updated, id: 'global' }, 'global');
        } catch {}
        res.json({ success: true, data: { minWithdraw: config.points.minWithdraw, conversionRate: config.points.conversionRate, requireChannelJoinForWithdrawal: config.points.requireChannelJoinForWithdrawal, requiredChannelId: config.bot.requiredChannelId, withdrawAlertChannelId: config.bot.withdrawAlertChannelId } });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to update withdraw settings' });
      }
    });

    // Task settings
    router.get('/system/task-settings', requireRole('admin'), async (_req, res) => {
      try {
        res.json({ success: true, data: { autoApproveSubmissions: config.task.autoApproveSubmissions } });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to get task settings' });
      }
    });
    router.post('/system/task-settings', requireRole('admin'), async (req, res) => {
      try {
        const { autoApproveSubmissions } = req.body || {};
        if (autoApproveSubmissions !== undefined) {
          const v = !!autoApproveSubmissions;
          config.task.autoApproveSubmissions = v;
          process.env.AUTO_APPROVE_SUBMISSIONS = String(v);
          try {
            const current = await storage.get<any>('system_config', 'global') || {};
            const updated = { ...current, task: { ...(current.task||{}), autoApproveSubmissions: v } };
            if (current && current.id) await storage.update('system_config', updated, 'global'); else await storage.set('system_config', { ...updated, id: 'global' }, 'global');
          } catch {}
        }

        res.json({ success: true, data: { autoApproveSubmissions: config.task.autoApproveSubmissions } });

        (async () => {
          try {
            const v = !!config.task.autoApproveSubmissions;
            const tm = storage.getTaskManager();
            if (tm) {
              const tasks = await tm.getAllTasks();
              logger.info(`Updating autoApprove for ${tasks.length} tasks to: ${v}`);
              
              for (const t of tasks) {
                // Update ALL tasks that have validation object, regardless of submissionRequired
                // This ensures task_02, task_03, and task_07 all get updated
                if (t?.validation) {
                  const updated = { 
                    ...t, 
                    validation: { 
                      ...(t.validation || {}), 
                      autoApprove: v, 
                      reviewRequired: !v 
                    }, 
                    updatedAt: new Date().toISOString() 
                  } as any;
                  
                  await tm.saveTask(updated);
                  logger.debug(`Updated task ${t.id}: autoApprove=${v}, reviewRequired=${!v}`);
                }
              }
              
              logger.info('Successfully updated autoApprove settings for all tasks');
            }
          } catch (err) {
            logger.warn('Background propagate autoApprove failed', { error: (err as any)?.message });
          }
        })();

      } catch (e: any) {
        try {
          res.status(500).json({ success: false, message: e?.message || 'Failed to update task settings' });
        } catch {}
      }
    });

    // Transfer settings
    router.get('/system/transfer-settings', requireRole('admin'), async (_req, res) => {
      try {
        res.json({ success: true, data: config.points.transfer });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to get transfer settings' });
      }
    });
    router.post('/system/transfer-settings', requireRole('admin'), async (req, res) => {
      try {
        const { enabled, minAmount, maxAmount, maxDailyAmount, feePercentage, dailyLimit, requireConfirmation } = req.body || {};
        if (enabled !== undefined) {
          config.points.transfer.enabled = !!enabled;
          process.env.TRANSFER_ENABLED = String(!!enabled);
        }
        if (minAmount !== undefined) {
          const val = Number(minAmount);
          if (isNaN(val) || val < 0) { res.status(400).json({ success: false, message: 'Invalid minAmount' }); return; }
          config.points.transfer.minAmount = val;
          process.env.TRANSFER_MIN_POINTS = String(val);
        }
        if (maxAmount !== undefined) {
          const val = Number(maxAmount);
          if (isNaN(val) || val < 0) { res.status(400).json({ success: false, message: 'Invalid maxAmount' }); return; }
          config.points.transfer.maxAmount = val;
          process.env.TRANSFER_MAX_POINTS = String(val);
        }
        if (maxDailyAmount !== undefined) {
          const val = Number(maxDailyAmount);
          if (isNaN(val) || val < 0) { res.status(400).json({ success: false, message: 'Invalid maxDailyAmount' }); return; }
          config.points.transfer.maxDailyAmount = val;
          process.env.TRANSFER_MAX_DAILY_POINTS = String(val);
        }
        if (feePercentage !== undefined) {
          const val = Number(feePercentage);
          if (isNaN(val) || val < 0 || val > 100) { res.status(400).json({ success: false, message: 'Invalid feePercentage' }); return; }
          config.points.transfer.feePercentage = val;
          process.env.TRANSFER_FEE_PERCENTAGE = String(val);
        }
        if (dailyLimit !== undefined) {
          const val = Number(dailyLimit);
          if (!Number.isFinite(val) || val < 0) { res.status(400).json({ success: false, message: 'Invalid dailyLimit' }); return; }
          config.points.transfer.dailyLimit = val;
          process.env.TRANSFER_DAILY_LIMIT = String(val);
        }
        if (requireConfirmation !== undefined) {
          const val = !!requireConfirmation;
          config.points.transfer.requireConfirmation = val;
          process.env.TRANSFER_REQUIRE_CONFIRMATION = String(val);
        }
        if (config.points.transfer.minAmount > config.points.transfer.maxAmount) {
          res.status(400).json({ success: false, message: 'minAmount cannot exceed maxAmount' });
          return;
        }
        if (config.points.transfer.maxDailyAmount < config.points.transfer.minAmount) {
          res.status(400).json({ success: false, message: 'maxDailyAmount cannot be less than minAmount' });
          return;
        }
        try {
          const current = await storage.get<any>('system_config', 'global') || {};
          const updated = { ...current, points: { ...(current.points||{}), transfer: { ...(current.points?.transfer||{}), ...config.points.transfer } } };
          if (current && current.id) await storage.update('system_config', updated, 'global'); else await storage.set('system_config', { ...updated, id: 'global' }, 'global');
        } catch {}
        res.json({ success: true, data: config.points.transfer });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to update transfer settings' });
      }
    });

    // Wallet support settings
    router.get('/system/wallet-support', requireRole('admin'), async (_req, res) => {
      try {
        res.json({ success: true, data: { apps: config.wallet.apps, qr: { expirySeconds: config.wallet.qrCode.expirySeconds, dailyLimit: config.wallet.qrCode.dailyLimit } } });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to get wallet support settings' });
      }
    });
    router.post('/system/wallet-support', requireRole('admin'), async (req, res) => {
      try {
        const body = req.body || {};
        const apps = (body.apps || {}) as Record<string, any>;
        const qr = (body.qr || {}) as Record<string, any>;
        const allowed = ['metamask','trust','coinbase','rainbow','bitget','phantom','exodus','atomic','safepal','tokenpocket'];
        for (const key of allowed) {
          if (apps[key] !== undefined) {
            const v = !!apps[key];
            (config.wallet.apps as any)[key] = v;
            const envKey = 'SHOW_' + key.toUpperCase() + '_WALLET';
            process.env[envKey] = String(v);
          }
        }
        if (qr.dailyLimit !== undefined) {
          const val = Number(qr.dailyLimit);
          if (!Number.isInteger(val) || val < 0) { res.status(400).json({ success: false, message: 'Invalid dailyLimit' }); return; }
          config.wallet.qrCode.dailyLimit = val;
          process.env.DAILY_QR_LIMIT = String(val);
        }
        if (qr.expirySeconds !== undefined) {
          const val = Number(qr.expirySeconds);
          if (!Number.isInteger(val) || val < 1) { res.status(400).json({ success: false, message: 'Invalid expirySeconds' }); return; }
          config.wallet.qrCode.expirySeconds = val;
          process.env.QR_CODE_EXPIRY_TIME = String(val);
        }
        try {
          const current = await storage.get<any>('system_config', 'global') || {};
          const updated = { ...current, wallet: { ...(current.wallet||{}), apps: { ...(current.wallet?.apps||{}), ...config.wallet.apps }, qrCode: { ...(current.wallet?.qrCode||{}), expirySeconds: config.wallet.qrCode.expirySeconds, dailyLimit: config.wallet.qrCode.dailyLimit } } };
          if (current && current.id) await storage.update('system_config', updated, 'global'); else await storage.set('system_config', { ...updated, id: 'global' }, 'global');
        } catch {}
        res.json({ success: true, data: { apps: config.wallet.apps, qr: { expirySeconds: config.wallet.qrCode.expirySeconds, dailyLimit: config.wallet.qrCode.dailyLimit } } });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to update wallet support settings' });
      }
    });

    // Blockchain wallet config (safe fields only)
    router.get('/system/wallet-config', requireRole('admin'), async (_req, res) => {
      try {
        res.json({
          success: true,
          data: {
            network: {
              chainId: config.wallet.chainId,
              rpcUrl: config.wallet.rpcUrl,
              explorerUrl: config.wallet.explorerUrl,
              withdrawMode: config.wallet.withdrawMode || 'claim',
              confirmationsToWait: config.wallet.confirmationsToWait || 1,
            },
            contracts: {
              tokenContractAddress: config.wallet.tokenContractAddress,
              claimContractAddress: config.wallet.claimContractAddress,
            },
            token: {
              tokenSymbol: config.wallet.tokenSymbol,
              tokenDecimals: config.wallet.tokenDecimals,
            }
          }
        });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to get wallet config' });
      }
    });

    router.post('/system/wallet-config', requireRole('admin'), async (req, res) => {
      try {
        const b = req.body || {};
        if (b.chainId !== undefined) {
          const val = Number(b.chainId);
          if (!Number.isInteger(val) || val <= 0) { res.status(400).json({ success: false, message: 'Invalid chainId' }); return; }
          config.wallet.chainId = val;
          process.env.CHAIN_ID = String(val);
        }
        if (b.rpcUrl !== undefined) {
          const val = String(b.rpcUrl);
          if (!val) { res.status(400).json({ success: false, message: 'Invalid rpcUrl' }); return; }
          config.wallet.rpcUrl = val;
          process.env.RPC_URL = val;
        }
        if (b.explorerUrl !== undefined) {
          const val = String(b.explorerUrl);
          if (!val) { res.status(400).json({ success: false, message: 'Invalid explorerUrl' }); return; }
          config.wallet.explorerUrl = val;
          process.env.EXPLORER_URL = val;
        }
        if (b.withdrawMode !== undefined) {
          const val = String(b.withdrawMode) === 'server' ? 'server' : 'claim';
          config.wallet.withdrawMode = val as any;
          process.env.WITHDRAW_MODE = val;
        }
        if (b.confirmationsToWait !== undefined) {
          const val = Number(b.confirmationsToWait);
          if (!Number.isInteger(val) || val < 0) { res.status(400).json({ success: false, message: 'Invalid confirmationsToWait' }); return; }
          config.wallet.confirmationsToWait = val;
          process.env.WITHDRAW_CONFIRMATIONS = String(val);
        }
        if (b.tokenContractAddress !== undefined) {
          const val = String(b.tokenContractAddress);
          config.wallet.tokenContractAddress = val;
          process.env.TOKEN_CONTRACT_ADDRESS = val;
        }
        if (b.claimContractAddress !== undefined) {
          const val = String(b.claimContractAddress);
          config.wallet.claimContractAddress = val;
          process.env.CLAIM_CONTRACT_ADDRESS = val;
        }
        if (b.tokenSymbol !== undefined) {
          const val = String(b.tokenSymbol);
          config.wallet.tokenSymbol = val;
          process.env.TOKEN_SYMBOL = val;
        }
        if (b.tokenDecimals !== undefined) {
          const val = Number(b.tokenDecimals);
          if (!Number.isInteger(val) || val < 0) { res.status(400).json({ success: false, message: 'Invalid tokenDecimals' }); return; }
          config.wallet.tokenDecimals = val;
          process.env.TOKEN_DECIMALS = String(val);
        }
        try {
          const current = await storage.get<any>('system_config', 'global') || {};
          const updated = { ...current, walletConfig: {
            ...(current.walletConfig||{}),
            chainId: config.wallet.chainId,
            rpcUrl: config.wallet.rpcUrl,
            explorerUrl: config.wallet.explorerUrl,
            confirmationsToWait: config.wallet.confirmationsToWait,
            tokenContractAddress: config.wallet.tokenContractAddress,
            claimContractAddress: config.wallet.claimContractAddress,
            tokenSymbol: config.wallet.tokenSymbol,
            tokenDecimals: config.wallet.tokenDecimals
          }};
          if (current && current.id) await storage.update('system_config', updated, 'global'); else await storage.set('system_config', { ...updated, id: 'global' }, 'global');
        } catch {}
        res.json({ success: true, data: {
          network: {
            chainId: config.wallet.chainId,
            rpcUrl: config.wallet.rpcUrl,
            explorerUrl: config.wallet.explorerUrl,
            withdrawMode: config.wallet.withdrawMode || 'claim',
            confirmationsToWait: config.wallet.confirmationsToWait || 1,
          },
          contracts: {
            tokenContractAddress: config.wallet.tokenContractAddress,
            claimContractAddress: config.wallet.claimContractAddress,
          },
          token: {
            tokenSymbol: config.wallet.tokenSymbol,
            tokenDecimals: config.wallet.tokenDecimals,
          }
        }});
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to update wallet config' });
      }
    });

    // User data export (automatic CSV to admin)
    router.get('/system/user-data-export', requireRole('admin'), async (_req, res) => {
      try {
        const enabled = process.env.ENABLE_USER_DATA_EXPORT === 'true';
        const interval = (process.env.USER_DATA_EXPORT_INTERVAL || process.env.USER_DATA_EXPORT_INTERVAL_HOURS || '1h');
        const runOnStart = process.env.USER_DATA_EXPORT_RUN_ON_START === 'true';
        const status = SimpleUserExportScheduler.getStatus();
        const health = await UserDataExportService.healthCheck();
        res.json({ success: true, data: { settings: { enabled, interval, runOnStart }, status, health } });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to get user data export settings' });
      }
    });

    router.post('/system/user-data-export', requireRole('admin'), async (req, res) => {
      try {
        const body = req.body || {};
        const has = (v: any) => v !== undefined;

        // Validate interval format if provided
        if (has(body.interval)) {
          const s = String(body.interval).trim();
          const isExactTime = /^\d{1,2}:\d{2}$/.test(s) && (() => {
            const [h, m] = s.split(':').map((x) => parseInt(x));
            return h >= 0 && h <= 23 && m >= 0 && m <= 59;
          })();
          const isInterval = /^\d+(m|h|d)?$/i.test(s);
          if (!isExactTime && !isInterval) {
            res.status(400).json({ success: false, message: 'Invalid interval format. Use 5m, 1h, 24h or HH:MM' });
            return;
          }
          process.env.USER_DATA_EXPORT_INTERVAL = s;
        }

        if (has(body.enabled)) {
          const v = !!body.enabled;
          process.env.ENABLE_USER_DATA_EXPORT = String(v);
        }
        if (has(body.runOnStart)) {
          const v = !!body.runOnStart;
          process.env.USER_DATA_EXPORT_RUN_ON_START = String(v);
        }

        // Persist
        try {
          const current = await storage.get<any>('system_config', 'global') || {};
          const updated = { ...current, userDataExport: {
            enabled: process.env.ENABLE_USER_DATA_EXPORT === 'true',
            interval: process.env.USER_DATA_EXPORT_INTERVAL || '1h',
            runOnStart: process.env.USER_DATA_EXPORT_RUN_ON_START === 'true'
          }};
          if (current && current.id) await storage.update('system_config', updated, 'global'); else await storage.set('system_config', { ...updated, id: 'global' }, 'global');
        } catch {}

        // Apply scheduler changes
        const enabled = process.env.ENABLE_USER_DATA_EXPORT === 'true';
        try { SimpleUserExportScheduler.stop(); } catch {}
        if (enabled) {
          await SimpleUserExportScheduler.start();
        }

        const status = SimpleUserExportScheduler.getStatus();
        res.json({ success: true, data: { settings: { enabled, interval: process.env.USER_DATA_EXPORT_INTERVAL || '1h', runOnStart: process.env.USER_DATA_EXPORT_RUN_ON_START === 'true' }, status } });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to update user data export settings' });
      }
    });

    router.post('/system/user-data-export/force', requireRole('admin'), async (_req, res) => {
      try {
        const result = await SimpleUserExportScheduler.forceExport();
        res.json({ success: result.success, message: result.message });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to run export now' });
      }
    });

    router.get('/system/captcha-settings', requireRole('admin'), async (_req, res) => {
      try {
        res.json({ success: true, data: config.captcha });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to get captcha settings' });
      }
    });
    router.post('/system/captcha-settings', requireRole('admin'), async (req, res) => {
      try {
        const body = req.body || {};
        const has = (v: any) => v !== undefined;
        const toArray = (v: any) => Array.isArray(v) ? v.map((x: any) => String(x)) : (typeof v === 'string' ? v.split(',').map((s: string) => s.trim()).filter(Boolean) : undefined);

        if (has(body.miniappEnabled)) {
          const v = !!body.miniappEnabled;
          config.captcha.miniappEnabled = v;
          process.env.MINIAPP_CAPTCHA_ENABLED = String(v);
        }
        if (has(body.svgEnabled)) {
          const v = !!body.svgEnabled;
          config.captcha.svgEnabled = v;
          process.env.SVG_CAPTCHA_ENABLED = String(v);
        }
        if (has(body.requireAtLeastOne)) {
          const v = !!body.requireAtLeastOne;
          config.captcha.requireAtLeastOne = v;
          process.env.REQUIRE_AT_LEAST_ONE_CAPTCHA = String(v);
        }
        if (has(body.forExistingUsers)) {
          const v = !!body.forExistingUsers;
          config.captcha.forExistingUsers = v;
          process.env.CAPTCHA_FOR_EXISTING_USERS = String(v);
        }
        if (has(body.sessionTimeout)) {
          const v = Number(body.sessionTimeout);
          if (!Number.isFinite(v) || v < 0) { res.status(400).json({ success: false, message: 'Invalid sessionTimeout' }); return; }
          config.captcha.sessionTimeout = v;
          process.env.CAPTCHA_SESSION_TIMEOUT = String(v);
        }
        if (has(body.maxAttempts)) {
          const v = Number(body.maxAttempts);
          if (!Number.isInteger(v) || v < 1) { res.status(400).json({ success: false, message: 'Invalid maxAttempts' }); return; }
          config.captcha.maxAttempts = v;
          process.env.CAPTCHA_MAX_ATTEMPTS = String(v);
        }
        if (has(body.geoBlocking)) {
          const gb = body.geoBlocking || {};
          if (has(gb.enabled)) config.captcha.geoBlocking.enabled = !!gb.enabled;
          const bc = toArray(gb.blockedCountries);
          if (bc) { config.captcha.geoBlocking.blockedCountries = bc; process.env.BLOCKED_COUNTRIES = bc.join(','); }
          const ac = toArray(gb.allowedCountries);
          if (ac) { config.captcha.geoBlocking.allowedCountries = ac; process.env.ALLOWED_COUNTRIES = ac.join(','); }
          const sc = toArray(gb.suspiciousCountries);
          if (sc) { config.captcha.geoBlocking.suspiciousCountries = sc; process.env.SUSPICIOUS_COUNTRIES = sc.join(','); }
        }
        if (has(body.riskThresholds)) {
          const rt = body.riskThresholds || {};
          const clamp = (x: any) => {
            const n = Number(x);
            if (!Number.isFinite(n)) return undefined;
            return Math.max(0, Math.min(1, n));
          };
          const low = clamp(rt.low);
          const medium = clamp(rt.medium);
          const high = clamp(rt.high);
          const critical = clamp(rt.critical);
          if (low !== undefined) config.captcha.riskThresholds.low = low;
          if (medium !== undefined) config.captcha.riskThresholds.medium = medium;
          if (high !== undefined) config.captcha.riskThresholds.high = high;
          if (critical !== undefined) config.captcha.riskThresholds.critical = critical;
        }

        try {
          const current = await storage.get<any>('system_config', 'global') || {};
          const updated = { ...current, captcha: {
            ...(current.captcha||{}),
            miniappEnabled: config.captcha.miniappEnabled,
            svgEnabled: config.captcha.svgEnabled,
            requireAtLeastOne: config.captcha.requireAtLeastOne,
            forExistingUsers: config.captcha.forExistingUsers,
            sessionTimeout: config.captcha.sessionTimeout,
            maxAttempts: config.captcha.maxAttempts
          }};
          if (current && current.id) await storage.update('system_config', updated, 'global'); else await storage.set('system_config', { ...updated, id: 'global' }, 'global');
        } catch {}

        res.json({ success: true, data: config.captcha });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to update captcha settings' });
      }
    });

    // Protected analytics
    router.get('/system/referral-settings', requireRole('admin'), async (_req, res) => {
  try {
    res.json({ success: true, data: {
      referralBonus: config.bot.referralBonus,
      referralWelcomeBonus: config.bot.referralWelcomeBonus,
      referralWelcomeBonusEnabled: config.bot.referralWelcomeBonusEnabled,
      codeLength: config.referral.codeLength,
      taskThreshold: config.referral.taskThreshold
    } });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e?.message || 'Failed to get referral settings' });
  }
});

router.post('/system/referral-settings', requireRole('admin'), async (req, res) => {
  try {
    const { referralBonus, referralWelcomeBonus, referralWelcomeBonusEnabled, codeLength, taskThreshold } = req.body || {};
    if (referralBonus !== undefined) {
      const val = Number(referralBonus);
      if (!Number.isFinite(val) || val < 0) { res.status(400).json({ success: false, message: 'Invalid referralBonus' }); return; }
      config.bot.referralBonus = val;
      process.env.REFERRAL_BONUS = String(val);
    }
    if (referralWelcomeBonus !== undefined) {
      const val = Number(referralWelcomeBonus);
      if (!Number.isFinite(val) || val < 0) { res.status(400).json({ success: false, message: 'Invalid referralWelcomeBonus' }); return; }
      config.bot.referralWelcomeBonus = val;
      process.env.REFERRAL_WELCOME_BONUS = String(val);
    }
    if (referralWelcomeBonusEnabled !== undefined) {
      const v = !!referralWelcomeBonusEnabled;
      config.bot.referralWelcomeBonusEnabled = v;
      process.env.REFERRAL_WELCOME_BONUS_ENABLED = String(v);
    }
    if (codeLength !== undefined) {
      const val = Number(codeLength);
      if (!Number.isInteger(val) || val < 4 || val > 20) { res.status(400).json({ success: false, message: 'Invalid codeLength (4-20)' }); return; }
      config.referral.codeLength = val;
      process.env.REFERRAL_CODE_LENGTH = String(val);
    }
    if (taskThreshold !== undefined) {
      const val = Number(taskThreshold);
      if (!Number.isInteger(val) || val < 0) { res.status(400).json({ success: false, message: 'Invalid taskThreshold' }); return; }
      config.referral.taskThreshold = val;
      process.env.REFERRAL_TASK_THRESHOLD = String(val);
    }
    try {
      const current = await storage.get<any>('system_config', 'global') || {};
      const updated = { ...current, referral: {
        ...(current.referral||{}),
        referralBonus: config.bot.referralBonus,
        referralWelcomeBonus: config.bot.referralWelcomeBonus,
        referralWelcomeBonusEnabled: config.bot.referralWelcomeBonusEnabled,
        codeLength: config.referral.codeLength,
        taskThreshold: config.referral.taskThreshold
      }};
      if (current && current.id) await storage.update('system_config', updated, 'global'); else await storage.set('system_config', { ...updated, id: 'global' }, 'global');
    } catch {}
    res.json({ success: true, data: {
      referralBonus: config.bot.referralBonus,
      referralWelcomeBonus: config.bot.referralWelcomeBonus,
      referralWelcomeBonusEnabled: config.bot.referralWelcomeBonusEnabled,
      codeLength: config.referral.codeLength,
      taskThreshold: config.referral.taskThreshold
    }});
  } catch (e: any) {
    res.status(500).json({ success: false, message: e?.message || 'Failed to update referral settings' });
  }
});

router.use('/analytics', requireAuth);

    router.get('/analytics/overview', async (_req, res) => {
      try {
        const data = await this.stats.getSystemStats();
        res.json({ success: true, data });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to load stats' });
      }
    });

    router.get('/analytics/users', async (_req, res) => {
      try {
        const data = await this.stats.getUserStats();
        res.json({ success: true, data });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to load user stats' });
      }
    });

    router.get('/analytics/tasks', async (_req, res) => {
      try {
        const data = await this.stats.getTaskStats();
        res.json({ success: true, data });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to load task stats' });
      }
    });

    router.get('/analytics/security', async (_req, res) => {
      try {
        const data = await this.stats.getSecurityStats();
        res.json({ success: true, data });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to load security stats' });
      }
    });

    router.get('/analytics/claims', async (_req, res) => {
      try {
        const data = await this.stats.getClaimStats();
        res.json({ success: true, data });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to load claim stats' });
      }
    });

    router.use('/users', requireAuth);
    router.get('/users', requireRole('viewer'), async (req, res) => {
      try {
        const q = (req.query.q as string | undefined) || '';
        const verified = req.query.verified as string | undefined;
        const blocked = req.query.blocked as string | undefined;
        const hasWallet = req.query.hasWallet as string | undefined;
        const minPoints = req.query.minPoints as string | undefined;
        const maxPoints = req.query.maxPoints as string | undefined;
        const page = Math.max(1, Number(req.query.page ?? 1) || 1);
        const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize ?? 20) || 20));
        const sort = (req.query.sort as string | undefined) || '-createdAt';
        const query: any = {};
        if (q) {
          const s = String(q).trim();
          query.$or = [
            { telegramId: { $regex: s, $options: 'i' } },
            { username: { $regex: s, $options: 'i' } },
            { firstName: { $regex: s, $options: 'i' } },
            { lastName: { $regex: s, $options: 'i' } },
            { referralCode: { $regex: s, $options: 'i' } },
          ];
        }
        if (verified !== undefined && verified !== '') query.isVerified = String(verified) === 'true';
        if (blocked !== undefined && blocked !== '') query.isBlocked = String(blocked) === 'true';
        if (hasWallet !== undefined && hasWallet !== '') {
          if (String(hasWallet) === 'true') query.walletAddress = { $exists: true, $nin: [null, ''] } as any;
          else query.$or = [ ...(query.$or || []), { walletAddress: { $exists: false } }, { walletAddress: null }, { walletAddress: '' } ];
        }
        if (minPoints !== undefined || maxPoints !== undefined) {
          query.points = {};
          if (minPoints !== undefined) query.points.$gte = Number(minPoints);
          if (maxPoints !== undefined) query.points.$lte = Number(maxPoints);
        }
        let sortObj: any = { createdAt: -1 };
        if (sort) {
          const dir = sort.startsWith('-') ? -1 : 1;
          const field = sort.startsWith('-') ? sort.slice(1) : sort;
          sortObj = { [field]: dir };
        }
        const skip = (page - 1) * pageSize;
        const total = await storage.countDocuments('users', query);
        const data = await storage.findByQuery<any>('users', query, { sort: sortObj, skip, limit: pageSize });
        res.json({ success: true, data, total, page, pageSize });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to load users' });
      }
    });
    router.get('/users/:id', requireRole('viewer'), async (req, res) => {
      try {
        const id = String(req.params.id);
        const user = await storage.getUser(id);
        if (!user) { res.status(404).json({ success: false, message: 'User not found' }); return; }
        const [transactions, walletConnections, referrals, submissions] = await Promise.all([
          storage.getPointTransactions(id),
          storage.getWalletConnections(id),
          storage.getReferralRecords(id),
          storage.getTaskSubmissionsByUser(id)
        ]);
        res.json({ success: true, user, meta: {
          transactionsCount: transactions?.length || 0,
          walletConnectionsCount: walletConnections?.length || 0,
          referralsCount: referrals?.length || 0,
          submissionsCount: submissions?.length || 0
        }});
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to load user' });
      }
    });
    router.post('/users/:id/message', requireRole('moderator'), async (req, res) => {
      try {
        const id = String(req.params.id);
        const body = req.body || {};
        const type = (body.type as 'text'|'image') || 'text';
        const message = String(body.message || '').trim();
        const mediaUrl = body.mediaUrl ? String(body.mediaUrl) : undefined;
        const user = await storage.getUser(id);
        const telegramId = user?.telegramId || id;
        if (!telegramId) { res.status(404).json({ success: false, message: 'User not found' }); return; }
        if (type === 'text' && !message) { res.status(400).json({ success: false, message: 'Message required' }); return; }
        if (type === 'image' && !mediaUrl) { res.status(400).json({ success: false, message: 'mediaUrl required' }); return; }
        const bid = await BroadcastQueueService.getInstance().queueBroadcast({ type, message, mediaUrl, targetType: 'specific', targetUsers: [String(telegramId)] });
        res.json({ success: true, queued: true, id: bid, targets: 1 });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to queue message' });
      }
    });

    router.post('/users/:id/points', requireRole('admin'), async (req, res) => {
      try {
        const id = String(req.params.id);
        const delta = Number((req.body || {}).delta);
        const reason = ((req.body || {}).reason as string) || 'Admin adjustment';
        if (!delta || isNaN(delta) || delta === 0) { res.status(400).json({ success: false, message: 'Invalid delta' }); return; }
        const handler = new PointsHandler();
        const ok = delta > 0
          ? await handler.awardPoints(id, delta, reason, { source: 'admin' })
          : await handler.deductPoints(id, Math.abs(delta), reason, { source: 'admin' });
        if (!ok) { res.status(400).json({ success: false, message: 'Operation failed' }); return; }
        res.json({ success: true });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to adjust points' });
      }
    });
    router.post('/users/:id/block', requireRole('admin'), async (req, res) => {
      try {
        const id = String(req.params.id);
        const body = req.body || {};
        const ok = await storage.blockUser(id, { reason: body.reason || 'blocked by admin', type: body.type || 'manual', duration: body.durationMs, permanent: body.permanent !== false, metadata: body.metadata || {} });
        if (!ok) { res.status(400).json({ success: false, message: 'Failed to block' }); return; }
        res.json({ success: true });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to block user' });
      }
    });
    router.post('/users/:id/unblock', requireRole('admin'), async (req, res) => {
      try {
        const id = String(req.params.id);
        const reason = (req.body || {}).reason || 'unblocked by admin';
        const ok = await storage.unblockUser(id, reason);
        if (!ok) { res.status(400).json({ success: false, message: 'Failed to unblock' }); return; }
        
        // Additional cache clearing to ensure user can access bot immediately
        try {
          const { userCache } = await import('../services/user-cache.service');
          userCache.invalidate(id);
          logger.info(`Admin unblock: cleared caches for user ${id}`);
        } catch (cacheErr) {
          logger.warn(`Admin unblock: failed to clear additional caches for ${id}:`, cacheErr);
        }
        
        res.json({ success: true });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to unblock user' });
      }
    });
    router.post('/users/:id/reset-progress', requireRole('admin'), async (req, res) => {
      try {
        const id = String(req.params.id);
        const updates: any = {
          tasksCompleted: 0,
          completedTasks: [],
          taskCompletionStatus: {},
          dailyTasksCompleted: {},
          lastTaskCompletedAt: undefined,
          updatedAt: new Date().toISOString()
        };
        await storage.update('users', updates, id);
        res.json({ success: true });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to reset progress' });
      }
    });
    router.get('/users/export', requireRole('admin'), async (req, res) => {
      try {
        const q = (req.query.q as string | undefined) || '';
        const verified = req.query.verified as string | undefined;
        const blocked = req.query.blocked as string | undefined;
        const hasWallet = req.query.hasWallet as string | undefined;
        const query: any = {};
        if (q) {
          const s = String(q).trim();
          query.$or = [
            { telegramId: { $regex: s, $options: 'i' } },
            { username: { $regex: s, $options: 'i' } },
            { firstName: { $regex: s, $options: 'i' } },
            { lastName: { $regex: s, $options: 'i' } },
            { referralCode: { $regex: s, $options: 'i' } }
          ];
        }
        if (verified !== undefined && verified !== '') query.isVerified = String(verified) === 'true';
        if (blocked !== undefined && blocked !== '') query.isBlocked = String(blocked) === 'true';
        if (hasWallet !== undefined && hasWallet !== '') {
          if (String(hasWallet) === 'true') query.walletAddress = { $exists: true, $nin: [null, ''] } as any;
          else query.$or = [ ...(query.$or || []), { walletAddress: { $exists: false } }, { walletAddress: null }, { walletAddress: '' } ];
        }
        const data = await storage.findByQuery<any>('users', query, { sort: { createdAt: -1 } });
        const headers = [
          'telegramId','username','firstName','lastName','languageCode','country','isPremium','points','totalEarned','tasksCompleted','totalReferrals','activeReferrals','referralCode','referredBy','walletAddress','walletConnectedAt','riskScore','overallThreatLevel','isVerified','verifiedAt','isBlocked','blockedAt','blockReason','joinedAt','lastActiveAt'
        ];
        const rows = [headers.join(',')].concat(
          data.map(u => headers.map(h => {
            const v = (u as any)[h];
            if (v === undefined || v === null) return '';
            const s = typeof v === 'string' ? v : (typeof v === 'number' ? String(v) : (typeof v === 'boolean' ? (v ? 'true' : 'false') : ''));
            return '"' + s.replace(/"/g, '""') + '"';
          }).join(','))
        ).join('\n');
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="users.csv"');
        res.status(200).send(rows);
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to export users' });
      }
    });

    router.use('/tasks', requireAuth);
    router.get('/tasks', requireRole('viewer'), async (req, res) => {
      try {
        const filter: any = {};
        if (req.query.category) filter.category = String(req.query.category);
        if (req.query.type) filter.type = String(req.query.type);
        if (req.query.isActive !== undefined && req.query.isActive !== '') filter.isActive = String(req.query.isActive) === 'true';
        if (req.query.isDaily !== undefined && req.query.isDaily !== '') filter.isDaily = String(req.query.isDaily) === 'true';
        if (req.query.search) filter.search = String(req.query.search);
        const data = await storage.getFilteredTasks(filter);
        res.json({ success: true, data });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to load tasks' });
      }
    });
    router.post('/tasks', requireRole('admin'), async (req, res) => {
      try {
        const body = req.body || {};
        const id = body.id || `task_${Date.now()}`;
        const now = new Date().toISOString();
        const task = { ...body, id, createdAt: body.createdAt || now, updatedAt: now };
        await storage.saveTask(task);
        res.json({ success: true, task });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to create task' });
      }
    });
    router.put('/tasks/:id', requireRole('admin'), async (req, res) => {
      try {
        const id = String(req.params.id);
        const body = req.body || {};
        const now = new Date().toISOString();
        await storage.saveTask({ ...body, id, updatedAt: now });
        res.json({ success: true });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to update task' });
      }
    });
    router.post('/tasks/:id/toggle', requireRole('admin'), async (req, res) => {
      try {
        const id = String(req.params.id);
        const t = await storage.getTask(id);
        if (!t) { res.status(404).json({ success: false, message: 'Task not found' }); return; }
        await storage.saveTask({ ...t, isActive: !t.isActive, updatedAt: new Date().toISOString() });
        res.json({ success: true });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to toggle task' });
      }
    });
    router.post('/tasks/reorder', requireRole('admin'), async (req, res) => {
      try {
        const order = ((req.body || {}).order as Array<{id: string; order: number}>) || [];
        for (const o of order) {
          const t = await storage.getTask(o.id);
          if (t) await storage.saveTask({ ...t, order: o.order, updatedAt: new Date().toISOString() });
        }
        res.json({ success: true });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to reorder tasks' });
      }
    });

    router.use('/submissions', requireAuth);
    router.get('/submissions/pending', requireRole('moderator'), async (req, res) => {
      try {
        const page = Math.max(1, Number(req.query.page ?? 1) || 1);
        const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize ?? 20) || 20));
        const skip = (page - 1) * pageSize;
        const query: any = { status: 'pending' };
        const total = await storage.countDocuments('task_submissions', query);
        const data = await storage.findByQuery<any>('task_submissions', query, { sort: { submittedAt: -1 }, skip, limit: pageSize });
        res.json({ success: true, data, total, page, pageSize });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to load submissions' });
      }
    });
    router.post('/submissions/:id/approve', requireRole('moderator'), async (req, res) => {
      try {
        const id = String(req.params.id);
        const body = req.body || {};
        await storage.update('task_submissions', { status: 'approved', reviewedAt: new Date().toISOString(), reviewedBy: (req as any).admin?.username || 'admin', reviewNotes: body.reviewNotes || '' }, id);
        if (body.points && Number(body.points) > 0 && body.userId) {
          const handler = new PointsHandler();
          await handler.awardPoints(String(body.userId), Number(body.points), 'Task submission approved', { taskId: body.taskId || '', source: 'submission' });
        }
        res.json({ success: true });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to approve submission' });
      }
    });
    router.post('/submissions/:id/reject', requireRole('moderator'), async (req, res) => {
      try {
        const id = String(req.params.id);
        const body = req.body || {};
        await storage.update('task_submissions', { status: 'rejected', reviewedAt: new Date().toISOString(), reviewedBy: (req as any).admin?.username || 'admin', reviewNotes: body.reviewNotes || '' }, id);
        res.json({ success: true });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to reject submission' });
      }
    });

    router.use('/security', requireAuth);
    router.get('/security/audit', requireRole('moderator'), async (req, res) => {
      try {
        const page = Math.max(1, Number(req.query.page ?? 1) || 1);
        const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize ?? 50) || 50));
        const type = req.query.type as string | undefined;
        const severity = req.query.severity as string | undefined;
        const userId = req.query.userId as string | undefined;
        const logs = await storage.getSecurityAuditLogs({ type, severity, userId });
        const total = logs.length;
        const start = (page - 1) * pageSize;
        const data = logs.slice(start, start + pageSize);
        res.json({ success: true, data, total, page, pageSize });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to load audit' });
      }
    });
    router.get('/security/blocked-users', requireRole('moderator'), async (_req, res) => {
      try {
        // Fetch blocked users from both collections
        const [blockedUsers, bannedUsers] = await Promise.all([
          storage.findByQuery<any>('users', { isBlocked: true }, { projection: { id: 1, telegramId: 1, username: 1, firstName: 1, lastName: 1, blockedAt: 1, blockReason: 1, multiAccountDetected: 1 } as any, sort: { blockedAt: -1 } }),
          storage.findByQuery<any>('banned_users', {}, { projection: { userId: 1, telegramId: 1, username: 1, firstName: 1, lastName: 1, bannedAt: 1, blockReason: 1, reason: 1, originalUser: 1, deviceHash: 1 } as any, sort: { bannedAt: -1 } })
        ]);

        // Normalize banned_users data to match users format
        const normalizedBannedUsers = bannedUsers.map((u: any) => ({
          id: u.userId || u.telegramId,
          telegramId: u.userId || u.telegramId,
          username: u.username || '',
          firstName: u.firstName || 'Banned User',
          lastName: u.lastName || '',
          blockedAt: u.bannedAt || u.createdAt,
          blockReason: u.blockReason || u.reason || 'Multi-account violation',
          multiAccountDetected: true,
          originalUser: u.originalUser,
          source: 'banned_users'
        }));

        // Combine both arrays
        const allBlocked = [...blockedUsers, ...normalizedBannedUsers];
        
        // Sort by blockedAt descending
        allBlocked.sort((a, b) => {
          const dateA = a.blockedAt ? new Date(a.blockedAt).getTime() : 0;
          const dateB = b.blockedAt ? new Date(b.blockedAt).getTime() : 0;
          return dateB - dateA;
        });

        res.json({ success: true, data: allBlocked });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to load blocked users' });
      }
    });
    router.get('/security/blocked-devices', requireRole('admin'), async (_req, res) => {
      try {
        const data = await storage.getAllBannedDevices();
        res.json({ success: true, data });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to load blocked devices' });
      }
    });
    router.post('/security/devices/block', requireRole('admin'), async (req, res) => {
      try {
        const body = req.body || {};
        if (!body.deviceHash) { res.status(400).json({ success: false, message: 'deviceHash required' }); return; }
        await storage.saveBannedDevice({ deviceHash: body.deviceHash, bannedAt: new Date().toISOString(), reason: body.reason || 'blocked by admin', relatedAccounts: body.relatedAccounts || [] });
        res.json({ success: true });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to block device' });
      }
    });
    router.post('/security/devices/unblock', requireRole('admin'), async (req, res) => {
      try {
        const body = req.body || {};
        if (!body.deviceHash) { res.status(400).json({ success: false, message: 'deviceHash required' }); return; }
        await storage.removeBannedDevice(String(body.deviceHash));
        res.json({ success: true });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to unblock device' });
      }
    });
    router.get('/security/captcha-stats', requireRole('moderator'), async (_req, res) => {
      try {
        const data = await storage.getCaptchaStats();
        res.json({ success: true, data });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to load captcha stats' });
      }
    });

    router.use('/broadcasts', requireAuth);
    router.post('/broadcasts/send', requireRole('admin'), async (req, res) => {
      try {
        const body = req.body || {};
        const type = (body.type as 'text'|'image') || 'text';
        const message = String(body.message || '').trim();
        const mediaUrl = body.mediaUrl ? String(body.mediaUrl) : undefined;
        const seg = body.segmentation || {};
        if (!message && type === 'text') { res.status(400).json({ success: false, message: 'Message required' }); return; }
        if (type === 'image' && !mediaUrl) { res.status(400).json({ success: false, message: 'mediaUrl required for image broadcast' }); return; }
        // Build user query
        const query: any = {};
        
        // Handle blocked/banned users - these override normal filtering
        if (seg.includeBlocked === true || seg.includeBanned === true) {
          const blockConditions = [];
          if (seg.includeBlocked === true) {
            blockConditions.push({ isBlocked: true });
          }
          if (seg.includeBanned === true) {
            blockConditions.push({ isBanned: true });
          }
          if (blockConditions.length > 0) {
            query.$or = blockConditions;
            logger.info('Including blocked/banned users in broadcast');
          }
        } else {
          // Default behavior: send to ALL users (excluding blocked/banned)
          query.isBlocked = { $ne: true };
          query.isBanned = { $ne: true };
          
          // Apply segmentation filters ONLY if they are specifically enabled
          // This allows "all users" when no criteria are selected
          const hasSpecificCriteria = seg.verified === true || seg.premium === true || seg.hasWallet === true || seg.hasReferrals === true;
          
          if (hasSpecificCriteria) {
            // Apply specific filters only when explicitly requested
            if (seg.verified === true) query.isVerified = true;
            if (seg.premium === true) query.isPremium = true;
            if (seg.hasWallet === true) query.walletAddress = { $exists: true, $nin: [null, ''] } as any;
            if (seg.hasReferrals === true) query.totalReferrals = { $gt: 0 } as any;
            logger.info('Applying specific user criteria filters');
          } else {
            logger.info('No specific criteria selected - targeting ALL users (excluding blocked/banned)');
          }
        }
        
        // Apply common filters regardless of block status
        if (seg.minPoints !== undefined || seg.maxPoints !== undefined) {
          query.points = {};
          if (seg.minPoints !== undefined) query.points.$gte = Number(seg.minPoints);
          if (seg.maxPoints !== undefined) query.points.$lte = Number(seg.maxPoints);
        }
        if (seg.activeDays && Number(seg.activeDays) > 0) {
          const since = new Date(Date.now() - Number(seg.activeDays) * 24 * 60 * 60 * 1000).toISOString();
          query.lastActiveAt = { $gte: since } as any;
        }
        const users = await storage.findByQuery<any>('users', query, { projection: { telegramId: 1 } as any });
        const targetUsers = users.map(u => u.telegramId).filter(Boolean);
        
        // Enhanced logging for segmentation
        const hasSpecificCriteria = seg.verified === true || seg.premium === true || seg.hasWallet === true || seg.hasReferrals === true;
        const isSpecialCategory = seg.includeBlocked === true || seg.includeBanned === true;
        
        const segmentationSummary = {
          targetMode: isSpecialCategory ? 'blocked/banned users' : hasSpecificCriteria ? 'specific criteria' : 'ALL users',
          verified: seg.verified,
          premium: seg.premium,
          hasWallet: seg.hasWallet,
          hasReferrals: seg.hasReferrals,
          includeBlocked: seg.includeBlocked,
          includeBanned: seg.includeBanned,
          activeDays: seg.activeDays,
          pointsRange: seg.minPoints || seg.maxPoints ? `${seg.minPoints || 'any'}-${seg.maxPoints || 'any'}` : 'any'
        };
        
        logger.info(`Broadcast targeting ${targetUsers.length} users`);
        logger.info('Segmentation criteria:', segmentationSummary);
        logger.info('Database query:', query);
        if (!targetUsers.length) { 
          logger.warn('No users found matching broadcast criteria');
          res.json({ success: true, queued: false, id: null, targets: 0 }); 
          return; 
        }
        logger.info(`Queueing broadcast to ${targetUsers.length} users: ${targetUsers.slice(0, 5).join(', ')}${targetUsers.length > 5 ? '...' : ''}`);
        const id = await BroadcastQueueService.getInstance().queueBroadcast({ type, message, mediaUrl, targetType: 'specific', targetUsers });
        logger.info(`Broadcast queued with ID: ${id}`);
        res.json({ success: true, queued: true, id, targets: targetUsers.length });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to queue broadcast' });
      }
    });
    router.get('/broadcasts/history', requireRole('moderator'), async (req, res) => {
      try {
        const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50) || 50));
        const data = await BroadcastQueueService.getInstance().getBroadcastHistory(limit);
        res.json({ success: true, data });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to load history' });
      }
    });

    router.use('/referrals', requireAuth);
    router.get('/referrals/leaderboard', requireRole('viewer'), async (req, res) => {
      try {
        const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 20) || 20));
        const pipeline = [
          { $group: { _id: '$referrerId', total: { $sum: 1 }, active: { $sum: { $cond: [{ $eq: ['$isActive', true] }, 1, 0] } } } },
          { $sort: { total: -1 } },
          { $limit: limit }
        ] as any;
        const rows = await storage.aggregate<any>('referrals', pipeline);
        res.json({ success: true, data: rows.map(r => ({ referrerId: r._id, total: r.total, active: r.active })) });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to load leaderboard' });
      }
    });
    router.get('/referrals/metrics', requireRole('viewer'), async (_req, res) => {
      try {
        const total = await storage.countDocuments('referrals', {});
        const active = await storage.countDocuments('referrals', { isActive: true } as any);
        res.json({ success: true, data: { total, active, conversionRate: total > 0 ? active / total : 0 } });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to load referral metrics' });
      }
    });

    // Bot performance monitoring routes
    router.use('/bot-performance', requireAuth);
    router.get('/bot-performance/live', requireRole('viewer'), async (_req, res) => {
      try {
        const logs = await botResponseMonitor.getLiveLogs(100);
        res.json({ success: true, data: logs });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to load live logs' });
      }
    });

    router.get('/bot-performance/records', requireRole('viewer'), async (req, res) => {
      try {
        const sortBy = req.query.sortBy as any;
        const records = await botResponseMonitor.getRecords({ sortBy });
        res.json({ success: true, data: records });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to load records' });
      }
    });

    router.get('/bot-performance/stats', requireRole('viewer'), async (_req, res) => {
      try {
        const stats = await botResponseMonitor.getStatistics();
        res.json({ success: true, data: stats });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to load statistics' });
      }
    });

    router.post('/bot-performance/clear', requireRole('admin'), async (_req, res) => {
      try {
        await botResponseMonitor.clearAll();
        res.json({ success: true, message: 'All bot performance data cleared' });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to clear data' });
      }
    });

    router.use('/wallet', requireAuth);
    router.get('/wallet/withdrawals', requireRole('moderator'), async (req, res) => {
      try {
        const status = (req.query.status as string | undefined) || 'pending';
        const page = Math.max(1, Number(req.query.page ?? 1) || 1);
        const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize ?? 20) || 20));
        const query: any = { status };
        const total = await storage.countDocuments('withdrawals', query);
        const data = await storage.findByQuery<any>('withdrawals', query, { sort: { requestedAt: -1 }, skip: (page-1)*pageSize, limit: pageSize });
        res.json({ success: true, data, total, page, pageSize });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to load withdrawals' });
      }
    });
    router.post('/wallet/withdrawals/:id/approve', requireRole('admin'), async (req, res) => {
      try {
        const id = String(req.params.id);
        await storage.update('withdrawals', { status: 'completed', processedAt: new Date().toISOString(), failureReason: undefined }, id);
        res.json({ success: true });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to approve withdrawal' });
      }
    });
    router.post('/wallet/withdrawals/:id/deny', requireRole('admin'), async (req, res) => {
      try {
        const id = String(req.params.id);
        const reason = (req.body || {}).reason || 'Denied by admin';
        await storage.update('withdrawals', { status: 'failed', processedAt: new Date().toISOString(), failureReason: reason }, id);
        res.json({ success: true });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to deny withdrawal' });
      }
    });
    router.get('/wallet/metrics/daily', requireRole('viewer'), async (_req, res) => {
      try {
        const start = new Date(); start.setHours(0,0,0,0);
        const end = new Date(); end.setHours(23,59,59,999);
        const rows = await storage.aggregate<any>('withdrawals', [
          { $match: { status: 'completed', processedAt: { $gte: start.toISOString(), $lte: end.toISOString() } } },
          { $group: { _id: null, totalAmount: { $sum: '$amount' }, totalTokens: { $sum: '$tokenAmount' }, count: { $sum: 1 } } }
        ] as any);
        const data = rows && rows.length ? rows[0] : { totalAmount: 0, totalTokens: 0, count: 0 };
        res.json({ success: true, data });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to load wallet metrics' });
      }
    });

    router.use('/db', requireAuth);

    router.get('/db/databases', requireRole('viewer'), async (_req, res) => {
      try {
        const inst: any = (storage as any).getStorageInstance?.() || null;
        const client = inst?.client;
        if (!client) { res.status(500).json({ success: false, message: 'DB client not available' }); return; }
        const admin = client.db().admin();
        const dbs = await admin.listDatabases();
        const names = (dbs?.databases || []).map((d: any) => d.name).filter((n: string) => !['admin','local','config'].includes(n));
        res.json({ success: true, data: names });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to list databases' });
      }
    });

    router.get('/db/mongodb-stats', requireRole('viewer'), async (_req, res) => {
      try {
        const inst: any = (storage as any).getStorageInstance?.() || null;
        const client = inst?.client;
        if (!client) { res.status(500).json({ success: false, message: 'MongoDB client not available' }); return; }
        
        const dbName = config.storage.mongodb.database;
        const db = client.db(dbName);
        
        const [dbStats, serverStatus] = await Promise.all([
          db.stats(),
          client.db().admin().serverStatus()
        ]);
        
        const connections = serverStatus?.connections || {};
        const mem = serverStatus?.mem || {};
        const network = serverStatus?.network || {};
        
        const stats = {
          database: dbName,
          collections: dbStats.collections || 0,
          dataSize: dbStats.dataSize || 0,
          storageSize: dbStats.storageSize || 0,
          indexSize: dbStats.indexSize || 0,
          totalSize: (dbStats.dataSize || 0) + (dbStats.indexSize || 0),
          avgObjSize: dbStats.avgObjSize || 0,
          objects: dbStats.objects || 0,
          indexes: dbStats.indexes || 0,
          connections: {
            current: connections.current || 0,
            available: connections.available || 0,
            active: connections.active || 0
          },
          memory: {
            resident: mem.resident || 0,
            virtual: mem.virtual || 0
          },
          network: {
            bytesIn: network.bytesIn || 0,
            bytesOut: network.bytesOut || 0,
            numRequests: network.numRequests || 0
          },
          version: serverStatus?.version || 'unknown',
          uptime: serverStatus?.uptime || 0,
          status: 'connected'
        };
        
        res.json({ success: true, data: stats });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to get MongoDB stats' });
      }
    });

    router.get('/db/redis-stats', requireRole('viewer'), async (_req, res) => {
      try {
        const redisCache = RedisDistributedCacheService.getInstance();
        const redis = (redisCache as any).redis;
        
        if (!redis) {
          res.json({ 
            success: true, 
            data: { 
              status: 'not_configured',
              message: 'Redis is not configured'
            } 
          });
          return;
        }

        const isAvailable = (redisCache as any).isAvailable;
        if (!isAvailable) {
          res.json({ 
            success: true, 
            data: { 
              status: 'disconnected',
              message: 'Redis is configured but not connected'
            } 
          });
          return;
        }

        const [info, dbsize, memoryInfo] = await Promise.all([
          redis.info('server'),
          redis.dbsize(),
          redis.info('memory')
        ]);

        const parseInfo = (infoStr: string): Record<string, any> => {
          const result: Record<string, any> = {};
          infoStr.split('\n').forEach(line => {
            if (line && !line.startsWith('#')) {
              const [key, value] = line.split(':');
              if (key && value) {
                result[key.trim()] = value.trim();
              }
            }
          });
          return result;
        };

        const serverInfo = parseInfo(info);
        const memInfo = parseInfo(memoryInfo);

        const usedMemory = parseInt(memInfo.used_memory || '0');
        const maxMemory = parseInt(memInfo.maxmemory || '0');
        const memoryUsagePercent = maxMemory > 0 ? (usedMemory / maxMemory * 100).toFixed(2) : 'N/A';

        const stats = {
          status: 'connected',
          version: serverInfo.redis_version || 'unknown',
          uptime: parseInt(serverInfo.uptime_in_seconds || '0'),
          keys: dbsize || 0,
          memory: {
            used: usedMemory,
            usedHuman: memInfo.used_memory_human || '0B',
            peak: parseInt(memInfo.used_memory_peak || '0'),
            peakHuman: memInfo.used_memory_peak_human || '0B',
            max: maxMemory,
            maxHuman: memInfo.maxmemory_human || 'unlimited',
            usagePercent: memoryUsagePercent,
            fragmentation: parseFloat(memInfo.mem_fragmentation_ratio || '1.0')
          },
          clients: {
            connected: parseInt(serverInfo.connected_clients || '0'),
            blocked: parseInt(serverInfo.blocked_clients || '0')
          },
          ops: {
            instantaneous: parseInt(memInfo.instantaneous_ops_per_sec || '0')
          },
          config: {
            host: process.env.REDIS_HOST || 'from URL',
            port: parseInt(process.env.REDIS_PORT || '6379'),
            db: parseInt(process.env.REDIS_DB || '0')
          }
        };

        res.json({ success: true, data: stats });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to get Redis stats' });
      }
    });

    router.get('/db/redis-keys', requireRole('viewer'), async (req, res) => {
      try {
        const redisCache = RedisDistributedCacheService.getInstance();
        const redis = (redisCache as any).redis;
        const isAvailable = (redisCache as any).isAvailable;

        if (!redis || !isAvailable) {
          res.status(503).json({ success: false, message: 'Redis not available' });
          return;
        }

        const pattern = (req.query.pattern as string) || '*';
        const limit = Math.min(10000, Math.max(100, Number(req.query.limit || 1000)));

        let allKeys: string[] = [];
        let cursor = '0';
        do {
          const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
          allKeys = allKeys.concat(keys);
          cursor = nextCursor;
          if (allKeys.length >= limit) break;
        } while (cursor !== '0');

        allKeys = allKeys.slice(0, limit);

        const groupedKeys: Record<string, any> = {};
        const individualKeys: any[] = [];

        for (const key of allKeys) {
          const parts = key.split(':');
          if (parts.length > 1) {
            const prefix = parts[0];
            if (!groupedKeys[prefix]) {
              groupedKeys[prefix] = { keys: [], count: 0 };
            }
            groupedKeys[prefix].keys.push(key);
            groupedKeys[prefix].count++;
          } else {
            individualKeys.push(key);
          }
        }

        const totalKeys = allKeys.length;
        const groups = await Promise.all(
          Object.entries(groupedKeys).map(async ([prefix, data]) => ({
            prefix,
            count: data.count,
            percentage: totalKeys > 0 ? Math.round((data.count / totalKeys) * 100) : 0,
            keys: await Promise.all(
              data.keys.slice(0, 100).map(async (key: string) => {
                try {
                  const [type, ttl, size] = await Promise.all([
                    redis.type(key),
                    redis.ttl(key),
                    redis.memory('USAGE', key).catch(() => 0)
                  ]);
                  const ttlStr = ttl === -1 ? 'persistent' : ttl === -2 ? 'expired' : ttl > 86400 ? `${Math.floor(ttl/86400)}d` : ttl > 3600 ? `${Math.floor(ttl/3600)}h` : ttl > 60 ? `${Math.floor(ttl/60)}min` : `${ttl}s`;
                  return { key, type, ttl: ttlStr, size: size || 0 };
                } catch {
                  return { key, type: 'unknown', ttl: 'unknown', size: 0 };
                }
              })
            )
          }))
        );

        const individuals = await Promise.all(
          individualKeys.slice(0, 100).map(async (key: string) => {
            try {
              const [type, ttl, size] = await Promise.all([
                redis.type(key),
                redis.ttl(key),
                redis.memory('USAGE', key).catch(() => 0)
              ]);
              const ttlStr = ttl === -1 ? 'persistent' : ttl === -2 ? 'expired' : ttl > 86400 ? `${Math.floor(ttl/86400)}d` : ttl > 3600 ? `${Math.floor(ttl/3600)}h` : ttl > 60 ? `${Math.floor(ttl/60)}min` : `${ttl}s`;
              return { key, type, ttl: ttlStr, size: size || 0 };
            } catch {
              return { key, type: 'unknown', ttl: 'unknown', size: 0 };
            }
          })
        );

        res.json({ 
          success: true, 
          data: {
            groups: groups.sort((a, b) => b.count - a.count),
            individuals,
            total: totalKeys
          }
        });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to list Redis keys' });
      }
    });

    router.get('/db/redis-get', requireRole('viewer'), async (req, res) => {
      try {
        const redisCache = RedisDistributedCacheService.getInstance();
        const redis = (redisCache as any).redis;
        const isAvailable = (redisCache as any).isAvailable;

        if (!redis || !isAvailable) {
          res.status(503).json({ success: false, message: 'Redis not available' });
          return;
        }

        const key = req.query.key as string;
        if (!key) {
          res.status(400).json({ success: false, message: 'Key required' });
          return;
        }

        const type = await redis.type(key);
        let value: any = null;

        switch (type) {
          case 'string':
            value = await redis.get(key);
            try { value = JSON.parse(value); } catch {}
            break;
          case 'hash':
            value = await redis.hgetall(key);
            break;
          case 'list':
            value = await redis.lrange(key, 0, -1);
            break;
          case 'set':
            value = await redis.smembers(key);
            break;
          case 'zset':
            value = await redis.zrange(key, 0, -1, 'WITHSCORES');
            break;
          default:
            value = null;
        }

        const [ttl, size] = await Promise.all([
          redis.ttl(key),
          redis.memory('USAGE', key).catch(() => 0)
        ]);

        res.json({ 
          success: true, 
          data: {
            key,
            type,
            value,
            ttl: ttl === -1 ? 'persistent' : ttl === -2 ? 'expired' : ttl,
            size: size || 0
          }
        });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to get Redis key' });
      }
    });

    router.post('/db/redis-delete', requireRole('admin'), async (req, res) => {
      try {
        const redisCache = RedisDistributedCacheService.getInstance();
        const redis = (redisCache as any).redis;
        const isAvailable = (redisCache as any).isAvailable;

        if (!redis || !isAvailable) {
          res.status(503).json({ success: false, message: 'Redis not available' });
          return;
        }

        const body = req.body || {};
        const keys = body.keys ? (Array.isArray(body.keys) ? body.keys : [body.keys]) : [];

        if (keys.length === 0) {
          res.status(400).json({ success: false, message: 'Keys required' });
          return;
        }

        const deleted = await redis.del(...keys);
        res.json({ success: true, deleted });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to delete Redis keys' });
      }
    });

    router.post('/db/redis-flush', requireRole('super_admin'), async (req, res) => {
      try {
        const redisCache = RedisDistributedCacheService.getInstance();
        const redis = (redisCache as any).redis;
        const isAvailable = (redisCache as any).isAvailable;

        if (!redis || !isAvailable) {
          res.status(503).json({ success: false, message: 'Redis not available' });
          return;
        }

        const body = req.body || {};
        const confirm = body.confirm;

        if (confirm !== 'FLUSH REDIS') {
          res.status(400).json({ success: false, message: 'Type "FLUSH REDIS" to confirm' });
          return;
        }

        await redis.flushdb();
        res.json({ success: true, message: 'Redis database flushed' });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to flush Redis' });
      }
    });

    router.get('/db/collections', requireRole('viewer'), async (req, res) => {
      try {
        const dbName = String((req.query.db as string) || config.storage.mongodb.database);
        const inst: any = (storage as any).getStorageInstance?.() || null;
        const client = inst?.client;
        if (!client) { res.status(500).json({ success: false, message: 'DB client not available' }); return; }
        const db = client.db(dbName);
        const cols = await db.listCollections().toArray();
        const data = await Promise.all(cols.map(async (c: any) => ({ name: c.name, count: await db.collection(c.name).countDocuments() })));
        res.json({ success: true, data, dbName });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to list collections' });
      }
    });

    router.post('/db/query', requireRole('viewer'), async (req, res) => {
      try {
        const body = req.body || {};
        const dbName = String(body.db || config.storage.mongodb.database);
        const collection = String(body.collection || '');
        if (!collection) { res.status(400).json({ success: false, message: 'collection required' }); return; }
        const filter = typeof body.filter === 'string' ? (body.filter ? JSON.parse(body.filter) : {}) : (body.filter || {});
        const projection = typeof body.projection === 'string' ? (body.projection ? JSON.parse(body.projection) : undefined) : (body.projection || undefined);
        const sort = typeof body.sort === 'string' ? (body.sort ? JSON.parse(body.sort) : undefined) : (body.sort || undefined);
        const limit = Math.min(1000, Math.max(1, Number(body.limit || 20)));
        const skip = Math.max(0, Number(body.skip || 0));
        const inst: any = (storage as any).getStorageInstance?.() || null;
        const client = inst?.client;
        if (!client) { res.status(500).json({ success: false, message: 'DB client not available' }); return; }
        const db = client.db(dbName);
        const coll = db.collection(collection);
        const cursor = coll.find(filter, { projection: projection as any });
        if (sort) cursor.sort(sort as any);
        const raw = await cursor.skip(skip).limit(limit).toArray();
        const data = raw.map((d: any) => {
          if (d && d._id && typeof d._id.toString === 'function') return { ...d, _id: d._id.toString() };
          return d;
        });
        const total = await coll.countDocuments(filter);
        res.json({ success: true, data, total });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Query failed' });
      }
    });

    router.post('/db/delete-many', requireRole('admin'), async (req, res) => {
      try {
        const body = req.body || {};
        const dbName = String(body.db || config.storage.mongodb.database);
        const collection = String(body.collection || '');
        if (!collection) { res.status(400).json({ success: false, message: 'collection required' }); return; }
        const filter = typeof body.filter === 'string' ? (body.filter ? JSON.parse(body.filter) : {}) : (body.filter || {});
        const inst: any = (storage as any).getStorageInstance?.() || null;
        const client = inst?.client;
        if (!client) { res.status(500).json({ success: false, message: 'DB client not available' }); return; }
        const db = client.db(dbName);
        const coll = db.collection(collection);
        const norm = (f: any) => {
          try {
            if (f && typeof f === 'object' && f._id) {
              if (typeof f._id === 'string' && ObjectId.isValid(f._id)) f._id = new ObjectId(f._id);
              if (f._id && f._id.$in && Array.isArray(f._id.$in)) f._id.$in = f._id.$in.map((x: any)=> (typeof x === 'string' && ObjectId.isValid(x)) ? new ObjectId(x) : x);
            }
          } catch {}
          return f;
        };
        const r = await coll.deleteMany(norm(filter));
        const deleted = (r as any)?.deletedCount || 0;
        res.json({ success: true, deleted });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Delete failed' });
      }
    });

    router.post('/db/drop-collection', requireRole('super_admin'), async (req, res) => {
      try {
        const body = req.body || {};
        const dbName = String(body.db || config.storage.mongodb.database);
        const collection = String(body.collection || '');
        if (!collection) { res.status(400).json({ success: false, message: 'collection required' }); return; }
        if (body.confirm !== collection) { res.status(400).json({ success: false, message: 'Type collection name to confirm' }); return; }
        const inst: any = (storage as any).getStorageInstance?.() || null;
        const client = inst?.client;
        if (!client) { res.status(500).json({ success: false, message: 'DB client not available' }); return; }
        const db = client.db(dbName);
        await db.collection(collection).drop();
        res.json({ success: true });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Drop collection failed' });
      }
    });

    router.post('/db/drop-database', requireRole('super_admin'), async (req, res) => {
      try {
        const body = req.body || {};
        const dbName = String(body.db || config.storage.mongodb.database);
        const expected = `drop ${dbName}`;
        if (body.confirm !== expected) { res.status(400).json({ success: false, message: `Type '${expected}' to confirm` }); return; }
        const inst: any = (storage as any).getStorageInstance?.() || null;
        const client = inst?.client;
        if (!client || typeof client.db !== 'function') { res.status(500).json({ success: false, message: 'Database client not available' }); return; }
        const db = client.db(dbName);
        await db.dropDatabase();
        res.json({ success: true });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Drop database failed' });
      }
    });

    router.post('/db/recreate', requireRole('super_admin'), async (req, res) => {
      try {
        const body = req.body || {};
        const dbName = String(body.db || config.storage.mongodb.database);
        const expected = `recreate ${dbName}`;
        if (body.confirm !== expected) { res.status(400).json({ success: false, message: `Type '${expected}' to confirm` }); return; }
        const inst: any = (storage as any).getStorageInstance?.() || null;
        const client = inst?.client;
        if (!client || typeof client.db !== 'function') { res.status(500).json({ success: false, message: 'DB client not available' }); return; }
        const db = client.db(dbName);
        await db.dropDatabase();
        await storage.close();
        await storage.initialize();
        try { await storage.createDefaultData(); } catch {}
        res.json({ success: true, recreated: true, db: dbName });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Recreate database failed' });
      }
    });

    router.get('/db/indexes', requireRole('admin'), async (req, res) => {
      try {
        const dbName = String((req.query.db as string) || config.storage.mongodb.database);
        const collection = String((req.query.collection as string) || '');
        if (!collection) { res.status(400).json({ success: false, message: 'collection required' }); return; }
        const inst: any = (storage as any).getStorageInstance?.() || null;
        const client = inst?.client;
        if (!client) { res.status(500).json({ success: false, message: 'DB client not available' }); return; }
        const db = client.db(dbName);
        const coll = db.collection(collection);
        const data = await coll.indexes();
        res.json({ success: true, data });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to list indexes' });
      }
    });

    router.post('/db/indexes/create', requireRole('super_admin'), async (req, res) => {
      try {
        const body = req.body || {};
        const dbName = String(body.db || config.storage.mongodb.database);
        const collection = String(body.collection || '');
        const keys = body.keys;
        const options = body.options || {};
        if (!collection || !keys) { res.status(400).json({ success: false, message: 'collection and keys required' }); return; }
        const inst: any = (storage as any).getStorageInstance?.() || null;
        const client = inst?.client;
        if (!client) { res.status(500).json({ success: false, message: 'DB client not available' }); return; }
        const db = client.db(dbName);
        const coll = db.collection(collection);
        const name = await coll.createIndex(keys, options);
        res.json({ success: true, name });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Create index failed' });
      }
    });

    router.post('/db/indexes/drop', requireRole('super_admin'), async (req, res) => {
      try {
        const body = req.body || {};
        const dbName = String(body.db || config.storage.mongodb.database);
        const collection = String(body.collection || '');
        const name = String(body.name || '');
        if (!collection || !name) { res.status(400).json({ success: false, message: 'collection and name required' }); return; }
        const inst: any = (storage as any).getStorageInstance?.() || null;
        const client = inst?.client;
        if (!client) { res.status(500).json({ success: false, message: 'DB client not available' }); return; }
        const db = client.db(dbName);
        const coll = db.collection(collection);
        await coll.dropIndex(name);
        res.json({ success: true });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Drop index failed' });
      }
    });

    router.post('/db/insert-one', requireRole('admin'), async (req, res) => {
      try {
        const body = req.body || {};
        const dbName = String(body.db || config.storage.mongodb.database);
        const collection = String(body.collection || '');
        const doc = body.doc;
        if (!collection || !doc) { res.status(400).json({ success: false, message: 'collection and doc required' }); return; }
        const inst: any = (storage as any).getStorageInstance?.() || null;
        const client = inst?.client;
        if (!client) { res.status(500).json({ success: false, message: 'DB client not available' }); return; }
        const db = client.db(dbName);
        const coll = db.collection(collection);
        const result = await coll.insertOne(doc);
        res.json({ success: true, insertedId: (result as any)?.insertedId });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Insert failed' });
      }
    });

    router.post('/db/update-one', requireRole('admin'), async (req, res) => {
      try {
        const body = req.body || {};
        const dbName = String(body.db || config.storage.mongodb.database);
        const collection = String(body.collection || '');
        const filter = typeof body.filter === 'string' ? (body.filter ? JSON.parse(body.filter) : {}) : (body.filter || {});
        const update = typeof body.update === 'string' ? (body.update ? JSON.parse(body.update) : {}) : (body.update || {});
        if (!collection || !filter || !update) { res.status(400).json({ success: false, message: 'collection, filter, update required' }); return; }
        const inst: any = (storage as any).getStorageInstance?.() || null;
        const client = inst?.client;
        if (!client) { res.status(500).json({ success: false, message: 'DB client not available' }); return; }
        const db = client.db(dbName);
        const coll = db.collection(collection);
        const norm = (f: any) => {
          try {
            if (f && typeof f === 'object' && f._id) {
              if (typeof f._id === 'string' && ObjectId.isValid(f._id)) f._id = new ObjectId(f._id);
              if (f._id && f._id.$in && Array.isArray(f._id.$in)) f._id.$in = f._id.$in.map((x: any)=> (typeof x === 'string' && ObjectId.isValid(x)) ? new ObjectId(x) : x);
            }
          } catch {}
          return f;
        };
        const result = await coll.updateOne(norm(filter), { $set: update });
        res.json({ success: true, modifiedCount: (result as any)?.modifiedCount || 0 });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Update failed' });
      }
    });

    router.post('/db/delete-one', requireRole('admin'), async (req, res) => {
      try {
        const body = req.body || {};
        const dbName = String(body.db || config.storage.mongodb.database);
        const collection = String(body.collection || '');
        const filter = typeof body.filter === 'string' ? (body.filter ? JSON.parse(body.filter) : {}) : (body.filter || {});
        if (!collection || !filter) { res.status(400).json({ success: false, message: 'collection and filter required' }); return; }
        const inst: any = (storage as any).getStorageInstance?.() || null;
        const client = inst?.client;
        if (!client) { res.status(500).json({ success: false, message: 'DB client not available' }); return; }
        const db = client.db(dbName);
        const coll = db.collection(collection);
        const norm = (f: any) => {
          try {
            if (f && typeof f === 'object' && f._id) {
              if (typeof f._id === 'string' && ObjectId.isValid(f._id)) f._id = new ObjectId(f._id);
              if (f._id && f._id.$in && Array.isArray(f._id.$in)) f._id.$in = f._id.$in.map((x: any)=> (typeof x === 'string' && ObjectId.isValid(x)) ? new ObjectId(x) : x);
            }
          } catch {}
          return f;
        };
        const result = await coll.deleteOne(norm(filter));
        res.json({ success: true, deletedCount: (result as any)?.deletedCount || 0 });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Delete failed' });
      }
    });

    router.post('/db/delete-by-user', requireRole('admin'), async (req, res) => {
      try {
        const body = req.body || {};
        const dbName = String(body.db || config.storage.mongodb.database);
        const collections = Array.isArray(body.collections) ? body.collections as string[] : [String(body.collection || '')].filter(Boolean);
        const userIdField = String(body.userIdField || 'userId');
        const value = body.value;
        if (!collections.length || value === undefined) { res.status(400).json({ success: false, message: 'collections and value required' }); return; }
        const inst: any = (storage as any).getStorageInstance?.() || null;
        const client = inst?.client;
        if (!client) { res.status(500).json({ success: false, message: 'DB client not available' }); return; }
        const db = client.db(dbName);
        let deletedTotal = 0;
        const details: any[] = [];
        for (const c of collections) {
          const coll = db.collection(c);
          const r = await coll.deleteMany({ [userIdField]: value } as any);
          const n = (r as any)?.deletedCount || 0;
          deletedTotal += n;
          details.push({ collection: c, deleted: n });
        }
        res.json({ success: true, deletedTotal, details });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Delete by user failed' });
      }
    });

    router.get('/db/export', requireRole('admin'), async (req, res) => {
      try {
        const dbName = String((req.query.db as string) || config.storage.mongodb.database);
        const collection = String((req.query.collection as string) || '');
        const format = String((req.query.format as string) || 'json');
        if (!collection) { res.status(400).json({ success: false, message: 'collection required' }); return; }
        const filter = req.query.filter ? JSON.parse(String(req.query.filter)) : {};
        const projection = req.query.projection ? JSON.parse(String(req.query.projection)) : undefined;
        const sort = req.query.sort ? JSON.parse(String(req.query.sort)) : undefined;
        const limit = Math.min(50000, Math.max(1, Number(req.query.limit || 1000)));
        const inst: any = (storage as any).getStorageInstance?.() || null;
        const client = inst?.client;
        if (!client) { res.status(500).json({ success: false, message: 'DB client not available' }); return; }
        const db = client.db(dbName);
        const coll = db.collection(collection);
        let cursor = coll.find(filter, { projection: projection as any });
        if (sort) cursor = cursor.sort(sort as any);
        const raw = await cursor.limit(limit).toArray();
        const data = raw.map((d: any)=> d && d._id && d._id.toString ? { ...d, _id: d._id.toString() } : d);
        if (format === 'csv') {
          const keys: string[] = Array.from(new Set<string>(data.flatMap((d: any)=> Object.keys(d||{})))) as string[];
          const esc = (s: any) => {
            const v = s === null || s === undefined ? '' : typeof s === 'string' ? s : JSON.stringify(s);
            return '"' + v.replace(/"/g, '""') + '"';
          };
          const header = keys.join(',');
          const rows = data.map(d => keys.map((k: string) => esc((d as any)[k as string])).join(',')).join('\n');
          const body = header + '\n' + rows;
          res.setHeader('Content-Type', 'text/csv');
          res.setHeader('Content-Disposition', `attachment; filename="${collection}.csv"`);
          res.status(200).send(body);
        } else {
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Content-Disposition', `attachment; filename="${collection}.json"`);
          res.status(200).send(JSON.stringify(data));
        }
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Export failed' });
      }
    });

    router.post('/db/import', requireRole('admin'), async (req, res) => {
      try {
        const body = req.body || {};
        const dbName = String(body.db || config.storage.mongodb.database);
        const collection = String(body.collection || '');
        const docs = Array.isArray(body.docs) ? body.docs : [];
        if (!collection || docs.length === 0) { res.status(400).json({ success: false, message: 'collection and docs required' }); return; }
        const inst: any = (storage as any).getStorageInstance?.() || null;
        const client = inst?.client;
        if (!client) { res.status(500).json({ success: false, message: 'DB client not available' }); return; }
        const db = client.db(dbName);
        const coll = db.collection(collection);
        const r = await coll.insertMany(docs, { ordered: false });
        res.json({ success: true, inserted: (r as any)?.insertedCount || docs.length });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Import failed' });
      }
    });

    router.post('/db/aggregate', requireRole('viewer'), async (req, res) => {
      try {
        const body = req.body || {};
        const dbName = String(body.db || config.storage.mongodb.database);
        const collection = String(body.collection || '');
        const pipeline = Array.isArray(body.pipeline) ? body.pipeline : [];
        if (!collection) { res.status(400).json({ success: false, message: 'collection required' }); return; }
        const inst: any = (storage as any).getStorageInstance?.() || null;
        const client = inst?.client;
        if (!client) { res.status(500).json({ success: false, message: 'DB client not available' }); return; }
        const db = client.db(dbName);
        const coll = db.collection(collection);
        const raw = await coll.aggregate(pipeline as any).limit(1000).toArray();
        const data = raw.map((d: any)=> d && d._id && d._id.toString ? { ...d, _id: d._id.toString() } : d);
        res.json({ success: true, data });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Aggregate failed' });
      }
    });

    router.get('/db/schema-analyze', requireRole('viewer'), async (req, res) => {
      try {
        const dbName = String((req.query.db as string) || config.storage.mongodb.database);
        const collection = String((req.query.collection as string) || '');
        const sample = Math.min(5000, Math.max(50, Number(req.query.sample || 500)));
        if (!collection) { res.status(400).json({ success: false, message: 'collection required' }); return; }
        const inst: any = (storage as any).getStorageInstance?.() || null;
        const client = inst?.client;
        if (!client) { res.status(500).json({ success: false, message: 'DB client not available' }); return; }
        const db = client.db(dbName);
        const coll = db.collection(collection);
        const docs = await coll.aggregate([{ $sample: { size: sample } } as any]).toArray();
        const fields: Record<string, any> = {};
        const visit = (obj: any, prefix = '') => {
          if (!obj || typeof obj !== 'object') return;
          for (const k of Object.keys(obj)) {
            const v = (obj as any)[k];
            const name = prefix ? `${prefix}.${k}` : k;
            if (!fields[name]) fields[name] = { name, total: 0, types: {}, examples: [] };
            fields[name].total++;
            let t = Array.isArray(v) ? 'array' : (v === null ? 'null' : typeof v);
            if (t === 'string' && v && v.length >= 20 && !isNaN(Date.parse(v))) t = 'date';
            fields[name].types[t] = (fields[name].types[t] || 0) + 1;
            if (fields[name].examples.length < 3) fields[name].examples.push(v);
            if (t === 'object') visit(v, name);
          }
        };
        for (const d of docs) visit(d);
        const result = Object.values(fields).map((f: any) => ({
          name: f.name,
          presence: f.total / docs.length,
          types: f.types,
          examples: f.examples
        }));
        res.json({ success: true, data: result });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Schema analyze failed' });
      }
    });

    router.post('/db/explain', requireRole('viewer'), async (req, res) => {
      try {
        const body = req.body || {};
        const dbName = String(body.db || config.storage.mongodb.database);
        const collection = String(body.collection || '');
        if (!collection) { res.status(400).json({ success: false, message: 'collection required' }); return; }
        const filter = body.filter || {};
        const projection = body.projection || undefined;
        const sort = body.sort || undefined;
        const limit = Math.min(1000, Math.max(1, Number(body.limit || 100)));
        const inst: any = (storage as any).getStorageInstance?.() || null;
        const client = inst?.client;
        if (!client) { res.status(500).json({ success: false, message: 'DB client not available' }); return; }
        const db = client.db(dbName);
        const coll = db.collection(collection);
        let cursor = coll.find(filter, { projection: projection as any });
        if (sort) cursor = cursor.sort(sort as any);
        const explain = await cursor.limit(limit).explain('executionStats' as any);
        res.json({ success: true, data: explain });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Explain failed' });
      }
    });

    router.use('/settings', requireAuth);
    router.get('/settings/admin-users', requireRole('admin'), async (_req, res) => {
      try {
        const admins = await storage.listAdminUsers();
        const safe = admins.map(a => ({ id: a.id, username: a.username, role: a.role, isActive: a.isActive, firstName: a.firstName, email: a.email, createdAt: a.createdAt, lastLoginAt: a.lastLoginAt }));
        res.json({ success: true, data: safe });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to load admin users' });
      }
    });
    router.post('/settings/admin-users', requireRole('super_admin'), async (req, res) => {
      try {
        const { username, password, role, firstName, email } = req.body || {};
        if (!username || !password || !role) { res.status(400).json({ success: false, message: 'username, password, role required' }); return; }
        const hashedPassword = await bcrypt.hash(String(password), 10);
        const id = `admin_${Date.now()}`;
        const admin = { id, username: String(username), hashedPassword, role: String(role), isActive: true, firstName: firstName || '', email: email || '', permissions: [], createdAt: new Date().toISOString(), metadata: { loginCount: 0 } } as any;
        await storage.createAdminUser(admin);
        res.json({ success: true, id });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to create admin user' });
      }
    });
    router.put('/settings/admin-users/:id', requireRole('super_admin'), async (req, res) => {
      try {
        const id = String(req.params.id);
        const updates: any = {};
        const body = req.body || {};
        if (body.role) updates.role = String(body.role);
        if (typeof body.isActive === 'boolean') updates.isActive = body.isActive;
        if (body.firstName !== undefined) updates.firstName = String(body.firstName);
        if (body.email !== undefined) updates.email = String(body.email);
        await storage.updateAdminUser(id, updates);
        res.json({ success: true });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to update admin user' });
      }
    });
    router.post('/settings/admin-users/:id/password', requireRole('super_admin'), async (req, res) => {
      try {
        const id = String(req.params.id);
        const { newPassword } = req.body || {};
        if (!newPassword) { res.status(400).json({ success: false, message: 'newPassword required' }); return; }
        const hashedPassword = await bcrypt.hash(String(newPassword), 10);
        await storage.updateAdminUser(id, { hashedPassword } as any);
        res.json({ success: true });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to change password' });
      }
    });

    // Support ticket routes
    router.use('/support', requireAuth);
    router.get('/support/tickets', requireRole('moderator'), async (req, res) => {
      try {
        const page = Math.max(1, Number(req.query.page ?? 1) || 1);
        const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize ?? 20) || 20));
        const status = req.query.status as string | undefined;
        const category = req.query.category as string | undefined;
        const search = req.query.search as string | undefined;
        
        const query: any = { type: 'support_ticket' };
        if (status && status !== 'all') query.status = status;
        if (category && category !== 'all') query.category = category;
        if (search) {
          query.$or = [
            { message: { $regex: search, $options: 'i' } },
            { username: { $regex: search, $options: 'i' } },
            { firstName: { $regex: search, $options: 'i' } },
            { id: { $regex: search, $options: 'i' } }
          ];
        }
        
        const skip = (page - 1) * pageSize;
        const total = await storage.countDocuments('messages', query);
        const tickets = await storage.findByQuery<any>('messages', query, {
          sort: { createdAt: -1 },
          skip,
          limit: pageSize
        });
        
        res.json({ success: true, data: tickets, total, page, pageSize });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to load support tickets' });
      }
    });
    
    router.get('/support/tickets/:id', requireRole('moderator'), async (req, res) => {
      try {
        const id = String(req.params.id);
        const ticket = await storage.get('messages', id);
        if (!ticket || (ticket as any).type !== 'support_ticket') {
          res.status(404).json({ success: false, message: 'Ticket not found' });
          return;
        }
        res.json({ success: true, data: ticket });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to load ticket' });
      }
    });
    
    router.post('/support/tickets/:id/reply', requireRole('moderator'), async (req, res) => {
      try {
        const id = String(req.params.id);
        const { message } = req.body || {};
        if (!message || !String(message).trim()) {
          res.status(400).json({ success: false, message: 'Reply message is required' });
          return;
        }
        
        logger.info(`Admin replying to support ticket: ${id}`);
        
        const ticket = await storage.get('messages', id);
        if (!ticket || (ticket as any).type !== 'support_ticket') {
          res.status(404).json({ success: false, message: 'Ticket not found' });
          return;
        }
        
        const ticketData = ticket as any;
        const userId = ticketData.userId;
        if (!userId) {
          res.status(400).json({ success: false, message: 'User ID not found in ticket' });
          return;
        }
        
        logger.info(`Sending reply to user: ${userId} for ticket: ${id}`);
        
        // Get user info to verify they exist
        const user = await storage.getUser(userId);
        if (!user) {
          logger.warn(`User ${userId} not found in database, but proceeding with reply`);
        } else {
          logger.info(`User found: ${user.firstName} (@${user.username})`);
        }
        
        // Send reply via Telegram using broadcast service
        const replyText = `📩 <b>Support Reply</b>\n\n` +
          `🎫 Ticket: <code>${id.slice(-8)}</code>\n` +
          `📂 Category: <b>${ticketData.categoryLabel || ticketData.category}</b>\n\n` +
          `💬 <b>Admin Reply:</b>\n${String(message).trim()}\n\n` +
          `⏰ ${new Date().toLocaleString()}`;
        
        logger.info(`Queueing broadcast reply with text length: ${replyText.length}`);
        
        let broadcastId: string;
        try {
          broadcastId = await BroadcastQueueService.getInstance().queueBroadcast({
            type: 'text',
            message: replyText,
            targetType: 'specific',
            targetUsers: [String(userId)]
          });
          logger.info(`Broadcast queued successfully with ID: ${broadcastId}`);
        } catch (broadcastError: any) {
          logger.error(`Failed to queue broadcast: ${broadcastError.message}`);
          res.status(500).json({ success: false, message: 'Failed to queue reply broadcast: ' + broadcastError.message });
          return;
        }
        
        // Update ticket status and add reply info
        const updates = {
          ...ticketData,
          status: 'replied',
          lastReply: {
            message: String(message).trim(),
            adminUser: (req as any).admin?.username || 'Admin',
            sentAt: new Date().toISOString(),
            broadcastId
          },
          updatedAt: new Date().toISOString()
        };
        
        try {
          await storage.set('messages', updates, id);
          logger.info(`Ticket ${id} updated with reply info`);
        } catch (updateError: any) {
          logger.error(`Failed to update ticket: ${updateError.message}`);
          res.status(500).json({ success: false, message: 'Reply queued but failed to update ticket: ' + updateError.message });
          return;
        }
        
        res.json({ 
          success: true, 
          broadcastId, 
          replied: true,
          userId: userId,
          userName: user?.firstName || 'Unknown'
        });
        
      } catch (e: any) {
        logger.error(`Support ticket reply error: ${e.message}`, e);
        res.status(500).json({ success: false, message: e?.message || 'Failed to send reply' });
      }
    });
    
    router.post('/support/tickets/:id/status', requireRole('moderator'), async (req, res) => {
      try {
        const id = String(req.params.id);
        const { status } = req.body || {};
        
        const validStatuses = ['open', 'in_progress', 'replied', 'resolved', 'closed'];
        if (!status || !validStatuses.includes(status)) {
          res.status(400).json({ success: false, message: 'Invalid status. Must be one of: ' + validStatuses.join(', ') });
          return;
        }
        
        const ticket = await storage.get('messages', id);
        if (!ticket || (ticket as any).type !== 'support_ticket') {
          res.status(404).json({ success: false, message: 'Ticket not found' });
          return;
        }
        
        const updates = {
          ...(ticket as any),
          status,
          updatedAt: new Date().toISOString()
        };
        
        await storage.set('messages', updates, id);
        
        res.json({ success: true });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to update ticket status' });
      }
    });
    
    router.post('/support/test-broadcast', requireRole('admin'), async (req, res) => {
      try {
        const { userId, message } = req.body || {};
        if (!userId || !message) {
          res.status(400).json({ success: false, message: 'userId and message are required' });
          return;
        }
        
        logger.info(`Testing broadcast to user: ${userId} with message: ${message}`);
        
        const testText = `🧪 <b>Test Message</b>\n\n${String(message)}\n\n⏰ ${new Date().toLocaleString()}`;
        
        const broadcastId = await BroadcastQueueService.getInstance().queueBroadcast({
          type: 'text',
          message: testText,
          targetType: 'specific',
          targetUsers: [String(userId)]
        });
        
        logger.info(`Test broadcast queued with ID: ${broadcastId}`);
        
        res.json({ success: true, broadcastId, message: 'Test broadcast queued successfully' });
      } catch (e: any) {
        logger.error(`Test broadcast error: ${e.message}`, e);
        res.status(500).json({ success: false, message: e?.message || 'Failed to send test broadcast' });
      }
    });
    




    
    router.get('/support/stats', requireRole('viewer'), async (_req, res) => {
      try {
        const query = { type: 'support_ticket' };
        const total = await storage.countDocuments('messages', query);
        const open = await storage.countDocuments('messages', { ...query, status: 'open' });
        const inProgress = await storage.countDocuments('messages', { ...query, status: 'in_progress' });
        const replied = await storage.countDocuments('messages', { ...query, status: 'replied' });
        const resolved = await storage.countDocuments('messages', { ...query, status: 'resolved' });
        const closed = await storage.countDocuments('messages', { ...query, status: 'closed' });
        
        // Get category breakdown
        const categories = await storage.findByQuery('messages', query, { projection: { category: 1 } });
        const categoryStats = categories.reduce((acc: any, ticket: any) => {
          const cat = ticket.category || 'general';
          acc[cat] = (acc[cat] || 0) + 1;
          return acc;
        }, {});
        
        const data = {
          total,
          byStatus: { open, inProgress, replied, resolved, closed },
          byCategory: categoryStats
        };
        
        res.json({ success: true, data });
      } catch (e: any) {
        res.status(500).json({ success: false, message: e?.message || 'Failed to load support stats' });
      }
    });

    this.app.use('/api/admin', router);
  }

  private registerStatic() {
    const adminBuildCandidates = [
      process.env.ADMIN_FRONTEND_BUILD_PATH,
      path.join(config.paths.root, 'dist', 'admin', 'frontend', 'dist')
    ].filter(Boolean) as string[];

    const buildDir = adminBuildCandidates.find(p => p && p.length > 0 && p.trim() && require('fs').existsSync(p));
    if (buildDir) {
      this.app.use('/admin', express.static(buildDir, { index: 'index.html', extensions: ['html'], setHeaders: (res, filePath) => {
        if (filePath.endsWith('index.html')) {
          res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
          res.setHeader('Pragma', 'no-cache');
          res.setHeader('Expires', '0');
        } else {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      } }));
      this.app.get('/admin', (_req, res) => {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        res.sendFile(path.join(buildDir, 'index.html'));
      });
      this.app.get('/admin/*', (_req, res) => {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        res.sendFile(path.join(buildDir, 'index.html'));
      });
      this.app.get('/', (_req, res) => res.redirect('/admin/'));
    } else {
      this.app.get('/admin*', (_req, res) => {
        res.status(200).send('Admin frontend not found. Build and copy assets first.');
      });
    }
  }
}

export function createAdminServer(opts?: AdminServerOptions) {
  return new AdminServer(opts);
}