import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity } from 'react-native';

import { CharacterSummary } from '../../api';
import { Session } from '../../store/session';

/** Character-card list; tapping a card opens its chat. */
export function CharacterListScreen({ session, onOpenCharacter }: {
    session: Session;
    onOpenCharacter: (character: CharacterSummary) => void;
}) {
    const [characters, setCharacters] = useState<CharacterSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        let active = true;
        session.characters.list()
            .then(items => { if (active) { setCharacters(items); setError(''); } })
            .catch(raised => { if (active) setError(raised instanceof Error ? raised.message : String(raised)); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [session]);

    if (loading) {
        return <ActivityIndicator color="#163c63" style={{ marginTop: 24 }} />;
    }
    if (error) {
        return <Text style={styles.error}>{error}</Text>;
    }

    return (
        <FlatList
            data={characters}
            keyExtractor={item => item.id}
            renderItem={({ item }) => (
                <TouchableOpacity style={styles.card} onPress={() => onOpenCharacter(item)}>
                    <Text style={styles.name}>{item.name}</Text>
                    {item.description ? <Text style={styles.desc} numberOfLines={2}>{item.description}</Text> : null}
                </TouchableOpacity>
            )}
        />
    );
}

const styles = StyleSheet.create({
    card: {
        backgroundColor: '#ffffff', borderRadius: 10, padding: 14, marginBottom: 10,
        borderWidth: 1, borderColor: '#e2e9f0',
    },
    name: { fontSize: 17, fontWeight: '600', color: '#163c63' },
    desc: { fontSize: 13, color: '#5a6b7c', marginTop: 4 },
    error: { color: '#b3372e', marginTop: 24, textAlign: 'center' },
});
