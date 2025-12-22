const puppeteer = require('puppeteer');
const BrowserManager = require('../utils/browser');

class LoginPlatformTest {
    constructor(config, logger) {
        
        this.config = config;
        this.logger = logger;
        this.name = '[ -- Checking login on platform -- ]';
        this.test_title = 'PLatform Login';
        this.config_sestion = this.config.websites[ 'platform-website' ];
        this.category = 'availability';
        this.critical = true;
        this.description = 'Checks if a user can login to https://grivaseltinteractive.gr website';
        this.failedRequests = 0;
        this.requestCount = 0;

    }

    async run() {
        const test = { 
            name: this.name,
            category: this.category,
            critical: this.critical, 
            status: 'FAIL', 
            details: '',
            duration: 0,
            error: null,
            metrics: {}
        };
        
        let browser = null;
        const startTime = Date.now();
        
        // Use browser manager for better resource handling
        browser = await require('puppeteer').launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
            timeout: this.config.monitoring.timeoutSeconds * 1000
        });
        
        const page = await browser.newPage();
        page.setDefaultNavigationTimeout(this.config.monitoring.timeoutSeconds * 1000);
        
        // Set user agent to mimic real browser
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        // Monitor requests and responses
        let requestCount = 0;
        let failedRequests = 0;
        
        page.on('request', () => requestCount++);
        page.on('requestfailed', (request) => {
           const url = request.url();
            
            // ignore if this is google analytics
            if ( url.includes('google-analytics.com') || url.includes('googlesyndication.com') || url.includes('kit.fontawesome.com') ) { return; }
            
            this.failedRequests++;
            this.logger.warn(`Request failed: ${request.url()} - ${request.failure().errorText}`);
        });
        
        try {

            this.logger.info(`[${this.test_title}] Starting test...`);
            this.logger.info(`[${this.test_title}] Navigating to ${this.config_sestion.loginUrl}`);
        
            
            await this.performLogin(page);
            await this.verifyLogin(page);
            await this.performLogout(page);
            await this.verifyLogout(page);
            
            test.status = 'PASS';
            test.details = `✅ ${this.config_sestion.loginUrl} is accessible to users\n<br/>` +
                                    `Requests: ${requestCount} (${failedRequests} failed)\n<br/>` +

            this.logger.info(`[${this.test_title}] ✅ PASS: Login/Logout test passed successfully!`);
            
        } catch (error) {
            test.status = 'FAIL';
            test.details = `❌ Connection failed: ${error.message}`;
            test.error = error.message;
            await this.captureDebugInfo(page, error);
            
            this.logger.error(`[${this.test_title}] ❌ FAIL: ${error.message}`);

        } finally {
             if (browser) {
                await browser.close();
            }
            test.duration = Date.now() - startTime;
            this.logger.info(`[${this.test_title}] Completed in ${test.duration}ms`);
        }
        
        return test;
    }

     async performLogin(page) {
        this.logger.info(`[${this.test_title}] 🤞 Attempting login...`);
        
        // Navigate to login page
        await page.goto(`${this.config_sestion.loginUrl }`, {
            waitUntil: 'networkidle2',
            timeout: 30000
        });

        // Fill credentials
        await page.type(this.config_sestion.selectors.usernameInput, this.config_sestion.username);
        await page.type(this.config_sestion.selectors.passwordInput, this.config_sestion.password);
        
        // Submit login
        await Promise.all([
            page.click(this.config_sestion.selectors.loginButton),
            await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 })
        ]);
    }

    async verifyLogin(page) {
        this.logger.info(`[${this.test_title}] 🤞 Verifying login...`);
        
        // wait untill new load
        if (!page.url().includes('/dashboard')) {
            this.logger.error(`[${this.test_title}] ❌ FAIL: Login failed: not redirected to dashboard`);
            throw new Error('Login failed: not redirected to dashboard');
        }
        this.logger.info(`[${this.test_title}] ✅ PASS: Login verified`);
    }

    async performLogout(page) {
        this.logger.info(`[${this.test_title}] 🚪 Attempting logout...`);

        // Method 1: Direct logout URL
        try {
            await page.goto(`${this.config_sestion.logoutUrl}`, {
                waitUntil: 'networkidle2',
                timeout: 15000
            });
        } catch (error) {
            this.logger.error(`[${this.test_title}] ❌ FAIL: Logout failed: ${error.message}`);
            throw new Error('Logout failed');
        }
        this.logger.info(`[${this.test_title}] ✅ PASS: Logout successful`);
    }

    async verifyLogout(page) {
        this.logger.info(`[${this.test_title}] 🤞 Verifying logout...`);
        
        const verifications = [
            // Check for login form
            page.waitForSelector(this.config_sestion.selectors.loginForm, { timeout: 5000 })
                .then(() => 'login form found'),
            
            // Check URL contains login
            Promise.resolve().then(() => {
                const url = page.url();
                if (!url.includes('logout')) { throw new Error('Not redirected to login page'); }
                return 'redirected to login page';
            }),
            
        ];

        await Promise.any(verifications);
        this.logger.info(`[${this.test_title}] ✅ PASS: Logout verified`);
    }
    
     async captureDebugInfo(page, error) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        
        // Capture screenshot
        await page.screenshot({ 
            path: `error-${timestamp}.png`,
            fullPage: true 
        });
        
        // Capture console logs
        const consoleLogs = await page.evaluate(() => {
            return Array.from(window.consoleLogs || []);
        });
        
        // Save page HTML
        const html = await page.content();
        require('fs').writeFileSync(`error-${timestamp}.html`, html);
        
        console.log('📸 Debug info captured:', {
            screenshot: `error-${timestamp}.png`,
            consoleLogs: consoleLogs.slice(-10), // Last 10 logs
            error: error.message
        });
    }


}

module.exports = LoginPlatformTest;