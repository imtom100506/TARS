// npm start fails early on runtimes that still embed vulnerable HTTP dependencies.
const [major, minor, patch] = process.versions.node.split('.').map(Number);
if (major !== 24 || minor < 22 || minor === 22 && patch < 2) {
  console.error('TARS requiere Node 24.22.2 o una revisión posterior de Node 24. Usa la versión indicada en .node-version.');
  process.exitCode = 1;
}
