import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { builtinModules } from 'node:module';
const nodeBuiltins = new Set(builtinModules.map(name => name.replace(/^node:/, '')));

const root = process.cwd();
async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(entry => entry.isDirectory() ? walk(path.join(directory, entry.name)) : /\.tsx?$/.test(entry.name) ? [path.join(directory, entry.name)] : []));
  return files.flat();
}
const failures = [];
for (const file of [...await walk('src'), ...await walk('electron')]) {
  const source = ts.createSourceFile(file, await readFile(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const imports = [];
  const visit = node => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require')) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) imports.push(node.arguments[0].text);
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && node.moduleReference.expression && ts.isStringLiteral(node.moduleReference.expression)) imports.push(node.moduleReference.expression.text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  for (const imported of imports) {
    const target = (imported.startsWith('.') ? path.relative(root, path.resolve(path.dirname(file), imported)).replaceAll(path.sep, '/') : imported).replace(/\.tsx?$/, '');
    let reason;
    if (file.startsWith('src/') && (target === 'electron' || target.startsWith('electron/') || target.startsWith('native/') || target.startsWith('node:') || nodeBuiltins.has(target))) reason = 'Renderer code must use the preload bridge for desktop APIs.';
    if (file.startsWith('src/features/') && target.startsWith('src/app/')) reason = 'Features must not depend on app composition.';
    if (file.startsWith('src/shared/') && target.startsWith('src/app/')) reason = 'Shared code must not depend on app composition.';
    if (file.startsWith('src/shared/') && target.startsWith('src/features/') && !/\/(contracts|types)$/.test(target)) reason = 'Shared code can import feature types, not feature implementations.';
    if (file.startsWith('electron/') && target.startsWith('src/') && !/^src\/(features\/[^/]+\/(contracts|types|catalog)|shared\/(bridge|geometry|copy))$/.test(target)) reason = 'Electron can import pure contracts/catalog data, not renderer components.';
    if (reason) failures.push(`${file} -> ${imported}: ${reason}`);
  }
}
if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
else console.log('Feature boundaries passed: renderer, desktop, contracts, and shared code.');
