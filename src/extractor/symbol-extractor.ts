import type { ParsedFile } from '../parser/types';
import type { SourceSpan } from '../parser/types';
import type {
  ExtractedSymbol,
  SymbolKind,
  Modifier,
  Heritage,
  Parameter,
  Decorator,
} from './types';
import { buildLineOffsets, getLineColumn } from '../parser/source-position';
import { parseJsDoc } from '../parser/jsdoc-parser';

type OxcSpan = { start: number; end: number };

type OxcTypeAnn = OxcSpan & { typeAnnotation?: OxcSpan };

type OxcDeco = OxcSpan & {
  expression?: OxcSpan & {
    type?: string;
    callee?: { name?: string; property?: { name?: string } };
    arguments?: OxcSpan[];
    name?: string;
  };
};

type OxcParam = OxcSpan & {
  type?: string;
  name?: string;
  optional?: boolean;
  typeAnnotation?: OxcTypeAnn;
  decorators?: OxcDeco[];
  parameter?: OxcParam;
  argument?: OxcParam & { name?: string };
  left?: OxcParam;
  right?: OxcSpan;
  pattern?: { name?: string };
};

type OxcModNode = {
  static?: boolean;
  abstract?: boolean;
  readonly?: boolean;
  override?: boolean;
  declare?: boolean;
  const?: boolean;
  accessibility?: string;
  async?: boolean;
};

type OxcMember = OxcSpan & OxcModNode & {
  type?: string;
  key?: { name?: string };
  value?: OxcSpan & OxcModNode & { params?: OxcParam[]; returnType?: OxcTypeAnn };
  kind?: string;
  params?: OxcParam[];
  returnType?: OxcTypeAnn;
  typeAnnotation?: OxcTypeAnn;
};

type OxcNode = OxcSpan & OxcModNode & {
  type?: string;
  name?: string;
  id?: { name?: string };
  params?: OxcParam[];
  returnType?: OxcTypeAnn;
  typeAnnotation?: OxcTypeAnn;
  body?: {
    body?: OxcMember[];
    members?: Array<OxcSpan & { id?: { name?: string; value?: string } }>;
  };
  decorators?: OxcDeco[];
  typeParameters?: { params?: Array<{ name?: { name?: string } }> };
  superClass?: OxcSpan;
  implements?: Array<OxcSpan & { expression?: OxcSpan }>;
  extends?: Array<OxcSpan & { expression?: OxcSpan }>;
  declarations?: Array<OxcSpan & {
    id?: OxcNode & {
      properties?: Array<OxcSpan & { value?: { name?: string }; key?: { name?: string } }>;
      elements?: Array<(OxcSpan & { type?: string; name?: string }) | null>;
    };
    init?: OxcNode;
  }>;
};

export function extractSymbols(parsed: ParsedFile): ExtractedSymbol[] {
  const { program, sourceText, comments } = parsed;
  const lineOffsets = buildLineOffsets(sourceText);

  function span(start: number, end: number): SourceSpan {
    return {
      start: getLineColumn(lineOffsets, start),
      end: getLineColumn(lineOffsets, end),
    };
  }

  function findJsDocComment(nodeStart: number): string | undefined {
    let best: { value: string; end: number } | null = null;
    for (const c of comments) {
      if (c.type !== 'Block') continue;
      if (c.end > nodeStart) continue;
      if (!c.value.startsWith('*')) continue;
      if (!best || c.end > best.end) {
        best = { value: `/*${c.value}*/`, end: c.end };
      }
    }
    if (!best) return undefined;

    for (const stmt of program.body) {
      const stmtStart = (stmt as { start?: number }).start ?? 0;
      if (stmtStart === nodeStart) continue;
      if (stmtStart > best.end && stmtStart < nodeStart) {
        return undefined;
      }
    }

    return best.value;
  }

  function typeText(typeAnnotation: OxcTypeAnn | null | undefined): string | undefined {
    if (!typeAnnotation) return undefined;
    const inner = typeAnnotation.typeAnnotation ?? typeAnnotation;
    return sourceText.slice(inner.start, inner.end);
  }

  function extractDecorators(decorators: OxcDeco[]): Decorator[] {
    if (!decorators || decorators.length === 0) return [];
    return decorators.map((d) => {
      const expr = d.expression;
      if (!expr) return { name: 'unknown' };
      if (expr.type === 'CallExpression') {
        const name = expr.callee?.name ?? expr.callee?.property?.name ?? 'unknown';
        const args = (expr.arguments ?? []).map((a: OxcSpan) => sourceText.slice(a.start, a.end));
        return { name, arguments: args.length > 0 ? args : undefined };
      }
      if (expr.type === 'Identifier') return { name: expr.name ?? 'unknown' };
      return { name: sourceText.slice(expr.start, expr.end) };
    });
  }

  function extractParam(p: OxcParam): Parameter {
    const inner = p.type === 'TSParameterProperty' ? p.parameter : p;

    if (inner?.type === 'RestElement') {
      const argName: string = inner.argument?.name ?? 'unknown';
      const name = `...${argName}`;
      const typeAnn = inner.typeAnnotation;
      const type = typeAnn ? typeText(typeAnn) : undefined;
      const param: Parameter = { name, isOptional: false };
      if (type) param.type = type;
      return param;
    }

    if (inner?.type === 'AssignmentPattern') {
      const left = inner.left;
      const right = inner.right;
      const name: string = left?.name ?? 'unknown';
      const typeAnn = left?.typeAnnotation;
      const type = typeAnn ? typeText(typeAnn) : undefined;
      const defaultValue: string = sourceText.slice(right!.start, right!.end);
      const decos = extractDecorators(left?.decorators ?? []);
      const param: Parameter = { name, isOptional: true, defaultValue };
      if (type) param.type = type;
      if (decos.length > 0) param.decorators = decos;
      return param;
    }

    const name: string = inner?.name ?? inner?.pattern?.name ?? 'unknown';
    const optional: boolean = !!(inner?.optional);
    const typeAnn = inner?.typeAnnotation;
    const type = typeAnn ? typeText(typeAnn) : undefined;
    const decos = extractDecorators(inner?.decorators ?? []);
    const param: Parameter = { name, isOptional: optional };
    if (type) param.type = type;
    if (decos.length > 0) param.decorators = decos;
    return param;
  }

  function extractModifiers(node: OxcModNode, fn?: OxcModNode): Modifier[] {
    const mods: Modifier[] = [];
    if (fn?.async) mods.push('async');
    if (node.static) mods.push('static');
    if (node.abstract) mods.push('abstract');
    if (node.readonly) mods.push('readonly');
    if (node.override) mods.push('override');
    if (node.declare) mods.push('declare');
    if (node.const) mods.push('const');
    const acc = node.accessibility;
    if (acc === 'private') mods.push('private');
    else if (acc === 'protected') mods.push('protected');
    else if (acc === 'public') mods.push('public');
    return mods;
  }

  function classHeritage(node: OxcNode): Heritage[] {
    const heritage: Heritage[] = [];
    if (node.superClass) {
      const name = sourceText.slice(node.superClass.start, node.superClass.end);
      heritage.push({ kind: 'extends', name });
    }
    const impls = node.implements ?? [];
    for (const impl of impls) {
      const expr = impl.expression ?? impl;
      const name = sourceText.slice(expr.start, expr.end);
      heritage.push({ kind: 'implements', name });
    }
    return heritage;
  }

  function interfaceHeritage(node: OxcNode): Heritage[] {
    const heritage: Heritage[] = [];
    for (const ext of (node.extends ?? [])) {
      const expr = ext.expression ?? ext;
      const name = sourceText.slice(expr.start, expr.end);
      heritage.push({ kind: 'extends', name });
    }
    return heritage;
  }

  function extractClassMembers(bodyNodes: OxcMember[]): ExtractedSymbol[] {
    const members: ExtractedSymbol[] = [];
    for (const m of bodyNodes) {
      if (m.type === 'MethodDefinition') {
        const name: string = m.key?.name ?? 'unknown';
        const fnValue = m.value;
        const rawKind: string = m.kind ?? 'method';
        const methodKind =
          rawKind === 'constructor'
            ? 'constructor'
            : rawKind === 'get'
              ? 'getter'
              : rawKind === 'set'
                ? 'setter'
                : 'method';
        const mods = extractModifiers(m, fnValue);
        const params = (fnValue?.params ?? []).map(extractParam);
        const returnType = typeText(fnValue?.returnType);
        const s: ExtractedSymbol = {
          kind: 'method',
          name,
          span: span(m.start, m.end),
          isExported: false,
          methodKind,
          modifiers: mods,
          parameters: params.length > 0 ? params : undefined,
          returnType,
        };
        members.push(s);
      } else if (m.type === 'PropertyDefinition') {
        const name: string = m.key?.name ?? 'unknown';
        const mods = extractModifiers(m);
        const s: ExtractedSymbol = {
          kind: 'property',
          name,
          span: span(m.start, m.end),
          isExported: false,
          modifiers: mods,
        };
        members.push(s);
      }
    }
    return members;
  }

  function extractInterfaceMembers(bodyNodes: OxcMember[]): ExtractedSymbol[] {
    const members: ExtractedSymbol[] = [];
    for (const m of bodyNodes) {
      if (m.type === 'TSMethodSignature') {
        const name: string = m.key?.name ?? 'unknown';
        const params = (m.params ?? []).map(extractParam);
        const returnType = typeText(m.returnType);
        members.push({
          kind: 'method',
          name,
          span: span(m.start, m.end),
          isExported: false,
          modifiers: [],
          methodKind: 'method',
          parameters: params.length > 0 ? params : undefined,
          returnType,
        });
      } else if (m.type === 'TSPropertySignature') {
        const name: string = m.key?.name ?? 'unknown';
        const typeAnn = typeText(m.typeAnnotation);
        const s: ExtractedSymbol = {
          kind: 'property',
          name,
          span: span(m.start, m.end),
          isExported: false,
          modifiers: m.readonly ? ['readonly'] : [],
          returnType: typeAnn,
        };
        members.push(s);
      }
    }
    return members;
  }

  function buildSymbol(node: OxcNode, isExported: boolean): ExtractedSymbol | ExtractedSymbol[] | null {
    const type: string = node.type ?? '';

    if (type === 'FunctionDeclaration') {
      const name: string = node.id?.name ?? 'default';
      const params = (node.params ?? []).map(extractParam);
      const returnType = typeText(node.returnType);
      const mods = extractModifiers(node, node);
      const decos = extractDecorators(node.decorators ?? []);
      const typeParameters: string[] | undefined =
        node.typeParameters?.params?.map((p: { name?: { name?: string } }) => p.name?.name as string).filter(Boolean) || undefined;
      const sym: ExtractedSymbol = {
        kind: 'function',
        name,
        span: span(node.start, node.end),
        isExported,
        modifiers: mods,
        parameters: params.length > 0 ? params : undefined,
        returnType,
        decorators: decos.length > 0 ? decos : undefined,
      };
      if (typeParameters && typeParameters.length > 0) sym.typeParameters = typeParameters;
      return sym;
    }

    if (type === 'ClassDeclaration' || type === 'ClassExpression') {
      const name: string = node.id?.name ?? 'default';
      const heritage = classHeritage(node);
      const members = extractClassMembers(node.body?.body ?? []);
      const decos = extractDecorators(node.decorators ?? []);
      const mods = extractModifiers(node, node);
      const typeParameters: string[] | undefined =
        node.typeParameters?.params?.map((p: { name?: { name?: string } }) => p.name?.name as string).filter(Boolean) || undefined;
      const sym: ExtractedSymbol = {
        kind: 'class',
        name,
        span: span(node.start, node.end),
        isExported,
        modifiers: mods,
        heritage: heritage.length > 0 ? heritage : undefined,
        members: members.length > 0 ? members : undefined,
        decorators: decos.length > 0 ? decos : undefined,
      };
      if (typeParameters && typeParameters.length > 0) sym.typeParameters = typeParameters;
      return sym;
    }

    if (type === 'VariableDeclaration') {
      const symbols: ExtractedSymbol[] = [];
      for (const decl of node.declarations ?? []) {
        const id = decl.id;
        const init = decl.init;

        if (id?.type === 'ObjectPattern') {
          for (const prop of id.properties ?? []) {
            const propName: string = prop.value?.name ?? prop.key?.name ?? 'unknown';
            symbols.push({
              kind: 'variable' as SymbolKind,
              name: propName,
              span: span(prop.start ?? decl.start, prop.end ?? decl.end),
              isExported,
              modifiers: [],
            });
          }
          continue;
        }

        if (id?.type === 'ArrayPattern') {
          for (const elem of id.elements ?? []) {
            if (!elem || elem.type !== 'Identifier') continue;
            const elemName: string = elem.name ?? 'unknown';
            symbols.push({
              kind: 'variable' as SymbolKind,
              name: elemName,
              span: span(elem.start ?? decl.start, elem.end ?? decl.end),
              isExported,
              modifiers: [],
            });
          }
          continue;
        }

        const name: string = id?.name ?? 'unknown';
        let kind: SymbolKind = 'variable';
        let params: Parameter[] | undefined;
        let returnType: string | undefined;

        if (
          init?.type === 'FunctionExpression' ||
          init?.type === 'ArrowFunctionExpression'
        ) {
          kind = 'function';
          const rawParams = init.params ?? [];
          params = rawParams.map(extractParam);
          returnType = typeText(init.returnType);
        }
        const mods: Modifier[] = [];
        symbols.push({
          kind,
          name,
          span: span(decl.start, decl.end),
          isExported,
          modifiers: mods,
          parameters: params,
          returnType,
        });
      }
      if (symbols.length === 0) return null;
      if (symbols.length === 1) return symbols[0]!;
      return symbols;
    }

    if (type === 'TSTypeAliasDeclaration') {
      const name: string = node.id?.name ?? 'unknown';
      return {
        kind: 'type',
        name,
        span: span(node.start, node.end),
        isExported,
        modifiers: [],
      };
    }

    if (type === 'TSInterfaceDeclaration') {
      const name: string = node.id?.name ?? 'unknown';
      const heritage = interfaceHeritage(node);
      const members = extractInterfaceMembers(node.body?.body ?? []);
      const typeParameters: string[] | undefined =
        node.typeParameters?.params?.map((p: { name?: { name?: string } }) => p.name?.name as string).filter(Boolean) || undefined;
      const sym: ExtractedSymbol = {
        kind: 'interface',
        name,
        span: span(node.start, node.end),
        isExported,
        modifiers: [],
        heritage: heritage.length > 0 ? heritage : undefined,
        members: members.length > 0 ? members : undefined,
      };
      if (typeParameters && typeParameters.length > 0) sym.typeParameters = typeParameters;
      return sym;
    }

    if (type === 'TSEnumDeclaration') {
      const name: string = node.id?.name ?? 'unknown';
      const mods = extractModifiers(node);
      const rawMembers: Array<OxcSpan & { id?: { name?: string; value?: string } }> = node.body?.members ?? [];
      const members: ExtractedSymbol[] = rawMembers.map((m) => ({
        kind: 'property' as SymbolKind,
        name: m.id?.name ?? m.id?.value ?? 'unknown',
        span: span(m.start, m.end),
        isExported: false,
        modifiers: [],
      }));
      return {
        kind: 'enum',
        name,
        span: span(node.start, node.end),
        isExported,
        modifiers: mods,
        members: members.length > 0 ? members : undefined,
      };
    }

    return null;
  }

  const result: ExtractedSymbol[] = [];

  for (const node of program.body) {
    let sym: ExtractedSymbol | ExtractedSymbol[] | null = null;
    const record = node as unknown as Record<string, unknown>;
    const type: string = typeof record.type === 'string' ? record.type : '';

    if (type === 'ExportNamedDeclaration') {
      const n = node as unknown as {
        declaration?: unknown;
        start: number;
        end: number;
      };
      if (n.declaration) {
        sym = buildSymbol(n.declaration as OxcNode, true);
        if (sym && !Array.isArray(sym)) {
          sym.span = span(n.start, n.end);
        } else if (Array.isArray(sym)) {
          for (const s of sym) s.span = span(n.start, n.end);
        }
      }
    } else if (type === 'ExportDefaultDeclaration') {
      const n = node as unknown as {
        declaration?: { id?: { name?: string } } & Record<string, unknown>;
        start: number;
        end: number;
      };
      const decl = n.declaration;
      if (decl) {
        sym = buildSymbol(decl as unknown as OxcNode, true);
        if (sym && !Array.isArray(sym)) {
          sym.name = decl.id?.name ?? 'default';
          sym.isExported = true;
          sym.span = span(n.start, n.end);
        }
      }
    } else {
      sym = buildSymbol(node as unknown as OxcNode, false);
    }

    const syms: ExtractedSymbol[] = Array.isArray(sym) ? sym : sym ? [sym] : [];
    for (const s of syms) {
      const nodeStart = (node as { start?: number }).start ?? 0;
      const jsdocText = findJsDocComment(nodeStart);
      if (jsdocText) {
        s.jsDoc = parseJsDoc(jsdocText);
      }
      result.push(s);
    }
  }

  return result;
}
