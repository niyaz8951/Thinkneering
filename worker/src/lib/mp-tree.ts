/* Rearrange a wiring or piping map as a feed tree (owner, 23 Oct 2026: "equipment under the board that feeds it, no
   HVAC equipment heading"; "the 2D layout shall not be affected"). Pure: takes the map's branches, returns what to move,
   what to delete and what the centre loses; mp.ts writes it in one batch.

   - The feed: Power wires (wiring) or chilled water supply pipes (piping), searched outwards from the branches with a
     "Source:" note (standby sources only for what the others do not reach), whichever end a wire was added from.
   - A load is a branch fed by exactly one branch and feeding nothing outside its own branches (a chiller, an AHU, an FCU
     circuit, a unit with its own diagram under it). It moves under the branch that feeds it, after what is there.
     Boards, risers and headers feed further on, or feed the branches right under them: they stay where they are, so the
     stages (Supply, Main distribution ...) stay as the top branches, and running it again changes nothing.
   - Nothing inside a unit's own diagram ("Layout: columns" below the centre) moves: the unit moves with it.
   - A group left with nothing under it (Chillers, AHUs, HVAC equipment, Units ...) that no link touches and that has no
     pictures is deleted; its notes go to the branch above it ("Group: notes"), so no words are lost.
   - The centre loses "Layout: columns" (the map reads as a free-flow tree, like the other maps).
   Wires and pipes are never changed: the cable schedule, the flow, the 2D view and its places stay as they were. */

export interface TreeNode { id: string; parent: string | null; title: string; notes: string; special: string[]; links: Record<string, string>[]; sort: number }
export interface Rearranged {
  moves: { id: string; parent: string; sort: number }[];
  deletes: string[];
  notes: Map<string, string>;          // branch id -> its new notes (the deleted groups' notes added)
  rootSpecial: string[] | null;        // the centre's new special notes, when they change
}

const COLS = /^\s*layout\s*:\s*columns?\s*$/i;

export function rearrange(kind: "wiring" | "piping", nodes: TreeNode[], withImages: Set<string> = new Set()): Rearranged {
  const by = new Map(nodes.map((n) => [n.id, n]));
  const root = nodes.find((n) => !n.parent);
  if (!root) return { moves: [], deletes: [], notes: new Map(), rootSpecial: null };
  const kids = new Map<string, string[]>();
  for (const n of [...nodes].sort((a, b) => a.sort - b.sort)) if (n.parent && by.has(n.parent)) { const l = kids.get(n.parent) || []; l.push(n.id); kids.set(n.parent, l); }
  const flow = kind === "wiring" ? ["w-power"] : ["p-supply"];
  const adj = new Map<string, Set<string>>(), touched = new Set<string>();
  for (const n of nodes) for (const l of n.links || []) {
    if (l.kind !== "node" || !l.node) continue;
    touched.add(n.id); touched.add(l.node);
    if (!flow.includes(l.rel) || !by.has(l.node) || l.node === n.id) continue;
    if (!adj.has(n.id)) adj.set(n.id, new Set());
    if (!adj.has(l.node)) adj.set(l.node, new Set());
    adj.get(n.id)!.add(l.node); adj.get(l.node)!.add(n.id);
  }
  // steps from a source: the main sources first, the standby ones for what is left
  const src = (n: TreeNode) => (n.special || []).map((x) => /^\s*source\s*:\s*(.+)$/i.exec(x)).find(Boolean)?.[1] || "";
  const dist = new Map<string, number>();
  const bfs = (starts: string[]) => {
    const q: string[] = [];
    for (const s of starts) if (!dist.has(s)) { dist.set(s, 0); q.push(s); }
    while (q.length) { const a = q.shift()!; for (const b of adj.get(a) || []) if (!dist.has(b)) { dist.set(b, dist.get(a)! + 1); q.push(b); } }
  };
  const sources = nodes.filter((n) => src(n) && adj.has(n.id));
  bfs(sources.filter((n) => !/standby|generator/i.test(src(n))).map((n) => n.id));
  bfs(sources.filter((n) => /standby|generator/i.test(src(n))).map((n) => n.id));
  const path = (id: string) => { const p: string[] = []; for (let x: string | null = id; x && by.has(x); x = by.get(x)!.parent) p.unshift(x); return p; };
  const inside = (id: string, top: string) => path(id).includes(top);
  const inUnit = (id: string) => path(id).slice(1, -1).some((a) => (by.get(a)!.special || []).some((x) => COLS.test(x)));
  const moves: Rearranged["moves"] = [], movedOut = new Set<string>();
  const nextSort = new Map<string, number>();
  const sortAfter = (p: string) => { const v = nextSort.get(p) ?? Math.max(-1, ...(kids.get(p) || []).map((k) => by.get(k)!.sort)) + 1; nextSort.set(p, v + 1); return v; };
  // in reading order, so the loads keep their order under their board
  const order: string[] = [];
  (function walk(id: string) { order.push(id); (kids.get(id) || []).forEach(walk); })(root.id);
  for (const id of order) {
    if (id === root.id || !dist.has(id) || src(by.get(id)!) || inUnit(id)) continue;     // a source (the generator too) never moves
    const d = dist.get(id)!, near = [...(adj.get(id) || [])];
    const feeders = near.filter((b) => (dist.get(b) ?? Infinity) < d);
    if (feeders.length !== 1) continue;
    const f = feeders[0];
    if (near.some((b) => b !== f && !inside(b, id))) continue;              // feeds something further on: not a load
    if ((kids.get(id) || []).some((k) => near.includes(k))) continue;         // feeds the branches under it: a board, it stays
    if (inside(f, id) || by.get(id)!.parent === f || inUnit(f)) continue;
    moves.push({ id, parent: f, sort: sortAfter(f) });
    movedOut.add(id);
  }
  // groups left empty: deleted, their notes to the branch above (deepest first, so a group of groups goes too)
  const parentNow = new Map(nodes.map((n) => [n.id, n.parent]));
  for (const m of moves) parentNow.set(m.id, m.parent);
  const childrenNow = (id: string) => nodes.filter((n) => parentNow.get(n.id) === id && !gone.has(n.id));
  const gone = new Set<string>(), notes = new Map<string, string>();
  const noteOf = (id: string) => notes.get(id) ?? by.get(id)!.notes;
  for (const id of [...order].reverse()) {
    const n = by.get(id)!;
    if (id === root.id || !(kids.get(id) || []).length || childrenNow(id).length || touched.has(id) || withImages.has(id) || inUnit(id)) continue;
    gone.add(id);
    const words = noteOf(id).trim(), up = parentNow.get(id)!;
    if (words) { const was = noteOf(up); notes.set(up, (was ? was + "\n\n" : "") + n.title + ": " + words); }
  }
  for (const id of gone) notes.delete(id);
  const rs = root.special || [];
  return { moves, deletes: [...gone], notes, rootSpecial: rs.some((x) => COLS.test(x)) ? rs.filter((x) => !COLS.test(x)) : null };
}
