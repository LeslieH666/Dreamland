package com.leslietavern.dreamland.mobile;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;

/** Platform-neutral URL rules shared by Android clients and a future local runtime. */
public final class ServerAddress {
    private ServerAddress() {}

    public static URI parse(String rawAddress) {
        if (rawAddress == null || rawAddress.isBlank()) {
            throw new IllegalArgumentException("请输入电脑上的 DreamLand 地址。");
        }

        String value = rawAddress.trim();
        if (!value.matches("(?i)^https?://.*")) {
            value = "http://" + value;
        }

        try {
            URI uri = new URI(value).normalize();
            String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
            String host = uri.getHost();
            if (!(scheme.equals("http") || scheme.equals("https")) || host == null || host.isBlank()) {
                throw new IllegalArgumentException("地址格式无效，请输入电脑的局域网地址和端口。");
            }
            if (uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null) {
                throw new IllegalArgumentException("地址中不能包含账号、密码、查询参数或片段。");
            }
            if (uri.getPort() > 65535 || uri.getPort() == 0 || uri.getPort() < -1) {
                throw new IllegalArgumentException("端口号无效。");
            }
            if (host.equalsIgnoreCase("localhost") || host.equals("0.0.0.0") || host.equals("::1")
                    || host.startsWith("127.")) {
                throw new IllegalArgumentException("localhost 指向手机本身，请填写电脑的局域网地址。");
            }
            String path = uri.getRawPath();
            if (path == null || path.isEmpty()) {
                uri = new URI(scheme, null, host, uri.getPort(), "/", null, null);
            }
            return uri;
        } catch (URISyntaxException exception) {
            throw new IllegalArgumentException("地址格式无效，请输入例如 http://192.168.1.20:8000。", exception);
        }
    }

    public static boolean sameOrigin(URI configuredServer, URI candidate) {
        if (configuredServer == null || candidate == null || candidate.getHost() == null) {
            return false;
        }
        return configuredServer.getScheme().equalsIgnoreCase(candidate.getScheme())
                && configuredServer.getHost().equalsIgnoreCase(candidate.getHost())
                && effectivePort(configuredServer) == effectivePort(candidate);
    }

    public static boolean isPrivateOrLoopbackHost(String host) {
        if (host == null) return false;
        String normalized = host.toLowerCase(Locale.ROOT);
        if (normalized.equals("localhost") || normalized.endsWith(".localhost") || normalized.endsWith(".local")
                || normalized.equals("::1") || normalized.equals("0.0.0.0")) return true;
        String[] octets = normalized.split("\\.");
        if (octets.length != 4) return false;
        try {
            int first = Integer.parseInt(octets[0]);
            int second = Integer.parseInt(octets[1]);
            int third = Integer.parseInt(octets[2]);
            int fourth = Integer.parseInt(octets[3]);
            if (first > 255 || second > 255 || third > 255 || fourth > 255) return false;
            return first == 10 || first == 127 || first == 0 || first == 169 && second == 254
                    || first == 172 && second >= 16 && second <= 31
                    || first == 192 && second == 168;
        } catch (NumberFormatException ignored) {
            return false;
        }
    }

    private static int effectivePort(URI uri) {
        if (uri.getPort() >= 0) return uri.getPort();
        return uri.getScheme().equalsIgnoreCase("https") ? 443 : 80;
    }
}
