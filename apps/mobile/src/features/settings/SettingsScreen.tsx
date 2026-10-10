import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { ModelCatalogEntry } from '../../api/types';
import { Session } from '../../store/session';
import { theme } from '../../theme';

/** Server origin + account settings. */
export function SettingsScreen({ session, onBack }: { session: Session; onBack: () => void }) {
    const [handle, setHandle] = useState('');
    const [models, setModels] = useState<ModelCatalogEntry[]>([]);
    const [pickerOpen, setPickerOpen] = useState(false);
    const [loadError, setLoadError] = useState('');

    useEffect(() => {
        session.auth.me().then(user => setHandle(user.handle)).catch(() => {});
        session.chats.listModels()
            .then(list => {
                setModels(list);
                // Default to the first enabled model when none has been chosen yet.
                const first = list[0];
                if (!session.selectedModelId && first) {
                    session.selectedModelId = first.id;
                }
            })
            .catch(error => setLoadError(String(error?.message ?? error)));
    }, [session]);

    async function signOut() {
        await session.signOut();
    }

    const selected = models.find(model => model.id === session.selectedModelId);

    return (
        <View style={styles.root}>
            <View style={styles.header}>
                <TouchableOpacity onPress={onBack}><Text style={styles.back}>‹ 返回</Text></TouchableOpacity>
                <Text style={styles.title}>设置</Text>
            </View>

            <ScrollView style={styles.body}>
                <Text style={styles.label}>当前账号</Text>
                <TextInput style={styles.input} value={handle} editable={false} />

                <Text style={styles.label}>模型选择</Text>
                <Text style={styles.hint}>模型由服务器提供，此处无法配置密钥。</Text>
                <TouchableOpacity style={styles.input} onPress={() => setPickerOpen(open => !open)}>
                    <Text style={selected ? styles.pickerValue : styles.pickerPlaceholder}>
                        {selected ? selected.name : '选择模型'}
                    </Text>
                </TouchableOpacity>
                {loadError ? <Text style={styles.error}>{loadError}</Text> : null}
                {pickerOpen ? (
                    <View style={styles.pickerList}>
                        {models.length === 0 ? <Text style={styles.hint}>暂无可用模型</Text> : null}
                        {models.map(model => (
                            <TouchableOpacity
                                key={model.id}
                                style={[styles.pickerRow, model.id === session.selectedModelId ? styles.pickerRowSelected : null]}
                                onPress={() => {
                                    session.selectedModelId = model.id;
                                    setPickerOpen(false);
                                }}>
                                <Text style={model.id === session.selectedModelId ? styles.pickerRowSelectedText : styles.pickerRowText}>
                                    {model.name}
                                </Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                ) : null}

                <TouchableOpacity style={styles.signOut} onPress={signOut}>
                    <Text style={styles.signOutLabel}>退出登录</Text>
                </TouchableOpacity>
            </ScrollView>
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
    hint: { fontSize: 12, color: theme.muted, marginBottom: 8 },
    error: { color: theme.danger, fontSize: 12, marginBottom: 8 },
    input: { borderWidth: 1, borderColor: theme.border, borderRadius: theme.radius, padding: 12, backgroundColor: theme.soft, fontSize: 15, marginBottom: 16, justifyContent: 'center' },
    pickerValue: { fontSize: 15, color: theme.text },
    pickerPlaceholder: { fontSize: 15, color: theme.muted },
    pickerList: { borderWidth: 1, borderColor: theme.border, borderRadius: theme.radius, marginTop: -8, marginBottom: 16, overflow: 'hidden' },
    pickerRow: { padding: 12, borderBottomWidth: 1, borderBottomColor: theme.border, backgroundColor: theme.soft },
    pickerRowText: { fontSize: 14, color: theme.text },
    pickerRowSelected: { backgroundColor: theme.primary },
    pickerRowSelectedText: { fontSize: 14, color: '#ffffff', fontWeight: '600' },
    signOut: { backgroundColor: theme.dangerBg, borderRadius: theme.radius, padding: 14, alignItems: 'center', marginTop: 8 },
    signOutLabel: { color: theme.danger, fontWeight: '600' },
});
