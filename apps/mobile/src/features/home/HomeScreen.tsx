import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { Session } from '../../store/session';
import { theme } from '../../theme';
import { CharacterListScreen } from '../characters/CharacterListScreen';
import { ChatScreen } from '../chat/ChatScreen';
import { FeedScreen } from '../feed/FeedScreen';
import { SettingsScreen } from '../settings/SettingsScreen';
import { CharacterSummary } from '../../api';

type Route =
    | { name: 'characters' }
    | { name: 'chat'; character: CharacterSummary }
    | { name: 'feed'; tab: 'memory' | 'moments' }
    | { name: 'settings' };

/** The post-login shell: module tabs plus the routed feature screens. */
export function HomeScreen({ session }: { session: Session }) {
    const [route, setRoute] = useState<Route>({ name: 'characters' });

    if (route.name === 'chat') {
        return (
            <ChatScreen
                session={session}
                character={route.character}
                onBack={() => setRoute({ name: 'characters' })}
            />
        );
    }
    if (route.name === 'feed') {
        return (
            <FeedScreen
                session={session}
                tab={route.tab}
                onBack={() => setRoute({ name: 'characters' })}
            />
        );
    }
    if (route.name === 'settings') {
        return <SettingsScreen session={session} onBack={() => setRoute({ name: 'characters' })} />;
    }

    return (
        <View style={styles.root}>
            <ScrollView contentContainerStyle={styles.content}>
                <Text style={styles.title}>DreamLand</Text>
                <CharacterListScreen
                    session={session}
                    onOpenCharacter={character => setRoute({ name: 'chat', character })}
                />
            </ScrollView>
            <View style={styles.tabBar}>
                <Tab label="角色" onPress={() => setRoute({ name: 'characters' })} />
                <Tab label="记忆" onPress={() => setRoute({ name: 'feed', tab: 'memory' })} />
                <Tab label="朋友圈" onPress={() => setRoute({ name: 'feed', tab: 'moments' })} />
                <Tab label="设置" onPress={() => setRoute({ name: 'settings' })} />
            </View>
        </View>
    );
}

function Tab({ label, onPress }: { label: string; onPress: () => void }) {
    return (
        <TouchableOpacity style={styles.tab} onPress={onPress}>
            <Text style={styles.tabLabel}>{label}</Text>
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1 },
    content: { padding: 16, paddingBottom: 24 },
    title: { fontSize: 22, fontWeight: '700', color: theme.primary, marginBottom: 12 },
    tabBar: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: theme.border, backgroundColor: theme.surface },
    tab: { flex: 1, paddingVertical: 14, alignItems: 'center' },
    tabLabel: { color: theme.primary, fontWeight: '600' },
});
