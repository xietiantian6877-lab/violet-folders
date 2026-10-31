import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const outputDirectory = path.resolve(process.argv[2] ?? 'release');
const files = (await readdir(outputDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && /\.(exe|zip)$/i.test(entry.name))
  .map((entry) => entry.name)
  .sort();

if (files.length === 0) {
  throw new Error(`No portable EXE or ZIP packages found in ${outputDirectory}`);
}

const sums = [];
for (const filename of files) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path.join(outputDirectory, filename))) {
    hash.update(chunk);
  }
  const line = `${hash.digest('hex')}  ${filename}`;
  sums.push(line);
  await writeFile(path.join(outputDirectory, `${filename}.sha256`), `${line}\n`, 'utf8');
}
await writeFile(path.join(outputDirectory, 'SHA256SUMS.txt'), `${sums.join('\n')}\n`, 'utf8');
console.log(sums.join('\n'));
