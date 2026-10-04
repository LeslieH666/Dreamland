package com.leslietavern.dreamland.mobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.net.URI;
import org.junit.Test;

public class ServerAddressTest {
    @Test
    public void addsHttpSchemeAndKeepsComputerPort() {
        assertEquals(URI.create("http://192.168.1.20:8000/"), ServerAddress.parse("192.168.1.20:8000"));
    }

    @Test
    public void allowsHttpsAndLocalDnsNames() {
        assertEquals(URI.create("https://dreamland.home/"), ServerAddress.parse("https://dreamland.home"));
    }

    @Test
    public void rejectsPhoneLoopbackAndEmbeddedCredentials() {
        assertThrows(IllegalArgumentException.class, () -> ServerAddress.parse("http://localhost:8000"));
        assertThrows(IllegalArgumentException.class, () -> ServerAddress.parse("http://name:secret@192.168.1.20:8000"));
    }

    @Test
    public void sameOriginIncludesSchemeHostAndPort() {
        URI server = ServerAddress.parse("http://192.168.1.20:8000");
        assertTrue(ServerAddress.sameOrigin(server, URI.create("http://192.168.1.20:8000/api/status")));
        assertFalse(ServerAddress.sameOrigin(server, URI.create("http://192.168.1.20:5001")));
        assertFalse(ServerAddress.sameOrigin(server, URI.create("https://192.168.1.20:8000")));
    }

    @Test
    public void recognizesPrivateAndLoopbackTargets() {
        assertTrue(ServerAddress.isPrivateOrLoopbackHost("192.168.1.20"));
        assertTrue(ServerAddress.isPrivateOrLoopbackHost("127.0.0.1"));
        assertFalse(ServerAddress.isPrivateOrLoopbackHost("8.8.8.8"));
        assertFalse(ServerAddress.isPrivateOrLoopbackHost("192.168.999.1"));
    }
}
