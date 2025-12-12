const fs = require('fs');
const path = require('path');

class ScreenshotHelper {
    constructor(config) {
        this.config = config;
        this.screenshotDir = path.join(__dirname, '..', this.config.paths.screenshots);
        this.ensureDirectoryExists();
    }

    ensureDirectoryExists() {
        if (!fs.existsSync(this.screenshotDir)) {
            fs.mkdirSync(this.screenshotDir, { recursive: true });
        }
    }

    async take(page, testName, options = {}) {
        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const sanitizedName = testName.toLowerCase().replace(/[^a-z0-9]/g, '-');
            const filename = `${sanitizedName}-${timestamp}.png`;
            const filepath = path.join(this.screenshotDir, filename);
            
            const screenshotOptions = {
                path: filepath,
                type: 'png',
                fullPage: options.fullPage !== false,
                ...options
            };
            
            await page.screenshot(screenshotOptions);
            
            console.log(`📸 Screenshot saved: ${filename}`);
            return filename;
            
        } catch (error) {
            console.error(`❌ Failed to take screenshot: ${error.message}`);
            return null;
        }
    }

    async takeOnFailure(page, testName, error) {
        try {
            const filename = await this.take(page, `${testName}-failure`, {
                fullPage: true
            });
            
            // Also save error details
            if (filename) {
                const errorFile = path.join(
                    this.screenshotDir, 
                    `${testName}-failure-${Date.now()}.txt`
                );
                
                fs.writeFileSync(errorFile, 
                    `Test: ${testName}\n` +
                    `Time: ${new Date().toISOString()}\n` +
                    `Error: ${error.message}\n` +
                    `Stack: ${error.stack}\n`
                );
            }
            
            return filename;
        } catch (e) {
            console.error('Failed to save failure screenshot:', e.message);
            return null;
        }
    }

    getScreenshotPath(filename) {
        return path.join(this.screenshotDir, filename);
    }

    cleanupOldScreenshots(maxAgeDays = 7) {
        try {
            const now = Date.now();
            const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
            
            const files = fs.readdirSync(this.screenshotDir);
            
            files.forEach(file => {
                if (file.endsWith('.png') || file.endsWith('.txt')) {
                    const filepath = path.join(this.screenshotDir, file);
                    const stats = fs.statSync(filepath);
                    
                    if (now - stats.mtimeMs > maxAgeMs) {
                        fs.unlinkSync(filepath);
                        console.log(`🗑️  Deleted old screenshot: ${file}`);
                    }
                }
            });
        } catch (error) {
            console.error('Error cleaning up screenshots:', error.message);
        }
    }

    // Static method for convenience
    static async take(page, testName, config) {
        const helper = new ScreenshotHelper(config);
        return helper.take(page, testName);
    }
}

module.exports = ScreenshotHelper;