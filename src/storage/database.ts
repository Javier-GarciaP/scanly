import * as SQLite from 'expo-sqlite';
import { Directory, File, Paths } from 'expo-file-system';
import type {
  DocumentDetail,
  DocumentRecord,
  Folder,
  PageRecord,
  PageSignaturePlacement,
  SignatureRecord,
} from '../types/models';

let dbInstance: SQLite.SQLiteDatabase | null = null;

function generateId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now()}_${rand}`;
}

export function getDb(): SQLite.SQLiteDatabase {
  if (!dbInstance) {
    dbInstance = SQLite.openDatabaseSync('scanly.db');
  }
  return dbInstance;
}

export function ensureAppDirs(): {
  pagesDir: Directory;
  pdfsDir: Directory;
  signaturesDir: Directory;
} {
  const pagesDir = new Directory(Paths.document, 'scanly_pages');
  const pdfsDir = new Directory(Paths.document, 'scanly_pdfs');
  const signaturesDir = new Directory(Paths.document, 'scanly_signatures');

  pagesDir.create({ idempotent: true, intermediates: true });
  pdfsDir.create({ idempotent: true, intermediates: true });
  signaturesDir.create({ idempotent: true, intermediates: true });

  return { pagesDir, pdfsDir, signaturesDir };
}

export function copyImageToPermanentStorage(sourceUri: string): string {
  const { pagesDir } = ensureAppDirs();
  const destFile = new File(pagesDir, `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`);
  const srcFile = new File(sourceUri);
  srcFile.copy(destFile);
  return destFile.uri;
}

export function getPdfOutputPath(docId: string, title: string): string {
  const { pdfsDir } = ensureAppDirs();
  const safe = title
    .trim()
    .replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ._\- ]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 48) || 'documento';
  const file = new File(pdfsDir, `${safe}_${docId.slice(-6)}.pdf`);
  return file.uri;
}

export function getSignatureOutputPath(): string {
  const { signaturesDir } = ensureAppDirs();
  const file = new File(signaturesDir, `sig_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.png`);
  return file.uri;
}

function safeDeleteFile(uri: string | null | undefined): void {
  if (!uri) return;
  try {
    const f = new File(uri);
    if (f.exists) {
      f.delete();
    }
  } catch {
    // Ignore file cleanup errors
  }
}

export function initDatabase(): void {
  ensureAppDirs();
  const db = getDb();

  db.execSync(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS folders (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      folder_id TEXT NULL,
      pdf_uri TEXT NULL,
      is_password_protected INTEGER NOT NULL DEFAULT 0,
      ocr_text TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS pages (
      id TEXT PRIMARY KEY NOT NULL,
      document_id TEXT NOT NULL,
      image_uri TEXT NOT NULL,
      page_order INTEGER NOT NULL,
      ocr_text TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS signatures (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      image_uri TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS page_signatures (
      id TEXT PRIMARY KEY NOT NULL,
      page_id TEXT NOT NULL,
      signature_id TEXT NOT NULL,
      image_uri TEXT NOT NULL,
      x_ratio REAL NOT NULL,
      y_ratio REAL NOT NULL,
      width_ratio REAL NOT NULL,
      FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE
    );
  `);

  const countRow = db.getFirstSync<{ count: number }>('SELECT COUNT(*) as count FROM folders');
  if ((countRow?.count ?? 0) === 0) {
    const now = Date.now();
    const defaults = [
      { id: 'folder_personal', name: 'Personal', color: '#2563EB' },
      { id: 'folder_trabajo', name: 'Trabajo', color: '#059669' },
      { id: 'folder_facturas', name: 'Facturas', color: '#D97706' },
    ];
    for (const f of defaults) {
      db.runSync(
        'INSERT OR IGNORE INTO folders (id, name, color, created_at) VALUES (?, ?, ?, ?)',
        [f.id, f.name, f.color, now]
      );
    }
  }
}

export function getFolders(): Folder[] {
  const db = getDb();
  const rows = db.getAllSync<{
    id: string;
    name: string;
    color: string;
    created_at: number;
    doc_count: number;
  }>(`
    SELECT f.id, f.name, f.color, f.created_at, COUNT(d.id) as doc_count
    FROM folders f
    LEFT JOIN documents d ON d.folder_id = f.id
    GROUP BY f.id
    ORDER BY f.created_at ASC
  `);

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    color: r.color,
    createdAt: r.created_at,
    documentCount: r.doc_count,
  }));
}

export function createFolder(name: string, color: string): Folder {
  const db = getDb();
  const id = generateId('fld');
  const now = Date.now();
  const trimmed = name.trim();
  db.runSync('INSERT INTO folders (id, name, color, created_at) VALUES (?, ?, ?, ?)', [
    id,
    trimmed,
    color,
    now,
  ]);
  return { id, name: trimmed, color, createdAt: now, documentCount: 0 };
}

export function updateFolder(id: string, name: string, color: string): void {
  const db = getDb();
  db.runSync('UPDATE folders SET name = ?, color = ? WHERE id = ?', [name.trim(), color, id]);
}

export function deleteFolder(id: string): void {
  const db = getDb();
  db.runSync('UPDATE documents SET folder_id = NULL WHERE folder_id = ?', [id]);
  db.runSync('DELETE FROM folders WHERE id = ?', [id]);
}

export function getDocuments(options?: {
  folderFilter?: 'ALL' | 'SIGNED' | 'PROTECTED' | 'UNASSIGNED' | string;
  searchQuery?: string;
}): DocumentRecord[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (options?.folderFilter && options.folderFilter !== 'ALL') {
    if (options.folderFilter === 'UNASSIGNED') {
      conditions.push('d.folder_id IS NULL');
    } else if (options.folderFilter === 'PROTECTED') {
      conditions.push('d.is_password_protected = 1');
    } else if (options.folderFilter === 'SIGNED') {
      conditions.push(
        'EXISTS (SELECT 1 FROM page_signatures ps INNER JOIN pages p ON p.id = ps.page_id WHERE p.document_id = d.id)'
      );
    } else {
      conditions.push('d.folder_id = ?');
      params.push(options.folderFilter);
    }
  }

  const query = options?.searchQuery?.trim();
  if (query) {
    conditions.push('(LOWER(d.title) LIKE ? OR LOWER(d.ocr_text) LIKE ?)');
    const pattern = `%${query.toLowerCase()}%`;
    params.push(pattern, pattern);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = db.getAllSync<{
    id: string;
    title: string;
    folder_id: string | null;
    pdf_uri: string | null;
    is_password_protected: number;
    ocr_text: string;
    created_at: number;
    updated_at: number;
    page_count: number;
    signature_count: number;
    cover_uri: string | null;
    folder_name: string | null;
    folder_color: string | null;
  }>(
    `
    SELECT
      d.id,
      d.title,
      d.folder_id,
      d.pdf_uri,
      d.is_password_protected,
      d.ocr_text,
      d.created_at,
      d.updated_at,
      f.name AS folder_name,
      f.color AS folder_color,
      (SELECT COUNT(*) FROM pages p WHERE p.document_id = d.id) AS page_count,
      (SELECT COUNT(*) FROM page_signatures ps INNER JOIN pages p ON p.id = ps.page_id WHERE p.document_id = d.id) AS signature_count,
      (SELECT p.image_uri FROM pages p WHERE p.document_id = d.id ORDER BY p.page_order ASC LIMIT 1) AS cover_uri
    FROM documents d
    LEFT JOIN folders f ON f.id = d.folder_id
    ${whereClause}
    ORDER BY d.updated_at DESC
    `,
    params
  );

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    folderId: r.folder_id,
    pdfUri: r.pdf_uri,
    isPasswordProtected: r.is_password_protected === 1,
    ocrText: r.ocr_text,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    pageCount: r.page_count,
    signatureCount: r.signature_count,
    coverUri: r.cover_uri,
    folderName: r.folder_name,
    folderColor: r.folder_color,
  }));
}

export function getDocumentDetail(documentId: string): DocumentDetail | null {
  const db = getDb();
  const docRow = db.getFirstSync<{
    id: string;
    title: string;
    folder_id: string | null;
    pdf_uri: string | null;
    is_password_protected: number;
    ocr_text: string;
    created_at: number;
    updated_at: number;
    folder_name: string | null;
    folder_color: string | null;
  }>(
    `
    SELECT
      d.id, d.title, d.folder_id, d.pdf_uri, d.is_password_protected, d.ocr_text,
      d.created_at, d.updated_at, f.name AS folder_name, f.color AS folder_color
    FROM documents d
    LEFT JOIN folders f ON f.id = d.folder_id
    WHERE d.id = ?
    `,
    [documentId]
  );

  if (!docRow) return null;

  const pageRows = db.getAllSync<{
    id: string;
    document_id: string;
    image_uri: string;
    page_order: number;
    ocr_text: string;
    created_at: number;
  }>(
    `
    SELECT id, document_id, image_uri, page_order, ocr_text, created_at
    FROM pages
    WHERE document_id = ?
    ORDER BY page_order ASC
    `,
    [documentId]
  );

  const pages: PageRecord[] = pageRows.map((p) => {
    const sigRows = db.getAllSync<{
      id: string;
      page_id: string;
      signature_id: string;
      image_uri: string;
      x_ratio: number;
      y_ratio: number;
      width_ratio: number;
    }>(
      'SELECT id, page_id, signature_id, image_uri, x_ratio, y_ratio, width_ratio FROM page_signatures WHERE page_id = ?',
      [p.id]
    );

    const signatures: PageSignaturePlacement[] = sigRows.map((s) => ({
      id: s.id,
      pageId: s.page_id,
      signatureId: s.signature_id,
      imageUri: s.image_uri,
      xRatio: s.x_ratio,
      yRatio: s.y_ratio,
      widthRatio: s.width_ratio,
    }));

    return {
      id: p.id,
      documentId: p.document_id,
      imageUri: p.image_uri,
      pageOrder: p.page_order,
      ocrText: p.ocr_text,
      createdAt: p.created_at,
      signatures,
    };
  });

  const totalSignatures = pages.reduce((sum, p) => sum + p.signatures.length, 0);

  return {
    id: docRow.id,
    title: docRow.title,
    folderId: docRow.folder_id,
    pdfUri: docRow.pdf_uri,
    isPasswordProtected: docRow.is_password_protected === 1,
    ocrText: docRow.ocr_text,
    createdAt: docRow.created_at,
    updatedAt: docRow.updated_at,
    pageCount: pages.length,
    signatureCount: totalSignatures,
    coverUri: pages[0]?.imageUri ?? null,
    folderName: docRow.folder_name,
    folderColor: docRow.folder_color,
    pages,
  };
}

export function formatDefaultDocTitle(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `Escaneo ${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

export function createDocument(
  title: string,
  pageUris: string[],
  folderId: string | null = null
): string {
  const db = getDb();
  const docId = generateId('doc');
  const now = Date.now();
  const cleanTitle = title.trim() || formatDefaultDocTitle();

  db.runSync(
    `INSERT INTO documents (id, title, folder_id, pdf_uri, is_password_protected, ocr_text, created_at, updated_at)
     VALUES (?, ?, ?, NULL, 0, '', ?, ?)`,
    [docId, cleanTitle, folderId, now, now]
  );

  pageUris.forEach((uri, idx) => {
    const pageId = generateId('pg');
    db.runSync(
      `INSERT INTO pages (id, document_id, image_uri, page_order, ocr_text, created_at)
       VALUES (?, ?, ?, ?, '', ?)`,
      [pageId, docId, uri, idx, now]
    );
  });

  return docId;
}

export function renameDocument(documentId: string, newTitle: string): void {
  const db = getDb();
  db.runSync('UPDATE documents SET title = ?, updated_at = ? WHERE id = ?', [
    newTitle.trim(),
    Date.now(),
    documentId,
  ]);
}

export function moveDocumentToFolder(documentId: string, folderId: string | null): void {
  const db = getDb();
  db.runSync('UPDATE documents SET folder_id = ?, updated_at = ? WHERE id = ?', [
    folderId,
    Date.now(),
    documentId,
  ]);
}

export function updateDocumentPdf(
  documentId: string,
  pdfUri: string,
  isPasswordProtected: boolean
): void {
  const db = getDb();
  db.runSync(
    'UPDATE documents SET pdf_uri = ?, is_password_protected = ?, updated_at = ? WHERE id = ?',
    [pdfUri, isPasswordProtected ? 1 : 0, Date.now(), documentId]
  );
}

export function addPagesToDocument(documentId: string, pageUris: string[]): void {
  const db = getDb();
  const maxOrderRow = db.getFirstSync<{ max_order: number | null }>(
    'SELECT MAX(page_order) as max_order FROM pages WHERE document_id = ?',
    [documentId]
  );
  let nextOrder = (maxOrderRow?.max_order ?? -1) + 1;
  const now = Date.now();

  for (const uri of pageUris) {
    db.runSync(
      `INSERT INTO pages (id, document_id, image_uri, page_order, ocr_text, created_at)
       VALUES (?, ?, ?, ?, '', ?)`,
      [generateId('pg'), documentId, uri, nextOrder++, now]
    );
  }

  db.runSync('UPDATE documents SET updated_at = ? WHERE id = ?', [now, documentId]);
}

export function deletePage(documentId: string, pageId: string): void {
  const db = getDb();
  const page = db.getFirstSync<{ image_uri: string }>(
    'SELECT image_uri FROM pages WHERE id = ?',
    [pageId]
  );
  db.runSync('DELETE FROM pages WHERE id = ?', [pageId]);
  safeDeleteFile(page?.image_uri);

  const remaining = db.getAllSync<{ id: string }>(
    'SELECT id FROM pages WHERE document_id = ? ORDER BY page_order ASC',
    [documentId]
  );
  remaining.forEach((p, idx) => {
    db.runSync('UPDATE pages SET page_order = ? WHERE id = ?', [idx, p.id]);
  });

  refreshDocumentOcrText(documentId);
  db.runSync('UPDATE documents SET updated_at = ? WHERE id = ?', [Date.now(), documentId]);
}

export function reorderPages(documentId: string, orderedPageIds: string[]): void {
  const db = getDb();
  orderedPageIds.forEach((id, idx) => {
    db.runSync('UPDATE pages SET page_order = ? WHERE id = ? AND document_id = ?', [
      idx,
      id,
      documentId,
    ]);
  });
  refreshDocumentOcrText(documentId);
  db.runSync('UPDATE documents SET updated_at = ? WHERE id = ?', [Date.now(), documentId]);
}

export function updatePageOcr(documentId: string, pageId: string, ocrText: string): void {
  const db = getDb();
  db.runSync('UPDATE pages SET ocr_text = ? WHERE id = ?', [ocrText, pageId]);
  refreshDocumentOcrText(documentId);
  db.runSync('UPDATE documents SET updated_at = ? WHERE id = ?', [Date.now(), documentId]);
}

function refreshDocumentOcrText(documentId: string): void {
  const db = getDb();
  const rows = db.getAllSync<{ ocr_text: string }>(
    'SELECT ocr_text FROM pages WHERE document_id = ? ORDER BY page_order ASC',
    [documentId]
  );
  const combined = rows
    .map((r) => r.ocr_text.trim())
    .filter(Boolean)
    .join('\n\n');
  db.runSync('UPDATE documents SET ocr_text = ? WHERE id = ?', [combined, documentId]);
}

export function deleteDocument(documentId: string): void {
  const db = getDb();
  const doc = db.getFirstSync<{ pdf_uri: string | null }>(
    'SELECT pdf_uri FROM documents WHERE id = ?',
    [documentId]
  );
  const pages = db.getAllSync<{ image_uri: string }>(
    'SELECT image_uri FROM pages WHERE document_id = ?',
    [documentId]
  );

  db.runSync('DELETE FROM documents WHERE id = ?', [documentId]);

  safeDeleteFile(doc?.pdf_uri);
  pages.forEach((p) => safeDeleteFile(p.image_uri));
}

// --- Signatures ---

export function getSignatures(): SignatureRecord[] {
  const db = getDb();
  const rows = db.getAllSync<{
    id: string;
    name: string;
    image_uri: string;
    created_at: number;
  }>('SELECT id, name, image_uri, created_at FROM signatures ORDER BY created_at DESC');

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    imageUri: r.image_uri,
    createdAt: r.created_at,
  }));
}

export function saveSignatureRecord(name: string, imageUri: string): SignatureRecord {
  const db = getDb();
  const id = generateId('sig');
  const now = Date.now();
  const cleanName = name.trim() || `Firma ${new Date().toLocaleDateString()}`;
  db.runSync(
    'INSERT INTO signatures (id, name, image_uri, created_at) VALUES (?, ?, ?, ?)',
    [id, cleanName, imageUri, now]
  );
  return { id, name: cleanName, imageUri, createdAt: now };
}

export function deleteSignatureRecord(signatureId: string): void {
  const db = getDb();
  const row = db.getFirstSync<{ image_uri: string }>(
    'SELECT image_uri FROM signatures WHERE id = ?',
    [signatureId]
  );
  db.runSync('DELETE FROM page_signatures WHERE signature_id = ?', [signatureId]);
  db.runSync('DELETE FROM signatures WHERE id = ?', [signatureId]);
  safeDeleteFile(row?.image_uri);
}

export function addSignatureToPage(params: {
  documentId: string;
  pageId: string;
  signatureId: string;
  imageUri: string;
  xRatio: number;
  yRatio: number;
  widthRatio: number;
}): PageSignaturePlacement {
  const db = getDb();
  const id = generateId('psig');
  db.runSync(
    `INSERT INTO page_signatures (id, page_id, signature_id, image_uri, x_ratio, y_ratio, width_ratio)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      params.pageId,
      params.signatureId,
      params.imageUri,
      params.xRatio,
      params.yRatio,
      params.widthRatio,
    ]
  );
  db.runSync('UPDATE documents SET updated_at = ? WHERE id = ?', [Date.now(), params.documentId]);
  return {
    id,
    pageId: params.pageId,
    signatureId: params.signatureId,
    imageUri: params.imageUri,
    xRatio: params.xRatio,
    yRatio: params.yRatio,
    widthRatio: params.widthRatio,
  };
}

export function updatePageSignature(params: {
  documentId: string;
  placementId: string;
  xRatio: number;
  yRatio: number;
  widthRatio: number;
}): void {
  const db = getDb();
  db.runSync(
    'UPDATE page_signatures SET x_ratio = ?, y_ratio = ?, width_ratio = ? WHERE id = ?',
    [params.xRatio, params.yRatio, params.widthRatio, params.placementId]
  );
  db.runSync('UPDATE documents SET updated_at = ? WHERE id = ?', [Date.now(), params.documentId]);
}

export function deletePageSignature(documentId: string, placementId: string): void {
  const db = getDb();
  db.runSync('DELETE FROM page_signatures WHERE id = ?', [placementId]);
  db.runSync('UPDATE documents SET updated_at = ? WHERE id = ?', [Date.now(), documentId]);
}

export function clearPageSignatures(documentId: string, pageId: string): void {
  const db = getDb();
  db.runSync('DELETE FROM page_signatures WHERE page_id = ?', [pageId]);
  db.runSync('UPDATE documents SET updated_at = ? WHERE id = ?', [Date.now(), documentId]);
}
