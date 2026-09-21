'use strict';

const assert = require('node:assert/strict');
const child_process = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const ag_settings = require('./ag-settings.js');
const { collect, validate_candidate, validate_candidate_facts } = require('./completion-context.js');
const notebook_writer = require('./notebook-write.js');
const ownership_fixture = require('./fixtures/notebook-owner');
ownership_fixture.configure();

test('explicit review waivers accept Markdown and enumerated skip lists without treating examples as authority', () => {
	const root = cleanup_fixture();
	write(root, 'changed.js', 'module.exports = 1;\n');
	const decision = owner => collect({ project_root: root, notebook_path: '.agentflow/devlog.md', devlog_text: `# → Ask / A-002\n\n${owner}\n\n# ← Reply / A-002\n\n- Host review: PASS — inspected changed source.\n` }).review_decision;
	for (const owner of ['**skip ag, delegation, stream and external review**', '+ skip AG, delegation, streams, and external review.', '- Please skip the final external review.', '+ no external review', '+ skip review', '+ skip cross-check', '+ skip ag pipeline, stream and cross-check', '+ Implement the fix. **skip ag pipeline, stream and cross-check, never over-egnieering**', '+ implement `4. **Detect conflicting skills — feasible, with explicit limits.**` as you proposed, add proper runtime warning (in seperate prompt file and only loaded on-demand) and `agf skills audit`. **skip ag pipeline, stream and cross-check, never over-egnieering**']) {
		assert.equal(decision(owner).status, 'skip-review', owner);
	}
	for (const owner of ['> skip external review', '`skip external review`', 'For example: skip external review', 'Should we skip external review?', 'Do not skip external review', '```\nskip external review\n```', '~~~\n+ skip-review: example only\n~~~', '+ skip ag and delegation', '+ skip internal review', '+ skip validation and external review', '+ For example. skip cross-check', '+ Should I implement this? skip cross-check', '+ Do not implement this. skip cross-check', '+ Implement this if approved. skip cross-check', '+ Implement the fix. Do not skip cross-check', '+ Implement the fix. `skip cross-check`', '+ Implement the fix. “skip cross-check”', '+ Implement the fix. skip cross-check if tests pass', '+ Implement the fix. skip cross-check, and disable validation', '+ Implement the fix. For example: skip cross-check', '+ Implement the fix. skip cross-check "if approved"']) {
		assert.equal(decision(owner).status, 'required', owner);
	}
});

test('review evidence accepts Markdown bullets while contradictory and quoted fields cannot authorize completion', () => {
	const { lint_cross_check } = require('./round-linter.js');
	const root = cleanup_fixture();
	const target = git(root, ['rev-parse', 'HEAD']);
	const report_path = '.agentflow/artifacts/A-002-review/review.md';
	const decision = { status: 'required', reason: 'changed source', record_files: ['.agentflow/devlog.md'] };
	const fields = `- **Reviewed implementation commit:** ${target}\n\n* **Verdict:** PASS\n\n- Outcome: PASS\n\n+ **Minimality:** PASS\n\n- **Conformance: PASS**`;
	const report = values => `* _2026-09-09 05:00:00 +0800 (fixture/none)_\n\n${values}\n\nSelf-check: diagnostic fixture.\n`;
	const reply = `- **Cross-check implementation:** ${target}\n\n* **Cross-check review:** \`${report_path}\``;
	const round = text => `# → Ask / A-002\n\nReview source\n\n# ← Reply / A-002\n\n${text}\n`;
	write(root, report_path, report(fields));
	assert.equal(lint_cross_check(round(reply), root, decision).status, 'pass');
	for (const invalid of [fields + '\n\n- Verdict: BLOCKING', fields + '\n\n- Reviewed implementation commit: ' + 'f'.repeat(40), fields.replace('- Outcome: PASS', '> Outcome: PASS'), '```\n' + fields + '\n```']) {
		write(root, report_path, report(invalid));
		assert.equal(lint_cross_check(round(reply), root, decision).status, 'fail', invalid);
	}
	write(root, report_path, report(fields));
	for (const invalid of [reply + '\n\nCross-check implementation: ' + 'f'.repeat(40), '```\n' + reply + '\n```', '> ' + reply.replace(/\n/g, '\n> ')]) {
		assert.equal(lint_cross_check(round(invalid), root, decision).status, 'fail', invalid);
	}
	const ownerExample = `# → Ask / A-002\n\n${reply}\n\n# ← Reply / A-002\n\nNo current review evidence.\n`;
	assert.equal(lint_cross_check(ownerExample, root, decision).status, 'fail');
});

test('review decisions use exact records and declared document effects, never workspace roots', () => {
	const { review_eligible } = require('./round-linter.js');
	const facts = { record_roots: ['.agentflow/'], record_files: ['.agentflow/devlog.md'], document_effects: [{ path: 'docs/poem.md', effect: 'informational', reason: 'standalone poem; no operating instructions' }] };
	assert.equal(review_eligible('.agentflow/artifacts/A-002/product.js', facts), true);
	assert.equal(review_eligible('OPERATIONS.md', facts), true);
	assert.equal(review_eligible('docs/poem.md', facts), false);
	assert.equal(review_eligible('unknown.md', facts), true);
	assert.equal(review_eligible('.agentflow/devlog.md', facts), false);
});

test('generic non-behavioral changes avoid review without hiding other changed paths', () => {
	const { lint_cross_check } = require('./round-linter.js');
	const root = cleanup_fixture();
	write(root, 'docs/notes.md', '# Notes\n\nA wording correction.\n');
	write(root, 'display.css', '/* Corrected comment spelling. */\n');
	commit(root, 'routine documentation and comment edit');
	const devlog_text = fs.readFileSync(path.join(root, '.agentflow/devlog.md'), 'utf8') + '\n# ← Reply / A-002\n\nNon-behavioral change: docs/notes.md — routine explanatory prose; no operating instruction changes\n\n- Non-behavioral change: `display.css` — comment spelling only; rendering unchanged\n';
	const result = collect({ project_root: root, notebook_path: '.agentflow/devlog.md', devlog_text });
	assert.equal(result.review_decision.status, 'not-requested');
	assert.equal(lint_cross_check(devlog_text, root, result.review_decision).status, 'pass');
	write(root, 'new-behavior.js', 'module.exports = 7;\n');
	const mixed = collect({ project_root: root, notebook_path: '.agentflow/devlog.md', devlog_text });
	assert.equal(mixed.review_decision.status, 'required');
});

test('captured scope excludes a committed source change made between the previous Reply and owner intake', () => {
  const fixture = scope_fixture();
  write(fixture.root, 'pre-session.js', 'module.exports = "old";\n');
  commit(fixture.root, 'pre-session source change');
  notebook_writer.append_input({ root: fixture.root, notebook: fixture.notebook_path, text: 'write a document' });
  const devlog_text = `${fs.readFileSync(path.join(fixture.root, fixture.notebook_path), 'utf8')}\n# ← Reply / A-002\n\nInformational document: notes.md — standalone prose\n`;

  const result = collect({ project_root: fixture.root, notebook_path: fixture.notebook_path, active_host: 'codex', devlog_text });

  assert.equal(result.review_decision.status, 'not-requested');
  assert.ok(!result.git_paths.committed.includes('pre-session.js'));
});

test('captured baseline avoids bootstrap review after prior live rounds are compacted', () => {
  const fixture = scope_fixture();
  write(fixture.root, 'old.js', 'module.exports = "old";\n');
  commit(fixture.root, 'committed old source');
  notebook_writer.append_input({ root: fixture.root, notebook: fixture.notebook_path, text: 'write a document' });
  const devlog_text = '# STATUS\n\nProject: scope test\n\n---\n\n# → Ask / A-002\n\n+ write a document\n\n# ← Reply / A-002\n\nInformational document: notes.md — standalone prose\n';

  const result = collect({ project_root: fixture.root, notebook_path: fixture.notebook_path, active_host: 'codex', devlog_text });

  assert.equal(result.git_paths.baseline, git(fixture.root, ['rev-parse', 'HEAD']));
  assert.deepEqual(result.git_paths.committed, []);
  assert.deepEqual(result.git_paths.working, ['.agentflow/devlog.md']);
  assert.equal(result.review_decision.status, 'not-requested');
});

test('compacted notebook still reviews source edits and commits after intake', () => {
  for (const change of ['edit', 'commit']) {
    const fixture = scope_fixture();
    write(fixture.root, 'old.js', 'module.exports = "old";\n');
    commit(fixture.root, 'committed old source');
    notebook_writer.append_input({ root: fixture.root, notebook: fixture.notebook_path, text: 'write a document' });
    if (change === 'edit') {
      write(fixture.root, 'old.js', 'module.exports = "new";\n');
    } else {
      write(fixture.root, 'new.js', 'module.exports = "new";\n');
      commit(fixture.root, 'committed new source');
    }
    const devlog_text = '# STATUS\n\nProject: scope test\n\n---\n\n# → Ask / A-002\n\n+ write a document\n\n# ← Reply / A-002\n\nInformational document: notes.md — standalone prose\n';

    const result = collect({ project_root: fixture.root, notebook_path: fixture.notebook_path, active_host: 'codex', devlog_text });

    assert.equal(result.review_decision.status, 'required', change);
    assert.ok(result.git_paths.changed.includes(change === 'edit' ? 'old.js' : 'new.js'));
  }
});

test('compacted notebook keeps conservative bootstrap review without a valid captured baseline', () => {
  for (const receipt of ['absent', 'stale']) {
    const fixture = scope_fixture();
    write(fixture.root, 'old.js', 'module.exports = "old";\n');
    commit(fixture.root, 'committed old source');
    if (receipt === 'stale') {
      notebook_writer.append_input({ root: fixture.root, notebook: fixture.notebook_path, text: 'write a document' });
      const receipt_name = fs.readdirSync(path.join(fixture.root, '.agentflow', '.tmp')).find(name => name.startsWith('agentflow-input-'));
      const receipt_path = path.join(fixture.root, '.agentflow', '.tmp', receipt_name);
      const saved = JSON.parse(fs.readFileSync(receipt_path, 'utf8'));
      saved.scope.head = 'f'.repeat(40);
      fs.writeFileSync(receipt_path, `${JSON.stringify(saved)}\n`);
    }
    const devlog_text = '# STATUS\n\nProject: scope test\n\n---\n\n# → Ask / A-002\n\n+ write a document\n\n# ← Reply / A-002\n\nInformational document: notes.md — standalone prose\n';

    const result = collect({ project_root: fixture.root, notebook_path: fixture.notebook_path, active_host: 'codex', devlog_text });

    assert.equal(result.review_decision.status, 'required', receipt);
  }
});

test('captured scope excludes unchanged dirty owner source present at intake', () => {
  const fixture = scope_fixture();
  write(fixture.root, 'owner.js', 'module.exports = "owner";\n');
  notebook_writer.append_input({ root: fixture.root, notebook: fixture.notebook_path, text: 'write a document' });
  const devlog_text = `${fs.readFileSync(path.join(fixture.root, fixture.notebook_path), 'utf8')}\n# ← Reply / A-002\n\nInformational document: notes.md — standalone prose\n`;

  const result = collect({ project_root: fixture.root, notebook_path: fixture.notebook_path, active_host: 'codex', devlog_text });

  assert.equal(result.review_decision.status, 'not-requested');
  assert.ok(!result.git_paths.working.includes('owner.js'));
});

test('closeout cannot exclude a working edit to source already committed by the current Ask', () => {
  const fixture = scope_fixture();
  notebook_writer.append_input({ root: fixture.root, notebook: fixture.notebook_path, text: 'change owned source' });
  write(fixture.root, 'owned.js', 'module.exports = "reviewed";\n');
  commit(fixture.root, 'current Ask implementation');
  write(fixture.root, 'owned.js', 'module.exports = "unreviewed";\n');
  const devlog_text = fs.readFileSync(path.join(fixture.root, fixture.notebook_path), 'utf8') + '\n# ← Reply / A-002\n\nImplementation complete.\n';
  const result = collect({ project_root: fixture.root, notebook_path: fixture.notebook_path, active_host: 'codex', devlog_text, ignore_paths: ['owned.js'] });
  assert.ok(result.git_paths.working.includes('owned.js'));
  assert.ok(!result.review_decision.ignored_working_paths.includes('owned.js'));
});

test('captured scope excludes unchanged staged and unstaged deletions but includes restoration', () => {
  for (const staged of [false, true]) {
    const fixture = scope_fixture();
    write(fixture.root, 'owner.js', 'module.exports = "owner";\n');
    commit(fixture.root, 'owner source');
    fs.unlinkSync(path.join(fixture.root, 'owner.js'));
    if (staged) git(fixture.root, ['add', '-u']);
    notebook_writer.append_input({ root: fixture.root, notebook: fixture.notebook_path, text: 'write a document' });
    const devlog_text = fs.readFileSync(path.join(fixture.root, fixture.notebook_path), 'utf8') + '\n# ← Reply / A-002\n\nDocument complete.\n';
    const gather = () => collect({ project_root: fixture.root, notebook_path: fixture.notebook_path, active_host: 'codex', devlog_text });
    assert.equal(gather().review_decision.status, 'not-requested');
    write(fixture.root, 'owner.js', 'module.exports = "restored and changed";\n');
    assert.ok(gather().git_paths.working.includes('owner.js'));
    assert.equal(gather().review_decision.status, 'required');
  }
});

test('captured scope re-enters a later edit and keeps newly committed and untracked source in review', () => {
  const fixture = scope_fixture();
  write(fixture.root, 'owner.js', 'module.exports = "owner";\n');
  notebook_writer.append_input({ root: fixture.root, notebook: fixture.notebook_path, text: 'write a document' });
  write(fixture.root, 'owner.js', 'module.exports = "edited";\n');
  write(fixture.root, 'new.js', 'module.exports = "untracked";\n');
  write(fixture.root, 'committed.js', 'module.exports = "committed";\n');
  child_process.execFileSync('git', ['add', 'committed.js'], { cwd: fixture.root });
  child_process.execFileSync('git', ['commit', '-qm', 'post-intake source change'], { cwd: fixture.root });
  const devlog_text = `${fs.readFileSync(path.join(fixture.root, fixture.notebook_path), 'utf8')}\n# ← Reply / A-002\n\nInformational document: notes.md — standalone prose\n`;

  const result = collect({ project_root: fixture.root, notebook_path: fixture.notebook_path, active_host: 'codex', devlog_text });

  assert.equal(result.review_decision.status, 'required');
  assert.ok(result.git_paths.working.includes('owner.js'));
  assert.ok(result.git_paths.working.includes('new.js'));
  assert.ok(result.git_paths.committed.includes('committed.js'));
});

test('repeated owner input retains the first captured scope baseline', () => {
  const fixture = scope_fixture();
  notebook_writer.append_input({ root: fixture.root, notebook: fixture.notebook_path, text: 'first input' });
  const receipt_path = path.join(fixture.root, '.agentflow', '.tmp', fs.readdirSync(path.join(fixture.root, '.agentflow', '.tmp')).find(name => name.startsWith('agentflow-input-')));
  const first_scope = JSON.parse(fs.readFileSync(receipt_path, 'utf8')).scope;

  notebook_writer.append_input({ root: fixture.root, notebook: fixture.notebook_path, text: 'second input' });

  assert.deepEqual(JSON.parse(fs.readFileSync(receipt_path, 'utf8')).scope, first_scope);
});

test('wrong-repository and stale scope receipts fall back to conservative collection', () => {
  const fixture = scope_fixture();
  write(fixture.root, 'source.js', 'module.exports = true;\n');
  notebook_writer.append_input({ root: fixture.root, notebook: fixture.notebook_path, text: 'write a document' });
  const receipt_name = fs.readdirSync(path.join(fixture.root, '.agentflow', '.tmp')).find(name => name.startsWith('agentflow-input-'));
  const receipt_path = path.join(fixture.root, '.agentflow', '.tmp', receipt_name);
  const original_receipt = JSON.parse(fs.readFileSync(receipt_path, 'utf8'));
  const devlog_text = `${fs.readFileSync(path.join(fixture.root, fixture.notebook_path), 'utf8')}\n# ← Reply / A-002\n\nInformational document: notes.md — standalone prose\n`;

  original_receipt.repository = '/another/repository';
  fs.writeFileSync(receipt_path, `${JSON.stringify(original_receipt)}\n`);
  assert.equal(collect({ project_root: fixture.root, notebook_path: fixture.notebook_path, active_host: 'codex', devlog_text }).review_decision.status, 'required');

  original_receipt.repository = fixture.root;
  original_receipt.scope.head = 'f'.repeat(40);
  fs.writeFileSync(receipt_path, `${JSON.stringify(original_receipt)}\n`);
  assert.equal(collect({ project_root: fixture.root, notebook_path: fixture.notebook_path, active_host: 'codex', devlog_text }).review_decision.status, 'required');
});

test('generic exemptions require an exact path and a reason; informational labels stay document-only', () => {
	const { review_eligible } = require('./round-linter.js');
	const exempt = { document_effects: [{ path: 'style.css', effect: 'non-behavioral', reason: 'comment correction only' }] };
	assert.equal(review_eligible('style.css', exempt), false);
	assert.equal(review_eligible('other.css', exempt), true);
	assert.equal(review_eligible('style.css', { document_effects: [{ path: 'style.css', effect: 'non-behavioral', reason: '' }] }), true);
	assert.equal(review_eligible('run.js', { document_effects: [{ path: 'run.js', effect: 'informational', reason: 'label does not exempt code' }] }), true);
});

test('cross-check verifies a real current Git target including untracked source', () => {
	const { lint_cross_check } = require('./round-linter.js');
	const root = cleanup_fixture();
	const target = git(root, ['rev-parse', 'HEAD']);
	const report_path = '.agentflow/artifacts/A-002-review/review.md';
	const report = hash => `* _2026-09-08 09:00:00 +0800 (fixture/none)_\n\nReviewed implementation commit: ${hash}\n\nVerdict: PASS\n\nOutcome: PASS\n\nMinimality: PASS\n\nConformance: PASS\n\nSelf-check: diagnostic fixture.\n`;
	const round = hash => `# → Ask / A-002\n\nReview source\n\n# ← Reply / A-002\n\nCross-check implementation: ${hash}\n\nCross-check review: ${report_path}\n`;
	const decision = { status: 'required', reason: 'changed source', record_files: ['.agentflow/devlog.md'] };
	write(root, report_path, report('f'.repeat(40)));
	assert.equal(lint_cross_check(round('f'.repeat(40)), root, decision).status, 'fail');
	write(root, report_path, report(target));
	assert.equal(lint_cross_check(round(target), root, decision).status, 'pass');
	write(root, 'untracked.js', 'module.exports = 42;\n');
	assert.equal(lint_cross_check(round(target), root, decision).status, 'fail');
	commit(root, 'new unreviewed source');
	assert.equal(lint_cross_check(round(target), root, decision).status, 'fail');
	const current = git(root, ['rev-parse', 'HEAD']);
	write(root, report_path, report(current));
	assert.equal(lint_cross_check(round(current), root, decision).status, 'pass');
	write(root, 'src.js', 'module.exports = false;\n');
	assert.equal(lint_cross_check(round(current), root, decision).status, 'fail');
});

test('current review excludes caller-owned temporary work but still rejects later committed changes', () => {
	const { lint_cross_check } = require('./round-linter.js');
	const root = cleanup_fixture();
	const target = git(root, ['rev-parse', 'HEAD']);
	const report_path = '.agentflow/artifacts/A-002-review/review.md';
	const lock = '.agentflow/devlog.md.close-round.lock';
	write(root, report_path, `* _2026-09-09 05:00:00 +0800 (fixture/none)_\n\nReviewed implementation commit: ${target}\n\nVerdict: PASS\n\nOutcome: PASS\n\nMinimality: PASS\n\nConformance: PASS\n\nSelf-check: fixture.\n`);
	const text = fs.readFileSync(path.join(root, '.agentflow/devlog.md'), 'utf8') + `\n# ← Reply / A-002\n\nCross-check implementation: ${target}\n\nCross-check review: ${report_path}\n`;
	write(root, lock, 'owned writer lock\n');
	write(root, 'foreign.js', 'uncommitted outside candidate\n');
	const facts = collect({ project_root: root, notebook_path: '.agentflow/devlog.md', devlog_text: text, ignore_paths: [lock, 'foreign.js'] });
	const current = lint_cross_check(text, root, facts.review_decision);
	assert.equal(current.status, 'pass', current.detail);
	write(root, 'other.lock', 'not excluded\n');
	assert.match(lint_cross_check(text, root, facts.review_decision).detail, /other\.lock/);
	git(root, ['add', '--', 'foreign.js']);
	git(root, ['commit', '-qm', 'unreviewed committed source']);
	assert.match(lint_cross_check(text, root, facts.review_decision).detail, /foreign\.js/);
});

const git = (root, args) => child_process.execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

const write = (root, relative, content) => {
	const file = path.join(root, relative);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, content);
};

const commit = (root, message) => {
	git(root, ['add', '-A']);
	git(root, ['commit', '-qm', message]);
};

const cleanup_fixture = () => {
	const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agentflow-completion-context-')));
	git(root, ['init', '-q']);
	git(root, ['config', 'user.name', 'Agentflow Test']);
	git(root, ['config', 'user.email', 'agentflow@example.invalid']);
	const config = ag_settings.make_template('codex');
	config.switches['target-doc'] = '.agentflow/devlog.md';
	config.switches['workspace-dir'] = '.agentflow';
	write(root, 'ag.json', `${JSON.stringify(config, null, 2)}\n`);
	write(root, '.agentflow/devlog.md', '# STATUS\n\nProject: test\n\n---\n\n# \u2192 Ask / A-001\n\n+ start\n\n# \u2190 Reply / A-001\n\n## [SUMMARY]\n\n- Done.\n\n## Questions (batched \u2014 each with a suggested default)\n\n- None.\n\n---\n\n# \u2192 Ask / A-002\n\n+\n');
	commit(root, 'root baseline');
	write(root, 'src.js', 'module.exports = true;\n');
	write(root, '.agentflow/features/fix-2/fix-2.devlog.md', '# STATUS\n\nFeature: fix-2 \u2014 closed\n');
	commit(root, 'deliver fix-2');
	write(root, '.agentflow/devlog.md', fs.readFileSync(path.join(root, '.agentflow/devlog.md'), 'utf8').replace('# \u2192 Ask / A-002\n\n+\n', '# \u2192 Ask / A-002\n\n+ cleanup: fix-2\n'));
	return root;
};

const scope_fixture = () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agentflow-scope-')));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.name', 'Agentflow Test']);
  git(root, ['config', 'user.email', 'agentflow@example.invalid']);
  const config = ag_settings.make_template('codex');
  config.switches['target-doc'] = '.agentflow/devlog.md';
  config.switches['workspace-dir'] = '.agentflow';
  write(root, 'ag.json', `${JSON.stringify(config, null, 2)}\n`);
  const notebook_path = '.agentflow/devlog.md';
  write(root, notebook_path, '# STATUS\n\nProject: scope test\n\n---\n\n# → Ask / A-001\n\n+ prior request\n\n# ← Reply / A-001\n\nprevious reply\n\n---\n\n# → Ask / A-002\n\n+\n');
  commit(root, 'scope baseline');
  return { root, notebook_path };
};

test('post-merge cleanup does not request a second review of delivered stream changes', () => {
	const root = cleanup_fixture();
	const devlog_text = fs.readFileSync(path.join(root, '.agentflow/devlog.md'), 'utf8');
	const result = collect({ project_root: root, notebook_path: '.agentflow/devlog.md', devlog_text });

	assert.equal(result.review_decision.status, 'not-requested');
	assert.deepEqual(result.git_paths.committed, []);
});

test('post-closure source changes still require a new review', () => {
	const root = cleanup_fixture();
	write(root, 'after-close.js', 'module.exports = false;\n');
	commit(root, 'change source after stream closure');
	const devlog_text = fs.readFileSync(path.join(root, '.agentflow/devlog.md'), 'utf8');
	const result = collect({ project_root: root, notebook_path: '.agentflow/devlog.md', devlog_text });

	assert.equal(result.review_decision.status, 'required');
	assert.ok(result.git_paths.committed.includes('after-close.js'));
	assert.ok(!result.git_paths.committed.includes('src.js'));
});

test('a standalone creative document does not request implementation review', () => {
	const root = cleanup_fixture();
	write(root, 'poem.md', '# Morning\n\nA quiet line.\n');
	commit(root, 'add poem');
	const devlog_text = fs.readFileSync(path.join(root, '.agentflow/devlog.md'), 'utf8') + '\n# ← Reply / A-002\n\nInformational document: poem.md — standalone creative text\n';
	const result = collect({ project_root: root, notebook_path: '.agentflow/devlog.md', devlog_text });

	assert.equal(result.review_decision.status, 'not-requested');
	assert.match(result.review_decision.reason, /no review-eligible change/);
});

test('an inline-code informational document path does not request implementation review', () => {
	const root = cleanup_fixture();
	write(root, 'poem.md', '# Morning\n\nA quiet line.\n');
	commit(root, 'add poem');
	const devlog_text = fs.readFileSync(path.join(root, '.agentflow/devlog.md'), 'utf8') + '\n# ← Reply / A-002\n\nInformational document: `poem.md` — standalone creative text\n';
	const result = collect({ project_root: root, notebook_path: '.agentflow/devlog.md', devlog_text });

	assert.deepEqual(result.review_decision.document_effects, [{ path: 'poem.md', effect: 'informational', reason: 'standalone creative text' }]);
	assert.equal(result.review_decision.status, 'not-requested');
	assert.match(result.review_decision.reason, /no review-eligible change/);
});

test('an unborn repository excludes canonical bootstrap files from a creative Ask review decision', () => {
	const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agentflow-completion-context-')));
	git(root, ['init', '-q']);
	const config = ag_settings.make_template('codex');
	config.switches['workspace-dir'] = '.agentflow';
	config.switches['target-doc'] = '.agentflow/devlog.md';
	config.switches = { 'workspace-dir': config.switches['workspace-dir'], ...config.switches };
	write(root, 'ag.json', `${JSON.stringify(config, null, 2)}\n`);
	write(root, '.gitignore', '.claude/\n.codex/\n.worktrees/\n');
	write(root, '.agentflow/devlog.md', '# STATUS\n\nProject: test\n\n---\n\n# → Ask / A-001\n\n+ write a poem\n\n# ← Reply / A-001\n\n## [SUMMARY]\n\n- Done.\n\n## Questions (batched — each with a suggested default)\n\n- None.\n');
	write(root, 'poem.md', '# Morning\n\nA quiet line.\n');
	const devlog_text = fs.readFileSync(path.join(root, '.agentflow/devlog.md'), 'utf8') + '\nInformational document: poem.md — standalone creative text\n';
	const result = collect({ project_root: root, notebook_path: '.agentflow/devlog.md', devlog_text, active_host: 'codex' });

	assert.equal(result.review_decision.status, 'not-requested');
	assert.deepEqual(result.review_decision.bootstrap_files.sort(), ['.gitignore', 'ag.json']);
});

test('an unborn repository still reviews a customized first-round configuration', () => {
	const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agentflow-completion-context-')));
	git(root, ['init', '-q']);
	const config = ag_settings.make_template('codex');
	config.switches['workspace-dir'] = '.agentflow';
	config.switches['target-doc'] = '.agentflow/devlog.md';
	config.switches['allow-ag'] = 'off';
	write(root, 'ag.json', `${JSON.stringify(config, null, 2)}\n`);
	write(root, '.agentflow/devlog.md', '# STATUS\n\nProject: test\n\n---\n\n# → Ask / A-001\n\n+ write a poem\n\n# ← Reply / A-001\n\n## [SUMMARY]\n\n- Done.\n\n## Questions (batched — each with a suggested default)\n\n- None.\n');
	write(root, 'poem.md', '# Morning\n\nA quiet line.\n');
	const devlog_text = fs.readFileSync(path.join(root, '.agentflow/devlog.md'), 'utf8');
	const result = collect({ project_root: root, notebook_path: '.agentflow/devlog.md', devlog_text, active_host: 'codex' });

	assert.equal(result.review_decision.status, 'required');
});

test('language-only configuration changes remain non-behavioral before and after commit', () => {
  for (const host of ['codex', 'claude']) {
    for (const [from, to] of [['en', 'zh-tw'], ['zh-tw', 'zh-cn'], ['zh-cn', 'en']]) {
      const fixture = scope_fixture();
      const config = ag_settings.make_template(host);
      config.switches.lang = from;
      write(fixture.root, 'ag.json', JSON.stringify(config));
      commit(fixture.root, 'existing language setting');
      notebook_writer.append_input({ root: fixture.root, notebook: fixture.notebook_path, text: `lang: ${to}`, host, session: ownership_fixture.session });
      config.switches.lang = to;
      write(fixture.root, 'ag.json', JSON.stringify(config));
      const devlog_text = fs.readFileSync(path.join(fixture.root, fixture.notebook_path), 'utf8') + '\n# ← Reply / A-002\n\nLanguage saved.\n';
      const decision = () => collect({ project_root: fixture.root, notebook_path: fixture.notebook_path, active_host: host, devlog_text }).review_decision;
      assert.equal(decision().status, 'not-requested', `${host}: ${from} -> ${to}, working`);
      git(fixture.root, ['add', '--', 'ag.json']);
      git(fixture.root, ['commit', '-qm', 'save language setting']);
      assert.equal(decision().status, 'not-requested', `${host}: ${from} -> ${to}, committed`);
      config['external-workers'][0].command.push('--changed');
      write(fixture.root, 'ag.json', JSON.stringify(config));
      assert.equal(decision().status, 'required', 'language cannot hide command changes');
    }
  }
});

test('language configuration classification rejects invalid and mixed changes', () => {
  for (const change of [config => { config.switches.lang = ''; }, config => { config.switches.lang = 'zh\ntw'; }, config => { config.switches['allow-ag'] = 'off'; }]) {
    const fixture = scope_fixture();
    notebook_writer.append_input({ root: fixture.root, notebook: fixture.notebook_path, text: 'change language', host: 'codex' });
    const config = ag_settings.make_template('codex');
    config.switches.lang = 'zh-tw';
    change(config);
    write(fixture.root, 'ag.json', JSON.stringify(config));
    const devlog_text = fs.readFileSync(path.join(fixture.root, fixture.notebook_path), 'utf8') + '\n# ← Reply / A-002\n\nLanguage saved.\n';
    assert.equal(collect({ project_root: fixture.root, notebook_path: fixture.notebook_path, active_host: 'codex', devlog_text }).review_decision.status, 'required');
  }
});

test('candidate commit paths cannot stay hidden by the captured input scope', () => {
  const fixture = scope_fixture();
  write(fixture.root, 'owner.js', 'module.exports = true;\n');
  write(fixture.root, 'outside.js', 'module.exports = false;\n');
  notebook_writer.append_input({ root: fixture.root, notebook: fixture.notebook_path, text: 'include owner.js in delivery', host: 'codex' });
  const devlog_text = fs.readFileSync(path.join(fixture.root, fixture.notebook_path), 'utf8') + '\n# ← Reply / A-002\n\nDelivery complete.\n';
  const facts = collect({ project_root: fixture.root, notebook_path: fixture.notebook_path, active_host: 'codex', devlog_text, candidate_paths: ['owner.js'] });
  assert.ok(facts.review_decision.changed_files.includes('owner.js'));
  assert.ok(!facts.review_decision.changed_files.includes('outside.js'));
  assert.equal(facts.review_decision.status, 'required');
});

test('non-ASCII informational paths require the same explicit effect as other documents', () => {
	const root = cleanup_fixture();
	const record_path = '.agentflow/artifacts/archives/runlog-luna 大盤點.md';
	write(root, record_path, 'archive record\n');
	const devlog_text = fs.readFileSync(path.join(root, '.agentflow/devlog.md'), 'utf8') + `\n# ← Reply / A-002\n\nInformational document: ${record_path} — archived narrative, no operating instructions\n`;
	const result = collect({ project_root: root, notebook_path: '.agentflow/devlog.md', devlog_text });

	assert.equal(result.review_decision.status, 'not-requested');
	assert.ok(result.git_paths.working.includes(record_path));
});

const stream_checkpoint_devlog = ask_id => `# STATUS\n\nFeature: fast-closeout — active.\n\n---\n\n# → Ask / ${ask_id}\n\n+ close out the stream\n\n## [RUN-001] Event — 2026-09-06 09:00 (during round ${ask_id})\n\n- **Scope check:** Changed paths match the tracker.\n\n## [WIP-001] Checkpoint — 2026-09-06 09:05:00 +0000 (during round ${ask_id})\n\n- **Finished:**\n\n  1. Saved current evidence.\n\n- **Running now:** None.\n`;

const stream_tracker_text = ask_id => `# Tracker\n\n- **Active Ask:** ${ask_id}.\n`;

test('tracker discovery for a stream notebook ignores a same-ask-id tracker from an unrelated stream', () => {
	const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agentflow-completion-context-')));
	git(root, ['init', '-q']);
	git(root, ['config', 'user.name', 'Agentflow Test']);
	git(root, ['config', 'user.email', 'agentflow@example.invalid']);
	const config = ag_settings.make_template('codex');
	config.switches['target-doc'] = '.agentflow/features/fast-closeout/fast-closeout.devlog.md';
	config.switches['workspace-dir'] = '.agentflow';
	write(root, 'ag.json', `${JSON.stringify(config, null, 2)}\n`);
	const notebook_path = '.agentflow/features/fast-closeout/fast-closeout.devlog.md';
	write(root, notebook_path, stream_checkpoint_devlog('A-002'));
	write(root, '.agentflow/features/fast-closeout/artifacts/A-002-closeout/tracker.md', stream_tracker_text('A-002'));
	write(root, '.agentflow/features/other-stream/artifacts/A-002-unrelated/tracker.md', stream_tracker_text('A-002'));
	commit(root, 'stream checkpoint with an unrelated same-ask-id tracker elsewhere');

	const devlog_text = fs.readFileSync(path.join(root, notebook_path), 'utf8');
	const result = collect({ project_root: root, notebook_path, devlog_text });

	assert.equal(result.tracker.path, '.agentflow/features/fast-closeout/artifacts/A-002-closeout/tracker.md');
	assert.equal(result.work_root, '.agentflow/features/fast-closeout/artifacts/A-002-closeout');
});

test('tracker discovery for a stream notebook still fails closed on genuine ambiguity inside the stream', () => {
	const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agentflow-completion-context-')));
	git(root, ['init', '-q']);
	git(root, ['config', 'user.name', 'Agentflow Test']);
	git(root, ['config', 'user.email', 'agentflow@example.invalid']);
	const config = ag_settings.make_template('codex');
	config.switches['target-doc'] = '.agentflow/features/fast-closeout/fast-closeout.devlog.md';
	config.switches['workspace-dir'] = '.agentflow';
	write(root, 'ag.json', `${JSON.stringify(config, null, 2)}\n`);
	const notebook_path = '.agentflow/features/fast-closeout/fast-closeout.devlog.md';
	write(root, notebook_path, stream_checkpoint_devlog('A-002'));
	write(root, '.agentflow/features/fast-closeout/artifacts/A-002-closeout/tracker.md', stream_tracker_text('A-002'));
	write(root, '.agentflow/features/fast-closeout/artifacts/A-002-duplicate/tracker.md', stream_tracker_text('A-002'));
	commit(root, 'stream checkpoint with two trackers for the same ask inside the stream');

	const devlog_text = fs.readFileSync(path.join(root, notebook_path), 'utf8');
	const result = collect({ project_root: root, notebook_path, devlog_text });

	assert.equal(result.tracker.path, 'ambiguous');
	assert.equal(result.work_root, undefined);
});

test('captured candidate validation is pure and matches the shared preflight result', () => {
  const root = cleanup_fixture();
  const devlog_text = fs.readFileSync(path.join(root, '.agentflow/devlog.md'), 'utf8');
  const facts = collect({ project_root: root, notebook_path: '.agentflow/devlog.md', devlog_text });
  const pure = validate_candidate_facts({ devlog_text, context: facts });
  const marked = validate_candidate({ devlog_text, context: { ...facts, captured_context: true } });

  assert.deepEqual(marked, pure);
});

test('checkpoint collector does not invent current progress when recovery fields are missing', () => {
  const root = cleanup_fixture();
  const result = collect({ project_root: root, notebook_path: '.agentflow/devlog.md', devlog_text: stream_checkpoint_devlog('A-002') });
  assert.equal(result.checkpoint_verification.progress_current, false);
});

test('checkpoint progress content does not require Markdown emphasis', () => {
  const root = cleanup_fixture();
  const text = stream_checkpoint_devlog('A-002').replaceAll('**', '') + '\n- Still to do: Finish.\n\n- Next work action: Verify.\n';
  const result = collect({ project_root: root, notebook_path: '.agentflow/devlog.md', devlog_text: text });
  assert.equal(result.checkpoint_verification.progress_current, true);
});

test('completion metadata carries review evidence but examples and ambiguous records cannot authorize completion', () => {
  const { lint_cross_check } = require('./round-linter.js');
  const root = cleanup_fixture();
  const target = git(root, ['rev-parse', 'HEAD']);
  const report_path = '.agentflow/artifacts/A-002-review/review.md';
  write(root, report_path, '* _2026-09-09 05:00:00 +0800 (fixture/none)_\n\nReviewed implementation commit: ' + target + '\nVerdict: PASS\nOutcome: PASS\nMinimality: PASS\nConformance: PASS\n\nSelf-check: fixture.\n');
  const fields = 'Cross-check implementation: ' + target + '\nCross-check review: ' + report_path;
  const fence = body => '```completion-metadata\n' + body + '\n```';
  const round = body => '# → Ask / A-002\n\nReview source\n\n# ← Reply / A-002\n\n' + body;
  const required = { status: 'required', reason: 'changed source', record_files: ['.agentflow/devlog.md'] };
  assert.equal(lint_cross_check(round(fence(fields)), root, required).status, 'pass');
  for (const invalid of [fence(fields) + '\n' + fence(''), fence(fields) + '\nCross-check implementation: ' + target, fence(fields + '\nCross-check review: other.md'), fence(fields).replace(/\n```$/, ''), '```text\n' + fields + '\n```', fence(fields).split('\n').map(line => '> ' + line).join('\n'), '````text\n' + fence(fields) + '\n````', fence(fields.replace(target, 'f'.repeat(40))), fence(fields.replace(target, target.slice(0, 7)))]) {
    assert.equal(lint_cross_check(round(invalid), root, required).status, 'fail', invalid);
  }
  const waived = { status: 'skip-review', reason: 'owner requested self-review', owner_authorized: true };
  assert.equal(lint_cross_check(round(fence('Host review: PASS — inspected source and tests')), root, waived).status, 'pass');
  for (const invalid of [fence('Host review: PASS — inspected source\nHost review: BLOCKING — unresolved'), fence('Host review: PASS'), '```text\nHost review: PASS — example\n```']) {
    assert.equal(lint_cross_check(round(invalid), root, waived).status, 'fail');
  }
});

test('completion metadata classifications share fence boundaries and reject duplicates without hiding source', () => {
  const { lint_cross_check } = require('./round-linter.js');
  const root = cleanup_fixture();
  write(root, 'docs/notes.md', '# Notes\n');
  const base = fs.readFileSync(path.join(root, '.agentflow/devlog.md'), 'utf8') + '\n# ← Reply / A-002\n\n';
  const classification = 'Non-behavioral change: docs/notes.md — ordinary prose';
  const fence = body => '```completion-metadata\n' + body + '\n```';
  const decision = body => collect({ project_root: root, notebook_path: '.agentflow/devlog.md', devlog_text: base + body }).review_decision;
  assert.equal(decision(fence(classification)).status, 'not-requested');
  for (const example of ['- ```text\n' + classification + '\n  ```', '```text\n' + classification + '\n```', '> ' + classification, '    ' + classification, '````text\n' + fence(classification) + '\n````', fence('Non-behavioral change: docs/notes.md — ')]) {
    assert.equal(decision(example).status, 'required', example);
  }
  for (const invalid of [fence(classification) + '\n' + classification, fence(classification + '\nInformational document: docs/notes.md — other reason'), fence(classification) + '\n' + fence('')]) {
    assert.equal(lint_cross_check(base + invalid, root, decision(invalid)).status, 'fail', invalid);
  }
  write(root, 'new-behavior.js', 'module.exports = 7;\n');
  assert.equal(decision(fence(classification)).status, 'required');
});
