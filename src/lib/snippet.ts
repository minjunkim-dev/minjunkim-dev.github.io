// A region is the lines between `// snippet:start <name>` and `// snippet:end <name>`.
const marker = /^\s*\/\/ snippet:(start|end) ([\w-]+)\s*$/;

/** Returns one named region (or the whole file), without marker lines and common indentation. */
export function snippet(source: string, region?: string): string {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  let body = lines;

  if (region) {
    const start = lines.findIndex((line) => line.match(marker)?.slice(1).join(' ') === `start ${region}`);
    const end = lines.findIndex((line) => line.match(marker)?.slice(1).join(' ') === `end ${region}`);
    if (start < 0 || end < start) throw new Error(`snippet region not found: ${region}`);
    body = lines.slice(start + 1, end);
  }

  body = body.filter((line) => !marker.test(line));
  while (body.length && body[0].trim() === '') body.shift();
  while (body.length && body.at(-1)!.trim() === '') body.pop();

  const indent = Math.min(...body.filter((line) => line.trim()).map((line) => line.match(/^ */)![0].length));
  return body.map((line) => line.slice(indent)).join('\n');
}
