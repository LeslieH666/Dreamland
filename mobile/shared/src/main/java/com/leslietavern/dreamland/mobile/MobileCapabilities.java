package com.leslietavern.dreamland.mobile;

/** Feature policy for the first phone-connected client; later runtimes can supply a different policy. */
public final class MobileCapabilities {
    private final boolean localServer;

    public MobileCapabilities(boolean localServer) {
        this.localServer = localServer;
    }

    public boolean localServer() { return localServer; }

    public static MobileCapabilities connectedClient() {
        return new MobileCapabilities(false);
    }

    public static MobileCapabilities standaloneClient() {
        return new MobileCapabilities(true);
    }
}
