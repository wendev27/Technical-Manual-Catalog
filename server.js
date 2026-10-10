const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');

const PORT = Number(process.env.PORT || 4317);
const APP_ROOT = __dirname;
let CONTENT_ROOT = path.resolve(process.argv[2] || process.env.CATALOG_ROOT || process.cwd());
const PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 200;
const DOCUMENT_EXTENSIONS = new Set([
  '.chm',
  '.djvu',
  '.doc',
  '.docm',
  '.docx',
  '.epub',
  '.htm',
  '.html',
  '.odp',
  '.ods',
  '.odt',
  '.pdf',
  '.ppt',
  '.pptm',
  '.pptx',
  '.rtf',
  '.txt',
  '.xls',
  '.xlsm',
  '.xlsx',
]);
const EXTENSION_LABELS = {
  '.7z': ['7Z', 'archive'],
  '.bmp': ['BMP', 'image'],
  '.csv': ['CSV', 'excel'],
  '.doc': ['DOC', 'word'],
  '.docm': ['DOCM', 'word'],
  '.docx': ['DOCX', 'word'],
  '.gif': ['GIF', 'image'],
  '.htm': ['HTML', 'html'],
  '.html': ['HTML', 'html'],
  '.jpeg': ['JPG', 'image'],
  '.jpg': ['JPG', 'image'],
  '.ods': ['ODS', 'excel'],
  '.odt': ['ODT', 'word'],
  '.pdf': ['PDF', 'pdf'],
  '.png': ['PNG', 'image'],
  '.ppt': ['PPT', 'powerpoint'],
  '.pptx': ['PPTX', 'powerpoint'],
  '.tif': ['TIF', 'image'],
  '.tiff': ['TIF', 'image'],
  '.webp': ['WEBP', 'image'],
  '.xls': ['XLS', 'excel'],
  '.xlsx': ['XLSX', 'excel'],
  '.zip': ['ZIP', 'archive'],
};
const MIME_TYPES = {
  '.bmp': 'image/bmp',
  '.css': 'text/css; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.gif': 'image/gif',
  '.htm': 'text/html; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.rtf': 'application/rtf',
  '.svg': 'image/svg+xml',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xml': 'application/xml',
  '.zip': 'application/zip',
};

let searchIndex = [];
let scanPromise;

function json(response, statusCode, value) {
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(value));
}

function normalizeRelativePath(value) {
  if (value.includes('\0') || value.includes('\\') || path.posix.isAbsolute(value)) {
    throw new Error('Invalid path.');
  }
  const segments = value.split('/');
  if (segments.some((segment) => segment === '..')) throw new Error('Path is outside the drive.');
  return segments.filter((segment) => segment && segment !== '.').join(path.sep);
}

function decodeRelativePath(encodedPath) {
  let value;
  try {
    value = decodeURIComponent(encodedPath);
  } catch {
    throw new Error('Invalid URL encoding in path.');
  }
  return normalizeRelativePath(value);
}

function withinRoot(root, relativePath) {
  const resolved = path.resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error('Path is outside the drive.');
  }
  return resolved;
}

async function ensureRealPathInsideRoot(targetPath) {
  const realPath = await fs.realpath(targetPath);
  if (realPath !== CONTENT_ROOT && !realPath.startsWith(CONTENT_ROOT + path.sep)) {
    throw new Error('Path is outside the drive.');
  }
  return realPath;
}

function parsePage(url) {
  const offset = Number(url.searchParams.get('offset') || 0);
  const requestedLimit = Number(url.searchParams.get('limit') || PAGE_SIZE);
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid page offset.');
  if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1) {
    throw new Error('Invalid page size.');
  }
  return { offset, limit: Math.min(requestedLimit, MAX_PAGE_SIZE) };
}

function makeFileRecord(relativePath) {
  const name = path.basename(relativePath);
  const extension = path.extname(name).toLowerCase();
  const [label, category] = EXTENSION_LABELS[extension] || [extension.slice(1).toUpperCase() || 'FILE', ''];
  return {
    category,
    label: label.slice(0, 8),
    name,
    parentPath: path.dirname(relativePath) === '.' ? '' : path.dirname(relativePath).split(path.sep).join('/'),
    path: relativePath.split(path.sep).join('/'),
    type: 'file',
  };
}

async function scanDrive() {
  if (scanPromise) return scanPromise;
  scanPromise = (async () => {
    const nextIndex = [];
    const nextStats = { documents: 0, files: 0, folders: 0 };
    const warnings = [];
    const pending = [''];

    while (pending.length) {
      const relativeDirectory = pending.pop();
      const directoryPath = withinRoot(CONTENT_ROOT, relativeDirectory);
      let entries;
      try {
        entries = await fs.readdir(directoryPath, { withFileTypes: true });
      } catch (error) {
        warnings.push(`Could not read "${relativeDirectory || '.'}": ${error.message}`);
        continue;
      }

      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
        const relativePath = path.join(relativeDirectory, entry.name);
        if (entry.isDirectory()) {
          nextStats.folders++;
          pending.push(relativePath);
        } else if (entry.isFile()) {
          nextStats.files++;
          const extension = path.extname(entry.name).toLowerCase();
          if (DOCUMENT_EXTENSIONS.has(extension)) nextStats.documents++;
          const record = makeFileRecord(relativePath);
          record.searchText = `${record.name} ${record.path}`.toLocaleLowerCase();
          nextIndex.push(record);
        }
      }
    }

    nextIndex.sort((left, right) =>
      left.searchText.localeCompare(right.searchText, undefined, {
        numeric: true,
        sensitivity: 'base',
      })
    );
    searchIndex = nextIndex;
    return { stats: nextStats, warnings };
  })();

  try {
    return await scanPromise;
  } finally {
    scanPromise = undefined;
  }
}

async function listDirectory(url) {
  const relativeDirectory = normalizeRelativePath(url.searchParams.get('path') || '');
  const directoryPath = withinRoot(CONTENT_ROOT, relativeDirectory);
  const realDirectory = await ensureRealPathInsideRoot(directoryPath);
  const directoryStat = await fs.stat(realDirectory);
  if (!directoryStat.isDirectory()) throw new Error('Requested path is not a folder.');

  const entries = await fs.readdir(realDirectory, { withFileTypes: true });
  const visibleEntries = entries
    .filter((entry) => !entry.name.startsWith('.') && !entry.isSymbolicLink())
    .filter((entry) => entry.isDirectory() || entry.isFile())
    .map((entry) => ({
      entry,
      path: path.join(relativeDirectory, entry.name),
    }))
    .sort((left, right) => {
      const typeOrder = Number(!left.entry.isDirectory()) - Number(!right.entry.isDirectory());
      return typeOrder || left.entry.name.localeCompare(right.entry.name, undefined, { numeric: true, sensitivity: 'base' });
    });
  const { offset, limit } = parsePage(url);
  const page = visibleEntries.slice(offset, offset + limit);
  const items = page.map(({ entry, path: entryPath }) =>
    entry.isDirectory()
      ? {
          name: entry.name,
          path: entryPath.split(path.sep).join('/'),
          type: 'directory',
        }
      : makeFileRecord(entryPath)
  );
  return {
    hasMore: offset + items.length < visibleEntries.length,
    items,
    nextOffset: offset + items.length,
    total: visibleEntries.length,
  };
}

function searchFiles(url) {
  const query = (url.searchParams.get('q') || '').trim().toLocaleLowerCase();
  if (!query) return { hasMore: false, items: [], nextOffset: 0, total: 0 };
  const { offset, limit } = parsePage(url);
  const matches = searchIndex.filter((item) => item.searchText?.includes(query));
  const page = matches.slice(offset, offset + limit).map(({ searchText, ...item }) => item);
  return {
    hasMore: offset + page.length < matches.length,
    items: page,
    nextOffset: offset + page.length,
    total: matches.length,
  };
}

async function sendFile(response, filePath) {
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) {
    response.writeHead(404);
    response.end('Not found');
    return;
  }
  response.writeHead(200, {
    'Cache-Control': 'no-store',
    'Content-Length': stat.size,
    'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
  });
  const stream = require('node:fs').createReadStream(filePath);
  stream.on('error', (error) => {
    console.error(`Could not stream "${filePath}":`, error);
    if (!response.headersSent) response.writeHead(500);
    response.end('Could not read file');
  });
  stream.pipe(response);
}

async function handle(request, response) {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end('Method not allowed');
    return;
  }

  try {
    if (url.pathname === '/api/scan') {
      const scan = await scanDrive();
      json(response, 200, { ...scan, stats: scan.stats });
      return;
    }
    if (url.pathname === '/api/list') {
      json(response, 200, await listDirectory(url));
      return;
    }
    if (url.pathname === '/api/search') {
      json(response, 200, searchFiles(url));
      return;
    }
    if (url.pathname.startsWith('/files/')) {
      const relativePath = decodeRelativePath(url.pathname.slice('/files/'.length));
      const filePath = withinRoot(CONTENT_ROOT, relativePath);
      const realFile = await ensureRealPathInsideRoot(filePath);
      if (request.method === 'HEAD') {
        const stat = await fs.stat(realFile);
        response.writeHead(200, {
          'Content-Length': stat.size,
          'Content-Type': MIME_TYPES[path.extname(realFile).toLowerCase()] || 'application/octet-stream',
          'X-Content-Type-Options': 'nosniff',
        });
        response.end();
      } else {
        await sendFile(response, realFile);
      }
      return;
    }
    const asset = {
      '/': 'index.html',
      '/app.js': 'app.js',
      '/styles.css': 'styles.css',
    }[url.pathname];
    if (asset) {
      const assetPath = path.join(APP_ROOT, asset);
      const stat = await fs.stat(assetPath);
      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Length': stat.size,
        'Content-Type': MIME_TYPES[path.extname(asset)] || 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
      });
      if (request.method === 'HEAD') response.end();
      else require('node:fs').createReadStream(assetPath).pipe(response);
      return;
    }
    response.writeHead(404);
    response.end('Not found');
  } catch (error) {
    const status = error.code === 'ENOENT' ? 404 : error.message.startsWith('Invalid') || error.message.startsWith('Path') ? 400 : 500;
    if (status === 500) console.error('Request failed:', error);
    json(response, status, { error: error.message });
  }
}

async function start() {
  const realRoot = await fs.realpath(CONTENT_ROOT);
  if (!(await fs.stat(realRoot)).isDirectory()) {
    throw new Error(`Catalog root is not a directory: ${realRoot}`);
  }
  CONTENT_ROOT = realRoot;
  const server = http.createServer((request, response) => {
    handle(request, response).catch((error) => {
      console.error('Unexpected request failure:', error);
      if (!response.headersSent) json(response, 500, { error: 'Unexpected server error.' });
      else response.destroy(error);
    });
  });
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Catalog app: http://127.0.0.1:${PORT}`);
    console.log(`Drive root:  ${realRoot}`);
    console.log('Press Ctrl+C to stop.');
  });
}

start().catch((error) => {
  console.error(`Could not start catalog server: ${error.message}`);
  process.exitCode = 1;
});
