export { extractSymbols } from './symbol-extractor';
export { extractAnnotations } from './annotation-extractor';
export { extractRelations } from './relation-extractor';
export { extractImports } from './imports-extractor';
export { extractCalls } from './calls-extractor';
export { extractHeritage } from './heritage-extractor';
export { resolveImport, buildImportMap } from './extractor-utils';
export type {
  ExtractedSymbol,
  SymbolKind,
  CodeRelation,
  Parameter,
  Modifier,
  Heritage,
  Decorator,
  JsDocBlock,
  JsDocTag,
  ImportReference,
  QualifiedName,
  AnnotationSource,
  ExtractedAnnotation,
} from './types';
