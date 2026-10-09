/**
 * Minimal `.dockerignore` matcher.
 *
 * The server image build context is the repository root filtered by
 * `.dockerignore`. This module evaluates that file with Docker's semantics —
 * a pattern that matches a directory also excludes everything beneath it, a
 * leading `/` anchors to the context root, and `!` re-includes — so the build
 * scripts and their regression tests can prove that the desktop host, the
 * mobile clients and the packaging/test trees never enter the server image.
 *
 * It is an approximation of Go's `filepath.Match` for the subset of patterns
 * this repository actually uses (`*` inside a segment, `**` for any depth).
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * Match one path segment against one glob segment.
 * @param {string} pattern Segment pattern (may contain `*`).
 * @param {string} value Segment value.
 * @returns {boolean} Whether the segment matches.
 */
function matchSegment(pattern, value) {
    const escaped = pattern
        .split('*')
        .map(part => part.replace(/[.+^${}()|[\]\\?]/g, '\\$&'))
        .join('[^/]*');
    return new RegExp(`^${escaped}$`).test(value);
}

/**
 * Read and normalize the patterns of a `.dockerignore` file.
 * @param {string} file Path to the ignore file.
 * @returns {string[]} Patterns.
 */
export function readDockerIgnorePatterns(file) {
    if (!fs.existsSync(file)) {
        return [];
    }
    return fs.readFileSync(file, 'utf8')
        .split('\n')
        .map(line => line.trim())
        .filter(line => line !== '' && !line.startsWith('#'));
}

/**
 * Whether one pattern excludes a context-relative path.
 * @param {string} file Context-relative path (POSIX separators).
 * @param {string} pattern Raw pattern.
 * @returns {{hit: boolean, negated: boolean}} Match result.
 */
export function matchDockerIgnorePattern(file, pattern) {
    const negated = pattern.startsWith('!');
    const raw = negated ? pattern.slice(1) : pattern;
    const anchored = raw.startsWith('/');
    const body = anchored ? raw.slice(1) : raw;
    const patternSegments = body.split('/');
    const fileSegments = file.split('/');

    if (!body.includes('/')) {
        const hit = fileSegments.some(segment => matchSegment(body, segment));
        return { hit, negated };
    }

    if (body.endsWith('/**')) {
        const base = patternSegments.slice(0, -1);
        const hit = fileSegments.length > base.length
            && base.every((segment, index) => matchSegment(segment, fileSegments[index]));
        return { hit, negated };
    }

    // Docker also excludes everything under a matched directory, so a pattern
    // may match any ancestor prefix of the path.
    const matchesAt = offset => patternSegments.every((segment, index) => matchSegment(segment, fileSegments[offset + index] ?? ''));
    let hit = false;
    if (anchored) {
        hit = fileSegments.length >= patternSegments.length && matchesAt(0);
    } else {
        for (let offset = 0; offset + patternSegments.length <= fileSegments.length; offset++) {
            if (matchesAt(offset)) {
                hit = true;
                break;
            }
        }
    }
    return { hit, negated };
}

/**
 * Whether a path would be excluded from the build context.
 * @param {string} file Context-relative path.
 * @param {string[]} patterns Normalized patterns.
 * @returns {boolean} Whether the path is excluded.
 */
export function isExcluded(file, patterns) {
    let excluded = false;
    for (const pattern of patterns) {
        const { hit, negated } = matchDockerIgnorePattern(file, pattern);
        if (hit) {
            excluded = !negated;
        }
    }
    return excluded;
}

/**
 * Filter a file list with the ignore patterns.
 * @param {string[]} files Context-relative paths.
 * @param {string[]} patterns Normalized patterns.
 * @returns {{kept: string[], excluded: string[]}} Partition.
 */
export function partitionContext(files, patterns) {
    const kept = [];
    const excluded = [];
    for (const file of files) {
        (isExcluded(file, patterns) ? excluded : kept).push(file);
    }
    return { kept, excluded };
}

/**
 * Resolve the repository root from a script inside `scripts/`.
 * @param {string} fromFile Absolute path of the calling module.
 * @returns {string} Absolute repository root.
 */
export function projectRootFrom(fromFile) {
    return path.resolve(path.dirname(fromFile), '..');
}
