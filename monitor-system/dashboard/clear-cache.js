// Clear all module caches
Object.keys(require.cache).forEach(function(key) {
    delete require.cache[key];
});

console.log('✅ All module caches cleared');
console.log('Now restart your dashboard with: node dashboard/server.js');