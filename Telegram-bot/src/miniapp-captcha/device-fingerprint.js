/**
 * Simple Device Fingerprinting for Multi-Account Prevention
 * Lightweight, fast, and production-ready
 */

class DeviceFingerprint {
    constructor() {
        this.fingerprint = null;
        this.deviceInfo = null;
        this.initialized = false;
    }

    /**
     * Generate simple device fingerprint hash
     * Uses only stable, reliable device characteristics
     */
    async generate() {
        if (this.initialized) {
            return this.fingerprint;
        }

        try {
            const deviceData = await this.collectDeviceInfo();
            this.deviceInfo = deviceData;
            this.fingerprint = await this.generateFingerprint(deviceData);
            this.initialized = true;
            
            return this.fingerprint;
        } catch (error) {
            console.error('Device fingerprinting error:', error);
            return this.generateFallbackFingerprint();
        }
    }

    /**
     * Collect only essential device information
     */
    async collectDeviceInfo() {
        const info = {
            // Screen (most stable identifier)
            screen: {
                width: screen.width,
                height: screen.height,
                colorDepth: screen.colorDepth,
                pixelDepth: screen.pixelDepth
            },

            // Hardware
            hardware: {
                platform: navigator.platform,
                hardwareConcurrency: navigator.hardwareConcurrency || 0,
                deviceMemory: navigator.deviceMemory || 0,
                maxTouchPoints: navigator.maxTouchPoints || 0
            },

            // Timezone (stable)
            timezone: {
                offset: new Date().getTimezoneOffset(),
                name: Intl.DateTimeFormat().resolvedOptions().timeZone
            },

            // Browser basics
            browser: {
                userAgent: navigator.userAgent,
                language: navigator.language
            },

            // Telegram info
            telegram: this.getTelegramInfo(),

            // Timestamp
            timestamp: Date.now()
        };

        return info;
    }

    /**
     * Generate fingerprint hash from device info
     * Uses SHA-256 for cryptographic quality hash
     */
    async generateFingerprint(deviceInfo) {
        // Create fingerprint string from stable components only
        const fingerprintString = [
            deviceInfo.screen.width,
            deviceInfo.screen.height,
            deviceInfo.screen.colorDepth,
            deviceInfo.hardware.platform,
            deviceInfo.hardware.hardwareConcurrency,
            deviceInfo.timezone.name,
            deviceInfo.browser.userAgent,
            deviceInfo.browser.language
        ].join('|');

        // Generate SHA-256 hash
        try {
            const encoder = new TextEncoder();
            const data = encoder.encode(fingerprintString);
            const hash = await crypto.subtle.digest('SHA-256', data);
            return Array.from(new Uint8Array(hash))
                .map(b => b.toString(16).padStart(2, '0'))
                .join('');
        } catch (error) {
            // Fallback to simple hash if Web Crypto is not available
            return this.simpleHash(fingerprintString);
        }
    }

    /**
     * Get Telegram Web App information
     */
    getTelegramInfo() {
        if (window.Telegram && window.Telegram.WebApp) {
            const tg = window.Telegram.WebApp;
            return {
                version: tg.version,
                platform: tg.platform,
                userId: tg.initDataUnsafe?.user?.id || null,
                firstName: tg.initDataUnsafe?.user?.first_name || null,
                username: tg.initDataUnsafe?.user?.username || null,
                languageCode: tg.initDataUnsafe?.user?.language_code || null
            };
        }
        return null;
    }

    /**
     * Simple hash function fallback
     */
    simpleHash(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return Math.abs(hash).toString(16);
    }

    /**
     * Generate fallback fingerprint
     */
    generateFallbackFingerprint() {
        const simpleData = {
            userAgent: navigator.userAgent,
            screen: screen.width + 'x' + screen.height,
            timezone: new Date().getTimezoneOffset(),
            language: navigator.language
        };
        
        return this.simpleHash(JSON.stringify(simpleData));
    }

    /**
     * Get device risk score (simplified)
     */
    getRiskScore() {
        if (!this.deviceInfo) return 0.5;
        
        let riskScore = 0;
        
        // Basic risk indicators
        if (this.deviceInfo.screen.width === 0 || this.deviceInfo.screen.height === 0) {
            riskScore += 0.5;
        }
        
        if (!this.deviceInfo.telegram) {
            riskScore += 0.3;
        }
        
        return Math.min(riskScore, 1.0);
    }
}

// Export for use in main.js
window.DeviceFingerprint = DeviceFingerprint;
