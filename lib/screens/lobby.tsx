import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { P2PPeer } from '../../modules/nitro-p2p/src/index';

// ─── Props ───────────────────────────────────────────────────────────────────

interface LobbyProps {
  playerName: string;
  peers: P2PPeer[];
  connectedPeers: P2PPeer[];
  onConnect: (peerId: string) => void;
  onStartDiscovery: () => void;
  onStopDiscovery: () => void;
  isDiscovering: boolean;
  onHostGame: () => void;
  onPlayBot: () => void;
}

// ─── Lobby Screen ─────────────────────────────────────────────────────────────

export function Lobby({
  playerName,
  peers,
  connectedPeers,
  onConnect,
  onStartDiscovery,
  onStopDiscovery,
  isDiscovering,
  onHostGame,
  onPlayBot,
}: LobbyProps) {
  const isPeerConnected = (peerId: string) => {
    return connectedPeers.some((peer) => peer.id === peerId);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>8-Ball Pool</Text>
        <Text style={styles.subtitle}>LAN Multiplayer</Text>
      </View>

      <View style={styles.playerSection}>
        <Text style={styles.sectionTitle}>Your Name</Text>
        <Text style={styles.playerName}>{playerName}</Text>
      </View>

      <View style={styles.discoverySection}>
        <View style={styles.discoveryHeader}>
          <Text style={styles.sectionTitle}>Discovery</Text>
          <TouchableOpacity
            style={[styles.discoveryButton, isDiscovering && styles.discoveryButtonActive]}
            onPress={isDiscovering ? onStopDiscovery : onStartDiscovery}
          >
            <Text style={styles.discoveryButtonText}>{isDiscovering ? 'Stop' : 'Start'}</Text>
          </TouchableOpacity>
        </View>

        {isDiscovering && (
          <View style={styles.discoveringIndicator}>
            <ActivityIndicator size="small" color="#4CAF50" />
            <Text style={styles.discoveringText}>Looking for players...</Text>
          </View>
        )}

        <ScrollView style={styles.peerList}>
          {peers.length === 0 ? (
            <Text style={styles.noPeersText}>
              {isDiscovering ? 'Searching for players...' : 'Start discovery to find players'}
            </Text>
          ) : (
            peers.map((peer) => {
              const connected = isPeerConnected(peer.id);
              return (
                <View key={peer.id} style={styles.peerItem}>
                  <View style={styles.peerInfo}>
                    <View style={[styles.peerDot, connected && styles.peerDotConnected]} />
                    <View style={styles.peerDetails}>
                      <Text style={styles.peerName}>{peer.name}</Text>
                      <Text style={styles.peerId}>{peer.id.slice(0, 8)}...</Text>
                    </View>
                  </View>
                  <TouchableOpacity
                    style={[styles.connectButton, connected && styles.connectButtonConnected]}
                    onPress={() => onConnect(peer.id)}
                    disabled={connected}
                  >
                    <Text style={styles.connectButtonText}>
                      {connected ? 'Connected' : 'Connect'}
                    </Text>
                  </TouchableOpacity>
                </View>
              );
            })
          )}
        </ScrollView>
      </View>

      <View style={styles.footer}>
        <TouchableOpacity style={styles.botGameButton} onPress={onPlayBot}>
          <Text style={styles.botGameButtonText}>Play vs Bot</Text>
        </TouchableOpacity>

        {connectedPeers.length > 0 && (
          <TouchableOpacity style={styles.startGameButton} onPress={onHostGame}>
            <Text style={styles.startGameButtonText}>Start LAN Game</Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  header: {
    padding: 20,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#2d2d44',
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 16,
    color: '#8888aa',
  },
  playerSection: {
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#2d2d44',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 12,
  },
  playerName: {
    fontSize: 24,
    color: '#4CAF50',
    fontWeight: 'bold',
  },
  discoverySection: {
    flex: 1,
    padding: 20,
  },
  discoveryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  discoveryButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#2d2d44',
  },
  discoveryButtonActive: {
    backgroundColor: '#f44336',
  },
  discoveryButtonText: {
    color: '#ffffff',
    fontWeight: '600',
  },
  discoveringIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  discoveringText: {
    marginLeft: 8,
    color: '#8888aa',
  },
  peerList: {
    flex: 1,
  },
  noPeersText: {
    textAlign: 'center',
    color: '#8888aa',
    fontSize: 16,
    marginTop: 20,
  },
  peerItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#2d2d44',
    borderRadius: 8,
    marginBottom: 8,
  },
  peerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  peerDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#8888aa',
    marginRight: 12,
  },
  peerDotConnected: {
    backgroundColor: '#4CAF50',
  },
  peerDetails: {
    flex: 1,
  },
  peerName: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 2,
  },
  peerId: {
    color: '#8888aa',
    fontSize: 12,
  },
  connectButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#4CAF50',
  },
  connectButtonConnected: {
    backgroundColor: '#2d2d44',
    opacity: 0.6,
  },
  connectButtonText: {
    color: '#ffffff',
    fontWeight: '600',
  },
  footer: {
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: '#2d2d44',
    gap: 12,
  },
  botGameButton: {
    width: '100%',
    paddingVertical: 16,
    borderRadius: 12,
    backgroundColor: '#2f6ee5',
    alignItems: 'center',
  },
  botGameButtonText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  startGameButton: {
    width: '100%',
    paddingVertical: 16,
    borderRadius: 12,
    backgroundColor: '#4CAF50',
    alignItems: 'center',
  },
  startGameButtonText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 'bold',
  },
});
