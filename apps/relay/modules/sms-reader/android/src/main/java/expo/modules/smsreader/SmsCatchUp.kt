package expo.modules.smsreader

import android.content.Context
import android.provider.Telephony
import android.util.Log

/**
 * Scans the device's own SMS inbox (not just live broadcasts) for anything
 * newer than the last confirmed checkpoint and forwards it. Covers the gap
 * a pure broadcast receiver can't: messages that arrived while the phone had
 * no network (or the app was off), which never had a chance to send at the
 * time and would otherwise be lost for good.
 *
 * Safe to call from multiple trigger points (live receiver, service start,
 * connectivity restored) — synchronized so two scans never run at once, and
 * bounded so one call can't hold a wakelock indefinitely; anything left over
 * gets picked up by the next trigger.
 */
object SmsCatchUp {
  private const val TAG = "SmsCatchUp"
  private const val BATCH_LIMIT = 50
  private val lock = Any()

  fun run(context: Context) {
    synchronized(lock) {
      if (!RelayStore.isEnabled(context)) return
      val config = RelayStore.getConfig(context) ?: return
      val checkpoint = RelayStore.getCheckpointAt(context)

      val projection = arrayOf(Telephony.Sms.ADDRESS, Telephony.Sms.BODY, Telephony.Sms.DATE)
      val selection = "${Telephony.Sms.DATE} > ?"
      val selectionArgs = arrayOf(checkpoint.toString())
      val sortOrder = "${Telephony.Sms.DATE} ASC LIMIT $BATCH_LIMIT"

      val cursor = try {
        context.contentResolver.query(
          Telephony.Sms.Inbox.CONTENT_URI,
          projection,
          selection,
          selectionArgs,
          sortOrder,
        )
      } catch (error: Exception) {
        Log.d(TAG, "inbox query failed: ${error.message}")
        return
      } ?: return

      var processed = 0
      cursor.use {
        val addressIdx = it.getColumnIndex(Telephony.Sms.ADDRESS)
        val bodyIdx = it.getColumnIndex(Telephony.Sms.BODY)
        val dateIdx = it.getColumnIndex(Telephony.Sms.DATE)

        while (it.moveToNext()) {
          val sender = it.getString(addressIdx) ?: continue
          val body = it.getString(bodyIdx) ?: ""
          val date = it.getLong(dateIdx)

          if (body.isBlank() || !RelayStore.isAllowedSender(sender, config.senders)) {
            // Doesn't count as "handled" for forwarding, but still moves the
            // checkpoint past it — otherwise every unrelated SMS (OTPs etc.)
            // would get rescanned by every future catch-up run forever.
            RelayStore.setCheckpoint(context, date, null, null)
            continue
          }

          Log.d(TAG, "catch-up forwarding sms from $sender dated $date")
          val (ok, detail) = SmsForwarder.postWithRetry(config, sender, body, date)
          RelayStore.recordAttempt(context, sender, body.take(60), ok, detail)

          if (ok) {
            val amountInr = SmsParser.parseAmountInr(body)
            val utr = SmsParser.parseUtr(body)
            RelayStore.setCheckpoint(context, date, amountInr, utr)
            processed++
          } else {
            // Stop here, not just skip: preserves send order and lets the
            // next trigger retry this exact message first rather than
            // skipping ahead past a real failure.
            Log.d(TAG, "catch-up stopped on failure, will retry from here next time")
            return
          }
        }
      }

      if (processed > 0) Log.d(TAG, "catch-up forwarded $processed backlog message(s)")
    }
  }
}
