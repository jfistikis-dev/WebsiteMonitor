console.log('Testing Database Methods Directly...\n');

const Database = require('./database');
const db = new Database();

console.log('Testing individual methods:\n');

// Test getRecentRuns
console.log('1. Testing getRecentRuns():');
try {
    const runs = db.getRecentRuns(5);
    console.log(`   ✅ Works! Returns: ${Array.isArray(runs) ? `array with ${runs.length} items` : typeof runs}`);
    if (Array.isArray(runs) && runs.length > 0) {
        console.log(`   First run:`, JSON.stringify(runs[0], null, 2));
    }
} catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
}

// Test getCurrentStatus
console.log('\n2. Testing getCurrentStatus():');
try {
    const status =  db.getCurrentStatus();
    console.log(`   ✅ Works! Returns:`, typeof status);
    console.log(`   Status data:`, JSON.stringify(status, null, 2));
} catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
}

// Test getUptimeStats
console.log('\n3. Testing getUptimeStats():');
try {
    const stats =  db.getUptimeStats(7);
    console.log(`   ✅ Works! Returns: ${Array.isArray(stats) ? `array with ${stats.length} items` : typeof stats}`);
} catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
}

// Test getRunDetails (if you have at least one run)
console.log('\n4. Testing getRunDetails(1):');
try {
    const run =  db.getRunDetails(1);
    console.log(`   ✅ Works! Returns:`, run ? 'run object' : 'null (no run with ID 1)');
} catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
}

console.log('\n🎯 All database method tests completed!');