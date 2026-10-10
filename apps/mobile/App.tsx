import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, SafeAreaView, StyleSheet, View } from 'react-native';

import { Session } from './src/store/session';
import { AuthScreen } from './src/features/auth/AuthScreen';
import { HomeScreen } from './src/features/home/HomeScreen';

// The server origin is injected at build/launch time. The first release points at a
// developer-chosen origin; production reads it from a native config.
const DEFAULT_BASE_URL = 'http://127.0.0.1:18790';

export default function App() {
    const [session, setSession] = useState<Session | null>(null);

    useEffect(() => {
        let active = true;
        Session.create({ baseUrl: DEFAULT_BASE_URL }).then(next => {
            if (active) setSession(next);
        });
        return () => { active = false; };
    }, []);

    if (!session) {
        return (
            <View style={styles.center}>
                <ActivityIndicator size="large" color="#163c63" />
                <StatusBar style="auto" />
            </View>
        );
    }

    return (
        <SafeAreaView style={styles.root}>
            <StatusBar style="auto" />
            {session.signedIn
                ? <HomeScreen session={session} />
                : <AuthScreen session={session} />}
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: '#edf2f5' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#edf2f5' },
});
