console.log('=== SERVER STARTING - VERSION: ' + Date.now() + ' ===');

const express = require('express');
const path = require('path');
const fs = require('fs');

const { formatUptimeForDashboard, formatDuration } = require('../utils/time-formatter');


const activeTests = new Map();

// Load config
const configPath = path.join(__dirname, '../config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// Import Database class and create instance
const Database = require('../database');
let db = new Database();

const app = express();
const PORT = config.dashboard.port || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Basic authentication (optional)
const basicAuth = (req, res, next) => {
    if (!config.dashboard.auth.enabled) return next();
    
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
        res.setHeader('WWW-Authenticate', 'Basic realm="Dashboard"');
        return res.status(401).json({ error: 'Authentication required' });
    }
    
    const credentials = Buffer.from(authHeader.split(' ')[1], 'base64').toString();
    const [username, password] = credentials.split(':');
    
    if (username === config.dashboard.auth.username && 
        password === config.dashboard.auth.password) {
        return next();
    }
    
    res.status(401).json({ error: 'Invalid credentials' });
};

// API Routes

app.get('/api/next-runtime', basicAuth, async (req, res) => {

    let lastRuntime = await db.getRecentRuns(1);
    lastRuntime = lastRuntime[0].timestamp; // MUST be ms

    const intervalMs = config.monitoring.checkIntervalHours * 60 * 60 * 1000; // 3 ώρες
    const now = Date.now();

    let remainingMs ;

    if (lastRuntime + intervalMs > now) {
        // ✅ Δεν έγινε restart
        remainingMs  = (lastRuntime + intervalMs) - now;
    } else {
        // 🔄 Έγινε restart στον server
        const uptimeMs = process.uptime() * 1000;
        remainingMs  = intervalMs - uptimeMs;
    }

    // safety net 🪂
    remainingMs  = Math.max(0, remainingMs );

    // ---------- format ----------
    res.json({
        interval: {
            hours: config.monitoring.checkIntervalHours,
            ms: intervalMs,
            label: formatDuration(intervalMs)
        },
        remaining: {
            ms: remainingMs ,
            label: formatDuration(remainingMs )
        }
    });
})


app.get('/api/recent-runs', basicAuth, async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;
        const runs = await db.getRecentRuns(limit);
        //console.log ( runs )   ;
        res.json(runs);
    } catch (error) {
        console.error('Recent runs API error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/run/:id', basicAuth, async (req, res) => {
    try {
        const run = await db.getRunDetails(parseInt(req.params.id));
        if (!run) {
            return res.status(404).json({ error: 'Run not found' });
        }
        res.json(run);
    } catch (error) {
        console.error('Run details API error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/uptime', basicAuth, async (req, res) => {
    try {
        const days = parseInt(req.query.days) || 30;
        const stats = await db.getUptimeStats(days);
        res.json(stats);
    } catch (error) {
        console.error('Uptime API error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/incidents', basicAuth, async (req, res) => {
    try {
        const status = req.query.status || 'open';
        const incidents = await db.getIncidents(status);
        res.json(incidents);
    } catch (error) {
        console.error('Incidents API error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get database information
app.get('/api/database-info', basicAuth, async (req, res) => {
    try {
        if (typeof db.getDatabaseStatistics !== 'function') {
            return res.json({
                size: 'N/A',
                message: 'Database size feature not available'
            });
        }
        
        const dbInfo = await db.getDatabaseStatistics();
        res.json(dbInfo);
        
    } catch (error) {
        console.error('Database info API error:', error);
        res.status(500).json({ 
            error: 'Failed to get database information',
            details: error.message 
        });
    }
});

// Or update the /api/status endpoint to include database size:
app.get('/api/status', basicAuth, async (req, res) => {
    try {
        // Get current status
        const status = await db.getCurrentStatus();
        
        // Get database size if method exists
        let dbSize = 'N/A';
        if (typeof db.getDatabaseSize === 'function') {
            try {
                const sizeInfo = await db.getDatabaseSize();
                dbSize = sizeInfo.sizeFormatted || 'N/A';
            } catch (sizeError) {
                console.warn('Failed to get database size:', sizeError.message);
            }
        }
        
        // Combine all information
        const enhancedStatus = {
            ...status,
            databaseSize: dbSize,
            server : {
                uptimeSeconds: process.uptime(),
                uptimeFormatted: formatUptimeForDashboard(process.uptime(), {
                    compact: true,
                    precision: 3,
                    showUpText: false
                }),
                nodeVersion: process.version,
                platform: process.platform,
                memoryUsage: process.memoryUsage(),
                startTime: new Date(Date.now() - (process.uptime() * 1000)).toISOString()
            },
            serverTime: new Date().toISOString(),
            
        };
        
        res.json(enhancedStatus);
        
    } catch (error) {
        console.error('Status API error:', error);
        res.status(500).json({ error: error.message });
    } 
});


// Enhanced manual test with progress tracking
app.post('/api/run-manual-test-enhanced', basicAuth, async (req, res) => {
    try {
        const testId = `manual_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const startTime = Date.now();
        
        console.log(`🚀 Starting enhanced manual test: ${testId}`);
        
        // Create test progress object
        const testProgress = {
            id: testId,
            status: 'running',
            startTime: startTime,
            progress: 0,
            currentTest: null,
            tests: [],
            results: null,
            user: req.user || 'anonymous'
        };
        
        // Store in active tests
        activeTests.set(testId, testProgress);
        
        // Clean up old tests (older than 1 hour)
        cleanUpOldTests();
        
        // Run tests in background
        runEnhancedTests(testId, testProgress);
        
        // Return immediate response with test ID
        res.json({
            success: true,
            testId: testId,
            message: 'Manual test started with progress tracking',
            statusUrl: `/api/test-progress/${testId}`,
            cancelUrl: `/api/cancel-test/${testId}`,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ Enhanced manual test error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get test progress
app.get('/api/test-progress/:testId', basicAuth, async (req, res) => {
    try {
        
        const testId = req.params.testId;
        const progress = activeTests.get(testId);
        
        //console.log ( "📊 Getting progress for test:", testId, progress );

       if (!progress) {
            return res.status(404).json({
                success: false,
                error: 'Test not found or expired',
                testId: testId
            });
        }
        
        res.json({
            success: true,
            ...progress,
            estimatedTimeRemaining: progress.status === 'running' 
                ? estimateRemainingTime(progress) 
                : 0
        });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Cancel a running test
app.post('/api/cancel-test/:testId', basicAuth, async (req, res) => {
    try {
        const testId = req.params.testId;
        const progress = activeTests.get(testId);
        
        if (!progress) {
            return res.status(404).json({
                success: false,
                error: 'Test not found'
            });
        }
        
        if (progress.status !== 'running') {
            return res.json({
                success: false,
                message: 'Test is not running',
                status: progress.status
            });
        }
        
        // Mark as cancelled
        progress.status = 'cancelled';
        progress.endTime = Date.now();
        progress.cancelledBy = req.user || 'unknown';
        activeTests.set(testId, progress);
        
        // Note: In a real implementation, you'd need to actually stop the test
        console.log(`⏹️  Test ${testId} cancelled by user`);
        
        res.json({
            success: true,
            message: 'Test cancelled',
            testId: testId
        });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


// ==================== EXPORT ENDPOINTS ====================

// Quick export (simple CSV of recent runs)
app.get('/api/export/quick', basicAuth, async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 100;
        const runs = await db.getRecentRuns(limit);
        
        // Create CSV headers
        const csvHeaders = [
            'ID', 
            'Timestamp', 
            'Total Tests', 
            'Passed', 
            'Failed', 
            'Success Rate', 
            'Duration (ms)', 
            'Triggered By'
        ];
        
        // Create CSV rows
        const csvRows = runs.map(run => [
            run.id,
            run.timestamp,
            run.total_tests || 0,
            run.passed_tests || 0,
            run.failed_tests || 0,
            `${run.success_rate || 0}%`,
            run.duration_ms || 0,
            run.triggered_by || 'scheduled'
        ]);
        
        // Combine headers and rows
        const csvContent = [
            csvHeaders.join(','),
            ...csvRows.map(row => row.map(cell => `"${cell}"`).join(','))
        ].join('\n');
        
        const filename = `monitoring-export-${new Date().toISOString().split('T')[0]}.csv`;
        
        // Set response headers for CSV download
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(csvContent);
        
    } catch (error) {
        console.error('Quick export error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Main export endpoint with filtering
app.get('/api/export', basicAuth, async (req, res) => {
    
    try {
        const { 
            startDate, 
            endDate, 
            format = 'csv',
            includeTests = 'false'
        } = req.query;
        
        console.log(`Export request: ${startDate} to ${endDate}, format: ${format}`);
        
        // Validate and parse dates
        const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // Default: 30 days
        const end = endDate ? new Date(endDate) : new Date();
        
        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            return res.status(400).json({ 
                success: false,
                error: 'Invalid date format. Please use YYYY-MM-DD' 
            });
        }
        
        // Get all runs (we'll filter them)
        const allRuns = await db.getRecentRuns(10000); // Large limit
        
        // Filter runs by date
        const filteredRuns = allRuns.filter(run => {
            if (!run.timestamp) return false;
            const runDate = new Date(run.timestamp);
            return runDate >= start && runDate <= end;
        });
        
        console.log(`Found ${filteredRuns.length} runs in date range`);
        
        if (filteredRuns.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'No data found for the specified date range'
            });
        }
        
        // Handle different export formats
        switch (format.toLowerCase()) {
            case 'json':
                return exportAsJSON(filteredRuns, start, end, res);
            case 'csv':
            default:
                return exportAsCSV(filteredRuns, start, end, res);
        }
        
    } catch (error) {
        console.error('Export error:', error);
        res.status(500).json({ 
            success: false,
            error: 'Export failed', 
            details: error.message 
        });
    }

});

// Export formats endpoint (for frontend to know what's available)
app.get('/api/export/formats', basicAuth, (req, res) => {
    res.json({
        success: true,
        formats: [
            { 
                id: 'csv', 
                name: 'CSV', 
                description: 'Comma-separated values (Excel compatible)',
                extensions: ['.csv'],
                default: true
            },
            { 
                id: 'json', 
                name: 'JSON', 
                description: 'Complete data in JSON format',
                extensions: ['.json'],
                default: false
            }
        ],
        options: {
            dateRange: {
                defaultStart: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                defaultEnd: new Date().toISOString().split('T')[0],
                format: 'YYYY-MM-DD'
            },
            filters: {
                includeTests: {
                    available: true,
                    default: false,
                    description: 'Include individual test details (slower for large exports)'
                }
            }
        }
    });
});

// JSON Export function
async function exportAsJSON(runs, startDate, endDate, res) {
    try {
        // Create comprehensive JSON data
        const exportData = {
            metadata: {
                exportDate: new Date().toISOString(),
                dateRange: {
                    start: startDate.toISOString().split('T')[0],
                    end: endDate.toISOString().split('T')[0]
                },
                totalRuns: runs.length,
                format: 'JSON Export'
            },
            summary: {
                totalRuns: runs.length,
                totalTests: runs.reduce((sum, run) => sum + (run.total_tests || 0), 0),
                passedTests: runs.reduce((sum, run) => sum + (run.passed_tests || 0), 0),
                failedTests: runs.reduce((sum, run) => sum + (run.failed_tests || 0), 0),
                averageSuccessRate: runs.length > 0 
                    ? (runs.reduce((sum, run) => sum + (run.success_rate || 0), 0) / runs.length).toFixed(2)
                    : 0
            },
            testRuns: runs
        };
        
        // Get individual tests if requested and runs are not too many
        if (runs.length <= 100) { // Limit to avoid overwhelming
            exportData.individualTests = [];
            
            for (const run of runs.slice(0, 50)) { // Further limit to 50 runs
                try {
                    const runDetails = await db.getRunDetails(run.id);
                    if (runDetails && runDetails.tests) {
                        runDetails.tests.forEach(test => {
                            exportData.individualTests.push({
                                runId: run.id,
                                runTimestamp: run.timestamp,
                                ...test
                            });
                        });
                    }
                } catch (error) {
                    console.warn(`Failed to get details for run ${run.id}:`, error.message);
                }
            }
        }
        
        // Get incidents if any
        try {
            const incidents = await db.getIncidents('all');
            if (incidents && incidents.length > 0) {
                exportData.incidents = incidents;
            }
        } catch (error) {
            console.warn('Failed to get incidents:', error.message);
        }
        
        const filename = `monitoring-export-${new Date().toISOString().split('T')[0]}.json`;
        
        // Set response headers for JSON download
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(JSON.stringify(exportData, null, 2));
        
    } catch (error) {
        console.error('JSON export error:', error);
        throw error;
    }
}

// CSV Export function
function exportAsCSV(runs, startDate, endDate, res) {
    try {
        // Create CSV headers
        const csvHeaders = [
            'ID', 
            'Timestamp', 
            'Date',
            'Time',
            'Total Tests', 
            'Passed', 
            'Failed', 
            'Success Rate', 
            'Duration (ms)', 
            'Triggered By'
        ];
        
        // Create CSV rows
        const csvRows = runs.map(run => {
            const runDate = new Date(run.timestamp);
            return [
                run.id,
                run.timestamp,
                runDate.toISOString().split('T')[0], // Date part
                runDate.toTimeString().split(' ')[0], // Time part
                run.total_tests || 0,
                run.passed_tests || 0,
                run.failed_tests || 0,
                `${run.success_rate || 0}%`,
                run.duration_ms || 0,
                run.triggered_by || 'scheduled'
            ];
        });
        
        // Combine headers and rows (escape commas in values)
        const csvContent = [
            csvHeaders.join(','),
            ...csvRows.map(row => row.map(cell => 
                typeof cell === 'string' && cell.includes(',') 
                    ? `"${cell}"` 
                    : cell
            ).join(','))
        ].join('\n');
        
        const filename = `monitoring-export-${startDate.toISOString().split('T')[0]}-to-${endDate.toISOString().split('T')[0]}.csv`;
        
        // Set response headers for CSV download
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(csvContent);
        
    } catch (error) {
        console.error('CSV export error:', error);
        throw error;
    }
}




// Dashboard home page
app.get('*', basicAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


// ==================== Helper functions ====================
function cleanUpOldTests() {
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    
    for (const [testId, progress] of activeTests.entries()) {
        if (progress.startTime < oneHourAgo) {
            activeTests.delete(testId);
            console.log(`🧹 Auto-cleaned old test: ${testId}`);
        }
    }
}

function estimateRemainingTime(progress) {
    if (!progress.startTime || progress.progress === 0) return null;
    
    const elapsed = Date.now() - progress.startTime;
    const estimatedTotal = (elapsed / progress.progress) * 100;
    return Math.max(0, estimatedTotal - elapsed);
}

// Function to run tests with progress tracking
async function runEnhancedTests(testId, progress) {
    try {
        const { WebsiteMonitor } = require('../index');
        const monitor = new WebsiteMonitor();
        
        // Override monitor's test execution to track progress
        const originalRunAllTests = monitor.runAllTests.bind(monitor);
        
        // Get test registry to know total tests
        const testRegistry = require('../tests');
        const testInstances = testRegistry.getTests(config, monitor.logger);
        const totalTests = testInstances.length;
        
        let completedTests = 0;
        monitor.logger.info('=== Starting Website Monitoring Tests ===');
        const startTime = Date.now();

        // Run each test and update progress
        for (const testInstance of testInstances) {
            
            progress.currentTest = testInstance.name;
            progress.progress = Math.round((completedTests / totalTests) * 100);
            activeTests.set(testId, progress); // add it to activeTests list ...
            
            console.log(`📊 Test ${testId}: Running ${testInstance.name} (${progress.progress}%)`);
            
            const testResult = await testInstance.run();
            monitor.results.tests.push(testResult);

            const statusIcon = testResult.status === 'PASS' ? '✅' : 
                                 testResult.status === 'SKIP' ? '⚠️' : '❌';
            monitor.logger.info(`${statusIcon} ${testResult.name}: ${testResult.status} (${testResult.duration}ms)`);
            
            // Stop on critical failure if configured
            if (testResult.critical && testResult.status === 'FAIL' && config.monitoring.stopOnCriticalFailure) {
                monitor.logger.error('Critical test failed, stopping test sequence');
                break;
            }

            completedTests++;
        }


        // Calculate summary
        monitor.results.summary.total   = monitor.results.tests.length;
        monitor.results.summary.passed  = monitor.results.tests.filter(t => t.status === 'PASS').length;
        monitor.results.summary.failed  = monitor.results.tests.filter(t => t.status === 'FAIL').length;
        monitor.results.summary.successRate = monitor.results.summary.total > 0 
            ? parseFloat(((monitor.results.summary.passed / monitor.results.summary.total) * 100).toFixed(2))
            : 0;
        
        monitor.results.duration = Date.now() - startTime;
        monitor.logger.info(`=== Tests Completed: ${monitor.results.summary.passed} passed, ${monitor.results.summary.failed} failed ===`);

        await monitor.processResults();

        
        // Update progress
        progress.status = 'completed';
        progress.progress = 100;
        progress.results = monitor.results;
        progress.endTime = Date.now();
        progress.duration = progress.endTime - progress.startTime;
        
        activeTests.set(testId, progress);
        
        console.log(`✅ Enhanced test ${testId} completed in ${progress.duration}ms`);
        
        // Remove from active tests after 5 minutes
        setTimeout(() => {
            if (activeTests.has(testId)) {
                activeTests.delete(testId);
                console.log(`🧹 Cleaned up test ${testId}`);
            }
        }, 5 * 60 * 1000);
        
    } catch (error) {
        console.error(`❌ Enhanced test ${testId} failed:`, error);
        
        const progress = activeTests.get(testId);
        if (progress) {
            progress.status = 'failed';
            progress.error = error.message;
            progress.endTime = Date.now();
            activeTests.set(testId, progress);
        }
    }
}

// Start server
app.listen(PORT, () => {
    console.log(`📊 Dashboard running on http://localhost:${PORT}`);
    console.log(`🔧 Database type: ${config.database.type}`);
    console.log('✅ Database instance ready');
});

module.exports = app;