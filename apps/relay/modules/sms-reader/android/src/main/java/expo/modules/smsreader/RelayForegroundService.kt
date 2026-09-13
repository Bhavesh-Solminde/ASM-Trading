package expo.modules.smsreader

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat

/**
 * Holds foreground-service priority so Android doesn't kill the app process
 * while backgrounded — the existing static SMS receiver keeps working
 * regardless, but this also gives a good, long-lived place to watch for
 * connectivity coming back and run the backlog catch-up scan then, which is
 * the clearest "phone just came online" signal available.
 */
class RelayForegroundService : Service() {

  private var networkCallback: ConnectivityManager.NetworkCallback? = null

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

    registerNetworkCallback()
    // Also catch up right away — covers "was off/disabled while offline,
    // now reopening/re-enabling" without waiting for a network transition.
    Thread { SmsCatchUp.run(applicationContext) }.start()

    return START_STICKY
  }

  override fun onDestroy() {
    unregisterNetworkCallback()
    super.onDestroy()
  }

  private fun registerNetworkCallback() {
    if (networkCallback != null) return

    val connectivityManager = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    val request = NetworkRequest.Builder()
      .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
      .build()

    val callback = object : ConnectivityManager.NetworkCallback() {
      override fun onAvailable(network: Network) {
        Log.d(TAG, "network available, running catch-up")
        Thread { SmsCatchUp.run(applicationContext) }.start()
      }
    }

    runCatching { connectivityManager.registerNetworkCallback(request, callback) }
      .onSuccess { networkCallback = callback }
      .onFailure { Log.d(TAG, "failed to register network callback: ${it.message}") }
  }

  private fun unregisterNetworkCallback() {
    val callback = networkCallback ?: return
    val connectivityManager = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    runCatching { connectivityManager.unregisterNetworkCallback(callback) }
    networkCallback = null
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
    private const val TAG = "RelayForegroundService"
    private const val CHANNEL_ID = "relay_listening"
    private const val NOTIFICATION_ID = 1
  }
}
