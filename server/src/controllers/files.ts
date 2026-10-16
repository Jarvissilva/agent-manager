import type { Request, Response } from 'express';
import { browseFiles, referenceFile, storeUpload } from '../services/files.js';
import { RequestError } from '../lib/http/errors.js';

export async function getFiles(request: Request, response: Response) {
  const offset = Number(request.body?.offset ?? 0);
  if (!Number.isSafeInteger(offset) || offset < 0)
    throw new RequestError(400, 'Invalid file page.');
  response.setHeader('Cache-Control', 'no-store');
  response.json(
    await browseFiles(
      request.body?.path,
      request.body?.hidden === true,
      offset,
    ),
  );
}
export async function selectFile(request: Request, response: Response) {
  response.json(await referenceFile(request.body?.path));
}
export async function uploadFile(request: Request, response: Response) {
  if (!Buffer.isBuffer(request.body))
    throw new RequestError(
      400,
      'Send file contents as application/octet-stream.',
    );
  let name: string;
  try {
    name = decodeURIComponent(request.get('X-File-Name') ?? '');
  } catch {
    throw new RequestError(400, 'Invalid filename.');
  }
  response.status(201).json(await storeUpload(name, request.body));
}
