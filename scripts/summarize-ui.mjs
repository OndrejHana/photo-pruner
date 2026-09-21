import { readFileSync } from 'node:fs';
const tree = JSON.parse(readFileSync(process.argv[2]));
function walk(node) {
  const a = node.attributes;
  if (a && (a.identifier || a.label || a.value)) console.log(JSON.stringify({ type: a.elementType, id: a.identifier, label: a.label, value: a.value, enabled: a.enabled }));
  for (const child of node.children ?? []) walk(child);
}
walk(tree.root);
