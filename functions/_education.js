// functions/_education.js
//
// One definition of "may this person use the Education section", imported by
// the middleware, the library API and the file API. Keeping it in one place
// is the point: a reader who can see a book card must also be able to open
// the book and download its file, and three separate checks would eventually
// disagree with each other.
//
// The rule: signed in, active, and approved by an admin.
//
// Approval is an ordinary grant row — scope_type 'section', scope_id
// 'sec_education' — which is what the admin console already writes from
// Users -> Access -> "Section — Education". No new table, no new screen.
//
//   INSERT INTO grants (id,user_id,scope_type,scope_id,granted_by,granted_at)
//   VALUES ('gr_x','<user id>','section','sec_education','admin',datetime('now'));

import { canAccess, loadGrants } from './_lib.js';

export const EDUCATION_SECTION_ID = 'sec_education';

// Matches the sections row this migration writes, so the lock chip the
// catalogue draws on the Education card and the answer the API gives are
// always the same answer.
export const EDUCATION_ACCESS = 'restricted';
export const EDUCATION_PLAN = 'pro';

export async function educationAllowed(env, user) {
  if (!user || user.suspended || user.status !== 'active') return false;
  const grants = await loadGrants(env, user);
  return canAccess(user, EDUCATION_ACCESS, EDUCATION_PLAN, grants,
                   'section:' + EDUCATION_SECTION_ID);
}

// Why the visitor was turned away, so the page can offer the right next step
// rather than a flat "no".
export function denialReason(user) {
  if (!user) return { code: 'signin', message: 'Sign in to open the Education section.' };
  if (user.suspended || user.status !== 'active') {
    return { code: 'inactive', message: 'This account is not active. Contact an admin.' };
  }
  return {
    code: 'approval',
    message: 'The Education section is opened per person. Ask an admin to approve your account.'
  };
}

// The library manifest, read straight off the deployed assets. env.ASSETS
// does not re-enter Pages Functions, so this cannot loop back through the
// gate that is calling it.
export async function loadLibrary(env, request) {
  const url = new URL('/books/library.json', new URL(request.url).origin);
  const res = await env.ASSETS.fetch(new Request(url.toString(), { method: 'GET' }));
  if (!res.ok) throw new Error('The book library manifest is missing.');

  const data = await res.json();
  const books = Array.isArray(data.books) ? data.books : [];

  return books
    .filter((b) => b && b.slug && b.file)
    .map((b, i) => ({
      slug: String(b.slug),
      file: String(b.file),
      title: b.title || prettyName(b.file),
      subtitle: b.subtitle || '',
      author: b.author || '',
      description: b.description || '',
      icon: b.icon || 'book-open',
      format: /\.epub$/i.test(b.file) ? 'epub' : 'docx',
      sort: Number.isFinite(b.sort) ? b.sort : i + 1
    }))
    .sort((a, b) => a.sort - b.sort || a.title.localeCompare(b.title));
}

// A file name is a poor title, but it beats an empty card when someone drops
// a book in and has not filled anything in yet.
function prettyName(file) {
  return String(file)
    .replace(/\.(docx|epub)$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'Untitled book';
}
