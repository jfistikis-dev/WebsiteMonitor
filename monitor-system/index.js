const fs = require('fs');
const path = require('path');
const Database = require('./database');

// Load configuration
const configPath = path.join(__dirname, '../monitor-system/config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

class WebsiteMonitor {
    
    db              = null;
    results         = null;
    logger          = null;
    testRegistry    = null;
    
    constructor() {
        this.results = {
            timestamp: new Date(),
            tests: [],
            summary: { total: 0, passed: 0, failed: 0, successRate: 0 },
            triggeredBy: process.argv[2] || 'scheduled'
        };
        this.logger = this.setupLogger();
        this.db = new Database();
        this.testRegistry = require('./tests'); // Load test registry

        // Add cleanup manager
        this.cleanupManager = new CleanupManager(config);
        this.cleanupManager.setLogger(this.logger);
    }

    setupLogger() {
        const logDir = path.join(__dirname, config.paths.logs);
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
        
        const logFile = path.join(logDir, `monitor-${new Date().toISOString().split('T')[0]}.log`);
        const logStream = fs.createWriteStream(logFile, { flags: 'a' });
        
        return {
            info: (msg) => {
                const line = `[${new Date().toISOString()}] INFO: ${msg}\n`;
                logStream.write(line);
                console.log(line.trim());
            },
            error: (msg) => {
                const line = `[${new Date().toISOString()}] ERROR: ${msg}\n`;
                logStream.write(line);
                console.error(line.trim());
            },
            warn: (msg) => {
                const line = `[${new Date().toISOString()}] WARN: ${msg}\n`;
                logStream.write(line);
                console.warn(line.trim());
            },
            close: () => logStream.end()
        };
    }

    async runAllTests() {
        this.logger.info('=== Starting Website Monitoring Tests ===');
        
        const startTime = Date.now();

        try {
            
            // Run cleanup before tests (optional)
            if (config.monitoring?.cleanup?.runBeforeTests) {
                await this.runCleanup();
            }
            
            // Get all registered tests in sequence
            const testInstances = this.testRegistry.getTests(config, this.logger);
            
            // Execute tests sequentially
            for (const testInstance of testInstances) {
                this.logger.info(`${testInstance.title}`);
                
                const testResult = await testInstance.run();
                this.results.tests.push(testResult);
                
                // Log test completion
                const statusIcon = testResult.status === 'PASS' ? '✅' : 
                                 testResult.status === 'SKIP' ? '⚠️' : '❌';
                this.logger.info(`${statusIcon} ${testResult.name}: ${testResult.status} (${testResult.duration}ms)`);
                
                // Stop on critical failure if configured
                if (testResult.critical && testResult.status === 'FAIL' && config.monitoring.stopOnCriticalFailure) {
                    this.logger.error('Critical test failed, stopping test sequence');
                    break;
                }
                this.logger.info(`==================================================================`);
            }
            
            // Calculate summary
            this.results.summary.total = this.results.tests.length;
            this.results.summary.passed = this.results.tests.filter(t => t.status === 'PASS').length;
            this.results.summary.failed = this.results.tests.filter(t => t.status === 'FAIL').length;
            this.results.summary.successRate = this.results.summary.total > 0 
                ? parseFloat(((this.results.summary.passed / this.results.summary.total) * 100).toFixed(2))
                : 0;
            
            this.results.duration = Date.now() - startTime;
            
            this.logger.info(`=== Tests Completed: ${this.results.summary.passed} passed, ${this.results.summary.failed} failed ===`);
            
            // Process results
            await this.processResults();

            // Run cleanup after tests
            await this.runCleanup();
            
        } catch (error) {
            this.logger.error(`Fatal error in test execution: ${error.message}`);
            this.results.error = error.message;
        }
        
        return this.results; 
    }
    
    async processResults() {
        try {
            // Save to database
            const runId = await this.db.saveCompleteRun(this.results);
            this.logger.info(`Test results saved to database with ID: ${runId}`);
            
            // Update results with run ID
            this.results.runId = runId;
            
            // Save report files
            this.saveReport();
            
            // Send alerts if needed
            if (this.results.summary.failed > 0 && config.alerts.sendOnFailure) {
                await this.sendAlert();
            } else if (config.alerts.sendOnSuccess) {
                await this.sendAlert(); // Send success report if configured
            }
            
        } catch (error) {
            this.logger.error(`Error processing results: ${error.message}`);
            // Fallback: save to file even if DB fails
            this.saveReport();
        }
    }

    saveReport() {
       try {
            const reportDir = path.join(__dirname, config.paths.reports);
            if (!fs.existsSync(reportDir)) {
                fs.mkdirSync(reportDir, { recursive: true });
            }
            
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = this.results.runId 
                ? `report-${this.results.runId}-${timestamp}`
                : `report-${timestamp}`;
            
            // Save JSON report
            const jsonFile = path.join(reportDir, `${filename}.json`);
            const reportData = {
                ...this.results,
                config: {
                    //website: config.website.url,
                    timestamp: new Date().toISOString()
                }
            };
            
            fs.writeFileSync(jsonFile, JSON.stringify(reportData, null, 2));
            this.logger.info(`JSON report saved: ${jsonFile}`);
            
            // Save HTML report
            this.saveHtmlReport(reportData, path.join(reportDir, `${filename}.html`));
            
        } catch (error) {
            this.logger.error(`Failed to save report: ${error.message}`);
        }
    }

     saveHtmlReport(report, filepath) {
        const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Website Monitoring Report</title>
            <style>
                body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 40px; }
                .header { background: #2c3e50; color: white; padding: 20px; border-radius: 5px; }
                .summary { background: #ecf0f1; padding: 20px; border-radius: 5px; margin: 20px 0; }
                .test { padding: 15px; margin: 10px 0; border-radius: 5px; }
                .pass { background: #d4edda; border-left: 5px solid #28a745; }
                .fail { background: #f8d7da; border-left: 5px solid #dc3545; }
                .critical { font-weight: bold; }
                .timestamp { color: #7f8c8d; font-size: 0.9em; }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>📊 Website Monitoring Report</h1>
                <p class="timestamp">Generated: ${new Date(report.timestamp).toLocaleString()}</p>
            </div>
            
            <div class="summary">
                <h2>Summary</h2>
                <p><strong>Total Tests:</strong> ${report.summary.total}</p>
                <p><strong>Passed:</strong> <span style="color: green;">${report.summary.passed}</span></p>
                <p><strong>Failed:</strong> <span style="color: red;">${report.summary.failed}</span></p>
                <p><strong>Success Rate:</strong> ${report.summary.total > 0 ? Math.round((report.summary.passed / report.summary.total) * 100) : 0}%</p>
            </div>
            
            <h2>Test Results</h2>
            ${report.tests.map(test => `
                <div class="test ${test.status === 'PASS' ? 'pass' : 'fail'}">
                    <h3>${test.status === 'PASS' ? '✅' : '❌'} ${test.name} ${test.critical ? '(Critical)' : ''}</h3>
                    <p><strong>Status:</strong> ${test.status}</p>
                    <p><strong>Details:</strong> ${test.details}</p>
                    ${test.screenshot ? `<p><strong>Screenshot:</strong> ${test.screenshot}</p>` : ''}
                </div>
            `).join('')}
        </body>
        </html>`;
        
        fs.writeFileSync(filepath, html);
    }

    async sendAlert() {
        try {
            
            this.logger.info('Preparing email alert...');
                    
            const subject = this.results.summary.failed > 0 
                ? `🚨 WEBSITE ALERT: ${this.results.summary.failed} Test(s) Failed`
                : `✅ Website Monitoring Report - All Tests Passed`; 
            
            const htmlContent = this.generateEmailContent();

            const response = await fetch(config.apiMailSender.host, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-KEY': config.apiMailSender.apikey
                },
                body: JSON.stringify({
                    //app: 'web-monitor-worker',
                    message: htmlContent,
                    subject: subject,
                    recipients: config.apiMailSender.recipients,
                    timestamp: new Date().toISOString()
                })
            });
            
            //const data = await response.json();   // or response.text()
            this.logger.info('Post to email server :: ' + response.status);
            this.logger.info('Alert email sent successfully');
            
        } catch (error) {
            this.logger.error(`Failed to send alert email: ${error.message}`);
        }
    }

    generateEmailContent() {
        
        const failedTests = this.results.tests.filter(t => t.status !== 'PASS');
        
        return `
        <h2>Website Monitoring Alert</h2>
        <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
        
        <h3>🚨 ${failedTests.length} Test(s) Failed</h3>
        <ul>
            ${failedTests.map(test => `
                <li>
                    <strong>${test.name} ${test.critical ? '(CRITICAL)' : ''}</strong><br>
                    ${test.details}
                </li>
            `).join('')}
        </ul>
        
        <h3>📊 Summary</h3>
        <p>Total Tests: ${this.results.summary.total}</p>
        <p>Passed: <span style="color: green;">${this.results.summary.passed}</span></p>
        <p>Failed: <span style="color: red;">${this.results.summary.failed}</span></p>
        
        <hr>
        <p><small>This is an automated alert from your Website Monitoring System.</small></p>
        `;
    
    }

     async runCleanup() {
        try {
            this.logger.info('Running cleanup of old files...');
            const cleanupResult = await this.cleanupManager.performCleanup();
            
            if (cleanupResult.success) {
                this.logger.info(`Cleanup completed: ${cleanupResult.logs.deleted} logs, ${cleanupResult.reports.deleted} reports deleted`);
                
                // Add cleanup info to results
                this.results.cleanup = {
                    performed: true,
                    timestamp: new Date().toISOString(),
                    ...cleanupResult
                };
            } else {
                this.logger.warn(`Cleanup failed: ${cleanupResult.error}`);
            }
            
            return cleanupResult;
            
        } catch (error) {
            this.logger.error(`Cleanup error: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    async getDiskUsage() {
        return await this.cleanupManager.getDiskUsage();
    }
}




// Main execution
async function main() {
    const monitor = new WebsiteMonitor();
    
    try {
        const results = await monitor.runAllTests();
        
        // Exit with appropriate code for CI/CD
        if (results.summary.failed > 0) {
            process.exit(1);
        } else {
            process.exit(0);
        }
        
    } catch (error) {
        console.error(`Fatal error: ${error.message}`);
        process.exit(1);
    } finally {
        
        // close everything... 
        try {
            this.logger.close();
            this.db.close();
            this.logger.info('Monitor cleanup completed');
        } catch (error) {
            console.error('Cleanup error:', error);
        }
    }
}

// Error handlers
process.on('unhandledRejection', (error) => {
    console.error('Unhandled rejection:', error);
    process.exit(1);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
    process.exit(1);
});

// Run if called directly
if (require.main === module) {
    main();
}

module.exports = { WebsiteMonitor };