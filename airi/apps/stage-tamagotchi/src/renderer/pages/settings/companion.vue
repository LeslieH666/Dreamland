<script setup lang="ts">
import { computed } from 'vue'

import { useLeslieCompanionState } from '../../composables/use-leslie-companion-state'

const { error, refresh, state } = useLeslieCompanionState()

const connectionText = computed(() => {
  if (error.value)
    return '正在等待 DreamLand 启动'
  if (!state.value.connected)
    return '正在等待 DreamLand 页面连接'
  if (!state.value.binding)
    return '请在 DreamLand 中选择一个角色'
  return `已绑定：${state.value.binding.characterName}`
})
</script>

<template>
  <div flex="~ col gap-4" pb-8>
    <section border="1 neutral-200 dark:neutral-800" rounded-2xl bg="white/70 dark:neutral-900/70" p-5>
      <div flex items-center gap-3>
        <div
          :class="state.connected && state.binding ? 'bg-emerald-500' : 'bg-amber-500'"
          size-3 rounded-full
        />
        <div>
          <h2 text-lg font-semibold>
            {{ connectionText }}
          </h2>
          <p mt-1 text-sm text="neutral-500 dark:neutral-400">
            AIRI 会自动使用 DreamLand 当前角色的角色卡、世界书、记忆、聊天记录和模型。
          </p>
        </div>
      </div>

      <div v-if="state.binding" grid mt-5 gap-3 md:grid-cols-2>
        <div rounded-xl bg="neutral-100/80 dark:neutral-800/70" p-4>
          <div text-xs text="neutral-500">
            当前角色
          </div>
          <div mt-1 font-medium>
            {{ state.binding.characterName }}
          </div>
        </div>
        <div rounded-xl bg="neutral-100/80 dark:neutral-800/70" p-4>
          <div text-xs text="neutral-500">
            火山语音
          </div>
          <div mt-1 font-medium>
            {{ state.voice.available ? '已跟随当前角色' : '请在 DreamLand 为当前角色配置语音' }}
          </div>
        </div>
      </div>

      <button
        mt-5 rounded-xl bg="neutral-900 dark:white" px-4 py-2 text-sm text="white dark:neutral-900"
        type="button"
        @click="refresh"
      >
        重新检测
      </button>
    </section>

    <section rounded-2xl bg="neutral-100/70 dark:neutral-900/50" p-5 text-sm leading-7 text="neutral-600 dark:neutral-300">
      <p>切换角色：直接在 DreamLand 中点选另一个角色，AIRI 会自动跟随。</p>
      <p>更换形象：回到设置，打开“角色形象”，选择 AIRI 使用的 3D / Live2D 模型。</p>
      <p>聊天和记忆：全部保存到 DreamLand 当前会话，AIRI 不维护另一套角色配置。</p>
    </section>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  title: DreamLand 角色连接
  subtitle: 自动跟随当前角色
  description: 查看当前绑定角色与语音状态，无需配置模型或接口。
  icon: i-solar:link-circle-bold-duotone
  settingsEntry: true
  order: 0
  stageTransition:
    name: slide
    pageSpecificAvailable: true
</route>
