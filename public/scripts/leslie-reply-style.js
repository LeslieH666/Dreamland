/**
 * Leslie reply-style settings and prompt builder.
 *
 * Phase 2.5.3: the implementation moved to src/prompt-assembly/reply-style.js so the
 * server can build the same block. The module has no browser imports, so this file is a
 * plain re-export and every existing call site keeps working.
 */

export * from '/prompt-assembly/reply-style.js';
