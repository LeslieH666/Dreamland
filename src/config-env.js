/**
 * 12-factor configuration for DreamLand.
 *
 * Every documented setting can be supplied as a `DREAMLAND_*` environment
 * variable. Those values take priority over `config.yaml`, over the legacy
 * `SILLYTAVERN_*` variables, and over the built-in defaults, so a server
 * deployment can ship a config file with no secrets in it at all.
 *
 * This module must not import src/util.js: src/util.js imports it, so a cycle
 * would form. Only node built-ins are used.
 */

import fs from 'node:fs';

export const DREAMLAND_ENV_PREFIX = 'DREAMLAND_';
export const LEGACY_ENV_PREFIX = 'SILLYTAVERN_';

/** Mounted secret document for upstream API keys. */
export const SECRETS_FILE_ENV = 'DREAMLAND_SECRETS_FILE';
export const DEFAULT_SECRETS_FILE = '/run/secrets/dreamland-secrets.json';
/** Per-key secret variable, e.g. DREAMLAND_SECRET_API_KEY_OPENAI. */
export const SECRET_ENV_PREFIX = 'DREAMLAND_SECRET_';

/**
 * Documented `DREAMLAND_*` variables that do not follow the automatic
 * `DREAMLAND_<CONFIG_KEY>` derivation, plus the ones worth listing in help.
 * @type {Readonly<Record<string, string>>}
 */
export const CONFIG_ENV_KEYS = Object.freeze({
    'dataRoot': 'DREAMLAND_DATA_ROOT',
    'configPath': 'DREAMLAND_CONFIG_PATH',
    'port': 'DREAMLAND_PORT',
    'listen': 'DREAMLAND_LISTEN',
    'listenAddress.ipv4': 'DREAMLAND_LISTEN_ADDRESS_IPV4',
    'listenAddress.ipv6': 'DREAMLAND_LISTEN_ADDRESS_IPV6',
    'whitelistMode': 'DREAMLAND_WHITELIST_MODE',
    'whitelist': 'DREAMLAND_IP_WHITELIST',
    'whitelistDockerHosts': 'DREAMLAND_WHITELIST_DOCKER_HOSTS',
    'enableForwardedWhitelist': 'DREAMLAND_ENABLE_FORWARDED_WHITELIST',
    'hostWhitelist.enabled': 'DREAMLAND_HOST_WHITELIST_ENABLED',
    'hostWhitelist.hosts': 'DREAMLAND_HOST_WHITELIST_HOSTS',
    'hostWhitelist.scan': 'DREAMLAND_HOST_WHITELIST_SCAN',
    'basicAuthMode': 'DREAMLAND_BASIC_AUTH_MODE',
    'basicAuthUser.username': 'DREAMLAND_BASIC_AUTH_USER',
    'basicAuthUser.password': 'DREAMLAND_BASIC_AUTH_PASSWORD',
    'heartbeatInterval': 'DREAMLAND_HEARTBEAT_INTERVAL',
    'ssl.enabled': 'DREAMLAND_SSL_ENABLED',
    'ssl.certPath': 'DREAMLAND_SSL_CERT_PATH',
    'ssl.keyPath': 'DREAMLAND_SSL_KEY_PATH',
    'cors.enabled': 'DREAMLAND_CORS_ENABLED',
    'cors.origin': 'DREAMLAND_CORS_ORIGIN',
    'cors.methods': 'DREAMLAND_CORS_METHODS',
    'cors.allowedHeaders': 'DREAMLAND_CORS_ALLOWED_HEADERS',
    'cors.exposedHeaders': 'DREAMLAND_CORS_EXPOSED_HEADERS',
    'cors.credentials': 'DREAMLAND_CORS_CREDENTIALS',
    'cors.maxAge': 'DREAMLAND_CORS_MAX_AGE',
    'storage.cookieSecret': 'DREAMLAND_COOKIE_SECRET',
    'browserLaunch.enabled': 'DREAMLAND_BROWSER_LAUNCH_ENABLED',
    'enableCorsProxy': 'DREAMLAND_CORS_PROXY',
    'requestProxy.enabled': 'DREAMLAND_REQUEST_PROXY_ENABLED',
    'requestProxy.url': 'DREAMLAND_REQUEST_PROXY_URL',
    'allowKeysExposure': 'DREAMLAND_ALLOW_KEYS_EXPOSURE',
});

/** Config keys that carry a credential and must not be logged. */
export const SECRET_CONFIG_KEYS = Object.freeze([
    'basicAuthUser.password',
    'storage.cookieSecret',
]);

/**
 * Derive the environment variable for a config key.
 * @param {string} key Config key, e.g. `cors.origin`.
 * @param {string} [prefix] Environment prefix.
 * @returns {string} Environment variable name.
 */
export function configKeyToEnvKey(key, prefix = DREAMLAND_ENV_PREFIX) {
    return prefix + String(key).toUpperCase().replace(/\./g, '_');
}

/**
 * Find a `DREAMLAND_*` override for a config key.
 * @param {string} key Config key.
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [environment] Environment source.
 * @returns {{envKey: string, raw: string} | null} The override, if any.
 */
export function findDreamlandEnvOverride(key, environment = process.env) {
    if (!environment) {
        return null;
    }
    const mapped = CONFIG_ENV_KEYS[key] ?? configKeyToEnvKey(key);
    const candidates = mapped === configKeyToEnvKey(key) ? [mapped] : [mapped, configKeyToEnvKey(key)];
    for (const envKey of candidates) {
        if (envKey in environment && environment[envKey] !== undefined) {
            return { envKey, raw: String(environment[envKey]) };
        }
    }
    return null;
}

/**
 * List the active `DREAMLAND_*` overrides, with credential values redacted.
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [environment] Environment source.
 * @returns {Array<{key: string, envKey: string, value: string, secret: boolean}>} Active overrides.
 */
export function listConfigEnvOverrides(environment = process.env) {
    const seen = new Set();
    const entries = [];
    for (const key of Object.keys(CONFIG_ENV_KEYS)) {
        const found = findDreamlandEnvOverride(key, environment);
        if (!found || seen.has(found.envKey)) {
            continue;
        }
        seen.add(found.envKey);
        const secret = SECRET_CONFIG_KEYS.includes(key);
        entries.push({ key, envKey: found.envKey, value: secret ? '[redacted]' : found.raw, secret });
    }
    return entries;
}

/**
 * Normalize a secret key for environment lookup.
 * @param {string} key Secret key, e.g. `api_key_openai`.
 * @returns {string} Environment variable name.
 */
export function secretKeyToEnvKey(key) {
    return SECRET_ENV_PREFIX + String(key).toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

/**
 * Read the mounted secret document, if one is configured and readable.
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [environment] Environment source.
 * @param {{readFile?: (file: string) => string, exists?: (file: string) => boolean}} [io] Filesystem hooks for tests.
 * @returns {{path: string, secrets: Record<string, unknown>} | null} Parsed document, if present.
 */
export function readMountedSecrets(environment = process.env, io = {}) {
    const configured = String(environment?.[SECRETS_FILE_ENV] ?? '').trim();
    const candidates = configured ? [configured] : [DEFAULT_SECRETS_FILE];
    const exists = io.exists ?? (file => fs.existsSync(file));
    for (const file of candidates) {
        try {
            if (!exists(file)) {
                continue;
            }
            const raw = (io.readFile ?? (target => fs.readFileSync(target, 'utf8')))(file);
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return { path: file, secrets: parsed };
            }
        } catch (error) {
            console.warn(`Could not read the mounted secret file at ${file}: ${error?.message || error}`);
        }
    }
    return null;
}

/**
 * Resolve a secret from the environment or the mounted secret document.
 * @param {string} key Secret key.
 * @param {{environment?: NodeJS.ProcessEnv | Record<string, string | undefined>, mounted?: {secrets: Record<string, unknown>} | null}} [options] Resolution input.
 * @returns {{value: string, source: 'env' | 'mounted-file', envKey?: string} | null} The resolved secret.
 */
export function readEnvSecret(key, { environment = process.env, mounted = undefined } = {}) {
    const envKey = secretKeyToEnvKey(key);
    const raw = environment?.[envKey];
    if (raw !== undefined && String(raw).trim() !== '') {
        return { value: String(raw), source: 'env', envKey };
    }
    const document = mounted === undefined ? readMountedSecrets(environment) : mounted;
    const entry = document?.secrets?.[key];
    if (entry === undefined) {
        return null;
    }
    const value = typeof entry === 'string' ? entry : (entry && typeof entry === 'object' ? entry.value : undefined);
    return typeof value === 'string' && value.trim() !== ''
        ? { value, source: 'mounted-file' }
        : null;
}

/**
 * List the secret keys supplied by the environment or a mounted document.
 * @param {{environment?: NodeJS.ProcessEnv | Record<string, string | undefined>, mounted?: {secrets: Record<string, unknown>} | null, knownKeys?: string[]}} [options] Resolution input.
 * @returns {Map<string, {source: string}>} Keys that are externally configured.
 */
export function listEnvSecretKeys({ environment = process.env, mounted = undefined, knownKeys = [] } = {}) {
    const document = mounted === undefined ? readMountedSecrets(environment) : mounted;
    const found = new Map();
    for (const key of knownKeys) {
        const resolved = readEnvSecret(key, { environment, mounted: document });
        if (resolved) {
            found.set(key, { source: resolved.source });
        }
    }
    for (const key of Object.keys(document?.secrets ?? {})) {
        if (!found.has(key)) {
            const resolved = readEnvSecret(key, { environment, mounted: document });
            if (resolved) {
                found.set(key, { source: resolved.source });
            }
        }
    }
    return found;
}

/**
 * Whether the process is configured to take secrets from the environment.
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [environment] Environment source.
 * @returns {boolean} True when at least one external secret source is configured.
 */
export function hasExternalSecretSource(environment = process.env) {
    if (String(environment?.[SECRETS_FILE_ENV] ?? '').trim() !== '') {
        return true;
    }
    return Object.keys(environment ?? {}).some(name => name.startsWith(SECRET_ENV_PREFIX) && name !== SECRETS_FILE_ENV);
}
