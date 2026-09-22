#!/usr/bin/env node
'use strict'

// Shared Agentflow settings implementation.
//
// This file deliberately uses only Node's standard library. The JSON file is
// data, not a program: no value read from it is ever passed to a shell.

const node_fs = require('node:fs')
const node_path = require('node:path')
const node_child_process = require('node:child_process')
const { format_local_timestamp } = require('./local-time.js')

const schema_version = 8
const git_timeout_default_ms = 30_000
const tier_names = Object.freeze(['best', 'better', 'basic', 'cheap'])
const pipeline_role_names = Object.freeze(['requirements', 'codewalk', 'explore', 'spike', 'spec', 'implementation', 'security-scan', 'acceptance', 'cross-check', 'learn'])
const mandatory_pipeline_roles = Object.freeze(['requirements', 'spec', 'implementation', 'acceptance'])
const pipeline_role_defaults = Object.freeze({
	requirements: 'better',
	codewalk: 'better',
	explore: 'better',
	spike: 'better',
	spec: 'better',
	implementation: 'basic',
	'security-scan': 'best',
	acceptance: 'better',
	'cross-check': 'better',
	learn: 'basic',
})
const switch_names = Object.freeze(['target-doc', 'workspace-dir', 'cli-provider', 'auto-reply', 'log-verbosity', 'inline-reply', 'lang', 'streams', 'ask-names', 'allow-ag', 'large-work-minutes', 'git-timeout-ms', 'allowed-worker', 'review-policy', 'completion-cleanup', 'completion-cleanup-interval-days'])
const optional_switch_names = Object.freeze(['completion-cleanup', 'completion-cleanup-interval-days', 'log-verbosity', 'inline-reply', 'git-timeout-ms'])
const legacy_switch_names = Object.freeze(['metrics'])
const completion_cleanup_defaults = Object.freeze({ 'completion-cleanup': 'off', 'completion-cleanup-interval-days': 7 })
const notebook_control_defaults = Object.freeze({ 'log-verbosity': 'all', 'inline-reply': 'off' })
const notebook_controls = (config = {}) => {
	const controls = Object.fromEntries(Object.entries(notebook_control_defaults).map(([key, fallback]) => [key, has_own(config.switches || {}, key) ? config.switches[key] : fallback]))
	if (!['off', 'wip', 'all'].includes(controls['log-verbosity'])) throw new SettingsError('log-verbosity must be off, wip, or all')
	if (!['off', 'on'].includes(controls['inline-reply'])) throw new SettingsError('inline-reply must be off or on')
	return controls
}
const read_notebook_controls = (repo_root, notebook_path) => {
	const file = active_config_path(repo_root, notebook_path)
	let text
	try { text = node_fs.readFileSync(file, 'utf8') } catch (error) {
		if (error.code === 'ENOENT') return notebook_controls()
		throw error
	}
	if (duplicate_json_key(text) !== null) throw new SettingsError('notebook configuration contains a duplicate JSON key')
	return notebook_controls(JSON.parse(text))
}
const changeable_switch_names = Object.freeze(switch_names.filter(key => key !== 'target-doc'))

const host_markers = Object.freeze({
	codex: ['CODEX_SESSION_ID', 'CODEX_THREAD_ID', 'CODEX_CI', 'CODEX_SANDBOX', 'CODEX_CLI'],
	claude: ['CLAUDE_PROJECT_DIR', 'CLAUDE_SESSION_ID', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SSE_PORT', 'CLAUDE_CLI'],
})

const role_tiers = Object.freeze({
	requirements: 'better',
	codewalk: 'better',
	explore: 'better',
	spike: 'better',
	spec: 'better',
	'security-scan': 'best',
	acceptance: 'better',
	'cross-check': 'better',
	architecture: 'better',
	'high-risk-review': 'best',
	review: 'better',
	coordinator: 'better',
	implementation: 'basic',
	'mechanical-edit': 'basic',
	'routine-scan': 'basic',
	learn: 'basic',
})

const role_aliases = Object.freeze({
	exploration: 'explore',
	specification: 'spec',
	security: 'security-scan',
	'three-way-review': 'review',
	threeways: 'review',
	'main-coordinator': 'coordinator',
	scan: 'routine-scan',
	coding: 'implementation',
})

const clone_value = value => JSON.parse(JSON.stringify(value))
const has_own = (value, key) => Object.prototype.hasOwnProperty.call(value, key)
const is_plain_object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const is_control_text = value => /[\u0000-\u001f\u007f\u2028\u2029]/u.test(value)

class SettingsError extends Error {
	constructor(message, details = {}) {
		super(message)
		this.name = 'SettingsError'
		this.errors = details.errors || [message]
		this.warnings = details.warnings || []
		this.code = details.code || 'AG_SETTINGS_ERROR'
	}
}

const error_from = (message, errors, warnings, code) => new SettingsError(message, { errors, warnings, code })

const normalise_host = host => {
	if (typeof host !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,127}$/u.test(host)) {
		throw new SettingsError('active host must be a safe lowercase identifier', { code: 'AG_HOST_INVALID' })
	}
	return host
}

const marker_is_set = value => value !== undefined && value !== null && value !== '' && value !== '0' && value !== 'false'

const detect_host_info = (options = {}) => {
	const explicit_host = options.explicit_host !== undefined
		? options.explicit_host
		: options.active_host !== undefined
			? options.active_host
			: options.coordinator_host !== undefined
				? options.coordinator_host
				: options.host

	const env = options.env === undefined ? process.env : options.env
	const found = Object.keys(host_markers).filter(host => host_markers[host].some(name => marker_is_set(env && env[name])))

	if (explicit_host !== undefined) {
		const host = normalise_host(explicit_host)
		return { host, source: 'explicit coordinator identity' }
	}

	if (found.length === 1) return { host: found[0], source: 'host-owned runtime marker' }
	if (found.length > 1) {
		throw new SettingsError('active host is ambiguous: both supported host families supplied runtime markers', { code: 'AG_HOST_AMBIGUOUS' })
	}

	throw new SettingsError('active host is unknown: no supported host identity was supplied', { code: 'AG_HOST_UNKNOWN' })
}

const detect_host = options => detect_host_info(options).host

const family_for_host = host => typeof host === 'string' && host.toLowerCase() === 'codex' ? 'codex' : typeof host === 'string' && host.toLowerCase() === 'claude' ? 'claude' : ''
const opposite_host = host => host === 'codex' ? 'claude' : host === 'claude' ? 'codex' : ''

const normalise_policy = policy => {
	const source = policy && policy.switches ? policy.switches : policy || {}
	const allowed_worker = source['allowed-worker'] || source.allowed_worker
	const review_policy = source['review-policy'] || source.review_policy
	if (!Array.isArray(allowed_worker) || allowed_worker.length === 0 || allowed_worker.some(value => !['external', 'internal', 'host'].includes(value)) || new Set(allowed_worker).size !== allowed_worker.length) throw new SettingsError('allowed-worker must be a non-empty permission list of unique executor kinds', { code: 'AG_POLICY_INVALID' })
	if (!['prefer-independent', 'require-independent'].includes(review_policy)) throw new SettingsError('review-policy must be prefer-independent or require-independent', { code: 'AG_POLICY_INVALID' })
	return { allowed_worker: [...allowed_worker], review_policy }
}
const worker_policy = normalise_policy
const host_identity = host => {
	const id = normalise_host(host)
	return { id, family: family_for_host(id) || null }
}
const normalise_host_identity = host_identity

const host_template_values = {
  codex: {
    'schema-version': schema_version,
    switches: {
      'target-doc': '.agentflow/devlog.md',
      'workspace-dir': '.agentflow',
      'cli-provider': 'on',
      'auto-reply': 'off',
      ...notebook_control_defaults,
      lang: 'en',
      streams: 'ask',
      'ask-names': 'on',
      'allow-ag': 'on',
      'large-work-minutes': 120,
      'git-timeout-ms': git_timeout_default_ms,
      'allowed-worker': ['external', 'internal', 'host'],
      'review-policy': 'prefer-independent',
      'completion-cleanup': completion_cleanup_defaults['completion-cleanup'],
      'completion-cleanup-interval-days':
        completion_cleanup_defaults['completion-cleanup-interval-days'],
    },
    'pipeline-roles': pipeline_role_defaults,
    'external-workers': [
      {
        id: 'codex-default',
        command: ['codex', 'exec'],
        priority: 3,
        family: 'codex',
        tiers: {
          best: 'gpt-6-astra/xhigh',
          better: 'gpt-5.6-sol/low',
          basic: 'gpt-5.6-luna/xhigh',
          cheap: 'gpt-5.6-luna/low',
        },
      },
      {
        id: 'claude-default',
        command: ['claude', '-p'],
        priority: 3,
        family: 'claude',
        tiers: {
          best: 'claude-opus-5/high',
          better: 'claude-opus-4-6/high',
          basic: 'claude-sonnet-5/high',
          cheap: 'haiku/high',
        },
      },
    ],
  },
  claude: {
    'schema-version': schema_version,
    switches: {
      'target-doc': '.agentflow/devlog.md',
      'workspace-dir': '.agentflow',
      'cli-provider': 'on',
      'auto-reply': 'off',
      ...notebook_control_defaults,
      lang: 'en',
      streams: 'ask',
      'ask-names': 'on',
      'allow-ag': 'on',
      'large-work-minutes': 120,
      'git-timeout-ms': git_timeout_default_ms,
      'allowed-worker': ['external', 'internal', 'host'],
      'review-policy': 'prefer-independent',
      'completion-cleanup': completion_cleanup_defaults['completion-cleanup'],
      'completion-cleanup-interval-days':
        completion_cleanup_defaults['completion-cleanup-interval-days'],
    },
    'pipeline-roles': pipeline_role_defaults,
    'external-workers': [
      {
        id: 'claude-default',
        command: ['claude', '-p'],
        priority: 3,
        family: 'claude',
        tiers: {
          best: 'claude-opus-5/high',
          better: 'claude-opus-4-6/high',
          basic: 'claude-sonnet-5/high',
          cheap: 'haiku/high',
        },
      },
      {
        id: 'codex-default',
        command: ['codex', 'exec'],
        priority: 3,
        family: 'codex',
        tiers: {
          best: 'gpt-6-astra/xhigh',
          better: 'gpt-5.6-sol/low',
          basic: 'gpt-5.6-luna/xhigh',
          cheap: 'gpt-5.6-luna/low',
        },
      },
    ],
  },
}

const make_template = host => {
	const active_host = normalise_host(host)
	if (host_template_values[active_host]) return clone_value(host_template_values[active_host])
	const template = clone_value(host_template_values.codex)
	template.switches['target-doc'] = '.agentflow/devlog.md'
	template['external-workers'] = []
	return template
}
const template_for_host = make_template

const normalise_initial_language = value => {
	if (typeof value !== 'string' || !value.trim()) return null
	const tag = value.trim().split(/[.@]/u)[0].replaceAll('_', '-')
	if (/^(?:C|POSIX)$/iu.test(tag)) return null
	try {
		const locale = new Intl.Locale(tag)
		if (locale.language === 'und') return null
		if (locale.language === 'zh') return locale.maximize().script === 'Hant' ? 'zh-tw' : 'zh-cn'
		return locale.baseName.toLowerCase()
	} catch { return null }
}

const detect_initial_language = (options = {}) => {
	const env = options.env || process.env
	// macOS terminal locales often describe shell formatting, not the user's UI language.
	if ((options.platform || process.platform) === 'darwin') {
		const read = options.exec_file_sync || node_child_process.execFileSync
		for (const key of ['AppleLanguages', 'AppleLocale']) {
			try {
				const value = read('/usr/bin/defaults', ['read', '-g', key], {
					encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 1000, maxBuffer: 4096,
				})
				const first = key === 'AppleLanguages' ? value.match(/^\s*\(\s*"?([A-Za-z0-9_-]+)"?\s*(?:,|\))/u)?.[1] : value
				const language = normalise_initial_language(first)
				if (language) return language
			} catch { /* Missing desktop preferences fall back to the process locale. */ }
		}
	}
	for (const key of ['LC_ALL', 'LC_MESSAGES', 'LANG']) {
		const language = normalise_initial_language(env[key])
		if (language) return language
	}
	try {
		const locale = (options.intl_locale || (() => new Intl.DateTimeFormat().resolvedOptions().locale))()
		return normalise_initial_language(locale) || 'en'
	} catch { return 'en' }
}

const sorted_keys = object => Object.keys(object).sort()

const check_exact_object = (value, expected, label, errors, warnings = [], optional = []) => {
	if (!is_plain_object(value)) {
		errors.push(`${label} must be an object`)
		return false
	}

	for (const key of expected) {
		if (!has_own(value, key)) errors.push(`${label}.${key} is required`)
	}

	for (const key of sorted_keys(value)) {
		if (!expected.includes(key) && !optional.includes(key)) warnings.push(`warning: ${label}.${key} is unknown and ignored`)
	}

	return true
}

const target_doc_errors = (value, repo_root) => {
	const errors = []
	if (typeof value !== 'string' || value.length === 0) {
		return ['switches.target-doc must be a non-empty repository-relative Markdown path']
	}
	if (is_control_text(value)) errors.push('switches.target-doc must not contain control characters')
	if (value.includes('\\') || node_path.posix.isAbsolute(value) || node_path.win32.isAbsolute(value) || /^[A-Za-z]:/.test(value)) {
		errors.push('switches.target-doc must be repository-relative and must not be absolute')
	}
	if (!value.endsWith('.md')) errors.push('switches.target-doc must end with .md')

	const parts = value.split('/')
	if (parts.some(part => part === '' || part === '.' || part === '..')) {
		errors.push('switches.target-doc must not contain empty, current-directory, or parent-directory segments')
	}

	if (repo_root && errors.length === 0) {
		const root = node_path.resolve(repo_root)
		const resolved = node_path.resolve(root, ...parts)
		if (!(resolved === root || resolved.startsWith(`${root}${node_path.sep}`))) {
			errors.push('switches.target-doc resolves outside the repository')
		} else if (!path_is_inside_real_root(root, resolved)) {
			errors.push('switches.target-doc resolves through a symlink outside the repository')
		}
	}

	return errors
}

const workspace_dir_errors = (value, repo_root) => {
	if (typeof value !== 'string' || value.length === 0) return ['switches.workspace-dir must be a non-empty repository-relative directory path']
	if (is_control_text(value)) return ['switches.workspace-dir must not contain control characters']
	if (value.includes('\\') || node_path.posix.isAbsolute(value) || node_path.win32.isAbsolute(value) || /^[A-Za-z]:/.test(value)) return ['switches.workspace-dir must be repository-relative and must not be absolute']
	const parts = value.split('/')
	if (parts.some(part => part === '' || part === '.' || part === '..')) return ['switches.workspace-dir must not contain empty, current-directory, or parent-directory segments']
	if (!repo_root) return []
	const resolved = node_path.resolve(repo_root, ...parts)
	return path_is_inside_real_root(node_path.resolve(repo_root), resolved) ? [] : ['switches.workspace-dir resolves through a symlink outside the repository']
}

const workspace_dir_for = config => {
	const workspace = config?.switches?.['workspace-dir']
	const errors = workspace_dir_errors(workspace)
	if (errors.length) throw new SettingsError(errors.join('; '), { code: 'AG_WORKSPACE_INVALID' })
	return workspace
}

const workspace_paths = config => {
	const workspace = workspace_dir_for(config)
	const prefix = `${workspace}/`
	return {
		workspace,
		notebook: `${prefix}devlog.md`,
		archive: `${prefix}devlog.archive.md`,
		audit: `${prefix}.devlog.audit.md`,
		artifacts: `${prefix}artifacts`,
		features: `${prefix}features`,
	}
}

const path_is_inside_real_root = (root, target) => {
	let real_root
	try {
		real_root = node_fs.realpathSync(root)
	} catch (error) {
		return true
	}

	let current = target
	while (true) {
		try {
			node_fs.lstatSync(current)
			break
		} catch (error) {
			// Walk to the nearest existing ancestor so a symlinked parent is checked.
		}
		const parent = node_path.dirname(current)
		if (parent === current) return true
		current = parent
	}

	let real_target
	try {
		real_target = node_fs.realpathSync(current)
	} catch (error) {
		return false
	}

	return real_target === real_root || real_target.startsWith(`${real_root}${node_path.sep}`)
}

const parse_model_value = value => {
	if (typeof value !== 'string') return null
	const slash = value.lastIndexOf('/')
	if (slash <= 0 || slash === value.length - 1) return null
	const model = value.slice(0, slash)
	const effort = value.slice(slash + 1)
	if (model.length > 128 || effort.length > 32 || /[\r\n\u2028\u2029]/u.test(model) || /[\r\n\u2028\u2029]/u.test(effort)) return null
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(model) || !/^[A-Za-z][A-Za-z0-9_-]*$/u.test(effort)) return null
	return { model, effort, value }
}

const executable_available = (command, options = {}) => {
	if (options.executables !== undefined) {
		if (Array.isArray(options.executables)) return options.executables.includes(command)
		if (is_plain_object(options.executables)) return options.executables[command] === true
	}
	if (typeof options.command_exists === 'function') return options.command_exists(command) === true

	const path_value = options.path_value === undefined ? process.env.PATH : options.path_value
	if (typeof path_value !== 'string') return false
	for (const directory of path_value.split(node_path.delimiter)) {
		if (!directory) continue
		const candidate = node_path.join(directory, command)
		try {
			if (node_fs.statSync(candidate).isFile() && (process.platform === 'win32' || (node_fs.statSync(candidate).mode & 0o111) !== 0)) return true
		} catch (error) {
			// The next PATH entry is the only useful response to a missing file.
		}
	}
	return false
}

const executable_availability = (options = {}) => ({
	codex: executable_available('codex', options),
	claude: executable_available('claude', options),
})

const profile_family = profile => {
	if (typeof profile.family === 'string' && profile.family.length > 0) return profile.family
	if (!profile.tiers || !tier_names.every(tier => typeof profile.tiers[tier] === 'string')) return ''
	const models = tier_names.map(tier => parse_model_value(profile.tiers[tier])).filter(Boolean).map(parsed => parsed.model)
	if (models.length !== tier_names.length) return ''
	if (models.every(model => model.startsWith('gpt-'))) return 'codex'
	if (models.every(model => model.startsWith('claude-'))) return 'claude'
	return ''
}

const select_profile = (config, options = {}) => {
	const profiles = config && Array.isArray(config['external-workers']) ? config['external-workers'] : []
	const cli_provider = options.cli_provider === undefined
		? config && config.switches ? config.switches['cli-provider'] : 'off'
		: options.cli_provider
	const host_value = options.host_family !== undefined
		? options.host_family
		: options.active_host !== undefined
			? options.active_host
			: options.explicit_host !== undefined
				? options.explicit_host
				: options.coordinator_host
	const host_family = options.host_family !== undefined ? options.host_family : family_for_host(host_value || '')
	const available = typeof options.executable_available === 'function'
		? options.executable_available
		: typeof options.is_executable_available === 'function'
			? options.is_executable_available
			: command => executable_available(command, options)
	const any_family = cli_provider === 'on'
	const required_tier = options.required_tier
	const disabled_profile_ids = new Set(options.disabled_profile_ids instanceof Set ? options.disabled_profile_ids : Array.isArray(options.disabled_profile_ids) ? options.disabled_profile_ids : [])
	let selected = null

	for (const profile of profiles) {
		if (profile && disabled_profile_ids.has(profile.id)) continue
		if (!profile || !Array.isArray(profile.command) || typeof profile.command[0] !== 'string') continue
		if (required_tier !== undefined && !profile_has_tier(profile, required_tier)) continue
		if (available(profile.command[0]) !== true) continue
		const family_ok = any_family || (cli_provider === 'off' && host_family !== '' && profile_family(profile) === host_family)
		if (!family_ok) continue
		if (selected === null || profile.priority > selected.priority) selected = profile
	}

	return selected
}

const no_eligible_profile_error = cli_provider => new SettingsError(`No eligible external-worker profile: no configured profile has an available executable compatible with cli-provider '${cli_provider}'.`, { code: 'AG_DISPATCH_NO_PROFILE' })

const environment_validation = (config, options = {}, warnings = [], errors = []) => {
	if (options.check_executables === false) return { availability: {} }

	const availability = executable_availability(options)
	const provider = config && config.switches && config.switches['cli-provider']
	const active_host = options.active_host || options.explicit_host || options.coordinator_host || ''
	if (provider === 'off') {
		const dormant = opposite_host(active_host)
		if (dormant && !availability[dormant]) warnings.push(`warning: the dormant ${dormant} executable is unavailable; current cli-provider=off does not require it`)
	} else if (provider === 'on' && (!Array.isArray(config['external-workers']) || !config['external-workers'].some(profile => Array.isArray(profile.command) && executable_available(profile.command[0], options)))) {
		warnings.push('warning: cli-provider=on has no available external-worker profile; no external dispatch can run until one is installed')
	}

	return { availability }
}

const identifier_error = value => {
	if (typeof value !== 'string') return 'must be a string'
	if (value.length === 0) return 'must be non-empty'
	if (value.length > 128) return 'must be at most 128 characters'
	if (!/^[A-Za-z0-9_-]+$/u.test(value)) return 'must contain only ASCII letters, digits, underscore, or hyphen'
	return ''
}

const tier_name_error = value => {
	if (typeof value !== 'string') return 'must be a string'
	if (value.length === 0) return 'must be non-empty'
	if (value.length > 128) return 'must be at most 128 characters'
	if (value === 'off') return 'reserved name off is not a worker tier'
	if (!/^[a-z0-9-]+$/u.test(value)) return 'must contain only lowercase ASCII letters, digits, or hyphen'
	return ''
}

const tier_names_for_profile = profile => profile && is_plain_object(profile.tiers) ? Object.keys(profile.tiers) : []
const profile_has_tier = (profile, tier) => tier_names_for_profile(profile).includes(tier) && parse_model_value(profile.tiers[tier]) !== null

const pipeline_profile_eligible = (config, profile, active_host = '') => {
	if (!profile) return false
	if (config.switches['cli-provider'] === 'on') return true
	return !active_host || profile_family(profile) === family_for_host(active_host)
}

const validate_pipeline_roles = (config, warnings, errors, options = {}) => {
	if (!check_exact_object(config['pipeline-roles'], pipeline_role_names, 'configuration.pipeline-roles', errors, warnings)) return
	for (const role of pipeline_role_names) {
		const tier = config['pipeline-roles'][role]
		if (tier === 'off') {
			if (mandatory_pipeline_roles.includes(role)) warnings.push(`warning: pipeline-roles.${role}=off; the full pipeline is unavailable`)
			continue
		}
		const tier_reason = tier_name_error(tier)
		if (tier_reason) {
			errors.push(`configuration.pipeline-roles.${role}: ${tier_reason}`)
			continue
		}
		// Profile availability is a dispatch-time fact. Native and host routes
		// can satisfy this structurally valid tier preference.
	}
}

const profile_error = (index, field, reason) => `Invalid external-workers[${index}]${field ? `.${field}` : ''}: ${reason}.`

const command_element_error = value => {
	if (typeof value !== 'string') return 'must be a string'
	if (value.length === 0) return 'must be non-empty'
	if (value.length > 512) return 'must be at most 512 characters'
	const forbidden = ['|', '&', ';', '<', '>', '$', '`', '(', ')', '{', '}', '*', '?', '[', ']', '!', '"', "'", '\\']
	if (is_control_text(value) || [...value].some(character => forbidden.includes(character))) return 'must contain only literal safe characters'
	return ''
}

const executable_basename_error = value => {
	if (typeof value !== 'string') return ''
	if (value === '.' || value === '..' || node_path.isAbsolute(value) || value.includes('/') || value.includes('\\')) return 'must be an executable basename'
	return ''
}

const validate_external_workers = (external_workers, errors, warnings = []) => {
	if (!Array.isArray(external_workers)) {
		errors.push('Invalid external-workers: must be an array.')
		return
	}
	// Native/host installations may intentionally have no external profiles.

	const ids = new Set()
	for (const [index, profile] of external_workers.entries()) {
		if (!is_plain_object(profile)) {
			errors.push(profile_error(index, '', 'must be an object'))
			continue
		}
		const allowed = ['id', 'command', 'priority', 'tiers', 'family']
		for (const key of sorted_keys(profile)) if (!allowed.includes(key)) warnings.push(`warning: ${profile_error(index, key, 'unknown field')} ignored`)

		for (const required of ['id', 'command', 'priority', 'tiers']) if (!has_own(profile, required)) errors.push(profile_error(index, required, 'is required'))

		const id_reason = identifier_error(profile.id)
		if (id_reason) errors.push(profile_error(index, 'id', id_reason))
		else if (ids.has(profile.id)) errors.push(profile_error(index, 'id', `duplicate profile id '${profile.id}'`))
		else ids.add(profile.id)

		if (!Array.isArray(profile.command)) errors.push(profile_error(index, 'command', 'must be a non-empty array'))
		else if (profile.command.length === 0) errors.push(profile_error(index, 'command', 'must be a non-empty array'))
		else for (const [command_index, element] of profile.command.entries()) {
			const reason = command_element_error(element)
			if (reason) errors.push(profile_error(index, `command[${command_index}]`, reason))
			else if (command_index === 0) {
				const basename_reason = executable_basename_error(element)
				if (basename_reason) errors.push(profile_error(index, `command[${command_index}]`, basename_reason))
			}
		}

		if (!Number.isInteger(profile.priority) || profile.priority < 1 || profile.priority > 5) errors.push(profile_error(index, 'priority', 'must be an integer from 1 through 5'))

		if (!is_plain_object(profile.tiers)) {
			errors.push(profile_error(index, 'tiers', 'must be an object'))
		} else {
			for (const key of sorted_keys(profile.tiers)) {
				const tier_reason = tier_name_error(key)
				if (tier_reason) warnings.push(`warning: ${profile_error(index, `tiers.${key}`, tier_reason)} ignored`)
			}
			for (const tier of tier_names) {
				if (!has_own(profile.tiers, tier)) {
					errors.push(profile_error(index, `tiers.${tier}`, 'is required'))
					continue
				}
				if (!parse_model_value(profile.tiers[tier])) errors.push(profile_error(index, `tiers.${tier}`, 'must use <full-model-id>/<effort>'))
			}
			for (const tier of sorted_keys(profile.tiers).filter(key => !tier_names.includes(key) && !tier_name_error(key))) {
				if (parse_model_value(profile.tiers[tier]) === null) errors.push(profile_error(index, `tiers.${tier}`, 'must use <full-model-id>/<effort>'))
			}
		}

		if (has_own(profile, 'family')) {
			const family_reason = identifier_error(profile.family)
			if (family_reason) errors.push(profile_error(index, 'family', family_reason))
		}
	}
}

const active_host_error = (config, options, errors) => {
	if (options.active_host === undefined && options.explicit_host === undefined && options.coordinator_host === undefined) return
	let active_host
	try {
		active_host = detect_host_info(options).host
	} catch (error) {
		errors.push(error.message)
	}
	if (!active_host) errors.push('active host is missing')
}

const validate_switches = (config, options, expected_switches, provider_values, errors, warnings) => {
	const required_switches = expected_switches.filter(key => !optional_switch_names.includes(key))
	const optional_switches = [...expected_switches.filter(key => optional_switch_names.includes(key)), ...legacy_switch_names]
	const switches_ok = check_exact_object(config.switches, required_switches, 'configuration.switches', errors, warnings, optional_switches)
	if (!switches_ok) return
	if (has_own(config.switches, 'workspace-dir')) errors.push(...workspace_dir_errors(config.switches['workspace-dir'], options.repo_root))
	const target_errors = target_doc_errors(config.switches['target-doc'], options.repo_root)
	errors.push(...target_errors)
	const legal_switches = {
		'cli-provider': provider_values,
		'auto-reply': ['on', 'off'],
		'log-verbosity': ['off', 'wip', 'all'],
		'inline-reply': ['on', 'off'],
		streams: ['ask', 'always', 'off'],
		'ask-names': ['on', 'off'],
		'allow-ag': ['on', 'off', 'ask'],
		'review-policy': ['prefer-independent', 'require-independent'],
		'completion-cleanup': ['off', 'on'],
	}
	for (const [key, values] of Object.entries(legal_switches)) {
		if (expected_switches.includes(key) && has_own(config.switches, key) && !values.includes(config.switches[key])) errors.push(`configuration.switches.${key} must be one of ${values.join(', ')}`)
	}
	if (typeof config.switches.lang !== 'string' || config.switches.lang.trim().length === 0) errors.push('configuration.switches.lang must be a non-empty string')
	else if (is_control_text(config.switches.lang)) errors.push('configuration.switches.lang must not contain control characters')
	if (!Number.isInteger(config.switches['large-work-minutes']) || config.switches['large-work-minutes'] < 1 || config.switches['large-work-minutes'] > 10080) errors.push('configuration.switches.large-work-minutes must be an integer from 1 through 10080')
	if (has_own(config.switches, 'git-timeout-ms') && (!Number.isInteger(config.switches['git-timeout-ms']) || config.switches['git-timeout-ms'] < 1)) errors.push('configuration.switches.git-timeout-ms must be a positive integer')
	if (has_own(config.switches, 'metrics') && !['off', 'on'].includes(config.switches.metrics)) errors.push('configuration.switches.metrics must be one of off, on')
	if (has_own(config.switches, 'completion-cleanup-interval-days') && (!Number.isInteger(config.switches['completion-cleanup-interval-days']) || config.switches['completion-cleanup-interval-days'] < 1 || config.switches['completion-cleanup-interval-days'] > 365)) errors.push('configuration.switches.completion-cleanup-interval-days must be an integer from 1 through 365')
	if (expected_switches.includes('allowed-worker')) {
		const allowed = config.switches['allowed-worker']
		const legal = ['external', 'internal', 'host']
		if (!Array.isArray(allowed) || allowed.length === 0 || allowed.some(value => typeof value !== 'string' || !legal.includes(value)) || new Set(allowed).size !== allowed.length) {
			errors.push('configuration.switches.allowed-worker must be a non-empty permission array of unique values from external, internal, host')
		}
	}
}

const validate_current_config = (config, options = {}) => {
	const errors = []
	const warnings = []
	if (!is_plain_object(config)) return { valid: false, errors: ['Invalid ag.json: configuration must be an object.'], warnings, availability: {} }

	const expected = ['schema-version', 'switches', 'pipeline-roles', 'external-workers']
	for (const key of sorted_keys(config)) if (!expected.includes(key)) warnings.push(`warning: Invalid ag.json: unknown top-level key '${key}' is ignored.`)
	for (const key of expected) if (!has_own(config, key)) errors.push(`Invalid ag.json: missing top-level key '${key}'.`)
	if (config['schema-version'] !== schema_version || !Number.isInteger(config['schema-version'])) errors.push(`Invalid ag.json: schema-version must be integer ${schema_version}.`)

	validate_switches(config, options, switch_names, ['off', 'on'], errors, warnings)
	validate_external_workers(config['external-workers'], errors, warnings)
	if (errors.length === 0) validate_pipeline_roles(config, warnings, errors, options)
	active_host_error(config, options, errors)

	const environment = errors.length === 0 ? environment_validation(config, options, warnings, errors) : { availability: {} }
	return { valid: errors.length === 0, errors, warnings, availability: environment.availability }
}

const validate_config = (config, options = {}) => validate_current_config(config, options)

const assert_valid_config = (config, options = {}) => {
	const result = validate_config(config, options)
	if (!result.valid) throw error_from(result.errors.join('; '), result.errors, result.warnings, 'AG_CONFIG_INVALID')
	return result
}

const relative_notebook_path = (repo_root, notebook_path = 'devlog.md') => {
	const root = node_path.resolve(repo_root)
	let relative = notebook_path
	if (node_path.isAbsolute(notebook_path)) relative = node_path.relative(root, notebook_path)
	relative = String(relative).replace(/\\/g, '/')
	const errors = target_doc_errors(relative, root)
	if (errors.length > 0) throw new SettingsError(errors.join('; '), { code: 'AG_PATH_INVALID' })
	return relative
}

const resolve_config_path = (repo_root, notebook_path = 'devlog.md') => {
	const relative = relative_notebook_path(repo_root, notebook_path)
	const directory = node_path.posix.dirname(relative)
	const config_path = node_path.resolve(repo_root, directory === '.' ? 'ag.json' : node_path.join(directory, 'ag.json'))
	if (!path_is_inside_real_root(node_path.resolve(repo_root), node_path.dirname(config_path))) {
		throw new SettingsError('applicable ag.json path resolves outside the repository', { code: 'AG_PATH_INVALID' })
	}
	return config_path
}

// The project-root ag.json is the bootstrap authority for a configured root
// notebook. Stream notebooks retain their adjacent configuration.
const active_config_path = (repo_root, notebook_path = 'devlog.md') => {
	const adjacent = resolve_config_path(repo_root, notebook_path)
	if (node_fs.existsSync(adjacent)) return adjacent
	const root_config = node_path.join(node_path.resolve(repo_root), 'ag.json')
	if (root_config === adjacent || !node_fs.existsSync(root_config)) return adjacent
	try {
		const config = JSON.parse(node_fs.readFileSync(root_config, 'utf8'))
		if (config?.switches?.['target-doc'] === relative_notebook_path(repo_root, notebook_path)) return root_config
	} catch {}
	return adjacent
}

const applicable_config_path = resolve_config_path

const is_positive_integer = value => Number.isInteger(value) && value > 0

const raw_config_timeout = config_path => {
	try {
		const config = JSON.parse(node_fs.readFileSync(config_path, 'utf8'))
		const value = config?.switches?.['git-timeout-ms']
		return is_positive_integer(value) ? value : null
	} catch {
		return null
	}
}

const repository_root_for_path = start => {
	let current = node_path.resolve(start)
	while (true) {
		try {
			if (node_fs.lstatSync(node_path.join(current, '.git'))) return current
		} catch {}
		const parent = node_path.dirname(current)
		if (parent === current) return null
		current = parent
	}
}

const stream_config_path_for_repo = worktree_root => {
	try { if (!node_fs.lstatSync(node_path.join(worktree_root, '.git')).isFile()) return null } catch { return null }
	const parts = worktree_root.split(node_path.sep)
	const marker = parts.lastIndexOf('.worktrees')
	const key = marker >= 0 ? parts[marker + 1] : ''
	if (!key) return null
	const root_config = node_path.join(worktree_root, 'ag.json')
	let workspace = '.agentflow'
	try {
		const config = JSON.parse(node_fs.readFileSync(root_config, 'utf8'))
		if (typeof config?.switches?.['workspace-dir'] === 'string' && config.switches['workspace-dir']) workspace = config.switches['workspace-dir']
	} catch {}
	if (workspace_dir_errors(workspace, worktree_root).length) return null
	return node_path.join(worktree_root, workspace, 'features', key, 'ag.json')
}

// Read without Git calls so the setting also applies to initial repository discovery.
const configured_git_timeout_ms = repo_root => {
	if (!repo_root) return null
	const root = repository_root_for_path(repo_root) || node_path.resolve(repo_root)
	const stream_config = stream_config_path_for_repo(root)
	return raw_config_timeout(stream_config && node_fs.existsSync(stream_config)
		? stream_config
		: node_path.join(root, 'ag.json'))
}

const display_path = (file_path, repo_root) => {
	if (!repo_root) return node_path.basename(file_path)
	const relative = node_path.relative(node_path.resolve(repo_root), node_path.resolve(file_path)).replace(/\\/g, '/')
	return relative || node_path.basename(file_path)
}

const established_config_repair = (config_path, repo_root) => `${display_path(config_path, repo_root)} must not be replaced automatically; if it is tracked, restore its recorded Git version, otherwise choose an explicit repair; no files changed`

const migrate_config = config => {
	if (!is_plain_object(config) || config['schema-version'] !== 7) return clone_value(config)
	const next = clone_value(config)
	next['schema-version'] = schema_version
	next.switches = is_plain_object(next.switches) ? next.switches : {}
	if (!has_own(next.switches, 'allowed-worker')) next.switches['allowed-worker'] = ['external', 'host']
	if (!has_own(next.switches, 'review-policy')) next.switches['review-policy'] = 'require-independent'
	return next
}

const duplicate_json_key = text => {
	let index = 0
	const length = text.length
	const skip_space = () => { while (index < length && /\s/u.test(text[index])) index += 1 }
	const read_string = () => {
		if (text[index] !== '"') throw new Error('expected JSON string')
		const start = index
		index += 1
		while (index < length) {
			if (text[index] === '\\') { index += 2; continue }
			if (text[index] === '"') {
				index += 1
				return JSON.parse(text.slice(start, index))
			}
			index += 1
		}
		throw new Error('unterminated JSON string')
	}
	const read_value = () => {
		skip_space()
		if (text[index] === '{') {
			index += 1
			const keys = new Set()
			skip_space()
			if (text[index] === '}') { index += 1; return null }
			while (index < length) {
				skip_space()
				const key = read_string()
				if (keys.has(key)) return key
				keys.add(key)
				skip_space()
				if (text[index] !== ':') throw new Error('expected JSON colon')
				index += 1
				const duplicate = read_value()
				if (duplicate !== null) return duplicate
				skip_space()
				if (text[index] === '}') { index += 1; return null }
				if (text[index] !== ',') throw new Error('expected JSON comma')
				index += 1
			}
			throw new Error('unterminated JSON object')
		}
		if (text[index] === '[') {
			index += 1
			skip_space()
			if (text[index] === ']') { index += 1; return null }
			while (index < length) {
				const duplicate = read_value()
				if (duplicate !== null) return duplicate
				skip_space()
				if (text[index] === ']') { index += 1; return null }
				if (text[index] !== ',') throw new Error('expected JSON comma')
				index += 1
			}
			throw new Error('unterminated JSON array')
		}
		if (text[index] === '"') { read_string(); return null }
		const primitive = text.slice(index).match(/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/u)
		if (!primitive) throw new Error('expected JSON value')
		index += primitive[0].length
		return null
	}
	try { return read_value() } catch (error) { return null }
}

const read_json_config = (config_path, options = {}) => {
	let text
	try {
		text = node_fs.readFileSync(config_path, 'utf8')
	} catch (error) {
		if (error && error.code === 'ENOENT') throw new SettingsError(`${display_path(config_path, options.repo_root)} is missing; ${established_config_repair(config_path, options.repo_root)}`, { code: 'AG_CONFIG_MISSING' })
		throw new SettingsError(`${display_path(config_path, options.repo_root)} could not be read`, { code: 'AG_CONFIG_READ' })
	}
	if (text.trim().length === 0) throw new SettingsError(`${display_path(config_path, options.repo_root)} is empty and cannot be used; ${established_config_repair(config_path, options.repo_root)}`, { code: 'AG_CONFIG_MALFORMED' })
	const duplicate_key = duplicate_json_key(text)
	if (duplicate_key !== null) throw new SettingsError(`${display_path(config_path, options.repo_root)} contains duplicate JSON object key '${duplicate_key}'; ${established_config_repair(config_path, options.repo_root)}`, { code: 'AG_CONFIG_MALFORMED' })

	let config
	try {
		config = JSON.parse(text)
	} catch (error) {
		throw new SettingsError(`${display_path(config_path, options.repo_root)} contains malformed JSON; ${established_config_repair(config_path, options.repo_root)}`, { code: 'AG_CONFIG_MALFORMED' })
	}

	let migrated = false
	if (config && config['schema-version'] === 7) {
		config = migrate_config(config)
		migrated = true
	}
	if (is_plain_object(config?.switches) && ['off', 'on'].includes(config.switches.metrics)) {
		delete config.switches.metrics
		migrated = true
	}

	try {
		const schema_validation = validate_config(config, { ...options, repo_root: options.repo_root, check_executables: false })
		if (!schema_validation.valid) throw error_from(schema_validation.errors.join('; '), schema_validation.errors, schema_validation.warnings, 'AG_CONFIG_INVALID')
	} catch (error) {
		if (error instanceof SettingsError && error.code === 'AG_CONFIG_WRITE') throw error
		throw new SettingsError(`${error.message}; ${established_config_repair(config_path, options.repo_root)}`, { code: error.code || 'AG_CONFIG_INVALID' })
	}
	const active_host = options.active_host || detect_host(options)
	assert_valid_config(config, { ...options, active_host })
	if (migrated && options.persist_migration !== false) {
		const serialized = JSON.stringify(config, null, 2) + '\n'
		write_text_atomic(config_path, serialized, options)
	}
	return config
}

const load_config = read_json_config
const read_config = read_json_config

let temp_counter = 0
const temporary_path = file_path => {
	temp_counter += 1
	return `${file_path}.tmp-${process.pid}-${Date.now()}-${temp_counter}`
}

const write_text_atomic = (file_path, text, options = {}) => {
	const fs_api = options.fs || node_fs
	const parent = node_path.dirname(file_path)
	const temp_path = temporary_path(file_path)
	let descriptor
	try {
		fs_api.mkdirSync(parent, { recursive: true })
		descriptor = fs_api.openSync(temp_path, 'wx', 0o644)
		fs_api.writeFileSync(descriptor, text, 'utf8')
		if (typeof fs_api.fsyncSync === 'function') fs_api.fsyncSync(descriptor)
		fs_api.closeSync(descriptor)
		descriptor = undefined
		fs_api.renameSync(temp_path, file_path)
	} catch (error) {
		if (descriptor !== undefined) {
			try { fs_api.closeSync(descriptor) } catch (close_error) { /* preserve the original write error */ }
		}
		try { fs_api.unlinkSync(temp_path) } catch (unlink_error) { /* the old file remains the recovery copy */ }
		const denied = ['EACCES', 'EPERM', 'EROFS'].includes(error.code)
		const remedy = denied ? ` (${error.code}): file or sandbox permission denied. Do not retry unchanged; ask the owner to install the hook outside the restricted session or grant the required write permission.` : ''
		throw new SettingsError(`${node_path.basename(file_path)} could not be written atomically${remedy}`, { code: 'AG_CONFIG_WRITE' })
	}
}

const canonical_config = config => ({
	'schema-version': config['schema-version'],
	switches: {
		'target-doc': config.switches['target-doc'],
		...(has_own(config.switches, 'workspace-dir') ? { 'workspace-dir': config.switches['workspace-dir'] } : {}),
		'cli-provider': config.switches['cli-provider'],
		'auto-reply': config.switches['auto-reply'],
		...Object.fromEntries(Object.keys(notebook_control_defaults).filter(key => has_own(config.switches, key)).map(key => [key, config.switches[key]])),
		lang: config.switches.lang,
		streams: config.switches.streams,
		'ask-names': config.switches['ask-names'],
		'allow-ag': config.switches['allow-ag'],
		'large-work-minutes': config.switches['large-work-minutes'],
		...(has_own(config.switches, 'git-timeout-ms') ? { 'git-timeout-ms': config.switches['git-timeout-ms'] } : {}),
		'allowed-worker': [...config.switches['allowed-worker']],
		'review-policy': config.switches['review-policy'],
		...(has_own(config.switches, 'completion-cleanup') ? { 'completion-cleanup': config.switches['completion-cleanup'] } : {}),
		...(has_own(config.switches, 'completion-cleanup-interval-days') ? { 'completion-cleanup-interval-days': config.switches['completion-cleanup-interval-days'] } : {}),
	},
	'pipeline-roles': Object.fromEntries(pipeline_role_names.map(role => [role, config['pipeline-roles'][role]])),
	'external-workers': config['external-workers'].map(profile => ({
		id: profile.id,
		command: [...profile.command],
		priority: profile.priority,
		...(has_own(profile, 'family') ? { family: profile.family } : {}),
		tiers: Object.fromEntries(Object.keys(profile.tiers).filter(tier => tier_names.includes(tier) || !tier_name_error(tier)).map(tier => [tier, profile.tiers[tier]])),
	})),
})

const serialize_config = (config, options = {}) => {
	assert_valid_config(config, { repo_root: options.repo_root, check_executables: false })
	const active_host = options.active_host || detect_host(options)
	assert_valid_config(config, { ...options, active_host })
	return `${JSON.stringify(canonical_config(config), null, 2)}\n`
}

const write_config_atomic = (config_path, config, options = {}) => {
	const text = serialize_config(config, options)
	write_text_atomic(config_path, text, options)
	return canonical_config(config)
}

const status_region = devlog_text => {
	const status_match = /^# STATUS[ \t]*\r?$/m.exec(devlog_text)
	if (!status_match) throw new SettingsError('notebook has no current # STATUS block', { code: 'AG_STATUS_INVALID' })
	const body_start = status_match.index + status_match[0].length
	const rest = devlog_text.slice(body_start)
	const boundary = /^(?:---[ \t]*|# → Ask \/)/m.exec(rest)
	const body_end = boundary ? body_start + boundary.index : devlog_text.length
	return { body_start, body_end, body: devlog_text.slice(body_start, body_end) }
}

const status_notebook_path = status_text => {
	const match = /^Notebook:\s+([^\s—]+)(?:\s+—|\.)/m.exec(status_text)
	return match ? match[1] : ''
}

const ensure_configuration = (options = {}) => {
	const repo_root = node_path.resolve(options.repo_root || process.cwd())
	let notebook_path = options.notebook_path
	let config_path = options.config_path
	if (!notebook_path && !config_path && node_fs.existsSync(node_path.join(repo_root, 'ag.json'))) {
		config_path = node_path.join(repo_root, 'ag.json')
		const bootstrap = read_json_config(config_path, { ...options, repo_root })
		notebook_path = bootstrap.switches['target-doc']
	}
	notebook_path = notebook_path || 'devlog.md'
	config_path = config_path || resolve_config_path(repo_root, notebook_path)
	if (node_fs.existsSync(config_path)) {
		const selected_host = options.active_host || options.explicit_host || options.coordinator_host
		const config = read_json_config(config_path, { ...options, repo_root, ...(selected_host ? { active_host: selected_host } : {}) })
		const active_host = selected_host || detect_host(options)
		if (config.switches['target-doc'] !== relative_notebook_path(repo_root, notebook_path)) {
			throw new SettingsError(`configuration target-doc=${config.switches['target-doc']} does not match notebook ${relative_notebook_path(repo_root, notebook_path)}`, { code: 'AG_CONFIG_SCOPE' })
		}
		return { config, config_path, created: false, active_host }
	}

	const notebook_abs = node_path.isAbsolute(notebook_path) ? notebook_path : node_path.resolve(repo_root, notebook_path)
	if (node_fs.existsSync(notebook_abs)) {
		let notebook_text
		try { notebook_text = node_fs.readFileSync(notebook_abs, 'utf8') } catch (error) { notebook_text = '' }
		const forwarding_target = forwarding_card_target(notebook_text)
		if (forwarding_target) {
			const forwarded_notebook = relative_notebook_path(repo_root, forwarding_target)
			const forwarded_abs = node_path.resolve(repo_root, forwarded_notebook)
			if (!node_fs.existsSync(forwarded_abs)) throw new SettingsError(`forwarding card points to missing notebook ${forwarded_notebook}; target-document rename is incomplete`, { code: 'AG_RENAME_INCOMPLETE' })
			const carried = carry_forward_card({ repo_root, old_notebook: relative_notebook_path(repo_root, notebook_path), new_notebook: forwarded_notebook, fs_api: options.fs || node_fs, host: options.active_host || options.explicit_host, session: options.session })
			const forwarded = ensure_configuration({ ...options, repo_root, notebook_path: forwarded_notebook, config_path: undefined })
			return { ...forwarded, forwarded_from: relative_notebook_path(repo_root, notebook_path), carried: carried.carried }
		}
		const fixed_status = validate_status_projection(notebook_text)
		if (fixed_status.valid) {
			const expected_notebook = relative_notebook_path(repo_root, notebook_path)
			const recorded_notebook = status_notebook_path(notebook_text)
			if (recorded_notebook && recorded_notebook !== expected_notebook) {
				throw new SettingsError(`${display_path(config_path, repo_root)} is missing and STATUS still names ${recorded_notebook}; target-document rename is incomplete, so resume the dedicated rename repair`, { code: 'AG_RENAME_INCOMPLETE' })
			}
			throw new SettingsError(`${display_path(config_path, repo_root)} is missing; this established notebook has no settings source to use; ${established_config_repair(config_path, repo_root)}`, { code: 'AG_CONFIG_MISSING' })
		}
		throw new SettingsError(`${display_path(config_path, repo_root)} is missing; ${established_config_repair(config_path, repo_root)}`, { code: 'AG_CONFIG_MISSING' })
	}

	const active_host = detect_host(options)
	const config = make_template(active_host)
	config.switches.lang = detect_initial_language(options)
	config.switches['target-doc'] = relative_notebook_path(repo_root, notebook_path)
	write_config_atomic(config_path, config, { ...options, repo_root, active_host })
	return { config, config_path, created: true, active_host }
}

const format_ask_heading = (ask, { config, repo_root = process.cwd(), notebook_path, active_host } = {}) => {
	if (!config && notebook_path) {
		const config_path = active_config_path(repo_root, notebook_path)
		if (node_fs.existsSync(config_path)) config = read_json_config(config_path, { active_host, persist_migration: false })
	}
	const heading = `# → Ask / ${ask}`
	if (config?.switches?.['ask-names'] !== 'on') return heading
	const result = node_child_process.spawnSync('git', ['config', 'user.name'], { cwd: repo_root, encoding: 'utf8', timeout: 1000, maxBuffer: 4096 })
	let name = result.status === 0 ? result.stdout.trim() : ''
	if (!name) {
		try { name = require('node:os').userInfo().username } catch {}
	}
	name = String(name).replace(/[()\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim()
	return name ? `${heading} (${name})` : heading
}

const initialize_project = (options = {}) => {
	const repo_root = node_path.resolve(options.repo_root || process.cwd())
	const active_host = detect_host(options)
	const template = make_template(active_host)
	template.switches['workspace-dir'] = '.agentflow'
	template.switches['target-doc'] = '.agentflow/devlog.md'
	const notebook_path = options.notebook_path || workspace_paths(template).notebook
	const notebook_abs = node_path.isAbsolute(notebook_path) ? notebook_path : node_path.resolve(repo_root, notebook_path)
	const config_path = options.config_path || node_path.resolve(repo_root, 'ag.json')
	if (node_fs.existsSync(notebook_abs)) return ensure_configuration({ ...options, repo_root, notebook_path, config_path })

	if (node_fs.existsSync(config_path)) {
		throw new SettingsError(`${display_path(config_path, repo_root)} exists but its notebook is missing; restore the notebook or repair the pair explicitly`, { code: 'AG_CONFIG_SCOPE' })
	}

	const config = template
	config.switches.lang = detect_initial_language(options)
	config.switches['target-doc'] = relative_notebook_path(repo_root, notebook_path)
	const status = format_status({
		project: options.project || node_path.basename(repo_root),
		notebook: config.switches['target-doc'],
		notebook_kind: 'root',
		current_commit: 'none yet; the first Agentflow closeout will create it',
		tests_scenarios: 'none',
		config_path: display_path(config_path, repo_root),
		host: active_host,
		validation: 'validated',
		proven: 'the host template was initialized',
		open: 'none',
		next: 'await the first request',
		artifacts: 'none',
		archived_eras: 'none',
		streams: [],
	})
	const notebook = `${status}\n---\n\n${format_ask_heading('A-001', { config, repo_root })}\n\n+ \n`
	write_text_atomic(notebook_abs, notebook, options)
	try {
		write_config_atomic(config_path, config, { ...options, repo_root, active_host })
	} catch (error) {
		try { (options.fs || node_fs).unlinkSync(notebook_abs) } catch (cleanup_error) { /* keep the recoverable notebook for explicit repair */ }
		throw error
	}
	return { config, config_path, notebook_path: notebook_abs, created: true, active_host }
}

const copy_for_notebook = (config, notebook_path, options = {}) => {
	const copied = clone_value(config)
	copied.switches['target-doc'] = relative_notebook_path(options.repo_root || process.cwd(), notebook_path)
	assert_valid_config(copied, { ...options, active_host: options.active_host || detect_host(options) })
	return copied
}

const copy_configuration = ({ source_config_path, target_config_path, repo_root, notebook_path, options = {} }) => {
	const source = read_json_config(source_config_path, { ...options, repo_root })
	const active_host = options.active_host || detect_host(options)
	const copied = copy_for_notebook(source, notebook_path, { ...options, repo_root, active_host })
	write_config_atomic(target_config_path, copied, { ...options, repo_root, active_host })
	return copied
}

const relocate_configuration = ({ repo_root, old_notebook, new_notebook, options = {} }) => {
	const root = node_path.resolve(repo_root || process.cwd())
	const old_config_path = options.old_config_path || resolve_config_path(root, old_notebook)
	const new_config_path = options.new_config_path || resolve_config_path(root, new_notebook)
	const source = read_json_config(old_config_path, { ...options, repo_root: root })
	const active_host = options.active_host || detect_host(options)
	const moved = copy_for_notebook(source, new_notebook, { ...options, repo_root: root, active_host })
	write_config_atomic(new_config_path, moved, { ...options, repo_root: root, active_host })
	if (old_config_path !== new_config_path && options.remove_old !== false) {
		try {
			node_fs.unlinkSync(old_config_path)
		} catch (error) {
			throw new SettingsError('the old adjacent ag.json could not be removed after the new configuration was written', { code: 'AG_CONFIG_RELOCATE' })
		}
	}
	return { config: moved, old_config_path, new_config_path }
}

const move_config_for_target_doc = relocate_configuration

const archive_path_for_notebook = notebook_path => {
	const relative = String(notebook_path).replace(/\\/g, '/')
	const directory = node_path.posix.dirname(relative)
	const base = node_path.posix.basename(relative)
	const archive_base = base.endsWith('.devlog.md')
		? `${base.slice(0, -'.devlog.md'.length)}.archive.md`
		: `${base.slice(0, -'.md'.length)}.archive.md`
	return directory === '.' ? archive_base : `${directory}/${archive_base}`
}

const git_command = (repo_root, args) => node_child_process.execFileSync('git', args, {
	cwd: repo_root,
	encoding: 'utf8',
	stdio: ['ignore', 'pipe', 'pipe'],
})

const replace_status_line = (text, pattern, replacement) => text.replace(pattern, replacement)

const update_renamed_status = (text, old_notebook, new_notebook, notebook_kind, new_config, host, date) => {
	const region = status_region(text)
	let body = text.slice(region.body_start, region.body_end)
	body = replace_status_line(body, /^Notebook:\s+[^\r\n]+$/m, `Notebook: ${new_notebook} — ${notebook_kind}.`)
	body = replace_status_line(body, /^Configuration:\s+[^\r\n]+$/m, `Configuration: ${new_config} — schema v${schema_version}; validated for ${host} this round.`)
	body = replace_status_line(body, /^Archived eras:\s+[^\r\n]+$/m, line => line.trim() === 'Archived eras: none.' ? line : `Archived eras: ${archive_path_for_notebook(new_notebook)}.`)
	const renamed_line = `Renamed: ${old_notebook} → ${new_notebook} (${date}).`
	if (/^Renamed:\s+/m.test(body)) body = body.replace(/^Renamed:\s+[^\r\n]+$/m, renamed_line)
	else body = body.replace(/^(Notebook:[^\r\n]*\r?\n)/m, `$1${renamed_line}\n`)
	return `${text.slice(0, region.body_start)}${body}${text.slice(region.body_end)}`
}

const forwarding_card_target = text => {
	const match = /^\s*Moved to:\s*`?([^\s`—]+\.md)\b/m.exec(String(text))
	return match ? match[1] : ''
}

const carry_forward_card = ({ repo_root, old_notebook, new_notebook, fs_api = node_fs, host, session, locked = false }) => {
	const old_abs = node_path.resolve(repo_root, old_notebook)
	const new_abs = node_path.resolve(repo_root, new_notebook)
	if (!fs_api.existsSync(old_abs) || !fs_api.existsSync(new_abs)) return { carried: false }
	const writer = require('./notebook-write')
	if (!locked) {
		const locks = []
		try {
			for (const file of [...new Set([old_abs, new_abs])].sort()) locks.push(writer.acquire_close_round_lock(`${file}.close-round.lock`))
			return carry_forward_card({ repo_root, old_notebook, new_notebook, fs_api, host, session, locked: true })
		} finally { for (const lock of locks.reverse()) writer.release_close_round_lock(lock) }
	}
	const card = fs_api.readFileSync(old_abs, 'utf8')
	if (forwarding_card_target(card) !== new_notebook) return { carried: false }
	const body = card.replace(/^\s*Moved to:[^\r\n]+\r?\n?/m, '').trim()
	if (!body) return { carried: false }
	const current = fs_api.readFileSync(new_abs, 'utf8')
	const owner = require('./notebook-owner')
	const parser = require('./round-linter').parse_devlog
	const incoming = parser(body).rounds.at(-1)
	if (parser(current).rounds.length) owner.guard({ root: repo_root, notebook: new_notebook, text: current, host, session })
	else if (incoming) owner.guard({ root: repo_root, notebook: new_notebook, text: `# → Ask / ${incoming.id}\n\n+\n`, host, session })
	else owner.identity({ host, session })
	const separator = current.endsWith('\n') ? '\n' : '\n\n'
	fs_api.writeFileSync(new_abs, `${current}${separator}${body}\n`, 'utf8')
	fs_api.writeFileSync(old_abs, `Moved to: ${new_notebook} — write your asks there.\n`, 'utf8')
	return { carried: true, body }
}

const rename_target_document_locked = (options = {}) => {
	const repo_root = node_path.resolve(options.repo_root || process.cwd())
	const old_notebook = relative_notebook_path(repo_root, options.old_notebook || options.from)
	const new_notebook = relative_notebook_path(repo_root, options.new_notebook || options.to)
	if (old_notebook === new_notebook) throw new SettingsError('target-document rename needs different old and new notebook paths', { code: 'AG_RENAME_INVALID' })
	const fs_api = options.fs || node_fs
	const old_abs = node_path.resolve(repo_root, old_notebook)
	const new_abs = node_path.resolve(repo_root, new_notebook)
	const old_archive = archive_path_for_notebook(old_notebook)
	const new_archive = archive_path_for_notebook(new_notebook)
	const old_archive_abs = node_path.resolve(repo_root, old_archive)
	const new_archive_abs = node_path.resolve(repo_root, new_archive)
	const git_run = args => (options.git_runner ? options.git_runner(args) : git_command(repo_root, args))
	try { git_run(['rev-parse', '--show-toplevel']) } catch (error) { throw new SettingsError('target-document rename requires a Git repository', { code: 'AG_RENAME_GIT' }) }
	const first_commit_message = 'devlog: rename target notebook (moves only)'
	let latest_subject = ''
	try { latest_subject = String(git_run(['log', '-1', '--format=%s'])).trim() } catch (error) { /* handled by the ordinary preflight below */ }
	const old_exists = fs_api.existsSync(old_abs)
	const new_exists = fs_api.existsSync(new_abs)
	const resuming = new_exists && latest_subject === first_commit_message && (!old_exists || forwarding_card_target(fs_api.readFileSync(old_abs, 'utf8')) === new_notebook)
	if (!resuming && !old_exists) throw new SettingsError(`cannot rename missing notebook ${old_notebook}`, { code: 'AG_RENAME_INVALID' })
	if (!resuming && new_exists) throw new SettingsError(`target notebook ${new_notebook} already exists`, { code: 'AG_RENAME_INVALID' })
	let status
	try { status = String(git_run(['status', '--porcelain', '--', '.', ...(options.lock_paths || []).map(file => `:(literal,exclude)${file}`)])).trim() } catch (error) { throw new SettingsError('could not inspect Git state before target-document rename', { code: 'AG_RENAME_GIT' }) }
	if (!resuming && status) throw new SettingsError('target-document rename requires a clean working tree so each commit contains only its prescribed files', { code: 'AG_RENAME_DIRTY' })

	const old_config_path = options.old_config_path || resolve_config_path(repo_root, old_notebook)
	const new_config_path = options.new_config_path || resolve_config_path(repo_root, new_notebook)
	const old_config_rel = display_path(old_config_path, repo_root)
	const new_config_rel = display_path(new_config_path, repo_root)
	const backlink_paths = (options.backlink_paths || []).map(backlink => relative_notebook_path(repo_root, backlink))
	if (resuming) {
		const allowed = new Set([old_notebook, new_notebook, old_archive, new_archive, old_config_rel, new_config_rel, ...backlink_paths, ...(options.lock_paths || [])])
		let dirty_paths
		try {
			dirty_paths = [
				...String(git_run(['diff', '--name-only', '-z'])).split('\0'),
				...String(git_run(['diff', '--cached', '--name-only', '-z'])).split('\0'),
				...String(git_run(['ls-files', '--others', '--exclude-standard', '-z'])).split('\0'),
			].filter(Boolean)
		} catch (error) {
			throw new SettingsError('could not inspect the between-commit rename state', { code: 'AG_RENAME_GIT' })
		}
		const unexpected = [...new Set(dirty_paths)].filter(file => !allowed.has(file))
		if (unexpected.length > 0) throw new SettingsError(`target-document rename recovery found unrelated changes: ${unexpected.join(', ')}`, { code: 'AG_RENAME_DIRTY' })
	}
	const source_config_path = fs_api.existsSync(old_config_path) ? old_config_path : new_config_path
	const active_host = options.active_host || options.explicit_host || detect_host(options)
	const config = read_json_config(source_config_path, { ...options, repo_root, active_host })
	if ((!resuming && config.switches['target-doc'] !== old_notebook) || (resuming && ![old_notebook, new_notebook].includes(config.switches['target-doc']))) {
		throw new SettingsError(`configuration target-doc=${config.switches['target-doc']} does not match the target-document rename`, { code: 'AG_RENAME_SCOPE' })
	}
	const old_config_text = fs_api.readFileSync(source_config_path, 'utf8')
	const status_source_path = resuming ? new_abs : old_abs
	const status_source = fs_api.readFileSync(status_source_path, 'utf8')
	const source_status_validation = validate_status_projection(status_source)
	if (!source_status_validation.valid) throw new SettingsError(`target-document rename requires a valid original STATUS: ${source_status_validation.errors.join('; ')}`, { code: 'AG_RENAME_STATUS' })
	const notebook_kind_match = /^Notebook:\s+[^\r\n]+\s+—\s+(root|stream)\.$/mu.exec(status_source)
	if (!notebook_kind_match) throw new SettingsError('target-document rename could not determine the notebook identity from STATUS', { code: 'AG_RENAME_STATUS' })
	if (!resuming) {
		const completion_records = require('./completion-record')
		const completed_rounds = require('./round-linter').parse_devlog(status_source).rounds.filter(round => round.reply_text.trim())
		const completed_asks = completed_rounds.map(round => round.id)
		if (fs_api.existsSync(old_archive_abs)) {
			let archived
			try {
				archived = require('./notebook-compact').archive_index(old_archive_abs)
			} catch (error) {
				throw new SettingsError(`target-document rename could not inspect archived Ask identities: ${error.message || error}`, { code: 'AG_RENAME_RECORDS' })
			}
			completed_asks.push(...archived.rounds.keys())
		}
		for (const ask of new Set(completed_asks)) {
			let info
			try {
				info = completion_records.location({ project_root: repo_root, notebook_path: old_notebook, ask, workspace_dir: config.switches['workspace-dir'] })
			} catch (error) {
				throw new SettingsError(`target-document rename could not inspect completion records for ${ask}: ${error.message || error}`, { code: 'AG_RENAME_RECORDS' })
			}
			if (fs_api.lstatSync(info.file, { throwIfNoEntry: false }) || fs_api.lstatSync(info.reference_file, { throwIfNoEntry: false })) {
				throw new SettingsError(`target-document rename refuses to strand completion records for ${ask}; migrate or remove the records before renaming`, { code: 'AG_RENAME_RECORDS' })
			}
		}
	}
	const notebook_kind = notebook_kind_match[1]
	const moved_paths = [old_notebook, new_notebook]
	if (fs_api.existsSync(old_archive_abs)) moved_paths.push(old_archive, new_archive)

	if (!resuming) try {
		fs_api.mkdirSync(node_path.dirname(new_abs), { recursive: true })
		if (fs_api.existsSync(old_archive_abs)) fs_api.mkdirSync(node_path.dirname(new_archive_abs), { recursive: true })
		git_run(['mv', '--', old_notebook, new_notebook])
		if (options.ownership) options.ownership = require('./notebook-owner').relocate(options.ownership, new_notebook)
		if (fs_api.existsSync(old_archive_abs)) git_run(['mv', '--', old_archive, new_archive])
		git_run(['commit', '--only', '-m', first_commit_message, '--', ...moved_paths])
	} catch (error) {
		throw new SettingsError(`target-document rename stopped during the first commit: ${error.message || error}; recover the staged move before retrying`, { code: 'AG_RENAME_FIRST_COMMIT' })
	}

	let moved_config
	try {
		const date = options.date || format_local_timestamp().slice(0, 10)
		const moved_status = update_renamed_status(fs_api.readFileSync(new_abs, 'utf8'), old_notebook, new_notebook, notebook_kind, new_config_rel, active_host, date)
		const moved_status_validation = validate_status_projection(moved_status)
		if (!moved_status_validation.valid) throw new SettingsError(`target-document rename produced an invalid STATUS: ${moved_status_validation.errors.join('; ')}`, { code: 'AG_RENAME_STATUS' })
		fs_api.writeFileSync(new_abs, moved_status, 'utf8')
		moved_config = copy_for_notebook(config, new_notebook, { ...options, repo_root, active_host })
		write_config_atomic(new_config_path, moved_config, { ...options, repo_root, active_host })
		if (old_config_path !== new_config_path && fs_api.existsSync(old_config_path)) fs_api.unlinkSync(old_config_path)
		if (!fs_api.existsSync(old_abs)) fs_api.writeFileSync(old_abs, `Moved to: ${new_notebook} — write your asks there.\n`, 'utf8')
		else if (forwarding_card_target(fs_api.readFileSync(old_abs, 'utf8')) !== new_notebook) throw new SettingsError('the old notebook path is not the expected forwarding card', { code: 'AG_RENAME_INCOMPLETE' })
		carry_forward_card({ repo_root, old_notebook, new_notebook, fs_api, host: active_host, session: options.session, locked: true })
		const second_paths = [...new Set([new_notebook, old_notebook, new_config_rel, old_config_rel])]
		if (fs_api.existsSync(new_archive_abs)) second_paths.push(new_archive)
		for (const backlink_rel of backlink_paths) {
			const backlink_abs = node_path.resolve(repo_root, backlink_rel)
			const previous = fs_api.readFileSync(backlink_abs, 'utf8')
			const updated = previous.split(old_notebook).join(new_notebook)
			if (updated !== previous) {
				fs_api.writeFileSync(backlink_abs, updated, 'utf8')
				second_paths.push(backlink_rel)
			}
		}
		const commit_paths = second_paths.filter(file => {
			if (fs_api.existsSync(node_path.resolve(repo_root, file))) return true
			try {
				git_run(['ls-files', '--with-tree=HEAD', '--error-unmatch', '--', file])
				return true
			} catch { return false }
		})
		git_run(['add', '-u', '--', '.'])
		const add_paths = second_paths.filter(file => fs_api.existsSync(node_path.resolve(repo_root, file)))
		if (add_paths.length > 0) git_run(['add', '--', ...add_paths])
		git_run(['commit', '--only', '-m', 'devlog: finish target notebook rename', '--', ...commit_paths])
	} catch (error) {
		throw new SettingsError(`target-document rename is between commits and needs recovery: ${error.message || error}; do not create defaults; finish or restore the dedicated rename state`, { code: 'AG_RENAME_INCOMPLETE' })
	}

	let head = ''
	try { head = String(git_run(['rev-parse', 'HEAD'])).trim() } catch (error) { /* the two commits are still the source of truth */ }
	return {
		old_notebook,
		new_notebook,
		old_config_path,
		new_config_path,
		first_commit: true,
		second_commit: true,
		head,
		config: moved_config,
		old_config_text,
	}
}

const rename_target_document = (options = {}) => {
	const repo_root = node_fs.realpathSync(options.repo_root || process.cwd())
	const old_notebook = relative_notebook_path(repo_root, options.old_notebook || options.from)
	const new_notebook = relative_notebook_path(repo_root, options.new_notebook || options.to)
	const owner = require('./notebook-owner')
	if (old_notebook === new_notebook || (process.platform === 'win32' && old_notebook.toLowerCase() === new_notebook.toLowerCase())) throw new SettingsError('target-document rename needs distinct notebook identities', { code: 'AG_RENAME_INVALID' })
	const writer = require('./notebook-write')
	const paths = [...new Set([old_notebook, new_notebook, ...(options.backlink_paths || [])])].sort()
	const locks = []
	try {
		for (const notebook of paths) {
			const file = owner.safe_path(repo_root, notebook, true)
			locks.push(writer.acquire_close_round_lock(`${file}.close-round.lock`))
		}
		const source = node_fs.existsSync(node_path.join(repo_root, new_notebook)) && (!node_fs.existsSync(node_path.join(repo_root, old_notebook)) || forwarding_card_target(node_fs.readFileSync(node_path.join(repo_root, old_notebook), 'utf8')) === new_notebook) ? new_notebook : old_notebook
		const host = options.active_host || options.explicit_host || detect_host(options)
		owner.identity({ host, session: options.session })
		const old_config = options.old_config_path || resolve_config_path(repo_root, old_notebook)
		const workspace = node_fs.existsSync(old_config) ? JSON.parse(node_fs.readFileSync(old_config, 'utf8')).switches?.['workspace-dir'] : undefined
		const source_text = node_fs.readFileSync(node_path.join(repo_root, source), 'utf8')
		const source_rounds = require('./round-linter').parse_devlog(source_text).rounds
		const source_owner = owner.read(owner.location({ root: repo_root, notebook: source, workspace }))
		if (!source_rounds.length && source_owner) throw new SettingsError('notebook owner exists without its Ask; restore its notebook before rename', { code: 'AG_NOTEBOOK_OWNER' })
		const ownership = source_rounds.length ? owner.guard({ root: repo_root, notebook: source, text: source_text, host, session: options.session, workspace }) : null
		for (const notebook of options.backlink_paths || []) {
			const text = node_fs.readFileSync(node_path.join(repo_root, notebook), 'utf8')
			if (require('./round-linter').parse_devlog(text).rounds.length) owner.guard({ root: repo_root, notebook, text, host, session: options.session })
		}
		return rename_target_document_locked({ ...options, repo_root, ownership, lock_paths: paths.map(notebook => `${notebook}.close-round.lock`) })
	} finally { for (const lock of locks.reverse()) writer.release_close_round_lock(lock) }
}

const rename_target_doc = rename_target_document

const profile_change_key_pattern = /^([A-Za-z0-9_-]+)\.([a-z0-9_-]+)$/u
const pipeline_role_change_key_pattern = /^pipeline-roles\.([a-z][a-z0-9-]*)$/u

const profile_change_key = key => profile_change_key_pattern.exec(key)
const pipeline_role_change_key = key => pipeline_role_change_key_pattern.exec(key)

const parse_change_lines = (changes, options = {}) => {
	const input = Array.isArray(changes) ? changes : is_plain_object(changes) ? Object.entries(changes).map(([key, value]) => `${key}: ${value}`) : String(changes || '').split(/\r?\n/)
	const parsed = {}
	const errors = []
	for (const raw of input) {
		const line = String(raw).trim()
		if (!line) continue
		const colon = line.indexOf(':')
		const equals = line.indexOf('=')
		const separator = colon >= 0 ? colon : equals
		if (separator < 1) { errors.push(`change "${line}" must use key: value`); continue }
		let key = line.slice(0, separator).trim()
		let value = line.slice(separator + 1).trim()
		if (key === 'target-doc') {
			errors.push('target-doc changes require the dedicated rename-target-document operation')
			continue
		}
		if (/^(?:internal|external)[_-]worker[._-](?:best|better|basic|cheap)$/u.test(key) || key === 'native-host') {
			errors.push(`unsupported setting change: ${key}`)
			continue
		}
		if (key === 'cli-provider' && ['any', 'codex', 'claude'].includes(value)) {
			errors.push(`unsupported setting value for ${key}: ${value}`)
			continue
		}
		if (key === 'allowed-worker') {
			try {
				value = JSON.parse(value)
			} catch (error) {
				errors.push(`setting change ${key} must use a JSON array`)
				continue
			}
		}
		const pipeline_key = pipeline_role_change_key(key)
		const profile_key = pipeline_key ? null : profile_change_key(key)
		if (profile_key && tier_name_error(profile_key[2])) { errors.push(`unsupported setting change: ${key}`); continue }
		if (pipeline_key && !pipeline_role_names.includes(pipeline_key[1])) { errors.push(`unsupported setting change: ${key}`); continue }
		const is_profile_key = profile_key !== null
		const is_pipeline_key = pipeline_key !== null
		if (!changeable_switch_names.includes(key) && !is_profile_key && !is_pipeline_key) { errors.push(`unsupported setting change: ${key}`); continue }
		if (is_profile_key && options.config && (!Array.isArray(options.config['external-workers']) || !options.config['external-workers'].some(profile => profile.id === profile_change_key(key)[1]))) {
			errors.push(`unsupported setting change: ${key}`)
			continue
		}
		if (key === 'large-work-minutes' || key === 'git-timeout-ms' || key === 'completion-cleanup-interval-days') value = Number(value)
		if (has_own(parsed, key)) errors.push(`setting change repeats ${key}`)
		parsed[key] = value
	}
	if (errors.length > 0) throw new SettingsError(errors.join('; '), { errors, code: 'AG_CHANGE_INVALID' })
	return parsed
}

const apply_changes = (config, changes, options = {}) => {
	const parsed = is_plain_object(changes) && Object.keys(changes).every(key => switch_names.includes(key) && key !== 'target-doc' || profile_change_key(key) !== null || pipeline_role_change_key(key) !== null)
		? changes
		: parse_change_lines(changes, { ...options, config })
	const next = clone_value(config)
	const old_values = {}
	const errors = []
	for (const [key, value] of Object.entries(parsed)) {
		if (key === 'target-doc') { errors.push('target-doc changes require the dedicated rename-target-document operation'); continue }
		const pipeline_key = pipeline_role_change_key(key)
		const profile_key = pipeline_key ? null : profile_change_key(key)
		if (profile_key) {
			const profile = Array.isArray(next['external-workers']) ? next['external-workers'].find(candidate => candidate.id === profile_key[1]) : undefined
			if (!profile || !profile.tiers || !has_own(profile.tiers, profile_key[2])) { errors.push(`unsupported setting change: ${key}`); continue }
			old_values[key] = profile.tiers[profile_key[2]]
			profile.tiers[profile_key[2]] = value
			continue
		}
		if (pipeline_key) {
			if (!pipeline_role_names.includes(pipeline_key[1])) { errors.push(`unsupported setting change: ${key}`); continue }
			old_values[key] = next['pipeline-roles'][pipeline_key[1]]
			next['pipeline-roles'][pipeline_key[1]] = value
			continue
		}
		if (!has_own(next.switches, key) && key !== 'workspace-dir' && !optional_switch_names.includes(key)) { errors.push(`unsupported setting change: ${key}`); continue }
		old_values[key] = next.switches[key]
		next.switches[key] = value
	}
	if (errors.length > 0) throw new SettingsError(errors.join('; '), { errors, code: 'AG_CHANGE_INVALID' })
	const validation = validate_config(next, options)
	if (!validation.valid) throw error_from(`settings change rejected: ${validation.errors.join('; ')}`, validation.errors, validation.warnings, 'AG_CHANGE_INVALID')
	const confirmations = Object.keys(parsed)
		.filter(key => {
			const pipeline_key = pipeline_role_change_key(key)
			const profile_key = pipeline_key ? null : profile_change_key(key)
			if (profile_key) {
			const profile = next['external-workers'].find(candidate => candidate.id === profile_key[1])
				return old_values[key] !== profile.tiers[profile_key[2]]
			}
			if (pipeline_key) return old_values[key] !== next['pipeline-roles'][pipeline_key[1]]
			return old_values[key] !== next.switches[key]
		})
		.map(key => {
			const pipeline_key = pipeline_role_change_key(key)
			const profile_key = pipeline_key ? null : profile_change_key(key)
			const value = profile_key
				? next['external-workers'].find(profile => profile.id === profile_key[1]).tiers[profile_key[2]]
				: pipeline_key
					? next['pipeline-roles'][pipeline_key[1]]
				: next.switches[key]
			return `${key}: ${old_values[key]} → ${value}`
		})
	return { config: canonical_config(next), changes: confirmations, validation }
}

const change_configuration = (config_path, changes, options = {}) => {
	const repo_root = node_path.resolve(options.repo_root || node_path.dirname(config_path))
	const config = read_json_config(config_path, { ...options, repo_root })
	const active_host = options.active_host || options.explicit_host || detect_host(options)
	const result = apply_changes(config, changes, { ...options, repo_root, active_host })
	if (result.changes.length > 0) write_config_atomic(config_path, result.config, { ...options, repo_root, active_host })
	return { ...result, config_path }
}

const format_status_value = value => {
	const text = value === undefined || value === null || String(value).trim() === '' ? 'none' : String(value)
	return text.replace(/[\r\n]+/g, ' ')
}

const format_status = options => {
	const streams = Array.isArray(options.streams) ? options.streams.filter(stream => stream && stream.state === 'active') : []
	const stream_text = streams.length === 0
		? 'Streams: none.'
		: `Streams:\n\n${streams.map(stream => `stream: ${format_status_value(stream.taskkey)} — ${format_status_value(stream.state)} — ${format_status_value(stream.path)}`).join('\n')}`
	return [
		'# STATUS',
		'',
		`Project: ${format_status_value(options.project)}`,
		'',
		`Notebook: ${format_status_value(options.notebook)} — ${format_status_value(options.notebook_kind || 'root')}.`,
		'',
		`Current commit: ${format_status_value(options.current_commit)}.`,
		'',
		`Tests/scenarios: ${format_status_value(options.tests_scenarios)}.`,
		'',
		`Configuration: ${format_status_value(options.config_path || 'ag.json')} — schema v${options.schema_version === undefined ? schema_version : options.schema_version}; ${format_status_value(options.validation || 'validated')} for ${format_status_value(options.host || 'unknown')} this round.`,
		'',
		`Proven: ${format_status_value(options.proven)}.`,
		'',
		`Open: ${format_status_value(options.open)}.`,
		'',
		`Next: ${format_status_value(options.next)}.`,
		'',
		`Artifacts: ${format_status_value(options.artifacts)}.`,
		'',
		`Archived eras: ${format_status_value(options.archived_eras)}.`,
		'',
		stream_text,
		'',
	].join('\n')
}

const status_field_order = ['Project:', 'Notebook:', 'Current commit:', 'Tests/scenarios:', 'Configuration:', 'Proven:', 'Open:', 'Next:', 'Artifacts:', 'Archived eras:', 'Streams:']

const status_stream_pattern = /^stream:\s+([a-z0-9][a-z0-9-]*)\s+—\s+active\s+—\s+([^\s]+\.devlog\.md)$/u
const status_rename_pattern = /^Renamed:\s+([^\s—]+\.md)\s+→\s+([^\s—]+\.md)\s+\((\d{4}-\d{2}-\d{2})\)\.?$/u
const status_configuration_pattern = new RegExp(`^Configuration:\\s+((?:\\.?[A-Za-z0-9_-]+\\/)*ag\\.json)\\s+—\\s+schema v${schema_version};\\s+(validated|blocked|invalid|missing|unvalidated)\\s+for\\s+([A-Za-z0-9][A-Za-z0-9._-]*)\\s+this round\\.$`, 'u')
const status_backlink_pattern = /^Backlink: main notebook `[^`\s]+\.md` \(main checkout\)$/u
const status_feature_pattern = /^Feature: [a-z0-9][a-z0-9-]*(?: — active — .+| — closed)$/u

const status_field_value = (line, field) => line.slice(field.length).trim()

const validate_status_projection = devlog_text => {
	let region
	try {
		region = status_region(devlog_text)
	} catch (error) {
		return { valid: false, errors: ['STATUS block is missing'] }
	}
	const errors = [], warnings = []
	const lines = region.body.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(original => {
		let line = original.replace(/^[-*+]\s+/u, '').replace(/\*\*/gu, '')
		const field = status_field_order.find(name => line.toLowerCase().startsWith(name.toLowerCase()))
		if (field) line = field + line.slice(field.length)
		if (/^(?:Notebook:|Configuration:|Archived eras:|Streams:\s+none$)/u.test(line) && !line.endsWith('.')) line += '.'
		if (line !== original) warnings.push('STATUS field Markdown, capitalization or punctuation differs from the standard presentation')
		return line
	})
	const first_ask = /^# → Ask \/ A-\d+/m.exec(devlog_text)
	if (first_ask !== null && !/\r?\n---[ \t]*\r?\n(?:\r?\n)?$/u.test(devlog_text.slice(0, first_ask.index))) warnings.push('STATUS must end with a --- separator before the first Ask')
	const seen = new Set()
	let expected_index = 0
	let stream_section = false
	let stream_none = false
	let rename_seen = false
	const notebook_line = lines.find(line => line.startsWith('Notebook:')) || ''
	const notebook_identity = /^Notebook:\s+([^\s—]+\.md)\s+—\s+(root|stream)\.$/u.exec(notebook_line)
	let notebook_path = notebook_identity?.[1] || null
	let notebook_kind = notebook_identity?.[2] || null
	let backlink_seen = false
	let feature_seen = false

	for (const line of lines) {
		if (/(?:^|\s)Settings:\s*/i.test(line)) errors.push('STATUS must not emit an authoritative Settings: line')
		if (/^Language(?: detection| note)?\s*:/i.test(line)) { warnings.push('STATUS should omit a language-detection line'); continue }
		if (/(?:gpt-5\.6|claude-(?:opus|sonnet)-5)\/\w+/i.test(line)) warnings.push('STATUS must not emit concrete worker model labels')

		const field = status_field_order.find(candidate => line.startsWith(candidate))
		if ((stream_section || /^(?:stream:|Backlink:|Feature:)/u.test(line)) && !field && !line.startsWith('Renamed:')) {
			if (notebook_kind === 'stream' && !backlink_seen && status_backlink_pattern.test(line)) {
				if (!stream_section || feature_seen) warnings.push('STATUS backlink is out of order')
				backlink_seen = true
				continue
			}
			if (notebook_kind === 'stream' && !feature_seen && status_feature_pattern.test(line)) {
				if (!backlink_seen) warnings.push('STATUS feature is out of order')
				feature_seen = true
				continue
			}
			const stream_match = status_stream_pattern.exec(line)
			if (!stream_match) {
				if (/^[A-Za-z][A-Za-z0-9 /_-]*\s*:/u.test(line)) errors.push(`STATUS has a malformed stream pointer: ${line}`)
				else warnings.push(`STATUS contains extra presentation content: ${line}`)
			}
			else if (notebook_path !== null && notebook_kind !== null) {
				if (!stream_section) warnings.push('STATUS stream pointers should follow the Streams: field')
				const taskkey = stream_match[1]
				const stream_path = stream_match[2]
				const workspace = notebook_kind === 'root' ? node_path.posix.dirname(notebook_path) : ''
				const expected_path = notebook_kind === 'root'
					? `${workspace === '.' ? '' : `${workspace}/`}features/${taskkey}/${taskkey}.devlog.md`
					: notebook_path
				if (stream_path !== expected_path) errors.push(`STATUS stream pointer is outside its configured workspace: ${line}`)
			}
			if (stream_match && lines.includes('Streams: none.')) errors.push('STATUS cannot add stream pointers after Streams: none.')
			continue
		}

		if (line.startsWith('Renamed:')) {
			if (rename_seen) errors.push('STATUS contains duplicate Renamed: fields')
			if (expected_index < 2) warnings.push('STATUS Renamed: field is out of order')
			if (!status_rename_pattern.test(line)) errors.push('STATUS Renamed: field has an invalid format')
			rename_seen = true
			continue
		}

		if (!field) {
			if (/^[A-Za-z][A-Za-z0-9 /_-]*\s*:/u.test(line)) errors.push(`STATUS contains an unexpected authoritative field: ${line.split(':', 1)[0]}`)
			else warnings.push(`STATUS contains unexpected content: ${line}`)
			continue
		}

		const field_index = status_field_order.indexOf(field)
		if (seen.has(field)) {
			errors.push(`STATUS contains duplicate ${field}`)
			continue
		}
		if (field_index < expected_index) warnings.push(`STATUS field ${field} is out of order`)
		seen.add(field)
		expected_index = Math.max(expected_index, field_index + 1)

		const value = status_field_value(line, field)
		if (!value && !(field === 'Streams:' && line === 'Streams:')) errors.push(`STATUS field ${field} is empty`)
		if (field === 'Configuration:' && !status_configuration_pattern.test(line)) errors.push('STATUS Configuration: must contain only path, schema version, active host, and validation result')
		if (field === 'Notebook:') {
			const notebook_match = /^Notebook:\s+([^\s—]+\.md)\s+—\s+(root|stream)\.$/u.exec(line)
			if (notebook_match === null) errors.push('STATUS Notebook: has an invalid format')
			else {
				if (node_path.posix.isAbsolute(notebook_match[1]) || notebook_match[1].includes('\\') || notebook_match[1].split('/').some(part => ['', '.', '..'].includes(part))) errors.push('STATUS Notebook: has an unsafe path')
				notebook_path = notebook_match[1]
				notebook_kind = notebook_match[2]
			}
		}
		if (field === 'Archived eras:') {
			const expected_pointer = notebook_path === null ? null : `${archive_path_for_notebook(notebook_path)}.`
			if (value !== 'none.' && (expected_pointer === null || value !== expected_pointer)) errors.push('STATUS Archived eras: must be none or one adjacent archive pointer')
		}
		if (field === 'Streams:') {
			stream_section = true
			if (line === 'Streams: none.') stream_none = true
			else if (line !== 'Streams:') errors.push('STATUS Streams: must be exactly Streams: or Streams: none.')
		}
	}

	for (const field of status_field_order) if (!seen.has(field)) errors.push(`STATUS is missing ${field}`)
	if (stream_section && !stream_none && !lines.some(line => status_stream_pattern.test(line))) errors.push('STATUS Streams: has no stream pointer or none value')
	return { valid: errors.length === 0, errors, ...(warnings.length ? { warnings: [...new Set(warnings)] } : {}) }
}

const normalise_role = role => {
	const raw = String(role || '').trim().toLowerCase()
	if (raw.includes('_')) throw new SettingsError(`unsupported public role value ${raw}`, { code: 'AG_TIER_INVALID' })
	return role_aliases[raw] || raw.replace(/[ ]+/g, '-')
}

const tier_for_role = role => {
	const key = normalise_role(role)
	const tier = role_tiers[key]
	if (!tier) throw new SettingsError(`no configured worker tier for role ${key || '<empty>'}`, { code: 'AG_TIER_INVALID' })
	return tier
}

const configured_tier_for_role = (config, role) => {
	const key = normalise_role(role)
	if (!pipeline_role_names.includes(key)) return { role: key, tier: tier_for_role(role) }
	const tier = config['pipeline-roles'][key]
	if (tier === 'off') throw new SettingsError(`pipeline stage ${key} is disabled by pipeline-roles.${key}=off; the full pipeline is unavailable when this stage is required`, { code: 'AG_STAGE_DISABLED' })
	return { role: key, tier }
}

const format_tier_substitution = (requested_tier, fallback_tier, reason) =>
	`tier substitution: ${requested_tier} → ${fallback_tier}; reason: ${reason}`

const resolve_profile_tier = (profile, tier) => {
	const value = profile && profile.tiers ? profile.tiers[tier] : undefined
	const parsed = parse_model_value(value)
	if (tier_name_error(tier) || !parsed || !Array.isArray(profile.command)) throw new SettingsError('selected external-worker profile has an invalid tier or command', { code: 'AG_DISPATCH_INVALID' })
	return {
		profile,
		executable: profile.command[0],
		args: profile.command.slice(1),
		model: parsed.model,
		effort: parsed.effort,
		tier,
	}
}

const resolve_worker_tier = (config, role_or_options, validation_options = {}) => {
	if (!is_plain_object(validation_options)) throw new SettingsError('worker selection by kind is unsupported; use external-worker profile selection', { code: 'AG_TIER_INVALID' })
	const options = is_plain_object(role_or_options) ? role_or_options : { role: role_or_options }
	if (has_own(options, 'worker_kind') || has_own(validation_options, 'worker_kind')) throw new SettingsError('worker selection by kind is unsupported; use external-worker profile selection', { code: 'AG_TIER_INVALID' })
	const role = options.role || options.operation || options.task
	assert_valid_config(config, validation_options)
	const configured = options.tier === undefined ? configured_tier_for_role(config, role) : { role: normalise_role(role), tier: options.tier }
	const tier = configured.tier
	if (tier_name_error(tier)) throw new SettingsError(`worker tier resolution requires a valid configured tier: ${tier_name_error(tier)}`, { code: 'AG_TIER_INVALID' })
	const provider = options.cli_provider === undefined
		? validation_options.cli_provider === undefined ? config.switches['cli-provider'] : validation_options.cli_provider
		: options.cli_provider
	const profile = select_profile(config, {
		...validation_options,
		disabled_profile_ids: options.disabled_profile_ids || validation_options.disabled_profile_ids,
		cli_provider: provider,
		host_family: options.host_family || validation_options.host_family || family_for_host(validation_options.active_host || validation_options.explicit_host || ''),
		required_tier: tier,
	})
	if (profile) return resolve_profile_tier(profile, tier)
	const original = select_profile(config, {
		...validation_options,
		disabled_profile_ids: options.disabled_profile_ids || validation_options.disabled_profile_ids,
		cli_provider: provider,
		host_family: options.host_family || validation_options.host_family || family_for_host(validation_options.active_host || validation_options.explicit_host || ''),
	})
	if (!original) throw no_eligible_profile_error(provider)
	if (!profile_has_tier(original, 'basic')) throw new SettingsError(`no eligible profile provides configured worker tier ${tier} or fallback basic`, { code: 'AG_DISPATCH_TIER_UNAVAILABLE' })
	const fallback = resolve_profile_tier(original, 'basic')
	return {
		...fallback,
		requested_tier: tier,
		fallback: { requested_tier: tier, tier: 'basic', reason: 'no eligible profile provides the requested tier' },
		record: format_tier_substitution(tier, 'basic', 'no eligible profile provides the requested tier'),
	}
}

const resolve_tier = (config, tier, options = {}) => resolve_worker_tier(config, { ...options, tier, role: options.role || tier }, options)

const resolve_threeways_worker = (config, options = {}) => {
	assert_valid_config(config, options)
	if (options.owner_exact_model === true) throw new SettingsError('an unavailable owner-selected exact model needs an owner decision; threeways must not substitute it', { code: 'AG_THREEWAYS_EXACT_MODEL' })
	const host_family = options.host_family || family_for_host(options.active_host || options.explicit_host || options.coordinator_host || '')
	const available = typeof options.executable_available === 'function'
		? options.executable_available
		: command => executable_available(command, options)
	const disabled = new Set(options.disabled_profile_ids instanceof Set ? options.disabled_profile_ids : Array.isArray(options.disabled_profile_ids) ? options.disabled_profile_ids : [])
	const candidates = config['external-workers']
		.filter(profile => profile && !disabled.has(profile.id) && profile_has_tier(profile, 'better') && available(profile.command[0]) === true)
		.sort((left, right) => right.priority - left.priority)
	if (candidates.length === 0) throw no_eligible_profile_error(config.switches['cli-provider'])
	const same_family = host_family ? candidates.find(profile => profile_family(profile) === host_family) : undefined
	const different_family = host_family && config.switches['cli-provider'] === 'on'
		? candidates.find(profile => profile_family(profile) && profile_family(profile) !== host_family)
		: undefined
	const profile = different_family || same_family || (config.switches['cli-provider'] === 'on' ? candidates[0] : undefined)
	if (!profile) throw no_eligible_profile_error(config.switches['cli-provider'])
	const family_known = Boolean(host_family && profile_family(profile))
	return {
		...resolve_profile_tier(profile, 'better'),
		stage_id: 'threeways',
		family_diversity: !family_known ? 'unknown' : different_family ? 'different-family' : 'same-family-fallback',
		limitation: !family_known ? 'host or worker family is unknown; family diversity cannot be established' : different_family ? undefined : 'different-family better worker unavailable or disallowed; same-family fallback recorded'
	}
}

const fallback_tiers = tier => {
	const index = tier_names.indexOf(tier)
	if (index < 0) {
		if (!tier_name_error(tier)) return tier === 'basic' ? [] : ['basic']
		throw new SettingsError(`unknown worker tier ${tier}`, { code: 'AG_TIER_INVALID' })
	}
	return tier_names
		.map((candidate, candidate_index) => ({ candidate, candidate_index }))
		.filter(item => item.candidate_index !== index)
		.sort((left, right) => Math.abs(left.candidate_index - index) - Math.abs(right.candidate_index - index) || right.candidate_index - left.candidate_index)
		.map(item => item.candidate)
}

const resolve_dispatch_failure = (config, selection, options = {}) => {
	if (selection === null || selection === undefined) {
		const provider = options.cli_provider === undefined ? config && config.switches ? config.switches['cli-provider'] : options.cli_provider : options.cli_provider
		throw no_eligible_profile_error(provider)
	}
	if (!selection || tier_name_error(selection.tier) || !selection.profile) {
		throw new SettingsError('dispatch failure resolution requires a resolved worker tier', { code: 'AG_DISPATCH_INVALID' })
	}
	if (options.owner_override === true || selection.owner_override === true) {
		throw new SettingsError('the owner-selected model is unavailable; ask before substituting another tier', { code: 'AG_DISPATCH_OWNER_STOP' })
	}
	const response_text = [options.stderr, options.stdout, options.response, options.reason].filter(value => typeof value === 'string').join('\n')
	if (/you(?:'|\u2019)ve hit your session limit|session limit\s*[\u00b7-]?\s*resets?/iu.test(response_text)) {
		const disabled_profile_ids = [...new Set([...(options.disabled_profile_ids || []), selection.profile.id])]
		const selection_tier = selection.requested_tier || selection.tier
		const profile = select_profile(config, {
			...options,
			disabled_profile_ids,
			cli_provider: options.cli_provider === undefined ? config.switches['cli-provider'] : options.cli_provider,
			required_tier: selection_tier,
		})
		let fallback
		let record
		if (profile) fallback = resolve_profile_tier(profile, selection_tier)
		else {
			const basic_profile = select_profile(config, {
				...options,
				disabled_profile_ids,
				cli_provider: options.cli_provider === undefined ? config.switches['cli-provider'] : options.cli_provider,
			})
			if (!basic_profile || !profile_has_tier(basic_profile, 'basic')) throw no_eligible_profile_error(options.cli_provider === undefined ? config.switches['cli-provider'] : options.cli_provider)
			fallback = resolve_profile_tier(basic_profile, 'basic')
			record = format_tier_substitution(selection_tier, 'basic', 'no other eligible profile provides the requested tier; selecting an available profile with basic')
		}
		return {
			kind: 'session_limit',
			original: selection,
			fallback,
			disabled_profile_ids,
			reason: 'provider subscription session limit',
			...(record ? { record } : {}),
		}
	}
	const value_text = value => {
		if (typeof value === 'string') return value
		if (value && typeof value.value === 'string') return value.value
		if (value && typeof value.model === 'string' && typeof value.effort === 'string') return `${value.model}/${value.effort}`
		return ''
	}
	const failed_values = new Set([
		...(options.failed_values instanceof Set ? [...options.failed_values] : Array.isArray(options.failed_values) ? options.failed_values : []),
		...(Array.isArray(options.failed_models) ? options.failed_models : []),
		...(Array.isArray(options.failed_selections) ? options.failed_selections : []),
		options.failed_value,
	].map(value_text).filter(Boolean))
	const selection_value = value_text(selection)
	failed_values.add(selection_value)
	const candidates = []
	for (const next_tier of fallback_tiers(selection.tier)) {
		const fallback = resolve_profile_tier(selection.profile, next_tier)
		if (failed_values.has(value_text(fallback))) continue
		candidates.push(fallback)
	}
	const fallback = candidates[0]
	if (!fallback) throw new SettingsError('no distinct configured worker value remains after the dispatch failure; stop and report the unavailable model', { code: 'AG_DISPATCH_UNAVAILABLE' })
	const reason = options.reason || 'selected model was unavailable during dispatch'
	return {
		original: selection,
		fallback,
		reason,
		substitution: `${selection_value} → ${value_text(fallback)}`,
		record: format_dispatch_substitution({ original: selection, fallback, reason }),
	}
}

const format_dispatch_substitution = ({ original, fallback, reason }) => {
	const value_text = value => {
		if (typeof value === 'string') return value
		if (value && typeof value.value === 'string') return value.value
		if (value && typeof value.model === 'string' && typeof value.effort === 'string') return `${value.model}/${value.effort}`
		return ''
	}
	const original_value = value_text(original) || '<unknown>'
	const fallback_value = value_text(fallback) || '<unknown>'
	return `model substitution: ${original_value} → ${fallback_value}; reason: ${reason || 'dispatch failure'}; coordinator-selected work may continue with the configured fallback`
}

const render_dispatch_substitution = format_dispatch_substitution

const switch_display_value = (config, key) => {
	if (Array.isArray(config.switches[key])) return JSON.stringify(config.switches[key])
	if (has_own(config.switches, key)) return config.switches[key]
	return completion_cleanup_defaults[key] ?? notebook_control_defaults[key] ?? (key === 'git-timeout-ms' ? git_timeout_default_ms : config.switches[key])
}

const format_settings_display = (config, options = {}) => {
	const validation = validate_config(config, options)
	const profiles = Array.isArray(config['external-workers']) ? config['external-workers'] : []
	const host = options.active_host || options.explicit_host || options.coordinator_host || 'unknown'
	const available = profile => executable_available(profile.command[0], options)
	const commands = [...new Set(profiles.map(profile => profile.command[0]))]
	const lines = [
		`schema-version: ${config['schema-version']}`,
		`host: ${host}`,
		'',
		'Switches:',
		...switch_names.map(key => `- ${key}: ${switch_display_value(config, key)}`),
		'',
		'Pipeline roles:',
		...pipeline_role_names.map(role => `- pipeline-roles.${role}: ${config['pipeline-roles'][role]}`),
		'',
		'External worker profiles:',
		...profiles.flatMap(profile => [
			`- ${profile.id}: command ${JSON.stringify(profile.command)}; priority ${profile.priority}; family ${profile_family(profile) || 'unknown'}`,
			...Object.keys(profile.tiers).map(tier => `- ${profile.id}.${tier}: ${profile.tiers[tier]}`),
		]),
		'',
		'Executable availability:',
		...commands.map(command => `- ${command}: ${available(profiles.find(profile => profile.command[0] === command)) ? 'available' : 'unavailable'}`),
		'',
		'Legal values and change syntax:',
		'- target-doc: repository-relative path ending in .md; use target-doc: <path>',
		'- cli-provider: off or on; use cli-provider: <value>',
		'- auto-reply: on or off; use auto-reply: <value>',
		'- log-verbosity: off, wip, or all (default all); controls RUN/WIP records, never Reply; use log-verbosity: <value>',
		'- inline-reply: on or off (default off); also display the saved Reply; use inline-reply: <value>',
		'- lang: non-empty language tag or existing language name; use lang: <value>',
		'- streams: ask, always, or off; use streams: <value>',
		'- ask-names: on or off; use ask-names: <value>',
		'- allow-ag: on, off, or ask; use allow-ag: <value>',
		'- large-work-minutes: integer from 1 through 10080; use large-work-minutes: <value>',
		`- git-timeout-ms: positive integer milliseconds (default ${git_timeout_default_ms}); use git-timeout-ms: <value>`,
		'- allowed-worker: JSON array of unique external, internal, or host values; use allowed-worker: ["external", "internal", "host"]',
		'- review-policy: prefer-independent or require-independent; use review-policy: <value>',
		'- completion-cleanup: off or on; use completion-cleanup: <value>',
		'- completion-cleanup-interval-days: integer from 1 through 365; use completion-cleanup-interval-days: <value>',
		'- pipeline roles: requirements, codewalk, explore, spike, spec, implementation, security-scan, acceptance, cross-check, or learn; use pipeline-roles.<stage>: off or <tier>',
		'- worker profiles: id, literal command array, priority 1 through 5, optional family, required best/better/basic/cheap tiers, and lowercase custom tiers; use <profile-id>.best: <value> or <profile-id>.<custom-tier>: <value>',
		'- profile model/effort values: parser-valid <model>/<effort>; model family is selected separately by cli-provider',
		'- target-doc: use the dedicated rename-target-document operation; it is not a generic atomic setting change',
	]
	if (validation.warnings.length > 0) lines.push('', ...validation.warnings.map(warning => warning))
	return lines.join('\n')
}

const settings_display = format_settings_display

const cli_usage = `usage: node ag-settings.js <init|validate|show|change|tier|rename> [options]\n\noptions:\n  --repo <path>       repository root (default: current directory)\n  --notebook <path>   applicable notebook (default: devlog.md)\n  --host <id>         explicit safe coordinator host identifier\n  --set <key: value>  one setting change; may be repeated\n\nchange also accepts key: value arguments after the repository options.\nallowed-worker accepts a JSON array; review-policy is prefer-independent or require-independent.\nsupported cleanup switches: completion-cleanup (off|on; default off), completion-cleanup-interval-days (integer 1 through 365; default 7).\nrename accepts --from <old-notebook> and --to <new-notebook> and performs the required two commits.`

const option_value = (args, index, name) => {
	if (index + 1 >= args.length) throw new SettingsError(`${name} requires a value`, { code: 'AG_CLI_INVALID' })
	return args[index + 1]
}

const parse_cli = argv => {
	const command = argv[0] || 'show'
	const options = { changes: [] }
	const rest = []
	for (let index = 1; index < argv.length; index += 1) {
		const arg = argv[index]
		if (arg === '--repo') { options.repo_root = option_value(argv, index, '--repo'); index += 1; continue }
		if (arg === '--notebook') { options.notebook_path = option_value(argv, index, '--notebook'); index += 1; continue }
		if (arg === '--host') { options.explicit_host = option_value(argv, index, '--host'); index += 1; continue }
		if (arg === '--session') { options.session = option_value(argv, index, '--session'); index += 1; continue }
		if (arg === '--config') { options.config_path = option_value(argv, index, '--config'); index += 1; continue }
		if (arg === '--from') { options.old_notebook = option_value(argv, index, '--from'); index += 1; continue }
		if (arg === '--to') { options.new_notebook = option_value(argv, index, '--to'); index += 1; continue }
		if (arg === '--set') { options.changes.push(option_value(argv, index, '--set')); index += 1; continue }
		if (arg === '--help' || arg === '-h') { options.help = true; continue }
		rest.push(arg)
	}
	options.rest = rest
	return { command, options }
}

const cli_main = (argv, io = {}) => {
	const output = io.output || console.log
	const error_output = io.error || console.error
	const parsed = parse_cli(argv)
	if (parsed.options.help || parsed.command === 'help') { output(cli_usage); return 0 }
	const options = parsed.options
	const repo_root = node_path.resolve(options.repo_root || io.cwd || process.cwd())
	const notebook_path = options.notebook_path || 'devlog.md'
	const common = { ...options, repo_root, notebook_path }

	if (parsed.command === 'init') {
		const result = initialize_project(common)
		output(`${result.created ? 'created' : 'validated'} ${display_path(result.config_path, repo_root)}`)
		return 0
	}

	const config_path = options.config_path || active_config_path(repo_root, notebook_path)
	if (parsed.command === 'validate') {
		const config = read_json_config(config_path, common)
		output(`valid ${display_path(config_path, repo_root)} for ${common.explicit_host || common.active_host || detect_host(common)}`)
		const validation = validate_config(config, common)
		for (const warning of validation.warnings) output(warning)
		return 0
	}
	if (parsed.command === 'show' || parsed.command === 'settings') {
		const config = read_json_config(config_path, common)
		output(format_settings_display(config, common))
		return 0
	}
	if (parsed.command === 'change' || parsed.command === 'set') {
		const changes = [...options.changes, ...parsed.options.rest]
		const result = change_configuration(config_path, changes, common)
		if (result.changes.length > 0) output(result.changes.join('\n'))
		return 0
	}
	if (parsed.command === 'rename') {
		const result = rename_target_document({ ...common, old_notebook: options.old_notebook || parsed.options.rest[0], new_notebook: options.new_notebook || parsed.options.rest[1] })
		output(`renamed ${result.old_notebook} → ${result.new_notebook} in two commits`)
		return 0
	}
	if (parsed.command === 'tier') {
		if (parsed.options.rest.length !== 1) throw new SettingsError('worker selection by kind is unsupported; provide one role', { code: 'AG_CLI_INVALID' })
		const role = parsed.options.rest[0]
		const config = read_json_config(config_path, common)
		output(JSON.stringify(resolve_worker_tier(config, role, common)))
		return 0
	}

	error_output(cli_usage)
	return 1
}

module.exports = {
	SettingsError,
	schema_version,
	git_timeout_default_ms,
	tier_names,
	pipeline_role_names,
	mandatory_pipeline_roles,
	switch_names,
	optional_switch_names,
	completion_cleanup_defaults,
	notebook_control_defaults,
	notebook_controls,
	read_notebook_controls,
	host_markers,
	role_tiers,
	role_aliases,
	host_template_values,
	normalise_host,
	normalise_policy,
	worker_policy,
	host_identity,
	normalise_host_identity,
	migrate_config,
	make_template,
	detect_initial_language,
	template_for_host,
	detect_host_info,
	detect_host,
	family_for_host,
	opposite_host,
	executable_available,
	executable_availability,
	validate_config,
	assert_valid_config,
	target_doc_errors,
	workspace_dir_errors,
	workspace_dir_for,
	workspace_paths,
	parse_model_value,
	select_profile,
	profile_family,
	resolve_config_path,
	active_config_path,
	applicable_config_path,
	configured_git_timeout_ms,
	display_path,
	duplicate_json_key,
	read_json_config,
	load_config,
	read_config,
	write_text_atomic,
	canonical_config,
	serialize_config,
	write_config_atomic,
	status_region,
	ensure_configuration,
	initialize_project,
	format_ask_heading,
	copy_for_notebook,
	copy_configuration,
	relocate_configuration,
	move_config_for_target_doc,
	archive_path_for_notebook,
	forwarding_card_target,
	carry_forward_card,
	rename_target_document,
	rename_target_doc,
	parse_change_lines,
	apply_changes,
	change_configuration,
	format_status,
	validate_status_projection,
	tier_for_role,
	configured_tier_for_role,
	resolve_worker_tier,
	resolve_tier,
	resolve_threeways_worker,
	fallback_tiers,
	resolve_dispatch_failure,
	format_dispatch_substitution,
	render_dispatch_substitution,
	format_settings_display,
	settings_display,
	cli_main,
}

if (require.main === module) {
	try {
		process.exitCode = cli_main(process.argv.slice(2))
	} catch (error) {
		console.error(error instanceof SettingsError ? error.message : 'settings command failed')
		process.exitCode = 1
	}
}
