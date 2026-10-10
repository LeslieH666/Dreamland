import { useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, StyleSheet, Text,
    TextInput, TouchableOpacity, View,
} from 'react-native';

import { ChatMessage, CharacterSummary } from '../../api';
import { Session } from '../../store/session';
import { theme } from '../../theme';
import { speak, stopSpeaking } from '../voice/tts';

interface RenderedMessage {
    id: string;
    role: ChatMessage['role'];
    content: string;
    streaming?: boolean;
}

/** One chat turn: load history, stream the authoritative reply with a typewriter. */
export function ChatScreen({ session, character, onBack }: {
    session: Session;
    character: CharacterSummary;
    onBack: () => void;
}) {
    const [chatId, setChatId] = useState<string | null>(null);
    const [messages, setMessages] = useState<RenderedMessage[]>([]);
    const [draft, setDraft] = useState('');
    const [busy, setBusy] = useState(false);
    const listRef = useRef<FlatList<RenderedMessage>>(null);

    // The interrupt/resume contract: an in-flight stream can be cancelled by the user.
    const controllerRef = useRef<AbortController | null>(null);

    useEffect(() => {
        let active = true;
        (async () => {
            try {
                const created = await session.chats.create(character.id);
                if (!active) return;
                setChatId(created.id);
                const full = await session.chats.get(created.id);
                if (!active) return;
                setMessages(full.messages.map((message, index) => ({
                    id: `${index}`, role: message.role, content: message.content,
                })));
            } catch (raised) {
                if (active) setMessages([{ id: 'err', role: 'assistant', content: String(raised) }]);
            }
        })();
        return () => { active = false; stopSpeaking(); };
    }, [session, character.id]);

    async function send() {
        const text = draft.trim();
        if (!text || !chatId || busy) return;
        setDraft('');
        const userMessage: RenderedMessage = { id: `u-${Date.now()}`, role: 'user', content: text };
        setMessages(prev => [...prev, userMessage]);
        setBusy(true);

        // A fresh placeholder accumulates the streamed reply as it arrives.
        const assistantId = `a-${Date.now()}`;
        setMessages(prev => [...prev, { id: assistantId, role: 'assistant', content: '', streaming: true }]);

        try {
            await session.chats.generate(chatId, { message: text, type: 'normal' }, delta => {
                setMessages(prev => prev.map(item => item.id === assistantId
                    ? { ...item, content: item.content + delta }
                    : item));
            });
            // Speak the completed reply.
            const finalMessage = { id: assistantId, content: '' };
            setMessages(prev => {
                const done = prev.find(item => item.id === assistantId);
                if (done) finalMessage.content = done.content;
                return prev.map(item => item.id === assistantId ? { ...item, streaming: false } : item);
            });
            if (finalMessage.content) {
                await speak(text => session.voice.synthesize(text), finalMessage.content);
            }
        } catch (raised) {
            setMessages(prev => prev.map(item => item.id === assistantId
                ? { ...item, content: String(raised), streaming: false }
                : item));
        } finally {
            setBusy(false);
        }
    }

    function interrupt() {
        controllerRef.current?.abort();
    }

    return (
        <KeyboardAvoidingView
            style={styles.root}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
            <View style={styles.header}>
                <TouchableOpacity onPress={onBack}><Text style={styles.back}>‹ 返回</Text></TouchableOpacity>
                <Text style={styles.title}>{character.name}</Text>
            </View>

            <FlatList
                ref={listRef}
                data={messages}
                keyExtractor={item => item.id}
                onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
                renderItem={({ item }) => (
                    <View style={[styles.bubble, item.role === 'user' ? styles.userBubble : styles.assistantBubble]}>
                        <Text style={[styles.messageText, item.role === 'user' ? styles.userText : styles.assistantText]}>
                            {item.content}{item.streaming ? '▌' : ''}
                        </Text>
                    </View>
                )}
            />

            <View style={styles.composer}>
                <TextInput
                    style={styles.input}
                    placeholder="发消息…"
                    value={draft}
                    onChangeText={setDraft}
                    multiline
                />
                {busy
                    ? <TouchableOpacity style={styles.sendButton} onPress={interrupt}><Text style={styles.sendLabel}>停止</Text></TouchableOpacity>
                    : <TouchableOpacity style={styles.sendButton} onPress={send}><Text style={styles.sendLabel}>发送</Text></TouchableOpacity>}
            </View>
            {busy ? <ActivityIndicator color={theme.primary} style={{ margin: 4 }} /> : null}
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1 },
    header: { flexDirection: 'row', alignItems: 'center', padding: 12, borderBottomWidth: 1, borderBottomColor: theme.border, backgroundColor: theme.surface },
    back: { color: theme.primary, fontSize: 16, marginRight: 8 },
    title: { fontSize: 17, fontWeight: '700', color: theme.primary },
    bubble: { maxWidth: '82%', padding: 12, borderRadius: 14, marginHorizontal: 12, marginVertical: 4 },
    userBubble: { alignSelf: 'flex-end', backgroundColor: theme.primary },
    assistantBubble: { alignSelf: 'flex-start', backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border },
    messageText: { fontSize: 15 },
    userText: { color: theme.onPrimary },
    assistantText: { color: theme.text },
    composer: { flexDirection: 'row', alignItems: 'flex-end', padding: 10, borderTopWidth: 1, borderTopColor: theme.border, backgroundColor: theme.surface },
    input: { flex: 1, borderWidth: 1, borderColor: theme.border, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, maxHeight: 120, backgroundColor: theme.surface, fontSize: 15 },
    sendButton: { marginLeft: 8, backgroundColor: theme.primary, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10 },
    sendLabel: { color: theme.onPrimary, fontWeight: '600' },
});
