// functions/_education.js
//
// One definition of "may this person use the Education section", imported by
// the middleware and the Education API. Keeping it in one place is the
// point: a reader who can see a book card must also be able to open the
// book, and two separate checks would eventually disagree.
//
// The rule: signed in, active, and approved by an admin.
//
// Approval is an ordinary grant row — scope_type 'section', scope_id
// 'sec_education' — which is what the admin console already writes from
// Users -> Access -> "Section — Education". No new table, no new screen.

import { canAccess, loadGrants } from './_lib.js';

export const EDUCATION_SECTION_ID = 'sec_education';

// Matches the sections row the migration writes, so the lock chip the
// catalogue draws and the answer the API gives are the same answer.
export const EDUCATION_ACCESS = 'restricted';
export const EDUCATION_PLAN = 'pro';

export async function educationAllowed(env, user) {
  if (!user || user.suspended || user.status !== 'active') return false;
  const grants = await loadGrants(env, user);
  return canAccess(user, EDUCATION_ACCESS, EDUCATION_PLAN, grants,
                   'section:' + EDUCATION_SECTION_ID);
}

// Only an admin adds or removes books. Reading is for anyone approved.
export function educationCanManage(user) {
  return !!user && user.role === 'admin' && user.status === 'active' && !user.suspended;
}

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

// ---------------------------------------------------------------- formats
export const FORMATS = {
  docx: { ext: '.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  epub: { ext: '.epub', mime: 'application/epub+zip' },
  txt:  { ext: '.txt',  mime: 'text/plain; charset=utf-8' }
};

export function formatOf(key) {
  const m = /\.(docx|epub|txt)$/i.exec(key || '');
  return m ? m[1].toLowerCase() : null;
}

// A slug is the URL and the key for saved reading positions, so it has to be
// predictable and safe to put in a path.
export function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\.(docx|epub|txt)$/i, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

// -------------------------------------------------------------- the shelf
//
// This is what replaced the hand-written manifest. R2 can list a bucket, so
// the bucket IS the library: upload a file and it is there, delete it and it
// is gone. Nothing to keep in step by hand, and no deploy in the loop.
//
// Titles come from customMetadata written at upload time, because the
// alternative is downloading every book on every page load just to read its
// title. The upload page parses the file in the browser — it already has the
// parser — and sends what it found along with the bytes.

export async function listBooks(env) {
  if (!env.BOOKS) throw new Error('The books bucket is not connected. Add the BOOKS R2 binding.');

  const out = [];
  let cursor;

  // R2 pages its listing. Follow the cursor so book 1001 is not invisible.
  do {
    const page = await env.BOOKS.list({
      prefix: 'books/',
      include: ['customMetadata'],
      cursor
    });

    for (const obj of page.objects) {
      const format = formatOf(obj.key);
      if (!format) continue;                       // stray upload, not a book

      const meta = obj.customMetadata || {};
      const slug = meta.slug || slugify(obj.key.replace(/^books\//, ''));
      if (!slug) continue;

      out.push({
        slug,
        title: decodeMeta(meta.title) || prettyName(obj.key),
        subtitle: decodeMeta(meta.subtitle) || '',
        author: decodeMeta(meta.author) || '',
        description: decodeMeta(meta.description) || '',
        chapters: Number(meta.chapters) || 0,
        format,
        size: obj.size,
        uploaded: obj.uploaded instanceof Date ? obj.uploaded.toISOString() : String(obj.uploaded || '')
      });
    }

    cursor = page.truncated ? page.cursor : null;
  } while (cursor);

  return out.sort((a, b) => a.title.localeCompare(b.title));
}

export function bookKey(slug, format) {
  return 'books/' + slug + FORMATS[format].ext;
}

// R2 metadata values travel in HTTP headers, which are Latin-1 only. Titles
// are not — "Prologue — Subject 4,001" has an em dash, and NCERT chapters
// carry curly quotes. Both sides encode, so nothing is lost.
export function encodeMeta(s) {
  return encodeURIComponent(String(s == null ? '' : s));
}
export function decodeMeta(s) {
  if (!s) return '';
  try { return decodeURIComponent(s); } catch (e) { return String(s); }
}

function prettyName(key) {
  return String(key)
    .replace(/^books\//, '')
    .replace(/\.(docx|epub|txt)$/i, '')
    .replace(/[_-]+/g, ' ')
    .trim() || 'Untitled book';
}
