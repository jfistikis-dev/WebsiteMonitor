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

function exportData() {
    const startDate = prompt('Enter start date (YYYY-MM-DD):', 
        new Date(new Date().setDate(new Date().getDate() - 30)).toISOString().split('T')[0]);
    if (!startDate) return;
    
    const endDate = prompt('Enter end date (YYYY-MM-DD):', 
        new Date().toISOString().split('T')[0]);
    if (!endDate) return;
    
    // Create download link for filtered data
    const url = `/api/export?start=${startDate}&end=${endDate}`;
    window.open(url, '_blank');
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

