// Checks the area map and the schema map against the code (`npm run check:docs`):
// every path named in docs/AREAS.md exists, every file in the covered folders belongs to an area,
// every test file is some area's test, and docs/SCHEMA.md lists exactly the tables the code creates.
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

const COVERED = ['src/', 'test/', 'e2e/', 'scripts/', 'migrations/', 'static/', '.github/'];
const problems = [];
const tick = (s) => [...s.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
const isPath = (t) => /^[\w.-]+(\/[\w.@-]*)+$/.test(t) || /^[\w.-]+\.md$/.test(t);

// Areas: sections are "## name"; their Files and Tests lists may wrap onto following lines.
const areas = readFileSync('docs/AREAS.md', 'utf8');
const sections = areas.split(/^## /m).slice(1).map((s) => ({ name: s.split('\n')[0].trim(), body: s }));
if (sections.length !== 17) problems.push(`docs/AREAS.md has ${sections.length} areas; expected 16 plus platform.`);
if (!sections.some((s) => s.name === 'platform')) problems.push('docs/AREAS.md has no platform area.');

const field = (body, label) => {
  const m = body.match(new RegExp(`\\*\\*${label}:\\*\\*([\\s\\S]*?)(?=\\n- \\*\\*|\\n## |$)`));
  return m ? tick(m[1]) : [];
};
const owned = new Set();
const tests = new Set();
for (const { name, body } of sections) {
  const files = field(body, 'Files');
  const own = field(body, 'Tests');
  if (!files.length) problems.push(`Area ${name} lists no files.`);
  if (!own.length && name !== 'platform') problems.push(`Area ${name} lists no tests.`);
  for (const f of files) owned.add(f);
  for (const t of own) {
    if (!/^test\/.+\.test\.ts$/.test(t)) problems.push(`Area ${name}: ${t} is not a test file.`);
    tests.add(t);
    owned.add(t);
  }
}
for (const t of tick(areas).filter(isPath)) if (!existsSync(t)) problems.push(`docs/AREAS.md names ${t}, which doesn't exist.`);

const files = execSync('git ls-files --cached --others --exclude-standard', { encoding: 'utf8' })
  .split('\n').filter((f) => f && COVERED.some((d) => f.startsWith(d)) && existsSync(f));
const covers = (f) => [...owned].some((o) => (o.endsWith('/') ? f.startsWith(o) : f === o));
for (const f of files) if (!covers(f)) problems.push(`${f} belongs to no area in docs/AREAS.md.`);
for (const f of readdirSync('test').filter((f) => f.endsWith('.test.ts'))) {
  if (!tests.has(`test/${f}`)) problems.push(`test/${f} is no area's test in docs/AREAS.md.`);
}

// Schema: tables created by migrations or by server code, against the first column of docs/SCHEMA.md.
const created = new Map();
const scan = (file) => {
  for (const m of readFileSync(file, 'utf8').matchAll(/create table (?:if not exists )?rigo\.(\w+)/gi)) {
    if (!created.has(m[1])) created.set(m[1], file);
  }
};
for (const f of readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort()) scan(`migrations/${f}`);
for (const f of files.filter((f) => f.startsWith('src/server/') && f.endsWith('.ts'))) scan(f);
const schema = readFileSync('docs/SCHEMA.md', 'utf8');
const rows = schema.split('\n').filter((l) => /^\| `\w+` \|/.test(l));
const listed = new Set(rows.map((l) => l.match(/^\| `(\w+)`/)[1]));
for (const t of created.keys()) if (!listed.has(t)) problems.push(`Table ${t} (${created.get(t)}) is missing from docs/SCHEMA.md.`);
for (const t of listed) if (!created.has(t)) problems.push(`docs/SCHEMA.md lists ${t}, which no migration or server code creates.`);
const areaNames = new Set(sections.map((s) => s.name));
for (const l of rows) {
  const cells = l.split('|').map((c) => c.trim());
  const [table, , area, from] = cells.slice(1, 5);
  if (!areaNames.has(area)) problems.push(`docs/SCHEMA.md: ${table} names unknown area "${area}".`);
  const src = tick(from)[0] ?? '';
  if (!(src.includes('/') ? existsSync(src) : existsSync(`migrations/${src}`))) problems.push(`docs/SCHEMA.md: ${table} says it was created in ${src}, which doesn't exist.`);
}

if (problems.length) {
  console.error(`check:docs found ${problems.length} problem(s):\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`check:docs: ${sections.length} areas cover ${files.length} files and ${tests.size} test files; ${listed.size} tables match.`);
