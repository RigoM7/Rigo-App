// Checks the code map in README.md against the code (`npm run check:docs`): every path it names
// exists, every file in the covered folders belongs to an area, every test file is some area's test,
// and the tables listed (the areas' and the old ones) are exactly the tables the code creates. Also
// checks that the docs are the four agreed files.
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

const MAP = 'README.md';
const COVERED = ['src/', 'test/', 'e2e/', 'scripts/', 'migrations/', 'static/', '.github/'];
const problems = [];
const tick = (s) => [...s.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
const isPath = (t) => /^[\w.-]+(\/[\w.@-]*)+$/.test(t) && !t.startsWith('/');

const readme = readFileSync(MAP, 'utf8');
const mapStart = readme.indexOf('\n## Code map');
if (mapStart < 0) { console.error(`${MAP} has no "## Code map" section.`); process.exit(1); }
const mapEnd = readme.indexOf('\n## ', mapStart + 5);
const map = readme.slice(mapStart, mapEnd < 0 ? undefined : mapEnd);

// Areas: "### name" sections with a Files list. "### Old tables" lists tables only.
const sections = map.split(/^### /m).slice(1).map((s) => ({ name: s.split('\n')[0].trim(), body: s }));
const areas = sections.filter((s) => s.body.includes('**Files:**'));
if (areas.length < 5) problems.push(`${MAP} code map has ${areas.length} areas; expected the full list.`);
if (!areas.some((s) => s.name === 'foundation')) problems.push(`${MAP} code map has no foundation area.`);

const fieldText = (body, label) => {
  const m = body.match(new RegExp(`\\*\\*${label}:\\*\\*([\\s\\S]*?)(?=\\n- \\*\\*|\\n### |$)`));
  return m ? m[1] : '';
};
const owned = new Set();
const tests = new Set();
const listed = new Map(); // table -> { area, from }
const addTables = (name, text) => {
  for (const line of text.split('\n')) {
    const m = line.match(/^\s+- `(\w+)`:/);
    if (!m) continue;
    const from = tick(line).at(-1);
    if (listed.has(m[1])) problems.push(`Table ${m[1]} is listed twice.`);
    listed.set(m[1], { area: name, from });
  }
};
for (const { name, body } of areas) {
  const files = tick(fieldText(body, 'Files'));
  const own = tick(fieldText(body, 'Tests'));
  if (!files.length) problems.push(`Area ${name} lists no files.`);
  if (!own.length && name !== 'foundation') problems.push(`Area ${name} lists no tests.`);
  for (const f of files) owned.add(f);
  for (const t of own) {
    if (!/^test\/.+\.test\.ts$/.test(t)) problems.push(`Area ${name}: ${t} is not a test file.`);
    tests.add(t);
    owned.add(t);
  }
  addTables(name, fieldText(body, 'Tables'));
}
const old = sections.find((s) => s.name === 'Old tables');
if (old) addTables('old tables', old.body);

for (const t of tick(map).filter(isPath)) if (!existsSync(t)) problems.push(`${MAP} names ${t}, which doesn't exist.`);

const files = execSync('git ls-files --cached --others --exclude-standard', { encoding: 'utf8' })
  .split('\n').filter((f) => f && COVERED.some((d) => f.startsWith(d)) && existsSync(f));
const covers = (f) => [...owned].some((o) => (o.endsWith('/') ? f.startsWith(o) : f === o));
for (const f of files) if (!covers(f)) problems.push(`${f} belongs to no area in ${MAP}.`);
for (const f of readdirSync('test').filter((f) => f.endsWith('.test.ts'))) {
  if (!tests.has(`test/${f}`)) problems.push(`test/${f} is no area's test in ${MAP}.`);
}

// Tables created by migrations or by server code, against the lists.
const created = new Map();
const scan = (file) => {
  for (const m of readFileSync(file, 'utf8').matchAll(/create table (?:if not exists )?rigo\.(\w+)/gi)) {
    if (!created.has(m[1])) created.set(m[1], file);
  }
};
for (const f of readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort()) scan(`migrations/${f}`);
for (const f of files.filter((f) => f.startsWith('src/server/') && f.endsWith('.ts'))) scan(f);
for (const t of created.keys()) if (!listed.has(t)) problems.push(`Table ${t} (${created.get(t)}) is in no area of ${MAP}.`);
for (const [t, { area, from }] of listed) {
  if (!created.has(t)) problems.push(`${MAP} lists ${t} (${area}), which no migration or server code creates.`);
  const src = from ?? '';
  if (!(src.includes('/') ? existsSync(src) : existsSync(`migrations/${src}`))) problems.push(`${MAP}: ${t} says it was created in ${src}, which doesn't exist.`);
}

// The docs: PRODUCT.md, DESIGN.md, README.md and CLAUDE.md at the top.
for (const d of ['PRODUCT.md', 'DESIGN.md', 'README.md', 'CLAUDE.md']) if (!existsSync(d)) problems.push(`${d} is missing.`);
const extra = existsSync('docs') ? readdirSync('docs').filter((f) => f.endsWith('.md')) : [];
for (const f of extra) problems.push(`docs/${f}: the docs are four files. Fold it into one of them.`);

if (problems.length) {
  console.error(`check:docs found ${problems.length} problem(s):\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`check:docs: ${areas.length} areas cover ${files.length} files and ${tests.size} test files; ${listed.size} tables match.`);
