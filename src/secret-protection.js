/**
 * Secret-file protection primitives.
 *
 * This module owns the on-disk secret document format and the low-level
 * protectors. *Which* protector a deployment uses is a platform decision and
 * lives in src/platform/secret-store.js.
 *
 * Supported formats:
 *   - plaintext (no protector): the JSON map itself;
 *   - `leslie-dpapi-v1`: Windows DPAPI under the current user (desktop);
 *   - `leslie-aes-gcm-v1`: AES-256-GCM under a scrypt-derived key (server).
 */

import { spawnSync } from 'node:child_process';

export const PROTECTED_SECRETS_FORMAT = 'leslie-dpapi-v1';
/** Server-side encryption-at-rest format (AES-256-GCM under a scrypt-derived key). */
export const AES_SECRETS_FORMAT = 'leslie-aes-gcm-v1';

/**
 * Format tag a protector writes.
 * @param {{format?: string}} [protector] Protector.
 * @returns {string} Format tag.
 */
export function protectorFormat(protector) {
    return protector?.format ?? PROTECTED_SECRETS_FORMAT;
}

const PROTECT_SCRIPT = `
$ErrorActionPreference = 'Stop'
try {
    Add-Type -AssemblyName System.Security
    $plain = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())
    $encrypted = [Security.Cryptography.ProtectedData]::Protect($plain, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    [Console]::Out.Write([Convert]::ToBase64String($encrypted))
} catch {
    [Console]::Error.Write('DPAPI protection failed')
    exit 1
}`;

const UNPROTECT_SCRIPT = `
$ErrorActionPreference = 'Stop'
try {
    Add-Type -AssemblyName System.Security
    $encrypted = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())
    $plain = [Security.Cryptography.ProtectedData]::Unprotect($encrypted, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    [Console]::Out.Write([Convert]::ToBase64String($plain))
} catch {
    [Console]::Error.Write('DPAPI unprotection failed')
    exit 1
}`;

/**
 * Run the Windows DPAPI helper.
 * @param {string} script PowerShell script.
 * @param {Buffer} bytes Input bytes.
 * @returns {Buffer} Output bytes.
 */
function runDpapi(script, bytes) {
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
        input: bytes.toString('base64'),
        encoding: 'utf8',
        windowsHide: true,
        timeout: 15000,
        maxBuffer: 16 * 1024 * 1024,
    });
    const output = result.stdout?.trim();
    if (result.error || result.status !== 0 || !output || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(output)) {
        throw new Error(`Windows user-level secret protection is unavailable (${result.error?.code || result.status}).`);
    }
    return Buffer.from(output, 'base64');
}

/**
 * Build the Windows DPAPI protector.
 * @returns {{format: string, protect: (bytes: Buffer) => Buffer, unprotect: (bytes: Buffer) => Buffer}} Protector.
 */
export function createDpapiProtector() {
    return {
        format: PROTECTED_SECRETS_FORMAT,
        protect: bytes => runDpapi(PROTECT_SCRIPT, bytes),
        unprotect: bytes => runDpapi(UNPROTECT_SCRIPT, bytes),
    };
}

function validateSecretsObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('The local secrets file has an invalid structure.');
    }
    return value;
}

/**
 * Parse a secret document that may be plaintext, DPAPI-protected or
 * AES-protected. Pass one protector or a list of them; the one whose `format`
 * matches the document is used, so a desktop file and a server file can both be
 * read during a migration.
 * @param {string} contents Raw file contents.
 * @param {object | object[] | null} [protectors] Protector(s) able to open the document.
 * @returns {{secrets: object, protected: boolean}} Parsed document.
 */
export function parseSecretDocument(contents, protectors = null) {
    const document = validateSecretsObject(JSON.parse(contents));
    if (document.format === undefined) {
        return { secrets: document, protected: false };
    }
    const available = Array.isArray(protectors)
        ? protectors.filter(Boolean)
        : (protectors ? [protectors] : []);
    const match = available.find(protector => protectorFormat(protector) === document.format);
    if (typeof document.data !== 'string' || !match) {
        throw new Error(
            `The protected local secrets (${document.format}) cannot be opened here: `
            + 'the matching protector is not available on this deployment.',
        );
    }
    const plaintext = match.unprotect(Buffer.from(document.data, 'base64'));
    return { secrets: validateSecretsObject(JSON.parse(plaintext.toString('utf8'))), protected: true };
}

/**
 * Serialize a secret document, protecting it when a protector is supplied.
 * @param {object} secrets Secret map.
 * @param {object | null} [protector] Protector to use.
 * @returns {string} File contents.
 */
export function serializeSecretDocument(secrets, protector = null) {
    validateSecretsObject(secrets);
    if (!protector) {
        return JSON.stringify(secrets, null, 4);
    }
    const data = protector.protect(Buffer.from(JSON.stringify(secrets), 'utf8')).toString('base64');
    return JSON.stringify({ format: protectorFormat(protector), data }, null, 4);
}
