import { Logger } from './logger';
import { WalletConnectService } from './walletconnect.service';
import { QRCodeService } from './qrcode.service';
import { WalletAppsService } from './wallet-apps.service';
import { StorageManager } from '../storage';
import { getConfig } from '../config';
import { WalletAppId, isWalletAppId } from '../types/wallet.types';

/**
 * Enhanced Wallet Connection Manager with improved error handling
 * and production-ready features
 */
export class WalletConnectionManager {
  private static instance: WalletConnectionManager;
  private readonly logger = Logger.getInstance();
  private readonly walletConnectService = WalletConnectService.getInstance();
  private readonly qrCodeService = QRCodeService.getInstance();
  private readonly walletAppsService = WalletAppsService.getInstance();
  private readonly storage = StorageManager.getInstance();
  private readonly config = getConfig();
  
  // Track active connections for better management
  private activeConnections = new Map<string, {
    userId: string;
    requestId: string;
    timestamp: number;
    status: 'pending' | 'connecting' | 'connected' | 'failed';
  }>();
  
  // Connection retry configuration
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAY = 5000; // 5 seconds
  private readonly CONNECTION_TIMEOUT = 300000; // 5 minutes
  
  private constructor() {
    // Clean up stale connections periodically
    setInterval(() => this.cleanupStaleConnections(), 60000); // Every minute
  }
  
  public static getInstance(): WalletConnectionManager {
    if (!WalletConnectionManager.instance) {
      WalletConnectionManager.instance = new WalletConnectionManager();
    }
    return WalletConnectionManager.instance;
  }
  
  /**
   * Initialize connection with comprehensive error handling
   */
  async initializeConnection(
    userId: string,
    connectionType: 'qr' | 'deeplink',
    walletAppId?: string
  ): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      // Check if user already has an active connection attempt
      const existingConnection = this.getActiveConnection(userId);
      if (existingConnection && existingConnection.status === 'pending') {
        return {
          success: false,
          error: 'Connection already in progress. Please wait or cancel the existing connection.'
        };
      }
      
      // Normalize walletAppId to WalletAppId if valid
      const appId: WalletAppId | undefined = walletAppId && isWalletAppId(walletAppId) ? (walletAppId as WalletAppId) : undefined;

      // Create WalletConnect request with timeout
      const wcRequest = await this.createConnectionWithTimeout(userId, appId);
      
      if (!wcRequest) {
        return {
          success: false,
          error: 'Failed to create connection request. Please try again.'
        };
      }
      
      // Track this connection
      this.activeConnections.set(userId, {
        userId,
        requestId: wcRequest.id,
        timestamp: Date.now(),
        status: 'pending'
      });
      
      // Generate QR code if needed
      if (connectionType === 'qr') {
        try {
          const qrSession = await this.qrCodeService.generateQRCode(
            userId,
            wcRequest.uri,
            walletAppId
          );
          
          const qrBuffer = await this.qrCodeService.generateQRCodeBuffer(wcRequest.uri);
          
          return {
            success: true,
            data: {
              requestId: wcRequest.id,
              qrSessionId: qrSession.id,
              qrBuffer,
              uri: wcRequest.uri,
              expiryTimestamp: wcRequest.expiryTimestamp
            }
          };
        } catch (qrError) {
          this.logger.error('QR code generation failed:', qrError);
          // Fallback to URI display
          return {
            success: true,
            data: {
              requestId: wcRequest.id,
              uri: wcRequest.uri,
              expiryTimestamp: wcRequest.expiryTimestamp,
              fallbackMode: true
            }
          };
        }
      }
      
      // Return deep link data
      const deepLink = appId 
        ? this.walletAppsService.generateDeepLink(appId, wcRequest.uri)
        : wcRequest.uri;
      
      return {
        success: true,
        data: {
          requestId: wcRequest.id,
          deepLink,
          uri: wcRequest.uri,
          expiryTimestamp: wcRequest.expiryTimestamp
        }
      };
      
    } catch (error) {
      this.logger.error('Failed to initialize wallet connection:', error);
      this.activeConnections.delete(userId);
      
      return {
        success: false,
        error: this.getErrorMessage(error)
      };
    }
  }
  
  /**
   * Create connection with timeout handling
   */
  private async createConnectionWithTimeout(
    userId: string,
    walletAppId?: WalletAppId
  ): Promise<any> {
    return new Promise(async (resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Connection request timeout'));
      }, 30000); // 30 second timeout for initial request
      
      try {
        const request = await this.walletConnectService.createConnectionRequest(
          userId,
          walletAppId
        );
        clearTimeout(timeout);
        resolve(request);
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
      }
    });
  }
  
  /**
   * Monitor connection status
   */
  async checkConnectionStatus(userId: string): Promise<{
    status: 'pending' | 'connecting' | 'connected' | 'failed' | 'not_found';
    message: string;
    data?: any;
  }> {
    const connection = this.activeConnections.get(userId);
    
    if (!connection) {
      return {
        status: 'not_found',
        message: 'No active connection found'
      };
    }
    
    // Check if connection has timed out
    if (Date.now() - connection.timestamp > this.CONNECTION_TIMEOUT) {
      this.activeConnections.delete(userId);
      return {
        status: 'failed',
        message: 'Connection timeout. Please try again.'
      };
    }
    
    // Check actual connection status from storage
    const user = await this.storage.getUser(userId);
    if (user && user.walletAddress) {
      this.activeConnections.set(userId, {
        ...connection,
        status: 'connected'
      });
      
      return {
        status: 'connected',
        message: 'Wallet successfully connected',
        data: {
          walletAddress: user.walletAddress
        }
      };
    }
    
    return {
      status: connection.status,
      message: this.getStatusMessage(connection.status)
    };
  }
  
  /**
   * Cancel active connection
   */
  async cancelConnection(userId: string): Promise<boolean> {
    try {
      const connection = this.activeConnections.get(userId);
      if (connection) {
        // Mark request as used
        await this.storage.updateWalletConnectRequest(
          connection.requestId,
          { isUsed: true }
        );
        
        this.activeConnections.delete(userId);
        return true;
      }
      return false;
    } catch (error) {
      this.logger.error('Failed to cancel connection:', error);
      return false;
    }
  }
  
  /**
   * Get active connection for user
   */
  private getActiveConnection(userId: string) {
    return this.activeConnections.get(userId);
  }
  
  /**
   * Clean up stale connections
   */
  private cleanupStaleConnections(): void {
    const now = Date.now();
    const staleConnections: string[] = [];
    
    this.activeConnections.forEach((connection, userId) => {
      if (now - connection.timestamp > this.CONNECTION_TIMEOUT) {
        staleConnections.push(userId);
      }
    });
    
    staleConnections.forEach(userId => {
      this.logger.info('Cleaning up stale connection', { userId });
      this.activeConnections.delete(userId);
    });
  }
  
  /**
   * Get user-friendly error message
   */
  private getErrorMessage(error: any): string {
    const message = error?.message || String(error);
    
    if (/timeout/i.test(message)) {
      return 'Connection timeout. The wallet did not respond in time.';
    }
    
    if (/rejected/i.test(message)) {
      return 'Connection rejected by wallet.';
    }
    
    if (/already connected/i.test(message)) {
      return 'You already have a connected wallet.';
    }
    
    if (/network/i.test(message)) {
      return 'Network error. Please check your connection and try again.';
    }
    
    return 'Connection failed. Please try again or use a different method.';
  }
  
  /**
   * Get status message
   */
  private getStatusMessage(status: string): string {
    switch (status) {
      case 'pending':
        return 'Waiting for wallet approval...';
      case 'connecting':
        return 'Establishing connection...';
      case 'connected':
        return 'Wallet successfully connected!';
      case 'failed':
        return 'Connection failed.';
      default:
        return 'Unknown status';
    }
  }
  
  /**
   * Validate wallet address before saving
   */
  async validateAndSaveWallet(
    userId: string,
    walletAddress: string,
    connectionData: any
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Normalize address
      const normalizedAddress = walletAddress.toLowerCase();
      
      // Check if wallet is already used by another user
      const existingUser = await this.storage.getUserByWallet(normalizedAddress);
      if (existingUser && existingUser.telegramId !== userId) {
        return {
          success: false,
          error: 'This wallet is already connected to another account.'
        };
      }
      
      // Check wallet lock policy
      const currentUser = await this.storage.getUser(userId);
      if (currentUser) {
        const originalWallet = currentUser.previousWallet || currentUser.walletAddress;
        if (originalWallet && originalWallet !== normalizedAddress) {
          return {
            success: false,
            error: 'You can only reconnect your original wallet for security reasons.'
          };
        }
      }
      
      // Save wallet connection
      await this.storage.saveWalletConnection({
        ...connectionData,
        walletAddress: normalizedAddress,
        userId
      });
      
      // Update user
      const updates: any = { walletAddress: normalizedAddress };
      if (!currentUser?.previousWallet) {
        updates.previousWallet = normalizedAddress;
      }
      
      await this.storage.updateUser(userId, updates);
      
      // Update connection status
      const connection = this.activeConnections.get(userId);
      if (connection) {
        this.activeConnections.set(userId, {
          ...connection,
          status: 'connected'
        });
      }
      
      return { success: true };
      
    } catch (error) {
      this.logger.error('Failed to validate and save wallet:', error);
      return {
        success: false,
        error: 'Failed to save wallet connection.'
      };
    }
  }
}