package expo.modules.smsreader

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Telephony
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import org.json.JSONObject

/**
 * Manifest-declared (static) receiver — unlike a dynamically registered one,
 * this fires even if the app process was killed, waking it briefly to
 * handle the broadcast. SMS_RECEIVED is one of the implicit broadcasts
 * Android still exempts from the API 26+ manifest-receiver restrictions.
 *
 * The whole forward — filter, HTTP POST, log the result — happens here in
 * Kotlin on a background thread, deliberately not routed through JS. JS
 * timers are suspended while the app is backgrounded, which is exactly the
 * failure mode this replaces (forwarding only happened when the app was
 * reopened).
 */
class SmsReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
    if (!RelayStore.isEnabled(context)) return

    val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return
    if (messages.isEmpty()) return

    val sender = messages[0].displayOriginatingAddress ?: "unknown"
    val body = messages.joinToString("") { it.displayMessageBody ?: "" }
    if (body.isBlank()) return

    val config = RelayStore.getConfig(context) ?: return
    if (!RelayStore.isAllowedSender(sender, config.senders)) return

    val bodyPreview = body.take(60)
    val receivedAt = System.currentTimeMillis()

    // Extends our execution window past the receiver's normal ~10s limit —
    // required since the POST happens on a background thread.
    val pendingResult = goAsync()
    Thread {
      try {
        val (ok, detail) = post(config, sender, body, receivedAt)
        RelayStore.recordAttempt(context, sender, bodyPreview, ok, detail)
      } finally {
        pendingResult.finish()
      }
    }.start()
  }

  private fun post(
    config: RelayStore.Config,
    sender: String,
    body: String,
    receivedAt: Long,
  ): Pair<Boolean, String> {
    return try {
      val url = URL("${config.serverUrl}/api/bank-feed/sms")
      val connection = url.openConnection() as HttpURLConnection
      connection.requestMethod = "POST"
      connection.setRequestProperty("Content-Type", "application/json")
      connection.setRequestProperty("Authorization", "Bearer ${config.secret}")
      connection.doOutput = true
      connection.connectTimeout = 15_000
      connection.readTimeout = 15_000

      val payload = JSONObject().apply {
        put("sender", sender)
        put("body", body)
        put("receivedAt", isoTimestamp(receivedAt))
        put("deviceLabel", config.deviceLabel)
        put("deviceModel", Build.MODEL ?: "unknown-device")
      }

      connection.outputStream.use { it.write(payload.toString().toByteArray(Charsets.UTF_8)) }

      val status = connection.responseCode
      if (status == 202 || status == 400) {
        true to "HTTP $status"
      } else {
        val errorText = runCatching {
          connection.errorStream?.bufferedReader()?.readText()
        }.getOrNull() ?: ""
        false to "HTTP $status" + if (errorText.isNotEmpty()) ": ${errorText.take(120)}" else ""
      }
    } catch (error: Exception) {
      false to (error.message ?: error.toString())
    }
  }

  private fun isoTimestamp(millis: Long): String {
    val formatter = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
    formatter.timeZone = TimeZone.getTimeZone("UTC")
    return formatter.format(Date(millis))
  }
}
