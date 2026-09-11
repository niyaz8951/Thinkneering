// GET /api/compliance/access
// The one call the tool page makes on load. Answers 200 for everyone,
// including signed-out visitors — a 401 here would be indistinguishable from
// a real failure and would make the free flow look broken.
//
// { signedIn, tier: 'guest'|'member'|'pro', maxPages, ai }
//
// This is presentation only. Every capability it describes is enforced again
// inside the endpoint that provides it.

import { complianceTier, json, withErrorHandling } from '../../_compliance.js';

async function handleGet(context) {
  return json(await complianceTier(context));
}

export const onRequestGet = withErrorHandling(handleGet);
