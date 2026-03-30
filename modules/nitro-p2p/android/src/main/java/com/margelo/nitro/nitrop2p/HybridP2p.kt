package com.margelo.nitro.nitrop2p

import android.content.Context
import android.net.wifi.WifiManager
import android.os.Handler
import android.os.Looper
import com.margelo.nitro.core.HybridObject
import org.json.JSONObject
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.IOException
import java.net.DatagramPacket
import java.net.InetAddress
import java.net.MulticastSocket
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketException
import java.net.SocketTimeoutException
import java.nio.ByteBuffer
import java.util.Date
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

// ─────────────────────────────────────────────────────────────────────────────
// HybridP2P.kt
//
// Wire protocol (identical to Swift counterpart):
//   Discovery  → UDP multicast  239.255.42.1:45679  JSON beacon every 1.5s
//   Transport  → TCP            [UInt32 BE length][UTF-8 payload]
//   Handshake  → first TCP msg  "__HS__{"id":…,"name":…,"port":…}"
// ─────────────────────────────────────────────────────────────────────────────

private const val BEACON_HOST = "239.255.42.1"
private const val BEACON_PORT = 45679
private const val BEACON_INTERVAL_MS = 1500L
private const val BEACON_TTL_MS = 6000L
private const val EXPIRY_CHECK_INTERVAL_MS = 2000L

class HybridP2P(val context: Context) : HybridP2PSpec() {

    // ─── Identity ─────────────────────────────────────────────────────────────
    private val deviceId: String = UUID.randomUUID().toString()
    private var deviceName: String = android.os.Build.MODEL
    private var tcpPort: Int = 45678

    // ─── Subscriber registry ──────────────────────────────────────────────────
    // Key: subscription ID (returned to caller)
    // Value: the callback function
    private val subscribers: ConcurrentHashMap<Double, (P2PEvent) -> Unit> = ConcurrentHashMap()
    private val nextSubscriberId: AtomicInteger = AtomicInteger(0)

    // ─── Network state ────────────────────────────────────────────────────────
    private var tcpServerSocket: ServerSocket? = null
    private var multicastSocket: MulticastSocket? = null
    private var multicastLock: WifiManager.MulticastLock? = null
    private var beaconScheduler: ScheduledExecutorService? = null
    private var expiryScheduler: ScheduledExecutorService? = null
    private val discoveredPeers: ConcurrentHashMap<String, DiscoveredPeer> = ConcurrentHashMap()
    private val connections: ConcurrentHashMap<String, ManagedConnection> = ConcurrentHashMap()
    private val networkExecutor = Executors.newCachedThreadPool()

    // ─── Main thread handler for event emission ─────────────────────────────
    private val mainHandler = Handler(Looper.getMainLooper())

    // ─── Data classes ─────────────────────────────────────────────────────────
    private data class DiscoveredPeer(
        val id: String,
        val name: String,
        var host: String,
        val port: Int,
        var lastSeen: Date
    ) {
        fun toP2PPeer(): P2PPeer = P2PPeer(id, name, host, port.toDouble())
    }

    private class ManagedConnection(
        val socket: Socket,
        var peer: P2PPeer?,
        val output: DataOutputStream
    ) {
        fun send(data: String) {
            try {
                val payload = data.toByteArray(Charsets.UTF_8)
                val length = ByteBuffer.allocate(4).putInt(payload.size).array()
                output.write(length)
                output.write(payload)
                output.flush()
            } catch (e: IOException) {
                // Connection will be cleaned up by read thread
            }
        }
    }

    // ─── Public API ─────────────────────────────────────────────────────────────

    override fun setDeviceName(name: String) {
        deviceName = name
    }

    override fun start(servicePort: Double?) {
        servicePort?.let { tcpPort = it.toInt() }
        networkExecutor.execute {
            startTCPServer()
            startUDPMulticast()
            startBeaconing()
            startExpiryTimer()
        }
    }

    override fun stop() {
        networkExecutor.execute {
            beaconScheduler?.shutdownNow()
            expiryScheduler?.shutdownNow()
            multicastSocket?.close()
            multicastLock?.release()
            tcpServerSocket?.close()
            connections.values.forEach { closeConnection(it) }
            connections.clear()
            discoveredPeers.clear()
        }
    }

    override fun connect(peerId: String) {
        networkExecutor.execute {
            if (connections[peerId] != null) return@execute

            val peer = discoveredPeers[peerId] ?: run {
                emitError("PEER_NOT_FOUND", "Peer not found: $peerId")
                return@execute
            }

            try {
                val socket = Socket(peer.host, peer.port)
                val output = DataOutputStream(socket.getOutputStream())
                val mc = ManagedConnection(socket, null, output)
                connections[peerId] = mc
                handleConnection(mc)
            } catch (e: IOException) {
                emitError("CONNECTION_FAILED", e.message ?: "Failed to connect")
            }
        }
    }

    override fun disconnect(peerId: String) {
        networkExecutor.execute {
            connections[peerId]?.let { closeConnection(it) }
            connections.remove(peerId)
            emit(P2PEvent.create(P2PPeerDisconnected(type = P2PEventType.PEERDISCONNECTED, peerId = peerId)))
        }
    }

    override fun sendToPeer(peerId: String, data: String) {
        networkExecutor.execute {
            connections[peerId]?.send(data)
        }
    }

    override fun broadcast(data: String) {
        networkExecutor.execute {
            connections.values.forEach { it.send(data) }
        }
    }

    override fun getDiscoveredPeers(): Array<P2PPeer> {
        return discoveredPeers.values.map { it.toP2PPeer() }.toTypedArray()
    }

    override fun getConnectedPeers(): Array<P2PPeer> {
        return connections.values.mapNotNull { it.peer }.toTypedArray()
    }

    override fun subscribe(callback: (P2PEvent) -> Unit): Double {
        val id = nextSubscriberId.getAndIncrement().toDouble()
        subscribers[id] = callback
        return id
    }

    override fun unsubscribe(id: Double) {
        subscribers.remove(id)
    }

    // ─── Event Emission ─────────────────────────────────────────────────────────────

    private fun emit(event: P2PEvent) {
        // Snapshot callbacks to allow lock-free iteration
        val callbacks = subscribers.values.toList()
        mainHandler.post {
            callbacks.forEach { it(event) }
        }
    }

    private fun emitError(code: String, message: String) {
        emit(P2PEvent.create(P2PErrorEvent(type = P2PEventType.ERROR, code = code, message = message)))
    }

    // ─── TCP Server ─────────────────────────────────────────────────────────────

    private fun startTCPServer() {
        try {
            tcpServerSocket = ServerSocket(tcpPort)
            while (tcpServerSocket?.isClosed == false) {
                try {
                    val socket = tcpServerSocket?.accept() ?: break
                    val output = DataOutputStream(socket.getOutputStream())
                    val mc = ManagedConnection(socket, null, output)
                    networkExecutor.execute { handleConnection(mc) }
                } catch (e: SocketException) {
                    // Socket closed, exit loop
                    break
                }
            }
        } catch (e: IOException) {
            emitError("TCP_BIND_FAILED", "Cannot bind port $tcpPort: ${e.message}")
        }
    }

    private fun handleConnection(mc: ManagedConnection) {
        // Send handshake immediately on connect
        val handshakeJson = JSONObject().apply {
            put("id", deviceId)
            put("name", deviceName)
            put("port", tcpPort)
        }
        mc.send("__HS__$handshakeJson")

        mc.peer?.let {
            emit(P2PEvent.create(P2PPeerConnected(type = P2PEventType.PEERCONNECTED, peer = it)))
        }

        // Read loop
        val input = DataInputStream(mc.socket.getInputStream())
        try {
            while (!mc.socket.isClosed) {
                // Read 4-byte length prefix (big-endian)
                val lengthBytes = ByteArray(4)
                if (input.read(lengthBytes) != 4) break
                val length = ByteBuffer.wrap(lengthBytes).int

                if (length !in 1..1_000_000) break

                // Read payload
                val payloadBytes = ByteArray(length)
                input.readFully(payloadBytes)
                val payload = String(payloadBytes, Charsets.UTF_8)

                when {
                    payload.startsWith("__HS__") -> {
                        try {
                            val jsonStr = payload.substring(6)
                            val json = JSONObject(jsonStr)
                            val peerId = json.getString("id")
                            val peerName = json.getString("name")
                            val peerPort = json.getInt("port")

                            val peer = P2PPeer(peerId, peerName, mc.socket.inetAddress.hostAddress ?: "", peerPort.toDouble())
                            mc.peer = peer
                            connections[peerId] = mc

                            // Get host from socket
                            discoveredPeers[peerId] = discoveredPeers[peerId]?.copy(
                                host = mc.socket.inetAddress.hostAddress ?: ""
                            ) ?: DiscoveredPeer(peerId, peerName, mc.socket.inetAddress.hostAddress ?: "", peerPort, Date())

                            emit(P2PEvent.create(P2PPeerConnected(type = P2PEventType.PEERCONNECTED, peer = peer)))
                        } catch (e: Exception) {
                            // Invalid handshake
                        }
                    }
                    mc.peer != null -> {
                        emit(P2PEvent.create(P2PMessageReceived(
                            type = P2PEventType.MESSAGERECEIVED,
                            message = P2PMessage(fromPeerId = mc.peer!!.id, data = payload)
                        )))
                    }
                }
            }
        } catch (e: IOException) {
            // Connection closed or error
        } finally {
            cleanupConnection(mc)
        }
    }

    private fun closeConnection(mc: ManagedConnection) {
        try {
            mc.socket.close()
        } catch (e: IOException) {
            // Ignore
        }
    }

    private fun cleanupConnection(mc: ManagedConnection) {
        mc.peer?.id?.let { peerId ->
            connections.remove(peerId)
            emit(P2PEvent.create(P2PPeerDisconnected(type = P2PEventType.PEERDISCONNECTED, peerId = peerId)))
        }
        closeConnection(mc)
    }

    // ─── UDP Multicast ─────────────────────────────────────────────────────────────

    private fun startUDPMulticast() {
        try {
            // Acquire multicast lock
            val wifiManager = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
            multicastLock = wifiManager.createMulticastLock("nitro-p2p").apply {
                setReferenceCounted(true)
                acquire()
            }

            // Create multicast socket
            val socket = MulticastSocket(BEACON_PORT)
            multicastSocket = socket
            val group = InetAddress.getByName(BEACON_HOST)
            socket.joinGroup(group)
            socket.soTimeout = 1000

            // Receive beacons
            val buffer = ByteArray(1024)
            val packet = DatagramPacket(buffer, buffer.size)

            while (!socket.isClosed) {
                try {
                    socket.receive(packet)
                    val jsonStr = String(packet.data, 0, packet.length, Charsets.UTF_8)
                    val json = JSONObject(jsonStr)
                    handleBeacon(json, packet.address.hostAddress ?: "")
                } catch (e: SocketTimeoutException) {
                    // Timeout, continue loop
                } catch (e: Exception) {
                    // Error receiving, continue loop
                }
            }
        } catch (e: IOException) {
            emitError("UDP_BIND_FAILED", "Cannot bind UDP multicast: ${e.message}")
        }
    }

    private fun startBeaconing() {
        beaconScheduler = Executors.newSingleThreadScheduledExecutor()
        beaconScheduler?.scheduleWithFixedDelay({
            try {
                val json = JSONObject().apply {
                    put("id", deviceId)
                    put("name", deviceName)
                    put("port", tcpPort)
                }
                val data = json.toString().toByteArray(Charsets.UTF_8)

                val group = InetAddress.getByName(BEACON_HOST)
                val packet = DatagramPacket(data, data.size, group, BEACON_PORT)
                multicastSocket?.send(packet)
            } catch (e: Exception) {
                // Ignore send errors
            }
        }, 0, BEACON_INTERVAL_MS, TimeUnit.MILLISECONDS)
    }

    private fun handleBeacon(json: JSONObject, host: String) {
        try {
            val peerId = json.getString("id")
            val peerName = json.getString("name")
            val peerPort = json.getInt("port")

            if (peerId == deviceId) return

            val isNew = discoveredPeers[peerId] == null
            discoveredPeers[peerId] = DiscoveredPeer(peerId, peerName, host, peerPort, Date())

            if (isNew) {
                emit(P2PEvent.create(P2PPeerDiscovered(type = P2PEventType.PEERDISCOVERED, peer = discoveredPeers[peerId]!!.toP2PPeer())))
            }
        } catch (e: Exception) {
            // Invalid beacon
        }
    }

    // ─── Peer Expiry ─────────────────────────────────────────────────────────────

    private fun startExpiryTimer() {
        expiryScheduler = Executors.newSingleThreadScheduledExecutor()
        expiryScheduler?.scheduleWithFixedDelay({
            val now = Date()
            val expiredIds = discoveredPeers.filter { (_, peer) ->
                now.time - peer.lastSeen.time > BEACON_TTL_MS
            }.keys

            expiredIds.forEach { id ->
                discoveredPeers.remove(id)
                emit(P2PEvent.create(P2PPeerLost(type = P2PEventType.PEERLOST, peerId = id)))
            }
        }, EXPIRY_CHECK_INTERVAL_MS, EXPIRY_CHECK_INTERVAL_MS, TimeUnit.MILLISECONDS)
    }
}
