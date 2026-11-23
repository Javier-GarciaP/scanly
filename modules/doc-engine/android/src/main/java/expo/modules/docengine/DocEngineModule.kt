package expo.modules.docengine

import android.app.Activity
import android.content.ContentValues
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import androidx.exifinterface.media.ExifInterface
import com.google.android.gms.common.moduleinstall.ModuleInstall
import com.google.android.gms.common.moduleinstall.ModuleInstallRequest
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
import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

class DocEngineModule : Module() {
  private val executor = Executors.newSingleThreadExecutor()
  @Volatile private var pendingScanPromise: Promise? = null
  @Volatile private var pdfBoxInitialized = false

  companion object {
    private const val SCAN_REQUEST_CODE = 42917
    private const val MAX_IMAGE_DIM = 2480
    private const val DETECT_MAX_DIM = 480
  }

  override fun definition() = ModuleDefinition {
    Name("DocEngine")

    OnDestroy {
      val pending = pendingScanPromise
      pendingScanPromise = null
      pending?.resolve(
        mapOf(
          "cancelled" to true,
          "pageUris" to emptyList<String>()
        )
      )
    }

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

      pendingScanPromise = promise

      activity.runOnUiThread {
        try {
          val scannerOptions = GmsDocumentScannerOptions.Builder()
            .setGalleryImportAllowed(galleryImportAllowed)
            .setPageLimit(pageLimit.coerceIn(1, 50))
            .setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_JPEG)
            .setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_FULL)
            .build()

          val scanner = GmsDocumentScanning.getClient(scannerOptions)

          // Solicita en segundo plano el módulo opcional si aún no está en caché
          try {
            val installClient = ModuleInstall.getClient(activity)
            installClient.areModulesAvailable(scanner)
              .addOnSuccessListener { response ->
                if (!response.areModulesAvailable()) {
                  val req = ModuleInstallRequest.newBuilder().addApi(scanner).build()
                  installClient.installModules(req)
                }
              }
          } catch (_: Exception) {
            // Continuar directamente con getStartScanIntent
          }

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
        } catch (e: Exception) {
          pendingScanPromise = null
          promise.reject(
            "SCAN_INIT_ERROR",
            e.message ?: "No se pudo inicializar el escáner de documentos.",
            e
          )
        }
      }
    }

    AsyncFunction("detectDocumentCorners") { imageUri: String, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.reject("NO_CONTEXT", "Contexto no disponible.", null)
        return@AsyncFunction
      }

      executor.execute {
        var bitmap: Bitmap? = null
        try {
          bitmap = decodeNormalizedBitmap(context, imageUri, DETECT_MAX_DIM)
          if (bitmap == null) {
            promise.reject("IMAGE_LOAD_ERROR", "No se pudo leer la imagen para detectar bordes.", null)
            return@execute
          }

          val w = bitmap.width
          val h = bitmap.height
          val (corners, detected) = detectQuadCorners(bitmap)

          val cornerList = corners.map { pt ->
            mapOf(
              "x" to pt.first.toDouble().coerceIn(0.0, 1.0),
              "y" to pt.second.toDouble().coerceIn(0.0, 1.0)
            )
          }

          promise.resolve(
            mapOf(
              "width" to w,
              "height" to h,
              "detected" to detected,
              "corners" to cornerList
            )
          )
        } catch (e: Exception) {
          promise.reject("DETECT_ERROR", e.message ?: "Error al detectar los bordes de la hoja.", e)
        } finally {
          bitmap?.recycle()
        }
      }
    }

    AsyncFunction("cropDocumentPerspective") { options: Map<String, Any?>, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.reject("NO_CONTEXT", "Contexto no disponible.", null)
        return@AsyncFunction
      }

      executor.execute {
        var srcBitmap: Bitmap? = null
        var warpedBitmap: Bitmap? = null
        var filteredBitmap: Bitmap? = null
        try {
          val imageUri = (options["imageUri"] as? String)
            ?: throw IllegalArgumentException("imageUri es obligatorio.")
          val filter = ((options["filter"] as? String) ?: "original").lowercase()
          val outputPathRaw = options["outputPath"] as? String

          @Suppress("UNCHECKED_CAST")
          val rawCorners = (options["corners"] as? List<*>)
            ?.mapNotNull { it as? Map<*, *> }
            ?: emptyList()

          if (rawCorners.size != 4) {
            throw IllegalArgumentException("Se requieren exactamente 4 esquinas para recortar.")
          }

          srcBitmap = decodeNormalizedBitmap(context, imageUri, MAX_IMAGE_DIM)
            ?: throw IllegalStateException("No se pudo decodificar la imagen.")

          val srcW = srcBitmap.width.toFloat()
          val srcH = srcBitmap.height.toFloat()

          val pts = rawCorners.map { c ->
            val x = ((c["x"] as? Number)?.toFloat() ?: 0f).coerceIn(0f, 1f) * srcW
            val y = ((c["y"] as? Number)?.toFloat() ?: 0f).coerceIn(0f, 1f) * srcH
            Pair(x, y)
          }

          val topW = hypot((pts[1].first - pts[0].first).toDouble(), (pts[1].second - pts[0].second).toDouble())
          val bottomW = hypot((pts[2].first - pts[3].first).toDouble(), (pts[2].second - pts[3].second).toDouble())
          val leftH = hypot((pts[3].first - pts[0].first).toDouble(), (pts[3].second - pts[0].second).toDouble())
          val rightH = hypot((pts[2].first - pts[1].first).toDouble(), (pts[2].second - pts[1].second).toDouble())

          var outW = max(topW, bottomW).roundToInt().coerceAtLeast(160)
          var outH = max(leftH, rightH).roundToInt().coerceAtLeast(160)

          val maxSide = max(outW, outH)
          if (maxSide > MAX_IMAGE_DIM) {
            val scale = MAX_IMAGE_DIM.toFloat() / maxSide.toFloat()
            outW = (outW * scale).roundToInt().coerceAtLeast(160)
            outH = (outH * scale).roundToInt().coerceAtLeast(160)
          }

          val srcPoly = floatArrayOf(
            pts[0].first, pts[0].second,
            pts[1].first, pts[1].second,
            pts[2].first, pts[2].second,
            pts[3].first, pts[3].second
          )
          val dstPoly = floatArrayOf(
            0f, 0f,
            outW.toFloat(), 0f,
            outW.toFloat(), outH.toFloat(),
            0f, outH.toFloat()
          )

          val matrix = Matrix()
          val mapped = matrix.setPolyToPoly(srcPoly, 0, dstPoly, 0, 4)

          warpedBitmap = Bitmap.createBitmap(outW, outH, Bitmap.Config.ARGB_8888)
          val canvas = Canvas(warpedBitmap)
          canvas.drawColor(Color.WHITE)

          val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG or Paint.DITHER_FLAG)
          if (mapped) {
            canvas.drawBitmap(srcBitmap, matrix, paint)
          } else {
            val fallbackRect = android.graphics.RectF(0f, 0f, outW.toFloat(), outH.toFloat())
            canvas.drawBitmap(srcBitmap, null, fallbackRect, paint)
          }

          val finalBitmap = if (filter != "original") {
            filteredBitmap = applyDocumentFilter(warpedBitmap, filter)
            filteredBitmap
          } else {
            warpedBitmap
          }

          val outFile = if (!outputPathRaw.isNullOrBlank()) {
            uriToFile(outputPathRaw)
          } else {
            val pagesDir = File(context.filesDir, "scanly_pages")
            if (!pagesDir.exists()) pagesDir.mkdirs()
            File(pagesDir, "crop_${System.currentTimeMillis()}_${UUID.randomUUID().toString().take(8)}.jpg")
          }
          outFile.parentFile?.let { parent ->
            if (!parent.exists()) parent.mkdirs()
          }

          FileOutputStream(outFile).use { fos ->
            finalBitmap.compress(Bitmap.CompressFormat.JPEG, 92, fos)
          }

          promise.resolve(
            mapOf(
              "uri" to Uri.fromFile(outFile).toString(),
              "width" to outW,
              "height" to outH
            )
          )
        } catch (e: Exception) {
          promise.reject("CROP_ERROR", e.message ?: "Error al recortar el documento.", e)
        } finally {
          if (filteredBitmap != null && filteredBitmap != warpedBitmap) {
            filteredBitmap.recycle()
          }
          warpedBitmap?.recycle()
          srcBitmap?.recycle()
        }
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
            val bitmap = decodeNormalizedBitmap(context, uriStr, MAX_IMAGE_DIM)
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

              val pdImage = JPEGFactory.createFromImage(document, bitmap, 0.88f)

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
            spp.isPreferAES = true
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
          val defaultColorStr = (options["strokeColor"] as? String) ?: "#0F172A"
          val defaultStrokeWidth = (options["strokeWidth"] as? Number)?.toFloat() ?: 6f
          val outputPathRaw = (options["outputPath"] as? String)
            ?: throw IllegalArgumentException("outputPath es obligatorio.")

          val strokes = (options["strokes"] as? List<*>) ?: emptyList<Any>()

          val scaleFactor = 2f
          val bmpW = (width * scaleFactor).toInt()
          val bmpH = (height * scaleFactor).toInt()

          val bitmap = Bitmap.createBitmap(bmpW, bmpH, Bitmap.Config.ARGB_8888)
          val canvas = Canvas(bitmap)
          canvas.drawColor(Color.TRANSPARENT)

          val basePaint = Paint().apply {
            style = Paint.Style.STROKE
            strokeCap = Paint.Cap.ROUND
            strokeJoin = Paint.Join.ROUND
            isAntiAlias = true
          }

          for (strokeAny in strokes) {
            val points: List<Map<*, *>>
            val strokeColorStr: String
            val strokeWidthVal: Float

            if (strokeAny is Map<*, *>) {
              points = (strokeAny["points"] as? List<*>)?.mapNotNull { it as? Map<*, *> } ?: continue
              strokeColorStr = (strokeAny["color"] as? String) ?: defaultColorStr
              strokeWidthVal = (strokeAny["width"] as? Number)?.toFloat() ?: defaultStrokeWidth
            } else {
              points = (strokeAny as? List<*>)?.mapNotNull { it as? Map<*, *> } ?: continue
              strokeColorStr = defaultColorStr
              strokeWidthVal = defaultStrokeWidth
            }

            if (points.isEmpty()) continue

            basePaint.color = try {
              Color.parseColor(strokeColorStr)
            } catch (_: Exception) {
              Color.BLACK
            }
            basePaint.strokeWidth = strokeWidthVal * scaleFactor

            val scaled = points.map { p ->
              val px = ((p["x"] as? Number)?.toFloat() ?: 0f).coerceIn(0f, width.toFloat()) * scaleFactor
              val py = ((p["y"] as? Number)?.toFloat() ?: 0f).coerceIn(0f, height.toFloat()) * scaleFactor
              Pair(px, py)
            }

            if (scaled.size == 1) {
              canvas.drawPoint(scaled[0].first, scaled[0].second, basePaint)
              continue
            }

            // Catmull-Rom: the curve passes through every sampled point, so the ink keeps its shape.
            val path = Path()
            path.moveTo(scaled[0].first, scaled[0].second)
            for (i in 0 until scaled.size - 1) {
              val p0 = if (i > 0) scaled[i - 1] else scaled[i]
              val p1 = scaled[i]
              val p2 = scaled[i + 1]
              val p3 = if (i + 2 < scaled.size) scaled[i + 2] else p2
              val c1x = p1.first + (p2.first - p0.first) / 6f
              val c1y = p1.second + (p2.second - p0.second) / 6f
              val c2x = p2.first - (p3.first - p1.first) / 6f
              val c2y = p2.second - (p3.second - p1.second) / 6f
              path.cubicTo(c1x, c1y, c2x, c2y, p2.first, p2.second)
            }
            canvas.drawPath(path, basePaint)
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
        var insertedUri: Uri? = null
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
            insertedUri = uri

            resolver.openOutputStream(uri)?.use { out ->
              FileInputStream(srcFile).use { input ->
                input.copyTo(out)
              }
            } ?: throw IllegalStateException("No se pudo abrir el flujo de salida en Descargas.")

            values.clear()
            values.put(MediaStore.Downloads.IS_PENDING, 0)
            resolver.update(uri, values, null, null)
            insertedUri = null

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
          // Limpiar entrada huérfana IS_PENDING si falló la copia en MediaStore
          insertedUri?.let { orphan ->
            try {
              context.contentResolver.delete(orphan, null, null)
            } catch (_: Exception) {}
          }
          promise.reject("DOWNLOADS_ERROR", e.message ?: "Error al guardar en Descargas.", e)
        }
      }
    }
  }

  private fun detectQuadCorners(bitmap: Bitmap): Pair<List<Pair<Float, Float>>, Boolean> {
    val w = bitmap.width
    val h = bitmap.height
    val defaultCorners = listOf(
      Pair(0.06f, 0.06f),
      Pair(0.94f, 0.06f),
      Pair(0.94f, 0.94f),
      Pair(0.06f, 0.94f)
    )
    if (w < 32 || h < 32) return Pair(defaultCorners, false)

    val pixels = IntArray(w * h)
    bitmap.getPixels(pixels, 0, w, 0, 0, w, h)

    val gray = IntArray(w * h)
    val hist = IntArray(256)
    for (i in pixels.indices) {
      val c = pixels[i]
      val lum = (((c shr 16) and 0xFF) * 77 + ((c shr 8) and 0xFF) * 150 + (c and 0xFF) * 29) shr 8
      gray[i] = lum
      hist[lum]++
    }

    // 3x3 suavizado ligero
    val smooth = IntArray(w * h)
    for (y in 1 until h - 1) {
      val row = y * w
      for (x in 1 until w - 1) {
        val idx = row + x
        smooth[idx] = (
          gray[idx - w - 1] + gray[idx - w] + gray[idx - w + 1] +
            gray[idx - 1] + gray[idx] + gray[idx + 1] +
            gray[idx + w - 1] + gray[idx + w] + gray[idx + w + 1]
          ) / 9
      }
    }

    // Media de bordes externos para detectar si la hoja es más clara que el fondo
    var borderSum = 0L
    var borderCount = 0
    val marginX = max(2, (w * 0.04f).toInt())
    val marginY = max(2, (h * 0.04f).toInt())
    for (y in 0 until h) {
      for (x in 0 until w) {
        if (x < marginX || x >= w - marginX || y < marginY || y >= h - marginY) {
          borderSum += gray[y * w + x]
          borderCount++
        }
      }
    }
    val borderMean = if (borderCount > 0) (borderSum / borderCount).toInt() else 128

    // Umbral de Otsu
    val total = w * h
    var sumAll = 0.0
    for (t in 0..255) sumAll += t * hist[t]
    var sumB = 0.0
    var wB = 0
    var maxVar = -1.0
    var otsuThresh = 128
    for (t in 0..255) {
      wB += hist[t]
      if (wB == 0) continue
      val wF = total - wB
      if (wF == 0) break
      sumB += t * hist[t]
      val mB = sumB / wB
      val mF = (sumAll - sumB) / wF
      val diff = mB - mF
      val between = wB.toDouble() * wF.toDouble() * diff * diff
      if (between > maxVar) {
        maxVar = between
        otsuThresh = t
      }
    }

    // Estrategia A: hoja clara sobre fondo más oscuro (componente conexa más grande).
    // If the page and a bright background merge, the mask covers the whole frame: retry stricter.
    val baseBright = max(otsuThresh, borderMean + 16).coerceIn(70, 230)
    for (extra in intArrayOf(0, 22, 44)) {
      val threshold = (baseBright + extra).coerceAtMost(245)
      val brightQuad = extractLargestMaskQuad(smooth, w, h) { lum -> lum >= threshold }
      if (brightQuad != null && !(coversWholeFrame(brightQuad) && borderMean > 120)) {
        return Pair(brightQuad, true)
      }
    }

    // Estrategia B: hoja oscura sobre fondo claro
    if (borderMean > 150) {
      val baseDark = min(otsuThresh, borderMean - 18).coerceIn(25, 200)
      for (extra in intArrayOf(0, 22)) {
        val threshold = (baseDark - extra).coerceAtLeast(15)
        val darkQuad = extractLargestMaskQuad(smooth, w, h) { lum -> lum <= threshold }
        if (darkQuad != null && !coversWholeFrame(darkQuad)) {
          return Pair(darkQuad, true)
        }
      }
    }

    // Estrategia C: detección por gradiente Sobel de bordes fuertes
    val edgeQuad = extractSobelQuad(smooth, w, h)
    if (edgeQuad != null) {
      return Pair(edgeQuad, true)
    }

    return Pair(defaultCorners, false)
  }

  private fun coversWholeFrame(quad: List<Pair<Float, Float>>): Boolean {
    if (quad.size != 4) return false
    val nearTL = quad[0].first < 0.05f && quad[0].second < 0.05f
    val nearTR = quad[1].first > 0.95f && quad[1].second < 0.05f
    val nearBR = quad[2].first > 0.95f && quad[2].second > 0.95f
    val nearBL = quad[3].first < 0.05f && quad[3].second > 0.95f
    return nearTL && nearTR && nearBR && nearBL
  }

  private fun extractLargestMaskQuad(
    smooth: IntArray,
    w: Int,
    h: Int,
    predicate: (Int) -> Boolean
  ): List<Pair<Float, Float>>? {
    val visited = BooleanArray(w * h)
    val queue = IntArray(w * h)
    var bestCount = 0
    var bestTL = Pair(w, h)
    var bestTR = Pair(0, h)
    var bestBR = Pair(0, 0)
    var bestBL = Pair(w, 0)

    val minArea = (w * h * 0.12f).toInt()
    val maxArea = (w * h * 0.96f).toInt()

    for (startY in 2 until h - 2 step 2) {
      for (startX in 2 until w - 2 step 2) {
        val startIdx = startY * w + startX
        if (visited[startIdx] || !predicate(smooth[startIdx])) continue

        var head = 0
        var tail = 0
        queue[tail++] = startIdx
        visited[startIdx] = true

        var count = 0
        var minSum = Int.MAX_VALUE
        var maxSum = Int.MIN_VALUE
        var maxDiff = Int.MIN_VALUE
        var minDiff = Int.MAX_VALUE
        var tlX = startX; var tlY = startY
        var trX = startX; var trY = startY
        var brX = startX; var brY = startY
        var blX = startX; var blY = startY

        while (head < tail) {
          val cur = queue[head++]
          val cx = cur % w
          val cy = cur / w
          count++

          val s = cx + cy
          val d = cx - cy
          if (s < minSum) { minSum = s; tlX = cx; tlY = cy }
          if (s > maxSum) { maxSum = s; brX = cx; brY = cy }
          if (d > maxDiff) { maxDiff = d; trX = cx; trY = cy }
          if (d < minDiff) { minDiff = d; blX = cx; blY = cy }

          if (cx > 1) {
            val ni = cur - 1
            if (!visited[ni] && predicate(smooth[ni])) { visited[ni] = true; queue[tail++] = ni }
          }
          if (cx < w - 2) {
            val ni = cur + 1
            if (!visited[ni] && predicate(smooth[ni])) { visited[ni] = true; queue[tail++] = ni }
          }
          if (cy > 1) {
            val ni = cur - w
            if (!visited[ni] && predicate(smooth[ni])) { visited[ni] = true; queue[tail++] = ni }
          }
          if (cy < h - 2) {
            val ni = cur + w
            if (!visited[ni] && predicate(smooth[ni])) { visited[ni] = true; queue[tail++] = ni }
          }
        }

        if (count in minArea..maxArea && count > bestCount) {
          bestCount = count
          bestTL = Pair(tlX, tlY)
          bestTR = Pair(trX, trY)
          bestBR = Pair(brX, brY)
          bestBL = Pair(blX, blY)
        }
      }
    }

    if (bestCount == 0) return null

    val quad = listOf(
      Pair(bestTL.first.toFloat() / w, bestTL.second.toFloat() / h),
      Pair(bestTR.first.toFloat() / w, bestTR.second.toFloat() / h),
      Pair(bestBR.first.toFloat() / w, bestBR.second.toFloat() / h),
      Pair(bestBL.first.toFloat() / w, bestBL.second.toFloat() / h)
    )
    return if (isValidConvexQuad(quad)) quad else null
  }

  private fun extractSobelQuad(smooth: IntArray, w: Int, h: Int): List<Pair<Float, Float>>? {
    val mag = IntArray(w * h)
    var maxMag = 0
    for (y in 2 until h - 2) {
      val row = y * w
      for (x in 2 until w - 2) {
        val i = row + x
        val gx = -smooth[i - w - 1] + smooth[i - w + 1] -
          2 * smooth[i - 1] + 2 * smooth[i + 1] -
          smooth[i + w - 1] + smooth[i + w + 1]
        val gy = -smooth[i - w - 1] - 2 * smooth[i - w] - smooth[i - w + 1] +
          smooth[i + w - 1] + 2 * smooth[i + w] + smooth[i + w + 1]
        val g = abs(gx) + abs(gy)
        mag[i] = g
        if (g > maxMag) maxMag = g
      }
    }
    if (maxMag < 60) return null
    val threshold = max(65, (maxMag * 0.24f).toInt())

    val padX = max(3, (w * 0.02f).toInt())
    val padY = max(3, (h * 0.02f).toInt())

    val isEdge = BooleanArray(w * h)
    var totalEdges = 0
    for (y in padY until h - padY) {
      val row = y * w
      for (x in padX until w - padX) {
        if (mag[row + x] >= threshold) {
          isEdge[row + x] = true
          totalEdges++
        }
      }
    }
    if (totalEdges < 80) return null

    // The page border is one connected loop; text strokes are small separate components.
    val visited = BooleanArray(w * h)
    val queue = IntArray(w * h)
    var bestCount = 0
    var bestTL = Pair(0, 0)
    var bestTR = Pair(0, 0)
    var bestBR = Pair(0, 0)
    var bestBL = Pair(0, 0)

    for (startY in padY until h - padY) {
      val row = startY * w
      for (startX in padX until w - padX) {
        val startIdx = row + startX
        if (visited[startIdx] || !isEdge[startIdx]) continue

        var head = 0
        var tail = 0
        queue[tail++] = startIdx
        visited[startIdx] = true

        var count = 0
        var minSum = Int.MAX_VALUE
        var maxSum = Int.MIN_VALUE
        var maxDiff = Int.MIN_VALUE
        var minDiff = Int.MAX_VALUE
        var tlX = startX; var tlY = startY
        var trX = startX; var trY = startY
        var brX = startX; var brY = startY
        var blX = startX; var blY = startY

        while (head < tail) {
          val cur = queue[head++]
          val cx = cur % w
          val cy = cur / w
          count++

          val s = cx + cy
          val d = cx - cy
          if (s < minSum) { minSum = s; tlX = cx; tlY = cy }
          if (s > maxSum) { maxSum = s; brX = cx; brY = cy }
          if (d > maxDiff) { maxDiff = d; trX = cx; trY = cy }
          if (d < minDiff) { minDiff = d; blX = cx; blY = cy }

          if (cx > padX) {
            val ni = cur - 1
            if (!visited[ni] && isEdge[ni]) { visited[ni] = true; queue[tail++] = ni }
          }
          if (cx < w - padX - 1) {
            val ni = cur + 1
            if (!visited[ni] && isEdge[ni]) { visited[ni] = true; queue[tail++] = ni }
          }
          if (cy > padY) {
            val ni = cur - w
            if (!visited[ni] && isEdge[ni]) { visited[ni] = true; queue[tail++] = ni }
          }
          if (cy < h - padY - 1) {
            val ni = cur + w
            if (!visited[ni] && isEdge[ni]) { visited[ni] = true; queue[tail++] = ni }
          }
        }

        if (count > bestCount) {
          bestCount = count
          bestTL = Pair(tlX, tlY)
          bestTR = Pair(trX, trY)
          bestBR = Pair(brX, brY)
          bestBL = Pair(blX, blY)
        }
      }
    }

    // If the border loop is fragmented, fall back to all strong edges.
    if (bestCount < max(80, (totalEdges * 0.6f).toInt())) {
      var minSum = Int.MAX_VALUE
      var maxSum = Int.MIN_VALUE
      var maxDiff = Int.MIN_VALUE
      var minDiff = Int.MAX_VALUE
      var tlX = 0; var tlY = 0
      var trX = 0; var trY = 0
      var brX = 0; var brY = 0
      var blX = 0; var blY = 0

      for (y in padY until h - padY) {
        val row = y * w
        for (x in padX until w - padX) {
          if (!isEdge[row + x]) continue
          val s = x + y
          val d = x - y
          if (s < minSum) { minSum = s; tlX = x; tlY = y }
          if (s > maxSum) { maxSum = s; brX = x; brY = y }
          if (d > maxDiff) { maxDiff = d; trX = x; trY = y }
          if (d < minDiff) { minDiff = d; blX = x; blY = y }
        }
      }
      bestTL = Pair(tlX, tlY)
      bestTR = Pair(trX, trY)
      bestBR = Pair(brX, brY)
      bestBL = Pair(blX, blY)
    }

    val quad = listOf(
      Pair(bestTL.first.toFloat() / w, bestTL.second.toFloat() / h),
      Pair(bestTR.first.toFloat() / w, bestTR.second.toFloat() / h),
      Pair(bestBR.first.toFloat() / w, bestBR.second.toFloat() / h),
      Pair(bestBL.first.toFloat() / w, bestBL.second.toFloat() / h)
    )
    return if (isValidConvexQuad(quad)) quad else null
  }

  private fun isValidConvexQuad(pts: List<Pair<Float, Float>>): Boolean {
    if (pts.size != 4) return false
    var area2 = 0f
    for (i in 0 until 4) {
      val a = pts[i]
      val b = pts[(i + 1) % 4]
      val c = pts[(i + 2) % 4]
      val cross = (b.first - a.first) * (c.second - b.second) -
        (b.second - a.second) * (c.first - b.first)
      if (cross <= 0.0005f) return false
      area2 += a.first * b.second - b.first * a.second
    }
    val area = abs(area2) * 0.5f
    if (area < 0.14f || area > 0.95f) return false

    val topW = hypot((pts[1].first - pts[0].first).toDouble(), (pts[1].second - pts[0].second).toDouble())
    val bottomW = hypot((pts[2].first - pts[3].first).toDouble(), (pts[2].second - pts[3].second).toDouble())
    val leftH = hypot((pts[3].first - pts[0].first).toDouble(), (pts[3].second - pts[0].second).toDouble())
    val rightH = hypot((pts[2].first - pts[1].first).toDouble(), (pts[2].second - pts[1].second).toDouble())

    return min(topW, bottomW) >= 0.20 && min(leftH, rightH) >= 0.20
  }

  private fun applyDocumentFilter(src: Bitmap, filter: String): Bitmap {
    val out = Bitmap.createBitmap(src.width, src.height, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(out)
    val cm = ColorMatrix()

    when (filter) {
      "document" -> {
        val sat = ColorMatrix().apply { setSaturation(0.88f) }
        val contrast = 1.22f
        val translate = (-0.5f * contrast + 0.5f) * 255f + 12f
        val tone = ColorMatrix(
          floatArrayOf(
            contrast, 0f, 0f, 0f, translate,
            0f, contrast, 0f, 0f, translate,
            0f, 0f, contrast, 0f, translate,
            0f, 0f, 0f, 1f, 0f
          )
        )
        cm.postConcat(sat)
        cm.postConcat(tone)
      }
      "grayscale" -> {
        val sat = ColorMatrix().apply { setSaturation(0f) }
        val contrast = 1.28f
        val translate = (-0.5f * contrast + 0.5f) * 255f + 10f
        val tone = ColorMatrix(
          floatArrayOf(
            contrast, 0f, 0f, 0f, translate,
            0f, contrast, 0f, 0f, translate,
            0f, 0f, contrast, 0f, translate,
            0f, 0f, 0f, 1f, 0f
          )
        )
        cm.postConcat(sat)
        cm.postConcat(tone)
      }
      "bw" -> {
        val sat = ColorMatrix().apply { setSaturation(0f) }
        val contrast = 2.6f
        val translate = (-0.5f * contrast + 0.5f) * 255f + 22f
        val tone = ColorMatrix(
          floatArrayOf(
            contrast, 0f, 0f, 0f, translate,
            0f, contrast, 0f, 0f, translate,
            0f, 0f, contrast, 0f, translate,
            0f, 0f, 0f, 1f, 0f
          )
        )
        cm.postConcat(sat)
        cm.postConcat(tone)
      }
    }

    val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG).apply {
      colorFilter = ColorMatrixColorFilter(cm)
    }
    canvas.drawBitmap(src, 0f, 0f, paint)
    return out
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

  private fun decodeNormalizedBitmap(context: Context, uriStr: String, maxDim: Int = MAX_IMAGE_DIM): Bitmap? {
    val uri = parseUri(uriStr)
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }

    if (uri.scheme == "content") {
      context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
    } else {
      BitmapFactory.decodeFile(uri.path, bounds)
    }

    var sampleSize = 1
    while (bounds.outWidth / sampleSize > maxDim || bounds.outHeight / sampleSize > maxDim) {
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
