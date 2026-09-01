require('./src/config');
const db = require('./src/databricks-client');
Promise.all([
  db.query("SHOW TABLES IN sourcingandbuying.serve"),
  db.query("SHOW TABLES IN supplychain.serve"),
])
  .then(([t1, t2]) => {
    console.log('\n=== sourcingandbuying.serve ===');
    t1.forEach(r => console.log(' ', Object.values(r)[1] || Object.values(r)[0]));
    console.log('\n=== supplychain.serve ===');
    t2.forEach(r => console.log(' ', Object.values(r)[1] || Object.values(r)[0]));
    process.exit(0);
  })
  .catch(e => { console.error(e.message); process.exit(1); });
