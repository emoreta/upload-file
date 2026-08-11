const { migrate } = require('../src/database/migrate');
const { ping, getPool } = require('../src/config/database');

(async () => {
  try {
    await ping();
    await migrate();
    console.log('File Service database migrations completed');
    await getPool().end();
  } catch (error) {
    console.error(`File Service migration failed: ${error.message}`);
    process.exitCode = 1;
  }
})();
