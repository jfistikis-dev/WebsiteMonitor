/**
 * Convert seconds to human-readable uptime format
 * Format: "X years Y months Z days W hours" or compact version
 * 
 * @param {number} seconds - Uptime in seconds
 * @param {Object} options - Formatting options
 * @param {boolean} options.compact - Return compact format (default: true)
 * @param {boolean} options.showSeconds - Include seconds in output (default: false)
 * @param {boolean} options.showUpText - Append " up" to the end (default: true)
 * @param {number} options.precision - Number of time units to show (default: 4)
 * @returns {string} Formatted uptime string
 */
function formatUptime(seconds, options = {}) {
    const defaults = {
        compact: true,
        showSeconds: false,
        showUpText: true,
        precision: 4,
        shortLabels: false
    };
    
    const config = { ...defaults, ...options };
    
    // Validate input
    if (typeof seconds !== 'number' || seconds < 0) {
        return 'Invalid time';
    }
    
    if (seconds === 0) {
        return config.showUpText ? 'Just started' : '0 seconds';
    }
    
    // Time constants
    const MINUTE = 60;
    const HOUR = 60 * MINUTE;
    const DAY = 24 * HOUR;
    const MONTH = 30.44 * DAY; // Average month length
    const YEAR = 365.25 * DAY; // Account for leap years
    
    // Calculate time units
    let remainingSeconds = Math.floor(seconds);
    
    const years = Math.floor(remainingSeconds / YEAR);
    remainingSeconds %= YEAR;
    
    const months = Math.floor(remainingSeconds / MONTH);
    remainingSeconds %= MONTH;
    
    const days = Math.floor(remainingSeconds / DAY);
    remainingSeconds %= DAY;
    
    const hours = Math.floor(remainingSeconds / HOUR);
    remainingSeconds %= HOUR;
    
    const minutes = Math.floor(remainingSeconds / MINUTE);
    remainingSeconds %= MINUTE;
    
    // Build parts array
    const parts = [];
    
    if (years > 0) parts.push({ value: years, unit: 'year', short: 'Y' });
    if (months > 0) parts.push({ value: months, unit: 'month', short: 'M' });
    if (days > 0) parts.push({ value: days, unit: 'day', short: 'D' });
    if (hours > 0) parts.push({ value: hours, unit: 'hour', short: 'H' });
    if (minutes > 0 && config.showSeconds) {
        parts.push({ value: minutes, unit: 'minute', short: 'min' });
    }
    if (config.showSeconds && remainingSeconds > 0) {
        parts.push({ value: remainingSeconds, unit: 'second', short: 's' });
    }
    
    // If no significant time units (less than a minute)
    if (parts.length === 0) {
        if (config.showSeconds) {
            return config.showUpText ? `${seconds.toFixed(1)} seconds up` : `${seconds.toFixed(1)} seconds`;
        }
        return config.showUpText ? 'Less than a minute up' : '< 1 minute';
    }
    
    // Apply precision limit
    const limitedParts = parts.slice(0, config.precision);
    
    // Format the output
    let formatted = '';
    
    if (config.compact) {
        // Compact format: "1Y 2M 15D 3H"
        formatted = limitedParts.map(part => 
            `${part.value}${config.shortLabels ? part.short : part.short[0]}`
        ).join(' ');
    } else {
        // Full format: "1 year 2 months 15 days 3 hours"
        formatted = limitedParts.map(part => 
            `${part.value} ${part.unit}${part.value !== 1 ? 's' : ''}`
        ).join(' ');
    }
    
    // Add "up" suffix if requested
    if (config.showUpText) {
        formatted += ' up';
    }
    
    return formatted;
}

/**
 * Alternative: Simple format showing only the largest 2-3 units
 * Example: "2 years, 3 months" or "3 days, 5 hours"
 */
function formatUptimeSimple(seconds) {
    const units = [
        { name: 'year', seconds: 31557600, max: 100 }, // 365.25 days
        { name: 'month', seconds: 2592000, max: 12 },  // 30 days
        { name: 'week', seconds: 604800, max: 4 },
        { name: 'day', seconds: 86400, max: 7 },
        { name: 'hour', seconds: 3600, max: 24 },
        { name: 'minute', seconds: 60, max: 60 },
        { name: 'second', seconds: 1, max: 60 }
    ];
    
    let remaining = seconds;
    const result = [];
    
    for (const unit of units) {
        if (remaining >= unit.seconds && result.length < 2) {
            const value = Math.floor(remaining / unit.seconds);
            remaining %= unit.seconds;
            
            result.push(`${value} ${unit.name}${value !== 1 ? 's' : ''}`);
        }
    }
    
    if (result.length === 0) {
        return 'Just started';
    }
    
    return result.join(', ') + ' up';
}

/**
 * Format uptime for dashboard display (optimized for UI)
 */
function formatUptimeForDashboard(seconds) {
    if (seconds < 60) {
        return 'Just started';
    }
    
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (days > 365) {
        const years = Math.floor(days / 365);
        const remainingDays = days % 365;
        return `${years}Y ${remainingDays}D ${hours}H`;
    } else if (days > 30) {
        const months = Math.floor(days / 30);
        const remainingDays = days % 30;
        return `${months}M ${remainingDays}D ${hours}H`;
    } else if (days > 0) {
        return `${days}D ${hours}H ${minutes}min`;
    } else if (hours > 0) {
        return `${hours}H ${minutes}min`;
    } else {
        return `${minutes} min`;
    }
}

/**
 * Live uptime updater for real-time display
 */
class UptimeDisplay {
    constructor(startTime) {
        this.startTime = startTime || Date.now();
        this.interval = null;
        this.callbacks = [];
    }
    
    startUpdating(elementId, options = {}) {
        const element = document.getElementById(elementId);
        if (!element) return;
        
        this.updateElement(element, options);
        
        this.interval = setInterval(() => {
            this.updateElement(element, options);
        }, 1000); // Update every second
        
        return this;
    }
    
    updateElement(element, options) {
        const now = Date.now();
        const uptimeSeconds = (now - this.startTime) / 1000;
        
        element.textContent = formatUptime(uptimeSeconds, options);
        element.title = `Started: ${new Date(this.startTime).toLocaleString()}`;
        
        // Notify callbacks
        this.callbacks.forEach(callback => callback(uptimeSeconds));
    }
    
    onUpdate(callback) {
        this.callbacks.push(callback);
        return this;
    }
    
    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
    }
    
    getFormattedUptime(options = {}) {
        const uptimeSeconds = (Date.now() - this.startTime) / 1000;
        return formatUptime(uptimeSeconds, options);
    }
}


function formatDuration(ms) {
    if (ms <= 0) return '0m';

    const totalMinutes = Math.floor(ms / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    const h = hours > 0 ? `${hours} hour${hours !== 1 ? 's' : ''}` : '';
    const m = minutes > 0 ? `${minutes}m` : '';

    return [h, m].filter(Boolean).join(' ');
}

// Export all functions
module.exports = {
    formatUptime,
    formatUptimeSimple,
    formatUptimeForDashboard,
    UptimeDisplay,
    formatDuration,
    
    // Convenience exports for common formats
    compact: (seconds) => formatUptime(seconds, { compact: true, precision: 4 }),
    detailed: (seconds) => formatUptime(seconds, { compact: false, showSeconds: true, precision: 6 }),
    dashboard: formatUptimeForDashboard
};