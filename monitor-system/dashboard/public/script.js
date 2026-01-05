// Global variables
let uptimeChart = null;
let autoRefreshInterval = null;

// Initialize dashboard
document.addEventListener('DOMContentLoaded', function() {
    initializeDashboard();
    loadAllData();
    
    // Auto-refresh every 30 seconds
    autoRefreshInterval = setInterval(loadAllData, 30000);
});

function initializeDashboard() {
    // Initialize uptime chart
    const ctx = document.getElementById('uptimeChart').getContext('2d');
    uptimeChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'Uptime %',
                data: [],
                borderColor: '#2ecc71',
                backgroundColor: 'rgba(46, 204, 113, 0.1)',
                borderWidth: 2,
                fill: true,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    max: 100,
                    ticks: {
                        callback: function(value) {
                            return value + '%';
                        }
                    }
                }
            }
        }
    });
}

async function loadAllData() {
    try {
        await Promise.all([
            loadSystemStatus(),
            loadRecentRuns(),
            loadUptimeStats(),
            loadIncidents(),
            loadDatabaseInfo(),
            nextRunTime(),
        ]);
        
        updateLastUpdateTime();
    } catch (error) {
        console.error('Error loading data:', error);
        showError('Failed to load dashboard data');
    }
}

async function loadSystemStatus() {
    try {
        const response = await fetch('/api/status');
        const data = await response.json();

        //document.getElementById('uptime-trend').textContent = "✅ Uptime :: " + data.server.uptimeFormatted;
        document.getElementById('dashboard-uptime').textContent =  data.server.uptimeFormatted;

        // Update stats cards
        document.getElementById('current-uptime').textContent = 
            data.last_success_rate ? `${data.last_success_rate.toFixed(1)}%` : '--%';
        
        document.getElementById('open-incidents').textContent = data.open_incidents || 0;
        document.getElementById('today-runs').textContent = data.today_runs || 0;
        document.getElementById('weekly-average').textContent = 
            data.weekly_avg ? `${data.weekly_avg.toFixed(1)}%` : '--%';
        
        // Update system status badge
        const statusBadge = document.getElementById('system-status');
        if (data.open_incidents > 0) {
            statusBadge.textContent = 'Degraded';
            statusBadge.className = 'status-badge degraded';
        } else if (data.last_success_rate >= 95) {
            statusBadge.textContent = 'Operational';
            statusBadge.className = 'status-badge operational';
        } else {
            statusBadge.textContent = 'Issues';
            statusBadge.className = 'status-badge warning';
        }
        
        // Update incident details
        const incidentDetails = document.getElementById('incident-details');
        if (data.open_incidents > 0) {
            incidentDetails.textContent = `${data.open_incidents} critical issue(s)`;
            incidentDetails.style.color = '#e74c3c';
        } else {
            incidentDetails.textContent = 'No critical issues';
            incidentDetails.style.color = '#2ecc71';
        }
        
    } catch (error) {
        console.error('Error loading system status:', error);
    }
}

async function loadRecentRuns() {
    try {
        const response = await fetch('/api/recent-runs?limit=10');
        const runs = await response.json();
        
        const tbody = document.querySelector('#recent-runs-table tbody');
        tbody.innerHTML = '';
        
        runs.forEach(run => {
            const row = document.createElement('tr');
            const time = new Date(run.timestamp).toLocaleString();
            const successRate = run.success_rate ? run.success_rate.toFixed(1) : '0.0';
            
            row.innerHTML = `
                <td>${time}</td>
                <td>${run.total_tests}</td>
                <td><span class="status-pass">${run.passed_tests}</span></td>
                <td><span class="status-fail">${run.failed_tests}</span></td>
                <td>${successRate}%</td>
                <td>
                    <button class="btn-view-details" onclick="viewRunDetails(${run.id})">
                        <i class="fas fa-eye"></i> Details
                    </button>
                </td>
            `;
            
            tbody.appendChild(row);
        });
        
    } catch (error) {
        console.error('Error loading recent runs:', error);
    }
}

async function nextRunTime () {
    const response = await fetch('/api/next-runtime');
    const nextRuntime = await response.json();
    document.getElementById('today-runs').textContent = nextRuntime.remaining.label;
    document.getElementById('last-run-time').textContent = `Every ${nextRuntime.interval.label}`;
}




async function loadUptimeStats() {
    try {
        const period = document.getElementById('uptime-period').value;
        const response = await fetch(`/api/uptime?days=${period}`);
        const stats = await response.json();
        
        // Update chart
        const labels = stats.map(stat => {
            const date = new Date(stat.date);
            return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        }).reverse();
        
        const data = stats.map(stat => stat.uptime_percentage).reverse();
        
        uptimeChart.data.labels = labels;
        uptimeChart.data.datasets[0].data = data;
        uptimeChart.update();
        
    } catch (error) {
        console.error('Error loading uptime stats:', error);
    }
}

async function loadIncidents() {
    try {
        const response = await fetch('/api/incidents');
        const incidents = await response.json();
        
        const container = document.getElementById('incidents-list');
        
        if (incidents.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-check-circle success"></i>
                    <p>No active incidents</p>
                </div>
            `;
            return;
        }
        
        container.innerHTML = incidents.map(incident => `
            <div class="incident-item">
                <div class="incident-header">
                    <strong>${incident.test_name}</strong>
                    <span class="incident-time">
                        Started: ${new Date(incident.start_time).toLocaleString()}
                    </span>
                </div>
                <div class="incident-actions">
                    <button class="btn-resolve" onclick="resolveIncident(${incident.id})">
                        Mark Resolved
                    </button>
                </div>
            </div>
        `).join('');
        
    } catch (error) {
        console.error('Error loading incidents:', error);
    }
}

async function viewRunDetails(runId) {
    try {
        const response = await fetch(`/api/run/${runId}`);
        const run = await response.json();
        
        const modalContent = document.getElementById('run-details-content');
        
        let testsHtml = '';
        if (run.tests && run.tests.length > 0) {
            testsHtml = run.tests.map(test => `
                <div class="test-detail ${test.status === 'PASS' ? 'pass' : 'fail'}">
                    <h4>${test.name} - ${test.status}</h4>
                    <p>${test.details}</p>
                    ${test.duration ? `<small>Duration: ${test.duration}ms</small>` : ''}
                </div>
            `).join('');
        }
        
        modalContent.innerHTML = `
            <div class="run-summary">
                <h3>Run Summary</h3>
                <p><strong>Time:</strong> ${new Date(run.timestamp).toLocaleString()}</p>
                <p><strong>Total Tests:</strong> ${run.total_tests}</p>
                <p><strong>Passed:</strong> ${run.passed_tests}</p>
                <p><strong>Failed:</strong> ${run.failed_tests}</p>
                <p><strong>Success Rate:</strong> ${run.success_rate ? run.success_rate.toFixed(1) + '%' : 'N/A'}</p>
            </div>
            
            <div class="tests-list">
                <h3>Individual Tests</h3>
                ${testsHtml || '<p>No test details available</p>'}
            </div>
        `;
        
        document.getElementById('run-details-modal').style.display = 'block';
        
    } catch (error) {
        console.error('Error loading run details:', error);
        showError('Failed to load run details');
    }
}

async function resolveIncident(incidentId) {
    const resolvedBy = prompt('Enter your name (for resolution notes):');
    if (!resolvedBy) return;
    
    const notes = prompt('Enter resolution notes:');
    
    try {
        const response = await fetch(`/api/incidents/${incidentId}/resolve`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                resolvedBy,
                notes
            })
        });
        
        if (response.ok) {
            showSuccess('Incident resolved successfully');
            loadIncidents();
            loadSystemStatus();
        } else {
            showError('Failed to resolve incident');
        }
    } catch (error) {
        console.error('Error resolving incident:', error);
        showError('Failed to resolve incident');
    }
}

// Enhanced manual test with progress tracking
async function runEnhancedManualTest() {
    if (confirm('Run enhanced manual test with progress tracking?')) {
        
        try {

            // Update monitoring state
            document.getElementById('monitoring-state').textContent = 'Running...'; 
            
            const response  = await fetch('/api/run-manual-test-enhanced', {method: 'POST' });
            const result    = await response.json();
            
            if (result.success) {
                
                showSuccess(result.message);
                
                // Open progress modal
                openProgressModal(result.testId);
                
                // Start polling for progress
                pollTestProgress(result.testId);
                
            } else {
                showError(`Failed to start enhanced test: ${result.error}`);
            }
            
            
        } catch (error) {
            console.error('Enhanced test error:', error);
            showError('Failed to start enhanced test');
            
        }
        
    }
}

// Progress modal functions
function openProgressModal(testId) {
    // Create or show progress modal
    let modal = document.getElementById('progress-modal');
    
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'progress-modal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h2>Test Progress</h2>
                    <span class="close-modal" onclick="closeProgressModal()">&times;</span>
                </div>
                <div class="modal-body">
                    <div class="progress-container">
                        <div class="progress-bar">
                            <div class="progress-fill" id="progress-fill" style="width: 0%"></div>
                        </div>
                        <div class="progress-text">
                            <span id="progress-percent">0%</span>
                            <span id="progress-status">Starting...</span>
                        </div>
                        <div class="test-details">
                            <p><strong>Test ID:</strong> <span id="progress-test-id">${testId}</span></p>
                            <p><strong>Current Test:</strong> <span id="progress-current-test">--</span></p>
                            <p><strong>Estimated Time:</strong> <span id="progress-estimated-time">--</span></p>
                        </div>
                        <div class="progress-actions">
                            <button class="btn-cancel" onclick="cancelTest('${testId}')">
                                <i class="fas fa-stop-circle"></i> Cancel Test
                            </button>
                            <button class="btn-close" onclick="closeProgressModal()">
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }
    
    modal.style.display = 'block';
    document.getElementById('progress-test-id').textContent = testId;
}

function closeProgressModal() {
    const modal = document.getElementById('progress-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

async function pollTestProgress(testId) {
   
    const interval = setInterval(async () => {
        try {
            const response = await fetch(`/api/test-progress/${testId}`);
            const progress = await response.json();
            
            if (!progress.success) {
                clearInterval(interval);
                showError('Test progress not found');
                return;
            }
           
            // Update UI
            const percent = progress.progress || 0;
            document.getElementById('progress-fill').style.width = `${percent}%`;
            document.getElementById('progress-percent').textContent = `${percent}%`;
            document.getElementById('progress-status').textContent = progress.status;
            document.getElementById('progress-current-test').textContent = progress.currentTest || '--';
            
            // Update estimated time
            if (progress.estimatedTimeRemaining) {
                const seconds = Math.round(progress.estimatedTimeRemaining / 1000);
                document.getElementById('progress-estimated-time').textContent = 
                    seconds > 0 ? `${seconds} seconds remaining` : 'Almost done';
            }
            
            // If test completed, stop polling and refresh data
            if (progress.status === 'completed' || progress.status === 'failed' || progress.status === 'cancelled') {
                clearInterval(interval);
                
                if (progress.status === 'completed') {
                    
                    showSuccess('Test completed successfully!');
                    setTimeout(() => { loadAllData(); }, 2000); // Refresh dashboard data

                } else if (progress.status === 'failed') {
                    showError(`Test failed: ${progress.error}`);
                } else if (progress.status === 'cancelled') {
                    showWarning('Test was cancelled');
                }
                
                // Auto-close modal after 2 seconds
                setTimeout(() => {
                    document.getElementById('monitoring-state').textContent = 'Idle'; 
                    closeProgressModal();
                }, 2000);
            }
            
            
        } catch (error) {
            console.error('Error polling progress:', error);
            clearInterval(interval);
        }
    }, 1000); // Poll every second
}

async function cancelTest(testId) {
    if (confirm('Are you sure you want to cancel this test?')) {
        try {
            const response = await fetch(`/api/cancel-test/${testId}`, {
                method: 'POST'
            });
            
            const result = await response.json();
            
            if (result.success) {
                showWarning('Test cancellation requested');
            } else {
                showError(`Failed to cancel test: ${result.message}`);
            }
            
        } catch (error) {
            showError('Failed to cancel test');
        }
    }
}


// Add function to load database info
async function loadDatabaseInfo() {
    try {
        const response = await fetch('/api/database-info');
        const dbInfo = await response.json();

        // Update total runs
        let result = dbInfo.tables.find(table => table.name === "test_runs");
        const recordsValue = result ? result.records : null;
        document.getElementById('total-runs').textContent = recordsValue;

        // Update database size
        const dbSizeElement = document.getElementById('db-size');
        if (dbSizeElement && dbInfo.sizeFormatted) {
            dbSizeElement.textContent = dbInfo.sizeFormatted;
            dbSizeElement.title = `${dbInfo.sizeBytes} bytes | Created: ${new Date(dbInfo.created).toLocaleString()}`;
        }
        
        // Update total records
        const totalRecordsElement = document.getElementById('total-records');
        if (totalRecordsElement && dbInfo.totalRecords !== undefined) {
            totalRecordsElement.textContent = dbInfo.totalRecords.toLocaleString();
        }
        
        // Optional: Show table breakdown
        if (dbInfo.tables && dbInfo.tables.length > 0) {
            console.log('Table statistics:', dbInfo.tables);
        }
        
    } catch (error) {
        console.error('Failed to load database info:', error);
        document.getElementById('db-size').textContent = 'Error';
        document.getElementById('total-records').textContent = '--';
    }
}

async function exportData() {
    // Show export dialog
    const exportDialog = `
        <div class="export-dialog" style="
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0,0,0,0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1000;
        ">
            <div style="
                background: white;
                padding: 30px;
                border-radius: 8px;
                width: 400px;
                max-width: 90%;
                box-shadow: 0 4px 20px rgba(0,0,0,0.2);
            ">
                <h3 style="margin-top: 0; color: #333;">Export Monitoring Data</h3>
                
                <div style="margin-bottom: 15px;">
                    <label style="display: block; margin-bottom: 5px; font-weight: 600;">Start Date:</label>
                    <input type="date" id="export-start" style="
                        width: 100%;
                        padding: 8px;
                        border: 1px solid #ddd;
                        border-radius: 4px;
                    " value="${new Date(new Date().setDate(new Date().getDate() - 30)).toISOString().split('T')[0]}">
                </div>
                
                <div style="margin-bottom: 15px;">
                    <label style="display: block; margin-bottom: 5px; font-weight: 600;">End Date:</label>
                    <input type="date" id="export-end" style="
                        width: 100%;
                        padding: 8px;
                        border: 1px solid #ddd;
                        border-radius: 4px;
                    " value="${new Date().toISOString().split('T')[0]}">
                </div>
                
                <div style="margin-bottom: 15px;">
                    <label style="display: block; margin-bottom: 5px; font-weight: 600;">Format:</label>
                    <select id="export-format" style="
                        width: 100%;
                        padding: 8px;
                        border: 1px solid #ddd;
                        border-radius: 4px;
                    ">
                        <option value="excel">Excel file</option>
                        <option value="pdf">PDF file</option>
                        <option value="csv">CSV (Excel compatible)</option>
                        <option value="json">JSON (Complete data)</option>
                    </select>
                </div>
                
                <div style="
                    display: flex;
                    justify-content: space-between;
                    margin-top: 25px;
                    gap: 10px;
                ">
                    <button onclick="closeExportDialog()" style="
                        padding: 10px 20px;
                        background: #6c757d;
                        color: white;
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                        flex: 1;
                    ">Cancel</button>
                    
                    <button onclick="submitExport()" style="
                        padding: 10px 20px;
                        background: #28a745;
                        color: white;
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                        flex: 1;
                    ">Export</button>
                </div>
            </div>
        </div>
    `;
    
    // Remove existing dialog if any
    const existingDialog = document.querySelector('.export-dialog');
    if (existingDialog) {
        existingDialog.remove();
    }
    
    // Add new dialog
    document.body.insertAdjacentHTML('beforeend', exportDialog);
}

function closeExportDialog() {
    const dialog = document.querySelector('.export-dialog');
    if (dialog) {
        dialog.remove();
    }
}

function submitExport() {
    const startDate = document.getElementById('export-start').value;
    const endDate = document.getElementById('export-end').value;
    const format = document.getElementById('export-format').value;
    
    if (!startDate || !endDate) {
        alert('Please select both start and end dates');
        return;
    }
    
    // Build export URL
    const params = new URLSearchParams({
        startDate,
        endDate,
        format
    });
    
    const url = `/api/export?${params.toString()}`;
    
    
    // Show loading message
    const loadingMsg = document.createElement('div');
    loadingMsg.innerHTML = `
        <div style="
            position: fixed;
            top: 20px;
            right: 20px;
            background: #17a2b8;
            color: white;
            padding: 15px 20px;
            border-radius: 5px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 1001;
            display: flex;
            align-items: center;
            gap: 10px;
        ">
            <div class="spinner" style="
                width: 20px;
                height: 20px;
                border: 2px solid rgba(255,255,255,0.3);
                border-top-color: white;
                border-radius: 50%;
                animation: spin 1s linear infinite;
            "></div>
            <span>Preparing export...</span>
        </div>
    `;
    document.body.appendChild(loadingMsg);
    
    // Add spinner animation
    const style = document.createElement('style');
    style.textContent = `
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
    `;
    document.head.appendChild(style);
    
    // Open export in new tab (triggers download)
    const exportWindow = window.open(url, '_blank');
    
    // Close dialog
    closeExportDialog();
    
    // Remove loading message after 3 seconds
    setTimeout(() => {
        if (loadingMsg.parentNode) {
            loadingMsg.remove();
        }
        style.remove();
        
        // Show success message if window opened successfully
        if (exportWindow) {
            showSuccess('Export started. Check your downloads.');
        }
    }, 3000);
}

// Quick export function
function quickExport() {
    const url = '/api/export/quick?limit=1000';
    window.open(url, '_blank');
    showSuccess('Quick export started. Check your downloads.');
}

// Update your export button (if it exists)
const exportButton = document.querySelector('.action-btn.success');
if (exportButton && exportButton.textContent.includes('Export')) {
    exportButton.onclick = exportData;
}

// Helper function to show success messages
function showSuccess(message) {
    // Create notification element
    const notification = document.createElement('div');
    notification.innerHTML = `
        <div style="
            position: fixed;
            top: 20px;
            right: 20px;
            background: #28a745;
            color: white;
            padding: 15px 20px;
            border-radius: 5px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 1001;
            display: flex;
            align-items: center;
            gap: 10px;
            animation: slideIn 0.3s ease;
        ">
            <i class="fas fa-check-circle" style="font-size: 18px;"></i>
            <span>${message}</span>
        </div>
    `;
    
    // Add animation
    const style = document.createElement('style');
    style.textContent = `
        @keyframes slideIn {
            from {
                transform: translateX(100%);
                opacity: 0;
            }
            to {
                transform: translateX(0);
                opacity: 1;
            }
        }
    `;
    document.head.appendChild(style);
    
    document.body.appendChild(notification);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
        if (notification.parentNode) {
            notification.remove();
        }
        style.remove();
    }, 5000);
}


function viewLogs() {
    // Open logs directory or display logs
    window.open('/api/logs', '_blank');
}

function refreshAll() {
    clearInterval(autoRefreshInterval);
    loadAllData();
    autoRefreshInterval = setInterval(loadAllData, 30000);
    showSuccess('Refreshing all data...');
}

function updateLastUpdateTime() {
    const now = new Date();
    document.getElementById('last-update').innerHTML = `
        <i class="fas fa-sync"></i> Updated: ${now.toLocaleTimeString()}
    `;
}

function closeModal() {
    document.getElementById('run-details-modal').style.display = 'none';
}

function showSuccess(message) {
    alert('✅ ' + message); // You could replace with a nicer toast notification
}

function showError(message) {
    alert('❌ ' + message); // You could replace with a nicer toast notification
}

// Close modal when clicking outside
window.onclick = function(event) {
    const modal = document.getElementById('run-details-modal');
    if (event.target == modal) {
        modal.style.display = 'none';
    }
}

// Period selector change
document.getElementById('uptime-period').addEventListener('change', loadUptimeStats);

