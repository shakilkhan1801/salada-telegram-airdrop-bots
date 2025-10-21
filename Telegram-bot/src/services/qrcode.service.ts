import * as QRCode from 'qrcode';
import { Logger } from './logger';
import { getConfig } from '../config';
import { QRCodeSession } from '../types/wallet.types';
import { StorageManager } from '../storage';
import { nanoid } from './id';

export class QRCodeService {
  private static instance: QRCodeService;
  private readonly logger = Logger.getInstance();
  private readonly config = getConfig();
  private readonly storage = StorageManager.getInstance();

  private constructor() {}

  public static getInstance(): QRCodeService {
    if (!QRCodeService.instance) {
      QRCodeService.instance = new QRCodeService();
    }
    return QRCodeService.instance;
  }

  /**
   * Generate QR code for WalletConnect URI
   */
  async generateQRCode(
    userId: string,
    uri: string,
    walletAppId?: string
  ): Promise<QRCodeSession> {
    try {
      // Check daily QR code limit
      await this.checkDailyLimit(userId);

      const sessionId = nanoid();
      const expirySeconds = this.config.wallet.qrCode.expirySeconds;
      const expiryTimestamp = Date.now() + (expirySeconds * 1000);

      // Generate QR code as data URL
      const qrCodeDataUrl = await QRCode.toDataURL(uri, {
        errorCorrectionLevel: 'M',
        type: 'image/png',
        margin: 1,
        color: {
          dark: '#000000',
          light: '#FFFFFF',
        },
        width: 256,
      });

      const session: QRCodeSession = {
        id: sessionId,
        userId,
        uri,
        qrCodeDataUrl,
        expiryTimestamp,
        expiresAt: new Date(expiryTimestamp),
        createdAt: new Date(),
        walletAppId,
        isExpired: false,
        isConnected: false,
      };

      // Save the QR code session
      await this.storage.saveQRCodeSession(session);

      this.logger.info('QR code generated successfully', {
        userId,
        sessionId,
        walletAppId,
        expiryTimestamp,
      });

      return session;
    } catch (error) {
      this.logger.error('Failed to generate QR code:', error);
      throw error;
    }
  }

  /**
   * Generate QR code as buffer for sending as photo
   */
  async generateQRCodeBuffer(uri: string): Promise<Buffer> {
    try {
      const buffer = await QRCode.toBuffer(uri, {
        errorCorrectionLevel: 'M',
        type: 'png',
        margin: 1,
        color: {
          dark: '#000000',
          light: '#FFFFFF',
        },
        width: 512, // Larger size for better scanning
      });

      return buffer;
    } catch (error) {
      this.logger.error('Failed to generate QR code buffer:', error);
      throw error;
    }
  }

  /**
   * Generate QR code with custom styling
   */
  async generateStyledQRCode(
    uri: string,
    options: {
      size?: number;
      logo?: string;
      darkColor?: string;
      lightColor?: string;
    } = {}
  ): Promise<Buffer> {
    try {
      const {
        size = 512,
        darkColor = '#1a1a1a',
        lightColor = '#ffffff',
      } = options;

      const buffer = await QRCode.toBuffer(uri, {
        errorCorrectionLevel: 'M',
        type: 'png',
        margin: 2,
        color: {
          dark: darkColor,
          light: lightColor,
        },
        width: size,
      });

      return buffer;
    } catch (error) {
      this.logger.error('Failed to generate styled QR code:', error);
      throw error;
    }
  }

  /**
   * Get QR code session by ID
   */
  async getQRCodeSession(sessionId: string): Promise<QRCodeSession | null> {
    try {
      const session = await this.storage.getQRCodeSession(sessionId);
      
      if (!session) {
        return null;
      }

      // Check if expired
      if (session.expiryTimestamp < Date.now()) {
        await this.expireQRCodeSession(sessionId);
        return { ...session, isExpired: true };
      }

      return session;
    } catch (error) {
      this.logger.error('Failed to get QR code session:', error);
      return null;
    }
  }

  /**
   * Mark QR code as scanned
   */
  async markQRCodeScanned(sessionId: string): Promise<void> {
    try {
      await this.storage.updateQRCodeSession(sessionId, {
        scannedAt: new Date(),
      });

      this.logger.info('QR code marked as scanned', { sessionId });
    } catch (error) {
      this.logger.error('Failed to mark QR code as scanned:', error);
    }
  }

  /**
   * Mark QR code as connected
   */
  async markQRCodeConnected(sessionId: string): Promise<void> {
    try {
      await this.storage.updateQRCodeSession(sessionId, {
        connectedAt: new Date(),
        isConnected: true,
      });

      this.logger.info('QR code marked as connected', { sessionId });
    } catch (error) {
      this.logger.error('Failed to mark QR code as connected:', error);
    }
  }

  /**
   * Expire QR code session
   */
  async expireQRCodeSession(sessionId: string): Promise<void> {
    try {
      await this.storage.updateQRCodeSession(sessionId, {
        isExpired: true,
      });

      this.logger.info('QR code session expired', { sessionId });
    } catch (error) {
      this.logger.error('Failed to expire QR code session:', error);
    }
  }

  /**
   * Check daily QR code generation limit
   */
  private async checkDailyLimit(userId: string): Promise<void> {
    try {
      const dailyLimit = this.config.wallet.qrCode.dailyLimit;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const todaysSessions = await this.storage.getQRCodeSessionsByDate(userId, today);
      
      if (todaysSessions.length >= dailyLimit) {
        throw new Error(`Daily QR code limit exceeded. Maximum ${dailyLimit} QR codes per day.`);
      }
    } catch (error: any) {
      if (error.message.includes('Daily QR code limit exceeded')) {
        throw error;
      }
      this.logger.error('Failed to check daily QR code limit:', error);
      // Don't throw error for limit check failures, allow generation
    }
  }

  /**
   * Clean up expired QR code sessions
   */
  async cleanupExpiredSessions(): Promise<void> {
    try {
      const now = Date.now();
      const expiredSessions = await this.storage.getExpiredQRCodeSessions(now);
      
      for (const session of expiredSessions) {
        await this.storage.deleteQRCodeSession(session.id);
      }

      if (expiredSessions.length > 0) {
        this.logger.info(`Cleaned up ${expiredSessions.length} expired QR code sessions`);
      }
    } catch (error) {
      this.logger.error('Failed to cleanup expired QR code sessions:', error);
    }
  }

  /**
   * Get QR code statistics for user
   */
  async getUserQRCodeStats(userId: string): Promise<{
    totalGenerated: number;
    totalScanned: number;
    totalConnected: number;
    todayGenerated: number;
    remainingToday: number;
  }> {
    try {
      const allSessions = await this.storage.getQRCodeSessionsByUser(userId);
      
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const todaySessions = allSessions.filter(
        session => session.createdAt >= today
      );

      const totalGenerated = allSessions.length;
      const totalScanned = allSessions.filter(s => s.scannedAt).length;
      const totalConnected = allSessions.filter(s => s.isConnected).length;
      const todayGenerated = todaySessions.length;
      const remainingToday = Math.max(0, this.config.wallet.qrCode.dailyLimit - todayGenerated);

      return {
        totalGenerated,
        totalScanned,
        totalConnected,
        todayGenerated,
        remainingToday,
      };
    } catch (error: any) {
      this.logger.error('Failed to get user QR code stats:', error);
      return {
        totalGenerated: 0,
        totalScanned: 0,
        totalConnected: 0,
        todayGenerated: 0,
        remainingToday: this.config.wallet.qrCode.dailyLimit,
      };
    }
  }

  /**
   * Get global QR code statistics
   */
  async getGlobalQRCodeStats(): Promise<{
    totalGenerated: number;
    totalScanned: number;
    totalConnected: number;
    todayGenerated: number;
    successRate: number;
    averageConnectionTime: number;
  }> {
    try {
      const allSessions = await this.storage.getAllQRCodeSessions();
      
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const todaySessions = allSessions.filter(
        session => session.createdAt >= today
      );

      const totalGenerated = allSessions.length;
      const totalScanned = allSessions.filter(s => s.scannedAt).length;
      const totalConnected = allSessions.filter(s => s.isConnected).length;
      const todayGenerated = todaySessions.length;

      const successRate = totalGenerated > 0 ? (totalConnected / totalGenerated) * 100 : 0;

      // Calculate average connection time
      const connectedSessions = allSessions.filter(s => s.connectedAt && s.scannedAt);
      const averageConnectionTime = connectedSessions.length > 0
        ? connectedSessions.reduce((sum, session) => {
            const connectionTime = new Date(session.connectedAt!).getTime() - new Date(session.scannedAt!).getTime();
            return sum + connectionTime;
          }, 0) / connectedSessions.length / 1000 // Convert to seconds
        : 0;

      return {
        totalGenerated,
        totalScanned,
        totalConnected,
        todayGenerated,
        successRate: Math.round(successRate * 100) / 100,
        averageConnectionTime: Math.round(averageConnectionTime * 100) / 100,
      };
    } catch (error) {
      this.logger.error('Failed to get global QR code stats:', error);
      return {
        totalGenerated: 0,
        totalScanned: 0,
        totalConnected: 0,
        todayGenerated: 0,
        successRate: 0,
        averageConnectionTime: 0,
      };
    }
  }

  /**
   * Generate QR code with branding
   */
  async generateBrandedQRCode(
    uri: string,
    options: {
      title?: string;
      subtitle?: string;
      logoUrl?: string;
    } = {}
  ): Promise<Buffer> {
    try {
      // For now, generate a simple QR code
      // In the future, you could use libraries like `canvas` to add branding
      const buffer = await this.generateStyledQRCode(uri, {
        size: 512,
        darkColor: '#1a1a1a',
        lightColor: '#ffffff',
      });

      return buffer;
    } catch (error) {
      this.logger.error('Failed to generate branded QR code:', error);
      throw error;
    }
  }
}