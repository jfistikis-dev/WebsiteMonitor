const fs = require('fs');
const path = require('path');

class CleanupManager {
    constructor(config) {
        this.config = config;
        this.cleanupConfig = config.monitoring?.cleanup || {
            enabled: true,
            retentionDays: 180,
            deleteEmptyLogs: true,
            maxLogSizeMB: 100,
            runOnStartup: true
        };
        
        this.logger = null; // Will be set by the monitor
    }

    setLogger(logger) {
        this.logger = logger;
    }

    log(message, level = 'info') {
        if (this.logger) {
            this.logger[level](`[Cleanup] ${message}`);
        } else {
            console.log(`[Cleanup] ${message}`);
        }
    }

    async performCleanup() {
        if (!this.cleanupConfig.enabled) {
            this.log('Cleanup is disabled in config');
            return { success: true, disabled: true };
        }

        try {
            this.log('Starting cleanup process...');
            
            const results = {
                logs: { deleted: 0, errors: 0, totalSize: 0 },
                reports: { deleted: 0, errors: 0, totalSize: 0 },
                screenshots: { deleted: 0, errors: 0, totalSize: 0 },
                startTime: new Date(),
                endTime: null,
                totalFreed: 0
            };

            // Clean up different file types
            await this.cleanupLogs(results);
            await this.cleanupReports(results);
            await this.cleanupScreenshots(results);
            
            // Optional: Clean up empty directories
            if (this.cleanupConfig.deleteEmptyDirs) {
                await this.cleanupEmptyDirectories();
            }

            results.endTime = new Date();
            results.duration = results.endTime - results.startTime;
            results.totalFreed = results.logs.totalSize + results.reports.totalSize + results.screenshots.totalSize;

            this.log(`Cleanup completed in ${results.duration}ms`);
            this.log(`Deleted: ${results.logs.deleted} logs, ${results.reports.deleted} reports, ${results.screenshots.deleted} screenshots`);
            this.log(`Freed: ${this.formatBytes(results.totalFreed)}`);

            return {
                success: true,
                ...results
            };

        } catch (error) {
            this.log(`Cleanup failed: ${error.message}`, 'error');
            return {
                success: false,
                error: error.message,
                stack: error.stack
            };
        }
    }

    async cleanupLogs(results) {
        try {
            const logsDir = path.join(__dirname, '..', this.config.paths.logs);
            
            if (!fs.existsSync(logsDir)) {
                this.log(`Logs directory not found: ${logsDir}`);
                return;
            }

            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - this.cleanupConfig.retentionDays);

            const files = fs.readdirSync(logsDir);
            
            for (const file of files) {
                if (!file.endsWith('.log')) continue;

                const filePath = path.join(logsDir, file);
                await this.processFile(filePath, cutoffDate, 'logs', results);
            }

            // Check for oversized logs
            if (this.cleanupConfig.maxLogSizeMB) {
                await this.checkOversizedLogs(logsDir, results);
            }

        } catch (error) {
            this.log(`Error cleaning up logs: ${error.message}`, 'error');
            results.logs.errors++;
        }
    }

    async cleanupReports(results) {
        try {
            const reportsDir = path.join(__dirname, '..', this.config.paths.reports);
            
            if (!fs.existsSync(reportsDir)) {
                this.log(`Reports directory not found: ${reportsDir}`);
                return;
            }

            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - this.cleanupConfig.retentionDays);

            const files = fs.readdirSync(reportsDir);
            
            for (const file of files) {
                if (!(file.endsWith('.json') || file.endsWith('.html'))) continue;

                const filePath = path.join(reportsDir, file);
                await this.processFile(filePath, cutoffDate, 'reports', results);
            }

        } catch (error) {
            this.log(`Error cleaning up reports: ${error.message}`, 'error');
            results.reports.errors++;
        }
    }

    async cleanupScreenshots(results) {
        try {
            const screenshotsDir = path.join(__dirname, '..', this.config.paths.screenshots);
            
            if (!fs.existsSync(screenshotsDir)) {
                this.log(`Screenshots directory not found: ${screenshotsDir}`);
                return;
            }

            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - this.cleanupConfig.retentionDays);

            const files = fs.readdirSync(screenshotsDir);
            
            for (const file of files) {
                if (!(file.endsWith('.png') || file.endsWith('.jpg') || file.endsWith('.jpeg'))) continue;

                const filePath = path.join(screenshotsDir, file);
                await this.processFile(filePath, cutoffDate, 'screenshots', results);
            }

        } catch (error) {
            this.log(`Error cleaning up screenshots: ${error.message}`, 'error');
            results.screenshots.errors++;
        }
    }

    async processFile(filePath, cutoffDate, category, results) {
        try {
            const stats = fs.statSync(filePath);
            
            // Check if file is empty
            if (this.cleanupConfig.deleteEmptyLogs && stats.size === 0) {
                fs.unlinkSync(filePath);
                results[category].deleted++;
                this.log(`Deleted empty file: ${path.basename(filePath)}`);
                return;
            }

            // Check if file is older than retention period
            if (stats.mtime < cutoffDate) {
                const size = stats.size;
                fs.unlinkSync(filePath);
                
                results[category].deleted++;
                results[category].totalSize += size;
                
                const ageDays = Math.floor((new Date() - stats.mtime) / (1000 * 60 * 60 * 24));
                this.log(`Deleted old ${category} file (${ageDays}d): ${path.basename(filePath)} - ${this.formatBytes(size)}`);
            }

        } catch (error) {
            this.log(`Error processing file ${filePath}: ${error.message}`, 'error');
            results[category].errors++;
        }
    }

    async checkOversizedLogs(logsDir, results) {
        try {
            const maxSizeBytes = this.cleanupConfig.maxLogSizeMB * 1024 * 1024;
            const files = fs.readdirSync(logsDir);

            for (const file of files) {
                if (!file.endsWith('.log')) continue;

                const filePath = path.join(logsDir, file);
                const stats = fs.statSync(filePath);

                if (stats.size > maxSizeBytes) {
                    // Rotate log: rename with .old suffix
                    const newPath = `${filePath}.old`;
                    fs.renameSync(filePath, newPath);
                    
                    // Create new empty log file
                    fs.writeFileSync(filePath, '');
                    
                    results.logs.deleted++;
                    results.logs.totalSize += stats.size;
                    
                    this.log(`Rotated oversized log: ${file} (${this.formatBytes(stats.size)})`);
                }
            }
        } catch (error) {
            this.log(`Error checking oversized logs: ${error.message}`, 'error');
        }
    }

    async cleanupEmptyDirectories() {
        const directories = [
            path.join(__dirname, '..', this.config.paths.logs),
            path.join(__dirname, '..', this.config.paths.reports),
            path.join(__dirname, '..', this.config.paths.screenshots)
        ];

        for (const dir of directories) {
            if (fs.existsSync(dir)) {
                try {
                    const files = fs.readdirSync(dir);
                    if (files.length === 0) {
                        fs.rmdirSync(dir);
                        this.log(`Removed empty directory: ${path.basename(dir)}`);
                    }
                } catch (error) {
                    // Directory not empty or other error - ignore
                }
            }
        }
    }

    formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    async getDiskUsage() {
        try {
            const directories = [
                { name: 'logs', path: path.join(__dirname, '..', this.config.paths.logs) },
                { name: 'reports', path: path.join(__dirname, '..', this.config.paths.reports) },
                { name: 'screenshots', path: path.join(__dirname, '..', this.config.paths.screenshots) },
                { name: 'data', path: path.join(__dirname, '..', this.config.paths.data) }
            ];

            const usage = {
                total: 0,
                directories: {},
                oldFiles: 0
            };

            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - this.cleanupConfig.retentionDays);

            for (const dir of directories) {
                if (!fs.existsSync(dir.path)) {
                    usage.directories[dir.name] = { size: 0, files: 0, oldFiles: 0 };
                    continue;
                }

                const stats = await this.calculateDirectorySize(dir.path, cutoffDate);
                usage.directories[dir.name] = stats;
                usage.total += stats.size;
                usage.oldFiles += stats.oldFiles;
            }

            return usage;
        } catch (error) {
            this.log(`Error getting disk usage: ${error.message}`, 'error');
            return null;
        }
    }

    async calculateDirectorySize(dirPath, cutoffDate) {
        let totalSize = 0;
        let fileCount = 0;
        let oldFileCount = 0;

        const files = fs.readdirSync(dirPath);

        for (const file of files) {
            const filePath = path.join(dirPath, file);
            
            try {
                const stats = fs.statSync(filePath);
                
                if (stats.isFile()) {
                    totalSize += stats.size;
                    fileCount++;
                    
                    if (stats.mtime < cutoffDate) {
                        oldFileCount++;
                    }
                }
            } catch (error) {
                // Skip files we can't stat
            }
        }

        return {
            size: totalSize,
            formatted: this.formatBytes(totalSize),
            files: fileCount,
            oldFiles: oldFileCount
        };
    }
}

module.exports = CleanupManager;