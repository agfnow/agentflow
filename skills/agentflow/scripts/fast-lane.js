'use strict';

// A round-scoped command, derived from owner input rather than saved settings.
const parse_task_control = (owner_text = '', name) => {
  const command_pattern = new RegExp('^/?' + name + '(?:(?:[ \\t]*[,，][ \\t]*|[ \\t]+)(\\S.*))?[ \\t]*$', 'iu');
  let selected = false;
  let has_task = false;
  let fenced = false;
  for (const raw of owner_text.split(/\r?\n/u)) {
    const line = raw.replace(/^\+ ?/u, '');
    if (/^\s*(?:`{3,}|~{3,})/u.test(line)) {
      fenced = !fenced;
      has_task = true;
      continue;
    }
    const command = !fenced && command_pattern.exec(line);
    if (command) {
      selected = true;
      if (command[1]) has_task = true;
    } else if (line.trim() && !/^\/?godev$/iu.test(line.trim())) {
      has_task = true;
    }
  }
  return selected ? { state: has_task ? 'active' : 'pending' } : null;
};

const parse_fast_lane = owner_text => parse_task_control(owner_text, 'fast-lane');
const parse_skip_ag = owner_text => parse_task_control(owner_text, 'skip-ag');
module.exports = { parse_fast_lane, parse_skip_ag };
