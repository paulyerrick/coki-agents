/**
 * Google Drive tool — Google Drive API v3, Docs API v1, Sheets API v4.
 *
 * Uses the Google OAuth access token obtained via the Nylas integration.
 * The token is stored as `provider_access_token` in the nylas_email credentials
 * after a successful Google OAuth flow.
 */

import type { Tool } from '@coki/shared';
import { ok, err } from './types';
import type { ToolOutcome } from './types';

// ─── Tool definitions (LLM-facing) ────────────────────────────────────────────

export const googleDriveTools: Tool[] = [
  {
    name: 'list_drive_files',
    description: 'List files in the user\'s Google Drive. Optionally search by name or filter to a specific folder.',
    input_schema: {
      type: 'object',
      properties: {
        query:     { type: 'string', description: 'Search term to filter files by name' },
        folder_id: { type: 'string', description: 'Folder ID to list files in. Use "root" for My Drive root.' },
      },
    },
  },
  {
    name: 'read_drive_file',
    description: 'Read the contents of a Google Drive file. Exports Google Docs as plain text and Sheets as CSV.',
    input_schema: {
      type: 'object',
      properties: {
        file_id: { type: 'string', description: 'Google Drive file ID' },
      },
      required: ['file_id'],
    },
  },
  {
    name: 'create_drive_file',
    description: 'Create a new file in Google Drive. Defaults to a Google Doc. Supports Google Docs, Sheets, and plain text.',
    input_schema: {
      type: 'object',
      properties: {
        name:      { type: 'string', description: 'File name' },
        content:   { type: 'string', description: 'Initial file content' },
        mime_type: {
          type: 'string',
          description: 'MIME type: "application/vnd.google-apps.document" (Google Doc, default), "application/vnd.google-apps.spreadsheet" (Google Sheet), or "text/plain"',
        },
        folder_id: { type: 'string', description: 'Optional parent folder ID' },
      },
      required: ['name', 'content'],
    },
  },
  {
    name: 'update_drive_file',
    description: 'Replace the content of an existing Google Drive file.',
    input_schema: {
      type: 'object',
      properties: {
        file_id: { type: 'string', description: 'Google Drive file ID' },
        content: { type: 'string', description: 'New file content' },
      },
      required: ['file_id', 'content'],
    },
  },
  {
    name: 'create_drive_folder',
    description: 'Create a new folder in Google Drive.',
    input_schema: {
      type: 'object',
      properties: {
        name:      { type: 'string', description: 'Folder name' },
        parent_id: { type: 'string', description: 'Optional parent folder ID' },
      },
      required: ['name'],
    },
  },
  {
    name: 'share_drive_file',
    description: 'Share a Google Drive file or folder with another user.',
    input_schema: {
      type: 'object',
      properties: {
        file_id: { type: 'string', description: 'Google Drive file ID' },
        email:   { type: 'string', description: 'Email address of the person to share with' },
        role:    { type: 'string', description: 'Permission role: "reader" (default), "writer", or "owner"' },
      },
      required: ['file_id', 'email'],
    },
  },
];

// ─── Internal types ───────────────────────────────────────────────────────────

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  webViewLink?: string;
}

interface DriveListResponse {
  files: DriveFile[];
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

const DRIVE_BASE  = 'https://www.googleapis.com/drive/v3';
const DOCS_BASE   = 'https://docs.googleapis.com/v1';
const SHEETS_BASE = 'https://sheets.googleapis.com/v4';

function authHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
}

async function driveGet<T>(
  accessToken: string,
  path: string,
  params?: Record<string, string>,
): Promise<T> {
  const url = new URL(`${DRIVE_BASE}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Drive GET ${path}: ${res.status} ${await res.text().catch(() => '')}`);
  }
  return res.json() as Promise<T>;
}

async function drivePost<T>(
  accessToken: string,
  path: string,
  body: unknown,
): Promise<T> {
  const res = await fetch(`${DRIVE_BASE}${path}`, {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Drive POST ${path}: ${res.status} ${await res.text().catch(() => '')}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Multipart upload — the format required by the Drive upload API to send both
 * file metadata and content in a single request.
 */
async function driveMultipartCreate(
  accessToken: string,
  metadata: Record<string, unknown>,
  contentType: string,
  content: string,
): Promise<DriveFile> {
  const boundary = `coki_bnd_${Date.now()}`;
  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    `Content-Type: ${contentType}`,
    '',
    content,
    `--${boundary}--`,
  ].join('\r\n');

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,webViewLink',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );
  if (!res.ok) {
    throw new Error(`Drive multipart upload: ${res.status} ${await res.text().catch(() => '')}`);
  }
  return res.json() as Promise<DriveFile>;
}

// ─── Tool implementations ─────────────────────────────────────────────────────

/**
 * List files in Google Drive, optionally filtered by search term or folder.
 *
 * @param accessToken  Google OAuth access token.
 * @param query        Optional search term (matches file name).
 * @param folderId     Optional folder ID to restrict the listing to.
 */
export async function listDriveFiles(
  accessToken: string,
  query?: string,
  folderId?: string,
): Promise<ToolOutcome<DriveFile[]>> {
  try {
    const qParts: string[] = ['trashed=false'];
    if (folderId) qParts.push(`'${folderId}' in parents`);
    if (query)    qParts.push(`name contains '${query.replace(/'/g, "\\'")}'`);

    const data = await driveGet<DriveListResponse>(accessToken, '/files', {
      q:       qParts.join(' and '),
      fields:  'files(id,name,mimeType,size,modifiedTime,webViewLink)',
      pageSize: '50',
      orderBy: 'modifiedTime desc',
    });
    return ok(data.files);
  } catch (e) {
    return err((e as Error).message, 'DRIVE_ERROR');
  }
}

/**
 * Read the contents of a Google Drive file.
 * Google Docs are exported as plain text; Sheets as CSV; other files as raw text.
 *
 * @param accessToken  Google OAuth access token.
 * @param fileId       Google Drive file ID.
 */
export async function readDriveFile(
  accessToken: string,
  fileId: string,
): Promise<ToolOutcome<{ id: string; name: string; mimeType: string; content: string }>> {
  try {
    const meta = await driveGet<DriveFile>(accessToken, `/files/${fileId}`, {
      fields: 'id,name,mimeType',
    });

    const GOOGLE_NATIVE = [
      'application/vnd.google-apps.document',
      'application/vnd.google-apps.spreadsheet',
      'application/vnd.google-apps.presentation',
    ];

    let content: string;
    if (GOOGLE_NATIVE.includes(meta.mimeType)) {
      const exportMime = meta.mimeType === 'application/vnd.google-apps.spreadsheet'
        ? 'text/csv'
        : 'text/plain';
      const url = new URL(`${DRIVE_BASE}/files/${fileId}/export`);
      url.searchParams.set('mimeType', exportMime);
      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) throw new Error(`Export failed: ${res.status} ${await res.text().catch(() => '')}`);
      content = await res.text();
    } else {
      const url = new URL(`${DRIVE_BASE}/files/${fileId}`);
      url.searchParams.set('alt', 'media');
      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) throw new Error(`Read failed: ${res.status} ${await res.text().catch(() => '')}`);
      content = await res.text();
    }

    return ok({ id: meta.id, name: meta.name, mimeType: meta.mimeType, content });
  } catch (e) {
    return err((e as Error).message, 'DRIVE_ERROR');
  }
}

/**
 * Create a new file in Google Drive.
 * Defaults to a Google Doc; also supports Sheets and plain text.
 *
 * @param accessToken  Google OAuth access token.
 * @param name         File name.
 * @param content      Initial text content.
 * @param mimeType     MIME type (defaults to Google Doc).
 * @param folderId     Optional parent folder ID.
 */
export async function createDriveFile(
  accessToken: string,
  name: string,
  content: string,
  mimeType = 'application/vnd.google-apps.document',
  folderId?: string,
): Promise<ToolOutcome<DriveFile>> {
  try {
    if (mimeType === 'application/vnd.google-apps.document') {
      // Create empty doc via Docs API, then insert content via batchUpdate.
      const createRes = await fetch(`${DOCS_BASE}/documents`, {
        method: 'POST',
        headers: authHeaders(accessToken),
        body: JSON.stringify({ title: name }),
      });
      if (!createRes.ok) {
        throw new Error(`Docs create: ${createRes.status} ${await createRes.text().catch(() => '')}`);
      }
      const doc = (await createRes.json()) as { documentId: string; title: string };

      if (content) {
        const updateRes = await fetch(`${DOCS_BASE}/documents/${doc.documentId}:batchUpdate`, {
          method: 'POST',
          headers: authHeaders(accessToken),
          body: JSON.stringify({
            requests: [{ insertText: { location: { index: 1 }, text: content } }],
          }),
        });
        if (!updateRes.ok) {
          throw new Error(`Docs insert: ${updateRes.status} ${await updateRes.text().catch(() => '')}`);
        }
      }

      // Move to specified folder if provided.
      if (folderId) {
        await fetch(`${DRIVE_BASE}/files/${doc.documentId}?addParents=${folderId}&fields=id`, {
          method: 'PATCH',
          headers: authHeaders(accessToken),
          body: JSON.stringify({}),
        });
      }

      return ok({
        id: doc.documentId,
        name: doc.title,
        mimeType: 'application/vnd.google-apps.document',
        webViewLink: `https://docs.google.com/document/d/${doc.documentId}/edit`,
      });
    }

    if (mimeType === 'application/vnd.google-apps.spreadsheet') {
      // Create via Sheets API, then append rows.
      const createRes = await fetch(`${SHEETS_BASE}/spreadsheets`, {
        method: 'POST',
        headers: authHeaders(accessToken),
        body: JSON.stringify({ properties: { title: name } }),
      });
      if (!createRes.ok) {
        throw new Error(`Sheets create: ${createRes.status} ${await createRes.text().catch(() => '')}`);
      }
      const sheet = (await createRes.json()) as { spreadsheetId: string; spreadsheetUrl: string };

      if (content) {
        const rows = content.split('\n').map((line) => line.split('\t'));
        await fetch(
          `${SHEETS_BASE}/spreadsheets/${sheet.spreadsheetId}/values/A1:append?valueInputOption=RAW`,
          {
            method: 'POST',
            headers: authHeaders(accessToken),
            body: JSON.stringify({ values: rows }),
          },
        );
      }

      return ok({
        id: sheet.spreadsheetId,
        name,
        mimeType: 'application/vnd.google-apps.spreadsheet',
        webViewLink: sheet.spreadsheetUrl,
      });
    }

    // Plain text or other file: multipart upload.
    const metadata: Record<string, unknown> = { name, mimeType };
    if (folderId) metadata.parents = [folderId];
    return ok(await driveMultipartCreate(accessToken, metadata, mimeType, content));
  } catch (e) {
    return err((e as Error).message, 'DRIVE_ERROR');
  }
}

/**
 * Replace the content of an existing Google Drive file.
 *
 * @param accessToken  Google OAuth access token.
 * @param fileId       Google Drive file ID.
 * @param content      New file content.
 */
export async function updateDriveFile(
  accessToken: string,
  fileId: string,
  content: string,
): Promise<ToolOutcome<DriveFile>> {
  try {
    const meta = await driveGet<DriveFile>(accessToken, `/files/${fileId}`, {
      fields: 'id,name,mimeType',
    });

    if (meta.mimeType === 'application/vnd.google-apps.document') {
      // Fetch the document body to find its current end index, then replace all content.
      const docRes = await fetch(`${DOCS_BASE}/documents/${fileId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!docRes.ok) throw new Error(`Get doc: ${docRes.status}`);
      const doc = (await docRes.json()) as {
        body?: { content?: Array<{ endIndex?: number }> };
      };
      const endIndex = doc.body?.content?.slice(-1)?.[0]?.endIndex ?? 1;

      const requests: unknown[] = [];
      if (endIndex > 1) {
        requests.push({ deleteContentRange: { range: { startIndex: 1, endIndex: endIndex - 1 } } });
      }
      if (content) {
        requests.push({ insertText: { location: { index: 1 }, text: content } });
      }

      if (requests.length > 0) {
        const res = await fetch(`${DOCS_BASE}/documents/${fileId}:batchUpdate`, {
          method: 'POST',
          headers: authHeaders(accessToken),
          body: JSON.stringify({ requests }),
        });
        if (!res.ok) throw new Error(`Doc update: ${res.status} ${await res.text().catch(() => '')}`);
      }
      return ok(meta);
    }

    if (meta.mimeType === 'application/vnd.google-apps.spreadsheet') {
      // Clear all values then rewrite from the given content.
      await fetch(`${SHEETS_BASE}/spreadsheets/${fileId}/values/A1:clear`, {
        method: 'POST',
        headers: authHeaders(accessToken),
        body: JSON.stringify({}),
      });
      if (content) {
        const rows = content.split('\n').map((line) => line.split('\t'));
        await fetch(
          `${SHEETS_BASE}/spreadsheets/${fileId}/values/A1:append?valueInputOption=RAW`,
          {
            method: 'POST',
            headers: authHeaders(accessToken),
            body: JSON.stringify({ values: rows }),
          },
        );
      }
      return ok(meta);
    }

    // Other file types: simple media PATCH.
    const patchRes = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': meta.mimeType ?? 'text/plain',
        },
        body: content,
      },
    );
    if (!patchRes.ok) {
      throw new Error(`Drive media PATCH: ${patchRes.status} ${await patchRes.text().catch(() => '')}`);
    }
    return ok(await patchRes.json() as DriveFile);
  } catch (e) {
    return err((e as Error).message, 'DRIVE_ERROR');
  }
}

/**
 * Create a new folder in Google Drive.
 *
 * @param accessToken  Google OAuth access token.
 * @param name         Folder name.
 * @param parentId     Optional parent folder ID.
 */
export async function createDriveFolder(
  accessToken: string,
  name: string,
  parentId?: string,
): Promise<ToolOutcome<DriveFile>> {
  try {
    const metadata: Record<string, unknown> = {
      name,
      mimeType: 'application/vnd.google-apps.folder',
    };
    if (parentId) metadata.parents = [parentId];
    const file = await drivePost<DriveFile>(accessToken, '/files', metadata);
    return ok(file);
  } catch (e) {
    return err((e as Error).message, 'DRIVE_ERROR');
  }
}

/**
 * Share a Google Drive file or folder with another user.
 *
 * @param accessToken  Google OAuth access token.
 * @param fileId       Google Drive file ID.
 * @param email        Recipient's email address.
 * @param role         Permission role: 'reader' | 'writer' | 'owner' (default 'reader').
 */
export async function shareDriveFile(
  accessToken: string,
  fileId: string,
  email: string,
  role: 'reader' | 'writer' | 'owner' = 'reader',
): Promise<ToolOutcome<{ fileId: string; email: string; role: string }>> {
  try {
    await drivePost(accessToken, `/files/${fileId}/permissions`, {
      type: 'user',
      role,
      emailAddress: email,
    });
    return ok({ fileId, email, role });
  } catch (e) {
    return err((e as Error).message, 'DRIVE_ERROR');
  }
}
