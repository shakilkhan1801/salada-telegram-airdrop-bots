/**
 * Salada Protocol CAPTCHA Main Application
 * Simple Hash-Based Multi-Account Detection
 */

class CaptchaApp {
    constructor() {
        this.deviceFingerprint = new DeviceFingerprint();
        this.currentSession = null;
        this.telegramUser = null;
        this.pathPrefix = window.location.pathname.startsWith('/en/') ? '/en' : '';
        this.apiBase = this.pathPrefix + '/api/captcha';
        this.debug = new URLSearchParams(window.location.search).has('debug');
        
        this.mainButtonInitialized = false;
        this.fingerprintHash = null;
        this.verificationSent = false;
        
        this.initializeTelegram();
        this.init();
    }

    /**
     * Initialize Telegram Web App
     */
    initializeTelegram() {
        if (window.Telegram && window.Telegram.WebApp) {
            const tg = window.Telegram.WebApp;
            tg.ready();
            tg.expand();
            
            if (tg.initDataUnsafe && tg.initDataUnsafe.user) {
                this.telegramUser = tg.initDataUnsafe.user;
                this.debug && console.log('Telegram user:', this.telegramUser);
            }
            
            document.documentElement.style.setProperty('--tg-bg-color', tg.backgroundColor);
            document.documentElement.style.setProperty('--tg-text-color', tg.textColor);
        } else {
            this.debug && console.warn('Telegram Web App not available');
            this.telegramUser = {
                id: Math.floor(Math.random() * 1000000),
                first_name: 'Test User',
                language_code: 'en'
            };
        }
    }

    /**
     * Initialize the application
     */
    async init() {
        try {
            if (this.debug) {
                document.getElementById('debugPanel')?.classList.remove('hidden');
            }

            // Generate simple fingerprint hash
            this.debug && console.log('🔍 Generating device fingerprint hash...');
            this.fingerprintHash = await this.deviceFingerprint.generate();
            this.debug && console.log('✅ Fingerprint generated:', this.fingerprintHash.substring(0, 16) + '...');
            
            if (this.debug && document.getElementById('debugFingerprint')) {
                document.getElementById('debugFingerprint').textContent = this.fingerprintHash.substring(0, 16) + '...';
                document.getElementById('debugUserId').textContent = this.telegramUser?.id || 'Unknown';
            }
            
            this.generateRayId();
            
            // Fingerprint hash is ready - show slider immediately
            this.debug && console.log('✅ Device fingerprint ready - showing slider');
            
            // Show slider immediately (don't wait for anything)
            this.showCheckboxChallenge();
            
        } catch (error) {
            this.debug && console.error('Initialization error:', error);
            this.showError('Failed to initialize security verification', error.message);
        }
    }

    /**
     * Generate random ray ID
     */
    generateRayId() {
        const chars = '0123456789abcdef';
        let rayId = '';
        for (let i = 0; i < 16; i++) {
            rayId += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        document.getElementById('rayId').textContent = rayId;
    }

    /**
     * Show unique shield-style slider challenge
     */
    showCheckboxChallenge() {
        const challengeContainer = document.getElementById('challengeContainer');
        
        document.getElementById('statusTitle').textContent = 'Prove your humanity';
        const refreshBtn = document.getElementById('refreshBtn');
        if (refreshBtn) refreshBtn.style.display = 'none';

        challengeContainer.innerHTML = `
            <div class="shield-captcha-container">
                <div class="shield-slider-track" id="sliderTrack">
                    <div class="shield-slider-thumb" id="sliderThumb">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                           <path d="M12 2L22 8.5V15.5C22 19.09 19.09 22 15.5 22H8.5C4.91 22 2 19.09 2 15.5V8.5L12 2Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
                        </svg>
                    </div>
                    <span class="slider-text">Slide to verify</span>
                </div>
                <div class="shield-branding">
                    <span>Powered by</span> <strong>SALADA</strong>
                </div>
            </div>
        `;

        this.showStep('challenge');
        this.initializeSlider();
    }
    
    /**
     * Initialize the slider functionality
     */
    initializeSlider() {
        const sliderThumb = document.getElementById('sliderThumb');
        const sliderTrack = document.getElementById('sliderTrack');
        const sliderText = sliderTrack.querySelector('.slider-text');

        let isSliding = false;
        let startX = 0;
        let offsetX = 0;

        const handleInteraction = (action, event) => {
            switch(action) {
                case 'start':
                    if (sliderTrack.classList.contains('success')) return;
                    isSliding = true;
                    sliderThumb.classList.add('sliding');
                    startX = event.clientX || event.touches[0].clientX;
                    this.slideStartTime = Date.now();
                    break;
                
                case 'move':
                    if (!isSliding) return;
                    event.preventDefault();
                    const currentX = event.clientX || event.touches[0].clientX;
                    offsetX = Math.min(Math.max(0, currentX - startX), sliderTrack.offsetWidth - sliderThumb.offsetWidth);
                    sliderThumb.style.transform = `translateX(${offsetX}px)`;
                    sliderText.style.opacity = 1 - (offsetX / (sliderTrack.offsetWidth / 2));
                    break;
                    
                case 'end':
                    if (!isSliding) return;
                    isSliding = false;
                    sliderThumb.classList.remove('sliding');
                    const threshold = sliderTrack.offsetWidth - sliderThumb.offsetWidth - 5;

                    if (offsetX >= threshold) {
                        this.completeVerification();
                    } else {
                        sliderThumb.style.transform = `translateX(0px)`;
                        sliderText.style.opacity = 1;
                    }
                    break;
            }
        };
        
        sliderThumb.addEventListener('mousedown', e => handleInteraction('start', e));
        document.addEventListener('mousemove', e => handleInteraction('move', e));
        document.addEventListener('mouseup', e => handleInteraction('end', e));
        
        sliderThumb.addEventListener('touchstart', e => handleInteraction('start', e), { passive: true });
        document.addEventListener('touchmove', e => handleInteraction('move', e));
        document.addEventListener('touchend', e => handleInteraction('end', e));
    }
    
    /**
     * Complete the verification after successful slide
     */
    async completeVerification() {
        // Prevent duplicate verification attempts
        if (this.verificationSent) {
            this.debug && console.warn('⚠️ Verification already in progress');
            return;
        }
        
        const sliderTrack = document.getElementById('sliderTrack');
        const sliderThumb = document.getElementById('sliderThumb');

        sliderTrack.classList.add('success');
        sliderThumb.innerHTML = `
            <svg class="checkmark-icon" width="24" height="24" viewBox="0 0 24 24">
                <path d="M9 12L11 14L15 10" stroke="white" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        `;
        
        document.getElementById('statusTitle').textContent = 'Verifying...';
        
        // Send verification to server
        try {
            await this.sendVerification();
        } catch (error) {
            this.debug && console.error('❌ Verification failed:', error);
            this.showError('Verification Failed', 'Please try again.');
        }
    }

    /**
     * Send verification to server (called when user completes slider)
     */
    async sendVerification() {
        if (this.verificationSent) {
            this.debug && console.warn('⚠️ Verification already sent, skipping duplicate');
            return;
        }
        
        this.verificationSent = true;
        
        try {
            this.debug && console.log('📨 Sending verification to server...');
            
            const verificationData = {
                userId: this.telegramUser?.id?.toString(),
                fingerprintHash: this.fingerprintHash,
                deviceInfo: this.deviceFingerprint.deviceInfo,
                slideTime: this.slideStartTime ? (Date.now() - this.slideStartTime) : null,
                timestamp: Date.now()
            };
            
            const apiEndpoint = this.pathPrefix + '/api/miniapp/simple-verify';
            
            // Add timeout to prevent hanging
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000);
            
            const response = await fetch(apiEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Telegram-Init-Data': this.getTelegramInitData()
                },
                body: JSON.stringify(verificationData),
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);

            const result = await response.json();
            
            if (result.success) {
                this.debug && console.log('✅ Verification successful');
                await this.handleVerificationSuccess({ success: true, method: 'slider' });
            } else if (result.blocked) {
                this.debug && console.warn('⚠️ User blocked for multi-account');
                // Still show success to user (blocking message will come via Telegram)
                await this.handleVerificationSuccess({ success: true, method: 'slider' });
            } else {
                this.debug && console.error('❌ Verification failed:', result.message);
                this.showError('Verification Failed', result.message || 'Please try again.');
            }
            
        } catch (error) {
            this.debug && console.error('❌ Error sending verification:', error);
            
            // Retry once on failure
            try {
                this.debug && console.log('🔄 Retrying verification...');
                await this.sendVerificationRetry();
            } catch (retryError) {
                this.debug && console.error('❌ Retry failed:', retryError);
                this.showError('Connection Error', 'Failed to complete verification. Please try again.');
            }
        }
    }

    /**
     * Retry verification (simplified - no background data needed)
     */
    async sendVerificationRetry() {
        const verificationData = {
            userId: this.telegramUser?.id?.toString(),
            fingerprintHash: this.fingerprintHash,
            timestamp: Date.now()
        };
        
        const response = await fetch(this.pathPrefix + '/api/miniapp/simple-verify', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Telegram-Init-Data': this.getTelegramInitData()
            },
            body: JSON.stringify(verificationData)
        });
        
        const result = await response.json();
        
        if (result.success || result.blocked) {
            await this.handleVerificationSuccess({ success: true, method: 'slider' });
        } else {
            throw new Error(result.message || 'Verification failed');
        }
    }

    /**
     * Handle successful verification
     */
    async handleVerificationSuccess(result) {
        this.debug && console.log('✅ Verification successful:', result);
        
        this.showStep('success');
        document.getElementById('statusTitle').textContent = 'Verification successful';
        
        // Show Telegram MainButton
        if (window.Telegram && window.Telegram.WebApp) {
            setTimeout(() => {
                const tg = window.Telegram.WebApp;
                tg.MainButton.setText('Continue to Bot');
                tg.MainButton.show();
                if (!this.mainButtonInitialized) {
                    tg.MainButton.onClick(() => { tg.close(); });
                    this.mainButtonInitialized = true;
                }
            }, 1000);
        }
    }

    /**
     * Show step
     */
    showStep(step) {
        const steps = ['loading', 'challenge', 'success', 'error'];
        steps.forEach(s => {
            const element = document.getElementById(s + 'Step');
            if (element) {
                if (s === step) {
                    element.classList.remove('hidden');
                } else {
                    element.classList.add('hidden');
                }
            }
        });
    }

    /**
     * Show error
     */
    showError(title, message) {
        this.showStep('error');
        document.getElementById('statusTitle').textContent = title;
        const errorMessage = document.getElementById('errorMessage');
        if (errorMessage) {
            errorMessage.textContent = message;
        }
    }

    /**
     * Get Telegram init data
     */
    getTelegramInitData() {
        if (window.Telegram && window.Telegram.WebApp) {
            return window.Telegram.WebApp.initData;
        }
        return '';
    }
}

// Initialize app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.captchaApp = new CaptchaApp();
    });
} else {
    window.captchaApp = new CaptchaApp();
}
