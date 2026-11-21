import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type { APIGatewayProxyEventV2WithJWTAuthorizer as Event, APIGatewayProxyStructuredResultV2 as Response } from 'aws-lambda';
import { isPeriod, summariseFee, type FeeStore } from './contracts/billing.js';
import { getActor } from './lib/server/auth.js';
import { createDynamoFeeStore } from './lib/server/dynamo-store.js';
import { HttpError, json, parseObject, success } from './lib/server/http.js';

const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2',
};

async function handleApi(event: Event, store: FeeStore): Promise<Response> {
  const path = `${event.requestContext.http.method} ${event.rawPath}`;
  switch (path) {
    case 'GET /api/me': {
      const { role, academyName, teamName } = await getActor(event, store);
      return success({ role, academyName, teamName });
    }
    case 'GET /api/coach/summary': {
      const actor = await getActor(event, store, 'coach');
      const period = readPeriod(event.queryStringParameters?.period);
      return success(summariseFee(await store.findFee(period, actor.playerId)));
    }
    case 'GET /api/parent/fees': {
      const actor = await getActor(event, store, 'parent');
      const period = readPeriod(event.queryStringParameters?.period);
      const fee = await store.findFee(period, actor.playerId);
      if (!fee) return success({ fees: [] });
      const { id, playerName, amountPaise, currency, status } = fee;
      return success({ fees: [{ id, playerName, period, amountPaise, currency, status }] });
    }
    case 'POST /api/coach/fees': {
      const actor = await getActor(event, store, 'coach');
      const rawBody = event.isBase64Encoded && event.body ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
      const { period, amountPaise } = parseObject(rawBody);
      if (typeof amountPaise !== 'number' || !Number.isSafeInteger(amountPaise) || amountPaise <= 0) {
        throw new HttpError(400, 'INVALID_AMOUNT', 'The fee must be a positive integer in paise.');
      }
      const fee = await store.createFee(actor, readPeriod(period), amountPaise);
      return success({ feeId: fee.id, status: fee.status });
    }
    case 'GET /api/coach/billing/notifications': {
      await getActor(event, store, 'coach');
      return success({ notifications: await store.listNotifications() });
    }
    default:
      throw new HttpError(404, 'ROUTE_NOT_FOUND', 'This route is not available.');
  }
}

function readPeriod(period: unknown) {
  if (!isPeriod(period)) throw new HttpError(400, 'INVALID_PERIOD', 'Use a billing period in YYYY-MM format.');
  return period;
}

async function serveWeb(path: string): Promise<Response> {
  const asset = path === '/' ? 'index.html' : path.slice(1);
  const extension = extname(asset);
  if (!contentTypes[extension] || (path !== '/' && !/^\/assets\/[\w.-]+$/.test(path))) {
    throw new HttpError(404, 'ROUTE_NOT_FOUND', 'This route is not available.');
  }
  try {
    const body = await readFile(join(__dirname, 'web', asset));
    return {
      statusCode: 200,
      headers: { 'content-type': contentTypes[extension], 'x-content-type-options': 'nosniff', 'cache-control': 'no-cache' },
      body: body.toString('base64'),
      isBase64Encoded: true,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    throw new HttpError(404, 'ASSET_NOT_FOUND', 'The requested asset was not found.');
  }
}

export function createHandler(makeStore = createDynamoFeeStore) {
  return async (event: Event): Promise<Response> => {
    try {
      const { method } = event.requestContext.http;
      if (method === 'GET' && event.rawPath === '/health') return success({ service: 'cleansheet' });
      if (method === 'GET' && (event.rawPath === '/' || event.rawPath.startsWith('/assets/'))) {
        return await serveWeb(event.rawPath);
      }
      if (event.rawPath.startsWith('/api/')) return await handleApi(event, makeStore());
      throw new HttpError(404, 'ROUTE_NOT_FOUND', 'This route is not available.');
    } catch (error) {
      if (error instanceof HttpError) return json(error.status, { ok: false, error: { code: error.code, message: error.message } });
      console.error('CleanSheet request failed', { error: error instanceof Error ? error.name : 'unknown', requestId: event.requestContext.requestId });
      return json(500, { ok: false, error: { code: 'INTERNAL_ERROR', message: 'The request could not be completed.' } });
    }
  };
}

export const handler = createHandler();
