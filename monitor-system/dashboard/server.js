console.log('=== SERVER STARTING - VERSION: ' + Date.now() + ' ===');

const express = require('express');
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');

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

// Create exports directory
const exportsDir = path.join(__dirname, '../exports');
if (!fs.existsSync(exportsDir)) {
    fs.mkdirSync(exportsDir, { recursive: true });
    console.log(`📁 Created exports directory: ${exportsDir}`);
}

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

// ==================== CLEANUP ENDPOINTS ====================

// Cleanup management endpoints
app.get('/api/cleanup/run', basicAuth, async (req, res) => {
    try {
        const { WebsiteMonitor } = require('../index');
        const monitor = new WebsiteMonitor();
        
        const result = await monitor.runCleanup();
        res.json(result);
        
    } catch (error) {
        console.error('Cleanup API error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

app.get('/api/cleanup/stats', basicAuth, async (req, res) => {
   
    try {
        const { WebsiteMonitor } = require('../index');
        const monitor = new WebsiteMonitor();
        
        const diskUsage = await monitor.getDiskUsage();
        const config = monitor.cleanupManager.cleanupConfig;
        
        res.json({
            success: true,
            diskUsage,
            config,
            canCleanup: config.enabled,
            nextCleanup: calculateNextCleanup(config)
        });
        
    } catch (error) {
        console.error('Cleanup stats API error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

app.post('/api/cleanup/configure', basicAuth, async (req, res) => {
    try {
        const { retentionDays, enabled, maxLogSizeMB } = req.body;
        
        // Note: In production, you'd want to save this to config file
        // For now, we'll just return the proposed configuration
        
        res.json({
            success: true,
            message: 'Configuration updated (in-memory only)',
            newConfig: {
                retentionDays: retentionDays || 180,
                enabled: enabled !== undefined ? enabled : true,
                maxLogSizeMB: maxLogSizeMB || 100
            },
            note: 'To make permanent, update config.json file'
        });
        
    } catch (error) {
        console.error('Cleanup config API error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

function calculateNextCleanup(config) {
    if (!config.enabled) return null;
    
    // Assuming cleanup runs daily or with each test run
    const nextRun = new Date();
    nextRun.setHours(nextRun.getHours() + 24); // Next day
    
    return {
        nextRun: nextRun.toISOString(),
        estimatedFiles: 'Based on current retention policy'
    };
}

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
            includeTests = 'false',
            includeDetails = 'false'
        } = req.query;
        
        console.log(`Export request: ${startDate} to ${endDate}, format: ${format}`);
        
        // Validate and parse dates
        const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const end = endDate ? new Date(endDate) : new Date();
        
        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            return res.status(400).json({ 
                success: false,
                error: 'Invalid date format. Please use YYYY-MM-DD' 
            });
        }
        
        // Get all runs
        const allRuns = await db.getRecentRuns(10000);
        
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
        
        
        // Prepare export data
        const exportData = await prepareExportData(filteredRuns, start, end, includeDetails === 'true');
        
        // Handle different export formats
        switch (format.toLowerCase()) {
            case 'json':    return exportAsJSON(exportData, start, end, res);

            case 'excel':
            case 'xlsx':    return exportAsExcel(exportData, generateExportFilename('excel', start, end), res, exportsDir);

            case 'pdf':
            case 'html':    return exportAsPDF(exportData, generateExportFilename('pdf', start, end), res, exportsDir);
            case 'csv':

            default:        return exportAsCSV(filteredRuns, start, end, res);
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
                default: true,
                supportsDetails: false
            },
            { 
                id: 'json', 
                name: 'JSON', 
                description: 'Complete data in JSON format',
                extensions: ['.json'],
                default: false,
                supportsDetails: true
            },
            { 
                id: 'excel', 
                name: 'Excel', 
                description: 'Microsoft Excel format with multiple sheets',
                extensions: ['.xlsx'],
                default: false,
                supportsDetails: true
            },
            { 
                id: 'pdf', 
                name: 'PDF Report', 
                description: 'Printable HTML report (save as PDF)',
                extensions: ['.html'],
                default: false,
                supportsDetails: false
            }
        ],
        options: {
            dateRange: {
                defaultStart: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                defaultEnd: new Date().toISOString().split('T')[0],
                format: 'YYYY-MM-DD'
            },
            filters: {
                includeDetails: {
                    available: true,
                    default: false,
                    description: 'Include individual test details (for JSON and Excel formats only)'
                }
            }
        }
    });
});

// Helper function to generate export filename
function generateExportFilename(format, startDate, endDate) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dateRange = `${startDate.toISOString().split('T')[0]}_to_${endDate.toISOString().split('T')[0]}`;
    return `monitoring-${dateRange}-${timestamp}`;
}
// Helper function to prepare comprehensive export data
async function prepareExportData(runs, startDate, endDate, includeDetails = false) {
    // Get incidents
    let incidents = [];
    try {
        incidents = await db.getIncidents('all');
    } catch (error) {
        console.warn('Failed to get incidents:', error.message);
    }
    
    // Calculate daily statistics
    const dailyStats = {};
    runs.forEach(run => {
        const date = new Date(run.timestamp).toISOString().split('T')[0];
        if (!dailyStats[date]) {
            dailyStats[date] = {
                runs: 0,
                totalTests: 0,
                passedTests: 0,
                failedTests: 0
            };
        }
        
        dailyStats[date].runs++;
        dailyStats[date].totalTests += run.total_tests || 0;
        dailyStats[date].passedTests += run.passed_tests || 0;
        dailyStats[date].failedTests += run.failed_tests || 0;
    });
    
    // Convert to array
    const dailyStatsArray = Object.entries(dailyStats).map(([date, stats]) => ({
        date,
        ...stats
    })).sort((a, b) => new Date(a.date) - new Date(b.date));
    
    // Calculate overall statistics
    const totalTests = runs.reduce((sum, run) => sum + (run.total_tests || 0), 0);
    const passedTests = runs.reduce((sum, run) => sum + (run.passed_tests || 0), 0);
    const failedTests = runs.reduce((sum, run) => sum + (run.failed_tests || 0), 0);
    const successRate = totalTests > 0 ? (passedTests / totalTests * 100).toFixed(2) : 0;
    
    // Get individual test details if requested and runs are not too many
    let individualTests = [];
    if (includeDetails && runs.length <= 50) {
        for (const run of runs.slice(0, 20)) { // Limit to 20 runs for performance
            try {
                const runDetails = await db.getRunDetails(run.id);
                if (runDetails && runDetails.tests) {
                    runDetails.tests.forEach(test => {
                        individualTests.push({
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
    
    return {
        metadata: {
            exportDate: new Date().toISOString(),
            dateRange: {
                start: startDate.toISOString().split('T')[0],
                end: endDate.toISOString().split('T')[0]
            },
            totalRuns: runs.length,
            format: 'Comprehensive Export'
        },
        summary: {
            totalRuns: runs.length,
            totalTests: totalTests,
            passedTests: passedTests,
            failedTests: failedTests,
            successRate: parseFloat(successRate),
            averageDuration: runs.length > 0 
                ? Math.round(runs.reduce((sum, run) => sum + (run.duration_ms || 0), 0) / runs.length)
                : 0
        },
        statistics: {
            daily: dailyStatsArray
        },
        testRuns: runs,
        incidents: incidents,
        individualTests: individualTests
    };
}


// JSON Export function
async function exportAsJSON(runs, startDate, endDate, res) {
    try {
        // Get comprehensive data
        const exportData = await prepareExportData(runs, startDate, endDate, false);
        
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

async function exportAsExcel(data, filename, res, exportsDir) {
    try {
        const workbook = new ExcelJS.Workbook();
        workbook.created = new Date();
        workbook.modified = new Date();
        
        // Add metadata sheet
        const metaSheet = workbook.addWorksheet('Metadata');
        metaSheet.columns = [
            { header: 'Property', key: 'property', width: 25 },
            { header: 'Value', key: 'value', width: 40 }
        ];
        
        // Add metadata
        metaSheet.addRow({ property: 'Export Date', value: data.metadata.exportDate });
        metaSheet.addRow({ property: 'Date Range', value: `${data.metadata.dateRange.start} to ${data.metadata.dateRange.end}` });
        metaSheet.addRow({ property: 'Total Runs', value: data.metadata.totalRuns });
        metaSheet.addRow({ property: 'Format', value: data.metadata.format });
        
        // Style header row
        metaSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        metaSheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF0070C0' }
        };
        
        // Add summary sheet
        const summarySheet = workbook.addWorksheet('Summary');
        summarySheet.columns = [
            { header: 'Metric', key: 'metric', width: 30 },
            { header: 'Value', key: 'value', width: 25 }
        ];
        
        Object.entries(data.summary).forEach(([key, value]) => {
            summarySheet.addRow({ 
                metric: formatMetricName(key), 
                value: value 
            });
        });
        
        // Style summary sheet
        summarySheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        summarySheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF00B050' }
        };
        
        // Add test runs sheet
        const runsSheet = workbook.addWorksheet('Test Runs');
        runsSheet.columns = [
            { header: 'ID', key: 'id', width: 10 },
            { header: 'Date', key: 'date', width: 12 },
            { header: 'Time', key: 'time', width: 10 },
            { header: 'Total Tests', key: 'total_tests', width: 12 },
            { header: 'Passed', key: 'passed_tests', width: 10 },
            { header: 'Failed', key: 'failed_tests', width: 10 },
            { header: 'Success Rate %', key: 'success_rate', width: 12 },
            { header: 'Duration (ms)', key: 'duration_ms', width: 15 },
            { header: 'Triggered By', key: 'triggered_by', width: 15 }
        ];
        
        data.testRuns.forEach(run => {
            const successRate = run.success_rate || 0;
            runsSheet.addRow({
                id: run.id,
                date: new Date(run.timestamp).toISOString().split('T')[0],
                time: new Date(run.timestamp).toTimeString().split(' ')[0],
                total_tests: run.total_tests || 0,
                passed_tests: run.passed_tests || 0,
                failed_tests: run.failed_tests || 0,
                success_rate: successRate,
                duration_ms: run.duration_ms || 0,
                triggered_by: run.triggered_by || 'scheduled'
            });
            
            // Color code based on success rate
            const row = runsSheet.lastRow;
            if (successRate >= 90) {
                row.getCell('success_rate').fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFC6EFCE' } // Light green
                };
            } else if (successRate < 70) {
                row.getCell('success_rate').fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFFFC7CE' } // Light red
                };
            }
        });
        
        runsSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        runsSheet.getRow(1).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF7030A0' }
        };
        
        // Add daily statistics sheet if available
        if (data.statistics && data.statistics.daily && data.statistics.daily.length > 0) {
            const statsSheet = workbook.addWorksheet('Daily Statistics');
            statsSheet.columns = [
                { header: 'Date', key: 'date', width: 12 },
                { header: 'Runs', key: 'runs', width: 10 },
                { header: 'Total Tests', key: 'totalTests', width: 12 },
                { header: 'Passed', key: 'passed', width: 10 },
                { header: 'Failed', key: 'failed', width: 10 },
                { header: 'Success Rate %', key: 'successRate', width: 12 }
            ];
            
            data.statistics.daily.forEach(day => {
                const successRate = day.totalTests > 0 
                    ? ((day.passedTests / day.totalTests) * 100).toFixed(2)
                    : 0;
                
                statsSheet.addRow({
                    date: day.date,
                    runs: day.runs,
                    totalTests: day.totalTests,
                    passed: day.passedTests,
                    failed: day.failedTests,
                    successRate: parseFloat(successRate)
                });
            });
            
            statsSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
            statsSheet.getRow(1).fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFFFC000' }
            };
        }
        
        // Add incidents sheet if available
        if (data.incidents && data.incidents.length > 0) {
            const incidentsSheet = workbook.addWorksheet('Incidents');
            incidentsSheet.columns = [
                { header: 'ID', key: 'id', width: 10 },
                { header: 'Date', key: 'date', width: 12 },
                { header: 'Title', key: 'title', width: 30 },
                { header: 'Status', key: 'status', width: 12 },
                { header: 'Severity', key: 'severity', width: 12 }
            ];
            
            data.incidents.forEach(incident => {
                incidentsSheet.addRow({
                    id: incident.id,
                    date: new Date(incident.created_at).toISOString().split('T')[0],
                    title: incident.title,
                    status: incident.status,
                    severity: incident.severity || 'medium'
                });
            });
            
            incidentsSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
            incidentsSheet.getRow(1).fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFFF0000' }
            };
        }
        
        // Write to buffer
        const buffer = await workbook.xlsx.writeBuffer();
        
        // Set response headers
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
        
        // Send buffer
        res.send(buffer);
        
    } catch (error) {
        console.error('Excel export error:', error);
        res.status(500).json({ 
            success: false,
            error: 'Excel export failed',
            details: error.message 
        });
    }
}

// Helper function to format metric names
function formatMetricName(key) {
    return key
        .replace(/_/g, ' ')
        .replace(/\b\w/g, l => l.toUpperCase())
        .replace(/([A-Z])/g, ' $1')
        .trim();
}

// PDF Export (returns HTML that can be printed as PDF)
async function exportAsPDF(data, filename, res, exportsDir) {
    try {
        // Generate HTML report
        const html = generatePDFHTML(data);
        
        // Set response headers for HTML download
        res.setHeader('Content-Type', 'text/html');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.html"`);
        
        res.send(html);
        
    } catch (error) {
        console.error('PDF export error:', error);
        res.status(500).json({ 
            success: false,
            error: 'PDF export failed',
            details: error.message 
        });
    }
}

function generatePDFHTML(data) {
    const successRate = data.summary.successRate || 0;
    const avgDuration = data.summary.averageDuration || 0;
    
    return `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Website Monitoring Export - ${data.metadata.dateRange.start} to ${data.metadata.dateRange.end}</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 40px; line-height: 1.6; }
            .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #333; padding-bottom: 20px; }
            .section { margin-bottom: 30px; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
            th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
            th { background-color: #f2f2f2; }
            .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px; }
            .summary-card { background: #f8f9fa; padding: 20px; border-radius: 5px; border-left: 4px solid #007bff; text-align: center; }
            .success { color: #28a745; }
            .warning { color: #ffc107; }
            .danger { color: #dc3545; }
            .footer { margin-top: 50px; text-align: center; color: #6c757d; font-size: 12px; border-top: 1px solid #ddd; padding-top: 20px; }
            h1 { color: #333; }
            h2 { color: #495057; border-bottom: 1px solid #dee2e6; padding-bottom: 10px; }
            .metric-value { font-size: 28px; font-weight: bold; margin: 10px 0; }
            .metric-label { color: #6c757d; font-size: 14px; }
        </style>
    </head>
    <body>
        <div class="header">
            <h1>📊 Website Monitoring Report</h1>
            <p><strong>Date Range:</strong> ${data.metadata.dateRange.start} to ${data.metadata.dateRange.end}</p>
            <p><strong>Exported:</strong> ${new Date(data.metadata.exportDate).toLocaleString()}</p>
        </div>
        
        <div class="section">
            <h2>Executive Summary</h2>
            <div class="summary-grid">
                <div class="summary-card">
                    <div class="metric-value">${data.summary.totalRuns}</div>
                    <div class="metric-label">Total Test Runs</div>
                </div>
                <div class="summary-card">
                    <div class="metric-value ${successRate >= 90 ? 'success' : successRate < 70 ? 'danger' : 'warning'}">
                        ${successRate}%
                    </div>
                    <div class="metric-label">Overall Success Rate</div>
                </div>
                <div class="summary-card">
                    <div class="metric-value">${data.summary.totalTests}</div>
                    <div class="metric-label">Total Tests Executed</div>
                </div>
                <div class="summary-card">
                    <div class="metric-value">${avgDuration}ms</div>
                    <div class="metric-label">Average Duration</div>
                </div>
            </div>
        </div>
        
        <div class="section">
            <h2>Test Runs Overview (Last 20 Runs)</h2>
            <table>
                <thead>
                    <tr>
                        <th>ID</th>
                        <th>Date/Time</th>
                        <th>Tests</th>
                        <th>Passed</th>
                        <th>Failed</th>
                        <th>Success Rate</th>
                        <th>Duration</th>
                        <th>Triggered By</th>
                    </tr>
                </thead>
                <tbody>
                    ${data.testRuns.slice(0, 20).map(run => {
                        const runDate = new Date(run.timestamp);
                        const successRate = run.success_rate || 0;
                        return `
                        <tr>
                            <td>${run.id}</td>
                            <td>${runDate.toLocaleDateString()} ${runDate.toLocaleTimeString()}</td>
                            <td>${run.total_tests || 0}</td>
                            <td class="success">${run.passed_tests || 0}</td>
                            <td class="${run.failed_tests > 0 ? 'danger' : ''}">${run.failed_tests || 0}</td>
                            <td class="${successRate >= 90 ? 'success' : successRate < 70 ? 'danger' : 'warning'}">
                                ${successRate}%
                            </td>
                            <td>${run.duration_ms || 0}ms</td>
                            <td>${run.triggered_by || 'scheduled'}</td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>
            ${data.testRuns.length > 20 ? `<p><em>... and ${data.testRuns.length - 20} more runs</em></p>` : ''}
        </div>
        
        ${data.incidents && data.incidents.length > 0 ? `
        <div class="section">
            <h2>Incidents (${data.incidents.length})</h2>
            <table>
                <thead>
                    <tr>
                        <th>ID</th>
                        <th>Date</th>
                        <th>Title</th>
                        <th>Status</th>
                        <th>Severity</th>
                    </tr>
                </thead>
                <tbody>
                    ${data.incidents.slice(0, 10).map(incident => `
                        <tr>
                            <td>${incident.id}</td>
                            <td>${new Date(incident.created_at).toLocaleDateString()}</td>
                            <td>${incident.title}</td>
                            <td class="${incident.status === 'open' ? 'danger' : 'success'}">${incident.status}</td>
                            <td class="${incident.severity === 'high' ? 'danger' : incident.severity === 'medium' ? 'warning' : ''}">
                                ${incident.severity || 'medium'}
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
            ${data.incidents.length > 10 ? `<p><em>... and ${data.incidents.length - 10} more incidents</em></p>` : ''}
        </div>
        ` : ''}
        
        ${data.statistics && data.statistics.daily && data.statistics.daily.length > 0 ? `
        <div class="section">
            <h2>Daily Statistics (Last 7 Days)</h2>
            <table>
                <thead>
                    <tr>
                        <th>Date</th>
                        <th>Runs</th>
                        <th>Total Tests</th>
                        <th>Passed</th>
                        <th>Failed</th>
                        <th>Success Rate</th>
                    </tr>
                </thead>
                <tbody>
                    ${data.statistics.daily.slice(-7).map(day => {
                        const successRate = day.totalTests > 0 ? ((day.passedTests / day.totalTests) * 100).toFixed(2) : 0;
                        return `
                        <tr>
                            <td>${day.date}</td>
                            <td>${day.runs}</td>
                            <td>${day.totalTests}</td>
                            <td class="success">${day.passedTests}</td>
                            <td class="${day.failedTests > 0 ? 'danger' : ''}">${day.failedTests}</td>
                            <td class="${successRate >= 90 ? 'success' : successRate < 70 ? 'danger' : 'warning'}">
                                ${successRate}%
                            </td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>
        </div>
        ` : ''}
        
        <div class="footer">
            <p>Generated by Website Monitoring System • ${new Date().toLocaleDateString()}</p>
            <p><strong>To save as PDF:</strong> Print this page (Ctrl+P) and choose "Save as PDF" as destination</p>
        </div>
    </body>
    </html>`;
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