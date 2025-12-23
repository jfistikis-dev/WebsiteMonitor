// Test registry - central place to register all tests
const AvailabilityTest = require('./availability.test');
const AuthPlatformTest = require('./AuthPlatform.test');
const AuthEshopTest = require('./AuthEshop.test');
/*const AuthenticationTest = require('../development/authentication.test');
const PasswordResetTest = require('../development/password-reset.test');
const PerformanceTest = require('../development/performance.test');
const ApiTest = require('./api.test');
const SecurityTest = require('./security.test');*/

class TestRegistry {
    constructor() {
        this.tests = [];
    }

    // Register a test class
    register(testClass, options = {}) {
        this.tests.push({
            class: testClass,
            enabled: options.enabled !== false,
            order: options.order || 999
        });
    }

    // Get all enabled tests in order
    getTests(config, logger) {
        // Filter enabled tests and sort by order
        return this.tests
            .filter(t => t.enabled)
            .sort((a, b) => a.order - b.order)
            .map(t => new t.class(config, logger));
    }

    // Get test by name
    getTest(name) {
        const testInfo = this.tests.find(t => t.class.name === name);
        return testInfo ? testInfo.class : null;
    }
}

// Create and configure registry
const registry = new TestRegistry();


// Register all tests with their execution order
registry.register(AvailabilityTest, { 
    enabled: true, 
    order: 10,
    description: 'Checks if website is accessible'
});

registry.register(AuthPlatformTest, { 
    enabled: true, 
    order: 20,
    description: 'Checks authentication on platform'
});

registry.register(AuthEshopTest, { 
    enabled: true, 
    order: 30,
    description: 'Checks authentication on platform'
});


/*
registry.register(AuthenticationTest, { 
    enabled: true, 
    order: 20,
    description: 'Tests user login functionality'
});

registry.register(PasswordResetTest, { 
    enabled: true, 
    order: 30,
    description: 'Tests password reset flow'
});

registry.register(PerformanceTest, { 
    enabled: false,  // Disabled by default
    order: 40,
    description: 'Measures page load performance'
});

registry.register(ApiTest, { 
    enabled: false,  // Disabled by default
    order: 50,
    description: 'Tests API endpoints'
});

registry.register(SecurityTest, { 
    enabled: false,  // Disabled by default
    order: 60,
    description: 'Security checks (SSL, headers)'
}); */

module.exports = registry;