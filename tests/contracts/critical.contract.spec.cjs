const path = require("node:path");

require(path.join(__dirname, "../e2e/donate-checkout.spec.ts"));
require(path.join(__dirname, "../e2e/billing-webhook.spec.ts"));
require(path.join(__dirname, "../e2e/events-page.spec.ts"));
require(path.join(__dirname, "../e2e/map-filters.spec.ts"));
require(path.join(__dirname, "../e2e/search-page.spec.ts"));
