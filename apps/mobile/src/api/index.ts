/**
 * Public surface of the DreamLand mobile API client layer.
 *
 * The layer is UI-agnostic: import this module from any React Native (or future native)
 * shell and drive it with the same typed calls. It owns HTTP + SSE transport and the
 * domain types; it never renders.
 */

export { ApiClient } from './client';
export type { ApiClientConfig, StreamHandler } from './client';

export { AuthApi } from './auth';
export { CharactersApi } from './characters';
export { ChatsApi } from './chats';
export { MemoryApi } from './memory';
export { MomentsApi } from './moments';
export { VoiceApi } from './voice';

export * from './types';
