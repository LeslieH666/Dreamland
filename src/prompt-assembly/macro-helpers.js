/**
 * Macro-adjacent formatting helpers (Phase 2.5.3).
 *
 * parseMesExamples, formatInstructModeExamples and parseExampleIntoIndividual are the
 * helpers the legacy macro engine calls through `context.helpers`. They lived in
 * script.js, instruct-mode.js and openai.js, none of which the server can import.
 *
 * Everything they read from the page - power_user, the macro engine, the selected group,
 * the name overrides and the group-name lookup - arrives through an explicit context
 * object, so the same code runs in the browser (wrapped by the original modules) and on
 * the server.
 */

/** Shared name-behaviour values, mirrored from instruct-mode.js. */
export const NAMES_BEHAVIOR_TYPES = Object.freeze({
    NONE: 'none',
    FORCE: 'force',
    ALWAYS: 'always',
});

export function parseExampleIntoIndividual(messageExampleString, appendNamesForGroup = true, context = {}) {
    const groupBotNames = context.getGroupNames().map(name => `${name}:`);

    let result = []; // array of msgs
    let tmp = messageExampleString.split('\n');
    let cur_msg_lines = [];
    let in_user = false;
    let in_bot = false;
    let botName = context.name2;

    // Collect the accumulated lines as one message.
    function add_msg(name, role, system_name) {
        // join different newlines (we split them by \n and join by \n)
        // remove char name
        // strip to remove extra spaces
        let parsed_msg = cur_msg_lines.join('\n').replace(name + ':', '').trim();

        if (appendNamesForGroup && context.selectedGroup && ['example_user', 'example_assistant'].includes(system_name)) {
            parsed_msg = `${name}: ${parsed_msg}`;
        }

        result.push({ 'role': role, 'content': parsed_msg, 'name': system_name });
        cur_msg_lines = [];
    }
    // skip first line as it'll always be "This is how {bot name} should talk"
    for (let i = 1; i < tmp.length; i++) {
        let cur_str = tmp[i];
        // if it's the user message, switch into user mode and out of bot mode
        // yes, repeated code, but I don't care
        if (cur_str.startsWith(context.name1 + ':')) {
            in_user = true;
            // we were in the bot mode previously, add the message
            if (in_bot) {
                add_msg(botName, 'system', 'example_assistant');
            }
            in_bot = false;
        } else if (cur_str.startsWith(context.name2 + ':') || groupBotNames.some(n => cur_str.startsWith(n))) {
            if (!cur_str.startsWith(context.name2 + ':') && groupBotNames.length) {
                botName = cur_str.split(':')[0];
            }

            in_bot = true;
            // we were in the user mode previously, add the message
            if (in_user) {
                add_msg(context.name1, 'system', 'example_user');
            }
            in_user = false;
        }
        // push the current line into the current message array only after checking for presence of user/bot
        cur_msg_lines.push(cur_str);
    }
    // Special case for last message in a block because we don't have a new message to trigger the switch
    if (in_user) {
        add_msg(context.name1, 'system', 'example_user');
    } else if (in_bot) {
        add_msg(botName, 'system', 'example_assistant');
    }
    return result;
}

export function formatInstructModeExamples(mesExamplesArray, name1, name2, context = {}) {
    const blockHeading = context.powerUser.context.example_separator ? `${context.substituteParams(context.powerUser.context.example_separator)}\n` : '';

    if (context.powerUser.instruct.skip_examples) {
        return mesExamplesArray.map(x => x.replace(/<START>\n/i, blockHeading));
    }

    const includeNames = context.powerUser.instruct.names_behavior === context.namesBehaviorTypes.ALWAYS;
    const includeGroupNames = context.selectedGroup && [context.namesBehaviorTypes.ALWAYS, context.namesBehaviorTypes.FORCE].includes(context.powerUser.instruct.names_behavior);

    let inputPrefix = context.powerUser.instruct.input_sequence || '';
    let outputPrefix = context.powerUser.instruct.output_sequence || '';
    let inputSuffix = context.powerUser.instruct.input_suffix || '';
    let outputSuffix = context.powerUser.instruct.output_suffix || '';

    if (context.powerUser.instruct.macro) {
        inputPrefix = context.substituteParams(inputPrefix, { name1Override: name1, name2Override: name2 });
        outputPrefix = context.substituteParams(outputPrefix, { name1Override: name1, name2Override: name2 });
        inputSuffix = context.substituteParams(inputSuffix, { name1Override: name1, name2Override: name2 });
        outputSuffix = context.substituteParams(outputSuffix, { name1Override: name1, name2Override: name2 });

        inputPrefix = inputPrefix.replace(/{{name}}/gi, name1);
        outputPrefix = outputPrefix.replace(/{{name}}/gi, name2);
        inputSuffix = inputSuffix.replace(/{{name}}/gi, name1);
        outputSuffix = outputSuffix.replace(/{{name}}/gi, name2);

        if (!inputSuffix && context.powerUser.instruct.wrap) {
            inputSuffix = '\n';
        }

        if (!outputSuffix && context.powerUser.instruct.wrap) {
            outputSuffix = '\n';
        }
    }

    const separator = context.powerUser.instruct.wrap ? '\n' : '';
    const formattedExamples = [];

    for (const item of mesExamplesArray) {
        const cleanedItem = item.replace(/<START>/i, '{Example Dialogue:}').replace(/\r/gm, '');
        const blockExamples = context.parseExampleIntoIndividual(cleanedItem, includeGroupNames);

        if (blockExamples.length === 0) {
            continue;
        }

        if (blockHeading) {
            formattedExamples.push(blockHeading);
        }

        for (const example of blockExamples) {
            // If group names were included, we don't want to add any additional prefix as it already was applied.
            // Otherwise, if force group/persona names is set, we should override the include names for the user placeholder
            const includeThisName = !includeGroupNames && (includeNames || (context.powerUser.instruct.names_behavior === context.namesBehaviorTypes.FORCE && example.name == 'example_user'));

            const prefix = example.name == 'example_user' ? inputPrefix : outputPrefix;
            const suffix = example.name == 'example_user' ? inputSuffix : outputSuffix;
            const name = example.name == 'example_user' ? name1 : name2;
            const messageContent = includeThisName ? `${name}: ${example.content}` : example.content;
            const formattedMessage = [prefix, messageContent + suffix].filter(x => x).join(separator);
            formattedExamples.push(formattedMessage);
        }
    }

    if (formattedExamples.length === 0) {
        return mesExamplesArray.map(x => x.replace(/<START>\n/i, blockHeading));
    }
    return formattedExamples;
}

export function parseMesExamples(examplesStr, isInstruct, context = {}) {
    if (!examplesStr || examplesStr.length === 0 || examplesStr === '<START>') {
        return [];
    }

    if (!examplesStr.startsWith('<START>')) {
        examplesStr = '<START>\n' + examplesStr.trim();
    }

    const exampleSeparator = context.powerUser.context.example_separator ? `${context.substituteParams(context.powerUser.context.example_separator)}\n` : '';
    const blockHeading = (context.mainApi === 'openai' || isInstruct) ? '<START>\n' : exampleSeparator;
    const splitExamples = examplesStr.split(/<START>/gi).slice(1).map(block => `${blockHeading}${block.trim()}\n`);

    return splitExamples;
}
