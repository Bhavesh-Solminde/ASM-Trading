package expo.modules.smsreader

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import android.util.Log

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
    Log.d(TAG, "onReceive action=${intent.action}")
    if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return

    if (!RelayStore.isEnabled(context)) {
      Log.d(TAG, "ignored: not enabled")
      return
    }

    val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return
    if (messages.isEmpty()) return

    val sender = messages[0].displayOriginatingAddress ?: "unknown"
    val body = messages.joinToString("") { it.displayMessageBody ?: "" }
    Log.d(TAG, "sms from $sender: ${body.take(60)}")
    if (body.isBlank()) return

    val config = RelayStore.getConfig(context)
    if (config == null) {
      Log.d(TAG, "ignored: no config saved")
      return
    }
    if (!RelayStore.isAllowedSender(sender, config.senders)) {
      Log.d(TAG, "ignored: sender not in allowlist ${config.senders}")
      return
    }

    val bodyPreview = body.take(60)
    val receivedAt = System.currentTimeMillis()

    // Extends our execution window past the receiver's normal ~10s limit —
    // required since the POST happens on a background thread.
    val pendingResult = goAsync()
    Thread {
      try {
        val (ok, detail) = SmsForwarder.postWithRetry(config, sender, body, receivedAt)
        Log.d(TAG, "post result ok=$ok detail=$detail")
        RelayStore.recordAttempt(context, sender, bodyPreview, ok, detail)
        if (ok) {
          val amountInr = SmsParser.parseAmountInr(body)
          val utr = SmsParser.parseUtr(body)
          RelayStore.setCheckpoint(context, receivedAt, amountInr, utr)
        }

        // Every live message is also a chance to check for backlog — e.g.
        // messages that arrived while offline are now sitting in the inbox
        // waiting, and this SMS being delivered means we have connectivity
        // (or at least a working radio) right now.
        SmsCatchUp.run(context)
      } finally {
        pendingResult.finish()
      }
    }.start()
  }

  companion object {
    private const val TAG = "SmsReceiver"
  }
}
