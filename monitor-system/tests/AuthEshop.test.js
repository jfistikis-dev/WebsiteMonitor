const BrowserManager = require('../utils/browser');
const ScreenshotHelper = require('../utils/screenshot');

class AuthEshopTest {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
        this.config_sestion = this.config.websites[ 'eshop-website' ];
        this.title = '[ -- Eshop Authentication -- ]';
        this.name = 'Eshop Auth';
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

            browser = await BrowserManager.launch({
                headless: 'new',
                timeout: this.config.monitoring.timeoutSeconds * 1000
            });
            
            const page = await browser.newPage();
            await page.setViewport({ width: 1366, height: 768 });
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
            
            page.on('request', () => this.requestCount++);
            page.on('requestfailed', (request) => {
                const url = request.url();
                
                // ignore if this is google analytics
                if ( url.includes('google-analytics.com') || url.includes('googlesyndication.com') || url.includes('kit.fontawesome.com') ) { return; }
                
                this.failedRequests++;
                this.logger.warn(`Request failed: ${request.url()} - ${request.failure().errorText}`);
            });

            // Check if credentials are configured
            if (!this.config_sestion.selectors.usernameInput || !this.config_sestion.selectors.passwordInput || !this.config_sestion.username || !this.config_sestion.password)  {
                test.status = 'SKIP';
                test.details = 'Login credentials not configured in config.json';
                this.logger.warn(`[${this.name}] ${test.details}`);
                return test;
            }
            
            // Step 1: Go to login page
            this.logger.info(`[${this.name}] Visiting login page...`);
            const loginPage = await this.gotoLoginPage(page);
            
            if (!loginPage) {
                test.details = 'Could not load login page.';
                test.screenshot = await ScreenshotHelper.take(page, 'login-page-not-found', this.config);
                this.logger.error(`[${this.name}] ${test.details}`);
                return test;
            }
            
            this.logger.info(`[${this.name}] Entered login page at: ${loginPage}`);
            
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
            const loginSuccess = await this.performLogin ( page);

            if (!loginSuccess) {
                test.details = 'Could not submit login form';
                test.screenshot = await ScreenshotHelper.take(page, 'login-form-submit-failed', this.config);
                this.logger.error(`[${this.name}] ${test.details}`);
                return test;
            }
            
            // Step 4: Submit form
            this.logger.info(`[${this.name}] Login form submitted successfully`);
            
            // Step 5: Verify login success
            this.logger.info(`[${this.name}] Verifying login...`);
            const loginResult = await this.verifyLogin(page);

            // Check if login was successful            
            if (loginResult.success) {
                
                // take a screenshot
                test.screenshot = await ScreenshotHelper.take(page, 'login-success', this.config);

                // logout ...
                await this.testLogout(page);
                                
                test.status = 'PASS';
                test.details = `✅ Login successful\n` +
                             `User: ${this.config_sestion.username}\n` +
                             `Redirected to: ${loginResult.redirectUrl}\n` +
                             `Indicators: ${loginResult.indicators.join(', ')}`;
                
                
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

    async gotoLoginPage(page) {

        try {
            this.logger.info(`[${this.name}] Trying: ${this.config_sestion.loginUrl }`);

             const response = await page.goto(this.config_sestion.loginUrl, { 
                waitUntil: 'domcontentloaded', 
                timeout: 5000 
            });
            
           if (response && response.ok()) {
                // Check if page looks like a login page
                const { usernameInput, passwordInput } = this.config_sestion.selectors;

                const hasLoginForm = await page.evaluate(
                    (uSel, pSel) => { return document.querySelectorAll(`${uSel}, ${pSel}`).length > 0; }, usernameInput, passwordInput
                );

                
                if (hasLoginForm) { return page.url(); }
            }
                      

        } catch (e) {
           return null; // Try next URL
        }
        
        
        return null;
    }

    async fillLoginForm(page) {
        
        const usernameSelector = this.config_sestion.selectors.usernameInput;
        const passwordSelector = this.config_sestion.selectors.passwordInput;
        const username = this.config_sestion.username;
        const password = this.config_sestion.password;
              
        // Find and fill username field
        let usernameField = null;
        
        usernameField = await page.$(usernameSelector);
        if (usernameField) { await usernameField.type(username, { delay: 50 }); }
        if (!usernameField) { return false; }
        
        // Find and fill password field
        let passwordField = null;

        passwordField = await page.$(passwordSelector);
        if (passwordField) { await passwordField.type(password, { delay: 50 }); }
        if (!passwordField) { return false; }
        
        return !!passwordField;
    }

    async performLogin(page) {
        
        // Submit login
        const response = await Promise.all([
            page.waitForNavigation({
                waitUntil: 'networkidle0',
                timeout: 10000
            }).catch(() => {
                this.logger.warn(`[${this.name}] Navigation timeout, checking current state`);
                return null;
            }),
            
            page.click(this.config_sestion.selectors.loginButton)
        ]);
        
        return response[0] && response[0].ok();
            
    }


    async verifyLogin(page) {
        const currentUrl = page.url().toLowerCase();
        const pageContent = (await page.evaluate(() => document.body.innerText)).toLowerCase();
        


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

            await page.goto(this.config_sestion.logoutUrl, {
                waitUntil: 'networkidle2',
                timeout: 15000
            });

            this.logger.info(`[${this.name}] Logout successful`);
            return true;

        } catch (error) {
            this.logger.warn(`[${this.name}] Could not find logout option`);
            this.logger.error(`[${this.name}] Logout test error: ${error.message}`);
            return false;
        }

    }
}

module.exports = AuthEshopTest;