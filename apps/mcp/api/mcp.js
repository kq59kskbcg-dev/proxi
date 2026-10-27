import { handler } from '../lib/server.js';

export const GET = (request) => handler.fetch(request);
export const POST = (request) => handler.fetch(request);
export const DELETE = (request) => handler.fetch(request);
