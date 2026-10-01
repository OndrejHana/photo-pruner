import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';
import React from 'react';
import { act, create } from 'react-test-renderer';
import ts from 'typescript';

const project = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const tick = () => new Promise(done => setImmediate(done));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.__DEV__ = false;

// Execute repository modules unchanged. Only platform bindings and the gesture surface are
// replaced: commands still cross the real App handler, workspace hook, and review reducer.
function loadApp(native) {
  const cache = new Map();
  const host = type => type;
  const FlatList = React.forwardRef((props, ref) => {
    React.useImperativeHandle(ref, () => ({ scrollToIndex() {} }), []);
    return React.createElement('FlatList', props, props.data.map((item, index) =>
      React.createElement(React.Fragment, { key: props.keyExtractor(item, index) }, props.renderItem({ item, index }))));
  });
  FlatList.displayName = 'TestFlatList';
  const platform = {
    AccessibilityInfo: { announceForAccessibility() {}, announceForAccessibilityWithOptions() {} },
    ActivityIndicator: host('ActivityIndicator'), FlatList, Pressable: host('Pressable'),
    ScrollView: host('ScrollView'), Text: host('Text'), View: host('View'),
    Modal: props => props.visible ? React.createElement('Modal', props, props.children) : null,
    StyleSheet: { create: value => value, absoluteFill: { position: 'absolute', inset: 0 }, hairlineWidth: 1 },
    useWindowDimensions: () => ({ width: 1366, height: 1024, scale: 2, fontScale: 1 }),
    AppState: { addEventListener: () => ({ remove() {} }) },
  };
  const bindings = new Map([
    ['react-native', platform],
    ['react-native-gesture-handler', { GestureHandlerRootView: host('GestureHandlerRootView') }],
    ['react-native-safe-area-context', { SafeAreaProvider: host('SafeAreaProvider'), SafeAreaView: host('SafeAreaView') }],
    ['expo-image', { Image: host('Image') }],
    ['expo-status-bar', { StatusBar: host('StatusBar') }],
    [resolve(project, 'modules/photo-pruner-native'), { __esModule: true, default: native, PhotoPrunerNativeView: host('PhotoPrunerNativeView') }],
    [resolve(project, 'src/components/SwipePhoto'), { SwipePhoto: host('SwipePhoto') }],
  ]);
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };
    cache.set(filename, module);
    const { outputText } = ts.transpileModule(readFileSync(filename, 'utf8'), {
      fileName: filename,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    });
    const localRequire = specifier => {
      if (bindings.has(specifier)) return bindings.get(specifier);
      if (!specifier.startsWith('.')) return require(specifier);
      const path = resolve(dirname(filename), specifier);
      if (bindings.has(path)) return bindings.get(path);
      const found = [path, `${path}.tsx`, `${path}.ts`, resolve(path, 'index.ts')].find(candidate => existsSync(candidate) && /\.(ts|tsx)$/.test(candidate));
      assert.ok(found, `Unresolved repository module ${specifier} in ${filename}`);
      return load(found);
    };
    const evaluate = new Script(`(function(require, module, exports, __filename, __dirname) {\n${outputText}\n})`, { filename }).runInThisContext();
    evaluate(localRequire, module, module.exports, filename, dirname(filename));
    return module.exports;
  }
  return load(resolve(project, 'App.tsx')).default;
}

export async function mountApp({ files = ['DSC_0001.JPG', 'DSC_0002.JPG', 'DSC_0003.JPG'], native: nativeOverrides = {} } = {}) {
  const previews = [];
  const saves = [];
  const folder = { id: 'test-shoot', revision: 'scan-1', name: 'Test shoot', scanMs: 0,
    files: files.map(name => ({ name, size: 10 })) };
  const native = {
    apiVersion: 2,
    restoreFolder: async () => folder,
    refreshFolder: async () => folder,
    loadReview: async () => null,
    saveReview: async (folderID, json) => { saves.push({ folderID, document: JSON.parse(json) }); },
    previewCandidates: (revision, names) => new Promise(resolvePreview => { previews.push({ revision, names, resolve: resolvePreview }); }),
    addListener: () => ({ remove() {} }),
    ...nativeOverrides,
  };
  const App = loadApp(native);
  let renderer;
  await act(async () => { renderer = create(React.createElement(App)); });
  const byID = id => renderer.root.findByProps({ testID: id });
  const readText = node => node.children.map(child => typeof child === 'object' ? readText(child) : String(child)).join('');
  return {
    previews, saves, native, folder,
    byID,
    hasID: id => renderer.root.findAllByProps({ testID: id }).length > 0,
    text: id => readText(byID(id)),
    keyboard: () => renderer.root.findByType('PhotoPrunerNativeView'),
    swipe: () => renderer.root.findByType('SwipePhoto'),
    image: () => renderer.root.findByType('Image'),
    modal: () => renderer.root.findByType('Modal'),
    async keys(...keys) {
      await act(async () => {
        const receiver = renderer.root.findByType('PhotoPrunerNativeView');
        for (const key of keys) receiver.props.onCommand({ nativeEvent: { key } });
      });
    },
    async press(id) {
      const button = byID(id);
      assert.equal(button.props.disabled, false, `${id} must accept input`);
      await act(async () => { button.props.onPress(); });
    },
    async resolvePreview(index) {
      assert.ok(previews[index], `Preview request ${index} must exist`);
      await act(async () => { previews[index].resolve(`file:///test-preview-${index}.jpg`); await tick(); });
    },
    async event(callback) { await act(async () => { callback(); }); },
    async unmount() { await act(async () => { renderer.unmount(); await tick(); }); },
  };
}
