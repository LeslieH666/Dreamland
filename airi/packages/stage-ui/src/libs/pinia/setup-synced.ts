import type { PiniaPlugin } from 'pinia'
import type { SyncedPiniaRuntime } from 'pinia-plugin-synced'
import type { InjectionKey, Plugin } from 'vue'

import { inject } from 'vue'

/** Provides the synchronization runtime installed by {@link setupSynced}. */
export const injectKeyPiniaSynced: InjectionKey<SyncedPiniaRuntime> = Symbol('stage-synced-pinia-runtime')

/**
 * Creates the Vue and Pinia plugins for one Stage synchronization runtime.
 *
 * Install both plugins on the same application. The Vue plugin provides the
 * runtime to components and releases its election channel when the page or
 * Vue application ends.
 */
export function setupSynced(): { pinia: PiniaPlugin, vue: Plugin } {
  // TEMP-EXPERIMENT: sync disabled to isolate the renderer busy loop.
  const runtime = {
    onLeadershipChange: () => () => {},
    dispose: () => {},
  } as unknown as SyncedPiniaRuntime

  const vue: Plugin = {
    install(app) {
      app.provide(injectKeyPiniaSynced, runtime)
    },
  }

  return {
    pinia: () => {},
    vue,
  }
}

/** Returns the synchronization runtime provided by {@link setupSynced}. */
export function usePiniaSynced(): SyncedPiniaRuntime {
  const runtime = inject(injectKeyPiniaSynced)
  if (!runtime)
    throw new Error('Pinia synchronization is not installed. Call app.use(synced.vue) first.')

  return runtime
}
