package com.leslietavern.dreamland.mobile;

import android.content.Context;
import android.content.res.AssetManager;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/** Installs bundled, tracked server files separately from persistent user data. */
final class StandaloneServerInstaller {
    private static final String ASSET_ARCHIVE = "dreamland-server.zip";

    private StandaloneServerInstaller() { }

    static File install(Context context) throws IOException {
        File files = context.getFilesDir();
        File current = new File(files, "dreamland-runtime");
        File stage = new File(files, "dreamland-runtime-stage");
        File previous = new File(files, "dreamland-runtime-previous");
        String stamp = BuildConfig.SERVER_ASSET_VERSION + "-" + BuildConfig.VERSION_CODE;
        File marker = new File(current, ".dreamland-server-version");
        if (marker.isFile() && stamp.equals(readText(marker)) && new File(current, "server.js").isFile()) {
            return current;
        }

        deleteOwned(stage);
        if (!stage.mkdirs() && !stage.isDirectory()) throw new IOException("Cannot create server staging directory.");
        extractAssetArchive(context.getAssets(), stage);
        writeText(new File(stage, ".dreamland-server-version"), stamp);

        deleteOwned(previous);
        if (current.exists() && !current.renameTo(previous)) {
            throw new IOException("Cannot safely replace the previous DreamLand server files.");
        }
        if (!stage.renameTo(current)) {
            if (previous.exists()) previous.renameTo(current);
            throw new IOException("Cannot activate the staged DreamLand server files.");
        }
        deleteOwned(previous);
        return current;
    }

    private static void extractAssetArchive(AssetManager assets, File destination) throws IOException {
        String destinationRoot = destination.getCanonicalPath() + File.separator;
        try (InputStream input = new BufferedInputStream(assets.open(ASSET_ARCHIVE));
                ZipInputStream archive = new ZipInputStream(input)) {
            ZipEntry entry;
            byte[] buffer = new byte[32 * 1024];
            while ((entry = archive.getNextEntry()) != null) {
                String name = entry.getName().replace('\\', '/');
                if (name.startsWith("/") || name.contains("\u0000")) {
                    throw new IOException("The bundled server archive contains an unsafe path.");
                }
                for (String segment : name.split("/")) {
                    if ("..".equals(segment)) throw new IOException("The bundled server archive contains an unsafe path.");
                }
                File target = new File(destination, name);
                String targetPath = target.getCanonicalPath();
                if (!targetPath.startsWith(destinationRoot)) {
                    throw new IOException("The bundled server archive contains an unsafe path.");
                }
                if (entry.isDirectory()) {
                    if (!target.isDirectory() && !target.mkdirs()) throw new IOException("Cannot create server directory.");
                } else {
                    File parent = target.getParentFile();
                    if (parent != null && !parent.isDirectory() && !parent.mkdirs()) {
                        throw new IOException("Cannot create server directory.");
                    }
                    try (OutputStream output = new BufferedOutputStream(new FileOutputStream(target))) {
                        int read;
                        while ((read = archive.read(buffer)) != -1) output.write(buffer, 0, read);
                    }
                }
                archive.closeEntry();
            }
        }
    }

    private static String readText(File file) throws IOException {
        java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
        try (InputStream input = new java.io.FileInputStream(file)) {
            byte[] buffer = new byte[1024];
            int read;
            while ((read = input.read(buffer)) != -1) bytes.write(buffer, 0, read);
        }
        return new String(bytes.toByteArray(), java.nio.charset.StandardCharsets.UTF_8);
    }

    private static void writeText(File file, String text) throws IOException {
        try (OutputStream output = new FileOutputStream(file)) {
            output.write(text.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        }
    }

    private static void deleteOwned(File target) throws IOException {
        if (!target.exists()) return;
        File canonical = target.getCanonicalFile();
        File parent = target.getParentFile().getCanonicalFile();
        if (!parent.equals(canonical.getParentFile())) throw new IOException("Refusing to remove an unexpected app data path.");
        deleteChildren(canonical);
    }

    private static void deleteChildren(File directory) throws IOException {
        File[] children = directory.listFiles();
        if (children != null) {
            for (File child : children) {
                if (java.nio.file.Files.isSymbolicLink(child.toPath())) {
                    if (!child.delete()) throw new IOException("Cannot replace bundled DreamLand server files.");
                    continue;
                }
                File canonicalChild = child.getCanonicalFile();
                if (!directory.getCanonicalFile().equals(canonicalChild.getParentFile())) {
                    throw new IOException("Refusing to remove an unexpected app data path.");
                }
                if (canonicalChild.isDirectory()) {
                    deleteChildren(canonicalChild);
                } else if (!child.delete()) {
                    throw new IOException("Cannot replace bundled DreamLand server files.");
                }
            }
        }
        if (!directory.delete()) throw new IOException("Cannot replace bundled DreamLand server files.");
    }
}
