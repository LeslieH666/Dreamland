import { useState } from 'react';
import { ActivityIndicator, Button, StyleSheet, Text, TextInput, View } from 'react-native';

import { Session } from '../../store/session';
import { theme } from '../../theme';

/** Login / registration screen for the versioned token auth. */
export function AuthScreen({ session }: { session: Session }) {
    const [handle, setHandle] = useState('');
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    async function submit(register: boolean) {
        if (!handle.trim() || !password) {
            setError('请输入账号和密码。');
            return;
        }
        setBusy(true);
        setError('');
        try {
            if (register) {
                await session.auth.register(handle.trim(), password);
            }
            const tokens = await session.auth.login(handle.trim(), password);
            await session.signIn(tokens);
        } catch (raised) {
            setError(raised instanceof Error ? raised.message : String(raised));
        } finally {
            setBusy(false);
        }
    }

    return (
        <View style={styles.container}>
            <Text style={styles.title}>DreamLand</Text>
            <Text style={styles.subtitle}>连接你的 DreamLand 服务器</Text>

            <TextInput
                style={styles.input}
                placeholder="账号"
                autoCapitalize="none"
                autoCorrect={false}
                value={handle}
                onChangeText={setHandle}
            />
            <TextInput
                style={styles.input}
                placeholder="密码"
                secureTextEntry
                value={password}
                onChangeText={setPassword}
            />

            {error ? <Text style={styles.error}>{error}</Text> : null}

            {busy ? <ActivityIndicator color={theme.primary} /> : (
                <>
                    <View style={styles.buttonRow}>
                        <Button title="登录" onPress={() => submit(false)} color={theme.primary} />
                    </View>
                    <View style={styles.buttonRow}>
                        <Button title="注册新账号" onPress={() => submit(true)} color={theme.quietText} />
                    </View>
                </>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, justifyContent: 'center', padding: 24 },
    title: { fontSize: 28, fontWeight: '700', color: theme.primary, textAlign: 'center' },
    subtitle: { fontSize: 14, color: theme.muted, textAlign: 'center', marginBottom: 24 },
    input: {
        borderWidth: 1, borderColor: theme.border, borderRadius: theme.radius,
        padding: 12, marginBottom: 12, backgroundColor: theme.surface, fontSize: 16,
    },
    error: { color: theme.danger, marginBottom: 12, textAlign: 'center' },
    buttonRow: { marginTop: 8 },
});
