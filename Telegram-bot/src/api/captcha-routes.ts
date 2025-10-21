import { Router, Request, Response } from 'express';
import { CaptchaService } from '../services/captcha-service';
import { SecurityManager } from '../security';
import { StorageManager } from '../storage';
import { Logger } from '../services/logger';
import { DeviceFingerprintService } from '../security/device-fingerprint.service';
import rateLimit from 'express-rate-limit';
import { safeJSONParse, validateUserID } from '../services/validation.service';

// Extend Request typing for this module
declare global {
  namespace Express {
    interface Request {
      telegramUser?: any;
    }
  }
}

const router = Router();
const captchaService = CaptchaService.getInstance();
const securityManager = SecurityManager.getInstance();
const storage = StorageManager.getInstance();
const logger = Logger.getInstance();
const deviceFingerprint = new DeviceFingerprintService();

// Rate limiting for captcha endpoints
const captchaRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 requests per window
  message: { error: 'Too many captcha requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

const verificationRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 5, // 5 verification attempts per window
  message: { error: 'Too many verification attempts. Please wait before trying again.' },
  standardHeaders: true,
  legacyHeaders: false
});

// Middleware to validate Telegram Web App data
const validateTelegramData = async (req: Request, res: Response, next: Function): Promise<void> => {
  try {
    const initData = req.headers['x-telegram-init-data'] as string;
    
    if (!initData) {
      res.status(401).json({ error: 'Telegram authentication required' });
      return;
    }

    // Parse and validate init data
    const urlParams = new URLSearchParams(initData);
    const user = urlParams.get('user');
    
    if (!user) {
      res.status(401).json({ error: 'Invalid Telegram data' });
      return;
    }

    const userResult = safeJSONParse<any>(user);
    if (!userResult.success) {
      logger.error('Invalid user data format:', userResult.error);
      res.status(401).json({ error: 'Invalid user data format' });
      return;
    }
    
    req.telegramUser = userResult.data;
    return next();
  } catch (error) {
    logger.error('Telegram validation error:', error);
    res.status(500).json({ error: 'Authentication validation failed' });
    return;
  }
};

// Create captcha session
router.post('/session', captchaRateLimit, validateTelegramData, async (req: Request, res: Response): Promise<void> => {
  try {
    const { deviceInfo, captchaType = 'svg' } = req.body;
    const userIdValidation = validateUserID(req.telegramUser?.id);
    if (!userIdValidation.valid) {
      res.status(400).json({ error: userIdValidation.error });
      return;
    }
    
    const userId = userIdValidation.sanitized!;

    if (!deviceInfo) {
      res.status(400).json({ error: 'Device information is required' });
      return;
    }

    // Enhanced device info with request metadata
    const enhancedDeviceInfo = {
      ...deviceInfo,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      geo: await getGeoLocation(req.ip),
      timestamp: new Date().toISOString()
    };

    // Create captcha session
    const session = await captchaService.createSession(userId, captchaType, enhancedDeviceInfo);

    // Remove sensitive data from response
    const publicSession = {
      id: session.id,
      userId: session.userId,
      type: session.type,
      challenge: {
        ...session.challenge,
        // Don't send the answer to the client
        answer: undefined
      },
      attempts: session.attempts,
      maxAttempts: session.maxAttempts,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt
    };

    logger.info('Captcha session created', {
      sessionId: session.id,
      userId,
      captchaType,
      difficulty: session.challenge.difficulty
    });

    res.json({ 
      success: true, 
      session: publicSession 
    });
    return;

  } catch (error) {
    logger.error('Create captcha session error:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Failed to create captcha session';
    res.status(500).json({ error: errorMessage });
  }
});

// Verify captcha submission
router.post('/verify', verificationRateLimit, validateTelegramData, async (req: Request, res: Response): Promise<void> => {
  try {
    const { sessionId, answer, timeTaken, interactions, deviceInfo, metadata } = req.body;
    
    const userIdValidation = validateUserID(req.telegramUser?.id);
    if (!userIdValidation.valid) {
      res.status(400).json({ error: userIdValidation.error });
      return;
    }
    const userId = userIdValidation.sanitized!;

    if (!sessionId || !answer) {
      res.status(400).json({ error: 'Session ID and answer are required' });
      return;
    }

    // Get session and validate ownership
    const session = await storage.getCaptchaSession(sessionId);
    
    if (!session) {
      res.status(404).json({ error: 'Captcha session not found' });
      return;
    }

    if (session.userId !== userId) {
      res.status(403).json({ error: 'Session does not belong to user' });
      return;
    }

    // Check if session is expired
    if (new Date() > new Date(session.expiresAt)) {
      res.status(410).json({ error: 'Captcha session has expired' });
      return;
    }

    // Check if max attempts exceeded
    if (session.attempts >= session.maxAttempts) {
      res.status(429).json({ error: 'Maximum attempts exceeded' });
      return;
    }

    // Enhanced device info
    const enhancedDeviceInfo = {
      ...deviceInfo,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      timestamp: new Date().toISOString()
    };

    // Verify captcha
    const result = await captchaService.verifyCaptcha(
      sessionId,
      answer,
      enhancedDeviceInfo,
      timeTaken
    );

    // Additional security checks
    // Optional security context if available in this build
    const smAny: any = securityManager as any;
    const securityContext = typeof smAny.createSecurityContext === 'function'
      ? await smAny.createSecurityContext(userId, {
          ip: req.ip,
          userAgent: req.get('User-Agent'),
          deviceInfo: enhancedDeviceInfo
        })
      : { threatLevel: 'low', threats: [] };

    if (securityContext.threatLevel === 'high') {
      logger.warn('High threat level detected during captcha verification', {
        sessionId,
        userId,
        threatLevel: securityContext.threatLevel,
        threats: securityContext.threats
      });
      
      // Force verification failure for high-risk users
      result.success = false;
      result.suspiciousActivity = true;
    }

    logger.info('Captcha verification completed', {
      sessionId,
      userId,
      success: result.success,
      attempts: result.attempts,
      confidence: result.confidence,
      suspiciousActivity: result.suspiciousActivity
    });

    res.json({
      success: result.success,
      confidence: result.confidence,
      attempts: result.attempts,
      message: result.success 
        ? 'Verification successful' 
        : 'Verification failed. Please try again.',
      suspiciousActivity: result.suspiciousActivity,
      nextChallenge: !result.success && result.attempts < session.maxAttempts 
        ? await generateNextChallenge(session, result)
        : undefined
    });
    return;

  } catch (error) {
    logger.error('Captcha verification error:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Verification failed';
    res.status(500).json({ error: errorMessage });
  }
});

// Get captcha session (for resuming)
router.get('/session/:sessionId', validateTelegramData, async (req: Request, res: Response): Promise<void> => {
  try {
    const { sessionId } = req.params;
    const userId = req.telegramUser?.id?.toString();

    const session = await storage.getCaptchaSession(sessionId);
    
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    if (session.userId !== userId) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    // Remove sensitive data
    const publicSession = {
      id: session.id,
      userId: session.userId,
      type: session.type,
      challenge: {
        ...session.challenge,
        answer: undefined
      },
      attempts: session.attempts,
      maxAttempts: session.maxAttempts,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      completedAt: session.completedAt
    };

    res.json({ session: publicSession });
    return;

  } catch (error) {
    logger.error('Get captcha session error:', error);
    res.status(500).json({ error: 'Failed to get session' });
  }
});

// Get challenge images
router.get('/images/:challengeType', async (req: Request, res: Response): Promise<void> => {
  try {
    const { challengeType } = req.params;
    
    // Generate or serve challenge images
    const images = await generateChallengeImages(challengeType);
    
    res.json({ images });
    return;

  } catch (error) {
    logger.error('Get challenge images error:', error);
    res.status(500).json({ error: 'Failed to get challenge images' });
  }
});

// Grid images for image selection challenges
router.get('/grid-images/:imageType/:index', async (req: Request, res: Response): Promise<void> => {
  try {
    const { imageType, index } = req.params;
    const { target } = req.query;

    // Generate or serve grid image
    const imageBuffer = await generateGridImage(imageType, parseInt(index), target === 'true');
    
    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=300'); // 5 minutes cache
    res.send(imageBuffer);
    return;

  } catch (error) {
    logger.error('Get grid image error:', error);
    res.status(404).json({ error: 'Image not found' });
  }
});

// Puzzle images for puzzle challenges
router.get('/puzzle-images/:difficulty/:piece', async (req: Request, res: Response): Promise<void> => {
  try {
    const { difficulty, piece } = req.params;

    // Generate or serve puzzle piece image
    const imageBuffer = await generatePuzzlePiece(difficulty, piece);
    
    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=300');
    res.send(imageBuffer);
    return;

  } catch (error) {
    logger.error('Get puzzle image error:', error);
    res.status(404).json({ error: 'Puzzle piece not found' });
  }
});

// Notify completion to bot
router.post('/complete', validateTelegramData, async (req: Request, res: Response): Promise<void> => {
  try {
    const { sessionId, success } = req.body;
    
    const userIdValidation = validateUserID(req.telegramUser?.id);
    if (!userIdValidation.valid) {
      res.status(400).json({ error: userIdValidation.error });
      return;
    }
    const userId = userIdValidation.sanitized!;

    if (!sessionId || success === undefined) {
      res.status(400).json({ error: 'Session ID and success status are required' });
      return;
    }

    // Verify session ownership
    const session = await storage.getCaptchaSession(sessionId);
    
    if (!session || session.userId !== userId) {
      res.status(403).json({ error: 'Invalid session' });
      return;
    }

    // Update user's captcha completion status
    // Update user's captcha completion status
    await storage.updateUser(userId, {
      captchaCompleted: success,
      isVerified: success, // Set isVerified to true when captcha is successfully completed
      lastCaptchaAt: new Date().toISOString()
    });

    logger.info('Captcha completion notified', {
      sessionId,
      userId,
      success
    });

    res.json({ success: true });
    return;

  } catch (error) {
    logger.error('Captcha completion notification error:', error);
    res.status(500).json({ error: 'Failed to notify completion' });
  }
});

// Report suspicious activity
router.post('/report', validateTelegramData, async (req: Request, res: Response): Promise<void> => {
  try {
    const { sessionId, activityType, details } = req.body;
    
    const userIdValidation = validateUserID(req.telegramUser?.id);
    if (!userIdValidation.valid) {
      res.status(400).json({ error: userIdValidation.error });
      return;
    }
    const userId = userIdValidation.sanitized!;

    logger.warn('Suspicious activity reported', {
      sessionId,
      userId,
      activityType,
      details,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });

    // Store suspicious activity report
    await storage.saveSuspiciousActivity({
      sessionId,
      userId,
      activityType,
      details,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      timestamp: new Date().toISOString()
    });

    res.json({ success: true });
    return;

  } catch (error) {
    logger.error('Report suspicious activity error:', error);
    res.status(500).json({ error: 'Failed to report activity' });
  }
});

// Get captcha statistics (admin only)
router.get('/stats', async (req: Request, res: Response): Promise<void> => {
  try {
    // This would typically require admin authentication
    const stats = await captchaService.getStats();
    res.json(stats);
    return;
  } catch (error) {
    logger.error('Get captcha stats error:', error);
    res.status(500).json({ error: 'Failed to get statistics' });
  }
});

// Error reporting endpoint
router.post('/error', async (req: Request, res: Response): Promise<void> => {
  try {
    const { error, stack, errorInfo, userAgent } = req.body;

    logger.error('Client error reported', {
      error,
      stack,
      errorInfo,
      userAgent,
      ip: req.ip,
      timestamp: new Date().toISOString()
    });

    res.json({ success: true });
    return;

  } catch (err) {
    logger.error('Error reporting failed:', err);
    res.status(500).json({ error: 'Failed to report error' });
  }
});

// Health check
router.get('/health', (req: Request, res: Response): void => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    service: 'captcha-api'
  });
});

// Helper functions

async function getGeoLocation(ip: string | undefined): Promise<any> {
  // Simple geo location based on IP
  // In production, you might use a service like MaxMind GeoIP
  try {
    if (ip && (ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.'))) {
      return { country: 'localhost', city: 'localhost' };
    }
    
    // Placeholder geo data
    return { country: 'unknown', city: 'unknown' };
  } catch (error) {
    return { country: 'unknown', city: 'unknown' };
  }
}

async function generateNextChallenge(session: any, result: any): Promise<any> {
  // Generate a new challenge if the current one failed
  // This could be a harder challenge or different type
  try {
    const newDifficulty = result.confidence < 0.3 ? 'hard' : 
                         result.confidence < 0.6 ? 'medium' : 'easy';
    
    return {
      type: session.challenge.type,
      difficulty: newDifficulty,
      question: 'Please try again with more accuracy',
      instructions: 'Take your time and follow the instructions carefully'
    };
  } catch (error) {
    return null;
  }
}

async function generateChallengeImages(challengeType: string): Promise<string[]> {
  // Generate or return URLs for challenge images
  // This is a simplified implementation
  const imageCount = 9; // 3x3 grid
  const images = [];
  
  for (let i = 0; i < imageCount; i++) {
    images.push(`/api/captcha/grid-images/${challengeType}/${i}`);
  }
  
  return images;
}

async function generateGridImage(imageType: string, index: number, hasTarget: boolean): Promise<Buffer> {
  // Generate a simple colored rectangle as placeholder
  // In production, you would generate actual images with/without targets
  
  const width = 100;
  const height = 100;
  
  // Create a simple image buffer (this is a placeholder)
  // You would use a proper image generation library like sharp or canvas
  const color = hasTarget ? 'red' : 'blue';
  const svgImage = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="${color}"/>
      <text x="50" y="50" text-anchor="middle" fill="white" font-size="12">
        ${hasTarget ? imageType : 'No ' + imageType}
      </text>
    </svg>
  `;
  
  return Buffer.from(svgImage);
}

async function generatePuzzlePiece(difficulty: string, piece: string): Promise<Buffer> {
  // Generate puzzle piece image
  const [row, col] = piece.split('-').map(Number);
  const size = 70; // piece size
  
  const svgImage = `
    <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#e0e0e0" stroke="#999" stroke-width="1"/>
      <text x="${size/2}" y="${size/2}" text-anchor="middle" font-size="10" fill="#333">
        ${row}-${col}
      </text>
    </svg>
  `;
  
  return Buffer.from(svgImage);
}

export default router;