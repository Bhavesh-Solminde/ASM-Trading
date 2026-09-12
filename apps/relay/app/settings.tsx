import { useEffect, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { loadConfig, saveConfig } from "@/config";
import { parseSenderList } from "@/senders";

export default function Settings() {
  const router = useRouter();
  const [serverUrl, setServerUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [sendersRaw, setSendersRaw] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void loadConfig().then((config) => {
      setServerUrl(config.serverUrl);
      setSecret(config.secret);
      setSendersRaw(config.senders.join(", "));
    });
  }, []);

  async function onSave() {
    await saveConfig({
      serverUrl,
      secret,
      senders: parseSenderList(sendersRaw),
    });
    setSaved(true);
    setTimeout(() => router.back(), 600);
  }

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <View style={styles.field}>
        <Text style={styles.label}>Server URL</Text>
        <TextInput
          value={serverUrl}
          onChangeText={setServerUrl}
          placeholder="http://192.168.1.20:3000"
          placeholderTextColor="#5b6a7d"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          style={styles.input}
        />
        <Text style={styles.hint}>
          Your machine&apos;s LAN address, not localhost — the phone is a
          different device.
        </Text>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Relay secret</Text>
        <TextInput
          value={secret}
          onChangeText={setSecret}
          placeholder="SMS_RELAY_SECRET from .env"
          placeholderTextColor="#5b6a7d"
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          style={styles.input}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Bank senders</Text>
        <TextInput
          value={sendersRaw}
          onChangeText={setSendersRaw}
          placeholder="ICICIB, HDFCBK, AXISBK"
          placeholderTextColor="#5b6a7d"
          autoCapitalize="characters"
          autoCorrect={false}
          style={styles.input}
        />
        <Text style={styles.hint}>
          Only messages from these senders leave the phone. Empty means nothing
          is forwarded.
        </Text>
      </View>

      <Pressable onPress={() => void onSave()} style={styles.button}>
        <Text style={styles.buttonText}>{saved ? "Saved" : "Save"}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 24, gap: 20 },
  field: { gap: 6 },
  label: {
    color: "#93a2b4",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  input: {
    backgroundColor: "#1c2836",
    borderColor: "#253243",
    borderWidth: 1,
    borderRadius: 8,
    color: "#e8edf3",
    fontSize: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  hint: { color: "#6b7a8d", fontSize: 12, lineHeight: 17 },
  button: {
    backgroundColor: "#3d8bfd",
    borderRadius: 8,
    paddingVertical: 13,
    alignItems: "center",
  },
  buttonText: { color: "#ffffff", fontSize: 14, fontWeight: "700" },
});
