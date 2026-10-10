import { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { Session } from '../../store/session';
import { theme } from '../../theme';

/** Server origin + account settings. */
export function SettingsScreen({ session, onBack }: { session: Session; onBack: () => void }) {
    const [handle, setHandle] = useState('');

    useEffect(() => {
        session.auth.me().then(user => setHandle(user.handle)).catch(() => {});
    }, [session]);

    async function signOut() {
        await session.signOut();
    }

    return (
        <View style={styles.root}>
            <View style={styles.header}>
                <TouchableOpacity onPress={onBack}><Text style={styles.back}>‹ 返回</Text></TouchableOpacity>
                <Text style={styles.title}>设置</Text>
            </View>

            <View style={styles.body}>
                <Text style={styles.label}>当前账号</Text>
                <TextInput style={styles.input} value={handle} editable={false} />

                <TouchableOpacity style={styles.signOut} onPress={signOut}>
                    <Text style={styles.signOutLabel}>退出登录</Text>
                </TouchableOpacity>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1 },
    header: { flexDirection: 'row', alignItems: 'center', padding: 12, borderBottomWidth: 1, borderBottomColor: theme.border, backgroundColor: theme.surface },
    back: { color: theme.primary, fontSize: 16, marginRight: 8 },
    title: { fontSize: 17, fontWeight: '700', color: theme.primary },
    body: { padding: 16 },
    label: { fontSize: 13, color: theme.muted, marginBottom: 6 },
    input: { borderWidth: 1, borderColor: theme.border, borderRadius: theme.radius, padding: 12, backgroundColor: theme.soft, fontSize: 15, marginBottom: 16 },
    signOut: { backgroundColor: theme.dangerBg, borderRadius: theme.radius, padding: 14, alignItems: 'center' },
    signOutLabel: { color: theme.danger, fontWeight: '600' },
});
