import SignClient from '@walletconnect/sign-client';
import { SessionTypes, SignClientTypes } from '@walletconnect/types';
import { Logger } from './logger';
import { getConfig } from '../config';
import { WalletConnectSession, WalletConnectRequest, WalletAppId, WalletAppConfig, isEthereumAddress } from '../types/wallet.types';
import { PointsService, PointEarningCategory } from '../shared';
import { StorageManager } from '../storage';
import { nanoid } from './id';
import { Telegraf } from 'telegraf';

export class WalletConnectService {
  private static instance: WalletConnectService;
  private static botInstance: Telegraf | null = null;
  private signClient: SignClient | null = null;
  private readonly logger = Logger.getInstance();
  private readonly config = getConfig();
  private readonly storage = StorageManager.getInstance();
  private readonly projectId: string;

  private constructor() {
    this.projectId = this.config.wallet.projectId;
    if (!this.projectId) {
      throw new Error('WalletConnect Project ID is required. Please set WALLETCONNECT_PROJECT_ID in your .env file');
    }
  }

  public static getInstance(): WalletConnectService {
    if (!WalletConnectService.instance) {
      WalletConnectService.instance = new WalletConnectService();
    }
    return WalletConnectService.instance;
  }

  /**
   * Set bot instance for sending notifications
   */
  public static setBotInstance(bot: Telegraf): void {
    WalletConnectService.botInstance = bot;
  }

  /**
   * Initialize WalletConnect Sign Client
   */
  async initialize(): Promise<void> {
    try {
      if (this.signClient) {
        return; // Already initialized
      }

      this.signClient = await SignClient.init({
        projectId: this.projectId,
        metadata: {
          name: this.config.bot.name,
          description: 'Professional Telegram Airdrop Bot with Wallet Integration',
          url: this.config.server.urls.frontend,
          icons: ['https://your-domain.com/icon.png'], // Add your bot icon URL
        },
      });

      // Set up event listeners
      this.setupEventListeners();

      this.logger.info('WalletConnect client initialized successfully', {
        projectId: this.projectId,
      });
    } catch (error) {
      this.logger.error('Failed to initialize WalletConnect client:', error);
      throw error;
    }
  }

  /**
   * Create a new WalletConnect connection request
   */
  async createConnectionRequest(userId: string, walletAppId?: WalletAppId): Promise<WalletConnectRequest> {
    try {
      // Allow reconnection even if user already has a saved wallet. Lock enforcement happens after approval.

      if (!this.signClient) {
        await this.initialize();
      }

      const { uri, approval } = await this.signClient!.connect({
        optionalNamespaces: {
          eip155: {
            methods: [
              'eth_sendTransaction',
              'eth_signTransaction',
              'eth_sign',
              'personal_sign',
              'eth_signTypedData',
            ],
            chains: [`eip155:${this.config.wallet.chainId}`],
            events: ['chainChanged', 'accountsChanged'],
          },
        },
      });

      const requestId = nanoid();
      const expiryTimestamp = Date.now() + this.config.wallet.walletConnect.connectionExpiryMs;

      const request: WalletConnectRequest = {
        id: requestId,
        userId,
        uri: uri!,
        expiryTimestamp,
        expiresAt: new Date(expiryTimestamp),
        createdAt: new Date(),
        isUsed: false,
        walletAppId,
      };

      // Save the request
      await this.storage.saveWalletConnectRequest(request);

      // Handle approval in background with enhanced logging
      this.logger.info('Starting WalletConnect approval process', {
        userId,
        requestId,
        approvalTimeoutMs: this.config.wallet.walletConnect.approvalTimeoutMs,
        connectionExpiryMs: this.config.wallet.walletConnect.connectionExpiryMs,
        maxRetryAttempts: this.config.wallet.walletConnect.maxRetryAttempts
      });
      
      this.handleConnectionApproval(approval(), userId, requestId);

      this.logger.info('WalletConnect connection request created', {
        userId,
        requestId,
        walletAppId,
      });

      return request;
    } catch (error) {
      this.logger.error('Failed to create WalletConnect connection request:', error);
      throw error;
    }
  }

  /**
   * Get deep link for specific wallet app
   */
  getWalletDeepLink(uri: string, walletAppId: WalletAppId): string {
    const walletConfigs = this.getWalletAppConfigs();
    const walletConfig = walletConfigs.find(config => config.id === walletAppId);
    
    if (!walletConfig) {
      throw new Error(`Wallet app ${walletAppId} not found`);
    }

    const encodedUri = encodeURIComponent(uri);
    
    // Different deep link formats for different wallets
    switch (walletAppId) {
      case 'metamask':
        return `https://metamask.app.link/wc?uri=${encodedUri}`;
      case 'trust':
        return `https://link.trustwallet.com/wc?uri=${encodedUri}`;
      case 'coinbase':
        return `https://go.cb-w.com/wc?uri=${encodedUri}`;
      case 'rainbow':
        return `https://rnbwapp.com/wc?uri=${encodedUri}`;
      case 'bitget':
        return `https://bkcode.vip/wc?uri=${encodedUri}`;
      case 'phantom':
        return `https://phantom.app/ul/browse/${encodedUri}?ref=https://your-domain.com`;
      case 'exodus':
        return `https://exodus.com/m/wc?uri=${encodedUri}`;
      case 'atomic':
        return `https://atomicwallet.io/wc?uri=${encodedUri}`;
      case 'safepal':
        return `https://link.safepal.io/wc?uri=${encodedUri}`;
      case 'tokenpocket':
        return `https://www.tokenpocket.pro/wc?uri=${encodedUri}`;
      case 'imtoken':
        return `https://imtoken.fans/wc?uri=${encodedUri}`;
      case 'oneinch':
        return `https://wallet.1inch.io/wc?uri=${encodedUri}`;
      case 'mathwallet':
        return `https://mathwallet.org/wc?uri=${encodedUri}`;
      case 'alphaWallet':
        return `https://alphawallet.com/wc?uri=${encodedUri}`;
      case 'zerion':
        return `https://link.zerion.io/wc?uri=${encodedUri}`;
      case 'pillar':
        return `https://pillarproject.io/wc?uri=${encodedUri}`;
      default:
        return `wc:${uri}`;
    }
  }

  /**
   * Get all wallet app configurations
   */
  getWalletAppConfigs(): WalletAppConfig[] {
    return [
      {
        id: 'metamask',
        name: 'MetaMask',
        description: 'The most popular Ethereum wallet',
        icon: '🦊',
        color: '#f6851b',
        enabled: this.config.wallet.apps.metamask,
        deepLink: {
          mobile: 'https://metamask.app.link/wc?uri=',
          desktop: 'https://metamask.io/download/',
        },
        downloadUrl: {
          ios: 'https://apps.apple.com/app/metamask/id1438144202',
          android: 'https://play.google.com/store/apps/details?id=io.metamask',
          chrome: 'https://chrome.google.com/webstore/detail/metamask/nkbihfbeogaeaoehlefnkodbefgpgknn',
        },
        supportedChains: [1, 137, 56, 43114, 10, 42161],
      },
      {
        id: 'trust',
        name: 'Trust Wallet',
        description: 'Multi-chain mobile wallet',
        icon: '🛡️',
        color: '#3375bb',
        enabled: this.config.wallet.apps.trust,
        deepLink: {
          mobile: 'https://link.trustwallet.com/wc?uri=',
        },
        downloadUrl: {
          ios: 'https://apps.apple.com/app/trust-crypto-bitcoin-wallet/id1288339409',
          android: 'https://play.google.com/store/apps/details?id=com.wallet.crypto.trustapp',
        },
        supportedChains: [1, 56, 137, 43114, 10, 42161, 250, 25],
      },
      {
        id: 'coinbase',
        name: 'Coinbase Wallet',
        description: 'Self-custody wallet from Coinbase',
        icon: '🔵',
        color: '#0052ff',
        enabled: this.config.wallet.apps.coinbase,
        deepLink: {
          mobile: 'https://go.cb-w.com/wc?uri=',
        },
        downloadUrl: {
          ios: 'https://apps.apple.com/app/coinbase-wallet-nfts-crypto/id1278383455',
          android: 'https://play.google.com/store/apps/details?id=org.toshi',
        },
        supportedChains: [1, 137, 56, 43114, 10, 42161, 8453],
      },
      {
        id: 'rainbow',
        name: 'Rainbow',
        description: 'Colorful Ethereum wallet',
        icon: '🌈',
        color: '#ff4655',
        enabled: this.config.wallet.apps.rainbow,
        deepLink: {
          mobile: 'https://rnbwapp.com/wc?uri=',
        },
        downloadUrl: {
          ios: 'https://apps.apple.com/app/rainbow-ethereum-wallet/id1457119021',
          android: 'https://play.google.com/store/apps/details?id=me.rainbow',
        },
        supportedChains: [1, 137, 10, 42161, 8453],
      },
      {
        id: 'bitget',
        name: 'Bitget Wallet',
        description: 'Multi-chain DeFi wallet',
        icon: '🟢',
        color: '#00d4aa',
        enabled: this.config.wallet.apps.bitget,
        deepLink: {
          mobile: 'https://bkcode.vip/wc?uri=',
        },
        downloadUrl: {
          ios: 'https://apps.apple.com/app/bitget-wallet/id1649074456',
          android: 'https://play.google.com/store/apps/details?id=com.bitget.wallet',
        },
        supportedChains: [1, 56, 137, 43114, 10, 42161],
      },
      {
        id: 'phantom',
        name: 'Phantom',
        description: 'Solana and Ethereum wallet',
        icon: '👻',
        color: '#ab9ff2',
        enabled: this.config.wallet.apps.phantom,
        deepLink: {
          mobile: 'https://phantom.app/ul/browse/',
        },
        downloadUrl: {
          ios: 'https://apps.apple.com/app/phantom-solana-wallet/id1598432977',
          android: 'https://play.google.com/store/apps/details?id=app.phantom',
          chrome: 'https://chrome.google.com/webstore/detail/phantom/bfnaelmomeimhlpmgjnjophhpkkoljpa',
        },
        supportedChains: [1, 137],
      },
    ];
  }

  /**
   * Get enabled wallet apps
   */
  getEnabledWalletApps(): WalletAppConfig[] {
    return this.getWalletAppConfigs().filter(config => config.enabled);
  }

  /**
   * Send signature request via WalletConnect
   */
  async sendSignatureRequest(
    sessionTopic: string,
    chainId: string,
    method: string,
    params: any[]
  ): Promise<string> {
    try {
      if (!this.signClient) {
        await this.initialize();
      }

      const result = await this.signClient!.request({
        topic: sessionTopic,
        chainId,
        request: {
          method,
          params
        }
      });

      if (!result) {
        throw new Error(`${method} request failed - no result received`);
      }

      this.logger.info('Signature request sent successfully', {
        sessionTopic,
        chainId,
        method,
        result
      });

      return result as string;
    } catch (error) {
      this.logger.error('Failed to send signature request:', error);
      throw error;
    }
  }

  /**
   * Disconnect a WalletConnect session
   */
  async disconnectSession(topic: string, reason?: string): Promise<void> {
    try {
      if (!this.signClient) {
        await this.initialize();
      }

      // Validate topic exists in either sessions or pairings before attempting disconnect
      const sessions: any[] = (this.signClient as any).session?.getAll?.() || [];
      const pairings: any[] = (this.signClient as any).pairing?.getAll?.() || [];
      const hasSession = Array.isArray(sessions) && sessions.some((s: any) => s?.topic === topic);
      const hasPairing = Array.isArray(pairings) && pairings.some((p: any) => p?.topic === topic);

      if (!hasSession && !hasPairing) {
        // Nothing to disconnect; treat as successful no-op
        this.logger.warn('Disconnect called for non-existent WalletConnect topic, skipping', { topic });
        return;
      }

      await this.signClient!.disconnect({
        topic,
        reason: {
          code: 6000,
          message: reason || 'User disconnected',
        },
      });

      this.logger.info('WalletConnect session disconnected', { topic });
    } catch (error: any) {
      // Downgrade noisy "No matching key" errors to warning and do not rethrow
      if (typeof error?.message === 'string' && error.message.includes('No matching key')) {
        this.logger.warn('WalletConnect topic already disconnected or missing; treated as no-op', {
          topic,
          error: error.message,
        });
        return;
      }
      this.logger.error('Failed to disconnect WalletConnect session:', error);
      throw error;
    }
  }

  /**
   * Get active sessions
   */
  getActiveSessions(): Record<string, SessionTypes.Struct> {
    if (!this.signClient) {
      return {};
    }
    const sessions: any[] = (this.signClient as any).session?.getAll?.() || [];
    const map: Record<string, SessionTypes.Struct> = {};
    for (const s of sessions) {
      if (s && s.topic) {
        map[s.topic] = s as SessionTypes.Struct;
      }
    }
    return map;
  }

  /**
   * Check if a specific session topic is active
   */
  isSessionActive(sessionTopic: string): boolean {
    const activeSessions = this.getActiveSessions();
    return !!activeSessions[sessionTopic];
  }

  /**
   * Send transaction request via WalletConnect
   */
  async sendTransactionRequest(
    sessionTopic: string,
    chainId: string,
    transactionData: any
  ): Promise<string> {
    try {
      if (!this.signClient) {
        await this.initialize();
      }

      // Check if session exists before making request
      const activeSessions = this.getActiveSessions();
      const session = activeSessions[sessionTopic];
      if (!session) {
        throw new Error(`WalletConnect session not found or expired. Topic: ${sessionTopic}`);
      }

      // Ensure 'from' address is provided; some wallets (e.g., MetaMask) require it
      if (!transactionData.from) {
        try {
          const accounts = Object.values(session.namespaces)
            .map((ns: any) => ns.accounts || [])
            .flat();
          const ethAccount = accounts.find((a: string) => a.startsWith('eip155:'));
          if (ethAccount) {
            transactionData.from = ethAccount.split(':')[2];
          }
        } catch {}
      }

      const result = await this.signClient!.request({
        topic: sessionTopic,
        chainId,
        request: {
          method: 'eth_sendTransaction',
          params: [transactionData]
        }
      });

      if (!result) {
        throw new Error('Transaction request failed - no result received');
      }

      this.logger.info('Transaction request sent successfully', {
        sessionTopic,
        chainId,
        transactionHash: result
      });

      return result as string;
    } catch (error: any) {
      const msg = typeof error?.message === 'string' ? error.message : '';
      const code = (error?.code ?? error?.data?.code ?? error?.error?.code) as any;
      // Normalize common user rejection signals
      const isRejected =
        code === 4001 ||
        code === 5001 ||
        code === 'ACTION_REJECTED' ||
        /user rejected|rejected|denied|ACTION_REJECTED/i.test(msg || '');

      // Enhanced error logging with more specific messages
      if (msg && msg.includes("session topic doesn't exist")) {
        this.logger.error('WalletConnect session expired or invalid:', {
          sessionTopic,
          error: msg,
          activeSessions: Object.keys(this.getActiveSessions())
        });
        throw new Error('WalletConnect session expired. Please reconnect your wallet.');
      }

      if (isRejected) {
        this.logger.warn('User rejected WalletConnect request', { sessionTopic, code });
        const err = new Error('User rejected the request');
        (err as any).code = code || 4001;
        throw err;
      }
      
      this.logger.error('Failed to send transaction request:', {
        error: msg || String(error),
        code,
        sessionTopic,
        chainId
      });
      // Re-throw with a clearer message if original is empty
      if (!msg) {
        const err = new Error('On-chain request failed');
        (err as any).code = code;
        throw err;
      }
      throw error;
    }
  }

  /**
   * Handle connection approval
   */
  private async handleConnectionApproval(
    approval: Promise<SessionTypes.Struct>,
    userId: string,
    requestId: string
  ): Promise<void> {
    let retryCount = 0;
    const maxRetries = this.config.wallet.walletConnect.maxRetryAttempts;
    
    while (retryCount <= maxRetries) {
      try {
        this.logger.info('Waiting for WalletConnect approval', {
          userId,
          requestId,
          retryCount,
          maxRetries
        });
        
        // Set configurable timeout for approval
        const timeoutMs = this.config.wallet.walletConnect.approvalTimeoutMs || 300000; // Default 5 minutes
        const session = await Promise.race([
          approval,
          new Promise<never>((_, reject) => 
            setTimeout(() => {
              reject(new Error(`WalletConnect approval timeout after ${timeoutMs / 1000} seconds`))
            }, timeoutMs)
          )
        ]) as SessionTypes.Struct;
      
        // Check if session exists and has required properties
        if (!session) {
          throw new Error('Invalid WalletConnect session: session is null');
        }
        
        this.logger.info('WalletConnect session approved', {
          userId,
          requestId,
          sessionTopic: session.topic,
          hasNamespaces: !!session.namespaces
        });
        
        if (!session.namespaces || Object.keys(session.namespaces).length === 0) {
          this.logger.warn('WalletConnect session has no namespaces, marking request as used', {
            userId,
            requestId,
            sessionTopic: session.topic
          });
          
          // Mark request as used since connection was attempted
          await this.storage.updateWalletConnectRequest(requestId, { isUsed: true });
          return;
        }
      
      // Extract wallet address from the session
      const accounts = Object.values(session.namespaces)
        .map((namespace: any) => namespace.accounts || [])
        .flat();
      
      if (accounts.length === 0) {
        throw new Error('No accounts found in WalletConnect session');
      }

      // Get the first Ethereum account
      const ethAccount = accounts.find((account: string) => account.startsWith('eip155:'));
      if (!ethAccount) {
        throw new Error('No Ethereum account found in WalletConnect session');
      }

      let walletAddress = ethAccount.split(':')[2];
      if (isEthereumAddress(walletAddress)) {
        walletAddress = walletAddress.toLowerCase();
      }

      // Create WalletConnect session data
      const walletConnectSession: WalletConnectSession = {
        topic: session.topic,
        peer: session.peer,
        namespaces: session.namespaces,
        expiry: session.expiry,
        acknowledged: session.acknowledged,
      };

      // Enforce wallet ownership lock BEFORE saving connection
      const existingOwner = await this.storage.getUserByWallet(walletAddress);
      if (existingOwner && existingOwner.telegramId !== userId) {
        this.logger.warn('Wallet ownership violation: address already linked to another user', {
          walletAddress,
          existingOwner: existingOwner.telegramId,
          attemptedBy: userId
        });
        // Friendly warning to the user attempting the reuse
        if (WalletConnectService.botInstance) {
          const mask = (a: string) => (a && a.length > 10 ? `${a.substring(0,6)}...${a.substring(a.length-4)}` : a || 'Unknown');
          const text =
            '😼 <b>We caught you — nice try!</b>\n\n' +
            `This wallet <code>${mask(walletAddress)}</code> is already connected to another account.\n` +
            'For fairness and security, each wallet can be linked to only one account.\n' +
            'If you attempt to bypass this rule, we may block both accounts.';
          try {
            await WalletConnectService.botInstance.telegram.sendMessage(
              parseInt(userId),
              text,
              {
                parse_mode: 'HTML',
                disable_web_page_preview: true,
                reply_markup: {
                  inline_keyboard: [
                    [
                      { text: 'View Wallet', callback_data: 'wallet_show' },
                      { text: 'Main Menu', callback_data: 'menu_main' }
                    ],
                    [ { text: 'Get Help', callback_data: 'menu_help' } ]
                  ]
                }
              } as any
            );
          } catch (e) {
            this.logger.warn('Failed to send ownership violation notification', { userId, error: (e as any)?.message || String(e) });
          }
        }
        // Mark request used and disconnect the session
        await this.storage.updateWalletConnectRequest(requestId, { isUsed: true });
        try { await this.disconnectSession(session.topic, 'Ownership violation'); } catch {}
        return;
      }

      // Save the connection
      await this.storage.saveWalletConnection({
        id: `wc_${Date.now()}_${userId}`,
        userId,
        walletAddress,
        walletType: 'walletconnect',
        chainId: this.config.wallet.chainId,
        connectedAt: new Date(),
        lastActiveAt: new Date().toISOString(),
        isActive: true,
        expiresAt: new Date(Date.now() + this.config.wallet.walletConnect.connectionExpiryMs),
        sessionId: session.topic,
        walletConnectSession,
        metadata: {
          connectionMethod: 'walletconnect',
          verificationStatus: 'verified',
          walletConnectPeer: session.peer.metadata.name,
        },
      });

      // Check for existing wallet and implement wallet lock
      const currentUser = await this.storage.getUser(userId);
      if (!currentUser) {
        throw new Error('User not found during wallet connection');
      }

      // Wallet lock: Only allow one wallet per user
      if ((currentUser.previousWallet && currentUser.previousWallet !== walletAddress) || (currentUser.walletAddress && currentUser.walletAddress !== walletAddress)) {
        this.logger.warn('Wallet lock: User attempting to connect different wallet than their original', {
          userId,
          originalWallet: currentUser.previousWallet || currentUser.walletAddress,
          currentWallet: currentUser.walletAddress,
          attemptedWallet: walletAddress
        });
        if (WalletConnectService.botInstance) {
          const mask = (a: string) => (a && a.length > 10 ? `${a.substring(0,6)}...${a.substring(a.length-4)}` : a || 'Unknown');
          const text =
            '🔒 <b>Wallet Already Set</b>\n\n' +
            `Only your first connected wallet is allowed for security.\n\n` +
            `🎯 <b>Your Original Wallet:</b>\n<code>${mask(currentUser.previousWallet || currentUser.walletAddress || 'Unknown')}</code>\n\n` +
            `❌ <b>Attempted Wallet:</b>\n<code>${mask(walletAddress)}</code>\n\n` +
            '💡 You can reconnect your original wallet anytime, but cannot change to a different wallet address.';
          try {
            await WalletConnectService.botInstance.telegram.sendMessage(
              parseInt(userId),
              text,
              {
                parse_mode: 'HTML',
                disable_web_page_preview: true,
                reply_markup: {
                  inline_keyboard: [
                    [
                      { text: 'Reconnect Original Wallet', callback_data: 'wallet_connect' },
                      { text: 'View Wallet', callback_data: 'wallet_show' }
                    ],
                    [
                      { text: 'Main Menu', callback_data: 'menu_main' },
                      { text: 'Get Help', callback_data: 'menu_help' }
                    ]
                  ]
                }
              } as any
            );
          } catch (e) {
            this.logger.warn('Failed to send ownership violation notification', { userId, error: (e as any)?.message || String(e) });
          }
        }
        try { await this.disconnectSession(session.topic, 'User attempted to connect different wallet - wallet lock enforced'); } catch {}
        await this.storage.updateWalletConnectRequest(requestId, { isUsed: true });
        return;
      }

      // Update user with wallet address and save first wallet as previousWallet
      const updateData: any = {
        walletAddress: walletAddress,
        walletName: session.peer.metadata.name || 'WalletConnect',
        peerName: session.peer.metadata.name || 'WalletConnect',
        connectionMethod: 'walletconnect'
      };
      
      // If this is the first wallet connection, save it as previousWallet
      if (!currentUser.previousWallet && !currentUser.walletAddress) {
        updateData.previousWallet = walletAddress;
      }

      await this.storage.updateUser(userId, updateData);

      // Connection bonus system removed per user request

      // Mark request as used
      await this.storage.updateWalletConnectRequest(requestId, { isUsed: true });

      // Send wallet connection notification
      await this.sendWalletConnectedNotification(userId, walletAddress, session.peer.metadata.name);

      this.logger.info('WalletConnect session approved and saved', {
        userId,
        topic: session.topic,
        walletAddress,
        peerName: session.peer.metadata.name,
        retryAttempt: retryCount
      });
      
      // Successfully connected, break out of retry loop
      return;

      } catch (error: any) {
        retryCount++;

        const msg = (error && error.message) ? String(error.message) : '';
        const isTimeoutError = /timeout|expired/i.test(msg);

        if (isTimeoutError) {
          this.logger.warn('WalletConnect approval timed out or expired', {
            error: msg,
            userId,
            requestId,
            retryCount,
            maxRetries,
            timeoutMs: this.config.wallet.walletConnect.approvalTimeoutMs
          });
        } else {
          this.logger.error('Failed to handle WalletConnect approval:', {
            error: msg,
            userId,
            requestId,
            retryCount,
            maxRetries,
            timeoutMs: this.config.wallet.walletConnect.approvalTimeoutMs
          });
        }

        const canRetry = retryCount <= maxRetries && isTimeoutError;
        
        if (!canRetry) {
          await this.storage.updateWalletConnectRequest(requestId, { isUsed: true });
          const notifyMessage = isTimeoutError ? 'timeout' : msg;
          await this.sendConnectionFailureNotification(userId, notifyMessage, retryCount > 1);
          return;
        }
        
        if (retryCount <= maxRetries) {
          const nextAttempt = retryCount + 1;
          const maxAttempts = maxRetries + 1;
          this.logger.info(`Retrying WalletConnect approval in ${this.config.wallet.walletConnect.retryDelayMs / 1000} seconds`, {
            userId,
            requestId,
            nextAttempt,
            maxAttempts
          });
          
          await new Promise(resolve => setTimeout(resolve, this.config.wallet.walletConnect.retryDelayMs));
        }
      }
    }
  }

  /**
   * Setup event listeners
   */
  private setupEventListeners(): void {
    if (!this.signClient) return;

    this.signClient.on('session_proposal', async (event) => {
      this.logger.info('WalletConnect session proposal received', { event });
    });

    this.signClient.on('session_request', async (event) => {
      this.logger.info('WalletConnect session request received', { event });
    });

    this.signClient.on('session_delete', async (event) => {
      this.logger.info('WalletConnect session deleted', { event });
      await this.handleTopicDeactivation(event.topic, 'Session deleted');
    });

    this.signClient.on('session_expire', async (event) => {
      this.logger.info('WalletConnect session expired', { event });
      await this.handleTopicDeactivation(event.topic, 'Session expired');
    });

    this.signClient.on('session_ping', (event) => {
      this.logger.debug('WalletConnect session ping', { event });
    });

    this.startExpiryEnforcement();
  }

  private async handleTopicDeactivation(topic: string, reason: string): Promise<void> {
    try {
      const conn = await (this.storage as any).getWalletConnectionByTopic(topic);
      await this.storage.deactivateWalletConnectionByTopic(topic);
      if (conn && conn.isActive !== false) {
        try { await this.disconnectSession(topic, reason); } catch {}
        if (conn.userId && conn.walletAddress) {
          try {
            const user = await this.storage.getUser(conn.userId);
            if (user && user.walletAddress === conn.walletAddress) {
              await this.storage.updateUser(conn.userId, { walletAddress: null });
            }
          } catch (e: any) {
            this.logger.warn('Failed to clear user wallet on session deactivation', {
              userId: conn.userId,
              error: e?.message || String(e)
            });
          }
          await this.sendWalletDisconnectedNotification(conn.userId, conn.walletAddress, reason);
        }
      }
    } catch (error) {
      this.logger.error('Failed to handle topic deactivation:', { topic, error });
    }
  }

  private startExpiryEnforcement(): void {
    const intervalMs = 30000;
    setInterval(async () => {
      try {
        const now = Date.now();
        const expired = await (this.storage as any).getExpiredWalletConnections(now);
        for (const conn of expired) {
          const topic = conn?.walletConnectSession?.topic || conn?.sessionId;
          if (topic) {
            await this.handleTopicDeactivation(topic, 'Session expired by policy');
          }
        }
      } catch (error) {
        this.logger.error('Expiry enforcement error:', error);
      }
    }, intervalMs);
  }

  /**
   * Get human-readable timeout information
   */
  private getTimeoutInfo(): { approvalMinutes: number; connectionMinutes: number; approvalSeconds: number } {
    return {
      approvalMinutes: Math.floor(this.config.wallet.walletConnect.approvalTimeoutMs / 60000),
      connectionMinutes: Math.floor(this.config.wallet.walletConnect.connectionExpiryMs / 60000),
      approvalSeconds: Math.floor(this.config.wallet.walletConnect.approvalTimeoutMs / 1000)
    };
  }

  /**
   * Clean up expired connection requests
   */
  async cleanupExpiredRequests(): Promise<void> {
    try {
      const now = Date.now();
      const expiredRequests = await this.storage.getExpiredWalletConnectRequests(now);
      
      for (const request of expiredRequests) {
        await this.storage.deleteWalletConnectRequest(request.id);
      }

      if (expiredRequests.length > 0) {
        this.logger.info(`Cleaned up ${expiredRequests.length} expired WalletConnect requests`);
      }
    } catch (error) {
      this.logger.error('Failed to cleanup expired WalletConnect requests:', error);
    }
  }

  /**
   * Get statistics
   */
  async getStats(): Promise<any> {
    try {
      const activeSessions = this.getActiveSessions();
      const activeConnectionsCount = Object.keys(activeSessions).length;
      
      return {
        activeConnections: activeConnectionsCount,
        totalSessions: activeConnectionsCount,
        projectId: this.projectId,
        isInitialized: !!this.signClient,
      };
    } catch (error) {
      this.logger.error('Failed to get WalletConnect stats:', error);
      return {
        activeConnections: 0,
        totalSessions: 0,
        projectId: this.projectId,
        isInitialized: false,
      };
    }
  }

  // Wallet connection bonus system removed per user request

  /**
   * Send connection failure notification to user
   */
  private async sendConnectionFailureNotification(userId: string, errorMessage: string, wasRetried: boolean): Promise<void> {
    try {
      // Check if bot instance is available
      if (!WalletConnectService.botInstance) {
        this.logger.warn('Bot instance not available for sending connection failure notification', { userId });
        return;
      }

      const timeoutInfo = this.getTimeoutInfo();
      const isTimeout = /timeout|expired/i.test(errorMessage);
      let failureText = isTimeout ? '⏳ <b>Connection Request Expired</b>\n\n' : '❌ <b>Wallet Connection Failed</b>\n\n';
      
      if (isTimeout) {
        failureText += 
          `⏰ Your wallet connection request expired after ${timeoutInfo.approvalMinutes} minutes.\n\n` +
          `💡 What happened?\n` +
          `• No approval received in time\n` +
          `• Wallet app was closed or inactive\n` +
          `• Network issues\n\n` +
          `🔄 How to try again:\n` +
          `• Open your wallet app first\n` +
          `• Ensure stable internet\n` +
          `• Try a different wallet app if needed\n\n`;
      } else {
        failureText += 
          `⚠️ <b>Connection Error</b>\n` +
          `Something went wrong during the connection process.\n\n` +
          `📝 <b>Error Details:</b>\n<code>${errorMessage}</code>\n\n`;
      }
      
      if (wasRetried) {
        failureText += `🔄 <b>Note:</b> We tried connecting multiple times but couldn't establish a stable connection.\n\n`;
      }
      
      failureText += 
        `🛠️ <b>Troubleshooting Tips:</b>\n` +
        `• Make sure your wallet app supports WalletConnect\n` +
        `• Try restarting your wallet app\n` +
        `• Use a different wallet app\n` +
        `• Check if your wallet has the latest updates`;

      await WalletConnectService.botInstance.telegram.sendMessage(
        parseInt(userId),
        failureText,
        {
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          reply_markup: {
            inline_keyboard: [
              [
                { text: 'Try Again', callback_data: 'wallet_connect' },
                { text: 'Get Help', callback_data: 'menu_help' }
              ],
              [
                { text: 'Main Menu', callback_data: 'menu_main' }
              ]
            ]
          }
        } as any
      );

      this.logger.info('Connection failure notification sent successfully', {
        userId,
        errorType: errorMessage.includes('timeout') ? 'timeout' : 'error',
        wasRetried
      });

    } catch (error: any) {
      this.logger.error('Failed to send connection failure notification:', {
        error: error.message,
        userId,
        originalError: errorMessage
      });
    }
  }

  /**
   * Send wallet connected notification to user
   */
  private async sendWalletConnectedNotification(userId: string, walletAddress: string, peerName?: string): Promise<void> {
    try {
      // Check if wallet connection notifications are enabled
      if (!this.config.notifications.walletConnected) {
        this.logger.debug('Wallet connection notifications disabled by config');
        return;
      }

      // Check if bot instance is available
      if (!WalletConnectService.botInstance) {
        this.logger.warn('Bot instance not available for sending wallet connection notification', { userId });
        return;
      }

      const user = await this.storage.getUser(userId);
      if (!user) {
        this.logger.warn('User not found for wallet connection notification', { userId });
        return;
      }

      const maskWalletAddress = (address: string): string => {
        if (!address || address.length <= 10) return address || 'Unknown';
        return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
      };

      const connectionText = 
        '✅ <b>Wallet Connected Successfully!</b>\n\n' +
        `👛 <b>Wallet:</b> <code>${maskWalletAddress(walletAddress)}</code>\n` +
        `🔗 <b>Connected via:</b> ${peerName || 'WalletConnect'}\n\n` +
        '🎉 <b>Great!</b> Your wallet is now connected and you can:\n' +
        '• Receive airdrop rewards\n' +
        '• Access wallet-exclusive tasks\n' +
        '• Prepare for token distribution\n\n' +
        '🔒 <b>Security:</b> Your private keys remain safe in your wallet.';

      await WalletConnectService.botInstance.telegram.sendMessage(
        parseInt(userId),
        connectionText,
        {
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          reply_markup: {
            inline_keyboard: [
              [
                { text: 'View Wallet', callback_data: 'wallet_show' },
                { text: 'View Tasks', callback_data: 'menu_tasks' }
              ],
              [
                { text: 'Main Menu', callback_data: 'menu_main' }
              ]
            ]
          }
        } as any
      );

      this.logger.info('Wallet connection notification sent successfully', {
        userId,
        walletAddress: maskWalletAddress(walletAddress),
        peerName
      });

    } catch (error: any) {
      this.logger.error('Failed to send wallet connection notification:', {
        error: error.message,
        userId,
        walletAddress
      });
    }
  }

  private async sendWalletDisconnectedNotification(userId: string, walletAddress: string, reason: string): Promise<void> {
    try {
      if (!this.config.notifications.walletDisconnected) return;
      if (!WalletConnectService.botInstance) return;

      const mask = (a: string) => (a && a.length > 10 ? `${a.substring(0,6)}...${a.substring(a.length-4)}` : a || 'Unknown');
      const text =
        '🔌 <b>Wallet Disconnected</b>\n\n' +
        `👛 <b>Wallet:</b> <code>${mask(walletAddress)}</code>\n` +
        `⏰ <b>Reason:</b> ${reason}\n\n` +
        'Your WalletConnect session has expired. Please reconnect to continue.';

      await WalletConnectService.botInstance.telegram.sendMessage(
        parseInt(userId),
        text,
        {
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          reply_markup: {
            inline_keyboard: [
              [ { text: '🔗 Reconnect Wallet', callback_data: 'wallet_connect' } ],
              [ { text: 'Main Menu', callback_data: 'menu_main' } ]
            ]
          }
        } as any
      );
    } catch (error) {
      this.logger.error('Failed to send wallet disconnected notification', { userId, error });
    }
  }

}