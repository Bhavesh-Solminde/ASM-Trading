package expo.modules.smsreader

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONArray

/**
 * JS-facing side of the relay: writes config the static SmsReceiver reads,
 * toggles the enabled flag it checks, and reads back the activity
 * log/counters it writes — all via RelayStore (SharedPreferences), since
 * there is no direct JS<->receiver channel when the app isn't running.
 */
class SmsReaderModule : Module() {

  override fun definition() = ModuleDefinition {
    Name("SmsReader")

    AsyncFunction("configure") { serverUrl: String, secret: String, senders: List<String>, deviceLabel: String ->
      val context = appContext.reactContext
        ?: throw IllegalStateException("No Android context available")
      RelayStore.setConfig(context, RelayStore.Config(serverUrl, secret, senders, deviceLabel))
    }

    AsyncFunction("setEnabled") { enabled: Boolean ->
      val context = appContext.reactContext
        ?: throw IllegalStateException("No Android context available")
      RelayStore.setEnabled(context, enabled)
    }

    AsyncFunction("isEnabled") {
      val context = appContext.reactContext
        ?: throw IllegalStateException("No Android context available")
      RelayStore.isEnabled(context)
    }

    AsyncFunction("getStats") {
      val context = appContext.reactContext
        ?: throw IllegalStateException("No Android context available")
      val (sent, failed) = RelayStore.getStats(context)
      mapOf("sent" to sent, "failed" to failed)
    }

    AsyncFunction("getActivityLog") {
      val context = appContext.reactContext
        ?: throw IllegalStateException("No Android context available")
      val array = JSONArray(RelayStore.getLogJson(context))
      (0 until array.length()).map { i ->
        val entry = array.getJSONObject(i)
        mapOf(
          "at" to entry.getLong("at"),
          "sender" to entry.getString("sender"),
          "bodyPreview" to entry.getString("bodyPreview"),
          "ok" to entry.getBoolean("ok"),
          "detail" to entry.getString("detail"),
        )
      }
    }

    AsyncFunction("recordActivity") { sender: String, ok: Boolean, detail: String ->
      val context = appContext.reactContext
        ?: throw IllegalStateException("No Android context available")
      RelayStore.recordAttempt(context, sender, "", ok, detail)
    }

    AsyncFunction("startForegroundService") {
      val context = appContext.reactContext
        ?: throw IllegalStateException("No Android context available")
      val intent = Intent(context, RelayForegroundService::class.java)
      // Both branches return ComponentName?, a type expo-modules-kotlin's
      // bridge can't serialize back to JS — discard it explicitly so the
      // block's return type is Unit, not ComponentName?.
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
      Unit
    }

    AsyncFunction("stopForegroundService") {
      val context = appContext.reactContext
        ?: throw IllegalStateException("No Android context available")
      context.stopService(Intent(context, RelayForegroundService::class.java))
      Unit
    }

    // One system dialog ("Allow this app to ignore battery optimizations?"),
    // the standard Android mechanism — not OEM-specific battery managers
    // like Samsung's own sleeping-apps list, which no public API can
    // request exemption from.
    AsyncFunction("requestIgnoreBatteryOptimizations") {
      val context = appContext.reactContext
        ?: throw IllegalStateException("No Android context available")
      val powerManager = context.getSystemService(Context.POWER_SERVICE) as PowerManager

      if (!powerManager.isIgnoringBatteryOptimizations(context.packageName)) {
        val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
          data = Uri.parse("package:${context.packageName}")
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
      }
      Unit
    }
  }
}
