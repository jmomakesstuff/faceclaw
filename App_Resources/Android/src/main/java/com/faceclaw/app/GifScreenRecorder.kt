package com.faceclaw.app

import android.content.Context
import android.util.Log
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

/**
 * Android storage adapter for the shared GIF recorder. Frames are rendered and
 * compressed on one background thread, in the order they arrive, so a caller
 * on the BLE sender thread only queues references (see [addSentFrame]).
 */
class GifScreenRecorder {
    private val recorder = SharedGifScreenRecorder()

    fun addFrame(gray: ByteArray?, width: Int, height: Int, timestampMs: Long) {
        RecorderThread.run { recorder.addFrame(gray, width, height, timestampMs) }
    }

    /**
     * Add a frame as the image pipeline committed it: the packed 4bpp screen
     * with its shell scene drawn over it, which is what the glasses show.
     */
    fun addSentFrame(packed: ByteArray, width: Int, height: Int, scene: ShellScene, timestampMs: Long) {
        RecorderThread.run { recorder.addFrame(scene.previewPacked(packed, width, height), width, height, timestampMs) }
    }

    fun isOverflowed(): Boolean = recorder.isOverflowed()

    @Throws(IOException::class)
    fun save(context: Context): String {
        RecorderThread.drain()
        val gif = recorder.encode()
        if (gif.isEmpty()) return ""
        val file = File(ScreenshotUtil.ensureScreenshotsDir(context),
                "recording-" + ScreenshotUtil.timestamp() + ".gif")
        FileOutputStream(file).use { out -> out.write(gif) }
        return file.absolutePath
    }
}

/** The one thread every recording adds its frames on, which keeps them in capture order. */
private object RecorderThread {
    private const val TAG = "FaceclawGifRecorder"
    private const val DRAIN_TIMEOUT_MS = 10_000L

    private val executor: ExecutorService = Executors.newSingleThreadExecutor { task ->
        Thread(task, "Faceclaw GIF recorder").apply { isDaemon = true }
    }

    fun run(work: () -> Unit) {
        executor.execute {
            try {
                work()
            } catch (t: Throwable) {
                // An exception here would otherwise take the whole app down.
                Log.w(TAG, "screen recording dropped a frame", t)
            }
        }
    }

    /** Wait for every frame queued so far, so a recording is saved with its last frames. */
    fun drain() {
        try {
            executor.submit(Runnable {}).get(DRAIN_TIMEOUT_MS, TimeUnit.MILLISECONDS)
        } catch (e: TimeoutException) {
            Log.w(TAG, "screen recording saved before its queued frames finished")
        }
    }
}
