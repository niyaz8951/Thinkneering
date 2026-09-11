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
t('public paths are exactly login, signup and their assets',
  JSON.stringify(publicPaths.sort()) ===
  JSON.stringify(['/api/auth/login', '/api/auth/logout', '/api/auth/signup',
                  '/assets/', '/favicon', '/login/', '/signup/'].sort()));

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

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
