package expo.modules.smsreader

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.provider.Telephony
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Reads THIS device's incoming SMS and emits each one to JavaScript.
 *
 * The receiver is registered dynamically while JS is listening rather than
 * declared statically, so it exists only while the app is running. That is a
 * deliberate limitation: a manifest receiver would survive an app kill but
 * needs a static bridge to reach JS and fights Android's background limits.
 */
class SmsReaderModule : Module() {

  private var receiver: BroadcastReceiver? = null

  override fun definition() = ModuleDefinition {
    Name("SmsReader")

    Events("onSmsReceived")

    AsyncFunction("startListening") {
      if (receiver != null) return@AsyncFunction

      val context = appContext.reactContext
        ?: throw IllegalStateException("No Android context available")

      val created = object : BroadcastReceiver() {
        override fun onReceive(ctx: Context?, intent: Intent?) {
          if (intent?.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return

          val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return
          if (messages.isEmpty()) return

          val sender = messages[0].displayOriginatingAddress ?: "unknown"
          val body = messages.joinToString("") { it.displayMessageBody ?: "" }
          if (body.isBlank()) return

          sendEvent(
            "onSmsReceived",
            mapOf(
              "sender" to sender,
              "body" to body,
              "receivedAt" to System.currentTimeMillis()
            )
          )
        }
      }

      val filter = IntentFilter(Telephony.Sms.Intents.SMS_RECEIVED_ACTION)

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        context.registerReceiver(created, filter, Context.RECEIVER_EXPORTED)
      } else {
        @Suppress("UnspecifiedRegisterReceiverFlag")
        context.registerReceiver(created, filter)
      }

      receiver = created
    }

    AsyncFunction("stopListening") {
      val current = receiver ?: return@AsyncFunction
      appContext.reactContext?.unregisterReceiver(current)
      receiver = null
    }

    AsyncFunction("isListening") {
      receiver != null
    }

    OnDestroy {
      receiver?.let { current ->
        runCatching { appContext.reactContext?.unregisterReceiver(current) }
        receiver = null
      }
    }
  }
}
