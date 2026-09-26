// cdm-rental-docs Worker — Path A pilot: thin front-end + one read-only
// proxy route. All real logic still lives in Apps Script; this Worker
// never talks to Google directly, so there's no service-account auth
// to set up for this step.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/rentals') {
      const target = env.APPS_SCRIPT_URL + '?api=rentals';
      const upstream = await fetch(target);
      const body = await upstream.text();
      return new Response(body, {
        status: upstream.ok ? 200 : 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Everything else (/, /index.html, etc.) — serve the static front-end.
    return env.ASSETS.fetch(request);
  },
};
