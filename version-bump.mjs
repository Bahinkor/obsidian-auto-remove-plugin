import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

const targetVersion = process.env.npm_package_version;
if (!targetVersion) {
  throw new Error('npm_package_version is not set; run this through `npm version`.');
}

const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
manifest.version = targetVersion;
writeFileSync('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);

const versions = JSON.parse(readFileSync('versions.json', 'utf8'));
versions[targetVersion] = manifest.minAppVersion;
writeFileSync('versions.json', `${JSON.stringify(versions, null, 2)}\n`);
