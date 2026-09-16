/* The site is account-only. These assert the two things that would silently
   reopen it: a path slipping onto the public list, and a catalogue row left
   claiming 'public'. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
let pass = 0, fail = 0;
const t = (name, cond) => { cond ? (pass++, console.log('PASS  ' + name))
                                 : (fail++, console.log('FAIL  ' + name)); };

const mw = readFileSync(resolve(ROOT, 'functions/_middleware.js'), 'utf8');

// Only these may be reachable signed out. A fourth entry appearing here
// without a deliberate decision is the failure this test exists to catch.
const publicPaths = [...mw.matchAll(/^\s*'(\/[^']*)',?$/gm)].map((m) => m[1]);
// The three PWA entries were added deliberately: the browser fetches the
// manifest and registers the worker from the sign-in page, where there is no
// session. None of the three contains anything account-specific — and
// offline.html is asserted empty of personal content below.
t('public paths are exactly login, signup, their assets and the PWA files',
  JSON.stringify(publicPaths.sort()) ===
  JSON.stringify(['/api/auth/login', '/api/auth/logout', '/api/auth/signup',
                  '/assets/', '/favicon', '/login/', '/signup/',
                  '/manifest.webmanifest', '/sw.js', '/offline.html'].sort()));

t('the gate is deny-by-default', mw.includes('!isPublic(url.pathname)'));
t('API calls get JSON, not a redirect to HTML',
  /url\.pathname\.startsWith\('\/api\/'\)[\s\S]{0,200}signedOut: true/.test(mw));
t('no leftover allow-list of protected pages', !mw.includes('SIGNED_IN_PAGES'));

const g = readFileSync(resolve(ROOT, 'assets/js/global.js'), 'utf8');
t('a 401 bounces to sign-in', g.includes("location.replace('/login/?next="));
t('the sign-in page itself does not bounce', g.includes('!isAuthPage()'));
t('no Free chip remains', !g.includes(">Free</span>'"));
t('locked items point at the account page, not signup',
  g.includes("if (!entry.allowed) return '/account/';"));

const login = readFileSync(resolve(ROOT, 'login/index.html'), 'utf8');
const signup = readFileSync(resolve(ROOT, 'signup/index.html'), 'utf8');
t('sign-in page uses the landing layout, not a bare form card',
  login.includes('auth-landing') && login.includes('auth-bar'));
t('sign-up page matches it', signup.includes('auth-landing') && signup.includes('auth-bar'));
t('neither signed-out page links to a tool',
  !/href="\/tools\//.test(login) && !/href="\/tools\//.test(signup));
t('neither signed-out page links into a section',
  !/href="\/s\//.test(login) && !/href="\/s\//.test(signup));
t('login page carries no chrome that would 401', !login.includes('data-site-header'));
t('open redirect blocked on next', login.includes("/^\\/[^/\\\\]/.test(next)"));
t('single-session takeover is explained', login.includes('only one is allowed at a time'));

const home = readFileSync(resolve(ROOT, 'index.html'), 'utf8');
t('home page has no signed-out hero', !home.includes('heroSignedOut'));
t('home page redirects a user-less render', home.includes("location.replace('/login/?next="));

const cm = readFileSync(resolve(ROOT, 'tools/compliance-maker/index.html'), 'utf8');
t('no signed-out upsell panel in Compliance Maker', !cm.includes('signin-cta'));

const compliance = readFileSync(resolve(ROOT, 'functions/_compliance.js'), 'utf8');
t('no guest tier is handed out', !compliance.includes("tier: 'guest'"));

// --- the service worker must not become a way round the access model
const sw = readFileSync(resolve(ROOT, 'sw.js'), 'utf8');
t('the worker never caches the API', sw.includes("url.pathname.startsWith('/api/')"));
t('the worker only caches /assets/', sw.includes("url.pathname.startsWith('/assets/')"));
t('the worker never caches a real page',
  !/cache\.put\(req[\s\S]{0,80}navigate/.test(sw) && sw.includes('req.mode === \'navigate\''));
t('the worker ignores non-GET', sw.includes("req.method !== 'GET'"));
t('the worker ignores other origins', sw.includes('url.origin !== self.location.origin'));
t('sign-out empties the cache', sw.includes('TN_SIGNED_OUT'));

const pwa = readFileSync(resolve(ROOT, 'assets/js/pwa.js'), 'utf8');
t('sign-out tells the worker', pwa.includes("'tn:signout'") && pwa.includes('TN_SIGNED_OUT'));
t('global.js fires the sign-out event',
  readFileSync(resolve(ROOT, 'assets/js/global.js'), 'utf8').includes("CustomEvent('tn:signout')"));

// A cache outlives the session that filled it, so anything personal on the
// offline page would still be readable after sign-out.
// Comments stripped first: the file explains *why* it holds nothing personal,
// and matching on that prose would fail the check the prose describes.
const offline = readFileSync(resolve(ROOT, 'offline.html'), 'utf8')
  .replace(/<!--[\s\S]*?-->/g, '');
t('the cached offline page holds nothing account-specific',
  !/data-site-header|\/api\/|TN\.api|session\.user/i.test(offline));
t('the offline page pulls in no script that could fetch account data',
  !/<script/i.test(offline));

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
