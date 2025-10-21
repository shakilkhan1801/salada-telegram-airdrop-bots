export interface WelcomeConfig {
  enabled: boolean;
  useEnhancedWelcome: boolean;
  showGettingStarted: boolean;
  showHowToEarn: boolean;
  showBotFeatures: boolean;
  customWelcomeTitle?: string;
  customWelcomeMessage?: string;
  brandEmoji: string;
  accentColor: 'green' | 'blue' | 'purple' | 'orange' | 'red';
  language: 'en' | 'bn' | 'mixed';
  showPointsInWelcome: boolean;
  showReferralCodeInWelcome: boolean;
  autoShowMenuDelay?: number; // in milliseconds, 0 to disable
}

export const defaultWelcomeConfig: WelcomeConfig = {
  enabled: true,
  useEnhancedWelcome: true,
  showGettingStarted: true,
  showHowToEarn: true,
  showBotFeatures: true,
  brandEmoji: '🚀',
  accentColor: 'blue',
  language: 'en',
  showPointsInWelcome: true,
  showReferralCodeInWelcome: true,
  autoShowMenuDelay: 0 // User must click to proceed - professional approach
};

export class WelcomeConfigService {
  private static instance: WelcomeConfigService;
  private config: WelcomeConfig;

  constructor() {
    this.config = { ...defaultWelcomeConfig };
  }

  static getInstance(): WelcomeConfigService {
    if (!WelcomeConfigService.instance) {
      WelcomeConfigService.instance = new WelcomeConfigService();
    }
    return WelcomeConfigService.instance;
  }

  getWelcomeConfig(): WelcomeConfig {
    return { ...this.config };
  }

  updateWelcomeConfig(updates: Partial<WelcomeConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  resetToDefaults(): void {
    this.config = { ...defaultWelcomeConfig };
  }

  // Preset configurations
  getMinimalConfig(): WelcomeConfig {
    return {
      ...defaultWelcomeConfig,
      useEnhancedWelcome: false,
      showGettingStarted: false,
      showHowToEarn: false,
      showBotFeatures: false,
      autoShowMenuDelay: 2000
    };
  }

  getProfessionalConfig(): WelcomeConfig {
    return {
      ...defaultWelcomeConfig,
      useEnhancedWelcome: true,
      showGettingStarted: true,
      showHowToEarn: true,
      showBotFeatures: true,
      brandEmoji: '🚀',
      accentColor: 'blue',
      language: 'en',
      autoShowMenuDelay: 0
    };
  }

  getFriendlyConfig(): WelcomeConfig {
    return {
      ...defaultWelcomeConfig,
      useEnhancedWelcome: true,
      showGettingStarted: true,
      showHowToEarn: true,
      showBotFeatures: false,
      brandEmoji: '👋',
      accentColor: 'green',
      language: 'mixed',
      autoShowMenuDelay: 0
    };
  }
}