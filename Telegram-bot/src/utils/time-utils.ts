/**
 * Parse time duration string to milliseconds
 * Supports formats: 1m, 59m, 1h, 24h, 1d, 7d
 * 
 * @param duration - Duration string (e.g., "1m", "1h", "1d")
 * @returns Duration in milliseconds, or null if invalid
 */
export function parseDuration(duration: string | undefined): number | null {
  if (!duration || typeof duration !== 'string') {
    return null;
  }

  const trimmed = duration.trim();
  const match = trimmed.match(/^(\d+)(m|h|d)$/i);
  
  if (!match) {
    return null;
  }

  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();

  if (isNaN(value) || value < 0) {
    return null;
  }

  switch (unit) {
    case 'm': // minutes
      return value * 60 * 1000;
    case 'h': // hours
      return value * 60 * 60 * 1000;
    case 'd': // days
      return value * 24 * 60 * 60 * 1000;
    default:
      return null;
  }
}

/**
 * Format milliseconds to human-readable duration
 * 
 * @param ms - Duration in milliseconds
 * @returns Human-readable string (e.g., "24 hours", "7 days")
 */
export function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / (60 * 1000));
  const hours = Math.floor(ms / (60 * 60 * 1000));
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));

  if (days > 0) {
    return `${days} day${days !== 1 ? 's' : ''}`;
  } else if (hours > 0) {
    return `${hours} hour${hours !== 1 ? 's' : ''}`;
  } else if (minutes > 0) {
    return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
  } else {
    return 'less than a minute';
  }
}

/**
 * Check if a timestamp has passed the reset interval
 * 
 * @param lastCompletionTime - ISO timestamp of last completion
 * @param resetInterval - Reset interval in milliseconds
 * @returns true if interval has passed, false otherwise
 */
export function hasIntervalPassed(
  lastCompletionTime: string | undefined,
  resetInterval: number
): boolean {
  if (!lastCompletionTime) {
    return true; // Never completed before
  }

  try {
    const lastTime = new Date(lastCompletionTime).getTime();
    const now = Date.now();
    const elapsed = now - lastTime;
    
    return elapsed >= resetInterval;
  } catch (error) {
    return true; // Invalid timestamp, allow completion
  }
}