import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import type { Actor, FeeStore } from '../../contracts/billing.js';
import { HttpError } from './http.js';

export async function getActor(event: APIGatewayProxyEventV2WithJWTAuthorizer, store: FeeStore, role?: Actor['role']): Promise<Actor> {
  const claims = event.requestContext.authorizer?.jwt?.claims;
  if (claims?.token_use !== 'access' || typeof claims.sub !== 'string') {
    throw new HttpError(401, 'UNAUTHENTICATED', 'A valid Cognito access token is required.');
  }
  const actor = await store.findActor(claims.sub);
  if (!actor || (role && actor.role !== role)) throw new HttpError(403, 'FORBIDDEN', 'Access is denied.');
  return actor;
}
