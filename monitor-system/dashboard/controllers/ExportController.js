const DatabaseService = require('../services/DatabaseService');
const fs = require('fs');
const path = require('path');
const { Parser } = require('json2csv');
const ExcelJS = require('exceljs');

class ExportController {
    constructor() {
        this.exportsDir = path.join(__dirname, '../../exports');
        this.ensureExportsDirectory();
    }

    ensureExportsDirectory() {
        if (!fs.existsSync(this.exportsDir)) {
            fs.mkdirSync(this.exportsDir, { recursive: true });
        }
    }

    async exportData(req, res) {
        try {
            const { 
                startDate, 
                endDate, 
                format = 'json', 
                includeTests = 'false',
                includeIncidents = 'false' 
            } = req.query;

            // Validate dates
            const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // Default: 30 days
            const end = endDate ? new Date(endDate) : new Date();

            if (isNaN(start.getTime()) || isNaN(end.getTime())) {
                return res.status(400).json({ 
                    error: 'Invalid date format. Use YYYY-MM-DD' 
                });
            }

            // Get data
            const data = await this.fetchExportData(start, end, {
                includeTests: includeTests === 'true',
                includeIncidents: includeIncidents === 'true'
            });

            // Generate filename
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `monitoring-export-${timestamp}`;

            // Export based on format
            switch (format.toLowerCase()) {
                case 'csv':
                    return await this.exportAsCSV(data, filename, res);
                case 'excel':
                    return await this.exportAsExcel(data, filename, res);
                case 'pdf':
                    return await this.exportAsPDF(data, filename, res);
                case 'json':
                default:
                    return await this.exportAsJSON(data, filename, res);
            }

        } catch (error) {
            console.error('Export error:', error);
            res.status(500).json({ 
                error: 'Export failed', 
                details: error.message 
            });
        }
    }

    async fetchExportData(startDate, endDate, options = {}) {
        const { includeTests, includeIncidents } = options;

        // Format dates for SQL
        const startStr = startDate.toISOString().split('T')[0];
        const endStr = endDate.toISOString().split('T')[0];

        // Get test runs
        const runs = await DatabaseService.getRecentRuns(10000); // Large limit for export
        const filteredRuns = runs.filter(run => {
            const runDate = new Date(run.timestamp);
            return runDate >= startDate && runDate <= endDate;
        });

        const data = {
            metadata: {
                exportDate: new Date().toISOString(),
                dateRange: { start: startStr, end: endStr },
                totalRuns: filteredRuns.length,
                format: 'Website Monitoring Export'
            },
            summary: await this.generateSummary(filteredRuns),
            testRuns: filteredRuns
        };

        // Include individual tests if requested
        if (includeTests && filteredRuns.length > 0) {
            data.individualTests = await this.fetchIndividualTests(filteredRuns);
        }

        // Include incidents if requested
        if (includeIncidents) {
            data.incidents = await DatabaseService.getIncidents('all');
        }

        // Add statistics
        data.statistics = await this.calculateStatistics(filteredRuns);

        return data;
    }

    async generateSummary(runs) {
        if (runs.length === 0) {
            return {
                totalTests: 0,
                passedTests: 0,
                failedTests: 0,
                successRate: 0,
                averageDuration: 0,
                criticalFailures: 0
            };
        }

        const totalTests = runs.reduce((sum, run) => sum + (run.total_tests || 0), 0);
        const passedTests = runs.reduce((sum, run) => sum + (run.passed_tests || 0), 0);
        const failedTests = runs.reduce((sum, run) => sum + (run.failed_tests || 0), 0);
        const totalDuration = runs.reduce((sum, run) => sum + (run.duration_ms || 0), 0);

        return {
            totalRuns: runs.length,
            totalTests,
            passedTests,
            failedTests,
            successRate: totalTests > 0 ? ((passedTests / totalTests) * 100).toFixed(2) : 0,
            averageDuration: runs.length > 0 ? Math.round(totalDuration / runs.length) : 0,
            dateRange: {
                firstRun: runs[runs.length - 1]?.timestamp,
                lastRun: runs[0]?.timestamp
            }
        };
    }

    async fetchIndividualTests(runs) {
        const allTests = [];
        
        for (const run of runs.slice(0, 100)) { // Limit to first 100 runs to avoid overload
            try {
                const runDetails = await DatabaseService.getRunDetails(run.id);
                if (runDetails && runDetails.tests) {
                    runDetails.tests.forEach(test => {
                        allTests.push({
                            runId: run.id,
                            runTimestamp: run.timestamp,
                            ...test
                        });
                    });
                }
            } catch (error) {
                console.warn(`Failed to fetch tests for run ${run.id}:`, error.message);
            }
        }
        
        return allTests;
    }

    async calculateStatistics(runs) {
        const dailyStats = {};
        
        runs.forEach(run => {
            const date = run.timestamp.split('T')[0];
            if (!dailyStats[date]) {
                dailyStats[date] = {
                    date,
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

        return {
            daily: Object.values(dailyStats),
            overall: {
                totalDays: Object.keys(dailyStats).length,
                averageDailyRuns: runs.length / Math.max(1, Object.keys(dailyStats).length),
                bestDay: this.findBestDay(dailyStats),
                worstDay: this.findWorstDay(dailyStats)
            }
        };
    }

    findBestDay(dailyStats) {
        const days = Object.values(dailyStats);
        if (days.length === 0) return null;
        
        return days.reduce((best, day) => {
            const successRate = day.totalTests > 0 ? (day.passedTests / day.totalTests) * 100 : 0;
            const bestRate = best.totalTests > 0 ? (best.passedTests / best.totalTests) * 100 : 0;
            return successRate > bestRate ? day : best;
        });
    }

    findWorstDay(dailyStats) {
        const days = Object.values(dailyStats);
        if (days.length === 0) return null;
        
        return days.reduce((worst, day) => {
            const successRate = day.totalTests > 0 ? (day.passedTests / day.totalTests) * 100 : 0;
            const worstRate = worst.totalTests > 0 ? (worst.passedTests / worst.totalTests) * 100 : 0;
            return successRate < worstRate ? day : worst;
        });
    }

    // JSON Export
    async exportAsJSON(data, filename, res) {
        const filepath = path.join(this.exportsDir, `${filename}.json`);
        
        fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
        
        res.download(filepath, `${filename}.json`, (err) => {
            if (err) console.error('Download error:', err);
            // Optional: Clean up file after download
            // setTimeout(() => fs.unlinkSync(filepath), 60000);
        });
    }

    // CSV Export
    async exportAsCSV(data, filename, res) {
        try {
            // Flatten test runs for CSV
            const csvData = data.testRuns.map(run => ({
                'Run ID': run.id,
                'Timestamp': run.timestamp,
                'Date': run.timestamp.split('T')[0],
                'Time': run.timestamp.split('T')[1].split('.')[0],
                'Total Tests': run.total_tests,
                'Passed Tests': run.passed_tests,
                'Failed Tests': run.failed_tests,
                'Success Rate': `${run.success_rate || 0}%`,
                'Duration (ms)': run.duration_ms,
                'Triggered By': run.triggered_by
            }));

            const json2csvParser = new Parser();
            const csv = json2csvParser.parse(csvData);

            const filepath = path.join(this.exportsDir, `${filename}.csv`);
            fs.writeFileSync(filepath, csv);

            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
            res.send(csv);

        } catch (error) {
            console.error('CSV export error:', error);
            res.status(500).json({ error: 'CSV export failed' });
        }
    }

    // Excel Export
    async exportAsExcel(data, filename, res) {
        try {
            const workbook = new ExcelJS.Workbook();
            
            // Add metadata sheet
            const metaSheet = workbook.addWorksheet('Metadata');
            metaSheet.columns = [
                { header: 'Property', key: 'property', width: 20 },
                { header: 'Value', key: 'value', width: 40 }
            ];
            
            metaSheet.addRow({ property: 'Export Date', value: data.metadata.exportDate });
            metaSheet.addRow({ property: 'Date Range', value: `${data.metadata.dateRange.start} to ${data.metadata.dateRange.end}` });
            metaSheet.addRow({ property: 'Total Runs', value: data.metadata.totalRuns });
            metaSheet.addRow({ property: 'Format', value: data.metadata.format });
            
            // Add summary sheet
            const summarySheet = workbook.addWorksheet('Summary');
            summarySheet.columns = [
                { header: 'Metric', key: 'metric', width: 25 },
                { header: 'Value', key: 'value', width: 20 }
            ];
            
            Object.entries(data.summary).forEach(([key, value]) => {
                summarySheet.addRow({ 
                    metric: this.formatMetricName(key), 
                    value: typeof value === 'object' ? JSON.stringify(value) : value 
                });
            });
            
            // Add test runs sheet
            const runsSheet = workbook.addWorksheet('Test Runs');
            runsSheet.columns = [
                { header: 'ID', key: 'id', width: 10 },
                { header: 'Date', key: 'date', width: 12 },
                { header: 'Time', key: 'time', width: 10 },
                { header: 'Total Tests', key: 'total_tests', width: 12 },
                { header: 'Passed', key: 'passed_tests', width: 10 },
                { header: 'Failed', key: 'failed_tests', width: 10 },
                { header: 'Success Rate', key: 'success_rate', width: 12 },
                { header: 'Duration (ms)', key: 'duration_ms', width: 15 },
                { header: 'Triggered By', key: 'triggered_by', width: 15 }
            ];
            
            data.testRuns.forEach(run => {
                runsSheet.addRow({
                    id: run.id,
                    date: run.timestamp.split('T')[0],
                    time: run.timestamp.split('T')[1].split('.')[0],
                    total_tests: run.total_tests,
                    passed_tests: run.passed_tests,
                    failed_tests: run.failed_tests,
                    success_rate: run.success_rate ? `${run.success_rate}%` : '0%',
                    duration_ms: run.duration_ms,
                    triggered_by: run.triggered_by
                });
                
                // Color code based on success rate
                const row = runsSheet.lastRow;
                if (run.success_rate >= 90) {
                    row.getCell('success_rate').fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FFC6EFCE' } // Light green
                    };
                } else if (run.success_rate < 70) {
                    row.getCell('success_rate').fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FFFFC7CE' } // Light red
                    };
                }
            });
            
            // Add statistics sheet if available
            if (data.statistics && data.statistics.daily) {
                const statsSheet = workbook.addWorksheet('Daily Statistics');
                statsSheet.columns = [
                    { header: 'Date', key: 'date', width: 12 },
                    { header: 'Runs', key: 'runs', width: 10 },
                    { header: 'Total Tests', key: 'totalTests', width: 12 },
                    { header: 'Passed', key: 'passed', width: 10 },
                    { header: 'Failed', key: 'failed', width: 10 },
                    { header: 'Success Rate', key: 'successRate', width: 12 }
                ];
                
                data.statistics.daily.forEach(day => {
                    const successRate = day.totalTests > 0 ? 
                        ((day.passedTests / day.totalTests) * 100).toFixed(2) : 0;
                    
                    statsSheet.addRow({
                        date: day.date,
                        runs: day.runs,
                        totalTests: day.totalTests,
                        passed: day.passedTests,
                        failed: day.failedTests,
                        successRate: `${successRate}%`
                    });
                });
            }
            
            // Write to file
            const filepath = path.join(this.exportsDir, `${filename}.xlsx`);
            await workbook.xlsx.writeFile(filepath);
            
            res.download(filepath, `${filename}.xlsx`, (err) => {
                if (err) console.error('Download error:', err);
            });
            
        } catch (error) {
            console.error('Excel export error:', error);
            res.status(500).json({ error: 'Excel export failed' });
        }
    }

    // PDF Export (simplified - returns HTML that can be printed as PDF)
    async exportAsPDF(data, filename, res) {
        try {
            // Generate HTML report
            const html = this.generatePDFHTML(data);
            
            const filepath = path.join(this.exportsDir, `${filename}.html`);
            fs.writeFileSync(filepath, html);
            
            // Return HTML that can be printed as PDF
            res.setHeader('Content-Type', 'text/html');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}.html"`);
            res.send(html);
            
        } catch (error) {
            console.error('PDF export error:', error);
            res.status(500).json({ error: 'PDF export failed' });
        }
    }

    generatePDFHTML(data) {
        return `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Website Monitoring Export - ${data.metadata.dateRange.start} to ${data.metadata.dateRange.end}</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 40px; }
                .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #333; padding-bottom: 20px; }
                .section { margin-bottom: 30px; }
                table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
                th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                th { background-color: #f2f2f2; }
                .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; }
                .summary-card { background: #f8f9fa; padding: 15px; border-radius: 5px; border-left: 4px solid #007bff; }
                .success { color: #28a745; }
                .warning { color: #ffc107; }
                .danger { color: #dc3545; }
                .footer { margin-top: 50px; text-align: center; color: #6c757d; font-size: 12px; }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>Website Monitoring Report</h1>
                <p>Date Range: ${data.metadata.dateRange.start} to ${data.metadata.dateRange.end}</p>
                <p>Exported: ${new Date(data.metadata.exportDate).toLocaleString()}</p>
            </div>
            
            <div class="section">
                <h2>Summary</h2>
                <div class="summary-grid">
                    <div class="summary-card">
                        <h3>Total Runs</h3>
                        <p class="success" style="font-size: 24px; font-weight: bold;">${data.summary.totalRuns}</p>
                    </div>
                    <div class="summary-card">
                        <h3>Success Rate</h3>
                        <p class="success" style="font-size: 24px; font-weight: bold;">${data.summary.successRate}%</p>
                    </div>
                    <div class="summary-card">
                        <h3>Total Tests</h3>
                        <p style="font-size: 24px; font-weight: bold;">${data.summary.totalTests}</p>
                    </div>
                    <div class="summary-card">
                        <h3>Average Duration</h3>
                        <p style="font-size: 24px; font-weight: bold;">${data.summary.averageDuration}ms</p>
                    </div>
                </div>
            </div>
            
            <div class="section">
                <h2>Test Runs (Last 50)</h2>
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
                        </tr>
                    </thead>
                    <tbody>
                        ${data.testRuns.slice(0, 50).map(run => `
                            <tr>
                                <td>${run.id}</td>
                                <td>${new Date(run.timestamp).toLocaleString()}</td>
                                <td>${run.total_tests}</td>
                                <td class="success">${run.passed_tests}</td>
                                <td class="${run.failed_tests > 0 ? 'danger' : ''}">${run.failed_tests}</td>
                                <td class="${run.success_rate >= 90 ? 'success' : run.success_rate < 70 ? 'danger' : 'warning'}">
                                    ${run.success_rate || 0}%
                                </td>
                                <td>${run.duration_ms}ms</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
                ${data.testRuns.length > 50 ? `<p>... and ${data.testRuns.length - 50} more runs</p>` : ''}
            </div>
            
            <div class="footer">
                <p>Generated by Website Monitoring System</p>
                <p>To save as PDF: Print this page and choose "Save as PDF" as destination</p>
            </div>
        </body>
        </html>`;
    }

    formatMetricName(key) {
        return key
            .replace(/([A-Z])/g, ' $1')
            .replace(/^./, str => str.toUpperCase())
            .replace(/_/g, ' ');
    }

    // Quick Export (simple CSV of recent runs)
    async quickExport(req, res) {
        try {
            const limit = parseInt(req.query.limit) || 100;
            const runs = await DatabaseService.getRecentRuns(limit);
            
            // Simple CSV format
            const csvHeaders = ['ID', 'Timestamp', 'Total Tests', 'Passed', 'Failed', 'Success Rate', 'Duration (ms)'];
            const csvRows = runs.map(run => [
                run.id,
                run.timestamp,
                run.total_tests,
                run.passed_tests,
                run.failed_tests,
                `${run.success_rate || 0}%`,
                run.duration_ms
            ]);
            
            const csvContent = [
                csvHeaders.join(','),
                ...csvRows.map(row => row.join(','))
            ].join('\n');
            
            const filename = `quick-export-${new Date().toISOString().split('T')[0]}.csv`;
            
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.send(csvContent);
            
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    // Export available formats
    getExportFormats(req, res) {
        res.json({
            formats: [
                { id: 'json', name: 'JSON', description: 'Complete data in JSON format' },
                { id: 'csv', name: 'CSV', description: 'Test runs in CSV format' },
                { id: 'excel', name: 'Excel', description: 'Multi-sheet Excel workbook' },
                { id: 'pdf', name: 'HTML/PDF', description: 'Printable HTML report (save as PDF)' }
            ],
            defaultOptions: {
                startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                endDate: new Date().toISOString().split('T')[0],
                includeTests: false,
                includeIncidents: false
            }
        });
    }
}

module.exports = new ExportController();