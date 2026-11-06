const fs = require('node:fs/promises');
const path = require('node:path');
function createFileStore(file) {
  let queue = Promise.resolve();
  return {
    async read() {
      await queue;
      try { return await fs.readFile(file, 'utf8'); }
      catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    },
    write(data) {
      const task = queue.then(async () => {
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file + '.tmp', data, { encoding: 'utf8', mode: 0o600 });
        await fs.rename(file + '.tmp', file);
      });
      queue = task.catch(() => {});
      return task;
    },
  };
}
module.exports = { createFileStore };
