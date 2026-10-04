'use strict';

// Keep line boundaries while making quoted examples unavailable as controls.
const unquoted_control_text = text => text.replace(
  /`[^`]*`|"[^"]*"|“[^”]*”|‘[^’]*’|(?<![\p{L}\p{N}])'[^']*'(?![\p{L}\p{N}])/gu,
  quoted => quoted.replace(/[^\r\n]+/gu, ' [quoted] ')
);

module.exports = { unquoted_control_text };
