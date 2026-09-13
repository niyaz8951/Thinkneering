#!/usr/bin/env python3
"""Every kind a client-side domain pack can create must be registered.

db/2026-09-knowledge-typed.sql made node kinds a closed set enforced by a
trigger, and registered only the HVAC vocabulary. The dictionary and business
packs were left out, so approving a word failed with
"unknown node kind: SQLITE_CONSTRAINT_TRIGGER".

This reads the kinds straight out of the packs and asserts the database knows
every one, so the next pack that arrives fails a test rather than a user.
"""
import os, re, sqlite3, sys, uuid

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MIGRATIONS = [
    'db/schema.sql',
    'db/2026-09-migration-ledger.sql', 'db/2026-08-knowledge-graph.sql', 'db/2026-10-mindmap.sql',
    'db/2026-09-knowledge-lanes.sql', 'db/2026-08-catalog-knowledge.sql',
    'db/2026-09-refocus.sql', 'db/2026-09-knowledge-typed.sql',
    'db/2026-09-signin-only.sql', 'db/2026-09-education-tools.sql',
    'db/2026-09-actions.sql', 'db/2026-09-sbu-map.sql', 'db/2026-09-people.sql',
    'db/2026-09-rename-sections.sql', 'db/2026-09-domain-kinds.sql',
]
COLUMNS = [
    ("knowledge_maps",    "lanes TEXT"),
    ("knowledge_nodes",   "scope TEXT NOT NULL DEFAULT 'project'"),
    ("knowledge_nodes",   "project_id TEXT"),
    ("knowledge_nodes",   "origin TEXT NOT NULL DEFAULT 'human'"),
    ("knowledge_nodes",   "source_ref TEXT"),
    ("knowledge_nodes",   "superseded_by TEXT"),
    ("knowledge_actions", "assignee_id TEXT"),
]
AFTER = {
    'db/2026-08-knowledge-graph.sql': [c for c in COLUMNS if c[0] == 'knowledge_maps'],
    'db/2026-10-mindmap.sql':         [c for c in COLUMNS if c[0] == 'knowledge_nodes'],
    'db/2026-09-actions.sql':         [c for c in COLUMNS if c[0] == 'knowledge_actions'],
}

con = sqlite3.connect(':memory:')
for m in MIGRATIONS:
    con.executescript(open(os.path.join(ROOT, m)).read())
    for table, column in AFTER.get(m, []):
        try:
            con.execute("ALTER TABLE %s ADD COLUMN %s" % (table, column))
        except sqlite3.OperationalError as e:
            if 'duplicate column' not in str(e):
                raise

PASS = FAIL = 0
def check(name, ok, detail=''):
    global PASS, FAIL
    if ok:
        PASS += 1; print('PASS  ' + name)
    else:
        FAIL += 1; print('FAIL  %s %s' % (name, detail))

known = {r[0] for r in con.execute("SELECT kind FROM knowledge_kinds")}
check('the registry is populated', len(known) > 30, '(%d)' % len(known))

# Read the kinds each pack declares, straight from the source.
PACK_RE = re.compile(r"^\s{4}'?([a-zA-Z_]+)'?:\s*\{\s*label:", re.M)
packs = {}
for fn in sorted(os.listdir(os.path.join(ROOT, 'tools/knowledge'))):
    if not fn.startswith('domain-') or not fn.endswith('.js'):
        continue
    src = open(os.path.join(ROOT, 'tools/knowledge', fn)).read()
    start = src.find('NODE_KINDS')
    end = src.find('RELATIONS', start)
    packs[fn] = set(PACK_RE.findall(src[start:end if end > start else len(src)]))

check('every pack was read', len(packs) >= 4, '(%s)' % ', '.join(packs))

for fn, kinds in packs.items():
    missing = sorted(kinds - known)
    check('%s: every kind is registered' % fn, not missing, '-> missing %s' % missing)

con.execute("INSERT INTO knowledge_maps (id,slug,title,kind,domain,owner_id,created_at,updated_at)"
            " VALUES ('md','md','Dict','system','english','u1',datetime('now'),datetime('now'))")

def make(kind):
    con.execute("INSERT INTO knowledge_nodes (id,map_id,kind,title,created_by,created_at,updated_at)"
                " VALUES (?,'md',?,?,'u1',datetime('now'),datetime('now'))",
                (str(uuid.uuid4()), kind, kind + ' sample'))

# The exact failure from the screenshot: creating a dictionary word.
try:
    make('word'); ok = True; why = ''
except Exception as e:
    ok = False; why = str(e)
check('a dictionary word can be created — the reported bug', ok, why)

for kind in ('sense', 'root', 'prefix', 'suffix', 'idiom', 'confusable', 'mnemonic'):
    try:
        make(kind); ok = True; why = ''
    except Exception as e:
        ok = False; why = str(e)
    check('a %s can be created' % kind, ok, why)

# And the guard still guards.
try:
    make('nonsense_kind')
    check('an unregistered kind is still refused', False, '-> it was accepted')
except Exception:
    check('an unregistered kind is still refused', True)

# Relations for the new kinds.
def rule(f, t, r):
    return con.execute("SELECT 1 FROM knowledge_edge_rules WHERE from_kind=? AND to_kind=? AND relation=?",
                       (f, t, r)).fetchone() is not None

check('word means sense', rule('word', 'sense', 'means'))
check('word built_from root', rule('word', 'root', 'built_from'))
check('word confused_with word', rule('word', 'word', 'confused_with'))
check('activity precedes activity', rule('activity', 'activity', 'precedes'))
check('role responsible for activity', rule('role', 'activity', 'responsible'))

# The generic rules must reach the kinds added after the typed migration.
check('supersedes reaches a new kind', rule('word', 'word', 'supersedes'))
check('note annotates a new kind', rule('note', 'word', 'annotates'))
check('an illegal pair is still illegal', not rule('root', 'activity', 'precedes'))

print('\n%d/%d passed' % (PASS, PASS + FAIL))
sys.exit(1 if FAIL else 0)
