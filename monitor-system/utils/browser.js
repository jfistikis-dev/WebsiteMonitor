const puppeteer = require('puppeteer');

class BrowserManager {
    constructor(config) {
        this.config = config;
        this.browser = null;
        this.activePages = new Set();
    }

    async launch(options = {}) {
        const defaultOptions = {
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
                '--window-size=1920,1080'
            ],
            timeout: (this.config?.monitoring?.timeoutSeconds || 60) * 1000
        };

        const launchOptions = { ...defaultOptions, ...options };
        
        try {
            this.browser = await puppeteer.launch(launchOptions);
            console.log('✅ Browser launched successfully');
            return this.browser;
        } catch (error) {
            console.error('❌ Failed to launch browser:', error.message);
            throw error;
        }
    }

    async newPage() {
        if (!this.browser) {
            throw new Error('Browser not launched. Call launch() first.');
        }
        
        try {
            const page = await this.browser.newPage();
            this.activePages.add(page);
            
            // Set default timeout
            await page.setDefaultNavigationTimeout(
                (this.config?.monitoring?.timeoutSeconds || 60) * 1000
            );
            
            // Set user agent
            await page.setUserAgent(
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            );
            
            return page;
        } catch (error) {
            console.error('❌ Failed to create new page:', error.message);
            throw error;
        }
    }

    async closePage(page) {
        try {
            if (page && !page.isClosed()) {
                await page.close();
                this.activePages.delete(page);
            }
        } catch (error) {
            console.warn('⚠️ Error closing page:', error.message);
        }
    }

    async close() {
        try {
            // Close all active pages
            for (const page of this.activePages) {
                await this.closePage(page);
            }
            
            // Close browser
            if (this.browser) {
                await this.browser.close();
                this.browser = null;
                console.log('✅ Browser closed successfully');
            }
        } catch (error) {
            console.error('❌ Error closing browser:', error.message);
        }
    }

    async withBrowser(callback) {
        let browser = null;
        try {
            browser = await this.launch();
            return await callback(browser);
        } finally {
            if (browser) {
                await browser.close();
            }
        }
    }

    async withPage(callback) {
        let browser = null;
        let page = null;
        
        try {
            browser = await this.launch();
            page = await browser.newPage();
            
            // Configure page
            await page.setDefaultNavigationTimeout(
                (this.config?.monitoring?.timeoutSeconds || 60) * 1000
            );
            await page.setViewport({ width: 1366, height: 768 });
            
            return await callback(page);
        } finally {
            if (page && !page.isClosed()) {
                await page.close();
            }
            if (browser) {
                await browser.close();
            }
        }
    }

    static async launch(options = {}) {
        const manager = new BrowserManager({});
        return manager.launch(options);
    }

    static async close(browser) {
        if (browser) {
            await browser.close();
        }
    }
}

// Export both the class and a default instance
module.exports = BrowserManager;