const fs = require('fs');
const path = require('path');

class Helpers {
    static delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    static async retry(fn, retries = 3, delayMs = 1000) {
        let lastError;
        
        for (let i = 0; i < retries; i++) {
            try {
                return await fn();
            } catch (error) {
                lastError = error;
                if (i < retries - 1) {
                    console.log(`Attempt ${i + 1} failed, retrying in ${delayMs}ms...`);
                    await this.delay(delayMs);
                    delayMs *= 2; // Exponential backoff
                }
            }
        }
        
        throw lastError;
    }

    static validateEmail(email) {
        const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return re.test(email);
    }

    static sanitizeFilename(name) {
        return name
            .replace(/[^a-z0-9]/gi, '-')
            .toLowerCase()
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
    }

    static formatBytes(bytes, decimals = 2) {
        if (bytes === 0) return '0 Bytes';
        
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }

    static getFileSize(filepath) {
        try {
            const stats = fs.statSync(filepath);
            return stats.size;
        } catch (error) {
            return 0;
        }
    }

    static ensureDirectory(dirPath) {
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }
    }

    static readJsonFile(filepath) {
        try {
            const content = fs.readFileSync(filepath, 'utf8');
            return JSON.parse(content);
        } catch (error) {
            console.error(`Error reading JSON file ${filepath}:`, error.message);
            return null;
        }
    }

    static writeJsonFile(filepath, data, pretty = true) {
        try {
            const content = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
            fs.writeFileSync(filepath, content, 'utf8');
            return true;
        } catch (error) {
            console.error(`Error writing JSON file ${filepath}:`, error.message);
            return false;
        }
    }

    static generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }

    static async waitForCondition(conditionFn, timeoutMs = 10000, intervalMs = 500) {
        const startTime = Date.now();
        
        while (Date.now() - startTime < timeoutMs) {
            if (await conditionFn()) {
                return true;
            }
            await this.delay(intervalMs);
        }
        
        throw new Error(`Condition not met within ${timeoutMs}ms`);
    }

    static parseDuration(durationMs) {
        const seconds = Math.floor(durationMs / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        
        if (hours > 0) {
            return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
        } else if (minutes > 0) {
            return `${minutes}m ${seconds % 60}s`;
        } else {
            return `${seconds}s`;
        }
    }

    static dd (...args) {
        console.log(...args);
        process.exit();
    }

    static d (...args) {
        console.log(...args);
    }
}

module.exports = Helpers;