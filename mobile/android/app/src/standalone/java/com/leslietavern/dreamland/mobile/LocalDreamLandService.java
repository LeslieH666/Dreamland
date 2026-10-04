package com.leslietavern.dreamland.mobile;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.IBinder;
import android.os.Handler;
import android.os.Looper;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import com.leslietavern.dreamland.nodebridge.NodeRuntime;

import java.io.File;

/** Keeps the in-process DreamLand server alive while the user returns from chat UI. */
public final class LocalDreamLandService extends Service {
    private static final String CHANNEL_ID = "dreamland_local_server";
    private static final int NOTIFICATION_ID = 18790;
    static final String ACTION_STOP = "com.leslietavern.dreamland.mobile.STOP_LOCAL_SERVER";

    private volatile boolean nodeStarted;
    private volatile boolean stopRequested;
    private Thread nodeThread;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopRequested = true;
            if (nodeStarted) NodeRuntime.stopNode();
            stopSelf(startId);
            return START_NOT_STICKY;
        }
        startForeground(NOTIFICATION_ID, buildNotification());
        if (nodeThread == null) {
            nodeThread = new Thread(this::runLocalServer, "DreamLand-local-server");
            nodeThread.start();
        }
        return START_STICKY;
    }

    private void runLocalServer() {
        int exitCode = 1;
        try {
            File server = StandaloneServerInstaller.install(this);
            File data = new File(getFilesDir(), "dreamland-data");
            File config = new File(getFilesDir(), "dreamland-config/config.yaml");
            File cache = getCacheDir();
            if (!data.isDirectory() && !data.mkdirs()) throw new IllegalStateException("Cannot create local data directory.");
            File configDirectory = config.getParentFile();
            if (configDirectory != null && !configDirectory.isDirectory() && !configDirectory.mkdirs()) {
                throw new IllegalStateException("Cannot create local configuration directory.");
            }
            if (stopRequested) return;
            nodeStarted = true;
            exitCode = NodeRuntime.startNode(server.getAbsolutePath(), data.getAbsolutePath(),
                    config.getAbsolutePath(), cache.getAbsolutePath());
        } catch (Exception exception) {
            android.util.Log.e("DreamLandBeta", "Could not start the on-device server", exception);
        } finally {
            android.util.Log.i("DreamLandBeta", "On-device server stopped with status " + exitCode);
            nodeStarted = false;
            mainHandler.post(() -> {
                stopForeground(STOP_FOREGROUND_REMOVE);
                stopSelf();
            });
        }
    }

    private Notification buildNotification() {
        Intent stop = new Intent(this, LocalDreamLandService.class).setAction(ACTION_STOP);
        PendingIntent stopIntent = PendingIntent.getService(this, 1, stop,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Intent open = new Intent(this, MainActivity.class);
        PendingIntent openIntent = PendingIntent.getActivity(this, 2, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.stat_notify_sync_noanim)
                .setContentTitle(getString(R.string.app_name))
                .setContentText(getString(R.string.local_server_running))
                .setContentIntent(openIntent)
                .setOngoing(true)
                .addAction(0, getString(R.string.stop_local_server), stopIntent)
                .build();
    }

    private void createNotificationChannel() {
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID,
                getString(R.string.local_server_channel), NotificationManager.IMPORTANCE_LOW);
        getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
