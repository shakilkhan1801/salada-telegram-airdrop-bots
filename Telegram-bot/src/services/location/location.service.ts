import { Logger } from '../logger';
import { getConfig } from '../../config';

// ============================================================================
// UNIFIED INTERFACES AND TYPES
// ============================================================================

export interface LocationData {
  ip: string;
  country: string;
  countryCode: string;
  region: string;
  regionCode: string;
  city: string;
  latitude?: number;
  longitude?: number;
  timezone: string;
  isp: string;
  org: string;
  asn: string;
  proxy: boolean;
  vpn: boolean;
  tor: boolean;
  hosting: boolean;
  mobile: boolean;
  accuracy?: number;
  query?: string;
}

export interface GeolocationData {
  latitude: number;
  longitude: number;
  accuracy?: number;
  altitude?: number;
  altitudeAccuracy?: number;
  heading?: number;
  speed?: number;
  timestamp: number;
  source: 'browser' | 'ip' | 'manual';
}

export interface GeolocationHistory {
  userId: string;
  locations: GeolocationData[];
  suspiciousMovement: boolean;
  riskScore: number;
  lastUpdated: string;
  inconsistencies: string[];
}

export interface LocationConsistencyCheck {
  consistent: boolean;
  riskScore: number;
  discrepancies: string[];
  evidence: {
    ipLocation: LocationData;
    browserTimezone?: string;
    browserLanguage?: string;
    suspiciousIndicators: string[];
  };
}

export interface GeolocationValidation {
  valid: boolean;
  riskScore: number;
  reasons: string[];
  evidence: {
    browserLocation?: GeolocationData;
    ipLocation: LocationData;
    distanceKm?: number;
    timeInconsistent: boolean;
    impossibleMovement: boolean;
  };
}

export interface LocationRiskAssessment {
  riskScore: number;
  riskFactors: string[];
  recommendation: 'allow' | 'require_verification' | 'block';
}

/**
 * Unified Location Service
 * Combines IP-based location detection, browser geolocation validation,
 * and comprehensive location risk assessment into a single service
 */
export class LocationService {
  private readonly logger = Logger.getInstance();
  private readonly config = getConfig();

  // ========================================================================
  // IP LOCATION DETECTION METHODS
  // ========================================================================

  /**
   * Get comprehensive location data from IP address
   */
  async getLocationFromIP(ip: string): Promise<LocationData | null> {
    try {
      // Short-circuit for invalid/placeholder/private IPs to avoid unnecessary lookups
      if (!ip) return null;
      const v = ip.trim().toLowerCase();
      if (!v || v === 'unknown' || v === 'telegram' || v === '::1' || v.startsWith('127.') || v.startsWith('10.') || v.startsWith('192.168.') || v.startsWith('172.16.')) {
        return null;
      }
      // Try multiple IP geolocation services for accuracy
      const services = [
        () => this.getFromIPAPI(ip),
        () => this.getFromIPInfo(ip),
        () => this.getFromIPStack(ip)
      ];

      for (const service of services) {
        try {
          const result = await service();
          if (result) {
            this.logger.info(`Location data retrieved for IP: ${ip}`, { 
              country: result.country, 
              city: result.city 
            });
            return result;
          }
        } catch (error: any) {
          this.logger.warn(`Location service failed`, { error: error.message });
          continue;
        }
      }

      return null;
    } catch (error: any) {
      this.logger.error('Location service error', { error: error.message, ip });
      return null;
    }
  }

  /**
   * Get location from IP-API service
   */
  private async getFromIPAPI(ip: string): Promise<LocationData | null> {
    const response = await fetch(`http://ip-api.com/json/${ip}?fields=66846719`);
    const data = await response.json();
    
    if (data.status === 'fail') return null;
    
    return {
      ip,
      country: data.country || 'Unknown',
      countryCode: data.countryCode || 'XX',
      region: data.regionName || 'Unknown',
      regionCode: data.region || 'XX',
      city: data.city || 'Unknown',
      latitude: data.lat,
      longitude: data.lon,
      timezone: data.timezone || 'UTC',
      isp: data.isp || 'Unknown',
      org: data.org || 'Unknown',
      asn: data.as || 'Unknown',
      proxy: data.proxy || false,
      vpn: false, // IP-API doesn't provide VPN detection
      tor: false,
      hosting: data.hosting || false,
      mobile: data.mobile || false,
      query: data.query
    };
  }

  /**
   * Get location from IPInfo service
   */
  private async getFromIPInfo(ip: string): Promise<LocationData | null> {
    try {
      const response = await fetch(`https://ipinfo.io/${ip}/json`);
      const data = await response.json();
      
      if (data.bogon) return null;
      
      const [lat, lng] = data.loc ? data.loc.split(',').map(Number) : [undefined, undefined];
      
      return {
        ip,
        country: data.country_name || 'Unknown',
        countryCode: data.country || 'XX',
        region: data.region || 'Unknown',
        regionCode: data.region || 'XX',
        city: data.city || 'Unknown',
        latitude: lat,
        longitude: lng,
        timezone: data.timezone || 'UTC',
        isp: data.org || 'Unknown',
        org: data.org || 'Unknown',
        asn: data.asn?.asn || 'Unknown',
        proxy: false, // Would need additional service
        vpn: false,
        tor: false,
        hosting: false,
        mobile: false
      };
    } catch (error) {
      this.logger.warn('IPInfo service failed', { error });
      return null;
    }
  }

  /**
   * Get location from IPStack service (requires API key)
   */
  private async getFromIPStack(ip: string): Promise<LocationData | null> {
    // This would require an API key in production
    // For now, return null to fallback to other services
    return null;
  }

  // ========================================================================
  // LOCATION CONSISTENCY AND VALIDATION
  // ========================================================================

  /**
   * Check location consistency between IP and browser data
   */
  checkLocationConsistency(
    ipLocation: LocationData, 
    browserTimezone?: string, 
    browserLanguage?: string
  ): LocationConsistencyCheck {
    const discrepancies: string[] = [];
    const suspiciousIndicators: string[] = [];
    let riskScore = 0;

    // Check timezone consistency
    if (ipLocation.timezone && browserTimezone) {
      const ipTz = ipLocation.timezone.toLowerCase();
      const browserTz = browserTimezone.toLowerCase();
      
      if (!this.areTimezonesConsistent(ipTz, browserTz)) {
        discrepancies.push(`Timezone mismatch: IP(${ipTz}) vs Browser(${browserTz})`);
        riskScore += 0.3;
      }
    }

    // Check language consistency with country
    if (ipLocation.countryCode && browserLanguage) {
      const expectedLanguages = this.getExpectedLanguages(ipLocation.countryCode);
      const browserLang = browserLanguage.split('-')[0].toLowerCase();
      
      if (!expectedLanguages.includes(browserLang)) {
        discrepancies.push(`Language unusual for country: ${browserLang} in ${ipLocation.country}`);
        riskScore += 0.2;
      }
    }

    // Check for VPN/Proxy indicators
    if (ipLocation.vpn || ipLocation.proxy || ipLocation.tor) {
      suspiciousIndicators.push('VPN/Proxy/Tor detected');
      riskScore += 0.4;
    }

    if (ipLocation.hosting) {
      suspiciousIndicators.push('Hosting/Datacenter IP detected');
      riskScore += 0.3;
    }

    // Check for unusual location patterns
    if (this.isHighRiskLocation(ipLocation.countryCode)) {
      suspiciousIndicators.push('High-risk geographic location');
      riskScore += 0.2;
    }

    return {
      consistent: riskScore < 0.3,
      riskScore: Math.min(riskScore, 1.0),
      discrepancies,
      evidence: {
        ipLocation,
        browserTimezone,
        browserLanguage,
        suspiciousIndicators
      }
    };
  }

  /**
   * Validate geolocation consistency between browser and IP data
   */
  async validateGeolocation(
    browserGeolocation: GeolocationData | null,
    ipLocation: LocationData,
    previousLocation?: GeolocationData,
    timeGapMinutes?: number
  ): Promise<GeolocationValidation> {
    const reasons: string[] = [];
    let riskScore = 0;
    let distanceKm: number | undefined;
    let impossibleMovement = false;
    let timeInconsistent = false;

    // If browser geolocation is available, compare with IP location
    if (browserGeolocation && ipLocation.latitude && ipLocation.longitude) {
      distanceKm = this.calculateDistance(
        browserGeolocation.latitude,
        browserGeolocation.longitude,
        ipLocation.latitude,
        ipLocation.longitude
      );

      // Flag large discrepancies (more than 100km)
      if (distanceKm > 100) {
        reasons.push(`Large distance between browser and IP location: ${distanceKm.toFixed(2)}km`);
        riskScore += 0.3;
      }

      // Check for impossible movement if we have previous location
      if (previousLocation && timeGapMinutes) {
        const movementDistance = this.calculateDistance(
          previousLocation.latitude,
          previousLocation.longitude,
          browserGeolocation.latitude,
          browserGeolocation.longitude
        );

        const maxPossibleSpeed = 900; // km/h (commercial aircraft)
        const maxPossibleDistance = (maxPossibleSpeed * timeGapMinutes) / 60;

        if (movementDistance > maxPossibleDistance) {
          impossibleMovement = true;
          reasons.push(`Impossible movement detected: ${movementDistance.toFixed(2)}km in ${timeGapMinutes} minutes`);
          riskScore += 0.6;
        }
      }
    }

    // Check timestamp consistency
    if (browserGeolocation) {
      const now = Date.now();
      const locationAge = now - browserGeolocation.timestamp;
      
      if (locationAge > 3600000) { // More than 1 hour old
        timeInconsistent = true;
        reasons.push('Browser location data is stale');
        riskScore += 0.2;
      }
    }

    // Check coordinate validity
    if (browserGeolocation && !this.validateCoordinates(browserGeolocation.latitude, browserGeolocation.longitude)) {
      reasons.push('Invalid coordinates provided');
      riskScore += 0.4;
    }

    return {
      valid: riskScore < 0.4,
      riskScore: Math.min(riskScore, 1.0),
      reasons,
      evidence: {
        browserLocation: browserGeolocation || undefined,
        ipLocation,
        distanceKm,
        timeInconsistent,
        impossibleMovement
      }
    };
  }

  /**
   * Validate geographic coordinates
   */
  validateCoordinates(lat?: number, lng?: number): boolean {
    if (lat === undefined || lng === undefined) return true;
    
    return (
      lat >= -90 && lat <= 90 &&
      lng >= -180 && lng <= 180 &&
      !(lat === 0 && lng === 0) // Null Island check
    );
  }

  // ========================================================================
  // GEOLOCATION HISTORY AND PATTERN ANALYSIS
  // ========================================================================

  /**
   * Track user location history and detect patterns
   */
  async trackLocationHistory(
    userId: string,
    newLocation: GeolocationData
  ): Promise<GeolocationHistory> {
    // Load existing history
    const existingHistory = await this.loadLocationHistory(userId);
    
    // Add new location to history
    existingHistory.locations.push(newLocation);
    
    // Keep only last 100 locations to prevent unbounded growth
    if (existingHistory.locations.length > 100) {
      existingHistory.locations = existingHistory.locations.slice(-100);
    }

    // Analyze for suspicious patterns
    const analysis = this.analyzeLocationPattern(existingHistory.locations);
    existingHistory.suspiciousMovement = analysis.suspicious;
    existingHistory.riskScore = analysis.riskScore;
    existingHistory.inconsistencies = analysis.reasons;
    existingHistory.lastUpdated = new Date().toISOString();

    // Save updated history
    await this.saveLocationHistory(userId, existingHistory);

    return existingHistory;
  }

  /**
   * Analyze location patterns for suspicious behavior
   */
  analyzeLocationPattern(locations: GeolocationData[]): {
    suspicious: boolean;
    riskScore: number;
    reasons: string[];
  } {
    if (locations.length < 2) {
      return { suspicious: false, riskScore: 0, reasons: [] };
    }

    const reasons: string[] = [];
    let riskScore = 0;

    // Check for teleportation (impossible rapid movement)
    for (let i = 1; i < locations.length; i++) {
      const prev = locations[i - 1];
      const curr = locations[i];
      const timeDiffMinutes = (curr.timestamp - prev.timestamp) / (1000 * 60);
      
      if (timeDiffMinutes > 0) {
        const distance = this.calculateDistance(
          prev.latitude,
          prev.longitude,
          curr.latitude,
          curr.longitude
        );

        const maxSpeed = 900; // km/h
        const maxDistance = (maxSpeed * timeDiffMinutes) / 60;

        if (distance > maxDistance) {
          reasons.push(`Teleportation detected: ${distance.toFixed(2)}km in ${timeDiffMinutes.toFixed(1)} minutes`);
          riskScore += 0.4;
        }
      }
    }

    // Check for coordinate clustering (bot-like behavior)
    const uniqueLocations = new Set(
      locations.map(loc => `${loc.latitude.toFixed(4)},${loc.longitude.toFixed(4)}`)
    );

    if (locations.length > 10 && uniqueLocations.size < locations.length * 0.3) {
      reasons.push('Highly repetitive location pattern detected');
      riskScore += 0.3;
    }

    // Check for impossible accuracy (fake GPS)
    const highAccuracyCount = locations.filter(loc => 
      loc.accuracy !== undefined && loc.accuracy < 1
    ).length;

    if (highAccuracyCount > locations.length * 0.8) {
      reasons.push('Suspiciously high GPS accuracy in most readings');
      riskScore += 0.2;
    }

    // Check for location data from multiple continents in short time
    if (this.hasMultipleContinentJumps(locations)) {
      reasons.push('Multiple continent jumps detected');
      riskScore += 0.5;
    }

    return {
      suspicious: riskScore > 0.3,
      riskScore: Math.min(riskScore, 1.0),
      reasons
    };
  }

  /**
   * Check for jumps between different continents
   */
  private hasMultipleContinentJumps(locations: GeolocationData[]): boolean {
    if (locations.length < 3) return false;

    const continents = locations.map(loc => this.getContinent(loc.latitude, loc.longitude));
    const uniqueContinents = new Set(continents);
    
    // More than 2 different continents within the location history is suspicious
    return uniqueContinents.size > 2;
  }

  /**
   * Get continent from coordinates (rough approximation)
   */
  private getContinent(lat: number, lng: number): string {
    if (lat > 71) return 'Antarctica'; // Arctic regions
    if (lat < -60) return 'Antarctica';
    
    if (lng >= -170 && lng <= -30) {
      if (lat > 20) return 'North America';
      if (lat < -15) return 'South America';
      return 'Americas';
    }
    
    if (lng >= -30 && lng <= 60) {
      if (lat > 35) return 'Europe';
      return 'Africa';
    }
    
    if (lng >= 60 && lng <= 180) {
      if (lat > 25) return 'Asia';
      return 'Oceania';
    }
    
    return 'Unknown';
  }

  // ========================================================================
  // GEOGRAPHIC CALCULATIONS
  // ========================================================================

  /**
   * Calculate distance between two coordinates (Haversine formula)
   */
  calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371; // Earth's radius in kilometers
    const dLat = this.toRadians(lat2 - lat1);
    const dLng = this.toRadians(lng2 - lng1);
    
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(this.toRadians(lat1)) * Math.cos(this.toRadians(lat2)) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /**
   * Check if coordinates are within a specific country/region
   */
  isWithinRegion(lat: number, lng: number, region: 'country' | 'continent', code: string): boolean {
    // This would typically use a geofencing library or service
    // For now, implement basic continent checks
    if (region === 'continent') {
      const continent = this.getContinent(lat, lng);
      return continent.toLowerCase() === code.toLowerCase();
    }
    
    // Country checks would require more detailed geographical data
    return false;
  }

  /**
   * Convert degrees to radians
   */
  private toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  }

  // ========================================================================
  // RISK ASSESSMENT METHODS
  // ========================================================================

  /**
   * Generate comprehensive location risk assessment
   */
  async generateLocationRiskAssessment(
    browserLocation: GeolocationData | null,
    ipLocation: LocationData,
    locationHistory?: GeolocationHistory,
    browserTimezone?: string,
    browserLanguage?: string
  ): Promise<LocationRiskAssessment> {
    let riskScore = 0;
    const riskFactors: string[] = [];

    // IP location consistency check
    const consistencyCheck = this.checkLocationConsistency(ipLocation, browserTimezone, browserLanguage);
    riskScore += consistencyCheck.riskScore * 0.4;
    riskFactors.push(...consistencyCheck.discrepancies);
    riskFactors.push(...consistencyCheck.evidence.suspiciousIndicators);

    // Browser/IP geolocation validation
    if (browserLocation) {
      const geolocationValidation = await this.validateGeolocation(browserLocation, ipLocation);
      riskScore += geolocationValidation.riskScore * 0.4;
      riskFactors.push(...geolocationValidation.reasons);
    }

    // Historical patterns
    if (locationHistory) {
      riskScore += locationHistory.riskScore * 0.2;
      riskFactors.push(...locationHistory.inconsistencies);
    }

    // VPN/Proxy indicators
    if (ipLocation.vpn || ipLocation.proxy) {
      riskScore += 0.4;
      riskFactors.push('VPN or proxy detected');
    }

    // Browser/IP location mismatch
    if (browserLocation && ipLocation.latitude && ipLocation.longitude) {
      const distance = this.calculateDistance(
        browserLocation.latitude,
        browserLocation.longitude,
        ipLocation.latitude,
        ipLocation.longitude
      );

      if (distance > 50) {
        riskScore += 0.2;
        riskFactors.push('Browser and IP location mismatch');
      }
    }

    // Generate recommendation
    let recommendation: 'allow' | 'require_verification' | 'block';
    if (riskScore < 0.3) {
      recommendation = 'allow';
    } else if (riskScore < 0.7) {
      recommendation = 'require_verification';
    } else {
      recommendation = 'block';
    }

    return {
      riskScore: Math.min(riskScore, 1.0),
      riskFactors: [...new Set(riskFactors)], // Remove duplicates
      recommendation
    };
  }

  // ========================================================================
  // HELPER METHODS
  // ========================================================================

  /**
   * Check if two timezones are geographically consistent
   */
  private areTimezonesConsistent(ipTimezone: string, browserTimezone: string): boolean {
    // Handle common timezone formats and aliases
    const normalizedIp = this.normalizeTimezone(ipTimezone);
    const normalizedBrowser = this.normalizeTimezone(browserTimezone);
    
    // Direct match
    if (normalizedIp === normalizedBrowser) return true;
    
    // Check if they're in the same general region
    const ipRegion = this.getTimezoneRegion(normalizedIp);
    const browserRegion = this.getTimezoneRegion(normalizedBrowser);
    
    return ipRegion === browserRegion;
  }

  /**
   * Get expected languages for a country
   */
  private getExpectedLanguages(countryCode: string): string[] {
    const languageMap: Record<string, string[]> = {
      'US': ['en'],
      'GB': ['en'],
      'CA': ['en', 'fr'],
      'FR': ['fr'],
      'DE': ['de'],
      'ES': ['es'],
      'IT': ['it'],
      'RU': ['ru'],
      'CN': ['zh'],
      'JP': ['ja'],
      'KR': ['ko'],
      'BR': ['pt'],
      'IN': ['en', 'hi'],
      'BD': ['bn', 'en'],
      'MX': ['es'],
      'AR': ['es'],
      'AU': ['en'],
      'NZ': ['en'],
      'ZA': ['en', 'af'],
      'NG': ['en'],
      // Add more as needed
    };
    
    return languageMap[countryCode.toUpperCase()] || ['en']; // Default to English
  }

  /**
   * Check if location is considered high-risk
   */
  private isHighRiskLocation(countryCode: string): boolean {
    const highRiskCountries: string[] = ((this.config as any).security?.highRiskCountries) || [];
    return highRiskCountries.includes(countryCode.toLowerCase());
  }

  /**
   * Normalize timezone names for comparison
   */
  private normalizeTimezone(timezone: string): string {
    return timezone
      .toLowerCase()
      .replace(/_/g, '/')
      .replace(/\s+/g, '');
  }

  /**
   * Get timezone region for comparison
   */
  private getTimezoneRegion(timezone: string): string {
    const parts = timezone.split('/');
    return parts[0] || 'unknown';
  }

  // ========================================================================
  // STORAGE METHODS (PLACEHOLDER IMPLEMENTATIONS)
  // ========================================================================

  /**
   * Load location history from storage (placeholder)
   */
  private async loadLocationHistory(userId: string): Promise<GeolocationHistory> {
    // In real implementation, load from database/storage
    return {
      userId,
      locations: [],
      suspiciousMovement: false,
      riskScore: 0,
      lastUpdated: new Date().toISOString(),
      inconsistencies: []
    };
  }

  /**
   * Save location history to storage (placeholder)
   */
  private async saveLocationHistory(userId: string, history: GeolocationHistory): Promise<void> {
    // In real implementation, save to database/storage
    this.logger.info('Location history updated', { 
      userId, 
      locationCount: history.locations.length,
      riskScore: history.riskScore 
    });
  }

  // ========================================================================
  // UTILITY METHODS
  // ========================================================================

  /**
   * Get service health and statistics
   */
  getHealthStatus(): {
    healthy: boolean;
    services: string[];
    lastCheck: string;
  } {
    return {
      healthy: true,
      services: ['IP-API', 'IPInfo'], // Would check actual service availability
      lastCheck: new Date().toISOString()
    };
  }

  /**
   * Clear location history for a user (GDPR compliance)
   */
  async clearLocationHistory(userId: string): Promise<void> {
    // In real implementation, remove from database/storage
    this.logger.info('Location history cleared', { userId });
  }

  /**
   * Get location statistics for monitoring
   */
  async getLocationStatistics(): Promise<{
    totalRequests: number;
    successfulLookups: number;
    failedLookups: number;
    averageRiskScore: number;
  }> {
    // In real implementation, aggregate from metrics/storage
    return {
      totalRequests: 0,
      successfulLookups: 0,
      failedLookups: 0,
      averageRiskScore: 0
    };
  }
}

// Export singleton instance for backwards compatibility
export const locationService = new LocationService();