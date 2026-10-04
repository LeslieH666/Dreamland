package com.leslietavern.dreamland.mobile;

/** Feature policy for the first phone-connected client; later runtimes can supply a different policy. */
public final class MobileCapabilities {
    private final boolean localModelManagement;
    private final boolean airiCompanion;
    private final boolean localServer;

    public MobileCapabilities(boolean localModelManagement, boolean airiCompanion, boolean localServer) {
        this.localModelManagement = localModelManagement;
        this.airiCompanion = airiCompanion;
        this.localServer = localServer;
    }

    public boolean localModelManagement() { return localModelManagement; }
    public boolean airiCompanion() { return airiCompanion; }
    public boolean localServer() { return localServer; }

    public static MobileCapabilities connectedClient() {
        return new MobileCapabilities(false, false, false);
    }

    public static MobileCapabilities standaloneClient() {
        return new MobileCapabilities(true, false, true);
    }
}
