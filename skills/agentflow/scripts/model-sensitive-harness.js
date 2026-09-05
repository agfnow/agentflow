'use strict'

const { define_harness } = require('./harness-group.js')

// These checks protect record-writing conventions whose shape or necessity may
// be revisited as model instruction-following improves. They remain enforced;
// this boundary changes ownership, not policy.
module.exports = define_harness('model-sensitive', [
  'terminal_one_line',
  'reply_structure',
  'round_boundaries',
  'next_ask_scaffold',
  'tracker',
  'checkpoint_still_to_do',
  'checkpoint_verification',
  'round_reporting',
  'progress_boundaries',
  'status_projection_valid',
])
