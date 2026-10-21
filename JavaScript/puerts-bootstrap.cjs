const host = require('puerts').argv.getByName('Host');
if (!host) throw new Error('JsGameBridge Host argument missing');
globalThis.__JSGAME_HOST__ = host;
host.Report('Puerts host argument installed; loading canonical ESM next');

// FJsEnv.Start is single-use; load the canonical ESM from this bootstrap.
require(host.GetBundlePath());
