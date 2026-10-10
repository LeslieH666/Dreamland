import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, SafeAreaView, StyleSheet, View } from 'react-native';

import { Session } from './src/store/session';
import { theme } from './src/theme';
import { AuthScreen } from './src/features/auth/AuthScreen';
import { HomeScreen } from './src/features/home/HomeScreen';

// The server origin is injected at build/launch time via EXPO_PUBLIC_API_URL; it
// defaults to the developer loopback so simulator/emulator runs work out of the box.
const DEFAULT_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://127.0.0.1:18790';

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
                <ActivityIndicator size="large" color={theme.primary} />
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
    root: { flex: 1, backgroundColor: theme.background },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.background },
});
