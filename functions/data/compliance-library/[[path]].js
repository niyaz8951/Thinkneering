// Gate for the library workbooks. Pages Functions take precedence over
// static assets on matching routes, so every request to
// /data/compliance-library/* lands here first. We check the session, then
// serve the underlying static file with env.ASSETS.fetch() — which reads the
// deployed asset directly and does NOT re-enter this function.
//
// Result: the workbooks deploy like any other repo file but are only
// downloadable by signed-in users. (Note the sibling /data/rules/ file is
// deliberately NOT gated — the highlight rules drive the free conversion.)

import { requireUser, withErrorHandling } from '../../_compliance.js';

async function handleGet(context) {
  const user = await requireUser(context);
  if (!user) return new Response('Sign in required', { status: 401 });
  return context.env.ASSETS.fetch(context.request);
}

export const onRequestGet = withErrorHandling(handleGet);
