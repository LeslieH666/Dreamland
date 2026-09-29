# Leslie group-chat orchestrator

## Purpose

The Leslie group-chat orchestrator is an optional layer in front of SillyTavern's native group generation wrapper. It decides which existing group members should answer and in what bounded batch. It does not generate dialogue, replace `Generate()`, change character cards, or create a second chat format.

The third implementation stage adds an optional model-assisted review on top of manually created, current-chat temporary roles. The model can only produce a validated proposal: creation and archival still require an explicit user confirmation.

## Compatibility boundary

- The feature is disabled by default for new and existing groups.
- When disabled, native manual, natural, list, and pooled activation remain authoritative.
- Forced speakers, Swipe, continue, quiet generation, and impersonation keep their native precedence.
- A planner exception falls back to native natural-order activation.
- Selected speakers still run sequentially through the existing group wrapper and `Generate()` pipeline, preserving World Info, model adapters, prompt assembly, message events, JSONL persistence, and group generation IDs.
- No chat text or character-card content is written to diagnostic logs by the planner.

## Persisted settings

The optional group field is:

```json
{
  "leslie_group_orchestrator": {
    "schema_version": 1,
    "enabled": false,
    "preset": "balanced",
    "max_speakers": 2,
    "max_auto_replies": 3
  }
}
```

Server reads and writes normalize the field. Missing, unversioned, or malformed settings keep the feature disabled. Existing group files require no eager migration.

Rollback is non-destructive: disable the feature or remove only `leslie_group_orchestrator`. Native group fields and group-chat JSONL files are not changed by that rollback.

## Initial selection rules

The local deterministic planner considers:

- explicit character-name mentions;
- lexical overlap between the user's message and bounded character-card fields;
- whether a member has already spoken since the most recent user message;
- recent-speaker penalties;
- the character's existing talkativeness value as a small prior;
- mute state and the existing self-response policy;
- balanced, focused, or lively reply-count presets.

Tie-breaking uses stable group-member order rather than unseeded random choice. Automatic continuation stops after the configured bounded reply chain.

## Current-chat temporary roles

Temporary roles are stored only under `chat_metadata.leslie_group_v1.temporary_roles` in the current group-chat JSONL header. The v2 record keeps a stable temporary ID, revision, compact card fields, talkativeness, creation message, last-active message, a message-indexed lifecycle history, and default-off review settings. V1 records migrate in memory with every model-assisted option disabled.

- Manual creation is available from the current group's edit panel.
- “AI 提议角色” runs one isolated background structured review through the currently connected chat model. Its bounded draft is shown in the normal editable role form and is created only after confirmation; the confirmation can also request one immediate in-character reply.
- “检查角色退场” accepts only IDs of active temporary roles already present in the current JSONL. Suggested roles are shown as checked choices and are archived only after confirmation.
- Optional automatic proposal and retirement-review toggles are disabled by default. When enabled, one combined review runs only after the configured 4–40-message cooldown; a failed or malformed review leaves ordinary chat untouched.
- Active roles participate in native and smart speaker selection, card aggregation, depth prompts, slash-command member lookup, and shared group memory.
- Dormant and archived roles are excluded from new-turn selection. Their hidden runtime adapters remain available for historical speaker attribution and Swipe/continue compatibility.
- Branching to an earlier message removes roles created later, rolls lifecycle history back to the branch point, and clears review cooldown state originating after that point.
- Import and export need no separate format: the namespaced record travels with the ordinary JSONL chat. Missing or malformed metadata normalizes to an empty fail-open registry.
- Runtime adapters are filtered out of character-library and permanent group-member lists and never call character save endpoints.
- Archiving is non-destructive. Reopening an older chat reconstructs its adapters from that chat's header, while leaving permanent character indexes unchanged.

The model never writes directly to character storage or chat messages, and automatic creation/automatic archival remain intentionally unsupported. A later stage can add proposal-quality telemetry, role editing/version history, and more precise scene-boundary heuristics after real-chat evaluation.

Temporary roles must never appear in `/api/characters/all`, the character library, ordinary character export, Moments character selection, or AIRI character binding.
