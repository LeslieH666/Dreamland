<script setup lang="ts">
import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { computed } from 'vue'

import ControlButtonTooltip from '../controls-island/control-button-tooltip.vue'
import ControlButton from '../controls-island/control-button.vue'

import { electronOpenSettings } from '../../../../shared/eventa'
import { useLeslieCompanionState } from '../../../composables/use-leslie-companion-state'

const { state } = useLeslieCompanionState()
const openSettings = useElectronEventaInvoke(electronOpenSettings)

const statusIslandSize = {
  border: 'border-2',
  icon: 'size-6',
  padding: 'p-2.5',
} as const

const buttonStyle = computed(() => {
  return [
    statusIslandSize.border,
    statusIslandSize.padding,
    'transition-all duration-300 ease-in-out',
    state.value.connected && state.value.binding
      ? 'border-emerald-200/60 bg-white/85 hover:bg-emerald-50/90 dark:border-emerald-400/15 dark:bg-neutral-900/75 dark:hover:bg-neutral-900/88'
      : 'border-amber-300/80 bg-amber-50/90 hover:bg-amber-100/90 dark:border-amber-400/30 dark:bg-amber-950/25 dark:hover:bg-amber-950/38',
  ]
})

const iconClasses = computed(() => {
  return [
    state.value.connected && state.value.binding ? 'i-solar:user-check-bold' : 'i-solar:user-cross-bold',
    statusIslandSize.icon,
    'shrink-0 transition-colors duration-300 ease-in-out',
    state.value.connected && state.value.binding
      ? 'text-emerald-600 dark:text-emerald-300'
      : 'text-amber-600 dark:text-amber-300',
  ]
})

const buttonLabel = computed(() => {
  if (state.value.binding)
    return `已绑定 DreamLand 角色：${state.value.binding.characterName}`
  return state.value.connected ? '请在 DreamLand 选择角色' : '正在等待 DreamLand'
})
</script>

<template>
  <div fixed right-3 top-3 z-20>
    <ControlButtonTooltip side="left">
      <ControlButton
        :button-style="buttonStyle.join(' ')"
        :aria-label="buttonLabel"
        :title="buttonLabel"
        @click="openSettings({ route: '/settings/companion' })"
      >
        <div :class="iconClasses" />
      </ControlButton>
      <template #tooltip>
        {{ buttonLabel }}
      </template>
    </ControlButtonTooltip>
  </div>
</template>
