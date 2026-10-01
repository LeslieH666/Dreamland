import type { LeslieCompanionState } from '../../shared/eventa/leslie-bridge'

import { errorMessageFrom } from '@moeru/std'
import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { onMounted, onUnmounted, ref } from 'vue'

import { electronLeslieBridgeGetCompanionState } from '../../shared/eventa/leslie-bridge'

const OFFLINE_STATE: LeslieCompanionState = {
  binding: null,
  characters: [],
  connected: false,
  generating: false,
  voice: {
    available: false,
    languageMode: 'auto',
    resourceId: '',
    speakerId: '',
    speed: 0,
  },
}

/** Keep a renderer informed about the active DreamLand character. */
export function useLeslieCompanionState() {
  const getState = useElectronEventaInvoke(electronLeslieBridgeGetCompanionState)
  const state = ref<LeslieCompanionState>(OFFLINE_STATE)
  const error = ref('')
  let timer: ReturnType<typeof setInterval> | undefined

  async function refresh(): Promise<void> {
    try {
      state.value = await getState()
      error.value = ''
    }
    catch (cause) {
      state.value = OFFLINE_STATE
      error.value = errorMessageFrom(cause) ?? 'DreamLand is not available.'
    }
  }

  onMounted(() => {
    void refresh()
    timer = setInterval(() => void refresh(), 2_000)
  })
  onUnmounted(() => clearInterval(timer))

  return { error, refresh, state }
}
