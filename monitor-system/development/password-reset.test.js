const puppeteer = require('puppeteer');
const BrowserManager = require('../utils/browser');
const ScreenshotHelper = require('../utils/screenshots');

class PasswordResetTest {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
        this.name = 'Password Reset';
        this.category = 'authentication';
        this.critical = false;
        this.description = 'Tests password reset functionality';
    }

    async run() {
        const test = { 
            name: this.name,
            category: this.category,
            critical: this.critical, 
            status: 'SKIP',  // Default to SKIP since we don't actually reset passwords
            details: '',
            duration: 0,
            screenshot: null,
            error: null
        };
        
        let browser = null;
        const startTime = Date.now();
        
        try {
            this.logger.info(`[${this.name}] Starting test...`);
            
            browser = await BrowserManager.launch({
                headless: 'new',
                timeout: this.config.monitoring.timeoutSeconds * 1000
            });
            
            const page = await browser.newPage();
            await page.setViewport({ width: 1366, height: 768 });
            
            // Step 1: Find password reset page
            this.logger.info(`[${this.name}] Looking for password reset page...`);
            const resetPage = await this.findResetPage(page);
            
            if (!resetPage) {
                test.details = 'Could not find password reset page. This is not necessarily an error.';
                this.logger.warn(`[${this.name}] ${test.details}`);
                return test;
            }
            
            this.logger.info(`[${this.name}] Found password reset page at: ${resetPage}`);
            
            // Step 2: Check if form exists
            const formExists = await this.checkFormExists(page);
            
            if (formExists) {
                test.status = 'PASS';
                test.details = `✅ Password reset page is accessible\n` +
                             `URL: ${resetPage}\n` +
                             `Form: Found and appears functional\n` +
                             `Note: Actual reset not performed (would send email)`;
                test.screenshot = await ScreenshotHelper.take(page, 'password-reset-page', this.config);
                this.logger.info(`[${this.name}] PASS: Password reset page is accessible`);
            } else {
                test.status = 'FAIL';
                test.details = `⚠️ Password reset page found but form may be missing\n` +
                             `URL: ${resetPage}\n` +
                             `Form: Not detected or may be broken`;
                test.screenshot = await ScreenshotHelper.take(page, 'password-reset-no-form', this.config);
                this.logger.warn(`[${this.name}] ${test.details}`);
            }
            
        } catch (error) {
            test.status = 'FAIL';
            test.details = `❌ Password reset test error: ${error.message}`;
            test.error = error.message;
            this.logger.error(`[${this.name}] FAIL: ${error.message}`);
        } finally {
            if (browser) {
                await BrowserManager.close(browser);
            }
            test.duration = Date.now() - startTime;
            this.logger.info(`[${this.name}] Completed in ${test.duration}ms`);
        }
        
        return test;
    }

    async findResetPage(page) {
        const resetUrls = [
            `${this.config.website.url}/forgot-password`,
            `${this.config.website.url}/reset-password`,
            `${this.config.website.url}/password/reset`,
            `${this.config.website.url}/account/password/reset`,
            `${this.config.website.url}/forgot`,
            `${this.config.website.url}/recover-password`,
            `${this.config.website.url}/wp-login.php?action=lostpassword`  // WordPress
        ];
        
        for (const url of resetUrls) {
            try {
                this.logger.debug(`[${this.name}] Trying: ${url}`);
                const response = await page.goto(url, { 
                    waitUntil: 'domcontentloaded', 
                    timeout: 5000 
                });
                
                if (response && response.status() === 200) {
                    // Check if page contains password reset text
                    const pageText = await page.evaluate(() => document.body.innerText.toLowerCase());
                    const resetKeywords = ['forgot password', 'reset password', 'recover password', 'lost password'];
                    
                    if (resetKeywords.some(keyword => pageText.includes(keyword))) {
                        return url;
                    }
                }
            } catch (e) {
                continue;
            }
        }
        
        return null;
    }

    async checkFormExists(page) {
        // Look for email input field
        const emailSelectors = [
            'input[type="email"]', '#email', 
            'input[name="email"]', 'input[placeholder*="email" i]'
        ];
        
        for (const selector of emailSelectors) {
            const field = await page.$(selector);
            if (field) {
                // Check if it's in a form
                const isInForm = await page.evaluate((sel) => {
                    const input = document.querySelector(sel);
                    return input && (input.form || input.closest('form'));
                }, selector);
                
                if (isInForm) {
                    return true;
                }
            }
        }
        
        return false;
    }
}

module.exports = PasswordResetTest;