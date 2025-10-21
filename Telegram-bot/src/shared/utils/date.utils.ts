/**
 * Shared date utilities to eliminate duplicate date handling logic
 * across all handlers
 */
export class DateUtils {
  /**
   * Parse user date field that can be either string or Date
   * Handles the common pattern found across all handlers
   */
  static parseUserDate(dateField: any): Date {
    if (!dateField) {
      return new Date();
    }

    if (dateField instanceof Date) {
      return dateField;
    }

    if (typeof dateField === 'string') {
      const parsed = new Date(dateField);
      // Check if the parsed date is valid
      if (!isNaN(parsed.getTime())) {
        return parsed;
      }
    }

    if (typeof dateField === 'number') {
      return new Date(dateField);
    }

    // Fallback to current date for invalid inputs
    return new Date();
  }

  /**
   * Handle the complex user date fallback logic found in handlers
   * Tries joinedAt first, then firstSeen, then current date
   */
  static parseUserJoinDate(user: any): Date {
    // Try joinedAt first
    if (user.joinedAt) {
      return this.parseUserDate(user.joinedAt);
    }

    // Fall back to firstSeen
    if (user.firstSeen) {
      return this.parseUserDate(user.firstSeen);
    }

    // Default to current date
    return new Date();
  }

  /**
   * Format date for display to users
   */
  static formatUserDate(date: Date | string, locale = 'en-US'): string {
    const parsedDate = this.parseUserDate(date);
    return parsedDate.toLocaleDateString(locale, {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }

  /**
   * Format date and time for display to users
   */
  static formatUserDateTime(date: Date | string, locale = 'en-US'): string {
    const parsedDate = this.parseUserDate(date);
    return parsedDate.toLocaleString(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  }

  /**
   * Calculate days since a date
   */
  static calculateDaysSince(date: Date | string): number {
    const parsedDate = this.parseUserDate(date);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - parsedDate.getTime());
    return Math.floor(diffTime / (1000 * 60 * 60 * 24));
  }

  /**
   * Calculate hours since a date
   */
  static calculateHoursSince(date: Date | string): number {
    const parsedDate = this.parseUserDate(date);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - parsedDate.getTime());
    return Math.floor(diffTime / (1000 * 60 * 60));
  }

  /**
   * Calculate minutes since a date
   */
  static calculateMinutesSince(date: Date | string): number {
    const parsedDate = this.parseUserDate(date);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - parsedDate.getTime());
    return Math.floor(diffTime / (1000 * 60));
  }

  /**
   * Check if date is today
   */
  static isToday(date: Date | string): boolean {
    const parsedDate = this.parseUserDate(date);
    const today = new Date();
    
    return parsedDate.getDate() === today.getDate() &&
           parsedDate.getMonth() === today.getMonth() &&
           parsedDate.getFullYear() === today.getFullYear();
  }

  /**
   * Check if date is within the last N days
   */
  static isWithinLastDays(date: Date | string, days: number): boolean {
    const daysSince = this.calculateDaysSince(date);
    return daysSince <= days;
  }

  /**
   * Get start of day for a date
   */
  static getStartOfDay(date: Date | string): Date {
    const parsedDate = this.parseUserDate(date);
    const startOfDay = new Date(parsedDate);
    startOfDay.setHours(0, 0, 0, 0);
    return startOfDay;
  }

  /**
   * Get end of day for a date
   */
  static getEndOfDay(date: Date | string): Date {
    const parsedDate = this.parseUserDate(date);
    const endOfDay = new Date(parsedDate);
    endOfDay.setHours(23, 59, 59, 999);
    return endOfDay;
  }

  /**
   * Format relative time (e.g., "2 hours ago", "3 days ago")
   */
  static formatRelativeTime(date: Date | string): string {
    const parsedDate = this.parseUserDate(date);
    const now = new Date();
    const diffTime = now.getTime() - parsedDate.getTime();
    
    const seconds = Math.floor(diffTime / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const weeks = Math.floor(days / 7);
    const months = Math.floor(days / 30);
    const years = Math.floor(days / 365);

    if (years > 0) {
      return years === 1 ? '1 year ago' : `${years} years ago`;
    } else if (months > 0) {
      return months === 1 ? '1 month ago' : `${months} months ago`;
    } else if (weeks > 0) {
      return weeks === 1 ? '1 week ago' : `${weeks} weeks ago`;
    } else if (days > 0) {
      return days === 1 ? '1 day ago' : `${days} days ago`;
    } else if (hours > 0) {
      return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
    } else if (minutes > 0) {
      return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`;
    } else {
      return 'Just now';
    }
  }

  /**
   * Format duration in human-readable format
   */
  static formatDuration(milliseconds: number): string {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}d ${hours % 24}h ${minutes % 60}m`;
    } else if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * Check if user has performed action today (common pattern in handlers)
   */
  static hasPerformedActionToday(lastActionDate: Date | string | null | undefined): boolean {
    if (!lastActionDate) {
      return false;
    }

    return this.isToday(lastActionDate);
  }

  /**
   * Get next reset time (commonly used for daily limits)
   */
  static getNextDailyReset(): Date {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return this.getStartOfDay(tomorrow);
  }

  /**
   * Calculate time until next reset
   */
  static getTimeUntilDailyReset(): {
    hours: number;
    minutes: number;
    totalMinutes: number;
  } {
    const now = new Date();
    const reset = this.getNextDailyReset();
    const diff = reset.getTime() - now.getTime();
    
    const totalMinutes = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    return { hours, minutes, totalMinutes };
  }

  /**
   * Format time until reset for display
   */
  static formatTimeUntilReset(): string {
    const { hours, minutes } = this.getTimeUntilDailyReset();
    
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else {
      return `${minutes}m`;
    }
  }

  /**
   * Get age in days for user account
   */
  static getUserAccountAge(user: any): number {
    const joinDate = this.parseUserJoinDate(user);
    return this.calculateDaysSince(joinDate);
  }

  /**
   * Check if user is new (joined recently)
   */
  static isNewUser(user: any, daysThreshold = 7): boolean {
    const accountAge = this.getUserAccountAge(user);
    return accountAge <= daysThreshold;
  }

  /**
   * Get user activity status based on last activity
   */
  static getUserActivityStatus(lastActivity: Date | string | null | undefined): 'active' | 'recent' | 'inactive' {
    if (!lastActivity) {
      return 'inactive';
    }

    const daysSince = this.calculateDaysSince(lastActivity);
    
    if (daysSince === 0) {
      return 'active';
    } else if (daysSince <= 7) {
      return 'recent';
    } else {
      return 'inactive';
    }
  }

  /**
   * Create ISO string for database storage
   */
  static toISOString(date?: Date | string): string {
    if (!date) {
      return new Date().toISOString();
    }
    return this.parseUserDate(date).toISOString();
  }

  /**
   * Parse ISO string from database
   */
  static fromISOString(isoString: string): Date {
    return new Date(isoString);
  }

  /**
   * Get timezone offset for user (if available)
   */
  static getTimezoneOffset(): number {
    return new Date().getTimezoneOffset();
  }

  /**
   * Convert UTC time to local time
   */
  static utcToLocal(utcDate: Date | string): Date {
    const date = this.parseUserDate(utcDate);
    return new Date(date.getTime() - (date.getTimezoneOffset() * 60000));
  }

  /**
   * Convert local time to UTC
   */
  static localToUtc(localDate: Date | string): Date {
    const date = this.parseUserDate(localDate);
    return new Date(date.getTime() + (date.getTimezoneOffset() * 60000));
  }

  /**
   * Validate date range
   */
  static isValidDateRange(startDate: Date | string, endDate: Date | string): boolean {
    const start = this.parseUserDate(startDate);
    const end = this.parseUserDate(endDate);
    return start.getTime() <= end.getTime();
  }

  /**
   * Get date range statistics
   */
  static getDateRangeStats(startDate: Date | string, endDate: Date | string): {
    days: number;
    hours: number;
    minutes: number;
    valid: boolean;
  } {
    if (!this.isValidDateRange(startDate, endDate)) {
      return { days: 0, hours: 0, minutes: 0, valid: false };
    }

    const start = this.parseUserDate(startDate);
    const end = this.parseUserDate(endDate);
    const diff = end.getTime() - start.getTime();

    const minutes = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    return { days, hours, minutes, valid: true };
  }
}