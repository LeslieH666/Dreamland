/**
 * Platform injection: secret storage.
 *
 * The core reads and writes one secret file format, but *where the key comes
 * from* and *how the file is protected at rest* differ per deployment:
 *
 *   - desktop: the Windows DPAPI protector (per Windows user) or, on other
 *     desktops, a plain local file plus the mounted/environment source;
 *   - server: AES-256-GCM under a key supplied through the environment or a
 *     mounted secret, with the environment/mounted provider authoritative.
 *
 * Only this module and the platform entry point may look at the process
 * platform; business code just asks for `getPlatform().secrets`.
 */

import crypto from 'node:crypto';

import { AES_SECRETS_FORMAT, createDpapiProtector } from '../secret-protection.js';
import { getConfigValue, isConfigPathSet } from '../util.js';
import { hasExternalSecretSource } from '../config-env.js';

export const SECRET_ENCRYPTION_KEY_ENV = 'DREAMLAND_SECRET_ENCRYPTION_KEY';
const SCRYPT_SALT = 'dreamland-secret-store-v1';
const AES_ALGORITHM = 'aes-256-gcm';
const AES_IV_BYTES = 12;
const AES_TAG_BYTES = 16;

/**
 * Derive the AES key from the configured passphrase.
 * @param {string} passphrase Secret passphrase.
 * @returns {Buffer} 32-byte key.
 */
function deriveAesKey(passphrase) {
    return crypto.scryptSync(passphrase, SCRYPT_SALT, 32);
}

/**
 * AES-256-GCM protector (server). The stored blob is
 * `iv || authTag || ciphertext`, so a tampered file fails to open instead of
 * silently returning wrong plaintext.
 * @param {string} passphrase Secret passphrase.
 * @returns {{format: string, protect: (bytes: Buffer) => Buffer, unprotect: (bytes: Buffer) => Buffer}} Protector.
 */
export function createAesProtector(passphrase) {
    const key = deriveAesKey(passphrase);
    return {
        format: AES_SECRETS_FORMAT,
        protect(bytes) {
            const iv = crypto.randomBytes(AES_IV_BYTES);
            const cipher = crypto.createCipheriv(AES_ALGORITHM, key, iv);
            const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
            return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
        },
        unprotect(blob) {
            if (!Buffer.isBuffer(blob) || blob.length <= AES_IV_BYTES + AES_TAG_BYTES) {
                throw new Error('The encrypted secrets file is truncated.');
            }
            const iv = blob.subarray(0, AES_IV_BYTES);
            const tag = blob.subarray(AES_IV_BYTES, AES_IV_BYTES + AES_TAG_BYTES);
            const ciphertext = blob.subarray(AES_IV_BYTES + AES_TAG_BYTES);
            const decipher = crypto.createDecipheriv(AES_ALGORITHM, key, iv);
            decipher.setAuthTag(tag);
            return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        },
    };
}

/**
 * Resolve the secret storage for this deployment.
 * @param {{mode: string, environment?: NodeJS.ProcessEnv | Record<string, string | undefined>, platform?: string}} options Resolution input.
 * @returns {SecretStorage} Secret storage descriptor.
 */
export function resolveSecretStorage({ mode, environment = process.env, platform = process.platform }) {
    /** @type {object[]} */
    const protectors = [];
    /** @type {object | null} */
    let protector = null;
    let kind = 'plaintext';

    // The environment always wins; the config fallback is only consulted once
    // a config file path exists (the desktop host builds the platform before
    // the server core has parsed its arguments).
    const configuredKey = isConfigPathSet() ? getConfigValue('apiV1.secretEncryptionKey', '') : '';
    const encryptionKey = String(
        environment?.[SECRET_ENCRYPTION_KEY_ENV] ?? configuredKey ?? '',
    ).trim();

    if (encryptionKey) {
        const aes = createAesProtector(encryptionKey);
        protectors.push(aes);
        protector = aes;
        kind = 'aes-gcm';
    }

    // A desktop install keeps DPAPI as the writer unless the operator asked for
    // encryption-at-rest through the environment.
    if (platform === 'win32' && !protector) {
        try {
            const dpapi = createDpapiProtector();
            protectors.push(dpapi);
            protector = dpapi;
            kind = 'dpapi';
        } catch {
            console.warn('Windows secret protection is unavailable; the local secrets file stays in plaintext.');
        }
    } else if (platform === 'win32') {
        // Keep the ability to read a DPAPI file after switching to AES.
        protectors.push(createDpapiProtector());
    }

    const externalSecretSourceConfigured = hasExternalSecretSource(environment);

    return {
        kind,
        format: protector?.format ?? 'plaintext',
        protectors,
        protector,
        externalSecretSourceConfigured,
        description: kind === 'aes-gcm'
            ? `AES-256-GCM at rest (key from ${SECRET_ENCRYPTION_KEY_ENV})`
            : kind === 'dpapi'
                ? 'Windows DPAPI under the current user'
                : 'plain local file',
    };
}
