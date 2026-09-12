#!/usr/bin/env python3
"""Regression suite for the typed knowledge graph.

Applies schema.sql and every migration in order against an in-memory SQLite
database, then asserts the constraints Compliance Maker depends on. D1 is
SQLite, so a rule that holds here holds in production.

    python3 _dev/tests/knowledge-typed.test.py
"""
import sqlite3, sys, uuid, os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MIGRATIONS = [
    'db/schema.sql',
    'db/2026-08-knowledge-graph.sql',
    'db/2026-10-mindmap.sql',
    'db/2026-09-knowledge-lanes.sql',
    'db/2026-08-catalog-knowledge.sql',
    'db/2026-09-refocus.sql',
    'db/2026-09-knowledge-typed.sql',
    'db/2026-09-signin-only.sql',
    'db/2026-09-education-tools.sql',
    'db/2026-09-actions.sql',
    'db/2026-09-sbu-map.sql',
    'db/2026-09-people.sql',
]

con = sqlite3.connect(':memory:')
for m in MIGRATIONS:
    con.executescript(open(os.path.join(ROOT, m)).read())

PASS = FAIL = 0
def check(name, fn):
    global PASS, FAIL
    try:
        fn(); PASS += 1; print('PASS  ' + name)
    except Exception as e:
        FAIL += 1; print('FAIL  %s — %s' % (name, e))

def rejected(sql, args=()):
    try:
        con.execute(sql, args)
    except (sqlite3.IntegrityError, sqlite3.OperationalError):
        return
    raise AssertionError('should have been rejected')

def nid(): return str(uuid.uuid4())

con.execute("INSERT INTO knowledge_maps (id,slug,title,kind,domain,owner_id,created_at,updated_at)"
            " VALUES ('m1','m1','Map','system','hvac','u1',datetime('now'),datetime('now'))")

def node(kind, title, status='draft', scope='project', by=None):
    i = nid()
    con.execute("INSERT INTO knowledge_nodes (id,map_id,kind,title,status,scope,created_by,created_at,updated_at,approved_by)"
                " VALUES (?,'m1',?,?,?,?,'u1',datetime('now'),datetime('now'),?)",
                (i, kind, title, status, scope, by))
    return i

ahu   = node('equipment', 'AHU', 'approved', 'general', 'u1')
coil  = node('component', 'Cooling coil', 'approved', 'general', 'u1')
std   = node('standard',  'EN 1886', 'approved', 'general', 'u1')
clause= node('clause',    'EN 1886 §5.2', 'approved', 'general', 'u1')
proj  = node('project',   'Aramco Stadium', 'approved', 'project', 'u1')
req   = node('requirement','Casing class D1', 'approved', 'project', 'u1')

def edge(f, t, rel):
    con.execute("INSERT INTO knowledge_edges (id,map_id,from_id,to_id,relation,created_by,created_at)"
                " VALUES (?,'m1',?,?,?,'u1',datetime('now'))", (nid(), f, t, rel))

# --- node kinds
check('known kind accepted', lambda: node('parameter', 'Face velocity'))
check('unknown kind rejected', lambda: rejected(
    "INSERT INTO knowledge_nodes (id,map_id,kind,title,created_by,created_at,updated_at)"
    " VALUES (?,'m1','widget','X','u1',datetime('now'),datetime('now'))", (nid(),)))
check('clause is a real kind now',
      lambda: (_ for _ in ()).throw(AssertionError('missing'))
      if not con.execute("SELECT 1 FROM knowledge_kinds WHERE kind='clause'").fetchone() else None)

# --- scope
check('invalid scope rejected', lambda: rejected(
    "INSERT INTO knowledge_nodes (id,map_id,kind,title,scope,created_by,created_at,updated_at)"
    " VALUES (?,'m1','component','X','usually','u1',datetime('now'),datetime('now'))", (nid(),)))

# --- edge legality
check('equipment contains component', lambda: edge(ahu, coil, 'contains'))
check('clause defined_in standard',   lambda: edge(clause, std, 'defined_in'))
check('project requires requirement', lambda: edge(proj, req, 'requires'))
check('requirement satisfied_by equipment', lambda: edge(req, ahu, 'satisfied_by'))
check('requirement cites clause',     lambda: edge(req, clause, 'cites'))
check('standard cannot contain a project', lambda: rejected(
    "INSERT INTO knowledge_edges (id,map_id,from_id,to_id,relation,created_by,created_at)"
    " VALUES (?,'m1',?,?,'contains','u1',datetime('now'))", (nid(), std, proj)))
check('component cannot require a project', lambda: rejected(
    "INSERT INTO knowledge_edges (id,map_id,from_id,to_id,relation,created_by,created_at)"
    " VALUES (?,'m1',?,?,'requires','u1',datetime('now'))", (nid(), coil, proj)))
check('invented relation rejected', lambda: rejected(
    "INSERT INTO knowledge_edges (id,map_id,from_id,to_id,relation,created_by,created_at)"
    " VALUES (?,'m1',?,?,'vibes_with','u1',datetime('now'))", (nid(), ahu, coil)))
check('update to an illegal relation rejected', lambda: rejected(
    "UPDATE knowledge_edges SET relation='requires' WHERE from_id=? AND to_id=?", (ahu, coil)))

# --- aliases
con.execute("INSERT INTO knowledge_aliases (id,map_id,node_id,alias,alias_norm) VALUES (?,'m1',?,?,?)",
            (nid(), ahu, 'air handling unit', 'air handling unit'))
check('same alias on a second node in one map rejected', lambda: rejected(
    "INSERT INTO knowledge_aliases (id,map_id,node_id,alias,alias_norm) VALUES (?,'m1',?,?,?)",
    (nid(), coil, 'Air Handling Unit', 'air handling unit')))
con.execute("INSERT INTO knowledge_maps (id,slug,title,kind,domain,owner_id,created_at,updated_at)"
            " VALUES ('m2','m2','Other','system','english','u1',datetime('now'),datetime('now'))")
other = nid()
con.execute("INSERT INTO knowledge_nodes (id,map_id,kind,title,created_by,created_at,updated_at)"
            " VALUES (?,'m2','term','Duct','u1',datetime('now'),datetime('now'))", (other,))
check('the same alias is fine in a different map', lambda: con.execute(
    "INSERT INTO knowledge_aliases (id,map_id,node_id,alias,alias_norm) VALUES (?,'m2',?,?,?)",
    (nid(), other, 'air handling unit', 'air handling unit')))

# --- facts
fid = nid()
check('numeric fact with unit accepted', lambda: con.execute(
    "INSERT INTO knowledge_facts (id,map_id,node_id,name,value_type,value_num,unit,scope,status,approved_by,approved_at)"
    " VALUES (?,'m1',?,'face velocity','number',2.5,'m/s','project','approved','u1',datetime('now'))", (fid, coil)))
check('numeric fact without unit rejected', lambda: rejected(
    "INSERT INTO knowledge_facts (id,map_id,node_id,name,value_type,value_num) VALUES (?,'m1',?,'x','number',2.5)",
    (nid(), coil)))
check('range fact needs both bounds', lambda: rejected(
    "INSERT INTO knowledge_facts (id,map_id,node_id,name,value_type,value_num,unit)"
    " VALUES (?,'m1',?,'x','range',2.0,'m/s')", (nid(), coil)))
check('approved fact without approver rejected', lambda: rejected(
    "INSERT INTO knowledge_facts (id,map_id,node_id,name,value_type,value_text,status)"
    " VALUES (?,'m1',?,'x','text','y','approved')", (nid(), coil)))
check('approved fact is immutable', lambda: rejected(
    "UPDATE knowledge_facts SET value_num=3.0 WHERE id=?", (fid,)))
check('silent scope promotion rejected', lambda: rejected(
    "UPDATE knowledge_facts SET scope='general', approved_by=NULL WHERE id=?", (fid,)))

# --- views
draft_node = node('component', 'Drain pan')
con.execute("INSERT INTO knowledge_facts (id,map_id,node_id,name,value_type,value_text)"
            " VALUES (?,'m1',?,'material','text','SS304')", (nid(), draft_node))
# Scoped to this test's own map: the SBU seed legitimately puts 50 drafts in
# the queue, one of which is also called "AHU".
q = con.execute("SELECT title, draft_facts FROM knowledge_review_queue WHERE map_id='m1'").fetchall()
check('review queue shows the draft node with its fact count',
      lambda: (_ for _ in ()).throw(AssertionError(q)) if ('Drain pan', 1) not in q else None)
check('review queue hides approved nodes',
      lambda: (_ for _ in ()).throw(AssertionError('leaked')) if any(r[0] == 'AHU' for r in q) else None)

af = con.execute("SELECT node_title, scope_rank FROM knowledge_approved_facts").fetchall()
check('approved view exposes the approved fact with a scope rank',
      lambda: (_ for _ in ()).throw(AssertionError(af)) if ('Cooling coil', 0) not in af else None)
check('draft fact never reaches the approved view',
      lambda: (_ for _ in ()).throw(AssertionError('leaked')) if any(r[0] == 'Drain pan' for r in af) else None)

# --- catalogue
secs = [r[0] for r in con.execute("SELECT slug FROM sections WHERE parent_id IS NULL ORDER BY sort_order")]
check('site is exactly the three sections',
      lambda: (_ for _ in ()).throw(AssertionError(secs))
      if secs != ['compliance-maker', 'knowledge', 'education'] else None)
# Text Cleaner and Web Text Extractor came back as Education tools, so they
# are no longer dead links. The rest stay gone.
dead = con.execute("SELECT COUNT(*) FROM items WHERE href LIKE '/tools/hvac%'"
                   " OR href LIKE '/tools/word-counter%' OR href LIKE '/tools/unit-converter%'"
                   " OR href LIKE '/tools/container-calculator%'"
                   " OR href LIKE '/tools/load-estimator%'").fetchone()[0]
check('no catalogue row points at a deleted tool',
      lambda: (_ for _ in ()).throw(AssertionError('%d dead links' % dead)) if dead else None)

# --- account-only access model
for tbl in ('sections', 'items', 'books', 'chapters'):
    n = con.execute("SELECT COUNT(*) FROM %s WHERE access_level='public'" % tbl).fetchone()[0]
    check('no public rows left in %s' % tbl,
          (lambda n=n, tbl=tbl: (_ for _ in ()).throw(AssertionError('%d rows' % n)) if n else None))

mode = con.execute("SELECT value FROM settings WHERE key='signup_mode'").fetchone()[0]
check('signups need admin approval',
      lambda: (_ for _ in ()).throw(AssertionError(mode)) if mode != 'approval' else None)

sessions = con.execute("SELECT COUNT(*) FROM sessions").fetchone()[0]
check('session table cleared so one-session-per-account holds from now on',
      lambda: (_ for _ in ()).throw(AssertionError(sessions)) if sessions else None)

# --- education tools are registered and reachable
tools = con.execute(
    "SELECT slug, href, access_level FROM items WHERE section_id = 'sec_edu_tools' ORDER BY sort_order"
).fetchall()
check('both library tools are registered under Education',
      lambda: (_ for _ in ()).throw(AssertionError(tools)) if len(tools) != 2 else None)
check('library tools need an account',
      lambda: (_ for _ in ()).throw(AssertionError(tools))
      if any(t[2] == 'public' for t in tools) else None)

# --- the SBU map
sbu_nodes = con.execute("SELECT COUNT(*) FROM knowledge_nodes WHERE map_id='map_sbu'").fetchone()[0]
sbu_edges = con.execute("SELECT COUNT(*) FROM knowledge_edges WHERE map_id='map_sbu'").fetchone()[0]
check('SBU map seeded with nodes',
      lambda: (_ for _ in ()).throw(AssertionError(sbu_nodes)) if sbu_nodes < 40 else None)
check('SBU map seeded with edges — every one passed the legality trigger',
      lambda: (_ for _ in ()).throw(AssertionError(sbu_edges)) if sbu_edges < 50 else None)

seeded_approved = con.execute(
    "SELECT COUNT(*) FROM knowledge_nodes WHERE map_id='map_sbu' AND status='approved'").fetchone()[0]
check('nothing seeded arrives pre-approved — it was written from a role description, not the record',
      lambda: (_ for _ in ()).throw(AssertionError(seeded_approved)) if seeded_approved else None)

# Re-run BEFORE anything is added on top, and assert it is non-destructive as
# well as non-duplicating. The destructive version of this seed silently
# deleted every engineer and every action on the map.
check('re-running the SBU seed does not duplicate it',
      lambda: (con.executescript(open(os.path.join(ROOT, 'db/2026-09-sbu-map.sql')).read()),
               (_ for _ in ()).throw(AssertionError('duplicated'))
               if con.execute("SELECT COUNT(*) FROM knowledge_nodes WHERE map_id='map_sbu'"
                              ).fetchone()[0] != sbu_nodes else None)[1])

# --- actions
act = str(uuid.uuid4())
con.execute("INSERT INTO knowledge_actions (id,map_id,node_id,title) VALUES (?,'map_sbu',?,?)",
            (act, 'sbu_factoryclar', 'Chase the acoustic selection'))
check('an open action shows up as outstanding',
      lambda: (_ for _ in ()).throw(AssertionError('missing'))
      if not con.execute("SELECT 1 FROM knowledge_open_actions WHERE id=?", (act,)).fetchone() else None)
check('closing with no outcome is refused — an empty close teaches nobody anything',
      lambda: rejected("UPDATE knowledge_actions SET state='done' WHERE id=?", (act,)))
check('closing with an outcome is allowed', lambda: con.execute(
    "UPDATE knowledge_actions SET outcome='Jebel Ali confirmed 68 dBA at 2.5 m/s, 9 days', "
    "state='done' WHERE id=?", (act,)))
closed = con.execute("SELECT closed_at FROM knowledge_actions WHERE id=?", (act,)).fetchone()[0]
check('closed_at is stamped by the row, not by the caller remembering',
      lambda: (_ for _ in ()).throw(AssertionError('not stamped')) if not closed else None)
check('a closed action leaves the outstanding list',
      lambda: (_ for _ in ()).throw(AssertionError('still open'))
      if con.execute("SELECT 1 FROM knowledge_open_actions WHERE id=?", (act,)).fetchone() else None)
check('and appears in history with its outcome',
      lambda: (_ for _ in ()).throw(AssertionError('missing'))
      if not con.execute("SELECT 1 FROM knowledge_action_history WHERE id=? AND outcome<>''",
                         (act,)).fetchone() else None)
con.execute("UPDATE knowledge_actions SET state='open' WHERE id=?", (act,))
reopened = con.execute("SELECT closed_at FROM knowledge_actions WHERE id=?", (act,)).fetchone()[0]
check('reopening clears the closing date — it is not closed',
      lambda: (_ for _ in ()).throw(AssertionError(reopened)) if reopened else None)
check('dropping needs no outcome — "we decided not to" is complete', lambda: con.execute(
    "UPDATE knowledge_actions SET outcome='', state='dropped' WHERE id=?", (act,)))

# --- engineers
person = 'kn_eng1'
con.execute("INSERT INTO knowledge_nodes (id,map_id,kind,title,lane,status,scope,created_by,"
            "created_at,updated_at,approved_by) VALUES (?,'map_sbu','person','A. Engineer',"
            "'engineers','approved','general','u1',datetime('now'),datetime('now'),'u1')", (person,))
check('person is a real kind', lambda: con.execute(
    "SELECT 1 FROM knowledge_nodes WHERE id=?", (person,)).fetchone() or
    (_ for _ in ()).throw(AssertionError('missing')))

check('an engineer may cover a market', lambda: con.execute(
    "INSERT INTO knowledge_edges (id,map_id,from_id,to_id,relation,created_by,created_at) "
    "VALUES ('ke1','map_sbu',?,'sbu_mkt_uae','covers','u1',datetime('now'))", (person,)))
check('an engineer may not "cover" a metric', lambda: rejected(
    "INSERT INTO knowledge_edges (id,map_id,from_id,to_id,relation,created_by,created_at) "
    "VALUES ('ke2','map_sbu',?,'sbu_m_response','covers','u1',datetime('now'))", (person,)))
check('an engineer may own a process step', lambda: con.execute(
    "INSERT INTO knowledge_edges (id,map_id,from_id,to_id,relation,created_by,created_at) "
    "VALUES ('ke3','map_sbu',?,'sbu_factoryclar','owns','u1',datetime('now'))", (person,)))

act2 = str(uuid.uuid4())
con.execute("INSERT INTO knowledge_actions (id,map_id,node_id,assignee_id,title,due) "
            "VALUES (?,'map_sbu','sbu_factoryclar',?,'Chase acoustic selection','2020-01-01')",
            (act2, person))
row = con.execute("SELECT assignee_title, overdue FROM knowledge_open_actions WHERE id=?",
                  (act2,)).fetchone()
check('an open action names its engineer and knows it is late',
      lambda: (_ for _ in ()).throw(AssertionError(row))
      if not row or row[0] != 'A. Engineer' or row[1] != 1 else None)

load = con.execute("SELECT person, markets, open_actions, overdue_actions, closed_actions "
                   "FROM knowledge_person_load WHERE person_id=?", (person,)).fetchone()
check('the workload view rolls up region and counts',
      lambda: (_ for _ in ()).throw(AssertionError(load))
      if not load or load[1] != 'UAE' or load[2] != 1 or load[3] != 1 else None)

con.execute("UPDATE knowledge_actions SET outcome='Confirmed by Jebel Ali in 9 days', "
            "state='done' WHERE id=?", (act2,))
load2 = con.execute("SELECT open_actions, closed_actions FROM knowledge_person_load "
                    "WHERE person_id=?", (person,)).fetchone()
check('closing moves it from open to closed on the engineer',
      lambda: (_ for _ in ()).throw(AssertionError(load2))
      if load2[0] != 0 or load2[1] != 1 else None)
check('and the outcome survives in their history',
      lambda: (_ for _ in ()).throw(AssertionError('missing'))
      if not con.execute("SELECT 1 FROM knowledge_action_history WHERE assignee_id=? "
                         "AND outcome<>''", (person,)).fetchone() else None)

# The specific regression: re-seeding must not destroy what was built on top.
con.executescript(open(os.path.join(ROOT, 'db/2026-09-sbu-map.sql')).read())
check('re-seeding after engineers exist does not delete them',
      lambda: (_ for _ in ()).throw(AssertionError('engineer deleted'))
      if not con.execute("SELECT 1 FROM knowledge_nodes WHERE id=?", (person,)).fetchone() else None)
check('re-seeding does not delete their action history',
      lambda: (_ for _ in ()).throw(AssertionError('history deleted'))
      if not con.execute("SELECT 1 FROM knowledge_action_history WHERE assignee_id=?",
                         (person,)).fetchone() else None)
check('re-seeding does not delete markets added by the people migration',
      lambda: (_ for _ in ()).throw(AssertionError('market deleted'))
      if not con.execute("SELECT 1 FROM knowledge_nodes WHERE id='sbu_mkt_uae'").fetchone() else None)

print('\n%d/%d passed' % (PASS, PASS + FAIL))
sys.exit(1 if FAIL else 0)
