const puppeteer = require('puppeteer');
const BrowserManager = require('../utils/browser');

class PerformanceTest {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
        this.name = 'Page Performance';
        this.category = 'performance';
        this.critical = false;
        this.description = 'Measures page load performance metrics';
    }

    async run() {
        const test = { 
            name: this.name,
            category: this.category,
            critical: this.critical, 
            status: 'FAIL', 
            details: '',
            duration: 0,
            metrics: {},
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
            
            // Enable performance metrics
            await page.setCacheEnabled(false); // Disable cache for accurate measurements
            await page.setViewport({ width: 1366, height: 768 });
            
            // Collect performance metrics
            const client = await page.target().createCDPSession();
            await client.send('Performance.enable');
            
            // Navigate to website
            this.logger.info(`[${this.name}] Loading page for performance measurement...`);
            await page.goto(this.config.website.url, { 
                waitUntil: 'networkidle0',
                timeout: this.config.monitoring.timeoutSeconds * 1000
            });
            
            // Get performance metrics
            const perfMetrics = await client.send('Performance.getMetrics');
            const timing = await page.evaluate(() => JSON.stringify(window.performance.timing));
            const perfTiming = JSON.parse(timing);
            
            // Calculate key metrics
            const metrics = {
                // Navigation timing API metrics
                dnsLookup: perfTiming.domainLookupEnd - perfTiming.domainLookupStart,
                tcpConnection: perfTiming.connectEnd - perfTiming.connectStart,
                sslHandshake: perfTiming.connectEnd - perfTiming.secureConnectionStart,
                serverResponse: perfTiming.responseEnd - perfTiming.requestStart,
                domProcessing: perfTiming.domComplete - perfTiming.domLoading,
                pageLoad: perfTiming.loadEventEnd - perfTiming.navigationStart,
                domContentLoaded: perfTiming.domContentLoadedEventEnd - perfTiming.navigationStart,
                
                // Custom metrics
                firstContentfulPaint: this.getMetric(perfMetrics, 'FirstContentfulPaint'),
                firstMeaningfulPaint: this.getMetric(perfMetrics, 'FirstMeaningfulPaint'),
                largestContentfulPaint: this.getMetric(perfMetrics, 'LargestContentfulPaint'),
                cumulativeLayoutShift: this.getMetric(perfMetrics, 'LayoutShift')
            };
            
            test.metrics = metrics;
            
            // Evaluate