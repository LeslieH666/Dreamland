import type {
  LeslieBridgeChatStreamFrame,
  LeslieBridgeSpeechRequest,
  LeslieBridgeTranscriptionRequest,
} from '../../shared/eventa/leslie-bridge'

import { defineStreamInvoke } from '@moeru/eventa'
import { getElectronEventaContext, useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { defineProvider } from '@proj-airi/stage-ui/libs/providers'
import { createOpenAI } from '@xsai-ext/providers/create'
import { z } from 'zod'

import {
  electronLeslieBridgeCancelChat,
  electronLeslieBridgeCreateSpeech,
  electronLeslieBridgeCreateTranscription,
  electronLeslieBridgeGetCompanionState,
  electronLeslieBridgeGetStatus,
  electronLeslieBridgeListChatModels,
  electronLeslieBridgeListModels,
  electronLeslieBridgeListVoices,
  electronLeslieBridgeStreamChat,
} from '../../shared/eventa/leslie-bridge'

const providerConfigSchema = z.object({})
const chatProviderConfigSchema = z.object({})
const speechBodySchema = z.object({
  input: z.string(),
  model: z.string().optional(),
  voice: z.string(),
})

type LeslieBridgeProviderConfig = z.input<typeof providerConfigSchema>
type LeslieBridgeChatProviderConfig = z.input<typeof chatProviderConfigSchema>

function requestId(): string {
  return globalThis.crypto.randomUUID()
}

async function chatRequestBody(input: RequestInfo | URL, init?: RequestInit): Promise<string> {
  if (typeof init?.body === 'string')
    return init.body
  if (input instanceof Request)
    return input.clone().text()
  throw new Error('The Leslie Bridge chat request body is not valid.')
}

function createChatFetch() {
  const streamChat = defineStreamInvoke(getElectronEventaContext(), electronLeslieBridgeStreamChat)
  const cancelChat = useElectronEventaInvoke(electronLeslieBridgeCancelChat)

  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = await chatRequestBody(input, init)
    const id = requestId()
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
    signal?.throwIfAborted()

    const source = streamChat({ body, requestId: id })
    const reader = source.getReader()
    let cancelSent = false

    const cancelSource = async (reason?: unknown) => {
      if (cancelSent)
        return
      cancelSent = true
      await reader.cancel(reason)
      await cancelChat({ requestId: id }).catch(() => ({ canceled: false }))
    }
    const abort = () => void cancelSource(signal?.reason)
    signal?.addEventListener('abort', abort, { once: true })

    let first: ReadableStreamReadResult<LeslieBridgeChatStreamFrame>
    try {
      first = await reader.read()
    }
    catch (error) {
      signal?.removeEventListener('abort', abort)
      await cancelSource(error)
      throw error
    }
    if (first.done || first.value.type !== 'start') {
      signal?.removeEventListener('abort', abort)
      await cancelSource('Leslie Bridge did not start the chat response.')
      throw new Error('Leslie Bridge did not start the chat response.')
    }

    const responseBody = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const frame = await reader.read()
        if (frame.done) {
          signal?.removeEventListener('abort', abort)
          controller.close()
          return
        }
        if (frame.value.type !== 'data')
          throw new Error('Leslie Bridge returned an invalid chat stream frame.')
        controller.enqueue(Uint8Array.from(frame.value.data))
      },
      async cancel(reason) {
        signal?.removeEventListener('abort', abort)
        await cancelSource(reason)
      },
    })

    return new Response(responseBody, {
      headers: { 'Content-Type': first.value.contentType },
      status: first.value.status,
      statusText: first.value.statusText,
    })
  }
}

function resolveSpeed(extraOptions?: Record<string, unknown>): number {
  if (typeof extraOptions?.speed === 'number')
    return extraOptions.speed

  const voiceSettings = extraOptions?.voiceSettings
  if (voiceSettings && typeof voiceSettings === 'object' && 'speed' in voiceSettings && typeof voiceSettings.speed === 'number')
    return voiceSettings.speed

  return 1
}

function createSpeechFetch(model: string, speed: number | undefined) {
  const createSpeech = useElectronEventaInvoke(electronLeslieBridgeCreateSpeech)

  return async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (!init?.body || typeof init.body !== 'string')
      throw new Error('The Leslie Bridge speech request body is not valid.')

    const body = speechBodySchema.parse(JSON.parse(init.body))
    const payload: LeslieBridgeSpeechRequest = {
      input: body.input,
      model: body.model || model,
      speed,
      voice: body.voice,
    }
    const result = await createSpeech(payload)
    const audio = Uint8Array.from(result.audio).buffer
    return new Response(audio, {
      headers: { 'Content-Type': result.contentType },
      status: 200,
    })
  }
}

async function transcriptionFormData(input: RequestInfo | URL, init?: RequestInit): Promise<FormData> {
  if (init?.body instanceof FormData)
    return init.body
  if (input instanceof Request)
    return input.clone().formData()
  throw new Error('The Leslie Bridge transcription request body is not valid.')
}

function formText(body: FormData, name: string): string {
  const value = body.get(name)
  return typeof value === 'string' ? value.trim() : ''
}

function createTranscriptionFetch(model: string) {
  const createTranscription = useElectronEventaInvoke(electronLeslieBridgeCreateTranscription)

  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = await transcriptionFormData(input, init)
    const file = body.get('file')
    if (!(file instanceof Blob))
      throw new Error('The Leslie Bridge transcription request must contain an audio file.')

    const payload: LeslieBridgeTranscriptionRequest = {
      audio: new Uint8Array(await file.arrayBuffer()),
      contentType: file.type || 'audio/wav',
      language: formText(body, 'language') || undefined,
      model: formText(body, 'model') || model,
    }
    const result = await createTranscription(payload)
    return Response.json(result)
  }
}

defineProvider<LeslieBridgeProviderConfig>({
  id: 'leslie-tavern',
  name: 'Leslie Tavern',
  nameLocalize: ({ t }) => t('settings.pages.providers.provider.leslie-tavern.title'),
  description: 'Speak with the voice assigned to the active DreamLand character.',
  descriptionLocalize: ({ t }) => t('settings.pages.providers.provider.leslie-tavern.description'),
  tasks: ['text-to-speech', 'speech-to-text', 'automatic-speech-recognition', 'asr', 'stt'],
  capabilities: {
    transcription: { protocol: 'http', generateOutput: true, streamOutput: false, streamInput: false },
  },
  icon: 'i-lucide:messages-square',
  requiresCredentials: false,
  createProviderConfig: () => providerConfigSchema,
  createProvider: () => {
    const provider = createOpenAI('', 'https://leslie-bridge.invalid/v1')
    return {
      ...provider,
      speech: (model?: string, extraOptions?: Record<string, unknown>) => ({
        baseURL: 'eventa://leslie-bridge/v1/',
        fetch: createSpeechFetch(
          model || 'leslie-volcengine-tts',
          resolveSpeed(extraOptions),
        ),
        model: model || 'leslie-volcengine-tts',
      }),
      transcription: (model = 'leslie-local-whisper', extraOptions?: Record<string, unknown>) => ({
        ...provider.transcription(model),
        ...extraOptions,
        fetch: createTranscriptionFetch(model),
      }),
    }
  },
  validationRequiredWhen: () => true,
  validators: {
    validateConfig: [
      ({ t }) => ({
        id: 'leslie-tavern:check-connection',
        name: t('settings.pages.providers.catalog.edit.validators.openai-compatible.check-config.title'),
        validator: async () => {
          const getStatus = useElectronEventaInvoke(electronLeslieBridgeGetStatus)
          const getCompanionState = useElectronEventaInvoke(electronLeslieBridgeGetCompanionState)
          const [status, companion] = await Promise.all([getStatus(), getCompanionState()])
          const valid = status.state === 'ready'
            && status.speechAvailable
            && companion.connected
            && companion.voice.available
          const reason = status.error || (valid ? '' : 'Configure the active character voice in DreamLand.')
          return {
            errors: valid ? [] : [{ error: new Error(reason) }],
            reason,
            reasonKey: '',
            valid,
          }
        },
      }),
    ],
  },
  extraMethods: {
    listModels: async () => {
      const listModels = useElectronEventaInvoke(electronLeslieBridgeListModels)
      return listModels()
    },
    listVoices: async () => {
      const listVoices = useElectronEventaInvoke(electronLeslieBridgeListVoices)
      return listVoices()
    },
  },
})

defineProvider<LeslieBridgeChatProviderConfig>({
  id: 'leslie-tavern-chat',
  name: 'Leslie Tavern Chat',
  nameLocalize: ({ t }) => t('settings.pages.providers.provider.leslie-tavern-chat.title'),
  description: 'Use the active DreamLand character, chat, memory, and model.',
  descriptionLocalize: ({ t }) => t('settings.pages.providers.provider.leslie-tavern-chat.description'),
  tasks: ['chat'],
  icon: 'i-lucide:messages-square',
  requiresCredentials: false,
  createProviderConfig: () => chatProviderConfigSchema,
  createProvider: () => {
    const provider = createOpenAI('', 'https://leslie-bridge.invalid/v1')
    const fetch = createChatFetch()
    return {
      ...provider,
      chat: (...args: Parameters<typeof provider.chat>) => ({
        ...provider.chat(...args),
        fetch,
      }),
    }
  },
  validationRequiredWhen: () => true,
  validators: {
    validateConfig: [
      ({ t }) => ({
        id: 'leslie-tavern-chat:check-connection',
        name: t('settings.pages.providers.catalog.edit.validators.openai-compatible.check-config.title'),
        validator: async () => {
          const getStatus = useElectronEventaInvoke(electronLeslieBridgeGetStatus)
          const status = await getStatus()
          const valid = status.state === 'ready'
            && status.chatAvailable
            && status.companionConnected
            && Boolean(status.binding)
          const reason = status.error || (valid ? '' : 'Open DreamLand and select a character.')
          return {
            errors: valid ? [] : [{ error: new Error(reason) }],
            reason,
            reasonKey: '',
            valid,
          }
        },
      }),
    ],
  },
  extraMethods: {
    listModels: async () => {
      const listModels = useElectronEventaInvoke(electronLeslieBridgeListChatModels)
      return listModels()
    },
  },
})
