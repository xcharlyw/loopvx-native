// Copies files the web build must serve as static assets into public/ (runs on `npm install`).
// react-native-audio-api loads its time-stretcher (used for "Tonhöhe halten" warping) at runtime
// from /react-native-audio-api/signalsmithStretch.mjs instead of bundling it.
const fs = require('fs');
const path = require('path');

const src = path.join(
  path.dirname(require.resolve('react-native-audio-api/package.json')),
  'lib/module/web-core/custom/wasm-audio-bufffer-source-node-stretcher/signalsmithStretch',
);
const dest = path.join(__dirname, '..', 'public', 'react-native-audio-api');
fs.mkdirSync(dest, { recursive: true });
// Drop the source-map comment: the .map file isn't served.
const mjs = fs.readFileSync(path.join(src, 'SignalsmithStretch.mjs'), 'utf8').replace(/^\/\/# sourceMappingURL=.*$/m, '');
fs.writeFileSync(path.join(dest, 'signalsmithStretch.mjs'), mjs);
fs.copyFileSync(path.join(src, 'LICENSE.txt'), path.join(dest, 'LICENSE-signalsmith-stretch.txt'));
console.log('copied signalsmithStretch.mjs to public/react-native-audio-api');
