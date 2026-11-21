'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const code = fs.readFileSync(path.join(__dirname, '../assets/js/submissions.js'), 'utf8');
test('submission conversion has no multi-request fallback when RPC fails', () => {
  const conversion = code.slice(code.indexOf('function openApproval('), code.indexOf('async function reject('));
  assert.match(conversion, /NC\.api\.rpc\('approve_submission'/);
  assert.doesNotMatch(conversion, /fallbackApproval|NC\.api\.(insert|update)\(/);
});
