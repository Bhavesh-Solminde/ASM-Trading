package expo.modules.smsreader

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

/**
 * Exists only to hold foreground-service priority so Android doesn't kill the
 * app process while backgrounded. It does no work itself — the existing
 * dynamically-registered SMS receiver and the JS forwarder's poll loop keep
 * running exactly as before, just for as long as this service (and therefore
 * the process) stays alive.
 */
class RelayForegroundService : Service() {

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    createNotificationChannel()

    val notification = NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle("ASM Relay")
      .setContentText("Listening for bank SMS")
      .setSmallIcon(android.R.drawable.stat_notify_sync)
      .setOngoing(true)
      .build()

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }

    return START_STICKY
  }

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val manager = getSystemService(NotificationManager::class.java)
      val channel = NotificationChannel(
        CHANNEL_ID,
        "ASM Relay listening",
        NotificationManager.IMPORTANCE_LOW,
      )
      manager.createNotificationChannel(channel)
    }
  }

  companion object {
    private const val CHANNEL_ID = "relay_listening"
    private const val NOTIFICATION_ID = 1
  }
}
