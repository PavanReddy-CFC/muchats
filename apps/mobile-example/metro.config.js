// Monorepo Metro config, per Expo's documented pnpm/monorepo guide
// (https://docs.expo.dev/guides/monorepos/): Metro needs to watch the workspace root and be
// told explicitly where to look for node_modules, since pnpm's symlinked layout otherwise
// confuses its default resolver (bit us specifically on Windows).
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.unstable_enableSymlinks = true;

// packages/ui-kit carries its own React/React Native devDependency (needed for its own
// typecheck/build/tests) which, even pinned to the same version, can still resolve to a
// *different physical copy* once other workspace packages (e.g. apps/admin) pull in a
// different React version and pnpm hoists it somewhere Metro's hierarchical node_modules
// lookup finds first. Two live React instances = "Invalid hook call" / "Cannot read
// properties of null (reading 'useState')" at runtime. `extraNodeModules` alone doesn't fix
// this — it's only a fallback for modules that fail to resolve, not an override for ones
// that already resolve (wrongly) elsewhere — so force it via `resolveRequest` instead.
// context.resolveRequest with an overridden nodeModulesPaths still walks up the tree and
// finds whichever copy sits nearest the *requesting* file, ignoring the override — so bypass
// Metro's resolver entirely for these three and hand back this app's own copy directly via
// Node's own resolution algorithm.
const FORCED_SINGLETONS = new Map(
  ['react', 'react-dom', 'react-native'].map((name) => [
    name,
    require.resolve(name, { paths: [path.resolve(projectRoot, 'node_modules')] }),
  ]),
);

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const forced = FORCED_SINGLETONS.get(moduleName);
  if (forced) {
    return { type: 'sourceFile', filePath: forced };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
