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
        //this.logger.info(`Target: ${config.website.url}`);
        //this.logger.info(`Triggered by: ${this.results.triggeredBy}`);
        
        const startTime = Date.now();
        
        try {
            // Get all registered tests in sequence
            const testInstances = this.testRegistry.getTests(config, this.logger);
            
            // Execute tests sequentially
            for (const testInstance of testInstances) {
                this.logger.info(`Running test: ${testInstance.name} `);
                
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
                    website: config.website.url,
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
    async sendAlert() {
        try {
            if (!config.smtp.host || !config.smtp.auth.user) {
                this.logger.warn('Email alerts not configured, skipping');
                return;
            }
            
            this.logger.info('Preparing email alert...');
            
            const transporter = nodemailer.createTransport({
                host: config.smtp.host,
                port: config.smtp.port,
                secure: config.smtp.secure,
                auth: config.smtp.auth
            });
            
            const subject = this.results.summary.failed > 0 
                ? `🚨 WEBSITE ALERT: ${this.results.summary.failed} Test(s) Failed`
                : `✅ Website Monitoring Report - All Tests Passed`; 
            
            const htmlContent = this.generateEmailContent();
            
            const mailOptions = {
                from: `"Website Monitor" <${config.smtp.auth.user}>`,
                to: config.alerts.recipients.join(', '),
                subject,
                html: htmlContent,
                attachments: this.results.summary.failed > 0 ? [
                    {
                        filename: 'report.html',
                        path: path.join(__dirname, config.paths.reports, `report-${this.results.runId || 'latest'}.html`)
                    }
                ] : []
            };
            
            await transporter.sendMail(mailOptions);
            this.logger.info('Alert email sent successfully');
            
        } catch (error) {
            this.logger.error(`Failed to send alert email: ${error.message}`);
        }
    }

    cleanup() {
        try {
            this.logger.close();
            this.db.close();
            this.logger.info('Monitor cleanup completed');
        } catch (error) {
            console.error('Cleanup error:', error);
        }
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
        monitor.cleanup();
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