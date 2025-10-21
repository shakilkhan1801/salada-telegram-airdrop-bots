import { Logger } from './logger';
import { getConfig } from '../config';
import { WalletAppConfig, WalletAppId } from '../types/wallet.types';

export class WalletAppsService {
  private static instance: WalletAppsService;
  private readonly logger = Logger.getInstance();
  private readonly config = getConfig();

  private constructor() {}

  public static getInstance(): WalletAppsService {
    if (!WalletAppsService.instance) {
      WalletAppsService.instance = new WalletAppsService();
    }
    return WalletAppsService.instance;
  }

  /**
   * Get all wallet app configurations
   */
  getAllWalletApps(): WalletAppConfig[] {
    return [
      {
        id: 'metamask',
        name: 'MetaMask',
        description: 'The most popular Ethereum wallet',
        icon: '🦊',
        color: '#f6851b',
        enabled: this.config.wallet.apps.metamask,
        deepLink: {
          mobile: 'metamask://wc?uri=',
          desktop: 'https://metamask.io/download/',
        },
        universalLink: 'https://metamask.app.link/wc?uri=',
        downloadUrl: {
          ios: 'https://apps.apple.com/app/metamask/id1438144202',
          android: 'https://play.google.com/store/apps/details?id=io.metamask',
          chrome: 'https://chrome.google.com/webstore/detail/metamask/nkbihfbeogaeaoehlefnkodbefgpgknn',
        },
        supportedChains: [1, 5, 11155111, 137, 80001, 56, 97, 43114, 43113, 10, 420, 42161, 421613, 8453, 84531],
      },
      {
        id: 'trust',
        name: 'Trust Wallet',
        description: 'Multi-chain mobile wallet',
        icon: '🛡️',
        color: '#3375bb',
        enabled: this.config.wallet.apps.trust,
        deepLink: {
          mobile: 'trust://wc?uri=',
        },
        universalLink: 'https://link.trustwallet.com/wc?uri=',
        downloadUrl: {
          ios: 'https://apps.apple.com/app/trust-crypto-bitcoin-wallet/id1288339409',
          android: 'https://play.google.com/store/apps/details?id=com.wallet.crypto.trustapp',
        },
        supportedChains: [1, 56, 137, 43114, 10, 42161, 250, 25, 100, 128, 66],
      },
      {
        id: 'coinbase',
        name: 'Coinbase Wallet',
        description: 'Self-custody wallet from Coinbase',
        icon: '🔵',
        color: '#0052ff',
        enabled: this.config.wallet.apps.coinbase,
        deepLink: {
          mobile: 'cbwallet://wc?uri=',
        },
        universalLink: 'https://go.cb-w.com/wc?uri=',
        downloadUrl: {
          ios: 'https://apps.apple.com/app/coinbase-wallet-nfts-crypto/id1278383455',
          android: 'https://play.google.com/store/apps/details?id=org.toshi',
          chrome: 'https://chrome.google.com/webstore/detail/coinbase-wallet-extension/hnfanknocfeofbddgcijnmhnfnkdnaad',
        },
        supportedChains: [1, 137, 56, 43114, 10, 42161, 8453, 7777777],
      },
      {
        id: 'rainbow',
        name: 'Rainbow',
        description: 'Colorful Ethereum wallet',
        icon: '🌈',
        color: '#ff4655',
        enabled: this.config.wallet.apps.rainbow,
        deepLink: {
          mobile: 'rainbow://wc?uri=',
        },
        universalLink: 'https://rnbwapp.com/wc?uri=',
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
        icon: '💎',
        color: '#00d4aa',
        enabled: this.config.wallet.apps.bitget,
        deepLink: {
          mobile: 'bitget://wc?uri=',
        },
        universalLink: 'https://bkcode.vip/wc?uri=',
        downloadUrl: {
          ios: 'https://apps.apple.com/app/bitget-wallet/id1649074456',
          android: 'https://play.google.com/store/apps/details?id=com.bitget.wallet',
        },
        supportedChains: [1, 56, 137, 43114, 10, 42161, 25, 199, 288],
      },
      {
        id: 'phantom',
        name: 'Phantom',
        description: 'Solana and Ethereum wallet',
        icon: '👻',
        color: '#ab9ff2',
        enabled: this.config.wallet.apps.phantom,
        deepLink: {
          mobile: 'phantom://wc?uri=',
        },
        universalLink: 'https://phantom.app/ul/browse/',
        downloadUrl: {
          ios: 'https://apps.apple.com/app/phantom-solana-wallet/id1598432977',
          android: 'https://play.google.com/store/apps/details?id=app.phantom',
          chrome: 'https://chrome.google.com/webstore/detail/phantom/bfnaelmomeimhlpmgjnjophhpkkoljpa',
        },
        supportedChains: [1, 137], // Phantom primarily for Solana but supports some EVM chains
      },
      {
        id: 'exodus',
        name: 'Exodus',
        description: 'Beautiful multi-crypto wallet',
        icon: '🚀',
        color: '#0b1426',
        enabled: this.config.wallet.apps.exodus,
        deepLink: {
          mobile: 'exodus://wc?uri=',
          desktop: 'exodus://wc?uri=',
        },
        universalLink: 'https://exodus.com/m/wc?uri=',
        downloadUrl: {
          ios: 'https://apps.apple.com/app/exodus-crypto-bitcoin-wallet/id1414384820',
          android: 'https://play.google.com/store/apps/details?id=exodusmovement.exodus',
        },
        supportedChains: [1, 56, 137, 43114],
      },
      {
        id: 'atomic',
        name: 'Atomic Wallet',
        description: 'Decentralized multi-currency wallet',
        icon: '⚛️',
        color: '#2e7cfd',
        enabled: this.config.wallet.apps.atomic,
        deepLink: {
          mobile: 'atomic://wc?uri=',
        },
        universalLink: 'https://atomicwallet.io/wc?uri=',
        downloadUrl: {
          ios: 'https://apps.apple.com/app/atomic-wallet/id1478257827',
          android: 'https://play.google.com/store/apps/details?id=io.atomicwallet',
        },
        supportedChains: [1, 56, 137, 43114],
      },
      {
        id: 'safepal',
        name: 'SafePal',
        description: 'Hardware and software wallet',
        icon: '🔐',
        color: '#1f1f1f',
        enabled: this.config.wallet.apps.safepal,
        deepLink: {
          mobile: 'safepal://wc?uri=',
        },
        universalLink: 'https://link.safepal.io/wc?uri=',
        downloadUrl: {
          ios: 'https://apps.apple.com/app/safepal-wallet/id1548297139',
          android: 'https://play.google.com/store/apps/details?id=io.safepal.wallet',
        },
        supportedChains: [1, 56, 137, 43114, 10, 42161, 25],
      },
      {
        id: 'tokenpocket',
        name: 'TokenPocket',
        description: 'Multi-chain wallet for everyone',
        icon: '🎒',
        color: '#2980fe',
        enabled: this.config.wallet.apps.tokenpocket,
        deepLink: {
          mobile: 'tpoutside://wc?uri=',
        },
        universalLink: 'https://www.tokenpocket.pro/wc?uri=',
        downloadUrl: {
          ios: 'https://apps.apple.com/app/tokenpocket/id1436028697',
          android: 'https://play.google.com/store/apps/details?id=vip.mytokenpocket',
        },
        supportedChains: [1, 56, 137, 43114, 10, 42161, 25, 66, 128],
      },
      {
        id: 'imtoken',
        name: 'imToken',
        description: 'Simple & secure digital wallet',
        icon: '💫',
        color: '#0e76fd',
        enabled: false, // Not enabled by default
        deepLink: {
          mobile: 'imtokenv2://wc?uri=',
        },
        universalLink: 'https://imtoken.fans/wc?uri=',
        downloadUrl: {
          ios: 'https://apps.apple.com/app/imtoken2/id1384798940',
          android: 'https://play.google.com/store/apps/details?id=im.token.app',
        },
        supportedChains: [1, 56, 137, 43114],
      },
      {
        id: 'oneinch',
        name: '1inch Wallet',
        description: 'DeFi / DEX aggregator wallet',
        icon: '🦄',
        color: '#0d111c',
        enabled: false, // Not enabled by default
        deepLink: {
          mobile: 'oneinch://wc?uri=',
        },
        universalLink: 'https://wallet.1inch.io/wc?uri=',
        downloadUrl: {
          ios: 'https://apps.apple.com/app/1inch-wallet/id1546049391',
          android: 'https://play.google.com/store/apps/details?id=io.oneinch.android',
        },
        supportedChains: [1, 56, 137, 43114, 10, 42161],
      },
      {
        id: 'mathwallet',
        name: 'Math Wallet',
        description: 'Multi-platform crypto wallet',
        icon: '🔢',
        color: '#373737',
        enabled: false, // Not enabled by default
        deepLink: {
          mobile: 'mathwallet://wc?uri=',
        },
        universalLink: 'https://mathwallet.org/wc?uri=',
        downloadUrl: {
          ios: 'https://apps.apple.com/app/mathwallet/id1463026952',
          android: 'https://play.google.com/store/apps/details?id=com.medishares.android',
          chrome: 'https://chrome.google.com/webstore/detail/math-wallet/afbcbjpbpfadlkmhmclhkeeodmamcflc',
        },
        supportedChains: [1, 56, 137, 43114, 128, 66],
      },
      {
        id: 'alphaWallet',
        name: 'AlphaWallet',
        description: 'The Web3 wallet',
        icon: '🔥',
        color: '#0a84ff',
        enabled: false, // Not enabled by default
        deepLink: {
          mobile: 'alphawallet://wc?uri=',
        },
        universalLink: 'https://alphawallet.com/wc?uri=',
        downloadUrl: {
          ios: 'https://apps.apple.com/app/alphawallet/id1358230430',
          android: 'https://play.google.com/store/apps/details?id=io.stormbird.wallet',
        },
        supportedChains: [1, 137, 56, 43114, 100],
      },
      {
        id: 'zerion',
        name: 'Zerion',
        description: 'Invest in DeFi from one place',
        icon: '🔷',
        color: '#7c3aed',
        enabled: false, // Not enabled by default
        deepLink: {
          mobile: 'zerion://wc?uri=',
        },
        universalLink: 'https://link.zerion.io/wc?uri=',
        downloadUrl: {
          ios: 'https://apps.apple.com/app/zerion/id1456732565',
          android: 'https://play.google.com/store/apps/details?id=io.zerion.android',
        },
        supportedChains: [1, 137, 56, 43114, 10, 42161],
      },
      {
        id: 'pillar',
        name: 'Pillar',
        description: 'Smart personal finance made simple',
        icon: '🏛️',
        color: '#00ff88',
        enabled: false, // Not enabled by default
        deepLink: {
          mobile: 'pillar://wc?uri=',
        },
        universalLink: 'https://pillarproject.io/wc?uri=',
        downloadUrl: {
          ios: 'https://apps.apple.com/app/pillar-wallet/id1346582238',
          android: 'https://play.google.com/store/apps/details?id=com.pillarproject.wallet',
        },
        supportedChains: [1, 137, 56],
      },
    ];
  }

  /**
   * Get enabled wallet apps only
   */
  getEnabledWalletApps(): WalletAppConfig[] {
    return this.getAllWalletApps().filter(app => app.enabled);
  }

  /**
   * Get wallet app by ID
   */
  getWalletApp(id: WalletAppId): WalletAppConfig | undefined {
    return this.getAllWalletApps().find(app => app.id === id);
  }

  /**
   * Generate deep link for wallet app
   * FIXED: Properly encode URI for Telegram compatibility
   */
  generateDeepLink(walletAppId: WalletAppId, uri: string): string {
    const walletApp = this.getWalletApp(walletAppId);
    if (!walletApp) {
      throw new Error(`Wallet app ${walletAppId} not found`);
    }

    // For Telegram, we need to use universal links for better compatibility
    // Universal links work more reliably than custom URL schemes in Telegram
    if (walletApp.universalLink) {
      // Don't double-encode if URI is already a complete WalletConnect URI
      // Just encode it once for URL safety
      const encodedUri = encodeURIComponent(uri);
      return `${walletApp.universalLink}${encodedUri}`;
    }
    
    // Fallback to mobile deep link (less reliable in Telegram)
    const encodedUri = encodeURIComponent(uri);
    return `${walletApp.deepLink.mobile}${encodedUri}`;
  }

  /**
   * Generate Telegram inline button for wallet app
   */
  generateTelegramButton(walletAppId: WalletAppId, uri: string): {
    text: string;
    url: string;
  } {
    const walletApp = this.getWalletApp(walletAppId);
    if (!walletApp) {
      throw new Error(`Wallet app ${walletAppId} not found`);
    }

    const deepLink = this.generateDeepLink(walletAppId, uri);
    
    return {
      text: `${walletApp.icon} ${walletApp.name}`,
      url: deepLink,
    };
  }

  /**
   * Check if wallet app supports specific chain
   */
  isChainSupported(walletAppId: WalletAppId, chainId: number): boolean {
    const walletApp = this.getWalletApp(walletAppId);
    if (!walletApp) {
      return false;
    }

    return walletApp.supportedChains.includes(chainId);
  }

  /**
   * Get wallet apps that support specific chain
   */
  getWalletAppsForChain(chainId: number): WalletAppConfig[] {
    return this.getEnabledWalletApps().filter(app => 
      app.supportedChains.includes(chainId)
    );
  }

  /**
   * Get wallet app statistics
   */
  getWalletAppStats(): {
    totalWallets: number;
    enabledWallets: number;
    disabledWallets: number;
    walletsByChain: Record<number, number>;
    popularWallets: WalletAppConfig[];
  } {
    const allWallets = this.getAllWalletApps();
    const enabledWallets = this.getEnabledWalletApps();
    
    // Count wallets by chain
    const walletsByChain: Record<number, number> = {};
    enabledWallets.forEach(wallet => {
      wallet.supportedChains.forEach(chainId => {
        walletsByChain[chainId] = (walletsByChain[chainId] || 0) + 1;
      });
    });

    // Get most popular wallets (by number of supported chains)
    const popularWallets = enabledWallets
      .sort((a, b) => b.supportedChains.length - a.supportedChains.length)
      .slice(0, 5);

    return {
      totalWallets: allWallets.length,
      enabledWallets: enabledWallets.length,
      disabledWallets: allWallets.length - enabledWallets.length,
      walletsByChain,
      popularWallets,
    };
  }

  /**
   * Get download URLs for wallet app
   */
  getDownloadUrls(walletAppId: WalletAppId): {
    ios?: string;
    android?: string;
    chrome?: string;
  } {
    const walletApp = this.getWalletApp(walletAppId);
    if (!walletApp) {
      throw new Error(`Wallet app ${walletAppId} not found`);
    }

    return walletApp.downloadUrl;
  }

  /**
   * Check if user agent is mobile
   */
  isMobile(userAgent?: string): boolean {
    if (!userAgent) return false;
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);
  }

  /**
   * Get appropriate deep link based on platform
   */
  getPlatformDeepLink(walletAppId: WalletAppId, uri: string, userAgent?: string): string {
    const walletApp = this.getWalletApp(walletAppId);
    if (!walletApp) {
      throw new Error(`Wallet app ${walletAppId} not found`);
    }

    const encodedUri = encodeURIComponent(uri);
    const isMobile = this.isMobile(userAgent);

    if (isMobile) {
      // Use universal link for better mobile compatibility
      if (walletApp.universalLink) {
        return `${walletApp.universalLink}${encodedUri}`;
      }
      return `${walletApp.deepLink.mobile}${encodedUri}`;
    } else {
      // Desktop
      if (walletApp.deepLink.desktop) {
        return walletApp.deepLink.desktop;
      }
      // Fallback to universal link or mobile deep link
      if (walletApp.universalLink) {
        return `${walletApp.universalLink}${encodedUri}`;
      }
      return `${walletApp.deepLink.mobile}${encodedUri}`;
    }
  }

  /**
   * Generate wallet connection info text
   */
  generateWalletInfoText(walletAppId: WalletAppId): string {
    const walletApp = this.getWalletApp(walletAppId);
    if (!walletApp) {
      throw new Error(`Wallet app ${walletAppId} not found`);
    }

    const chainsText = walletApp.supportedChains.length > 5 
      ? `${walletApp.supportedChains.length}+ chains`
      : `${walletApp.supportedChains.length} chains`;

    return `${walletApp.icon} <b>${walletApp.name}</b>\n${walletApp.description}\n🔗 Supports ${chainsText}`;
  }

  /**
   * Validate wallet app configuration
   */
  validateWalletAppConfig(config: WalletAppConfig): string[] {
    const errors: string[] = [];

    if (!config.id) {
      errors.push('Wallet app ID is required');
    }

    if (!config.name) {
      errors.push('Wallet app name is required');
    }

    if (!config.deepLink.mobile) {
      errors.push('Mobile deep link is required');
    }

    if (!config.supportedChains || config.supportedChains.length === 0) {
      errors.push('At least one supported chain is required');
    }

    return errors;
  }
}