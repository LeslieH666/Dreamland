import { useState } from 'react';
import { ActivityIndicator, Button, StyleSheet, Text, TextInput, View } from 'react-native';

import { Session } from '../../store/session';

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

            {busy ? <ActivityIndicator color="#163c63" /> : (
                <>
                    <View style={styles.buttonRow}>
                        <Button title="登录" onPress={() => submit(false)} color="#163c63" />
                    </View>
                    <View style={styles.buttonRow}>
                        <Button title="注册新账号" onPress={() => submit(true)} color="#6c8aa8" />
                    </View>
                </>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, justifyContent: 'center', padding: 24 },
    title: { fontSize: 28, fontWeight: '700', color: '#163c63', textAlign: 'center' },
    subtitle: { fontSize: 14, color: '#5a6b7c', textAlign: 'center', marginBottom: 24 },
    input: {
        borderWidth: 1, borderColor: '#c4cfd9', borderRadius: 8,
        padding: 12, marginBottom: 12, backgroundColor: '#ffffff', fontSize: 16,
    },
    error: { color: '#b3372e', marginBottom: 12, textAlign: 'center' },
    buttonRow: { marginTop: 8 },
});
