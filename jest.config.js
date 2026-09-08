/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  // Default testMatch already picks up **/*.test.ts, which is every test
  // file in this repo — no rename from the earlier tsx/node:test scaffold
  // was needed for the Jest migration. testPathIgnorePatterns must add
  // "dist" explicitly: Jest's own default only excludes node_modules, so
  // after `npm run build` compiles *.test.ts to dist/**/*.test.js, Jest
  // would otherwise run every test twice (once from src, once from the
  // compiled dist copy) — caught by an unexpectedly-doubled test count.
  testPathIgnorePatterns: ["/node_modules/", "/dist/"],
};
