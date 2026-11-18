package com.aleisteralvear.newsie.network.security

import java.net.Inet4Address
import java.net.Inet6Address
import java.net.InetAddress
import java.net.URI
import java.util.Locale

class UnsafeUrlException(message: String) : SecurityException(message)

object UrlSecurityGuard {
    private val blockedHostSuffixes = listOf(
        ".local",
        ".localhost",
        ".internal",
        ".arpa",
        ".lan",
        ".home",
        ".corp",
    )

    private val blockedExactHosts = setOf(
        "localhost",
        "metadata",
        "metadata.google.internal",
        "metadata.goog",
        "instance-data",
        "0.0.0.0",
        "::",
        "::1",
    )

    /**
     * Validates URL syntax, scheme, absence of userinfo credentials, and public hostname safety.
     * Note: Does not check DNS yet; call assertResolvedAddressSafe() on actual InetAddresses
     * before opening sockets.
     */
    fun validateFeedUrlSyntax(
        rawUrl: String,
        allowLocalNetworkExplicitly: Boolean = false,
        allowCleartextHttp: Boolean = false,
    ): URI {
        val trimmed = rawUrl.trim()
        if (trimmed.isEmpty() || trimmed.length > 2048) {
            throw UnsafeUrlException("Feed URL must be non-empty and under 2048 characters.")
        }
        val uri = try {
            URI(trimmed)
        } catch (ex: Exception) {
            throw UnsafeUrlException("Malformed URL syntax.")
        }

        val scheme = uri.scheme?.lowercase(Locale.US)
            ?: throw UnsafeUrlException("URL must specify https:// scheme.")
        val validSchemes = if (allowCleartextHttp) setOf("https", "http") else setOf("https")
        if (scheme !in validSchemes) {
            throw UnsafeUrlException("Unsupported scheme '$scheme'. Only HTTPS feeds are permitted by default.")
        }

        if (!uri.rawUserInfo.isNullOrEmpty()) {
            throw UnsafeUrlException("Embedded credentials in URLs are forbidden.")
        }

        val host = uri.host?.lowercase(Locale.US)?.trimEnd('.')
            ?: throw UnsafeUrlException("Feed URL must include a valid host.")

        if (!allowLocalNetworkExplicitly) {
            if (host in blockedExactHosts || blockedHostSuffixes.any { host.endsWith(it) }) {
                throw UnsafeUrlException("Local, internal, or metadata hostnames are blocked ($host).")
            }
            // Also inspect literal IP hoststrings (strip IPv6 brackets)
            val bareHost = host.removePrefix("[").removeSuffix("]")
            if (isIpLiteral(bareHost)) {
                val addr = InetAddress.getByName(bareHost)
                assertAddressSafe(addr, allowLocalNetworkExplicitly = false)
            }
        }

        return uri
    }

    fun assertAddressSafe(
        address: InetAddress,
        allowLocalNetworkExplicitly: Boolean = false,
    ) {
        if (allowLocalNetworkExplicitly) {
            // Even if local LAN feed explicitly approved, still block cloud metadata 169.254.169.254
            if (isCloudMetadataAddress(address)) {
                throw UnsafeUrlException("Cloud metadata endpoints are strictly forbidden.")
            }
            return
        }

        if (address.isAnyLocalAddress ||
            address.isLoopbackAddress ||
            address.isLinkLocalAddress ||
            address.isSiteLocalAddress ||
            address.isMulticastAddress ||
            isCloudMetadataAddress(address)
        ) {
            throw UnsafeUrlException("Blocked non-public IP address destination: ${address.hostAddress}")
        }

        when (address) {
            is Inet4Address -> {
                val b = address.address
                val o0 = b[0].toInt() and 0xFF
                val o1 = b[1].toInt() and 0xFF
                val isPrivateOrReserved =
                    o0 == 0 || // 0.0.0.0/8
                        o0 == 10 || // 10.0.0.0/8
                        o0 == 127 || // 127.0.0.0/8 loopback
                        (o0 == 100 && o1 in 64..127) || // 100.64.0.0/10 CGNAT
                        (o0 == 169 && o1 == 254) || // 169.254.0.0/16 link-local + metadata
                        (o0 == 172 && o1 in 16..31) || // 172.16.0.0/12
                        (o0 == 192 && o1 == 168) || // 192.168.0.0/16
                        (o0 == 192 && o1 == 0 && (b[2].toInt() and 0xFF) == 0) ||
                        (o0 == 198 && o1 in 18..19) || // 198.18.0.0/15 benchmarking
                        o0 >= 224 // Multicast + reserved
                if (isPrivateOrReserved) {
                    throw UnsafeUrlException("Blocked private or reserved IPv4 range: ${address.hostAddress}")
                }
            }
            is Inet6Address -> {
                val b = address.address
                val first = b[0].toInt() and 0xFF
                val second = b[1].toInt() and 0xFF
                val isUla = (first and 0xFE) == 0xFC // fc00::/7
                val isLinkLocal = first == 0xFE && (second and 0xC0) == 0x80 // fe80::/10
                val isMulticast = first == 0xFF
                val isV4Mapped = isIpv4MappedIpv6(b)
                if (isUla || isLinkLocal || isMulticast) {
                    throw UnsafeUrlException("Blocked non-public IPv6 address range.")
                }
                if (isV4Mapped) {
                    val v4 = InetAddress.getByAddress(b.copyOfRange(12, 16))
                    assertAddressSafe(v4, allowLocalNetworkExplicitly = false)
                }
            }
        }
    }

    private fun isCloudMetadataAddress(address: InetAddress): Boolean {
        val raw = address.address
        return raw.size == 4 &&
            (raw[0].toInt() and 0xFF) == 169 &&
            (raw[1].toInt() and 0xFF) == 254 &&
            (raw[2].toInt() and 0xFF) == 169 &&
            (raw[3].toInt() and 0xFF) == 254
    }

    private fun isIpv4MappedIpv6(bytes: ByteArray): Boolean {
        if (bytes.size != 16) return false
        for (i in 0..9) if (bytes[i].toInt() != 0) return false
        return (bytes[10].toInt() and 0xFF) == 0xFF && (bytes[11].toInt() and 0xFF) == 0xFF
    }

    private fun isIpLiteral(host: String): Boolean {
        if (host.contains(":")) return true
        val parts = host.split(".")
        if (parts.size != 4) return false
        return parts.all { p -> p.isNotEmpty() && p.all { it.isDigit() } && p.toIntOrNull()?.let { it in 0..255 } == true }
    }
}
