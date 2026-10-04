package com.leslietavern.dreamland.nodebridge;

/** In-process bridge to the verified Android Node.js mobile runtime. */
public final class NodeRuntime {
    static {
        System.loadLibrary("dreamlandnode");
    }

    private NodeRuntime() { }

    public static native int startNode(String serverRoot, String dataRoot,
            String configPath, String cacheRoot);

    public static native void stopNode();
}
