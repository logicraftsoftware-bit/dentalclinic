// Fetch only CLI executables from the official EDB Windows binary distribution.
// Other runtime DLLs come from the installed embedded PostgreSQL distribution.
import fs from 'node:fs';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
const url = 'https://get.enterprisedb.com/postgresql/postgresql-18.1-1-windows-x64-binaries.zip';
const head = await fetch(url, { method: 'HEAD' });
if (!head.ok) throw new Error('PostgreSQL tools download unavailable.');
const total = Number(head.headers.get('content-length'));
async function range(start, end) {
  const r = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } });
  if (r.status !== 206) throw new Error('Server did not support a partial download.');
  return Buffer.from(await r.arrayBuffer());
}
const tail = await range(total - 65557, total - 1);
let end = -1;
for (let i = tail.length - 22; i >= 0; i--)
  if (tail.readUInt32LE(i) === 0x06054b50) {
    end = i;
    break;
  }
if (end < 0) throw new Error('Archive footer not found.');
const size = tail.readUInt32LE(end + 12),
  offset = tail.readUInt32LE(end + 16);
const directory = await range(offset, offset + size - 1);
const target = '.tools/pg-bin';
fs.mkdirSync(target, { recursive: true });
for (const file of fs.readdirSync('node_modules/@embedded-postgres/windows-x64/native/bin'))
  if (file.endsWith('.dll'))
    fs.copyFileSync(
      path.join('node_modules/@embedded-postgres/windows-x64/native/bin', file),
      path.join(target, file),
    );
for (let pos = 0; pos < directory.length; ) {
  if (directory.readUInt32LE(pos) !== 0x02014b50) throw new Error('Invalid archive directory.');
  const nameLen = directory.readUInt16LE(pos + 28),
    extraLen = directory.readUInt16LE(pos + 30),
    commentLen = directory.readUInt16LE(pos + 32);
  const name = directory.subarray(pos + 46, pos + 46 + nameLen).toString();
  if (/(?:^|\/)bin\/(pg_dump|pg_restore|psql)\.exe$/.test(name)) {
    const compressed = directory.readUInt32LE(pos + 20),
      uncompressed = directory.readUInt32LE(pos + 24),
      location = directory.readUInt32LE(pos + 42),
      method = directory.readUInt16LE(pos + 10);
    const header = await range(location, location + 29);
    const start = location + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
    const data = await range(start, start + compressed - 1);
    const buffer = method === 8 ? inflateRawSync(data) : method === 0 ? data : null;
    if (!buffer || buffer.length !== uncompressed)
      throw new Error('CLI archive entry validation failed.');
    fs.writeFileSync(path.join(target, path.basename(name)), buffer);
  }
  pos += 46 + nameLen + extraLen + commentLen;
}
console.log('Local PostgreSQL CLI tools ready in .tools/pg-bin.');
