const fs = require('fs');
const path = require('path');
const config = require('./config.json');

class Database {
    constructor() {
        this.db = null;
        this.dataDir = path.join(__dirname, config.paths.data);
        this.init();

    }

    init() {
        if (!fs.existsSync(this.dataDir)) {
            fs.mkdirSync(this.dataDir, { recursive: true });
        }

        // SQLite is perfect for Windows - no separate server needed
        if (config.database.type === 'sqlite') {
            const sqlite3 = require('sqlite3').verbose();
            const dbPath = path.join(__dirname, config.database.sqlite.path);
            this.db = new sqlite3.Database(dbPath);
            
            this.createTables();
        }
        // For MySQL/PostgreSQL (if needed)
    }

    createTables() {
        const queries = [
            `CREATE TABLE IF NOT EXISTS test_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                total_tests INTEGER,
                passed_tests INTEGER,
                failed_tests INTEGER,
                success_rate REAL,
                duration_ms INTEGER,
                triggered_by VARCHAR(50) DEFAULT 'scheduled'
            )`,
            
            `CREATE TABLE IF NOT EXISTS individual_tests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id INTEGER,
                test_name VARCHAR(100),
                test_category VARCHAR(50),
                status VARCHAR(10),
                critical BOOLEAN,
                details TEXT,
                duration_ms INTEGER,
                screenshot_path VARCHAR(255),
                error_message TEXT,
                FOREIGN KEY (run_id) REFERENCES test_runs(id) ON DELETE CASCADE
            )`,
            
            `CREATE TABLE IF NOT EXISTS incidents (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                test_name VARCHAR(100),
                start_time DATETIME,
                end_time DATETIME,
                status VARCHAR(20) DEFAULT 'open',
                resolved_by VARCHAR(100),
                resolution_notes TEXT
            )`,
            
            `CREATE TABLE IF NOT EXISTS uptime_stats (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date DATE,
                total_checks INTEGER DEFAULT 0,
                successful_checks INTEGER DEFAULT 0,
                uptime_percentage REAL DEFAULT 100.0,
                UNIQUE(date)
            )`,
            
            `CREATE INDEX IF NOT EXISTS idx_test_runs_timestamp ON test_runs(timestamp)`,
            `CREATE INDEX IF NOT EXISTS idx_individual_tests_run_id ON individual_tests(run_id)`,
            `CREATE INDEX IF NOT EXISTS idx_individual_tests_status ON individual_tests(status)`
        ];

        queries.forEach(query => {
            this.db.run(query, (err) => {
                if (err) console.error('Table creation error:', err);
            });
        });
    }

    saveTestRun(runData) {
        return new Promise((resolve, reject) => {
            const query = `
                INSERT INTO test_runs 
                (timestamp, total_tests, passed_tests, failed_tests, success_rate, duration_ms, triggered_by)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `;
            
            const values = [
                runData.timestamp || new Date().toISOString(),
                runData.summary.total,
                runData.summary.passed,
                runData.summary.failed,
                runData.summary.successRate,
                runData.duration || 0,
                runData.triggeredBy || 'scheduled'
            ];

            this.db.run(query, values, function(err) {
                if (err) {
                    reject(err);
                } else {
                    resolve(this.lastID);
                }
            });
        });
    }

    saveIndividualTest(runId, test) {
        return new Promise((resolve, reject) => {
            const query = `
                INSERT INTO individual_tests 
                (run_id, test_name, test_category, status, critical, details, duration_ms, screenshot_path, error_message)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
            
            const values = [
                runId,
                test.name,
                test.category || 'general',
                test.status,
                test.critical ? 1 : 0,
                test.details,
                test.duration || 0,
                test.screenshot || null,
                test.error || null
            ];

            this.db.run(query, values, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    async saveCompleteRun(testResults) {
        try {
            const runId = await this.saveTestRun(testResults);
            
            const promises = testResults.tests.map(test => 
                this.saveIndividualTest(runId, test)
            );
            
            await Promise.all(promises);
            
            // Update uptime statistics
            await this.updateUptimeStats(testResults.summary.passed > 0);
            
            // Check for incidents
            const failedCriticalTests = testResults.tests.filter(
                t => t.critical && t.status !== 'PASS'
            );
            
            if (failedCriticalTests.length > 0) {
                await this.createIncident(failedCriticalTests);
            }
            
            return runId;
        } catch (error) {
            console.error('Error saving test run:', error);
            throw error;
        }
    }

    updateUptimeStats(success) {
        return new Promise((resolve, reject) => {
            const today = new Date().toISOString().split('T')[0];
            
            this.db.run(`
                INSERT OR IGNORE INTO uptime_stats (date, total_checks, successful_checks, uptime_percentage)
                VALUES (?, 0, 0, 100.0)
            `, [today]);
            
            this.db.run(`
                UPDATE uptime_stats 
                SET total_checks = total_checks + 1,
                    successful_checks = successful_checks + ?
                WHERE date = ?
            `, [success ? 1 : 0, today], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    createIncident(failedTests) {
        return new Promise((resolve, reject) => {
            const query = `
                INSERT INTO incidents (test_name, start_time, status)
                VALUES (?, ?, 'open')
            `;
            
            failedTests.forEach(test => {
                this.db.run(query, [test.name, new Date().toISOString()], (err) => {
                    if (err) console.error('Error creating incident:', err);
                });
            });
            
            resolve();
        });
    }

    // Dashboard Query Methods
    getRecentRuns(limit = 50) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT * FROM test_runs 
                ORDER BY timestamp DESC 
                LIMIT ?
            `;
            
            this.db.all(query, [limit], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    async getIncidents(status = 'open') {
        return new Promise((resolve, reject) => {
            let query = `SELECT * FROM incidents`;
            let params = [];
            
            if (status) {
                query += ` WHERE status = ?`;
                params.push(status);
            }
            
            query += ` ORDER BY start_time DESC`;
            
            this.db.all(query, params, (err, rows) => {
                if (err) {
                    console.error('getIncidents error:', err.message);
                    resolve([]); // Return empty array instead of failing
                } else {
                    resolve(rows || []);
                }
            });
        });
    }

    async resolveIncident(incidentId, resolvedBy, notes) {
        return new Promise((resolve, reject) => {
            const query = `
                UPDATE incidents 
                SET status = 'resolved', 
                    end_time = ?,
                    resolved_by = ?,
                    resolution_notes = ?
                WHERE id = ?
            `;
            
            const params = [
                new Date().toISOString(),
                resolvedBy || 'System',
                notes || 'Resolved via dashboard',
                incidentId
            ];
            
            this.db.run(query, params, function(err) {
                if (err) {
                    console.error('resolveIncident error:', err.message);
                    reject(err);
                } else {
                    resolve(this.changes > 0); // Returns true if incident was found and updated
                }
            });
        });
    }

    getRunDetails(runId) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT r.*, 
                       GROUP_CONCAT(i.test_name || '|' || i.status || '|' || i.details, ';;') as tests
                FROM test_runs r
                LEFT JOIN individual_tests i ON r.id = i.run_id
                WHERE r.id = ?
                GROUP BY r.id
            `;
            
            this.db.get(query, [runId], (err, row) => {
                if (err) reject(err);
                else resolve(this.parseRunDetails(row));
            });
        });
    }

    parseRunDetails(row) {
        if (!row || !row.tests) return row;
        
        row.tests = row.tests.split(';;').map(testStr => {
            const [name, status, details] = testStr.split('|');
            return { name, status, details };
        });
        
        return row;
    }

    getUptimeStats(days = 30) {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT date, total_checks, successful_checks,
                       ROUND((successful_checks * 100.0 / total_checks), 2) as uptime_percentage
                FROM uptime_stats 
                WHERE date >= date('now', ?)
                ORDER BY date DESC
            `;
            
            this.db.all(query, [`-${days} days`], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    getCurrentStatus() {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT 
                    (SELECT COUNT(*) FROM test_runs WHERE DATE(timestamp) = DATE('now')) as today_runs,
                    (SELECT COUNT(*) FROM incidents WHERE status = 'open') as open_incidents,
                    (SELECT success_rate FROM test_runs ORDER BY timestamp DESC LIMIT 1) as last_success_rate,
                    (SELECT AVG(success_rate) FROM test_runs WHERE timestamp >= strftime('%s','now','-7 day')) as weekly_avg
            `;
            
            this.db.get(query, [], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    }

    searchTestRuns(filters) {
        return new Promise((resolve, reject) => {
            let query = `SELECT * FROM test_runs WHERE 1=1`;
            const params = [];
            
            if (filters.startDate) {
                query += ` AND timestamp >= ?`;
                params.push(filters.startDate);
            }
            
            if (filters.endDate) {
                query += ` AND timestamp <= ?`;
                params.push(filters.endDate);
            }
            
            if (filters.minSuccessRate) {
                query += ` AND success_rate >= ?`;
                params.push(filters.minSuccessRate);
            }
            
            query += ` ORDER BY timestamp DESC LIMIT 100`;
            
            this.db.all(query, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    // Get database size
    async getDatabaseSize() {
        return new Promise((resolve, reject) => {
            try {
                if (config.database.type === 'sqlite') {
                    
                    // Get the database file path
                    const dbPath = path.join(__dirname, config.database.sqlite.path);
                    
                    // Check if file exists
                    if (!fs.existsSync(dbPath)) {
                        resolve({
                            sizeBytes: 0,
                            sizeFormatted: '0 Bytes',
                            fileExists: false,
                            path: dbPath
                        });
                        return;
                    }
                    
                    // Get file stats
                    const stats = fs.statSync(dbPath);
                    const sizeBytes = stats.size;
                    
                    // Format the size
                    const sizeFormatted = this.formatBytes(sizeBytes);
                    
                    // Get additional info
                    const creationTime = stats.birthtime;
                    const modifiedTime = stats.mtime;
                    
                    resolve({
                        sizeBytes: sizeBytes,
                        sizeFormatted: sizeFormatted,
                        fileExists: true,
                        path: dbPath,
                        created: creationTime.toISOString(),
                        modified: modifiedTime.toISOString(),
                        tablesCount: 0, // We'll populate this later
                        recordsCount: 0  // We'll populate this later
                    });
                } else {
                    // For other database types (MySQL, PostgreSQL)
                    resolve({
                        sizeBytes: 0,
                        sizeFormatted: 'Unknown',
                        fileExists: false,
                        databaseType: this.config.database.type,
                        message: 'Size calculation not implemented for this database type'
                    });
                }
            } catch (error) {
                console.error('getDatabaseSize error:', error.message);
                reject(error);
            }
        });
    }

    // Helper method to format bytes
    formatBytes(bytes, decimals = 2) {
        if (bytes === 0) return '0 Bytes';
        
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
        
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }

    // Optional: Add method to get table statistics
    async getDatabaseStatistics() {
        try {
            const sizeInfo = await this.getDatabaseSize();
            
            // Get table counts if database exists
            if (sizeInfo.fileExists) {
                const tableStats = await this.getTableStatistics();
                return {
                    ...sizeInfo,
                    ...tableStats
                };
            }
            
            return sizeInfo;
            
        } catch (error) {
            console.error('getDatabaseStatistics error:', error.message);
            return {
                sizeBytes: 0,
                sizeFormatted: 'Error',
                error: error.message
            };
        }
    }

    // Get detailed table statistics
    async getTableStatistics() {
        return new Promise((resolve, reject) => {
            const queries = [
                // Count records in each table
                `SELECT 'test_runs' as table_name, COUNT(*) as record_count FROM test_runs`,
                `SELECT 'individual_tests' as table_name, COUNT(*) as record_count FROM individual_tests`,
                `SELECT 'incidents' as table_name, COUNT(*) as record_count FROM incidents`,
                `SELECT 'uptime_stats' as table_name, COUNT(*) as record_count FROM uptime_stats`,
                
                // Get oldest and newest records
                `SELECT MIN(timestamp) as first_record, MAX(timestamp) as last_record FROM test_runs`
            ];
            
            const results = {
                tables: [],
                totalRecords: 0,
                firstRecord: null,
                lastRecord: null
            };
            
            let completed = 0;
            let errors = 0;
            
            queries.forEach((query, index) => {
                this.db.get(query, [], (err, row) => {
                    if (err) {
                        console.error(`Query ${index} error:`, err.message);
                        errors++;
                    } else if (row) {
                        if (row.table_name) {
                            // This is a table count query
                            results.tables.push({
                                name: row.table_name,
                                records: row.record_count || 0
                            });
                            results.totalRecords += (row.record_count || 0);
                        } else {
                            // This is the timestamp query
                            results.firstRecord = row.first_record;
                            results.lastRecord = row.last_record;
                        }
                    }
                    
                    completed++;
                    
                    if (completed === queries.length) {
                        if (errors === queries.length) {
                            // All queries failed - database might be empty or tables don't exist
                            resolve({
                                tables: [],
                                totalRecords: 0,
                                firstRecord: null,
                                lastRecord: null,
                                message: 'Database tables may not exist yet'
                            });
                        } else {
                            resolve(results);
                        }
                    }
                });
            });
        });
    }

    close() {
        if (this.db) {
            this.db.close();
        }
    }
}

module.exports = Database;