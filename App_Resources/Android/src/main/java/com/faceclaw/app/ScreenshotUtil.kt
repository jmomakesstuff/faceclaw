package com.faceclaw.app

import android.content.Context
import android.util.Base64

import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Saves screenshots of the composited screen as 4-bit grayscale PNGs (the
 * display's native depth). Retrieve with
 *   adb pull /sdcard/Android/data/com.faceclaw.app/files/screenshots/
 */
class ScreenshotUtil private constructor() {
    companion object {
        /** Returns the absolute path of the written file. */
        @JvmStatic
        @Throws(IOException::class)
        fun savePngScreenshot(context: Context, gray: ByteArray?, width: Int, height: Int): String {
            if (gray == null || width <= 0 || height <= 0 || gray.size < width * height) {
                throw IllegalArgumentException("invalid screenshot buffer")
            }
            val png = SharedScreenshots.encode4BitGrayPng(gray, width, height)
            val file = File(ensureScreenshotsDir(context), "screen-" + timestamp() + ".png")
            FileOutputStream(file).use { out ->
                out.write(png)
            }
            return file.absolutePath
        }

        /**
         * The same PNG [savePngScreenshot] writes, returned as base64 instead
         * of landing on disk. The Input API's screenshot action uses this: a
         * caller watching the display for a transient state polls it, and one
         * file per poll would pile up in the app's external storage.
         */
        @JvmStatic
        fun encodePngBase64(gray: ByteArray?, width: Int, height: Int): String {
            if (gray == null || width <= 0 || height <= 0 || gray.size < width * height) {
                throw IllegalArgumentException("invalid screenshot buffer")
            }
            val png = SharedScreenshots.encode4BitGrayPng(gray, width, height)
            return Base64.encodeToString(png, Base64.NO_WRAP)
        }

        @JvmStatic
        @Throws(IOException::class)
        fun ensureScreenshotsDir(context: Context): File {
            val dir = File(context.getExternalFilesDir(null), "screenshots")
            if (!dir.exists() && !dir.mkdirs()) {
                throw IOException("failed to create $dir")
            }
            return dir
        }

        @JvmStatic
        fun timestamp(): String {
            return SimpleDateFormat("yyyyMMdd-HHmmss-SSS", Locale.US).format(Date())
        }
    }
}
