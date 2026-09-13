package expo.modules.smsreader

import android.os.Build
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import org.json.JSONObject

/** Shared by the live receiver and the backlog catch-up scan. */
object SmsForwarder {
  private const val MAX_ATTEMPTS = 3
  private val RETRY_DELAYS_MS = longArrayOf(1_500, 3_000)

  /** POSTs with a couple of quick retries — smooths over a momentary network
   * blip without holding a goAsync-extended receiver open too long. */
  fun postWithRetry(
    config: RelayStore.Config,
    sender: String,
    body: String,
    receivedAt: Long,
  ): Pair<Boolean, String> {
    var result = post(config, sender, body, receivedAt)
    var attempt = 1
    while (!result.first && attempt < MAX_ATTEMPTS) {
      Thread.sleep(RETRY_DELAYS_MS[attempt - 1])
      result = post(config, sender, body, receivedAt)
      attempt++
    }
    return result
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
      connection.connectTimeout = 10_000
      connection.readTimeout = 10_000

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
