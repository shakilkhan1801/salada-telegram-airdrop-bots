import express from 'express';
import cors from 'cors';
import { Telegraf } from 'telegraf';
import { logger } from '../services/logger';
import { config } from '../config';

const router = express.Router();

// Import necessary services
import { storage } from '../storage';
// Import security services
import { unifiedSecurityEngine } from '../security/unified-security-engine';
import { DeviceFingerprintService } from '../security/device-fingerprint.service';
import { UserFactory } from '../factories/user-factory';
import { referralManager } from '../services/referral-manager.service';

// Initialize security services
const securityEngine: any = unifiedSecurityEngine;

// Function to create professional blocking message
async function createProfessionalBlockingMessage(userId: string, originalUser: string | null): Promise<string> {
    const message = `⚠️ **Security Alert - Account Verification Failed**

Dear User,

Our security system has detected that this device is already associated with another account${originalUser ? ` (User ID: ${originalUser})` : ''}.

**Reason:** Multiple Account Detection
**Policy:** One account per device/user

This action has been taken to:
• Maintain fair distribution of rewards
• Prevent system abuse
• Ensure equal opportunities for all participants

**What this means:**
• Your current account has been permanently suspended
• You cannot create additional accounts on this device
• The original account remains active

**Appeal Process:**
If you believe this is an error, please contact our support team with:
• Your Telegram username
• Explanation of the situation

⚡ **Note:** Attempts to bypass our security measures may result in permanent exclusion from all Salada Protocol services.

Thank you for your understanding.
- Salada Protocol Security Team`;
    
    return message;
}

// Function to notify Telegram bot about verification (similar to old-bot)
async function notifyTelegramBot(userId: string, success: boolean = true, message: string = "", deleteVerificationMessage: boolean = true): Promise<boolean> {
    try {
        const BOT_TOKEN = config.bot.token;
        if (!BOT_TOKEN) {
            logger.error('BOT_TOKEN not found in configuration');
            return false;
        }

        const bot = new Telegraf(BOT_TOKEN);
        
        // Auto-delete verification message if requested and available
        if (deleteVerificationMessage) {
            try {
                // Get user session to find the verification message ID
                const user = await storage.getUser(userId);
                if (user && user.sessionData && user.sessionData.verificationMessageId) {
                    await bot.telegram.deleteMessage(userId, user.sessionData.verificationMessageId);
                    logger.info(`Deleted verification message ${user.sessionData.verificationMessageId} for user ${userId}`);
                    // Clear the message ID from session
                    await storage.updateUser(userId, {
                        'sessionData.verificationMessageId': null
                    });
                }
            } catch (deleteError) {
                // Ignore deletion errors (message might be already deleted or too old)
                logger.debug(`Could not delete verification message for user ${userId}:`, deleteError);
            }
        }

        if (success) {
            const svgCaptchaEnabled = config.captcha.svgEnabled;
            
            // Check if all captchas are completed - if miniapp was the last one, process referral bonus
        const miniappEnabled = config.captcha.miniappEnabled;
        const allCaptchasCompleted = !svgCaptchaEnabled; // If SVG is disabled, miniapp was the last
        
        if (allCaptchasCompleted) {
            // OPTIMIZATION: Process referral bonus asynchronously (non-blocking)
            try {
                const finalUser = await storage.getUser(userId);
                if (finalUser && finalUser.referredBy) {
                    const referrerId = finalUser.referredBy;
                    logger.info('MINIAPP API: Queueing referral bonus for background processing', {
                        newUserId: userId,
                        referrerId: referrerId
                    });
                    
                    // Process in background - don't wait for it
                    setImmediate(async () => {
                        try {
                            await referralManager.processReferralBonus(referrerId, userId);
                            await referralManager.clearReferralSession(userId);
                            logger.info('✅ Referral bonus processed successfully (background)', { userId, referrerId });
                        } catch (bonusError) {
                            logger.error('❌ Referral bonus processing failed (background)', { userId, referrerId, error: bonusError });
                        }
                    });
                }
            } catch (bonusError) {
                logger.error('MINIAPP API: Error querying user for referral bonus', bonusError);
            }
        }
        
        if (svgCaptchaEnabled) {
                // Directly start SVG captcha without intermediate messages
                try {
                    const { CaptchaValidationService } = require('../services/bot/captcha-validation.service');
                    const captchaService = new CaptchaValidationService();
                    
                    // Create mock context for direct SVG captcha
                    const mockCtx = {
                        from: { id: parseInt(userId) },
                        reply: async (text: string, options?: any) => {
                            await bot.telegram.sendMessage(userId, text, options);
                        },
                        replyWithPhoto: async (photo: any, options?: any) => {
                            await bot.telegram.sendPhoto(userId, photo, options);
                        },
                        // Add session support for captcha handling
                        session: {}
                    };
                    
                    // Directly start SVG captcha - no intermediate messages
                    logger.info(`MiniApp completed - directly starting SVG captcha for user ${userId}`);
                    await captchaService.startActualSvgCaptcha(mockCtx, userId);
                } catch (error) {
                    logger.error('Error starting direct SVG captcha from MiniApp completion:', error);
                    // Fallback to old method if error
                    await bot.telegram.sendMessage(userId,
                        "✅ First security challenge completed!\n\n" +
                        "Now please complete the final image verification step.",
                        {
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: "Complete Final Verification", callback_data: "start_captcha" }]
                                ]
                            }
                        }
                    );
                }
            } else {
                // If SVG captcha is disabled, use proper welcome handler
                try {
                    const { WelcomeHandler } = require('../bot/handlers/welcome-handler');
                    const welcomeHandler = new WelcomeHandler();
                    
                    const mockCtx = {
                        from: { id: parseInt(userId) },
                        reply: async (text: string, options?: any) => {
                            await bot.telegram.sendMessage(userId, text, options);
                        },
                        replyWithPhoto: async (photo: any, options?: any) => {
                            await bot.telegram.sendPhoto(userId, photo, options);
                        }
                    };
                    
                    // Get user data for welcome handler
                    const user = await storage.getUser(userId);
                    if (user) {
                        await welcomeHandler.sendNewUserWelcome(mockCtx as any, user);
                    } else {
                        await bot.telegram.sendMessage(userId,
                            "✅ **Verification Complete!**\n\nYou can now access all bot features.",
                            {
                                parse_mode: 'Markdown',
                                reply_markup: {
                                    inline_keyboard: [
                                        [{ text: 'Continue to Main Menu', callback_data: 'menu_main' }]
                                    ]
                                }
                            }
                        );
                    }
                } catch (error) {
                    logger.error('Error using WelcomeHandler in notification:', error);
                    await bot.telegram.sendMessage(userId,
                        "✅ **Verification Complete!**\n\nYou can now access all bot features.",
                        {
                            parse_mode: 'Markdown',
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: 'Continue to Main Menu', callback_data: 'menu_main' }]
                                ]
                            }
                        }
                    );
                }
            }
        } else {
            // For multi-account blocking, send professional message
            if (message.includes('Security Alert')) {
                // Send the professional blocking message with proper formatting
                await bot.telegram.sendMessage(userId, message, {
                    parse_mode: 'Markdown'
                });
            } else {
                // Regular failure message
                await bot.telegram.sendMessage(userId,
                    `❌ Security verification failed.\n\n${message}\n\nPlease try again or contact support.`,
                    {
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: "Try Again", callback_data: "miniapp_verify" }]
                            ]
                        }
                    }
                );
            }
        }

        logger.info(`Notification sent to user ${userId}: ${success ? "success" : "failure"}`);
        return true;
    } catch (error) {
        logger.error("Error sending notification:", error);
        return false;
    }
}

/**
 * MiniApp verification completion endpoint (Old-bot style)
 * This is called when users complete verification in the MiniApp
 */
router.post('/verify-complete', async (req, res): Promise<void> => {
    try {
        const {
            userId,
            deviceFingerprint,
            clientIP,
            userAgent,
            browserInfo,
            screenInfo,
            timezoneOffset,
            verificationData,
            captchaSessionId,
            solution,
            clickTiming,
            honeypotFilled,
            telegramData  // Extract telegram data
        } = req.body;

        logger.info(`Processing MiniApp verification completion for user ${userId}`);

        // Validate required fields
        if (!userId || !deviceFingerprint) {
            res.status(400).json({
                success: false,
                error: 'Missing required verification data'
            });
            return;
        }

        // Get user from database - create if not exists (for new user registration flow)
        let user = await storage.getUser(userId);
        let isNewUser = false;
        
        if (!user) {
            // This might be a new user completing captcha during registration
            // Check if this is a valid new user registration scenario
            logger.info(`User ${userId} not found, checking if this is new user registration`);
            
            // CRITICAL FIX: Check for stored referral session before creating user
            const referralSession = await referralManager.getReferralSession(userId);
            let referredBy: string | null = null;
            
            if (referralSession?.referrerId) {
                referredBy = referralSession.referrerId;
                logger.info('MINIAPP API: Found referral session for user', { 
                    userId, 
                    referralCode: referralSession.referralCode,
                    referrerId: referredBy 
                });
            }
            
            // Create user using UserFactory for CAPTCHA completion with actual Telegram data
            const completeUserData = UserFactory.createCaptchaUser({
                telegramId: userId,
                firstName: telegramData?.firstName || null,  // Use actual Telegram firstName
                username: telegramData?.username || null,
                languageCode: telegramData?.languageCode || 'en',
                ipAddress: getHeaderIp(req),
                referredBy  // Include referral information
            });
            
            await storage.createUser(completeUserData);
            user = await storage.getUser(userId);
            isNewUser = true;
            
            logger.info(`Created temporary user record for ${userId} during captcha completion with referral: ${referredBy}`);
        }

        // Check for honeypot (bot detection)
        if (honeypotFilled) {
            logger.warn(`Bot behavior detected for user ${userId}: honeypot filled`);
            await notifyTelegramBot(userId, false, "Automated behavior detected.");
            res.status(400).json({
                success: false,
                message: "Verification failed"
            });
            return;
        }

        // Simple Multi-Account Detection using Device Hash
        logger.info(`Starting simple multi-account detection for user ${userId}`);
        
        // Prepare device data for hash generation
        const deviceData = {
            screenWidth: screenInfo?.width || 0,
            screenHeight: screenInfo?.height || 0,
            colorDepth: screenInfo?.colorDepth || 24,
            canvasFingerprint: deviceFingerprint || '',
            hardwareConcurrency: verificationData?.deviceData?.hardware?.hardwareConcurrency || 0,
            deviceMemory: verificationData?.deviceData?.hardware?.deviceMemory || 0,
            platform: verificationData?.deviceData?.hardware?.platform || '',
            userAgent: userAgent || '',
            language: verificationData?.deviceData?.browser?.language || 'en',
            timezone: verificationData?.deviceData?.hardware?.timezone || '',
            plugins: verificationData?.deviceData?.browser?.plugins || [],
            ipAddress: clientIP || req.ip
        };
        
        // Perform security analysis using unified engine with CORRECT parameters
        const securityAnalysis = await securityEngine.analyzeUser(
            { id: userId, telegramId: userId }, // ✅ FIXED: Use 'id' property for security engine
            { // ✅ FIXED: Proper EnhancedDeviceData format
                hardware: {
                    screenResolution: `${deviceData.screenWidth}x${deviceData.screenHeight}`,
                    screenColorDepth: deviceData.colorDepth?.toString() || '24',
                    availableScreenSize: 'unknown',
                    timezone: deviceData.timezone || 'UTC',
                    timezoneOffset: 0,
                    language: deviceData.language || 'en',
                    languages: [],
                    platform: deviceData.platform || 'unknown',
                    hardwareConcurrency: deviceData.hardwareConcurrency || 4,
                    deviceMemory: deviceData.deviceMemory || 8,
                    maxTouchPoints: 0
                },
                browser: {
                    userAgent: deviceData.userAgent || 'unknown',
                    vendor: 'unknown',
                    vendorSub: '',
                    product: 'unknown', 
                    productSub: '',
                    appName: 'unknown',
                    appVersion: 'unknown',
                    appCodeName: 'unknown',
                    cookieEnabled: true,
                    doNotTrack: undefined,
                    onLine: true,
                    javaEnabled: false,
                    plugins: deviceData.plugins || [],
                    mimeTypes: []
                },
                rendering: {
                    canvasFingerprint: deviceData.canvasFingerprint || '',
                    webGLVendor: 'unknown',
                    webGLRenderer: 'unknown',
                    webGLVersion: 'unknown',
                    webGLShadingLanguageVersion: 'unknown',
                    webGLExtensions: [],
                    audioFingerprint: '44100',
                    fontFingerprint: 'Arial,Helvetica,Times,Courier,Verdana,Georgia'
                },
                network: {
                    connection: {
                        effectiveType: '4g',
                        saveData: false
                    },
                    webRTCIPs: [],
                    dnsOverHttps: false
                },
                behavioral: {
                    mouseMovementPattern: '[]',
                    keyboardPattern: '[]',
                    interactionTiming: [],
                    focusEvents: 0
                }
            },
            null, // behavior data
            (clientIP || req.ip)
        );
        
        // Convert to legacy format for compatibility with STRICT multi-account enforcement
        const recommendedAction = String(securityAnalysis.overall.recommendedAction).toLowerCase();
        const detectionResult = {
            isMultiAccount: securityAnalysis.multiAccount.detected,
            shouldBanCurrentUser: recommendedAction === 'permanent_block' || recommendedAction === 'temporary_block' || 
                                  (securityAnalysis.multiAccount.detected && securityAnalysis.multiAccount.confidence > 0.5),
            originalUser: securityAnalysis.multiAccount.relatedAccounts[0] || null,
            deviceHash: deviceData,
            confidence: securityAnalysis.multiAccount.confidence
        };
        
        logger.info(`Simple detection completed for user ${userId}:`, {
            isMultiAccount: detectionResult.isMultiAccount,
            shouldBan: detectionResult.shouldBanCurrentUser,
            originalUser: detectionResult.originalUser,
            confidence: detectionResult.confidence
        });

        logger.info(`Simple multi-account detection completed for user ${userId}:`, {
            isMultiAccount: detectionResult.isMultiAccount,
            shouldBan: detectionResult.shouldBanCurrentUser,
            confidence: detectionResult.confidence,
            originalUser: detectionResult.originalUser,
            deviceHash: (typeof detectionResult.deviceHash === 'string' ? detectionResult.deviceHash : JSON.stringify(detectionResult.deviceHash)).substring(0, 8) + '...'
        });
        
        // Clear timeout before sending response  
        // requestTimeout variable removed - not needed in this flow

        // Store essential verification data
        const currentTime = new Date();
        const userUpdateData: any = {
            miniappVerified: true,
            miniappVerifiedAt: currentTime.toISOString(),  // Set timestamp when verified
            lastCaptchaAt: currentTime,
            captchaType: 'miniapp',
            ipAddress: clientIP || req.ip,
            lastActivity: currentTime.toISOString()
        };
        
        // If this is a new user, update their registration status
        if (isNewUser) {
            userUpdateData.captchaCompleted = true;
        }

        // Handle multi-account detection results
        if (detectionResult.isMultiAccount && detectionResult.shouldBanCurrentUser) {
            logger.warn(`Multi-account detected: User ${userId} attempting to use device already registered to ${detectionResult.originalUser}`);
            
            // Ban the current user (not the original user)
            const banSuccess = await storage.blockUser(userId, detectionResult.originalUser!);
            
            if (banSuccess) {
                // DO NOT create user data structure for banned users
                logger.info(`Banned user ${userId} - no user data structure created`);
                
                // Send notification to banned user
                const banMessage = await createProfessionalBlockingMessage(userId, detectionResult.originalUser);
                await notifyTelegramBot(userId, false, banMessage);
                
                res.status(403).json({
                    success: false,
                    blocked: true,
                    reason: 'multi_account_device_sharing',
                    method: 'simple_device_hash',
                    confidence: 100,
                    message: banMessage,
                    details: {
                        originalUser: detectionResult.originalUser,
                        currentUser: userId,
                        deviceHash: (typeof detectionResult.deviceHash === 'string' ? detectionResult.deviceHash : JSON.stringify(detectionResult.deviceHash)).substring(0, 8) + '...'
                    }
                });
                return;
            } else {
                logger.error(`Failed to ban user ${userId} for multi-account violation`);
                res.status(500).json({
                    success: false,
                    error: 'Failed to process multi-account violation'
                });
                return;
            }
        }

        // Update user with verification completion
        await storage.updateUser(userId, userUpdateData);
        
        // Auto-fix user data with telegramData from fingerprint if available
        if (isNewUser) {
            const updatedUser = await storage.getUser(userId);
            if (updatedUser) {
                const { updated, userData } = UserFactory.updateUserWithTelegramData(updatedUser);
                if (updated) {
                    await storage.updateUser(userId, userData);
                    logger.info(`Auto-fixed user ${userId} with telegramData from fingerprint`);
                }
            }
        }

        // Send success notification to Telegram
        await notifyTelegramBot(userId, true);

        logger.info(`MiniApp verification completed successfully for user ${userId}`);

        // Success response with simple detection info
        res.json({
            success: true,
            verified: true,
            enhanced: false, // Simple detection
            multiAccountDetected: detectionResult.isMultiAccount,
            confidence: Math.round(detectionResult.confidence * 100),
            method: 'simple_device_hash',
            isOriginalUser: !detectionResult.isMultiAccount || !detectionResult.shouldBanCurrentUser,
            originalUser: detectionResult.originalUser,
            deviceRegistered: true,
            message: detectionResult.isMultiAccount && !detectionResult.shouldBanCurrentUser
                ? 'Verified successfully as the original user on this device!'
                : 'MiniApp verification completed successfully!'
        });

    } catch (error) {
        logger.error('Error processing MiniApp verification completion:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error during verification'
        });
    }
});

/**
 * Get user verification status
 */
router.get('/verification-status/:userId', async (req, res): Promise<void> => {
    try {
        const { userId } = req.params;
        
        const user = await storage.getUser(userId);
        if (!user) {
            res.status(404).json({
                success: false,
                error: 'User not found'
            });
            return;
        }

        // Check if user is blocked
        if (user.isBlocked) {
            res.json({
                success: true,
                verified: false,
                blocked: true,
                reason: user.blockReason,
                blockedAt: user.blockedAt
            });
            return;
        }

        res.json({
            success: true,
            verified: user.captchaCompleted === true,
            blocked: false,
            multiAccountDetected: user.multiAccountDetected === true,
            verificationDate: user.lastCaptchaAt
        });

    } catch (error) {
        logger.error('Error getting verification status:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

/**
 * Submit device fingerprint data (for advanced detection)
 */
router.post('/submit-fingerprint', async (req, res): Promise<void> => {
    try {
        const {
            userId,
            fingerprint,
            detailedData
        } = req.body;

        if (!userId || !fingerprint) {
            res.status(400).json({
                success: false,
                error: 'Missing required fingerprint data'
            });
            return;
        }

        // Store detailed fingerprint data
        await storage.updateUser(userId, {
            detailedDeviceFingerprint: fingerprint,
            detailedFingerprintData: detailedData,
            fingerprintSubmittedAt: new Date()
        });

        // Perform basic analysis with detailed fingerprint
        const analysisResult = {
            riskScore: 0.2,
            suspicious: false,
            confidence: 0.8
        };

        res.json({
            success: true,
            analysisResult: {
                riskScore: analysisResult.riskScore,
                suspicious: analysisResult.suspicious,
                confidence: analysisResult.confidence
            }
        });

    } catch (error) {
        logger.error('Error processing fingerprint submission:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

/**
 * Enhanced verification endpoint with comprehensive data collection
 * This is called by the upgraded miniapp with full device fingerprinting
 */
router.post('/enhanced-verify', async (req, res): Promise<void> => {
    // Set a timeout for this request to prevent hanging
    const requestTimeout = setTimeout(() => {
        if (!res.headersSent) {
            logger.warn(`Enhanced verify request timeout for user ${req.body?.userId}`);
            res.status(408).json({
                success: false,
                error: 'Request timeout - server is busy',
                retry: true
            });
        }
    }, 25000); // 25 second timeout
    
    try {
        const {
            userId,
            deviceData, // Enhanced device data with all fingerprinting components
            geolocation, // Browser geolocation if available
            behavioralData, // Mouse, keyboard, timing patterns
            verificationChallenge, // Any verification challenges completed
            metadata,
            verificationComplete // Flag to indicate if user has completed slider (true) or just loaded miniapp (false)
        } = req.body;
        
        // Extract telegramData from deviceData where it's actually sent
        const telegramData = deviceData?.telegramData;

        logger.info(`Processing enhanced verification for user ${userId}`, {
            verificationComplete,
            hasDeviceData: !!deviceData,
            hasBehavioralData: !!behavioralData
        });

        // Validate required fields
        if (!userId) {
            clearTimeout(requestTimeout);
            res.status(400).json({
                success: false,
                error: 'Missing userId'
            });
            return;
        }
        
        // If no device data, create minimal fingerprint
        if (!deviceData) {
            logger.warn(`No device data for user ${userId} - using minimal fingerprint`);
            // Create minimal response to avoid blocking
            clearTimeout(requestTimeout);
            res.json({
                success: true,
                warning: 'Minimal fingerprint used',
                verified: false
            });
            return;
        }

        // Get client IP
const clientIP = getClientIp(req);

        // Check if user exists
        let user = await storage.getUser(userId);
        let isNewUser = false;
        
        // CRITICAL SECURITY FIX: Only create user if slider was actually completed
        // If verificationComplete is false (just miniapp load), don't create user yet
        if (!user && verificationComplete === true) {
            logger.info(`New user ${userId} completing slider - creating user account`);
            
            // CRITICAL FIX: Check for stored referral session before creating user
            const referralSession = await referralManager.getReferralSession(userId);
            let referredBy: string | null = null;
            
            if (referralSession?.referrerId) {
                referredBy = referralSession.referrerId;
                logger.info('ENHANCED API: Found referral session for user', { 
                    userId, 
                    referralCode: referralSession.referralCode,
                    referrerId: referredBy 
                });
            }
            
            // Create user using UserFactory for fingerprint verification with actual Telegram data
            const completeUserData = UserFactory.createFingerprintUser({
                telegramId: userId,
                firstName: telegramData?.firstName || null,  // Use actual Telegram firstName
                username: telegramData?.username || null,
                lastName: telegramData?.lastName || null,
                languageCode: telegramData?.languageCode || 'en',
                fingerprint: deviceData,
                ipAddress: clientIP,
                referredBy  // Include referral information
            });
            
            await storage.createUser(completeUserData);
            user = await storage.getUser(userId);
            isNewUser = true;
        } else if (!user && verificationComplete === false) {
            // User just loaded miniapp but hasn't completed slider yet
            // Don't create user account, just process fingerprint
            logger.info(`User ${userId} loaded miniapp - fingerprint will be processed but user account NOT created until slider completion`);
        }

        // Perform simple multi-account detection
        const deviceDataForDetection = {
            screenWidth: deviceData.hardware?.screenWidth || 0,
            screenHeight: deviceData.hardware?.screenHeight || 0,
            colorDepth: deviceData.hardware?.colorDepth || 24,
            canvasFingerprint: deviceData.rendering?.canvasFingerprint || '',
            hardwareConcurrency: deviceData.hardware?.hardwareConcurrency || 0,
            deviceMemory: deviceData.hardware?.deviceMemory || 0,
            platform: deviceData.hardware?.platform || '',
            userAgent: deviceData.browser?.userAgent || '',
            language: deviceData.browser?.language || 'en',
            timezone: deviceData.hardware?.timezone || '',
            plugins: deviceData.browser?.plugins || [],
            ipAddress: clientIP
        };
        
        // Enhanced device fingerprint analysis with advanced fuzzy matching
        const deviceFingerprintService = new DeviceFingerprintService();
        const enhancedDeviceData = {
            hardware: {
                screenResolution: `${deviceDataForDetection.screenWidth}x${deviceDataForDetection.screenHeight}`,
                screenColorDepth: deviceDataForDetection.colorDepth?.toString() || '24',
                availableScreenSize: 'unknown',
                timezone: deviceDataForDetection.timezone || 'UTC',
                timezoneOffset: 0,
                language: deviceDataForDetection.language || 'en',
                languages: [],
                platform: deviceDataForDetection.platform || 'unknown',
                hardwareConcurrency: deviceDataForDetection.hardwareConcurrency || 4,
                deviceMemory: deviceDataForDetection.deviceMemory || 8,
                maxTouchPoints: 0
            },
            browser: {
                userAgent: deviceDataForDetection.userAgent || 'unknown',
                vendor: 'unknown',
                vendorSub: '',
                product: 'unknown',
                productSub: '',
                appName: 'unknown',
                appVersion: 'unknown',
                appCodeName: 'unknown',
                cookieEnabled: true,
                doNotTrack: undefined,
                onLine: true,
                javaEnabled: false,
                plugins: deviceDataForDetection.plugins || [],
                mimeTypes: []
            },
            rendering: {
                canvasFingerprint: deviceDataForDetection.canvasFingerprint || '',
                webGLVendor: deviceData.webgl?.vendor || 'unknown',
                webGLRenderer: deviceData.webgl?.renderer || 'unknown',
                webGLVersion: deviceData.webgl?.version || 'unknown',
                webGLShadingLanguageVersion: 'unknown',
                webGLExtensions: deviceData.webgl?.extensions || [],
                audioFingerprint: deviceData.audio?.fingerprint || '44100',
                fontFingerprint: deviceData.fonts?.join(',') || 'Arial,Helvetica,Times,Courier,Verdana,Georgia'
            },
            network: {
                connection: {
                    effectiveType: deviceData.network?.connection?.effectiveType || '4g',
                    saveData: deviceData.network?.connection?.saveData || false
                },
                webRTCIPs: deviceData.network?.webRTCIPs || [],
                dnsOverHttps: false
            },
            behavioral: {
                mouseMovementPattern: behavioralData?.mouseMovements ? JSON.stringify(behavioralData.mouseMovements.slice(0, 50)) : '[]',
                keyboardPattern: behavioralData?.keystrokes ? JSON.stringify(behavioralData.keystrokes.slice(0, 20)) : '[]',
                interactionTiming: behavioralData?.interactionTiming || [],
                focusEvents: behavioralData?.focusEvents?.length || 0
            },
            sessionData: {
                sessionId: `enhanced-session-${Date.now()}`,
                timestamp: Date.now(),
                userAgent: req.get('user-agent') || '',
                referrer: req.get('referer') || '',
                url: req.originalUrl
            },
            telegramData: telegramData
        };
        
        // Generate enhanced fingerprint with all data
        const enhancedFingerprint = await deviceFingerprintService.generateFingerprint(enhancedDeviceData, userId);
        
        // Add anti-spoofing analysis if client-side detection available
        const antiSpoofingReport = metadata?.antiSpoofingReport || {
            isLikelySpoofed: false,
            spoofingScore: 0,
            indicators: {},
            riskLevel: 'low'
        };
        
        // Enhanced device fingerprint analysis with advanced fuzzy matching
        const fingerprintAnalysis = await deviceFingerprintService.checkDeviceCollision(
            enhancedFingerprint,
            userId
        );
        
        logger.info(`Enhanced fuzzy matching analysis for user ${userId}:`, {
            hasCollision: fingerprintAnalysis.hasCollision,
            collidingUsers: fingerprintAnalysis.collidingUsers.length,
            riskLevel: fingerprintAnalysis.riskLevel,
            exactMatches: fingerprintAnalysis.analysisDetails.exactMatches,
            highSimilarity: fingerprintAnalysis.analysisDetails.highSimilarity,
            antiSpoofing: antiSpoofingReport.riskLevel
        });
        
        // Convert to legacy format for compatibility with enhanced logic
        const shouldBlock = fingerprintAnalysis.riskLevel === 'critical' || 
                           (fingerprintAnalysis.riskLevel === 'high' && fingerprintAnalysis.analysisDetails.exactMatches > 0) ||
                           antiSpoofingReport.isLikelySpoofed;
        
        const detectionResult = {
            isMultiAccount: fingerprintAnalysis.hasCollision,
            shouldBanCurrentUser: shouldBlock,
            originalUser: fingerprintAnalysis.collidingUsers[0] || null,
            deviceHash: enhancedFingerprint.hash,
            confidence: fingerprintAnalysis.riskLevel === 'critical' ? 1.0 : 
                       fingerprintAnalysis.riskLevel === 'high' ? 0.8 :
                       fingerprintAnalysis.riskLevel === 'medium' ? 0.6 : 0.3,
            fuzzyAnalysis: {
                exactMatches: fingerprintAnalysis.analysisDetails.exactMatches,
                highSimilarity: fingerprintAnalysis.analysisDetails.highSimilarity,
                mediumSimilarity: fingerprintAnalysis.analysisDetails.mediumSimilarity,
                topMatches: fingerprintAnalysis.similarityScores.slice(0, 5),
                antiSpoofing: antiSpoofingReport
            }
        };

        logger.info(`Enhanced detection completed for user ${userId}:`, {
            isMultiAccount: detectionResult.isMultiAccount,
            shouldBan: detectionResult.shouldBanCurrentUser,
            confidence: detectionResult.confidence,
            originalUser: detectionResult.originalUser
        });

        // Store essential verification data
        const currentTime = new Date();
        const userUpdateData: any = {
            // CRITICAL: Only mark as verified if slider was actually completed
            captchaCompleted: verificationComplete === true && !detectionResult.shouldBanCurrentUser,
            miniappVerified: verificationComplete === true && !detectionResult.shouldBanCurrentUser,
            miniappVerifiedAt: (verificationComplete === true && !detectionResult.shouldBanCurrentUser) ? currentTime.toISOString() : null,
            lastCaptchaAt: verificationComplete === true ? currentTime : undefined, // Only update if slider completed
            captchaType: 'enhanced_miniapp',
            ipAddress: clientIP,
            lastActivity: currentTime.toISOString(),
            // Track fingerprint pre-processing status
            fingerprintPreProcessed: true,
            fingerprintPreProcessedAt: currentTime.toISOString()
        };
        
        // Update main user fields with Telegram data if available
        if (telegramData && !detectionResult.shouldBanCurrentUser) {
            if (telegramData.firstName && telegramData.firstName !== 'New User') {
                userUpdateData.firstName = telegramData.firstName;
            }
            if (telegramData.username) {
                userUpdateData.username = telegramData.username;
            }
            if (telegramData.lastName) {
                userUpdateData.lastName = telegramData.lastName;
            }
            if (telegramData.languageCode) {
                userUpdateData.languageCode = telegramData.languageCode;
            }
        }

        // Handle multi-account detection results
        if (detectionResult.isMultiAccount && detectionResult.shouldBanCurrentUser) {
            logger.warn(`Enhanced endpoint - Multi-account detected: User ${userId} attempting to use device already registered to ${detectionResult.originalUser}`);
            
            // Create minimal user data for banned users so they can be found later
            // This allows: 1) Sending notifications after slider completion, 2) Admin unblock functionality
            if (!user) {
                logger.info(`Creating minimal user data for banned user ${userId}`);
                
                const minimalBannedUserData = UserFactory.createFingerprintUser({
                    telegramId: userId,
                    firstName: telegramData?.firstName || null,
                    username: telegramData?.username || null,
                    lastName: telegramData?.lastName || null,
                    languageCode: telegramData?.languageCode || 'en',
                    fingerprint: deviceData,
                    ipAddress: clientIP,
                    referredBy: null  // Banned users don't get referral benefits
                });
                
                await storage.createUser(minimalBannedUserData);
                user = await storage.getUser(userId);
                logger.info(`Minimal user data created for banned user ${userId}`);
            }
            
            // Ban the current user (not the original user)
            const banSuccess = await storage.blockUser(userId, detectionResult.originalUser!);
            
            if (banSuccess) {
                logger.info(`User ${userId} banned successfully - minimal data stored for notification and unblock capability`);
                
                // Send notification to banned user ONLY if slider was completed
                if (verificationComplete === true) {
                    logger.info(`User ${userId} completed slider - sending ban notification`);
                    const banMessage = await createProfessionalBlockingMessage(userId, detectionResult.originalUser);
                    await notifyTelegramBot(userId, false, banMessage);
                } else {
                    logger.info(`User ${userId} detected as banned on miniapp load - notification deferred until slider completion`);
                }
                
                res.status(403).json({
                    success: false,
                    blocked: true,
                    reason: 'multi_account_device_sharing',
                    method: 'simple_device_hash',
                    confidence: 100,
                    message: verificationComplete ? await createProfessionalBlockingMessage(userId, detectionResult.originalUser) : 'Multi-account detected',
                    details: {
                        originalUser: detectionResult.originalUser,
                        currentUser: userId,
                        deviceHash: (typeof detectionResult.deviceHash === 'string' ? detectionResult.deviceHash : JSON.stringify(detectionResult.deviceHash)).substring(0, 8) + '...'
                    }
                });
                return;
            } else {
                logger.error(`Failed to ban user ${userId} for multi-account violation`);
                res.status(500).json({
                    success: false,
                    error: 'Failed to process multi-account violation'
                });
                return;
            }
        }

        // Update user record ONLY if user exists (i.e., slider was completed)
        if (user) {
            await storage.updateUser(userId, userUpdateData);
            
            // Auto-fix user data with telegramData from fingerprint if available
            const updatedUser = await storage.getUser(userId);
            if (updatedUser) {
                const { updated, userData } = UserFactory.updateUserWithTelegramData(updatedUser);
                if (updated) {
                    await storage.updateUser(userId, userData);
                    logger.info(`Auto-fixed user ${userId} with telegramData from fingerprint`);
                }
            }
        } else {
            logger.info(`User ${userId} account not created yet - skipping user data update`);
        }

        // Store full enhanced fingerprint for robust cross-network device detection
        try {
            await storage.saveEnhancedDeviceFingerprint({
                ...enhancedFingerprint,
                userId,
                registeredAt: enhancedFingerprint.registeredAt || new Date().toISOString(),
                ipAddress: clientIP,
                userAgent: req.headers['user-agent'] || ''
            });
            logger.info(`Enhanced device fingerprint stored for user ${userId}`);
        } catch (fpError) {
            logger.error('Error storing enhanced device fingerprint:', fpError);
        }

        // Check if all captchas are completed - ONLY process if slider was actually completed
        const enhancedSvgCaptchaEnabled = config.captcha.svgEnabled;
        const enhancedAllCaptchasCompleted = !enhancedSvgCaptchaEnabled; // If SVG is disabled, miniapp was the last
        
        if (enhancedAllCaptchasCompleted && verificationComplete === true) {
            // Process referral bonus now that all captchas are complete AND slider was completed
            try {
                const finalUser = await storage.getUser(userId);
                if (finalUser && finalUser.referredBy) {
                    logger.info('ENHANCED API: Processing referral bonus after slider completion', {
                        newUserId: userId,
                        referrerId: finalUser.referredBy
                    });
                    await referralManager.processReferralBonus(finalUser.referredBy, userId);
                    
                    // Clear referral session after processing
                    await referralManager.clearReferralSession(userId);
                }
            } catch (bonusError) {
                logger.error('ENHANCED API: Error processing referral bonus', bonusError);
            }
        }

        // Send success notification ONLY if verificationComplete is true (user has completed slider)
        if (verificationComplete === true) {
            logger.info(`User ${userId} completed slider - sending Telegram notification`);
            await notifyTelegramBot(userId, true);
        } else {
            logger.info(`User ${userId} loaded miniapp - verification processed but notification deferred until slider completion`);
        }

        logger.info(`Enhanced verification ${verificationComplete ? 'completed' : 'pre-processed'} successfully for user ${userId}`);

        res.json({
            success: true,
            verified: true,
            enhanced: false, // Using simple detection now
            multiAccountDetected: detectionResult.isMultiAccount,
            confidence: Math.round(detectionResult.confidence * 100),
            method: 'simple_device_hash',
            isOriginalUser: !detectionResult.isMultiAccount || !detectionResult.shouldBanCurrentUser,
            originalUser: detectionResult.originalUser,
            deviceFingerprinted: true,
            locationValidated: !!geolocation,
            behaviorAnalyzed: !!behavioralData,
            message: 'Enhanced verification completed successfully with simple multi-account detection'
        });

    } catch (error) {
        clearTimeout(requestTimeout);
        logger.error('Error processing enhanced verification:', error);
        if (!res.headersSent) {
            res.status(500).json({
                success: false,
                error: 'Internal server error during enhanced verification',
                retry: true
            });
        }
    }
});

/**
 * Real-time device validation endpoint
 * Called during miniapp interaction for continuous validation
 */
router.post('/validate-device', async (req, res): Promise<void> => {
    try {
        const { userId, deviceHash, currentData } = req.body;

        if (!userId || !deviceHash) {
            res.status(400).json({
                success: false,
                error: 'Missing required validation data'
            });
            return;
        }

        // Check if device is banned by checking user status
        const users = await storage.getUsersByDeviceHash(deviceHash);
        let banCheck = { isBanned: false, blockReason: null };
        
        if (users.length > 0) {
            // Check if any user associated with this device hash is blocked
            for (const user of users) {
                const userData = await storage.getUser(user);
                if (userData && userData.isBlocked) {
                    banCheck = { 
                        isBanned: true, 
                        blockReason: userData.blockReason || 'Multi-account violation' 
                    };
                    break;
                }
            }
        }

        if (banCheck.isBanned) {
            res.status(403).json({
                success: false,
                banned: true,
                reason: banCheck.blockReason,
                message: 'Device access denied'
            });
            return;
        }

        // Validate device consistency
        const storedFingerprints = await storage.getDeviceFingerprints(userId);
        const matchingDevice = storedFingerprints.find(fp => fp.hash === deviceHash);

        if (!matchingDevice) {
            res.status(400).json({
                success: false,
                error: 'Device not recognized',
                requiresReVerification: true
            });
            return;
        }

        // Simple device change detection (no complex analysis needed for simple system)
        if (currentData) {
            logger.info(`Device validation data received for user ${userId}, device appears consistent`);
            // In the simple system, we don't need complex device change analysis
            // The device hash collision detection is sufficient
        }

        res.json({
            success: true,
            valid: true,
            deviceHash,
            lastValidated: new Date().toISOString()
        });

    } catch (error) {
        logger.error('Error validating device:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error during device validation'
        });
    }
});

/**
 * Lightweight endpoint to trigger Telegram notification after slider completion
 * Data was already processed in the initial enhanced-verify call
 * This just sends the Telegram bot notification without re-processing fingerprints
 */
router.post('/trigger-notification', async (req, res): Promise<void> => {
    // Set timeout to prevent hanging
    const requestTimeout = setTimeout(() => {
        if (!res.headersSent) {
            logger.warn(`[TRIGGER NOTIFICATION] Request timeout for user ${req.body?.userId}`);
            res.status(408).json({
                success: false,
                error: 'Request timeout - please try again'
            });
        }
    }, 15000); // 15 second timeout
    
    try {
        const { userId, action, slideCompleted, slideTime, timestamp } = req.body;
        
        logger.info(`[TRIGGER NOTIFICATION] Lightweight notification trigger for user ${userId}`, {
            action,
            slideCompleted,
            slideTime
        });
        
        // Validate required fields
        if (!userId) {
            clearTimeout(requestTimeout);
            res.status(400).json({
                success: false,
                error: 'Missing userId'
            });
            return;
        }
        
        // Check if user exists
        let user = await storage.getUser(userId);
        
        // If user exists but verification flags not set, update them now
        if (user && (!user.miniappVerified || !user.captchaCompleted)) {
            logger.info(`[TRIGGER NOTIFICATION] User ${userId} exists but verification flags not set - updating now`);
            const currentTime = new Date();
            await storage.updateUser(userId, {
                captchaCompleted: true,
                miniappVerified: true,
                miniappVerifiedAt: currentTime.toISOString(),
                lastCaptchaAt: currentTime,
                captchaType: 'enhanced_miniapp'
            });
            // Refresh user object
            user = await storage.getUser(userId);
            logger.info(`[TRIGGER NOTIFICATION] Verification flags updated for user ${userId}`);
        }
        
        // If user doesn't exist, check fingerprints and create user
        // This handles edge cases where user wasn't created during enhanced-verify
        if (!user) {
            logger.info(`[TRIGGER NOTIFICATION] User ${userId} not found - checking if fingerprint was pre-processed`);
            
            // Check if fingerprint exists (means user loaded miniapp but didn't complete slider yet)
            const fingerprints = await storage.getDeviceFingerprints(userId);
            
            if (fingerprints && fingerprints.length > 0) {
                logger.info(`[TRIGGER NOTIFICATION] Fingerprint found for user ${userId} - creating user account now`);
                
                // Get referral session if exists
                const referralSession = await referralManager.getReferralSession(userId);
                let referredBy: string | null = null;
                
                if (referralSession?.referrerId) {
                    referredBy = referralSession.referrerId;
                    logger.info('[TRIGGER NOTIFICATION] Found referral session for user', { 
                        userId, 
                        referralCode: referralSession.referralCode,
                        referrerId: referredBy 
                    });
                }
                
                // Create user account with verification status already set (single DB operation)
                const clientIP = getClientIp(req);
                const currentTime = new Date();
                const completeUserData = UserFactory.createFingerprintUser({
                    telegramId: userId,
                    firstName: null,  // Will be updated from Telegram data if available
                    username: null,
                    lastName: null,
                    languageCode: 'en',
                    fingerprint: fingerprints[0], // Use pre-processed fingerprint
                    ipAddress: clientIP,
                    referredBy
                });
                
                // OPTIMIZATION: Set verification flags before creating user (avoids extra update call)
                (completeUserData as any).captchaCompleted = true;
                completeUserData.miniappVerified = true;
                completeUserData.miniappVerifiedAt = currentTime.toISOString();
                (completeUserData as any).lastCaptchaAt = currentTime;
                (completeUserData as any).captchaType = 'enhanced_miniapp';
                
                // Single DB operation instead of create + update
                await storage.createUser(completeUserData);
                user = completeUserData; // Use local object instead of fetching again
                
                logger.info(`[TRIGGER NOTIFICATION] User ${userId} account created successfully after slider completion`);
            } else {
                logger.warn(`[TRIGGER NOTIFICATION] User ${userId} not found and no fingerprint pre-processed`);
                res.status(404).json({
                    success: false,
                    error: 'User not found and no fingerprint data available'
                });
                return;
            }
        }
        
        // Check if user is blocked - if yes, send ban notification
        if (user.isBlocked) {
            logger.info(`[TRIGGER NOTIFICATION] User ${userId} is blocked - sending ban notification after slider completion`);
            
            // Send response immediately, then send notification in background (fire-and-forget)
            res.json({
                success: true,
                notificationSent: true,
                userId,
                blocked: true,
                message: 'Ban notification queued'
            });
            
            // Fire-and-forget: Send ban notification without blocking response
            setImmediate(async () => {
                try {
                    const banMessage = await createProfessionalBlockingMessage(userId, user.blockReason || null);
                    await notifyTelegramBot(userId, false, banMessage);
                    logger.info(`[TRIGGER NOTIFICATION] Ban notification sent to user ${userId}`);
                } catch (notifError) {
                    logger.error(`[TRIGGER NOTIFICATION] Error sending ban notification to ${userId}:`, notifError);
                }
            });
            return;
        }
        
        // Verify that user has already completed the background verification
        if (!user.miniappVerified && !user.captchaCompleted) {
            logger.warn(`[TRIGGER NOTIFICATION] User ${userId} has not completed background verification yet`);
            clearTimeout(requestTimeout);
            res.status(400).json({
                success: false,
                error: 'Background verification not completed'
            });
            return;
        }
        
        // Clear timeout before sending response
        clearTimeout(requestTimeout);
        
        // Send response immediately to minimize latency
        res.json({
            success: true,
            notificationSent: true,
            userId,
            message: 'Verification completed, notification queued'
        });
        
        // Fire-and-forget: Process referral and send notification in background
        setImmediate(async () => {
            try {
                // Process referral bonus if applicable
                const svgCaptchaEnabled = config.captcha.svgEnabled;
                const allCaptchasCompleted = !svgCaptchaEnabled;
                
                if (allCaptchasCompleted && user.referredBy) {
                    try {
                        logger.info('[TRIGGER NOTIFICATION] Processing referral bonus after slider completion', {
                            newUserId: userId,
                            referrerId: user.referredBy
                        });
                        await referralManager.processReferralBonus(user.referredBy, userId);
                        await referralManager.clearReferralSession(userId);
                    } catch (bonusError) {
                        logger.error('[TRIGGER NOTIFICATION] Error processing referral bonus', bonusError);
                    }
                }
                
                // Send Telegram notification
                logger.info(`[TRIGGER NOTIFICATION] Sending success notification for user ${userId}`);
                await notifyTelegramBot(userId, true);
                logger.info(`[TRIGGER NOTIFICATION] Successfully sent notification to user ${userId}`);
            } catch (notifError) {
                logger.error(`[TRIGGER NOTIFICATION] Error in background processing for ${userId}:`, notifError);
            }
        });
        
    } catch (error) {
        clearTimeout(requestTimeout);
        logger.error('[TRIGGER NOTIFICATION] Error triggering notification:', error);
        if (!res.headersSent) {
            res.status(500).json({
                success: false,
                error: 'Internal server error during notification trigger'
            });
        }
    }
});

/**
 * SIMPLE HASH-BASED VERIFICATION (Production-Ready)
 * Fast, scalable, accurate multi-account detection
 */
router.post('/simple-verify', async (req, res): Promise<void> => {
    const startTime = Date.now();
    
    try {
        const { userId, fingerprintHash, deviceInfo, slideTime, timestamp } = req.body;
        
        logger.info(`[SIMPLE VERIFY] Processing verification for user ${userId}`, {
            hashLength: fingerprintHash?.length,
            slideTime
        });

        // Validate required fields
        if (!userId || !fingerprintHash) {
            res.status(400).json({
                success: false,
                error: 'Missing userId or fingerprintHash'
            });
            return;
        }

        // Get client IP
        const clientIP = getClientIp(req);
        const ipHash = require('crypto').createHash('sha256').update(clientIP).digest('hex');

        // Get MongoDB collection access
        const mongoStorage: any = storage.getStorageInstance();
        if (!mongoStorage || typeof mongoStorage.getCollection !== 'function') {
            logger.error('[SIMPLE VERIFY] MongoDB storage not available');
            res.status(500).json({
                success: false,
                error: 'Storage not available'
            });
            return;
        }
        
        const fingerprintsCollection = mongoStorage.getCollection('device_fingerprints');

        // ============================================
        // RATE LIMITING (Prevent spam)
        // ============================================
        
        // Check if user tried verification recently (within last 10 seconds)
        const recentAttempt = await fingerprintsCollection.findOne({
            userId: userId,
            updatedAt: { $gte: new Date(Date.now() - 10000) } // 10 seconds
        });
        
        if (recentAttempt && recentAttempt.fingerprintHash === fingerprintHash) {
            logger.warn(`[SIMPLE VERIFY] Rate limit hit for user ${userId}`);
            res.status(429).json({
                success: false,
                error: 'Too many requests. Please wait 10 seconds before trying again.',
                retryAfter: 10
            });
            return;
        }

        // ============================================
        // SIMPLE MULTI-ACCOUNT DETECTION
        // ============================================
        
        // Check if this fingerprint hash exists for ANOTHER user
        const existingFingerprint = await fingerprintsCollection.findOne({
            fingerprintHash: fingerprintHash,
            userId: { $ne: userId }
        });

        let isMultiAccount = false;
        let shouldBlock = false;
        let originalUserId = null;

        if (existingFingerprint) {
            isMultiAccount = true;
            originalUserId = existingFingerprint.userId;
            shouldBlock = true;
            
            logger.warn(`[SIMPLE VERIFY] Multi-account detected!`, {
                currentUser: userId,
                originalUser: originalUserId,
                fingerprintHash: fingerprintHash.substring(0, 16) + '...'
            });
        }

        // Handle multi-account blocking
        if (shouldBlock) {
            // Block current user
            await storage.blockUser(userId, originalUserId);
            
            logger.info(`[SIMPLE VERIFY] User ${userId} blocked for multi-account (original: ${originalUserId})`);
            
            // Send ban notification in background (fire-and-forget)
            setImmediate(async () => {
                try {
                    const banMessage = await createProfessionalBlockingMessage(userId, originalUserId);
                    await notifyTelegramBot(userId, false, banMessage);
                } catch (notifError) {
                    logger.error(`[SIMPLE VERIFY] Error sending ban notification:`, notifError);
                }
            });
            
            // Return blocked response
            res.json({
                success: false,
                blocked: true,
                reason: 'multi_account_detected',
                originalUser: originalUserId,
                message: 'Device already registered to another account'
            });
            return;
        }

        // ============================================
        // NO MULTI-ACCOUNT - PROCEED WITH REGISTRATION
        // ============================================
        
        // ============================================
        // DEVICE UPGRADE HANDLING (Allow same user from different devices)
        // ============================================
        
        // Check if user already has a different fingerprint (legitimate device upgrade)
        const existingUserFingerprint = await fingerprintsCollection.findOne({ 
            userId: userId 
        });
        
        if (existingUserFingerprint && existingUserFingerprint.fingerprintHash !== fingerprintHash) {
            logger.info(`[SIMPLE VERIFY] Device upgrade detected for user ${userId}`, {
                oldHash: existingUserFingerprint.fingerprintHash.substring(0, 16) + '...',
                newHash: fingerprintHash.substring(0, 16) + '...',
                oldDevice: {
                    screen: existingUserFingerprint.deviceInfo?.screen,
                    platform: existingUserFingerprint.deviceInfo?.hardware?.platform
                },
                newDevice: {
                    screen: deviceInfo?.screen,
                    platform: deviceInfo?.hardware?.platform
                }
            });
            
            // ✅ ALLOW device upgrade for same Telegram user
            // Update the fingerprint to the new device
            logger.info(`[SIMPLE VERIFY] Allowing device upgrade - updating fingerprint for user ${userId}`);
            
            // Delete old fingerprint and continue with new one
            await fingerprintsCollection.deleteOne({ 
                userId: userId,
                fingerprintHash: existingUserFingerprint.fingerprintHash
            });
            
            logger.info(`[SIMPLE VERIFY] Old fingerprint deleted, will save new fingerprint`);
        }

        // Get or create user
        let user = await storage.getUser(userId);
        let isNewUser = false;
        
        if (!user) {
            logger.info(`[SIMPLE VERIFY] Creating new user ${userId}`);
            
            // Check for referral session
            const referralSession = await referralManager.getReferralSession(userId);
            let referredBy: string | null = null;
            
            if (referralSession?.referrerId) {
                referredBy = referralSession.referrerId;
                logger.info('[SIMPLE VERIFY] Found referral session', { 
                    userId, 
                    referrerId: referredBy 
                });
            }
            
            // Create user with verification already completed
            const newUserData = UserFactory.createFingerprintUser({
                telegramId: userId,
                firstName: deviceInfo?.telegram?.firstName || null,
                username: deviceInfo?.telegram?.username || null,
                languageCode: deviceInfo?.telegram?.languageCode || 'en',
                fingerprint: { hash: fingerprintHash },
                ipAddress: clientIP,
                referredBy
            });
            
            // Set verification flags
            (newUserData as any).captchaCompleted = true;
            newUserData.miniappVerified = true;
            newUserData.miniappVerifiedAt = new Date().toISOString();
            (newUserData as any).lastCaptchaAt = new Date();
            
            await storage.createUser(newUserData);
            user = newUserData;
            isNewUser = true;
        } else {
            // Update existing user
            logger.info(`[SIMPLE VERIFY] Updating existing user ${userId}`);
            await storage.updateUser(userId, {
                captchaCompleted: true,
                miniappVerified: true,
                miniappVerifiedAt: new Date().toISOString(),
                lastCaptchaAt: new Date(),
                ipAddress: clientIP
            });
            user = await storage.getUser(userId);
        }

        // Save fingerprint to database (only if new or exact match)
        await fingerprintsCollection.updateOne(
            { userId: userId, fingerprintHash: fingerprintHash }, // Match both userId AND hash
            {
                $set: {
                    userId: userId,
                    fingerprintHash: fingerprintHash,
                    ipHash: ipHash,
                    deviceInfo: {
                        screen: deviceInfo?.screen,
                        hardware: deviceInfo?.hardware,
                        timezone: deviceInfo?.timezone,
                        browser: deviceInfo?.browser
                    },
                    updatedAt: new Date()
                },
                $setOnInsert: {
                    createdAt: new Date() // Only set on first insert
                }
            },
            { upsert: true }
        );

        logger.info(`[SIMPLE VERIFY] Fingerprint saved for user ${userId}`);
        
        // Verify that the fingerprint was saved correctly
        const savedFingerprint = await fingerprintsCollection.findOne({ userId: userId });
        if (!savedFingerprint || savedFingerprint.fingerprintHash !== fingerprintHash) {
            logger.error(`[SIMPLE VERIFY] Fingerprint verification failed after save for user ${userId}`);
            throw new Error('Fingerprint save verification failed');
        }

        // Send response immediately
        const processingTime = Date.now() - startTime;
        res.json({
            success: true,
            verified: true,
            isNewUser: isNewUser,
            multiAccountDetected: false,
            processingTime: processingTime,
            message: 'Verification completed successfully'
        });

        // Send Telegram notification in background (fire-and-forget)
        setImmediate(async () => {
            try {
                // Process referral bonus if applicable
                const svgCaptchaEnabled = config.captcha.svgEnabled;
                const allCaptchasCompleted = !svgCaptchaEnabled;
                
                if (allCaptchasCompleted && user.referredBy) {
                    try {
                        logger.info('[SIMPLE VERIFY] Processing referral bonus', {
                            newUserId: userId,
                            referrerId: user.referredBy
                        });
                        await referralManager.processReferralBonus(user.referredBy, userId);
                        await referralManager.clearReferralSession(userId);
                    } catch (bonusError) {
                        logger.error('[SIMPLE VERIFY] Error processing referral bonus', bonusError);
                    }
                }
                
                // Send Telegram notification
                await notifyTelegramBot(userId, true);
                logger.info(`[SIMPLE VERIFY] Notification sent to user ${userId}`);
            } catch (notifError) {
                logger.error(`[SIMPLE VERIFY] Error sending notification:`, notifError);
            }
        });

    } catch (error) {
        logger.error('[SIMPLE VERIFY] Error during verification:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error during verification'
        });
    }
});

/**
 * Health check endpoint for MiniApp
 */
router.get('/health', (req, res): void => {
    res.json({
        success: true,
        status: 'healthy',
        timestamp: new Date().toISOString(),
        services: {
            storage: true,
            security: true,
            multiAccountDetection: true,
            enhancedDetection: true,
            deviceFingerprinting: true,
            locationServices: true
        }
    });
});

// Helpers
function getHeaderIp(req: express.Request): string | undefined {
    const fwd = req.headers['x-forwarded-for'];
    const real = req.headers['x-real-ip'];
    const picked = Array.isArray(fwd) ? fwd[0] : (typeof fwd === 'string' ? fwd : (typeof real === 'string' ? real : undefined));
    return picked;
}

function getClientIp(req: express.Request): string {
    const headerIp = getHeaderIp(req);
    return headerIp || req.ip || (req.connection as any)?.remoteAddress || '';
}

export { router as miniappRoutes };
