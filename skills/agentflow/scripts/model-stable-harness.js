'use strict'

const { define_harness } = require('./harness-group.js')

// These checks defend evidence, authority, safety, filesystem, Git, and
// configuration boundaries. Better model behavior does not make them obsolete.
module.exports = define_harness('model-stable', [
  'timestamps_sane',
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
  'security_disposition',
  'acceptance_disposition',
  'formal_repair',
  'pipeline_artifacts',
  'quality_gate',
  'cross_check',
  'no_invented_ask',
  'push_claim_valid',
  'configuration_valid',
])
