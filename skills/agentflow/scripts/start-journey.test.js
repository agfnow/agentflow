'use strict';

const assert = require('node:assert/strict');
const child_process = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { format_local_timestamp } = require('./local-time.js');
const { detect_initial_language } = require('./ag-settings.js');
const ownership_fixture = require('./fixtures/notebook-owner');
ownership_fixture.configure();

const SKILL_ROOT = path.resolve(__dirname, '..');
const AGF = path.join(SKILL_ROOT, 'scripts', 'agf.js');
const STOP = path.join(SKILL_ROOT, 'scripts', 'stop-hook.js');
const PTY_SCRIPT = [
	'set timeout 30',
	'log_user 1',
	'if {$env(JOURNEY_MODE) == "start"} {',
	'    spawn /bin/sh -c {test -t 0 && test -t 1 && tty && printf %s "$JOURNEY_INPUT" | tee /dev/stderr | "$JOURNEY_NODE" "$JOURNEY_AGF" start --repo "$JOURNEY_REPO" --host "$JOURNEY_HOST" --message-stdin --json}',
	'} elseif {$env(JOURNEY_MODE) == "stop"} {',
	'    spawn /bin/sh -c {test -t 0 && test -t 1 && tty && printf %s "$JOURNEY_INPUT" | tee /dev/stderr | "$JOURNEY_NODE" "$JOURNEY_STOP" --host "$JOURNEY_HOST"; outcome=$?; printf "\\nStop exit: %s\\n" "$outcome"; exit "$outcome"}',
	'} else {',
	'    spawn /bin/sh -c {test -t 0 && test -t 1 && tty && printf %s "$JOURNEY_INPUT" | tee /dev/stderr | "$JOURNEY_NODE" "$JOURNEY_AGF" close --manifest-stdin}',
	'}',
	'expect eof',
	'set waited [wait]',
	'exit [lindex $waited 3]',
].join('\n');

const run = (cwd, command, input, env) => {
	const result = child_process.spawnSync('/usr/bin/expect', ['-c', PTY_SCRIPT], {
		cwd,
		env: {
			...process.env,
			...env,
			AGENTFLOW_SESSION_ID: ownership_fixture.session,
			JOURNEY_MODE: command.includes('start') ? 'start' : command[0] === STOP ? 'stop' : 'close',
			JOURNEY_HOST: command[command.indexOf('--host') + 1] || 'codex',
			JOURNEY_NODE: process.execPath,
			JOURNEY_AGF: AGF,
			JOURNEY_STOP: STOP,
			JOURNEY_REPO: cwd,
			JOURNEY_NOTEBOOK: command[command.indexOf('--notebook') + 1] || '',
			JOURNEY_INPUT: input,
		},
		encoding: 'utf8',
	});
	return {
		command: [process.execPath, ...command].join(' '),
		input,
		status: result.status,
		stdout: result.stdout,
		stderr: result.stderr,
	};
};

const transcript_json = transcript => {
	for (let index = transcript.lastIndexOf('{'); index >= 0; index = transcript.lastIndexOf('{', index - 1)) {
		try { return JSON.parse(transcript.slice(index).trim()); } catch {}
	}
	throw new Error(`PTY transcript did not contain JSON output:\n${transcript}`);
};

const git = (cwd, args) => child_process.execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

for (const mode of ['normal', 'inline', 'resume', 'comma-resume', 'cosmetic', 'non-behavioral', 'natural-waiver', 'non-git', 'non-git-normal', 'archive-retry']) test(`${mode} real start and one-command close journey proves visible input, JSON output, and scoped local delivery`, () => {
	const non_git = mode.startsWith('non-git');
	const fast_lane = ['inline', 'resume', 'comma-resume', 'non-git'].includes(mode);
	const resuming = mode === 'resume' || mode === 'comma-resume';
	const trivial = mode === 'non-behavioral';
	const waiver = mode === 'natural-waiver';
	const archive_retry = mode === 'archive-retry';
	const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agf-start-journey-')));
	const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agf-codex-home-')));
	const codex_skill = path.join(home, '.codex', 'skills', 'agentflow');
	fs.mkdirSync(path.dirname(codex_skill), { recursive: true });
	fs.symlinkSync(SKILL_ROOT, codex_skill, 'dir');
	const notebook = '.agentflow/devlog.md';
	const host_command = [codex_skill + '/scripts/agf.js', 'start', '--repo', root, '--host', 'codex', '--message-stdin', '--json'];
	const host_env = { HOME: home, USERPROFILE: home };
	const owner_request = `${['inline', 'non-git'].includes(mode) ? 'fast-lane ' : ''}journey owner request\n${waiver ? '\n**skip ag, delegation, stream and external review**\n' : ''}`;
	try {
		if (!non_git) {
			child_process.execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
			child_process.execFileSync('git', ['config', 'user.email', 'journey@example.invalid'], { cwd: root });
			child_process.execFileSync('git', ['config', 'user.name', 'Journey Test'], { cwd: root });
		}

		if (non_git) {
			const activation = run(root, host_command, 'godev\n', host_env);
			assert.equal(activation.status, 0, activation.stdout + activation.stderr);
			assert.equal(transcript_json(activation.stdout).message.reason, 'activation_only');
			assert.equal(fs.existsSync(path.join(root, '.git')), false);
		}
		const first = run(root, host_command, owner_request, host_env);
		assert.equal(first.status, 0, `${first.command}\n${first.input}\n${first.stdout}\n${first.stderr}`);
		assert.match(first.stdout, /journey owner request/);
		assert.match(first.stdout, /\/dev\/tt/);
		const first_output = transcript_json(first.stdout);
		assert.equal(first_output.active_host, 'codex');
		assert.equal(first_output.setup_created, !non_git);
		assert.equal(first_output.hooks_restart_required, !non_git);
		assert.equal(first_output.message.inserted, true);
		assert.equal(first_output.stream_decision.reason, non_git ? 'not_git_repository' : 'bootstrap_files_only');
		assert.equal(first_output.current_ask_identifier, 'A-001');
		assert.deepEqual(first_output.git, non_git ? { branch: null, head: null, state: 'unavailable' } : { branch: 'main', head: null, state: 'unborn' });
		assert.equal(first_output.next_run_id, 'RUN-001');
		if (mode === 'inline') {
			assert.match(first.stdout, /fast-lane journey owner request/);
			assert.equal(first_output.fast_lane.state, 'active');
			assert.equal(first_output.stream_decision.open_new_stream, false);
		}
		if (!non_git) assert.deepEqual(first_output.changed_paths.sort(), ['.agentflow/devlog.md', '.gitignore', 'ag.json']);
		assert.equal(fs.existsSync(path.join(home, '.claude', 'skills', 'agentflow')), false);
		assert.match(fs.readFileSync(path.join(root, notebook), 'utf8'), /journey owner request/);

		const second = run(root, host_command, resuming ? (mode === 'comma-resume' ? 'fast-lane, no over-engineering\n' : 'fast-lane\n') : owner_request, host_env);
		assert.equal(second.status, 0, `${second.command}\n${second.input}\n${second.stdout}\n${second.stderr}`);
		const second_output = transcript_json(second.stdout);
		assert.equal(second_output.setup_created, false);
		assert.equal(second_output.hooks_restart_required, false);
		assert.equal(second_output.message.inserted, resuming);
		assert.equal(second_output.message.reason, resuming ? 'fast_lane_selected' : 'already_present');
		assert.equal(second_output.stream_decision.reason, non_git ? 'not_git_repository' : 'owner_input_only');
		assert.equal(second_output.required_next_rulebook, null);
		if (fast_lane) assert.equal(second_output.fast_lane.state, 'active');
		assert.equal((fs.readFileSync(path.join(root, notebook), 'utf8').match(/journey owner request/gu) || []).length, 1);

		let close_input = JSON.stringify({
			version: 1,
			notebook,
			ask: 'A-001',
			run_events: [
				'- The terminal journey passed.\n',
			],
			reply: mode === 'cosmetic'
				? '### Summary\n\nThe journey completed.\n\n### Final report\n\nStart, restart, and close-round were verified.\n\n### Questions\n\n- None.\n'
				: '## [SUMMARY]\n\n- The journey completed.\n\n## [FINAL REPORT]\n\n- Start, restart, and close-round were verified.\n\n```completion-metadata\nHost review: PASS — inspected the fixture change and terminal evidence; no blocking findings.\n' + (trivial ? 'Non-behavioral change: notes.md — routine explanatory prose with no operating instructions\nNon-behavioral change: display.css — comment text only; no rendering behavior\n' : '') + '```\n',
			status: { project: 'terminal journey', notebook, notebook_kind: 'root', current_commit: 'pending', tests_scenarios: 'real PTY journey', config_path: 'ag.json', host: 'codex', validation: 'validated', proven: 'terminal journey', open: 'none', next: 'await owner', artifacts: 'none', archived_eras: 'none', streams: [] },
			allowed_paths: [notebook, '.gitignore', 'ag.json', ...(fast_lane || waiver || archive_retry ? ['fixture.js'] : []), ...(trivial ? ['notes.md', 'display.css'] : []), ...(archive_retry ? ['.agentflow/devlog.archive.md'] : [])],
			commit_message: 'record terminal close journey',
			delivery: { mode: 'local' },
		});
		fs.writeFileSync(path.join(root, 'foreign.js'), 'uncommitted owner work\n');
		if (fast_lane || waiver || archive_retry) fs.writeFileSync(path.join(root, 'fixture.js'), 'module.exports = true;\n');
		let archive_before;
		if (archive_retry) {
			archive_before = '# → Ask / A-000\n\n# ← Reply / A-000\n\n' + 'history '.repeat(300000);
			fs.writeFileSync(path.join(root, '.agentflow/devlog.archive.md'), archive_before);
			const before = fs.readFileSync(path.join(root, notebook));
			const rejected = run(root, [AGF, 'close', '--manifest-stdin'], close_input, host_env);
			assert.notEqual(rejected.status, 0);
			assert.match(rejected.stdout, /cross_check/);
			assert.deepEqual(fs.readFileSync(path.join(root, notebook)), before);
			assert.equal(fs.existsSync(path.join(root, '.agentflow/.tmp/A-001/completion.json')), true);
			require('./notebook-write').append_input({ root, notebook, text: 'fast-lane', host: 'codex' });
			const corrected = JSON.parse(close_input);
			corrected.reply = corrected.reply.replace('The journey completed.', 'The archive retry completed.').replace('inspected the fixture change', 'inspected the archive retry and fixture change');
			corrected.status.archived_eras = '.agentflow/devlog.archive.md';
			close_input = JSON.stringify(corrected);
		}
		if (trivial) {
			fs.writeFileSync(path.join(root, 'notes.md'), '# Notes\n\nA short explanation.\n');
			fs.writeFileSync(path.join(root, 'display.css'), '/* Explanatory comment only. */\n');
		}
		if (non_git) {
			const before = fs.readFileSync(path.join(root, notebook), 'utf8');
			const invalid = JSON.parse(close_input);
			invalid.ask = 'A-099';
			const rejected = run(root, [AGF, 'close', '--manifest-stdin'], JSON.stringify(invalid), host_env);
			assert.notEqual(rejected.status, 0);
			assert.equal(fs.readFileSync(path.join(root, notebook), 'utf8'), before);
		}
		const close = run(root, [AGF, 'close', '--manifest-stdin'], close_input, host_env);
		assert.equal(close.status, 0, `${close.command}\n${close.input}\n${close.stdout}\n${close.stderr}`);
		assert.match(close.stdout, /\/dev\/tt/);
		if (archive_retry) {
			assert.match(close.stdout, /The archive retry completed/);
			assert.equal(fs.readFileSync(path.join(root, '.agentflow/devlog.archive.md'), 'utf8'), archive_before);
		}
		const close_output = transcript_json(close.stdout);
		assert.equal(close_output.phase, non_git ? 'notebook_replaced' : 'committed');
		assert.equal(close_output.delivery.state, 'local');
		if (non_git) assert.deepEqual(close_output.commit, { state: 'not_applicable' });
		if (mode === 'cosmetic') assert.ok(close_output.warnings.some(check => check.id === 'reply_structure'));
		const closed_text = fs.readFileSync(path.join(root, notebook), 'utf8');
		assert.match(closed_text, /# → Ask \/ A-002(?: \([^\r\n)]+\))?\n\n\+\n$/u);
		assert.match(closed_text, /# ← Reply \/ A-001/);
		if (!non_git) assert.equal(git(root, ['status', '--porcelain']), '?? foreign.js');
		assert.equal(fs.readFileSync(path.join(root, 'foreign.js'), 'utf8'), 'uncommitted owner work\n');
		if (!non_git) assert.match(git(root, ['log', '-1', '--format=%B']), /Agentflow-Close-Id:/u);
		if (!non_git) assert.equal(git(root, ['rev-list', '--count', 'HEAD']), '1');
		if (mode === 'normal' || mode === 'comma-resume' || archive_retry) {
			const stop = run(root, [STOP, '--host', 'codex'], JSON.stringify({ cwd: root, hook_event_name: 'Stop' }), host_env);
			assert.equal(stop.status, 0, stop.stdout + stop.stderr);
			assert.match(stop.stdout, /\/dev\/tt/);
			assert.match(stop.stdout, /hook_event_name.*Stop/);
			assert.match(stop.stdout, /Stop exit: 0/);
		}
		if (mode === 'comma-resume') assert.doesNotMatch(closed_text, /skip-review:/u);
		if (trivial) {
			assert.equal(git(root, ['show', 'HEAD:notes.md']), '# Notes\n\nA short explanation.');
			assert.equal(git(root, ['show', 'HEAD:display.css']), '/* Explanatory comment only. */');
			assert.doesNotMatch(closed_text, /Cross-check review:|skip-review:/u);
		}
		const replay = run(root, [AGF, 'close', '--manifest-stdin'], close_input, host_env);
		assert.equal(replay.status, 0, replay.stdout + replay.stderr);
		if (!non_git) assert.equal(git(root, ['rev-list', '--count', 'HEAD']), '1');
		if (!non_git) assert.equal(git(root, ['status', '--porcelain']), '?? foreign.js');
		if (non_git) assert.equal(fs.existsSync(path.join(root, '.git')), false);
		if (fast_lane) {
			const next = run(root, host_command, 'next ordinary task\n', host_env);
			assert.equal(next.status, 0, next.stdout + next.stderr);
			assert.equal(transcript_json(next.stdout).fast_lane, undefined);
			assert.equal(fs.existsSync(path.join(root, '.worktrees')), false);
		}
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
		fs.rmSync(home, { recursive: true, force: true });
	}
});

test('real PTY startup detects the computer language and preserves the saved choice', () => {
	const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agf-locale-journey-')));
	const expected = detect_initial_language();
	const first = run(root, [AGF, 'start', '--host', 'codex'], 'locale journey\n');
	assert.equal(first.status, 0, first.stderr + first.stdout);
	assert.match(first.stdout, /\/dev\/tt/);
	assert.match(first.stdout, /locale journey/);
	assert.equal(transcript_json(first.stdout).configuration.language, expected);
	const config_path = path.join(root, 'ag.json');
	const config = JSON.parse(fs.readFileSync(config_path, 'utf8'));
	assert.equal(config.switches.lang, expected);
	config.switches.lang = 'zh-tw';
	const saved = JSON.stringify(config, null, 2) + '\n';
	fs.writeFileSync(config_path, saved);
	const second = run(root, [AGF, 'start', '--host', 'codex'], 'locale journey\n');
	assert.equal(second.status, 0, second.stderr + second.stdout);
	assert.equal(transcript_json(second.stdout).configuration.language, 'zh-tw');
	assert.equal(fs.readFileSync(config_path, 'utf8'), saved);
});

test('active-host real PTY startup adds the other host only when it runs', () => {
	const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agf-host-journey-')));
	let prior_host;
	for (const host of ['codex', 'codex', 'claude', 'claude']) {
		if (prior_host && prior_host !== host) ownership_fixture.adopt(root, '.agentflow/devlog.md', host);
		prior_host = host;
		const result = run(root, [AGF, 'start', '--host', host], 'active host journey\n');
		assert.equal(result.status, 0, result.stderr + result.stdout);
		assert.match(result.stdout, /\/dev\/tty/);
		assert.match(result.stdout, /active host journey/);
		assert.equal(transcript_json(result.stdout).active_host, host);
		assert.ok(fs.existsSync(path.join(root, '.codex', 'hooks.json')));
		assert.equal(fs.existsSync(path.join(root, '.claude')), host === 'claude');
	}
});
