const BrowserManager = require('../utils/browser');

class AvailabilityTest {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
        this.title = '[ -- Checking website availability -- ]';
        this.name = 'Website availability';
        this.category = 'availability';
        this.critical = true;
        this.description = `Checks if accessibility and responding on :: `;
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
        
        
        const startTime = Date.now();
        
        // Use browser manager for better resource handling
        let browser = await BrowserManager.launch({
            headless: 'new',
            timeout: this.config.monitoring.timeoutSeconds * 1000
        });
        
        const page = await browser.newPage();
        page.setDefaultNavigationTimeout(this.config.monitoring.timeoutSeconds * 1000);
        
        // Set user agent to mimic real browser
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        page.on('request', () => this.requestCount++);
        page.on('requestfailed', (request) => {
            const url = request.url();
            
            // ignore if this is google analytics
            if ( url.includes('google-analytics.com') || url.includes('googlesyndication.com') || url.includes('kit.fontawesome.com') ) { return; }
            
            this.failedRequests++;
            this.logger.warn(`Request failed: ${request.url()} - ${request.failure().errorText}`);
        });

        try {

            for ( let i = 0; i < Object.keys(this.config.websites).length; i++) {

                let website = Object.keys(this.config.websites)[i];
                let url = this.config.websites[ website ].url;
                                
                this.logger.info(`[${website}] Checking [ ${url} ] availability...`);
                this.logger.info(`[${website}] Starting test...`);
                
                // Navigate to website
                this.logger.info(`[${website}] Navigating to ${url}`);

                const response = await page.goto(url, { 
                    waitUntil: 'networkidle0',
                    timeout: this.config.monitoring.timeoutSeconds * 1000
                });
                
                // Record metrics
                const metrics = await page.metrics();
                test.metrics = {
                    requests: this.requestCount,
                    failedRequests: this.failedRequests,
                    jsHeapUsedSize: metrics.JSHeapUsedSize,
                    jsHeapTotalSize: metrics.JSHeapTotalSize
                };
                
                // Check HTTP status
                if (!response) {
                    test.details = 'No response received from server';
                    this.logger.error(`[${website}] ${test.details}`);
                    return test;
                }
                
                const status = response.status();
                const statusText = response.statusText();
                
                if (status === 200) {
                    // Get page title and content
                    const title = await page.title();
                    const bodyText = await page.evaluate(() => document.body.innerText || '');
                    
                    // Check for meaningful content
                    if (bodyText.length > 50 && 
                        !bodyText.includes('Error') && 
                        !bodyText.includes('Not Found') &&
                        !bodyText.includes('502') &&
                        !bodyText.includes('503') &&
                        !bodyText.includes('504')) {
                        
                        test.status = 'PASS';
                        test.details = `✅ ${website} is accessible\n<br/>` +
                                    `Status: ${status} ${statusText}\n<br/>` +
                                    `Title: "${title.substring(0, 100)}${title.length > 100 ? '...' : ''}"\n<br/>` +
                                    `Requests: ${this.requestCount} (${this.failedRequests} failed)\n<br/>` +
                                    `Content length: ${bodyText.length} characters`;
                        
                        this.logger.info(`[${website}] ✅ : Website is online`);
                        this.logger.info(`------------------------------------------`);
                    } else {
                        test.status = 'FAIL';
                        test.details = `⚠️ Page loaded but content appears to be an error page\n` +
                                    `Status: ${status} ${statusText}\n` +
                                    `Title: "${title}"\n` +
                                    `Content preview: "${bodyText.substring(0, 200)}..."`;
                        
                        this.logger.warn(`[${website}] ${test.details}`);
                    }
                } else if (status >= 300 && status < 400) {
                    // Handle redirects
                    const headers = response.headers();
                    const location = headers['location'] || headers['Location'];
                    
                    test.status = 'PASS';
                    test.details = `↪️ Website redirected\n` +
                                `Status: ${status} ${statusText}\n` +
                                `Redirect to: ${location || 'Unknown'}`;
                    
                    this.logger.info(`[${website}] PASS: Website redirected (${status})`);
                } else {
                    test.status = 'FAIL';
                    test.details = `❌ Website returned error status\n` +
                                `Status: ${status} ${statusText}\n` +
                                `URL: ${this.config.website.url}`;
                    
                    this.logger.error(`[${website}] FAIL: HTTP ${status} ${statusText}`);
                }
        
            }

             
        } catch (error) {
            test.status = 'FAIL';
            test.details = `❌ Connection failed: ${error.message}`;
            test.error = error.message;
            
            // Categorize the error
            if (error.message.includes('timeout')) {
                test.details = '⏰ Connection timeout - Website may be slow or unresponsive';
            } else if (error.message.includes('net::ERR_CONNECTION_REFUSED')) {
                test.details = '🔒 Connection refused - Website may be down or blocking requests';
            } else if (error.message.includes('net::ERR_NAME_NOT_RESOLVED')) {
                test.details = '🌐 DNS resolution failed - Check domain name';
            }
            
            this.logger.error(`[${this.name}] FAIL: ${error.message}`);
        } finally {
             if (browser) { await browser.close(); }

            test.duration = Date.now() - startTime;
            this.logger.info(`[${this.name}] Completed in ${test.duration}ms`);
        }
        
        return test;
    }
}

module.exports = AvailabilityTest;