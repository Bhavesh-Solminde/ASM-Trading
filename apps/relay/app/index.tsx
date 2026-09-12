import { useCallback, useEffect, useRef, useState } from "react";
import {
  PermissionsAndroid,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Link, useFocusEffect } from "expo-router";
import {
  addSmsListener,
  startListening,
  stopListening,
} from "../modules/sms-reader";
import { isConfigComplete, loadConfig } from "@/config";
import { enqueue, queueStats } from "@/queue";
import { startForwarder } from "@/forwarder";
import { isAllowedSender } from "@/senders";
import type { RelayConfig } from "@/types";

const EMPTY_CONFIG: RelayConfig = { serverUrl: "", secret: "", senders: [] };

export default function Home() {
  const [config, setConfig] = useState<RelayConfig>(EMPTY_CONFIG);
  const [listening, setListening] = useState(false);
  const [granted, setGranted] = useState(false);
  const [stats, setStats] = useState({ pending: 0, sent: 0 });
  const [lastSeen, setLastSeen] = useState<string | null>(null);

  const configRef = useRef<RelayConfig>(EMPTY_CONFIG);
  configRef.current = config;

  const subscriptionRef = useRef<{ remove(): void } | null>(null);
  const forwarderRef = useRef<{ stop(): void } | null>(null);

  useFocusEffect(
    useCallback(() => {
      void loadConfig().then(setConfig);
    }, []),
  );

  useEffect(() => {
    forwarderRef.current = startForwarder(() => configRef.current);
    const interval = setInterval(() => {
      void queueStats().then(setStats);
    }, 3_000);

    return () => {
      forwarderRef.current?.stop();
      clearInterval(interval);
    };
  }, []);

  async function requestPermission(): Promise<boolean> {
    if (Platform.OS !== "android") return false;
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
      {
        title: "Read incoming SMS",
        message:
          "ASM Relay forwards bank alerts from this phone to your own demo server.",
        buttonPositive: "Allow",
        buttonNegative: "Not now",
      },
    );
    const ok = result === PermissionsAndroid.RESULTS.GRANTED;
    setGranted(ok);
    return ok;
  }

  async function toggle() {
    if (listening) {
      subscriptionRef.current?.remove();
      subscriptionRef.current = null;
      await stopListening();
      setListening(false);
      return;
    }

    if (!(await requestPermission())) return;

    subscriptionRef.current = addSmsListener((event) => {
      if (!isAllowedSender(event.sender, configRef.current.senders)) return;

      setLastSeen(`${event.sender} · ${event.body.slice(0, 48)}…`);
      void enqueue(event.sender, event.body, event.receivedAt);
    });

    await startListening();
    setListening(true);
  }

  const ready = isConfigComplete(config);

  return (
    <View style={styles.screen}>
      <View style={styles.card}>
        <Text style={styles.cardLabel}>Status</Text>
        <Text
          style={[
            styles.status,
            { color: listening ? "#2fbd85" : "#93a2b4" },
          ]}
        >
          {listening ? "Listening" : "Stopped"}
        </Text>
        <Text style={styles.meta}>
          {config.senders.length === 0
            ? "No senders configured — nothing will be forwarded."
            : `Forwarding from ${config.senders.join(", ")}`}
        </Text>
      </View>

      <View style={styles.row}>
        <View style={styles.stat}>
          <Text style={styles.cardLabel}>Queued</Text>
          <Text style={styles.statValue}>{stats.pending}</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.cardLabel}>Sent</Text>
          <Text style={styles.statValue}>{stats.sent}</Text>
        </View>
      </View>

      {lastSeen ? (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Last matched message</Text>
          <Text style={styles.meta}>{lastSeen}</Text>
        </View>
      ) : null}

      <Pressable
        onPress={() => void toggle()}
        disabled={!ready && !listening}
        style={[
          styles.button,
          {
            backgroundColor: listening ? "#e0526a" : "#2fbd85",
            opacity: !ready && !listening ? 0.4 : 1,
          },
        ]}
      >
        <Text
          style={[
            styles.buttonText,
            { color: listening ? "#ffffff" : "#06231a" },
          ]}
        >
          {listening ? "Stop" : "Start listening"}
        </Text>
      </Pressable>

      {!ready ? (
        <Text style={styles.warning}>
          Set the server URL, relay secret and sender list before starting.
        </Text>
      ) : null}

      {!granted && listening ? (
        <Text style={styles.warning}>SMS permission was not granted.</Text>
      ) : null}

      <Link href="/settings" style={styles.link}>
        Settings
      </Link>

      <Text style={styles.footer}>
        Reads only this device&apos;s messages, only from the senders above, and
        sends them only to your own server. Demonstration use.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 24, gap: 14, justifyContent: "center" },
  card: {
    backgroundColor: "#16202c",
    borderColor: "#253243",
    borderWidth: 1,
    borderRadius: 10,
    padding: 16,
    gap: 4,
  },
  cardLabel: {
    color: "#93a2b4",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  status: { fontSize: 22, fontWeight: "700" },
  meta: { color: "#93a2b4", fontSize: 12, lineHeight: 17 },
  row: { flexDirection: "row", gap: 12 },
  stat: {
    flex: 1,
    backgroundColor: "#16202c",
    borderColor: "#253243",
    borderWidth: 1,
    borderRadius: 10,
    padding: 16,
    gap: 4,
  },
  statValue: {
    color: "#e8edf3",
    fontSize: 22,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  button: { borderRadius: 10, paddingVertical: 15, alignItems: "center" },
  buttonText: { fontSize: 15, fontWeight: "700" },
  warning: { color: "#e0ac50", fontSize: 12, textAlign: "center" },
  link: {
    color: "#3d8bfd",
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
    marginTop: 4,
  },
  footer: {
    color: "#6b7a8d",
    fontSize: 11,
    lineHeight: 16,
    textAlign: "center",
    marginTop: 8,
  },
});
