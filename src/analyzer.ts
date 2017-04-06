/**
 * @license
 * Copyright (c) 2015 The Polymer Project Authors. All rights reserved.
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

/// <reference path="../custom_typings/main.d.ts" />

import * as path from 'path';

import {AnalysisContext} from './core/analysis-context';
import {Warning} from './index';
import {AnalysisResult, Document} from './model/model';
import {Parser} from './parser/parser';
import {Scanner} from './scanning/scanner';
import {UrlLoader} from './url-loader/url-loader';
import {UrlResolver} from './url-loader/url-resolver';

export interface Options {
  urlLoader: UrlLoader;
  urlResolver?: UrlResolver;
  parsers?: Map<string, Parser<any>>;
  scanners?: ScannerTable;
  /*
   * Map from url of an HTML Document to another HTML document it lazily depends
   * on.
   */
  lazyEdges?: LazyEdgeMap;
}

/**
 * These are the options available to the `_fork` method.  Currently, only the
 * `urlLoader` override is implemented.
 */
export interface ForkOptions { urlLoader?: UrlLoader; }

export class NoKnownParserError extends Error {};

export type ScannerTable = Map<string, Scanner<any, any, any>[]>;
export type LazyEdgeMap = Map<string, string[]>;

/**
 * A static analyzer for web projects.
 *
 * An Analyzer can load and parse documents of various types, and extract
 * arbitrary information from the documents, and transitively load
 * dependencies. An Analyzer instance is configured with parsers, and scanners
 * which do the actual work of understanding different file types.
 */
export class Analyzer {
  private _analysisComplete: Promise<AnalysisContext>;
  private _urlResolver: UrlResolver;

  constructor(options: Options|AnalysisContext) {
    const context = (options instanceof AnalysisContext) ?
        options :
        new AnalysisContext(options);
    this._urlResolver = context._resolver;
    this._analysisComplete = Promise.resolve(context);
  }

  /**
   * Loads, parses and analyzes the root document of a dependency graph and its
   * transitive dependencies.
   */
  async analyze(urls: string[]): Promise<AnalysisResult> {
    const previousAnalysisComplete = this._analysisComplete;
    this._analysisComplete = (async() => {
      const previousContext = await previousAnalysisComplete;
      return await previousContext.analyze(urls);
    })();
    const context = await this._analysisComplete;
    const results = new Map(urls.map(
        (url) => [url, context.getDocument(url)] as
            [string, Document | Warning]));
    return new AnalysisResult(results);
  }

  async analyzePackage(): Promise<AnalysisResult> {
    const previousAnalysisComplete = this._analysisComplete;
    let _package: AnalysisResult|null = null;
    this._analysisComplete = (async() => {
      const previousContext = await previousAnalysisComplete;
      if (!previousContext._loader.readDirectory) {
        throw new Error(
            `This analyzer doesn't support analyzerPackage, ` +
            `the urlLoader can't list the files in a directory.`);
      }
      const allFiles = await previousContext._loader.readDirectory('', true);
      // TODO(rictic): parameterize this, perhaps with polymer.json.
      const filesInPackage =
          allFiles.filter((file) => !AnalysisResult.isExternal(file));
      const extensions = new Set(previousContext._parsers.keys());
      const filesWithParsers = filesInPackage.filter(
          (fn) => extensions.has(path.extname(fn).substring(1)));

      const newContext = await previousContext.analyze(filesWithParsers);

      const documentsOrWarnings = new Map(filesWithParsers.map(
          (url) => [url, newContext.getDocument(url)] as
              [string, Document | Warning]));
      _package = new AnalysisResult(documentsOrWarnings);
      return newContext;
    })();
    await this._analysisComplete;
    return _package!;
  }

  /**
   * Clears all information about the given files from our caches, such that
   * future calls to analyze() will reload these files if they're needed.
   *
   * The analyzer assumes that if this method isn't called with a file's url,
   * then that file has not changed and does not need to be reloaded.
   *
   * @param urls The urls of files which may have changed.
   */
  async filesChanged(urls: string[]): Promise<void> {
    const previousAnalysisComplete = this._analysisComplete;
    this._analysisComplete = (async() => {
      const previousContext = await previousAnalysisComplete;
      return await previousContext.filesChanged(urls);
    })();
    await this._analysisComplete;
  }

  /**
   * Clear all cached information from this analyzer instance.
   *
   * Note: if at all possible, instead tell the analyzer about the specific
   * files that changed rather than clearing caches like this. Caching provides
   * large performance gains.
   */
  async clearCaches(): Promise<void> {
    const previousAnalysisComplete = this._analysisComplete;
    this._analysisComplete = (async() => {
      const previousContext = await previousAnalysisComplete;
      return await previousContext.clearCaches();
    })();
    await this._analysisComplete;
  }

  /**
   * Returns a copy of the analyzer.  If options are given, the AnalysisContext
   * is also forked and individual properties are overridden by the options.
   * is forked with the given options.
   *
   * When the analysis context is forked, its cache is preserved, so you will
   * see a mixture of pre-fork and post-fork contents when you analyze with a
   * forked analyzer.
   *
   * Note: this feature is experimental. It may be removed without being
   *     considered a breaking change, so check for its existence before calling
   *     it.
   */
  async _fork(options?: ForkOptions): Promise<Analyzer> {
    const context = options ?
        (await this._analysisComplete)._fork(undefined, options) :
        (await this._analysisComplete);
    return new Analyzer(context);
  }

  /**
   * Loads the content at the provided resolved URL.
   */
  async load(resolvedUrl: string) {
    return (await this._analysisComplete).load(resolvedUrl);
  }

  canResolveUrl(url: string): boolean {
    return this._urlResolver.canResolve(url);
  }

  resolveUrl(url: string): string {
    return this._urlResolver.resolve(url);
  }
}
