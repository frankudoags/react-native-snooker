import Foundation
import Network
import NitroModules

// ─────────────────────────────────────────────────────────────────────────────
// HybridP2P.swift
//
// Wire protocol (identical to Kotlin counterpart):
//   Discovery  → UDP multicast  239.255.42.1:45679  JSON beacon every 1.5s
//   Transport  → TCP            [UInt32 BE length][UTF-8 payload]
//   Handshake  → first TCP msg  "__HS__{"id":…,"name":…,"port":…}"
// ─────────────────────────────────────────────────────────────────────────────

private let kBeaconHost      = "239.255.42.1"
private let kBeaconPort: UInt16 = 45679
private let kBeaconInterval: TimeInterval = 1.5
private let kBeaconTTL:      TimeInterval = 6.0

class HybridP2P: HybridP2PSpec {
    // ─── Identity ─────────────────────────────────────────────────────────────
    private var deviceId   = UUID().uuidString
    private var deviceName = UIDevice.current.name
    private var tcpPort: UInt16 = 45678
    
    // ─── Subscriber registry ──────────────────────────────────────────────────
    // Key: subscription ID (returned to caller)
    // Value: the callback closure
    // Protected by `q` — all reads/writes happen on that queue.
    private var subscribers: [Double: (P2PEvent) -> Void] = [:]
    private var nextSubscriberId: Double = 0   // auto-increment, never reused
    
    // ─── Network state ────────────────────────────────────────────────────────
    private var tcpListener:   NWListener?
    private var udpListener:   NWListener?
    private var udpSendConn:   NWConnection?
    private var beaconTimer:   Timer?
    private var expiryTimer:   Timer?
    private var discoveredMap: [String: DiscoveredPeer] = [:]
    private var connections:   [String: ManagedConnection] = [:]
    
    // ─── Dispatch queue ───────────────────────────────────────────────────────
    // Single serial queue: all network I/O, subscriber registry, and state
    // mutations happen here. Callbacks are dispatched to main before firing.
    private let q = DispatchQueue(label: "com.poolgame.p2p", qos: .userInteractive)
    
    
    func setDeviceName(name: String) throws {
        deviceName = name
    }
    
    func start(servicePort: Double?) throws {
        tcpPort = servicePort.map { UInt16($0) } ?? 45678
        q.async { [weak self] in
          self?.startTCPListener()
          self?.startUDPListener()
          self?.startBeaconing()
          self?.startExpiryTimer()
        }
    }
    
    func stop() throws {
        q.async { [weak self] in
          guard let self else { return }
          self.beaconTimer?.invalidate()
          self.expiryTimer?.invalidate()
          self.udpListener?.cancel()
          self.udpSendConn?.cancel()
          self.tcpListener?.cancel()
          self.connections.values.forEach { $0.connection.cancel() }
          self.connections.removeAll()
          self.discoveredMap.removeAll()
          // Subscribers are NOT cleared on stop — they survive a restart.
        }
    }
    
    func connect(peerId: String) throws {
        q.async { [weak self] in
          guard let self, self.connections[peerId] == nil else { return }
          guard let peer = self.discoveredMap[peerId] else {
              self.emit(
                P2PEvent.sixth(.init(type: .error, code: "PEER_NOT_FOUND", message: "PEER_NOT_FOUND")))
            return
          }
          let endpoint = NWEndpoint.hostPort(
            host: NWEndpoint.Host(peer.host),
            port: NWEndpoint.Port(rawValue: UInt16(peer.port))!
          )
          let conn = NWConnection(to: endpoint, using: .tcp)
          self.registerConnection(conn, peerId: peerId, knownPeer: peer.asP2PPeer())
          conn.start(queue: self.q)
        }
    }
    
    func disconnect(peerId: String) throws {
        q.async { [weak self] in
          self?.connections[peerId]?.connection.cancel()
          self?.connections.removeValue(forKey: peerId)
        }
    }
    
    func sendToPeer(peerId: String, data: String) throws {
        q.async { [weak self] in self?.connections[peerId]?.send(data) }
    }
    
    func broadcast(data: String) throws {
        q.async { [weak self] in self?.connections.values.forEach { $0.send(data) } }
    }
    
    func getDiscoveredPeers() throws -> [P2PPeer] {
        discoveredMap.values.map { $0.asP2PPeer() }
    }
    
    func getConnectedPeers() throws -> [P2PPeer] {
        connections.values.compactMap { $0.peer }
    }
    
    func subscribe(callback: @escaping (P2PEvent) -> Void) throws -> Double {
        // Mutations to `subscribers` happen on `q` to keep them thread-safe,
        // but we need to return the ID synchronously to the JS caller.
        // `sync` is safe here because subscribe() is never called FROM `q`.
        return q.sync {
          let id = nextSubscriberId
          nextSubscriberId += 1
          subscribers[id] = callback
          return id
        }
    }
    
    func unsubscribe(id: Double) throws {
        q.async { [weak self] in
          self?.subscribers.removeValue(forKey: id)
        }
    }

    // Every network event calls `emit(_:)`. It iterates the subscriber map
    // and dispatches each callback onto the main thread so callers never have
    // to think about threading.

    private func emit(_ event: P2PEvent) {
      // Snapshot the subscriber values so we can release the queue lock quickly.
      let callbacks = subscribers.values
      DispatchQueue.main.async {
        callbacks.forEach { $0(event) }
      }
    }
    
    
    private func startTCPListener() {
      guard let listener = try? NWListener(using: .tcp, on: NWEndpoint.Port(rawValue: tcpPort)!) else {
          self.emit(.sixth(.init(type: .error, code: "TCP_BIND_FAILED", message: "Cannot bind port \(tcpPort)")))
        return
      }
      tcpListener = listener
      listener.newConnectionHandler = { [weak self] conn in
        // Inbound connection: peerId unknown until handshake arrives
        self?.registerConnection(conn, peerId: nil, knownPeer: nil)
        conn.start(queue: self!.q)
      }
      listener.start(queue: q)
    }

    // MARK: - UDP multicast listener

    private func startUDPListener() {
      let params = NWParameters.udp
      params.allowLocalEndpointReuse = true
      guard let listener = try? NWListener(using: params, on: NWEndpoint.Port(rawValue: kBeaconPort)!) else {
        
          self.emit(.sixth(.init(type: .error, code: "UDP_BIND_FAILED", message: "Cannot bind UDP \(kBeaconPort)")))
        return
      }
      udpListener = listener
      listener.newConnectionHandler = { [weak self] conn in
        conn.start(queue: self!.q)
        self?.receiveUDP(on: conn)
      }
      listener.start(queue: q)
    }

    private func receiveUDP(on conn: NWConnection) {
      conn.receiveMessage { [weak self] data, _, _, error in
        if let data, let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
          self?.handleBeacon(json)
        }
        if error == nil { self?.receiveUDP(on: conn) }
      }
    }

    // MARK: - Beaconing

    private func startBeaconing() {
      let endpoint = NWEndpoint.hostPort(
        host: NWEndpoint.Host(kBeaconHost),
        port: NWEndpoint.Port(rawValue: kBeaconPort)!
      )
      udpSendConn = NWConnection(to: endpoint, using: .udp)
      udpSendConn?.start(queue: q)
      sendBeacon()
      beaconTimer = Timer.scheduledTimer(withTimeInterval: kBeaconInterval, repeats: true) { [weak self] _ in
        self?.q.async { self?.sendBeacon() }
      }
      RunLoop.main.add(beaconTimer!, forMode: .common)
    }

    private func sendBeacon() {
      let payload: [String: Any] = ["id": deviceId, "name": deviceName, "port": tcpPort]
      guard let data = try? JSONSerialization.data(withJSONObject: payload) else { return }
      udpSendConn?.send(content: data, completion: .idempotent)
    }

    private func handleBeacon(_ json: [String: Any]) {
      guard
        let peerId   = json["id"]   as? String,
        let peerName = json["name"] as? String,
        let peerPort = json["port"] as? Int,
        peerId != deviceId
      else { return }

      let isNew = discoveredMap[peerId] == nil
      discoveredMap[peerId] = DiscoveredPeer(id: peerId, name: peerName, host: "", port: peerPort, lastSeen: Date())
        if isNew {
            emit(.first(.init(type: .peerdiscovered, peer: discoveredMap[peerId]!.asP2PPeer())))
        }
    }

    // MARK: - Peer expiry

    private func startExpiryTimer() {
      expiryTimer = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { [weak self] _ in
        self?.q.async {
          let now     = Date()
          let expired = self?.discoveredMap.filter { now.timeIntervalSince($0.value.lastSeen) > kBeaconTTL } ?? [:]
          expired.keys.forEach { id in
            self?.discoveredMap.removeValue(forKey: id)
              self?.emit(.second(.init(type: .peerlost, peerId: id)))
          }
        }
      }
      RunLoop.main.add(expiryTimer!, forMode: .common)
    }

    // MARK: - TCP connection lifecycle

    private func registerConnection(_ conn: NWConnection, peerId: String?, knownPeer: P2PPeer?) {
      let mc = ManagedConnection(connection: conn, peer: knownPeer)
      if let pid = peerId { connections[pid] = mc }

      conn.stateUpdateHandler = { [weak self, weak mc] state in
        guard let self, let mc else { return }
        switch state {
        case .ready:
          // Send our handshake immediately so the remote learns our identity
          let hs: [String: Any] = ["id": self.deviceId, "name": self.deviceName, "port": Int(self.tcpPort)]
          if let data = try? JSONSerialization.data(withJSONObject: hs),
             let str  = String(data: data, encoding: .utf8) {
            mc.send("__HS__" + str)
          }
            if let peer = mc.peer { emit(P2PEvent.third(.init(type: .peerconnected, peer: peer))) }
          self.receiveFramed(mc)
        case .failed(let err):
            self.emit(.sixth(.init(type: .error, code: "CONNECTION_FAILED", message: err.localizedDescription)))
          self.cleanupConnection(mc)
        case .cancelled:
          self.cleanupConnection(mc)
        default: break
        }
      }
    }

    private func receiveFramed(_ mc: ManagedConnection) {
      mc.connection.receive(minimumIncompleteLength: 4, maximumLength: 4) { [weak self, weak mc] data, _, _, error in
        guard let self, let mc, error == nil, let data, data.count == 4 else { return }
        let length = Int(data.withUnsafeBytes { $0.load(as: UInt32.self).bigEndian })
        guard length > 0, length < 1_000_000 else { return }

        mc.connection.receive(minimumIncompleteLength: length, maximumLength: length) { [weak self, weak mc] payload, _, _, error in
          guard let self, let mc, error == nil,
                let payload, let str = String(data: payload, encoding: .utf8) else { return }

          if str.hasPrefix("__HS__"),
             let json    = try? JSONSerialization.jsonObject(with: Data(str.dropFirst(6).utf8)) as? [String: Any],
             let peerId  = json["id"]   as? String,
             let peerName = json["name"] as? String,
             let peerPort = json["port"] as? Int {
            let peer     = P2PPeer(id: peerId, name: peerName, host: "", port: Double(peerPort))
            mc.peer      = peer
            self.connections[peerId] = mc
              
              emit(P2PEvent.third(.init(type: .peerconnected, peer: peer)))
          } else if let peerId = mc.peer?.id {
              emit(.fifth(.init(type: .messagereceived, message: .init(fromPeerId: peerId, data: str))))
          }
          self.receiveFramed(mc)
        }
      }
    }

    private func cleanupConnection(_ mc: ManagedConnection) {
      if let pid = mc.peer?.id {
        connections.removeValue(forKey: pid)
          emit(P2PEvent.second(.init(type: .peerlost, peerId: pid)))
      }
    }
    
}

private class ManagedConnection {
  let connection: NWConnection
  var peer: P2PPeer?
  init(connection: NWConnection, peer: P2PPeer?) { self.connection = connection; self.peer = peer }

  func send(_ string: String) {
    guard let data = string.data(using: .utf8) else { return }
    var length = UInt32(data.count).bigEndian
    let prefix = Data(bytes: &length, count: 4)
    connection.send(content: prefix + data, completion: .idempotent)
  }
}

private struct DiscoveredPeer {
  let id: String; let name: String; var host: String; let port: Int; var lastSeen: Date
  func asP2PPeer() -> P2PPeer { P2PPeer(id: id, name: name, host: host, port: Double(port)) }
}
