import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { MemoryEvent, MomentPost } from '../../api';
import { Session } from '../../store/session';

interface FeedItem {
    id: string;
    text: string;
}

/** Read-only memory / moments feed (first release). */
export function FeedScreen({ session, tab, onBack }: {
    session: Session;
    tab: 'memory' | 'moments';
    onBack: () => void;
}) {
    const [items, setItems] = useState<FeedItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        let active = true;
        setLoading(true);
        const load = tab === 'memory'
            ? session.memory.listSources()
                .then(sources => {
                    const first = sources[0];
                    return first ? session.memory.listEvents(first.id) : Promise.resolve([] as MemoryEvent[]);
                })
                .then(memoryItems => memoryItems.map(item => ({ id: item.id, text: item.summary })))
                .catch(() => [] as FeedItem[])
            : session.moments.list()
                .then(momentItems => (momentItems as MomentPost[]).map(item => ({ id: item.id, text: item.content })))
                .catch(() => [] as FeedItem[]);

        load.then(next => {
            if (!active) return;
            setItems(next);
            setError('');
        }).catch(raised => {
            if (active) setError(raised instanceof Error ? raised.message : String(raised));
        }).finally(() => {
            if (active) setLoading(false);
        });
        return () => { active = false; };
    }, [session, tab]);

    return (
        <View style={styles.root}>
            <View style={styles.header}>
                <TouchableOpacity onPress={onBack}><Text style={styles.back}>‹ 返回</Text></TouchableOpacity>
                <Text style={styles.title}>{tab === 'memory' ? '记忆' : '朋友圈'}</Text>
            </View>

            {loading ? <ActivityIndicator color="#163c63" style={{ marginTop: 24 }} /> : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}

            <FlatList
                data={items}
                keyExtractor={item => item.id}
                renderItem={({ item }) => (
                    <View style={styles.card}>
                        <Text style={styles.content}>{item.text}</Text>
                    </View>
                )}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1 },
    header: { flexDirection: 'row', alignItems: 'center', padding: 12, borderBottomWidth: 1, borderBottomColor: '#dfe6ed', backgroundColor: '#ffffff' },
    back: { color: '#163c63', fontSize: 16, marginRight: 8 },
    title: { fontSize: 17, fontWeight: '700', color: '#163c63' },
    card: { backgroundColor: '#ffffff', borderRadius: 10, padding: 14, margin: 12, borderWidth: 1, borderColor: '#e2e9f0' },
    content: { fontSize: 14, color: '#1c2a38' },
    error: { color: '#b3372e', marginTop: 24, textAlign: 'center' },
});
