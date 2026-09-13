import { useEffect, useState } from "react";
import {
  PermissionsAndroid,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  configure,
  getActivityLog,
  getStats,
  isEnabled,
  recordActivity,
  requestIgnoreBatteryOptimizations,
  setEnabled,
  startForegroundService,
  stopForegroundService,
  type ActivityEntry,
} from "../modules/sms-reader";
import { RELAY_CONFIG } from "@/relayConfig";

export default function Home() {
  const [listening, setListening] = useState(false);
  const [granted, setGranted] = useState(true);
  const [stats, setStats] = useState({ sent: 0, failed: 0 });
  const [activity, setActivity] = useState<ActivityEntry[]>([]);

  useEffect(() => {
    // The enabled flag lives natively and survives an app restart (or kill),
    // so reflect its real state on mount rather than assuming "stopped".
    void isEnabled().then(setListening);

    const interval = setInterval(() => {
      void getStats().then(setStats);
      void getActivityLog().then(setActivity);
    }, 2_000);

    return () => clearInterval(interval);
  }, []);

  async function requestPermission(): Promise<boolean> {
    if (Platform.OS !== "android") return false;

    // READ_SMS alongside RECEIVE_SMS: RECEIVE_SMS only covers the live
    // broadcast — catching up on messages that arrived while offline means
    // querying the inbox, which needs READ_SMS.
    const results = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
      PermissionsAndroid.PERMISSIONS.READ_SMS,
    ]);
    const ok =
      results[PermissionsAndroid.PERMISSIONS.RECEIVE_SMS] ===
        PermissionsAndroid.RESULTS.GRANTED &&
      results[PermissionsAndroid.PERMISSIONS.READ_SMS] ===
        PermissionsAndroid.RESULTS.GRANTED;
    setGranted(ok);

    // Best-effort: without this the "listening" notification just won't show,
    // but the foreground service (and background execution) still works.
    if (PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS) {
      await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
      ).catch(() => {});
    }

    return ok;
  }

  async function toggle() {
    try {
      if (listening) {
        await setEnabled(false);
        await stopForegroundService();
        setListening(false);
        return;
      }

      if (!(await requestPermission())) return;

      await requestIgnoreBatteryOptimizations().catch(() => {});

      await configure(
        RELAY_CONFIG.serverUrl,
        RELAY_CONFIG.secret,
        RELAY_CONFIG.senders,
        RELAY_CONFIG.deviceLabel,
      );
      await setEnabled(true);
      await startForegroundService();
      setListening(true);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await recordActivity("system", false, `Start/stop failed: ${detail}`).catch(
        () => {},
      );
      void getActivityLog().then(setActivity);
    }
  }

  const lastMatch = activity.find((entry) => entry.sender !== "system");

  return (
    <ScrollView contentContainerStyle={styles.screen}>
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
          {`Forwarding from ${RELAY_CONFIG.senders.join(", ")}`}
        </Text>
      </View>

      <View style={styles.row}>
        <View style={styles.stat}>
          <Text style={styles.cardLabel}>Sent</Text>
          <Text style={styles.statValue}>{stats.sent}</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.cardLabel}>Failed</Text>
          <Text style={styles.statValue}>{stats.failed}</Text>
        </View>
      </View>

      {lastMatch ? (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Last matched message</Text>
          <Text style={styles.meta}>
            {lastMatch.sender} · {lastMatch.bodyPreview}…
          </Text>
        </View>
      ) : null}

      <Pressable
        onPress={() => void toggle()}
        style={[
          styles.button,
          { backgroundColor: listening ? "#e0526a" : "#2fbd85" },
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

      {!granted && listening ? (
        <Text style={styles.warning}>SMS permission was not granted.</Text>
      ) : null}

      <Text style={styles.footer}>
        Reads only this device&apos;s messages, only from the senders above, and
        sends them only to your own server. Demonstration use. Forwards
        directly from a background-safe native receiver, so it keeps working
        even if the app is backgrounded or killed — only a force-stop or
        toggling Stop turns it off.
      </Text>

      {activity.length > 0 ? (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Send log</Text>
          {activity.map((entry) => (
            <View key={entry.at} style={styles.logRow}>
              <Text
                style={[
                  styles.logStatus,
                  { color: entry.ok ? "#2fbd85" : "#e0526a" },
                ]}
              >
                {entry.ok ? "✓" : "✗"}
              </Text>
              <View style={styles.logBody}>
                <Text style={styles.logSender}>
                  {entry.sender} · {new Date(entry.at).toLocaleTimeString()}
                </Text>
                <Text style={styles.logDetail}>{entry.detail}</Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, padding: 24, gap: 14, justifyContent: "center" },
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
  footer: {
    color: "#6b7a8d",
    fontSize: 11,
    lineHeight: 16,
    textAlign: "center",
    marginTop: 8,
  },
  logRow: { flexDirection: "row", gap: 8, paddingTop: 6 },
  logStatus: { fontSize: 13, fontWeight: "700", width: 14 },
  logBody: { flex: 1, gap: 1 },
  logSender: { color: "#93a2b4", fontSize: 11, fontWeight: "600" },
  logDetail: { color: "#6b7a8d", fontSize: 11, lineHeight: 15 },
});
