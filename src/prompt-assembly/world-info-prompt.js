/**
 * World Info prompt building and the getWorldInfoPrompt entry point
 * (Phase 2.5.2 step 4, substep 4).
 *
 * The build half of checkWorldInfo and the getWorldInfoPrompt wrapper move here.
 * Ambient reads are injected: the Author's Note binding (NOTE_MODULE_NAME,
 * metadata_keys, shouldWIAddPrompt), extension settings, chat metadata, the regex
 * engine, and the WORLD_INFO_ACTIVATED emit.
 *
 * assertWorldInfoPortable is wired here but only when `env.enforcePortability` is
 * set. The browser must NOT run it: the browser IS the reference implementation,
 * so a user with World Info regex rules would start throwing. The server sets the
 * flag and fails closed instead of assembling a prompt that would differ.
 */

import { DEFAULT_DEPTH, wi_anchor_position, world_info_position } from './world-info-enums.js';
import { scanWorldInfo } from './world-info-scan.js';
import { assertWorldInfoPortable } from './world-info-portability.js';

export async function checkWorldInfo(chat, maxContext, isDryRun, globalScanData, env) {
    const scan = await scanWorldInfo(chat, maxContext, isDryRun, globalScanData, env);

    if (scan.empty) {
        return { worldInfoBefore: '', worldInfoAfter: '', WIDepthEntries: [], EMEntries: [], ANBeforeEntries: [], ANAfterEntries: [], outletEntries: {}, allActivatedEntries: new Set() };
    }

    return buildWorldInfoPrompt(scan, isDryRun, env);
}

/**
 * Build the prompt fragments from an activated scan.
 * @param {object} scan Result of scanWorldInfo.
 * @param {boolean} isDryRun Dry-run flag.
 * @param {object} env Environment.
 * @returns {object} Activated World Info fragments.
 */
export function buildWorldInfoPrompt(scan, isDryRun, env) {
    const { allActivatedEntries, buffer, timedEffects } = scan;
    const context = env.getContext();

    console.debug('[WI] --- BUILDING PROMPT ---');

    // Forward-sorted list of entries for joining
    const WIBeforeEntries = [];
    const WIAfterEntries = [];
    const EMEntries = [];
    const ANTopEntries = [];
    const ANBottomEntries = [];
    const WIDepthEntries = [];
    /** @type {{[key: string]: string[]}} */
    const WIOutletEntries = {};

    // Appends from insertion order 999 to 1. Use unshift for this purpose
    // TODO (kingbri): Change to use WI Anchor positioning instead of separate top/bottom arrays
    [...allActivatedEntries.values()].sort(env.sortFn).forEach((entry) => {
        const regexDepth = entry.position === world_info_position.atDepth ? (entry.depth ?? DEFAULT_DEPTH) : null;
        const content = env.getRegexedString(entry.content, env.regexPlacement.worldInfo, { depth: regexDepth, isMarkdown: false, isPrompt: true });

        if (!content) {
            console.debug(`[WI] Entry ${entry.uid}`, 'skipped adding to prompt due to empty content', entry);
            return;
        }

        switch (entry.position) {
            case world_info_position.before:
                WIBeforeEntries.unshift(content);
                break;
            case world_info_position.after:
                WIAfterEntries.unshift(content);
                break;
            case world_info_position.EMTop:
                EMEntries.unshift(
                    { position: wi_anchor_position.before, content: content },
                );
                break;
            case world_info_position.EMBottom:
                EMEntries.unshift(
                    { position: wi_anchor_position.after, content: content },
                );
                break;
            case world_info_position.ANTop:
                ANTopEntries.unshift(content);
                break;
            case world_info_position.ANBottom:
                ANBottomEntries.unshift(content);
                break;
            case world_info_position.atDepth: {
                const existingDepthIndex = WIDepthEntries.findIndex((e) => e.depth === (entry.depth ?? DEFAULT_DEPTH) && e.role === (entry.role ?? env.extensionPromptRoles.SYSTEM));
                if (existingDepthIndex !== -1) {
                    WIDepthEntries[existingDepthIndex].entries.unshift(content);
                } else {
                    WIDepthEntries.push({
                        depth: entry.depth,
                        entries: [content],
                        role: entry.role ?? env.extensionPromptRoles.SYSTEM,
                    });
                }
                break;
            }
            case world_info_position.outlet: {
                if (!entry.outletName) {
                    console.warn(`[WI] Entry ${entry.uid} has position 'outlet' but no outlet name. Skipping.`);
                    break;
                }
                if (Array.isArray(WIOutletEntries[entry.outletName])) {
                    WIOutletEntries[entry.outletName].push(content);
                } else {
                    WIOutletEntries[entry.outletName] = [content];
                }
                break;
            }
            default:
                break;
        }
    });

    const worldInfoBefore = WIBeforeEntries.length ? WIBeforeEntries.join('\n') : '';
    const worldInfoAfter = WIAfterEntries.length ? WIAfterEntries.join('\n') : '';

    if (env.getShouldWIAddPrompt()) {
        const originalAN = context.extensionPrompts[env.noteModuleName].value;
        const ANWithWI = `${ANTopEntries.join('\n')}\n${originalAN}\n${ANBottomEntries.join('\n')}`.replace(/(^\n)|(\n$)/g, '');
        context.setExtensionPrompt(env.noteModuleName, ANWithWI, env.getChatMetadata()[env.metadataKeys.position], env.getChatMetadata()[env.metadataKeys.depth], env.getExtensionSettings().note.allowWIScan, env.getChatMetadata()[env.metadataKeys.role]);
    }

    timedEffects.setTimedEffects(Array.from(allActivatedEntries.values()));
    buffer.resetExternalEffects();
    timedEffects.cleanUp();

    console.log(`[WI] ${isDryRun ? 'Hypothetically adding' : 'Adding'} ${allActivatedEntries.size} entries to prompt`, Array.from(allActivatedEntries.values()));
    console.debug(`[WI] --- DONE${isDryRun ? ' (DRY RUN)' : ''} ---`);

    return { worldInfoBefore, worldInfoAfter, EMEntries, WIDepthEntries, ANBeforeEntries: ANTopEntries, ANAfterEntries: ANBottomEntries, outletEntries: WIOutletEntries, allActivatedEntries: new Set(allActivatedEntries.values()) };
}

/**
 * Only leaves entries with the highest key matching score in each group.
 * @param {Record<string, WIScanEntry[]>} groups The groups to filter
 * @param {WorldInfoBuffer} buffer The buffer to use for scoring
 * @param {(entry: WIScanEntry) => void} removeEntry The function to remove an entry
 * @param {number} scanState The current scan state
 * @param {Map<string, boolean>} hasStickyMap The sticky entries map
 */

export async function getWorldInfoPrompt(chat, maxContext, isDryRun, globalScanData, env) {
    if (env.enforcePortability) {
        // Server-only: refuse to assemble a prompt that would differ from the
        // browser's (World Info regex rules, the vectors extension, or a
        // WORLDINFO_SCAN_DONE listener). The browser leaves this falsy.
        assertWorldInfoPortable({
            regexScripts: env.getRegexScripts?.() ?? [],
            regexDisabled: env.isRegexDisabled?.() ?? false,
            vectorsEnabled: env.isVectorsEnabled?.() ?? false,
            scanDoneListenerCount: env.getScanDoneListenerCount?.() ?? 0,
        });
    }

    let worldInfoString = '', worldInfoBefore = '', worldInfoAfter = '';

    const activatedWorldInfo = await checkWorldInfo(chat, maxContext, isDryRun, globalScanData, env);
    worldInfoBefore = activatedWorldInfo.worldInfoBefore;
    worldInfoAfter = activatedWorldInfo.worldInfoAfter;
    worldInfoString = worldInfoBefore + worldInfoAfter;

    if (!isDryRun && activatedWorldInfo.allActivatedEntries && activatedWorldInfo.allActivatedEntries.size > 0) {
        const arg = Array.from(activatedWorldInfo.allActivatedEntries.values());
        await env.emitWorldInfoActivated(arg);
    }

    return {
        worldInfoString,
        worldInfoBefore,
        worldInfoAfter,
        worldInfoExamples: activatedWorldInfo.EMEntries ?? [],
        worldInfoDepth: activatedWorldInfo.WIDepthEntries ?? [],
        anBefore: activatedWorldInfo.ANBeforeEntries ?? [],
        anAfter: activatedWorldInfo.ANAfterEntries ?? [],
        outletEntries: activatedWorldInfo.outletEntries ?? {},
    };
}
