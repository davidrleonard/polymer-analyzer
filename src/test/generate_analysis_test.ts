/**
 * @license
 * Copyright (c) 2016 The Polymer Project Authors. All rights reserved.
 * This code may only be used under the BSD style license found at
 * http://polymer.github.io/LICENSE.txt
 * The complete set of authors may be found at
 * http://polymer.github.io/AUTHORS.txt
 * The complete set of contributors may be found at
 * http://polymer.github.io/CONTRIBUTORS.txt
 * Code distributed by Google as part of the polymer project is also
 * subject to an additional IP rights grant found at
 * http://polymer.github.io/PATENTS.txt
 */

import {assert} from 'chai';
import * as fs from 'fs';
import * as path from 'path';

import {Analysis} from '../analysis-format';
import {Analyzer} from '../analyzer';
import {generateAnalysis, validateAnalysis, ValidationError} from '../generate-analysis';
import {AnalysisResult} from '../model/analysis-result';
import {FSUrlLoader} from '../url-loader/fs-url-loader';
import {PackageUrlResolver} from '../url-loader/package-url-resolver';

const onlyTests = new Set<string>([]);  // Should be empty when not debugging.

// TODO(rictic): work out how we want to handle ignoring elements from other
//     packages in the world of Document rather than Analysis.
const skipTests = new Set<string>(['bower_packages', 'nested-packages']);


suite('generate-analysis', () => {

  suite('generateAnalysisMetadata', () => {

    suite('generates for Document array from fixtures', () => {
      const basedir = path.join(__dirname, 'static', 'analysis');
      const analysisFixtureDirs =
          fs.readdirSync(basedir)
              .map((p) => path.join(basedir, p))
              .filter((p) => fs.statSync(p).isDirectory());

      for (const analysisFixtureDir of analysisFixtureDirs) {
        // Generate a test from the goldens found in every dir in
        // src/test/static/analysis/
        const testBaseName = path.basename(analysisFixtureDir);
        const testDefiner = onlyTests.has(testBaseName) ?
            test.only :
            skipTests.has(testBaseName) ? test.skip : test;
        const testName = `produces a correct analysis.json ` +
            `for fixture dir \`${testBaseName}\``;

        testDefiner(testName, async() => {
          // Test body here:
          const documents = await analyzeDir(analysisFixtureDir);

          const packages = new Set<string>(mapI(
              filterI(
                  walkRecursively(analysisFixtureDir),
                  (p) =>
                      p.endsWith('bower.json') || p.endsWith('package.json')),
              (p) => path.dirname(p)));
          if (packages.size === 0) {
            packages.add(analysisFixtureDir);
          }
          for (const packagePath of packages) {
            const pathToGolden = path.join(packagePath || '', 'analysis.json');
            const renormedPackagePath = packagePath ?
                packagePath.substring(analysisFixtureDir.length + 1) :
                packagePath;
            const analyzedPackages =
                generateAnalysis(documents, renormedPackagePath);
            validateAnalysis(analyzedPackages);

            const golden: Analysis =
                JSON.parse(fs.readFileSync(pathToGolden, 'utf-8'));

            // // we don't care about the order of properties or attributes
            // for (const analysis of [analyzedPackages, golden]) {
            //   for (const type
            //            of ['elements', 'mixins'] as ['elements', 'mixins']) {
            //     const vals = analysis[type];
            //     if (!vals) {
            //       continue;
            //     }
            //     for (const val of vals) {
            //       if (val.properties) {
            //         val.properties.sort(
            //             (p1, p2) => p1.name.localeCompare(p2.name));
            //       }
            //       if (val.attributes) {
            //         val.attributes.sort(
            //             (a1, a2) => a1.name.localeCompare(a2.name));
            //       }
            //     }
            //   }
            // }


            try {
              const shortPath = path.relative(__dirname, pathToGolden);
              assert.deepEqual(
                  analyzedPackages,
                  golden,
                  `Generated form of ${shortPath} ` +
                      `differs from the golden at that path`);
            } catch (e) {
              console.log(
                  `Expected contents of ${pathToGolden}:\n` +
                  `${JSON.stringify(analyzedPackages, null, 2)}`);
              throw e;
            }
          }
        });
      }
    });

    suite('generates from package', () => {

      test('does not include external features', async() => {
        const basedir =
            path.resolve(__dirname, 'static/analysis/bower_packages');
        const analyzer = new Analyzer({
          urlLoader: new FSUrlLoader(basedir),
          urlResolver: new PackageUrlResolver(),
        });
        const _package = await analyzer.analyzePackage();
        const metadata = generateAnalysis(_package, '');
        // The fixture only contains external elements
        assert.isUndefined(metadata.elements);
      });

      test('includes package features', async() => {
        const basedir = path.resolve(__dirname, 'static/analysis/simple');
        const analyzer = new Analyzer({
          urlLoader: new FSUrlLoader(basedir),
          urlResolver: new PackageUrlResolver(),
        });
        const _package = await analyzer.analyzePackage();
        const metadata = generateAnalysis(_package, '');
        assert.equal(metadata.elements && metadata.elements.length, 1);
        assert.equal(metadata.elements![0].tagname, 'simple-element');
        assert.equal(metadata.elements![0].path, 'simple-element.html');
      });

    });

  });

  suite('validateAnalysis', () => {

    test('throws when validating valid analysis.json', () => {
      try {
        validateAnalysis({} as any);
      } catch (err) {
        assert.instanceOf(err, ValidationError);
        const valError: ValidationError = err;
        assert(valError.errors.length > 0);
        assert.include(valError.message, `requires property "schema_version"`);
        return;
      }
      throw new Error('expected Analysis validation to fail!');
    });

    test(`doesn't throw when validating a valid analysis.json`, () => {
      validateAnalysis({elements: [], schema_version: '1.0.0'});
    });

    test(`doesn't throw when validating a version from the future`, () => {
      validateAnalysis(<any>{
        elements: [],
        schema_version: '1.0.1',
        new_field: 'stuff here'
      });
    });

    test(`throws when validating a bad version`, () => {
      try {
        validateAnalysis(<any>{
          elements: [],
          schema_version: '5.1.1',
          new_field: 'stuff here'
        });
      } catch (e) {
        assert.include(e.message, 'Invalid schema_version in AnalyzedPackage');
        return;
      }
      throw new Error('expected Analysis validation to fail!');
    });
  });

});

function* filterI<T>(it: Iterable<T>, pred: (t: T) => boolean): Iterable<T> {
  for (const inst of it) {
    if (pred(inst)) {
      yield inst;
    }
  }
}

function* mapI<T, U>(it: Iterable<T>, trans: (t: T) => U): Iterable<U> {
  for (const inst of it) {
    yield trans(inst);
  }
}

function* walkRecursively(dir: string): Iterable<string> {
  for (const filename of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, filename);
    if (fs.statSync(fullPath).isDirectory()) {
      for (const f of walkRecursively(fullPath)) {
        yield f;
      }
    } else {
      yield fullPath;
    }
  }
}

async function analyzeDir(baseDir: string): Promise<AnalysisResult> {
  const analyzer = new Analyzer({
    urlLoader: new FSUrlLoader(baseDir),
    urlResolver: new PackageUrlResolver(),
  });
  const allFilenames = Array.from(walkRecursively(baseDir));
  const htmlOrJsFilenames =
      allFilenames.filter((f) => f.endsWith('.html') || f.endsWith('.js'));
  const filePaths =
      htmlOrJsFilenames.map((filename) => path.relative(baseDir, filename));
  return analyzer.analyze(filePaths);
}
