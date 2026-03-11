const path = require("node:path");

require(path.join(__dirname, "../e2e/admin-analytics-api.spec.ts"));
require(path.join(__dirname, "../e2e/admin-analytics-search-quality-api.spec.ts"));
require(path.join(__dirname, "../e2e/admin-analytics-map-summary-api.spec.ts"));
require(path.join(__dirname, "../e2e/admin-analytics-guest-sync-api.spec.ts"));
