import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { assert } from './core.js';
const bucket = () => process.env.S3_BUCKET;
let client: S3Client | undefined;
function s3() {
  assert(bucket(), 503, 'Configure private document storage before uploading files.');
  return client ??= new S3Client({ region: process.env.S3_REGION || 'ap-south-1', ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT, forcePathStyle: true } : {}), credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID || '', secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '' } });
}
function localPath(key: string) {
  assert(!process.env.VERCEL, 503, 'Configure S3_BUCKET and private storage credentials on Vercel.');
  assert(!key.includes('..') && /^[a-f0-9-]+\/[a-f0-9]+$/.test(key), 500, 'Invalid document key.');
  return path.resolve(process.env.STORAGE_PATH || 'storage', key);
}
export async function saveDocument(key: string, body: Buffer, mime: string) {
  if (bucket()) { await s3().send(new PutObjectCommand({ Bucket: bucket(), Key: key, Body: body, ContentType: mime })); return; }
  const target = localPath(key); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, body, { flag: 'wx' });
}
export async function loadDocument(key: string) {
  if (!bucket()) return readFile(localPath(key));
  const object = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
  assert(object.Body && (object.ContentLength ?? 0) <= 3 * 1024 * 1024, 413, 'Document exceeds the download limit.');
  return Buffer.from(await object.Body.transformToByteArray());
}
export async function deleteDocument(key: string) {
  if (bucket()) { await s3().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key })); return; }
  await unlink(localPath(key));
}
