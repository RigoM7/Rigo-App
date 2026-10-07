// Checks the code map against the code (`npm run check:docs`): every path named in
// docs/CODEMAP.md exists, every file in the covered folders belongs to an area, every test file is
// some area's test, the areas' tables are exactly the tables the code creates, and
// docs/FEATURES.md has the same areas in the same order.
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

const MAP = 'docs/CODEMAP.md';
const AREAS = 17;
const COVERED = ['src/', 'test/', 'e2e/', 'scripts/', 'migrations/', 'static/', '.github/'];
const problems = [];
const tick = (s) => [...s.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
const isPath = (t) => /^[\w.-]+(\/[\w.@-]*)+$/.test(t) || /^[\w.-]+\.md$/.test(t);

// Areas: the "## name (code: old name)" sections that have a Files list. Other "## " sections
// (Shared files, Recipes, Gotchas) aren't areas. Lists may wrap onto following lines.
const map = readFileSync(MAP, 'utf8');
const sections = map.split(/^## /m).slice(1)
  .filter((s) => s.includes('**Files:**'))
  .map((s) => ({ name: s.split('\n')[0].split(' (code:')[0].trim(), body: s }));
if (sections.length !== AREAS) problems.push(`${MAP} has ${sections.length} areas; expected ${AREAS}.`);
if (!sections.some((s) => s.name === 'foundation')) problems.push(`${MAP} has no foundation area.`);

const fieldText = (body, label) => {
  const m = body.match(new RegExp(`\\*\\*${label}:\\*\\*([\\s\\S]*?)(?=\\n- \\*\\*|\\n## |$)`));
  return m ? m[1] : '';
};
const owned = new Set();
const tests = new Set();
const listed = new Map(); // table -> { area, from }
for (const { name, body } of sections) {
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
  // Tables: "  - `table`: what it holds (`created in`)"; the last backticked name is where.
  for (const line of fieldText(body, 'Tables').split('\n')) {
    const m = line.match(/^\s+- `(\w+)`:/);
    if (!m) continue;
    const from = tick(line).at(-1);
    if (listed.has(m[1])) problems.push(`Table ${m[1]} is listed in two areas.`);
    listed.set(m[1], { area: name, from });
  }
}

for (const t of tick(map).filter(isPath)) if (!existsSync(t)) problems.push(`${MAP} names ${t}, which doesn't exist.`);

// docs/FEATURES.md uses the same areas, in the same order, so a name links the two files.
const FEATURES = 'docs/FEATURES.md';
const NOT_AREAS = ['Gap to PRODUCT.md', 'Known limitations'];
const featureAreas = readFileSync(FEATURES, 'utf8').split('\n')
  .filter((l) => l.startsWith('## ')).map((l) => l.slice(3).trim()).filter((n) => !NOT_AREAS.includes(n));
const mapAreas = sections.map((s) => s.name);
if (featureAreas.join() !== mapAreas.join()) {
  problems.push(`${FEATURES} areas (${featureAreas.join(', ')}) don't match ${MAP} areas (${mapAreas.join(', ')}).`);
}

const files = execSync('git ls-files --cached --others --exclude-standard', { encoding: 'utf8' })
  .split('\n').filter((f) => f && COVERED.some((d) => f.startsWith(d)) && existsSync(f));
const covers = (f) => [...owned].some((o) => (o.endsWith('/') ? f.startsWith(o) : f === o));
for (const f of files) if (!covers(f)) problems.push(`${f} belongs to no area in ${MAP}.`);
for (const f of readdirSync('test').filter((f) => f.endsWith('.test.ts'))) {
  if (!tests.has(`test/${f}`)) problems.push(`test/${f} is no area's test in ${MAP}.`);
}

// Tables created by migrations or by server code, against the areas' Tables lists.
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

if (problems.length) {
  console.error(`check:docs found ${problems.length} problem(s):\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`check:docs: ${sections.length} areas cover ${files.length} files and ${tests.size} test files; ${listed.size} tables match.`);
