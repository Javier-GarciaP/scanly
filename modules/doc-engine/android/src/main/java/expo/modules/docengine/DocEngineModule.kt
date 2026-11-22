package expo.modules.docengine

import android.app.Activity
import android.content.ContentValues
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import androidx.exifinterface.media.ExifInterface
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions
import com.google.mlkit.vision.documentscanner.GmsDocumentScanning
import com.google.mlkit.vision.documentscanner.GmsDocumentScanningResult
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.pdmodel.PDPage
import com.tom_roush.pdfbox.pdmodel.PDPageContentStream
import com.tom_roush.pdfbox.pdmodel.common.PDRectangle
import com.tom_roush.pdfbox.pdmodel.encryption.AccessPermission
import com.tom_roush.pdfbox.pdmodel.encryption.StandardProtectionPolicy
import com.tom_roush.pdfbox.pdmodel.graphics.image.JPEGFactory
import com.tom_roush.pdfbox.pdmodel.graphics.image.LosslessFactory
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.util.UUID
import java.util.concurrent.Executors
import kotlin.math.max
import kotlin.math.min

class DocEngineModule : Module() {
  private val executor = Executors.newSingleThreadExecutor()
  private var pendingScanPromise: Promise? = null
  private var pdfBoxInitialized = false

  companion object {
    private const val SCAN_REQUEST_CODE = 42917
    private const val MAX_IMAGE_DIM = 2480
  }

  override fun definition() = ModuleDefinition {
    Name("DocEngine")

    OnActivityResult { _, payload ->
      if (payload.requestCode != SCAN_REQUEST_CODE) {
        return@OnActivityResult
      }
      val promise = pendingScanPromise ?: return@OnActivityResult
      pendingScanPromise = null

      val context = appContext.reactContext
      if (context == null) {
        promise.reject("NO_CONTEXT", "El contexto de Android no está disponible.", null)
        return@OnActivityResult
      }

      if (payload.resultCode != Activity.RESULT_OK || payload.data == null) {
        promise.resolve(
          mapOf(
            "cancelled" to true,
            "pageUris" to emptyList<String>()
          )
        )
        return@OnActivityResult
      }

      val result = GmsDocumentScanningResult.fromActivityResultIntent(payload.data)
      if (result == null) {
        promise.resolve(
          mapOf(
            "cancelled" to true,
            "pageUris" to emptyList<String>()
          )
        )
        return@OnActivityResult
      }

      executor.execute {
        try {
          val pagesDir = File(context.filesDir, "scanly_pages")
          if (!pagesDir.exists()) {
            pagesDir.mkdirs()
          }

          val savedUris = mutableListOf<String>()
          val pages = result.pages ?: emptyList()
          for (page in pages) {
            val destFile = File(pagesDir, "page_${System.currentTimeMillis()}_${UUID.randomUUID().toString().take(8)}.jpg")
            context.contentResolver.openInputStream(page.imageUri)?.use { input ->
              FileOutputStream(destFile).use { output ->
                input.copyTo(output)
              }
            }
            savedUris.add(Uri.fromFile(destFile).toString())
          }

          promise.resolve(
            mapOf(
              "cancelled" to false,
              "pageUris" to savedUris
            )
          )
        } catch (e: Exception) {
          promise.reject("SCAN_SAVE_ERROR", e.message ?: "Error al guardar páginas escaneadas.", e)
        }
      }
    }

    AsyncFunction("scanDocument") { options: Map<String, Any?>, promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null) {
        promise.reject("NO_ACTIVITY", "No hay una actividad activa para abrir el escáner.", null)
        return@AsyncFunction
      }

      if (pendingScanPromise != null) {
        promise.reject("SCAN_IN_PROGRESS", "Ya hay un escaneo en curso.", null)
        return@AsyncFunction
      }

      val pageLimit = (options["pageLimit"] as? Number)?.toInt() ?: 25
      val galleryImportAllowed = (options["galleryImportAllowed"] as? Boolean) ?: true

      val scannerOptions = GmsDocumentScannerOptions.Builder()
        .setGalleryImportAllowed(galleryImportAllowed)
        .setPageLimit(pageLimit.coerceIn(1, 50))
        .setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_JPEG)
        .setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_FULL)
        .build()

      val scanner = GmsDocumentScanning.getClient(scannerOptions)
      pendingScanPromise = promise

      scanner.getStartScanIntent(activity)
        .addOnSuccessListener { intentSender ->
          activity.runOnUiThread {
            try {
              activity.startIntentSenderForResult(
                intentSender,
                SCAN_REQUEST_CODE,
                null,
                0,
                0,
                0
              )
            } catch (e: Exception) {
              pendingScanPromise = null
              promise.reject("SCAN_LAUNCH_ERROR", e.message ?: "No se pudo abrir el escáner.", e)
            }
          }
        }
        .addOnFailureListener { e ->
          pendingScanPromise = null
          promise.reject("SCAN_INIT_ERROR", e.message ?: "Error iniciando ML Kit Document Scanner.", e)
        }
    }

    AsyncFunction("recognizeText") { imageUri: String, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.reject("NO_CONTEXT", "Contexto no disponible.", null)
        return@AsyncFunction
      }

      try {
        val uri = parseUri(imageUri)
        val inputImage = InputImage.fromFilePath(context, uri)
        val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)

        recognizer.process(inputImage)
          .addOnSuccessListener { visionText ->
            val blocks = visionText.textBlocks.map { block ->
              mapOf("text" to block.text)
            }
            promise.resolve(
              mapOf(
                "text" to visionText.text,
                "blocks" to blocks
              )
            )
            recognizer.close()
          }
          .addOnFailureListener { e ->
            recognizer.close()
            promise.reject("OCR_ERROR", e.message ?: "Error al reconocer texto.", e)
          }
      } catch (e: Exception) {
        promise.reject("OCR_LOAD_ERROR", e.message ?: "No se pudo leer la imagen para OCR.", e)
      }
    }

    AsyncFunction("generatePdf") { options: Map<String, Any?>, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.reject("NO_CONTEXT", "Contexto no disponible.", null)
        return@AsyncFunction
      }

      executor.execute {
        var document: PDDocument? = null
        try {
          ensurePdfBox(context)

          @Suppress("UNCHECKED_CAST")
          val imageUris = (options["imageUris"] as? List<*>)?.mapNotNull { it as? String } ?: emptyList()
          if (imageUris.isEmpty()) {
            promise.reject("EMPTY_PAGES", "No hay páginas para generar el PDF.", null)
            return@execute
          }

          val outputPathRaw = (options["outputPath"] as? String)
            ?: throw IllegalArgumentException("outputPath es obligatorio.")
          val password = (options["password"] as? String)?.trim().orEmpty()
          val pageSize = ((options["pageSize"] as? String) ?: "A4").uppercase()

          @Suppress("UNCHECKED_CAST")
          val rawSignatures = (options["signatures"] as? List<*>)
            ?.mapNotNull { it as? Map<String, Any?> } ?: emptyList()

          val outFile = uriToFile(outputPathRaw)
          outFile.parentFile?.let { parent ->
            if (!parent.exists()) parent.mkdirs()
          }

          document = PDDocument()

          for ((index, uriStr) in imageUris.withIndex()) {
            val bitmap = decodeNormalizedBitmap(context, uriStr)
              ?: throw IllegalStateException("No se pudo decodificar la página ${index + 1}.")

            try {
              val imgW = bitmap.width.toFloat()
              val imgH = bitmap.height.toFloat()

              val pageRect = when (pageSize) {
                "LETTER" -> PDRectangle.LETTER
                "FIT" -> {
                  val targetW = 595.28f
                  val targetH = targetW * (imgH / imgW)
                  PDRectangle(targetW, targetH)
                }
                else -> PDRectangle.A4
              }

              val page = PDPage(pageRect)
              document.addPage(page)

              val pageW = pageRect.width
              val pageH = pageRect.height

              val scale = min(pageW / imgW, pageH / imgH)
              val drawW = imgW * scale
              val drawH = imgH * scale
              val drawX = (pageW - drawW) / 2f
              val drawY = (pageH - drawH) / 2f

              val pdImage = JPEGFactory.createFromImage(document, bitmap, 0.85f)

              PDPageContentStream(document, page).use { cs ->
                // Fondo blanco limpio
                cs.setNonStrokingColor(255, 255, 255)
                cs.addRect(0f, 0f, pageW, pageH)
                cs.fill()

                // Imagen de la hoja escaneada
                cs.drawImage(pdImage, drawX, drawY, drawW, drawH)

                // Firmas superpuestas en esta página
                val pageSignatures = rawSignatures.filter {
                  (it["pageIndex"] as? Number)?.toInt() == index
                }
                for (sig in pageSignatures) {
                  val sigUri = sig["imageUri"] as? String ?: continue
                  val xRatio = (sig["xRatio"] as? Number)?.toFloat() ?: 0.55f
                  val yRatio = (sig["yRatio"] as? Number)?.toFloat() ?: 0.78f
                  val widthRatio = (sig["widthRatio"] as? Number)?.toFloat() ?: 0.30f

                  val sigBitmap = decodeRawBitmap(context, sigUri) ?: continue
                  try {
                    val pdSig = LosslessFactory.createFromImage(document, sigBitmap)
                    val sigW = drawW * widthRatio.coerceIn(0.08f, 0.85f)
                    val sigH = sigW * (sigBitmap.height.toFloat() / max(1f, sigBitmap.width.toFloat()))

                    val sigX = drawX + (drawW * xRatio.coerceIn(0f, 0.95f))
                    // Convertir coordenada top-down a sistema PDF bottom-up dentro del área de la hoja
                    val topEdgeOfImage = drawY + drawH
                    val sigY = topEdgeOfImage - (drawH * yRatio.coerceIn(0f, 0.95f)) - sigH

                    cs.drawImage(pdSig, sigX, sigY, sigW, sigH)
                  } finally {
                    sigBitmap.recycle()
                  }
                }
              }
            } finally {
              bitmap.recycle()
            }
          }

          if (password.isNotEmpty()) {
            val accessPermission = AccessPermission()
            val spp = StandardProtectionPolicy(password, password, accessPermission)
            spp.encryptionKeyLength = 128
            spp.permissions = accessPermission
            document.protect(spp)
          }

          document.save(outFile)
          document.close()
          document = null

          promise.resolve(
            mapOf(
              "uri" to Uri.fromFile(outFile).toString(),
              "sizeBytes" to outFile.length(),
              "pageCount" to imageUris.size
            )
          )
        } catch (e: Exception) {
          try {
            document?.close()
          } catch (_: Exception) {}
          promise.reject("PDF_GEN_ERROR", e.message ?: "Error al generar el PDF.", e)
        }
      }
    }

    AsyncFunction("renderSignaturePng") { options: Map<String, Any?>, promise: Promise ->
      executor.execute {
        try {
          val width = ((options["width"] as? Number)?.toInt() ?: 600).coerceIn(100, 2000)
          val height = ((options["height"] as? Number)?.toInt() ?: 260).coerceIn(80, 1200)
          val strokeColorStr = (options["strokeColor"] as? String) ?: "#0F172A"
          val strokeWidth = (options["strokeWidth"] as? Number)?.toFloat() ?: 6f
          val outputPathRaw = (options["outputPath"] as? String)
            ?: throw IllegalArgumentException("outputPath es obligatorio.")

          @Suppress("UNCHECKED_CAST")
          val strokes = (options["strokes"] as? List<*>) ?: emptyList<Any>()

          val scaleFactor = 2f
          val bmpW = (width * scaleFactor).toInt()
          val bmpH = (height * scaleFactor).toInt()

          val bitmap = Bitmap.createBitmap(bmpW, bmpH, Bitmap.Config.ARGB_8888)
          val canvas = Canvas(bitmap)
          canvas.drawColor(Color.TRANSPARENT)

          val paint = Paint().apply {
            color = try {
              Color.parseColor(strokeColorStr)
            } catch (_: Exception) {
              Color.BLACK
            }
            style = Paint.Style.STROKE
            this.strokeWidth = strokeWidth * scaleFactor
            strokeCap = Paint.Cap.ROUND
            strokeJoin = Paint.Join.ROUND
            isAntiAlias = true
          }

          for (strokeAny in strokes) {
            val points = (strokeAny as? List<*>)?.mapNotNull { it as? Map<*, *> } ?: continue
            if (points.isEmpty()) continue
            val path = Path()
            val firstX = ((points[0]["x"] as? Number)?.toFloat() ?: 0f) * scaleFactor
            val firstY = ((points[0]["y"] as? Number)?.toFloat() ?: 0f) * scaleFactor

            if (points.size == 1) {
              canvas.drawPoint(firstX, firstY, paint)
              continue
            }

            path.moveTo(firstX, firstY)
            var prevX = firstX
            var prevY = firstY
            for (i in 1 until points.size) {
              val currX = ((points[i]["x"] as? Number)?.toFloat() ?: prevX) * scaleFactor
              val currY = ((points[i]["y"] as? Number)?.toFloat() ?: prevY) * scaleFactor
              val midX = (prevX + currX) / 2f
              val midY = (prevY + currY) / 2f
              path.quadTo(prevX, prevY, midX, midY)
              prevX = currX
              prevY = currY
            }
            path.lineTo(prevX, prevY)
            canvas.drawPath(path, paint)
          }

          val outFile = uriToFile(outputPathRaw)
          outFile.parentFile?.let { parent ->
            if (!parent.exists()) parent.mkdirs()
          }
          FileOutputStream(outFile).use { fos ->
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, fos)
          }
          bitmap.recycle()

          promise.resolve(Uri.fromFile(outFile).toString())
        } catch (e: Exception) {
          promise.reject("SIGNATURE_RENDER_ERROR", e.message ?: "Error al guardar la firma.", e)
        }
      }
    }

    AsyncFunction("saveToDownloads") { sourceUri: String, fileName: String, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.reject("NO_CONTEXT", "Contexto no disponible.", null)
        return@AsyncFunction
      }

      executor.execute {
        try {
          val srcFile = uriToFile(sourceUri)
          if (!srcFile.exists()) {
            promise.reject("FILE_NOT_FOUND", "No se encontró el PDF para guardar.", null)
            return@execute
          }

          val safeName = fileName.replace(Regex("[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ._\\- ]"), "_")
          val finalName = if (safeName.endsWith(".pdf", ignoreCase = true)) safeName else "$safeName.pdf"

          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val resolver = context.contentResolver
            val values = ContentValues().apply {
              put(MediaStore.Downloads.DISPLAY_NAME, finalName)
              put(MediaStore.Downloads.MIME_TYPE, "application/pdf")
              put(MediaStore.Downloads.RELATIVE_PATH, "${Environment.DIRECTORY_DOWNLOADS}/Scanly")
              put(MediaStore.Downloads.IS_PENDING, 1)
            }

            val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
              ?: throw IllegalStateException("No se pudo crear el archivo en Descargas.")

            resolver.openOutputStream(uri)?.use { out ->
              FileInputStream(srcFile).use { input ->
                input.copyTo(out)
              }
            }

            values.clear()
            values.put(MediaStore.Downloads.IS_PENDING, 0)
            resolver.update(uri, values, null, null)

            promise.resolve(mapOf("savedPath" to "Descargas/Scanly/$finalName"))
          } else {
            @Suppress("DEPRECATION")
            val downloadsDir = File(
              Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
              "Scanly"
            )
            if (!downloadsDir.exists()) downloadsDir.mkdirs()
            val destFile = File(downloadsDir, finalName)
            FileInputStream(srcFile).use { input ->
              FileOutputStream(destFile).use { out ->
                input.copyTo(out)
              }
            }
            promise.resolve(mapOf("savedPath" to destFile.absolutePath))
          }
        } catch (e: Exception) {
          promise.reject("DOWNLOADS_ERROR", e.message ?: "Error al guardar en Descargas.", e)
        }
      }
    }
  }

  private fun ensurePdfBox(context: Context) {
    if (!pdfBoxInitialized) {
      PDFBoxResourceLoader.init(context.applicationContext)
      pdfBoxInitialized = true
    }
  }

  private fun parseUri(uriStr: String): Uri {
    return if (uriStr.startsWith("file://") || uriStr.startsWith("content://")) {
      Uri.parse(uriStr)
    } else {
      Uri.fromFile(File(uriStr))
    }
  }

  private fun uriToFile(uriStr: String): File {
    return if (uriStr.startsWith("file://")) {
      File(Uri.parse(uriStr).path ?: uriStr.removePrefix("file://"))
    } else {
      File(uriStr)
    }
  }

  private fun decodeRawBitmap(context: Context, uriStr: String): Bitmap? {
    val uri = parseUri(uriStr)
    return if (uri.scheme == "content") {
      context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it) }
    } else {
      BitmapFactory.decodeFile(uri.path)
    }
  }

  private fun decodeNormalizedBitmap(context: Context, uriStr: String): Bitmap? {
    val uri = parseUri(uriStr)
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }

    if (uri.scheme == "content") {
      context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
    } else {
      BitmapFactory.decodeFile(uri.path, bounds)
    }

    var sampleSize = 1
    while (bounds.outWidth / sampleSize > MAX_IMAGE_DIM || bounds.outHeight / sampleSize > MAX_IMAGE_DIM) {
      sampleSize *= 2
    }

    val decodeOpts = BitmapFactory.Options().apply {
      inSampleSize = sampleSize
      inPreferredConfig = Bitmap.Config.ARGB_8888
    }

    val decoded = if (uri.scheme == "content") {
      context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, decodeOpts) }
    } else {
      BitmapFactory.decodeFile(uri.path, decodeOpts)
    } ?: return null

    val orientation = try {
      if (uri.scheme == "content") {
        context.contentResolver.openInputStream(uri)?.use {
          ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
        } ?: ExifInterface.ORIENTATION_NORMAL
      } else {
        uri.path?.let {
          ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
        } ?: ExifInterface.ORIENTATION_NORMAL
      }
    } catch (_: Exception) {
      ExifInterface.ORIENTATION_NORMAL
    }

    val rotationDegrees = when (orientation) {
      ExifInterface.ORIENTATION_ROTATE_90 -> 90f
      ExifInterface.ORIENTATION_ROTATE_180 -> 180f
      ExifInterface.ORIENTATION_ROTATE_270 -> 270f
      else -> 0f
    }

    if (rotationDegrees == 0f) return decoded

    val matrix = Matrix().apply { postRotate(rotationDegrees) }
    val rotated = Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, true)
    if (rotated != decoded) {
      decoded.recycle()
    }
    return rotated
  }
}
