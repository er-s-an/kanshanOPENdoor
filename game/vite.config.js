import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MYOPIA_MOUNT = '/myopia-3d';
const GAME_ROOT = path.dirname(fileURLToPath(import.meta.url));
const MYOPIA_DIST = path.resolve(GAME_ROOT, '../game-ps1/dist');

const CONTENT_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
  ['.woff2', 'font/woff2'],
]);

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function sendText(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

/**
 * Mount the built standalone PS1 game below the same Vite origin in development.
 * This intentionally reads game-ps1/dist rather than portal dist/myopia-3d: a
 * PS1 rebuild is visible on refresh without rebuilding the portal, while the
 * production bundler remains responsible for copying it into portal dist.
 */
function serveMyopiaDist() {
  return {
    name: 'serve-myopia-dist',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url || (req.method !== 'GET' && req.method !== 'HEAD')) return next();

        // Inspect the encoded request target rather than URL.pathname: WHATWG
        // URL normalization would turn /myopia-3d/%2e%2e/foo into /foo before
        // the mount has a chance to reject the traversal attempt.
        const queryStart = req.url.search(/[?#]/);
        const encodedPath = queryStart === -1 ? req.url : req.url.slice(0, queryStart);
        const search = queryStart === -1 ? '' : req.url.slice(queryStart);
        if (encodedPath !== MYOPIA_MOUNT && !encodedPath.startsWith(`${MYOPIA_MOUNT}/`)) return next();

        // Relative asset paths in the PS1 HTML require the trailing slash.
        if (encodedPath === MYOPIA_MOUNT) {
          res.statusCode = 302;
          res.setHeader('Location', `${MYOPIA_MOUNT}/${search}`);
          res.setHeader('Cache-Control', 'no-store');
          res.end();
          return;
        }

        let distRoot;
        try {
          distRoot = await realpath(MYOPIA_DIST);
        } catch (error) {
          if (error && error.code === 'ENOENT') {
            sendText(
              res,
              503,
              'Myopia PS1 build is unavailable. Run: npm --prefix ../game-ps1 run build\n',
            );
            return;
          }
          return next(error);
        }

        let requested;
        try {
          requested = decodeURIComponent(encodedPath.slice(MYOPIA_MOUNT.length));
        } catch {
          sendText(res, 400, 'Invalid myopia-3d path.\n');
          return;
        }

        const relativePath = requested.replace(/^\/+/, '') || 'index.html';
        const file = path.resolve(distRoot, relativePath);
        if (!isWithin(distRoot, file)) {
          sendText(res, 403, 'Invalid myopia-3d path.\n');
          return;
        }

        let actualFile;
        try {
          const fileStats = await stat(file);
          if (!fileStats.isFile()) {
            sendText(res, 404, 'Myopia PS1 asset not found.\n');
            return;
          }
          actualFile = await realpath(file);
        } catch (error) {
          if (error && error.code === 'ENOENT') {
            sendText(res, 404, 'Myopia PS1 asset not found.\n');
            return;
          }
          return next(error);
        }

        // Do not let a symlink inside a build directory expose an arbitrary file.
        if (!isWithin(distRoot, actualFile)) {
          sendText(res, 403, 'Invalid myopia-3d path.\n');
          return;
        }

        try {
          const body = req.method === 'HEAD' ? null : await readFile(actualFile);
          res.statusCode = 200;
          res.setHeader('Content-Type', CONTENT_TYPES.get(path.extname(actualFile).toLowerCase()) || 'application/octet-stream');
          res.setHeader('Cache-Control', 'no-store');
          res.end(body);
        } catch (error) {
          return next(error);
        }
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), serveMyopiaDist()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8790',
        changeOrigin: true,
      },
    },
  },
});
