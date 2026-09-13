package expo.modules.smsreader

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * Config + activity log, persisted to SharedPreferences so the static
 * SmsReceiver can read/write them without any JS runtime alive. This is the
 * single source of truth shared by the receiver (writer of log entries) and
 * the JS-facing module (writer of config, reader of everything for the UI).
 */
object RelayStore {
  private const val PREFS = "relay_store"
  private const val KEY_ENABLED = "enabled"
  private const val KEY_SERVER_URL = "serverUrl"
  private const val KEY_SECRET = "secret"
  private const val KEY_SENDERS = "senders"
  private const val KEY_DEVICE_LABEL = "deviceLabel"
  private const val KEY_SENT_COUNT = "sentCount"
  private const val KEY_FAILED_COUNT = "failedCount"
  private const val KEY_LOG = "activityLog"
  private const val MAX_LOG_ENTRIES = 20

  data class Config(
    val serverUrl: String,
    val secret: String,
    val senders: List<String>,
    val deviceLabel: String,
  )

  data class ActivityEntry(
    val at: Long,
    val sender: String,
    val bodyPreview: String,
    val ok: Boolean,
    val detail: String,
  )

  private fun prefs(context: Context) =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun setConfig(context: Context, config: Config) {
    prefs(context).edit()
      .putString(KEY_SERVER_URL, config.serverUrl)
      .putString(KEY_SECRET, config.secret)
      .putString(KEY_SENDERS, config.senders.joinToString(","))
      .putString(KEY_DEVICE_LABEL, config.deviceLabel)
      .apply()
  }

  fun getConfig(context: Context): Config? {
    val p = prefs(context)
    val serverUrl = p.getString(KEY_SERVER_URL, null) ?: return null
    val secret = p.getString(KEY_SECRET, null) ?: return null
    val senders = (p.getString(KEY_SENDERS, "") ?: "")
      .split(",")
      .map { it.trim().uppercase() }
      .filter { it.isNotEmpty() }
    val deviceLabel = p.getString(KEY_DEVICE_LABEL, "") ?: ""
    return Config(serverUrl, secret, senders, deviceLabel)
  }

  fun setEnabled(context: Context, enabled: Boolean) {
    prefs(context).edit().putBoolean(KEY_ENABLED, enabled).apply()
  }

  fun isEnabled(context: Context): Boolean = prefs(context).getBoolean(KEY_ENABLED, false)

  fun isAllowedSender(sender: String, senders: List<String>): Boolean {
    if (senders.isEmpty()) return false
    val upper = sender.trim().uppercase()
    if (upper.isEmpty()) return false
    return senders.any { upper.contains(it) }
  }

  fun recordAttempt(context: Context, sender: String, bodyPreview: String, ok: Boolean, detail: String) {
    val p = prefs(context)
    val editor = p.edit()

    if (ok) {
      editor.putInt(KEY_SENT_COUNT, p.getInt(KEY_SENT_COUNT, 0) + 1)
    } else {
      editor.putInt(KEY_FAILED_COUNT, p.getInt(KEY_FAILED_COUNT, 0) + 1)
    }

    val existing = JSONArray(p.getString(KEY_LOG, "[]") ?: "[]")
    val entry = JSONObject().apply {
      put("at", System.currentTimeMillis())
      put("sender", sender)
      put("bodyPreview", bodyPreview)
      put("ok", ok)
      put("detail", detail)
    }
    val updated = JSONArray()
    updated.put(entry)
    for (i in 0 until minOf(existing.length(), MAX_LOG_ENTRIES - 1)) {
      updated.put(existing.get(i))
    }

    editor.putString(KEY_LOG, updated.toString())
    editor.apply()
  }

  fun getStats(context: Context): Pair<Int, Int> {
    val p = prefs(context)
    return Pair(p.getInt(KEY_SENT_COUNT, 0), p.getInt(KEY_FAILED_COUNT, 0))
  }

  fun getLogJson(context: Context): String = prefs(context).getString(KEY_LOG, "[]") ?: "[]"
}
