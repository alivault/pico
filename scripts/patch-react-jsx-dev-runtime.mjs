import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import process from "node:process"

const reactRuntimePath = join(
  process.cwd(),
  ".output",
  "server",
  "_libs",
  "react.mjs"
)

if (!existsSync(reactRuntimePath)) {
  console.warn(
    "Pico postbuild: React runtime bundle not found, skipping patch."
  )
  process.exit(0)
}

const source = readFileSync(reactRuntimePath, "utf8")
const oldRuntime = `var require_react_jsx_dev_runtime_production = /* @__PURE__ */ __commonJSMin(((exports) => {
\texports.Fragment = Symbol.for("react.fragment");
\texports.jsxDEV = void 0;
}));`

const patchedRuntime = `var require_react_jsx_dev_runtime_production = /* @__PURE__ */ __commonJSMin(((exports) => {
\tvar REACT_ELEMENT_TYPE = Symbol.for("react.transitional.element"), REACT_FRAGMENT_TYPE = Symbol.for("react.fragment");
\tfunction jsxProd(type, config, maybeKey) {
\t\tvar key = null, propName, props;
\t\tvoid 0 !== maybeKey && (key = "" + maybeKey);
\t\tconfig == null && (config = {});
\t\tvoid 0 !== config.key && (key = "" + config.key);
\t\tif ("key" in config) {
\t\t\tprops = {};
\t\t\tfor (propName in config) "key" !== propName && (props[propName] = config[propName]);
\t\t} else props = config;
\t\tconfig = props.ref;
\t\treturn {
\t\t\t$$typeof: REACT_ELEMENT_TYPE,
\t\t\ttype: type,
\t\t\tkey: key,
\t\t\tref: void 0 !== config ? config : null,
\t\t\tprops: props
\t\t};
\t}
\texports.Fragment = REACT_FRAGMENT_TYPE;
\texports.jsxDEV = jsxProd;
}));`

if (!source.includes(oldRuntime)) {
  console.warn(
    "Pico postbuild: React jsxDEV runtime did not match, skipping patch."
  )
  process.exit(0)
}

writeFileSync(
  reactRuntimePath,
  source.replace(oldRuntime, () => patchedRuntime)
)
console.log("Pico postbuild: patched React jsxDEV runtime for SSR.")

const ssrDir = join(process.cwd(), ".output", "server", "_ssr")
let patchedVoidCalls = 0

if (existsSync(ssrDir)) {
  for (const entry of readdirSync(ssrDir)) {
    if (!entry.endsWith(".mjs")) continue

    const filePath = join(ssrDir, entry)
    const chunk = readFileSync(filePath, "utf8")
    if (
      !chunk.includes("var import_jsx_dev_runtime = require_jsx_dev_runtime();")
    ) {
      continue
    }

    const nextChunk = chunk.replaceAll(
      "(void 0)(",
      "(0, import_jsx_dev_runtime.jsxDEV)("
    )
    if (nextChunk === chunk) continue

    writeFileSync(filePath, nextChunk)
    patchedVoidCalls += 1
  }
}

if (patchedVoidCalls > 0) {
  console.log(
    `Pico postbuild: patched ${patchedVoidCalls} SSR chunk(s) with jsxDEV calls.`
  )
}
