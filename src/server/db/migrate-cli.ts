import { getDb } from './index.js';
const db = await getDb();
console.log(`Database (${db.kind}) is migrated.`);
await db.close();
