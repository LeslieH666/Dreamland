/**
 * World Info scan loop (Phase 2.5.2 step 4, substep 3).
 *
 * Moved verbatim from public/scripts/world-info.js checkWorldInfo's scan half,
 * plus the three inclusion-group filters it drives. Every ambient read becomes an
 * explicit `env` input - deliberately NOT named `context`, because this code
 * already has a local `context` holding the SillyTavern context
 * (`getContext()`), and shadowing it would silently break the AN hijack.
 *
 * Step 3 wiring:
 *   - `env.random()` replaces the module-level probability RNG, so a seeded run is
 *     reproducible (createSeededRandom) while production keeps Math.random;
 *   - `env.countTokens()` replaces getTokenCountAsync, which the browser already
 *     delegates to /api/tokenizers; the server supplies its own counter whose
 *     tokenizer model it resolves through resolveChatCompletionTokenizerModel
 *     (fail-closed outside the narrowed provider scope).
 */

import { DEFAULT_WEIGHT, scan_state, world_info_logic } from './world-info-enums.js';
import { defaultGlobalScanData, WorldInfoBuffer, WorldInfoTimedEffects } from './world-info-state.js';
import { getSortedEntries } from './world-info-lore.js';

export async function scanWorldInfo(chat, maxContext, isDryRun, globalScanData = defaultGlobalScanData, env) {
    const context = env.getContext();
    const buffer = new WorldInfoBuffer(chat, globalScanData, env);

    console.debug(`[WI] --- START WI SCAN (on ${chat.length} messages, trigger = ${globalScanData.trigger})${isDryRun ? ' (DRY RUN)' : ''} ---`);

    // Combine the chat

    // Add the depth or AN if enabled
    // Put this code here since otherwise, the chat reference is modified
    for (const key of Object.keys(context.extensionPrompts)) {
        if (context.extensionPrompts[key]?.scan) {
            const prompt = await env.getExtensionPromptByName(key);
            if (prompt) {
                buffer.addInject(prompt);
            }
        }
    }

    /** @type {scan_state} */
    let scanState = scan_state.INITIAL;
    let token_budget_overflowed = false;
    let count = 0;
    let allActivatedEntries = new Map();
    let failedProbabilityChecks = new Set();
    let allActivatedText = '';

    let budget = Math.round(env.settings.worldInfoBudget * maxContext / 100) || 1;

    if (env.settings.worldInfoBudgetCap > 0 && budget > env.settings.worldInfoBudgetCap) {
        console.debug(`[WI] Budget ${budget} exceeds cap ${env.settings.worldInfoBudgetCap}, using cap`);
        budget = env.settings.worldInfoBudgetCap;
    }

    console.debug(`[WI] Context size: ${maxContext}; WI budget: ${budget} (max% = ${env.settings.worldInfoBudget}%, cap = ${env.settings.worldInfoBudgetCap})`);
    const sortedEntries = await getSortedEntries(env);
    const timedEffects = new WorldInfoTimedEffects(chat, sortedEntries, isDryRun, env);

    timedEffects.checkTimedEffects();

    if (sortedEntries.length === 0) {
        // Flagged rather than returned as a finished prompt: the original code
        // returns here WITHOUT running the timed-effect persistence and clean-up
        // that the normal path performs, so the caller must reproduce that early
        // return itself to keep behaviour identical.
        return {
            empty: true,
            allActivatedEntries: new Map(),
            buffer,
            timedEffects,
            allActivatedText: '',
            sortedEntries,
            budget,
            token_budget_overflowed: false,
            availableRecursionDelayLevels: [],
            currentRecursionDelayLevel: 0,
            scanState,
        };
    }

    /** @type {number[]} Represents the delay levels for entries that are delayed until recursion */
    const availableRecursionDelayLevels = [...new Set(sortedEntries
        .filter(entry => entry.delayUntilRecursion)
        .map(entry => entry.delayUntilRecursion === true ? 1 : entry.delayUntilRecursion),
    )].sort((a, b) => a - b);
    // Already preset with the first level
    let currentRecursionDelayLevel = availableRecursionDelayLevels.shift() ?? 0;
    if (currentRecursionDelayLevel > 0 && availableRecursionDelayLevels.length) {
        console.debug('[WI] Preparing first delayed recursion level', currentRecursionDelayLevel, '. Still delayed:', availableRecursionDelayLevels);
    }

    console.debug(`[WI] --- SEARCHING ENTRIES (on ${sortedEntries.length} entries) ---`);

    while (scanState) {
        //if env.settings.worldInfoMaxRecursionSteps is non-zero min activations are disabled, and vice versa
        if (env.settings.worldInfoMaxRecursionSteps && env.settings.worldInfoMaxRecursionSteps <= count) {
            console.debug('[WI] Search stopped by reaching max recursion steps', env.settings.worldInfoMaxRecursionSteps);
            break;
        }

        // Track how many times the loop has run. May be useful for debugging.
        count++;

        console.debug(`[WI] --- LOOP #${count} START ---`);
        console.debug('[WI] Scan state', Object.entries(scan_state).find(x => x[1] === scanState));

        // Until decided otherwise, we set the loop to stop scanning after this
        let nextScanState = scan_state.NONE;

        // Loop and find all entries that can activate here
        let activatedNow = new Set();

        for (const entry of sortedEntries) {
            // Logging preparation
            let headerLogged = false;
            function log(...args) {
                if (!headerLogged) {
                    console.debug(`[WI] Entry ${entry.uid}`, `from '${entry.world}' processing`, entry);
                    headerLogged = true;
                }
                console.debug(`[WI] Entry ${entry.uid}`, ...args);
            }

            // Already processed, considered and then skipped entries should still be skipped
            if (failedProbabilityChecks.has(entry) || allActivatedEntries.has(`${entry.world}.${entry.uid}`)) {
                continue;
            }

            if (entry.disable == true) {
                log('disabled');
                continue;
            }

            // Check for generation type trigger filter
            if (Array.isArray(entry.triggers) && entry.triggers.length > 0) {
                const isTriggered = entry.triggers.includes(globalScanData.trigger);
                if (!isTriggered) {
                    log(`skipped by generation type trigger filter (${globalScanData.trigger} ∉ ${entry.triggers})`);
                    continue;
                }
            }

            // Check if this entry applies to the character or if it's excluded
            if (entry.characterFilter && entry.characterFilter?.names?.length > 0) {
                const nameIncluded = entry.characterFilter.names.includes(env.getCharaFilename());
                const filtered = entry.characterFilter.isExclude ? nameIncluded : !nameIncluded;

                if (filtered) {
                    log('filtered out by character');
                    continue;
                }
            }

            if (entry.characterFilter && entry.characterFilter?.tags?.length > 0) {
                const tagKey = env.getTagKeyForEntity(env.getThisChid());

                if (tagKey) {
                    const tagMapEntry = context.tagMap[tagKey];

                    if (Array.isArray(tagMapEntry)) {
                        // If tag map intersects with the tag exclusion list, skip
                        const includesTag = tagMapEntry.some((tag) => entry.characterFilter.tags.includes(tag));
                        const filtered = entry.characterFilter.isExclude ? includesTag : !includesTag;

                        if (filtered) {
                            log('filtered out by tag');
                            continue;
                        }
                    }
                }
            }

            const isSticky = timedEffects.isEffectActive('sticky', entry);
            const isCooldown = timedEffects.isEffectActive('cooldown', entry);
            const isDelay = timedEffects.isEffectActive('delay', entry);

            if (isDelay) {
                log('suppressed by delay');
                continue;
            }

            if (isCooldown && !isSticky) {
                log('suppressed by cooldown');
                continue;
            }

            // Only use checks for recursion flags if the scan step was activated by recursion
            if (scanState !== scan_state.RECURSION && entry.delayUntilRecursion && !isSticky) {
                log('suppressed by delay until recursion');
                continue;
            }

            if (scanState === scan_state.RECURSION && entry.delayUntilRecursion && entry.delayUntilRecursion > currentRecursionDelayLevel && !isSticky) {
                log('suppressed by delay until recursion level', entry.delayUntilRecursion, '. Currently', currentRecursionDelayLevel);
                continue;
            }

            if (scanState === scan_state.RECURSION && env.settings.worldInfoRecursive && entry.excludeRecursion && !isSticky) {
                log('suppressed by exclude recursion');
                continue;
            }

            if (entry.decorators.includes('@@activate')) {
                log('activated by @@activate decorator');
                activatedNow.add(entry);
                continue;
            }

            if (entry.decorators.includes('@@dont_activate')) {
                log('suppressed by @@dont_activate decorator');
                continue;
            }

            if (buffer.getExternallyActivated(entry)) {
                log('externally activated');
                activatedNow.add(buffer.getExternallyActivated(entry));
                continue;
            }

            // Now do checks for immediate activations
            if (entry.constant) {
                log('activated because of constant');
                activatedNow.add(entry);
                continue;
            }

            if (isSticky) {
                log('activated because active sticky');
                activatedNow.add(entry);
                continue;
            }

            if (!Array.isArray(entry.key) || !entry.key.length) {
                log('has no keys defined, skipped');
                continue;
            }

            // Cache the text to scan before the loop, it won't change its content
            const textToScan = buffer.get(entry, scanState);

            // PRIMARY KEYWORDS
            let primaryKeyMatch = entry.key.find(key => {
                const substituted = env.substituteParams(key);
                return substituted && buffer.matchKeys(textToScan, substituted.trim(), entry);
            });

            if (!primaryKeyMatch) {
                // Don't write logs for simple no-matches
                continue;
            }

            const hasSecondaryKeywords = (
                entry.selective && //all entries are selective now
                Array.isArray(entry.keysecondary) && //always true
                entry.keysecondary.length //ignore empties
            );

            if (!hasSecondaryKeywords) {
                // Handle cases where secondary is empty
                log('activated by primary key match', primaryKeyMatch);
                activatedNow.add(entry);
                continue;
            }


            // SECONDARY KEYWORDS
            const selectiveLogic = entry.selectiveLogic ?? 0; // If selectiveLogic isn't found, assume it's AND, only do this once per entry
            log('Entry with primary key match', primaryKeyMatch, 'has secondary keywords. Checking with logic logic', Object.entries(world_info_logic).find(x => x[1] === entry.selectiveLogic));

            /** @type {() => boolean} */
            function matchSecondaryKeys() {
                let hasAnyMatch = false;
                let hasAllMatch = true;
                for (let keysecondary of entry.keysecondary) {
                    const secondarySubstituted = env.substituteParams(keysecondary);
                    const hasSecondaryMatch = secondarySubstituted && buffer.matchKeys(textToScan, secondarySubstituted.trim(), entry);

                    if (hasSecondaryMatch) hasAnyMatch = true;
                    if (!hasSecondaryMatch) hasAllMatch = false;

                    // Simplified AND ANY / NOT ALL if statement. (Proper fix for PR#1356 by Bronya)
                    // If AND ANY logic and the main checks pass OR if NOT ALL logic and the main checks do not pass
                    if (selectiveLogic === world_info_logic.AND_ANY && hasSecondaryMatch) {
                        log('activated. (AND ANY) Found match secondary keyword', secondarySubstituted);
                        return true;
                    }
                    if (selectiveLogic === world_info_logic.NOT_ALL && !hasSecondaryMatch) {
                        log('activated. (NOT ALL) Found not matching secondary keyword', secondarySubstituted);
                        return true;
                    }
                }

                // Handle NOT ANY logic
                if (selectiveLogic === world_info_logic.NOT_ANY && !hasAnyMatch) {
                    log('activated. (NOT ANY) No secondary keywords found', entry.keysecondary);
                    return true;
                }

                // Handle AND ALL logic
                if (selectiveLogic === world_info_logic.AND_ALL && hasAllMatch) {
                    log('activated. (AND ALL) All secondary keywords found', entry.keysecondary);
                    return true;
                }

                return false;
            }

            const matched = matchSecondaryKeys();
            if (!matched) {
                log('skipped. Secondary keywords not satisfied', entry.keysecondary);
                continue;
            }

            // Success logging was already done inside the function, so just add the entry
            activatedNow.add(entry);
            continue;
        }

        console.debug(`[WI] Search done. Found ${activatedNow.size} possible entries.`);

        // Sort the entries for the probability and the budget limit checks
        const newEntries = [...activatedNow]
            .sort((a, b) => {
                const isASticky = timedEffects.isEffectActive('sticky', a) ? 1 : 0;
                const isBSticky = timedEffects.isEffectActive('sticky', b) ? 1 : 0;
                return isBSticky - isASticky || sortedEntries.indexOf(a) - sortedEntries.indexOf(b);
            });


        let newContent = '';
        const textToScanTokens = await env.countTokens(allActivatedText);

        filterByInclusionGroups(newEntries, allActivatedEntries, buffer, scanState, timedEffects, env);

        console.debug('[WI] --- PROBABILITY CHECKS ---');
        !newEntries.length && console.debug('[WI] No probability checks to do');

        let ignoresBudget = newEntries.filter(e => e.ignoreBudget).length;

        for (const entry of newEntries) {
            ignoresBudget -= (entry.ignoreBudget ? 1 : 0);
            if (token_budget_overflowed && !entry.ignoreBudget) {
                if (ignoresBudget > 0) {
                    continue;
                }
                break;
            }

            function verifyProbability() {
                // If we don't need to roll, it's always true
                if (!entry.useProbability || entry.probability === 100) {
                    console.debug(`WI entry ${entry.uid} does not use probability`);
                    return true;
                }

                const isSticky = timedEffects.isEffectActive('sticky', entry);
                if (isSticky) {
                    console.debug(`WI entry ${entry.uid} is sticky, does not need to re-roll probability`);
                    return true;
                }

                const rollValue = env.random() * 100;
                if (rollValue <= entry.probability) {
                    console.debug(`WI entry ${entry.uid} passed probability check of ${entry.probability}%`);
                    return true;
                }

                failedProbabilityChecks.add(entry);
                return false;
            }

            const success = verifyProbability();
            if (!success) {
                console.debug(`WI entry ${entry.uid} failed probability check, removing from activated entries`, entry);
                continue;
            }

            // Substitute macros inline, for both this checking and also future processing
            entry.content = env.substituteParams(entry.content);
            newContent += `${entry.content}\n`;

            if (!entry.ignoreBudget && (textToScanTokens + (await env.countTokens(newContent))) >= budget) {
                if (!token_budget_overflowed) {
                    console.debug('[WI] --- BUDGET OVERFLOW CHECK ---');
                    if (env.settings.worldInfoOverflowAlert) {
                        console.warn(`[WI] budget of ${budget} reached, stopping after ${allActivatedEntries.size} entries`);
                        env.notifyOverflow(`World info budget reached after ${allActivatedEntries.size} entries.`, 'World Info');
                    } else {
                        console.debug(`[WI] budget of ${budget} reached, stopping after ${allActivatedEntries.size} entries`);
                    }
                    token_budget_overflowed = true;
                }
                continue;
            }

            allActivatedEntries.set(`${entry.world}.${entry.uid}`, entry);
            console.debug(`[WI] Entry ${entry.uid} activation successful, adding to prompt`, entry);
        }

        const successfulNewEntries = newEntries.filter(x => !failedProbabilityChecks.has(x));
        const successfulNewEntriesForRecursion = successfulNewEntries.filter(x => !x.preventRecursion);

        console.debug(`[WI] --- LOOP #${count} RESULT ---`);
        if (!newEntries.length) {
            console.debug('[WI] No new entries activated.');
        } else if (!successfulNewEntries.length) {
            console.debug('[WI] Probability checks failed for all activated entries. No new entries activated.');
        } else {
            console.debug(`[WI] Successfully activated ${successfulNewEntries.length} new entries to prompt. ${allActivatedEntries.size} total entries activated.`, successfulNewEntries);
        }

        function logNextState(...args) {
            args.length && console.debug(args.shift(), ...args);
            console.debug('[WI] Setting scan state', Object.entries(scan_state).find(x => x[1] === scanState));
        }

        // After processing and rolling entries is done, see if we should continue with normal recursion
        if (env.settings.worldInfoRecursive && !token_budget_overflowed && successfulNewEntriesForRecursion.length) {
            nextScanState = scan_state.RECURSION;
            logNextState('[WI] Found', successfulNewEntriesForRecursion.length, 'new entries for recursion');
        }

        // If we are inside min activations scan, and we have recursive buffer, we should do a recursive scan before increasing the buffer again
        // There might be recurse-trigger-able entries that match the buffer, so we need to check that
        if (env.settings.worldInfoRecursive && !token_budget_overflowed && scanState === scan_state.MIN_ACTIVATIONS && buffer.hasRecurse()) {
            nextScanState = scan_state.RECURSION;
            logNextState('[WI] Min Activations run done, whill will always be followed by a recursive scan');
        }

        // If scanning is planned to stop, but min activations is set and not satisfied, check if we should continue
        const minActivationsNotSatisfied = env.settings.worldInfoMinActivations > 0 && (allActivatedEntries.size < env.settings.worldInfoMinActivations);
        if (!nextScanState && !token_budget_overflowed && minActivationsNotSatisfied) {
            console.debug('[WI] --- MIN ACTIVATIONS CHECK ---');

            let over_max = (
                env.settings.worldInfoMinActivationsDepthMax > 0 &&
                buffer.getDepth() > env.settings.worldInfoMinActivationsDepthMax
            ) || (buffer.getDepth() > chat.length);

            if (!over_max) {
                nextScanState = scan_state.MIN_ACTIVATIONS; // loop
                logNextState(`[WI] Min activations not reached (${allActivatedEntries.size}/${env.settings.worldInfoMinActivations}), advancing depth to ${buffer.getDepth() + 1}, starting another scan`);
                buffer.advanceScan();
            } else {
                console.debug(`[WI] Min activations not reached (${allActivatedEntries.size}/${env.settings.worldInfoMinActivations}), but reached on of depth. Stopping`);
            }
        }

        // If the scan is done, but we still have open "delay until recursion" levels, we should continue with the next one
        if (nextScanState === scan_state.NONE && availableRecursionDelayLevels.length) {
            nextScanState = scan_state.RECURSION;
            currentRecursionDelayLevel = availableRecursionDelayLevels.shift();
            logNextState('[WI] Open delayed recursion levels left. Preparing next delayed recursion level', currentRecursionDelayLevel, '. Still delayed:', availableRecursionDelayLevels);
        }

        // Final check if we should really continue scan, and extend the current WI recurse buffer
        const curScanState = scanState;
        scanState = nextScanState;
        if (scanState) {
            const text = successfulNewEntriesForRecursion
                .map(x => x.content).join('\n');
            if (text) {
                buffer.addRecurse(text);
                allActivatedText = (text + '\n' + allActivatedText);
            }
        } else {
            logNextState('[WI] Scan done. No new entries to prompt. Stopping.');
        }

        // Fire an event after each scan loop, so extensions can hook into the current scanning state
        const args = {
            state: {
                current: curScanState,
                next: scanState,
                loopCount: count,
            },
            new: {
                all: newEntries,
                successful: successfulNewEntries,
            },
            activated: {
                entries: allActivatedEntries,
                text: allActivatedText,
            },
            sortedEntries,
            recursionDelay: {
                availableLevels: availableRecursionDelayLevels,
                currentLevel: currentRecursionDelayLevel,
            },
            budget: {
                current: budget,
                overflowed: token_budget_overflowed,
            },
            timedEffects,
        };
        await env.emitScanDone(args);

        // Some fields are allowed to be changed by listeners, those will be handled here manually. They can be updated via changed the args from the listeners.
        // Any array provided directly can be modified by updating it's elements, adding or removing elements. This has to be done consistently.
        if (args.state.next !== scanState) {
            logNextState('[WI] Scan state changed from', scanState, 'to', args.state.next);
            scanState = args.state.next;
        }
        allActivatedText = args.activated.text;
        currentRecursionDelayLevel = args.recursionDelay.currentLevel;
        budget = args.budget.current;
        token_budget_overflowed = args.budget.overflowed;
    }

    return {
        allActivatedEntries,
        buffer,
        timedEffects,
        allActivatedText,
        sortedEntries,
        budget,
        token_budget_overflowed,
        availableRecursionDelayLevels,
        currentRecursionDelayLevel,
        scanState,
    };
}


function filterGroupsByScoring(groups, buffer, removeEntry, scanState, hasStickyMap, env) {
    for (const [key, group] of Object.entries(groups)) {
        // Group scoring is disabled both globally and for the group entries
        if (!env.settings.worldInfoUseGroupScoring && !group.some(x => x.useGroupScoring)) {
            console.debug(`[WI] Skipping group scoring for group '${key}'`);
            continue;
        }

        // If the group has any sticky entries, the rest are already removed by the timed effects filter
        const hasAnySticky = hasStickyMap.get(key);
        if (hasAnySticky) {
            console.debug(`[WI] Skipping group scoring check, group '${key}' has sticky entries`);
            continue;
        }

        const scores = group.map(entry => buffer.getScore(entry, scanState));
        const maxScore = Math.max(...scores);
        console.debug(`[WI] Group '${key}' max score:`, maxScore);
        //console.table(group.map((entry, i) => ({ uid: entry.uid, key: JSON.stringify(entry.key), score: scores[i] })));

        for (let i = 0; i < group.length; i++) {
            const isScored = group[i].useGroupScoring ?? env.settings.worldInfoUseGroupScoring;

            if (!isScored) {
                continue;
            }

            if (scores[i] < maxScore) {
                console.debug(`[WI] Entry ${group[i].uid}`, `removed as score loser from inclusion group '${key}'`, group[i]);
                removeEntry(group[i]);
                group.splice(i, 1);
                scores.splice(i, 1);
                i--;
            }
        }
    }
}

/**
 * Removes entries on cooldown and forces sticky entries as winners.
 * @param {Record<string, WIScanEntry[]>} groups The groups to filter
 * @param {WorldInfoTimedEffects} timedEffects The timed effects to use
 * @param {(entry: WIScanEntry) => void} removeEntry The function to remove an entry
 * @returns {Map<string, boolean>} If any sticky entries were found
 */

function filterGroupsByTimedEffects(groups, timedEffects, removeEntry) {
    /** @type {Map<string, boolean>} */
    const hasStickyMap = new Map();

    for (const [key, group] of Object.entries(groups)) {
        hasStickyMap.set(key, false);

        // If the group has any sticky entries, leave only the sticky entries
        const stickyEntries = group.filter(x => timedEffects.isEffectActive('sticky', x));
        if (stickyEntries.length) {
            for (const entry of group) {
                if (stickyEntries.includes(entry)) {
                    continue;
                }

                console.debug(`[WI] Entry ${entry.uid}`, `removed as a non-sticky loser from inclusion group '${key}'`, entry);
                removeEntry(entry);
            }

            hasStickyMap.set(key, true);
        }

        // It should not be possible for an entry on cooldown/delay to event get into the grouping phase but @Wolfsblvt told me to leave it here.
        const cooldownEntries = group.filter(x => timedEffects.isEffectActive('cooldown', x));
        if (cooldownEntries.length) {
            console.debug(`[WI] Inclusion group '${key}' has entries on cooldown. They will be removed.`, cooldownEntries);
            for (const entry of cooldownEntries) {
                removeEntry(entry);
            }
        }

        const delayEntries = group.filter(x => timedEffects.isEffectActive('delay', x));
        if (delayEntries.length) {
            console.debug(`[WI] Inclusion group '${key}' has entries with delay. They will be removed.`, delayEntries);
            for (const entry of delayEntries) {
                removeEntry(entry);
            }
        }
    }

    return hasStickyMap;
}

/**
 * Filters entries by inclusion groups.
 * @param {object[]} newEntries Entries activated on current recursion level
 * @param {Map<string, object>} allActivatedEntries Map of all activated entries
 * @param {WorldInfoBuffer} buffer The buffer to use for scanning
 * @param {number} scanState The current scan state
 * @param {WorldInfoTimedEffects} timedEffects The timed effects currently active
 */

function filterByInclusionGroups(newEntries, allActivatedEntries, buffer, scanState, timedEffects, env) {
    console.debug('[WI] --- INCLUSION GROUP CHECKS ---');

    const grouped = newEntries.filter(x => x.group).reduce((acc, item) => {
        item.group.split(/,\s*/).filter(x => x).forEach(group => {
            if (!acc[group]) {
                acc[group] = [];
            }
            acc[group].push(item);
        });
        return acc;
    }, {});

    if (Object.keys(grouped).length === 0) {
        console.debug('[WI] No inclusion groups found');
        return;
    }

    const removeEntry = (entry) => newEntries.splice(newEntries.indexOf(entry), 1);
    function removeAllBut(group, chosen, logging = true) {
        for (const entry of group) {
            if (entry === chosen) {
                continue;
            }

            if (logging) console.debug(`[WI] Entry ${entry.uid}`, `removed as loser from inclusion group '${entry.group}'`, entry);
            removeEntry(entry);
        }
    }

    const hasStickyMap = filterGroupsByTimedEffects(grouped, timedEffects, removeEntry);
    filterGroupsByScoring(grouped, buffer, removeEntry, scanState, hasStickyMap, env);

    for (const [key, group] of Object.entries(grouped)) {
        console.debug(`[WI] Checking inclusion group '${key}' with ${group.length} entries`, group);

        // If the group has any sticky entries, the rest are already removed by the timed effects filter
        const hasAnySticky = hasStickyMap.get(key);
        if (hasAnySticky) {
            console.debug(`[WI] Skipping inclusion group check, group '${key}' has sticky entries`);
            continue;
        }

        if (Array.from(allActivatedEntries.values()).some(x => x.group === key)) {
            console.debug(`[WI] Skipping inclusion group check, group '${key}' was already activated`);
            // We need to forcefully deactivate all other entries in the group
            removeAllBut(group, null, false);
            continue;
        }

        if (!Array.isArray(group) || group.length <= 1) {
            console.debug('[WI] Skipping inclusion group check, only one entry');
            continue;
        }

        // Check for group prio
        const prios = group.filter(x => x.groupOverride).sort(env.sortFn);
        if (prios.length) {
            console.debug(`[WI] Entry ${prios[0].uid}`, `activated as prio winner from inclusion group '${key}'`, prios[0]);
            removeAllBut(group, prios[0]);
            continue;
        }

        // Do weighted random using entry's weight
        const totalWeight = group.reduce((acc, item) => acc + (item.groupWeight ?? DEFAULT_WEIGHT), 0);
        const rollValue = Math.random() * totalWeight;
        let currentWeight = 0;
        let winner = null;

        for (const entry of group) {
            currentWeight += (entry.groupWeight ?? DEFAULT_WEIGHT);

            if (rollValue <= currentWeight) {
                console.debug(`[WI] Entry ${entry.uid}`, `activated as roll winner from inclusion group '${key}'`, entry);
                winner = entry;
                break;
            }
        }

        if (!winner) {
            console.debug(`[WI] Failed to activate inclusion group '${key}', no winner found`);
            continue;
        }

        // Remove every group item from newEntries but the winner
        removeAllBut(group, winner);
    }
}

// scanWorldInfo is exported by its own declaration.
export { filterGroupsByScoring, filterGroupsByTimedEffects, filterByInclusionGroups };
