import { describe, expect, it } from 'bun:test';
import fc from 'fast-check';
import type { RelationRecord } from '../store/repositories/relation.repository';
import { DependencyGraph } from './dependency-graph';
import type { IDependencyGraphRepo } from './dependency-graph';

const PROJECT = 'test-project';

const edgeArbitrary = fc.record({
  src: fc.stringMatching(/^\/[a-z]{1,3}\.ts$/),
  dst: fc.stringMatching(/^\/[a-z]{1,3}\.ts$/),
});

const edgesArbitrary = fc.array(edgeArbitrary);

function makeRelation(src: string, dst: string): RelationRecord {
  return {
    project: PROJECT,
    type: 'imports',
    srcFilePath: src,
    srcSymbolName: null,
    dstProject: PROJECT,
    dstFilePath: dst,
    dstSymbolName: null,
    metaJson: null,
  };
}

function buildGraphFromEdges(edges: Array<{ src: string; dst: string }>): DependencyGraph {
  const relations = edges.map(e => makeRelation(e.src, e.dst));
  const repo: IDependencyGraphRepo = {
    getByType(_project: string, _type: string): RelationRecord[] {
      return relations;
    },
  };
  const graph = new DependencyGraph({ relationRepo: repo, project: PROJECT });
  graph.build();
  return graph;
}

describe('DependencyGraph (property-based)', () => {
  it('should satisfy hasCycle() === (getCyclePaths().length > 0) for any graph', () => {
    fc.assert(
      fc.property(edgesArbitrary, (edges) => {
        const graph = buildGraphFromEdges(edges);

        const hasCycle = graph.hasCycle();
        const cyclePaths = graph.getCyclePaths();

        expect(hasCycle).toBe(cyclePaths.length > 0);
      }),
    );
  });

  it('should include C in getTransitiveDependencies(A) when A->B->C chain exists', () => {
    fc.assert(
      fc.property(edgesArbitrary, (extraEdges) => {
        const a = '/a.ts';
        const b = '/b.ts';
        const c = '/c.ts';

        const edges = [
          { src: a, dst: b },
          { src: b, dst: c },
          ...extraEdges,
        ];

        const graph = buildGraphFromEdges(edges);
        const transitiveDeps = graph.getTransitiveDependencies(a);

        expect(transitiveDeps).toContain(c);
      }),
    );
  });

  it('should return getAffectedByChange([A]) as superset of getTransitiveDependents(A) for any node A', () => {
    fc.assert(
      fc.property(
        edgesArbitrary.filter(edges => edges.length > 0),
        (edges) => {
          const graph = buildGraphFromEdges(edges);

          // Pick the first source node from the edges
          const nodeA = edges[0]!.src;

          const affected = new Set(graph.getAffectedByChange([nodeA]));
          const transitiveDependents = graph.getTransitiveDependents(nodeA);

          for (const dep of transitiveDependents) {
            expect(affected.has(dep)).toBe(true);
          }
        },
      ),
    );
  });

  it('should produce identical adjacency list after patchFiles with same data as fresh build', () => {
    fc.assert(
      fc.property(edgesArbitrary, (edges) => {
        // Build the reference graph from scratch
        const referenceGraph = buildGraphFromEdges(edges);
        const referenceAdjacency = referenceGraph.getAdjacencyList();

        // Build a graph, then patch all files with the same relations
        const patchGraph = buildGraphFromEdges(edges);

        const allFiles = new Set<string>();
        for (const e of edges) {
          allFiles.add(e.src);
          allFiles.add(e.dst);
        }
        const changedFiles = Array.from(allFiles);

        const relationsForFile = (filePath: string) =>
          edges
            .filter(e => e.src === filePath)
            .map(e => ({ srcFilePath: e.src, dstFilePath: e.dst }));

        patchGraph.patchFiles(changedFiles, [], relationsForFile);
        const patchedAdjacency = patchGraph.getAdjacencyList();

        // Compare: both maps should have the same keys with the same sorted values
        expect(patchedAdjacency.size).toBe(referenceAdjacency.size);

        for (const [node, deps] of referenceAdjacency) {
          const patchedDeps = patchedAdjacency.get(node);
          expect(patchedDeps).toBeDefined();
          expect([...patchedDeps!].sort()).toEqual([...deps].sort());
        }
      }),
    );
  });

  it('should detect cycle when a self-loop A->A exists', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^\/[a-z]{1,3}\.ts$/),
        edgesArbitrary,
        (selfLoopNode, extraEdges) => {
          const edges = [
            { src: selfLoopNode, dst: selfLoopNode },
            ...extraEdges,
          ];

          const graph = buildGraphFromEdges(edges);

          expect(graph.hasCycle()).toBe(true);
        },
      ),
    );
  });
});
