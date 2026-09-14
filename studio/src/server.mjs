import { startStudioServer } from './http.mjs';

const app = await startStudioServer({ host: process.env.STORY_STUDIO_HOST || '127.0.0.1', port: Number(process.env.PORT || 0) });
process.stderr.write(`story-studio listening at ${app.baseUrl}\n`);
process.stderr.write(`session token: ${app.token}\n`);
process.on('SIGINT', () => app.server.close(() => process.exit(0)));
process.on('SIGTERM', () => app.server.close(() => process.exit(0)));
