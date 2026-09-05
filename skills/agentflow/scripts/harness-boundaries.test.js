'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const model_sensitive_harness = require('./model-sensitive-harness.js')
const model_stable_harness = require('./model-stable-harness.js')
const { lint_round } = require('./round-linter.js')

const expected_check_order = [
  'terminal_one_line',
  'timestamps_sane',
  'reply_structure',
  'round_boundaries',
  'next_ask_scaffold',
  'tracker',
  'checkpoint_still_to_do',
  'checkpoint_verification',
  'round_reporting',
  'direct_route_completion',
  'evidence_classification',
  'material_claims',
  'report_only_validation',
  'route_decision',
  'executor_decision',
  'large_work_route',
  'queue_contract',
  'review_preflight',
  'review_attempts',
  'progress_boundaries',
  'security_disposition',
  'acceptance_disposition',
  'formal_repair',
  'pipeline_artifacts',
  'quality_gate',
  'cross_check',
  'no_invented_ask',
  'push_claim_valid',
  'configuration_valid',
  'status_projection_valid',
]

test('model-sensitive and model-stable harnesses partition every round check exactly once', () => {
  const sensitive = model_sensitive_harness.check_ids
  const stable = model_stable_harness.check_ids
  const combined = [...sensitive, ...stable]

  assert.equal(new Set(combined).size, combined.length)
  assert.deepEqual([...combined].sort(), [...expected_check_order].sort())
  assert.ok(sensitive.includes('terminal_one_line'))
  assert.ok(sensitive.includes('checkpoint_still_to_do'))
  assert.ok(stable.includes('security_disposition'))
  assert.ok(stable.includes('push_claim_valid'))
})

test('lint_round exposes both harness results without changing the legacy flat check order', () => {
  const result = lint_round({
    devlog_text: '# → Ask / A-001\n\n+ request\n',
    terminal_output: 'first line\nsecond line',
    now_ms: Date.parse('2026-09-06T00:00:00+08:00'),
  })

  assert.deepEqual(result.checks.map(check => check.id), expected_check_order)
  assert.equal(result.harnesses.model_sensitive.find(check => check.id === 'terminal_one_line').status, 'fail')
  assert.ok(result.harnesses.model_stable.some(check => check.id === 'security_disposition'))
  assert.equal(
    result.harnesses.model_sensitive.length + result.harnesses.model_stable.length,
    result.checks.length,
  )
})
