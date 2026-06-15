const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const workflowsDir = path.join(root, 'workflows/n8n');
const codeDir = path.join(workflowsDir, 'enterprise-upgrade-code');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

for (const file of fs.readdirSync(workflowsDir).filter((name) => name.endsWith('.json'))) {
  const wf = JSON.parse(fs.readFileSync(path.join(workflowsDir, file), 'utf8'));
  const names = new Set(wf.nodes.map((node) => node.name));

  for (const source of Object.keys(wf.connections || {})) {
    if (!names.has(source)) throw new Error(`${file}: missing connection source ${source}`);
    for (const outputs of Object.values(wf.connections[source])) {
      for (const branch of outputs) {
        for (const link of branch) {
          if (!names.has(link.node)) throw new Error(`${file}: missing target ${link.node} from ${source}`);
        }
      }
    }
  }
}

for (const file of fs.readdirSync(codeDir).filter((name) => name.endsWith('.js'))) {
  const source = fs.readFileSync(path.join(codeDir, file), 'utf8');
  new AsyncFunction('$input', '$env', '$getWorkflowStaticData', '$http', source);
}

console.log('n8n workflow JSON and Code-node scripts validated.');

