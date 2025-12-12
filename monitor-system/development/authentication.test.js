const puppeteer = require('puppeteer');
const BrowserManager = require('../utils/browser');
const ScreenshotHelper = require('../utils/screenshots');

class AuthenticationTest {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
        this.name = 'User Authentication';
        this.category = 'authentication';
        this.critical = true;
        this.description = 'Tests user login functionality';
    }

    async run() {
        const test = { 
            name: this.name,
            category: this.category,
            critical: this.critical, 
            status: 'FAIL', 
            details: '',
            duration: 0,
            screenshot: null,
            error: null
        };
        
        let browser = null;
        const startTime = Date.now();
        
        try {
            this.logger.info(`[${this.name}] Starting test...`);
            
            // Check if credentials are configured
            if (!this.config.website.login || !this.config.website.login.username || !this.config.website.login.password) {
                test.status = 'SKIP';
                test.details = 'Login credentials not configured in config.json';
                this.logger.warn(`[${this.name}] ${test.details}`);
                return test;
            }
            
            browser = await BrowserManager.launch({
                headless: 'new',
                timeout: this.config.monitoring.timeoutSeconds * 1000
            });
            
            const page = await browser.newPage();
            await page.setViewport({ width: 1366, height: 768 });
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
            
            // Step 1: Find login page
            this.logger.info(`[${this.name}] Looking for login page...`);
            const loginPage = await this.findLoginPage(page);
            
            if (!loginPage) {
                test.details = 'Could not find login page. Tried common login URLs.';
                test.screenshot = await ScreenshotHelper.take(page, 'login-page-not-found', this.config);
                this.logger.error(`[${this.name}] ${test.details}`);
                return test;
            }
            
            this.logger.info(`[${this.name}] Found login page at: ${loginPage}`);
            
            // Step 2: Fill login form
            this.logger.info(`[${this.name}] Attempting to fill login form...`);
            const formFilled = await this.fillLoginForm(page);
            
            if (!formFilled) {
                test.details = 'Could not find login form fields';
                test.screenshot = await ScreenshotHelper.take(page, 'login-form-not-found', this.config);
                this.logger.error(`[${this.name}] ${test.details}`);
                return test;
            }
            
            this.logger.info(`[${this.name}] Login form filled successfully`);
            
            // Step 3: Submit form
            this.logger.info(`[${this.name}] Submitting login form...`);
            await this.submitLoginForm(page);
            
            // Step 4: Wait for navigation or response
            await page.waitForNavigation({ 
                waitUntil: 'networkidle0', 
                timeout: 10000 
            }).catch(() => {
                this.logger.warn(`[${this.name}] Navigation timeout, checking current state`);
            });
            
            // Step 5: Verify login success
            this.logger.info(`[${this.name}] Verifying login...`);
            const loginResult = await this.verifyLogin(page);
            
            if (loginResult.success) {
                test.status = 'PASS';
                test.details = `✅ Login successful\n` +
                             `User: ${this.config.website.login.username}\n` +
                             `Redirected to: ${loginResult.redirectUrl}\n` +
                             `Indicators: ${loginResult.indicators.join(', ')}`;
                test.screenshot = await ScreenshotHelper.take(page, 'login-success', this.config);
                this.logger.info(`[${this.name}] PASS: Login successful`);
                
                // Optional: Test logout if configured
                if (this.config.website.login.testLogout) {
                    await this.testLogout(page);
                }
            } else {
                test.status = 'FAIL';
                test.details = `❌ Login failed\n` +
                             `User: ${this.config.website.login.username}\n` +
                             `Current URL: ${loginResult.currentUrl}\n` +
                             `Error indicators: ${loginResult.errorIndicators.join(', ')}`;
                test.screenshot = await ScreenshotHelper.take(page, 'login-failed', this.config);
                this.logger.error(`[${this.name}] FAIL: Login failed`);
            }
            
        } catch (error) {
            test.status = 'FAIL';
            test.details = `❌ Authentication test error: ${error.message}`;
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

    async findLoginPage(page) {
        const loginUrls = [
            `${this.config.website.url}/login`,
            `${this.config.website.url}/signin`,
            `${this.config.website.url}/auth/login`,
            `${this.config.website.url}/account/login`,
            `${this.config.website.url}/sign-in`,
            `${this.config.website.url}/user/login`,
            `${this.config.website.url}/admin`,
            `${this.config.website.url}/wp-login.php`  // WordPress
        ];
        
        for (const url of loginUrls) {
            try {
                this.logger.debug(`[${this.name}] Trying: ${url}`);
                const response = await page.goto(url, { 
                    waitUntil: 'domcontentloaded', 
                    timeout: 5000 
                });
                
                if (response && response.status() === 200) {
                    // Check if page looks like a login page
                    const hasLoginForm = await page.evaluate(() => {
                        const inputs = document.querySelectorAll('input[type="password"], input[type="email"], input[name*="pass"]');
                        return inputs.length > 0;
                    });
                    
                    if (hasLoginForm) {
                        return url;
                    }
                }
            } catch (e) {
                continue; // Try next URL
            }
        }
        
        return null;
    }

    async fillLoginForm(page) {
        const username = this.config.website.login.username;
        const password = this.config.website.login.password;
        
        // Try different selector strategies
        const selectors = {
            username: [
                '#username', '#email', '#user', '#login', 
                'input[type="email"]', 'input[name="email"]', 
                'input[name="username"]', 'input[name="user"]',
                'input[placeholder*="email" i]', 'input[placeholder*="user" i]'
            ],
            password: [
                '#password', '#pass', '#pwd',
                'input[type="password"]', 'input[name="password"]',
                'input[name="pass"]', 'input[name="pwd"]',
                'input[placeholder*="password" i]'
            ]
        };
        
        // Find and fill username field
        let usernameField = null;
        for (const selector of selectors.username) {
            usernameField = await page.$(selector);
            if (usernameField) {
                await usernameField.type(username, { delay: 50 });
                break;
            }
        }
        
        if (!usernameField) {
            return false;
        }
        
        // Find and fill password field
        let passwordField = null;
        for (const selector of selectors.password) {
            passwordField = await page.$(selector);
            if (passwordField) {
                await passwordField.type(password, { delay: 50 });
                break;
            }
        }
        
        return !!passwordField;
    }

    async submitLoginForm(page) {
        // Try different submit methods
        const submitSelectors = [
            'button[type="submit"]', 'input[type="submit"]',
            'button:contains("Sign In")', 'button:contains("Login")',
            'button:contains("Log In")', 'button.btn-primary',
            'form button', '.login-button', '.submit-button'
        ];
        
        for (const selector of submitSelectors) {
            try {
                const elements = await page.$x(`//*[contains(text(), 'Sign In') or contains(text(), 'Login')]`);
                if (elements.length > 0) {
                    await elements[0].click();
                    return;
                }
                
                const button = await page.$(selector);
                if (button) {
                    await button.click();
                    return;
                }
            } catch (e) {
                continue;
            }
        }
        
        // Fallback: press Enter
        await page.keyboard.press('Enter');
    }

    async verifyLogin(page) {
        const currentUrl = page.url().toLowerCase();
        const pageContent = await page.content().toLowerCase();
        
        // Success indicators
        const successIndicators = [
            'dashboard', 'welcome', 'my account', 'profile',
            'logout', 'sign out', 'log out', 'my profile',
            'dashboard', 'home', 'main', 'account overview',
            'you are logged in', 'successful login', 'login successful'
        ];
        
        // Error indicators
        const errorIndicators = [
            'invalid', 'incorrect', 'wrong', 'error',
            'failed', 'try again', 'login failed',
            'password incorrect', 'username not found'
        ];
        
        // Check for success
        const foundSuccessIndicators = successIndicators.filter(indicator => 
            currentUrl.includes(indicator) || pageContent.includes(indicator)
        );
        
        // Check for errors
        const foundErrorIndicators = errorIndicators.filter(indicator => 
            pageContent.includes(indicator)
        );
        
        // Determine result
        if (foundSuccessIndicators.length > 0 || !currentUrl.includes('login')) {
            return {
                success: true,
                redirectUrl: page.url(),
                indicators: foundSuccessIndicators,
                errorIndicators: foundErrorIndicators
            };
        } else {
            return {
                success: false,
                currentUrl: page.url(),
                indicators: foundSuccessIndicators,
                errorIndicators: foundErrorIndicators
            };
        }
    }

    async testLogout(page) {
        try {
            this.logger.info(`[${this.name}] Testing logout...`);
            
            // Look for logout button/link
            const logoutSelectors = [
                'a:contains("Logout")', 'a:contains("Sign Out")',
                'button:contains("Logout")', 'button:contains("Sign Out")',
                '[href*="logout"]', '[href*="signout"]'
            ];
            
            for (const selector of logoutSelectors) {
                try {
                    const elements = await page.$x(`//*[contains(text(), 'Logout') or contains(text(), 'Sign Out')]`);
                    if (elements.length > 0) {
                        await elements[0].click();
                        await page.waitForNavigation({ timeout: 5000 }).catch(() => {});
                        this.logger.info(`[${this.name}] Logout successful`);
                        return true;
                    }
                } catch (e) {
                    continue;
                }
            }
            
            this.logger.warn(`[${this.name}] Could not find logout option`);
            return false;
        } catch (error) {
            this.logger.error(`[${this.name}] Logout test error: ${error.message}`);
            return false;
        }
    }
}

module.exports = AuthenticationTest;