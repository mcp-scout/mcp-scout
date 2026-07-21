export type IndexedTool = {
  server: string;
  name: string;
  description: string;
};

export type ScoredMatch = {
  id: string;
  server: string;
  name: string;
  description: string;
  score: number;
};

/** Tunable ranking parameters for the bm25 strategy. All optional; unset fields keep their default. */
export type Bm25Options = {
  nameWeight?: number;
  serverWeight?: number;
  descriptionWeight?: number;
  substringBonus?: number;
  descriptionTruncateLength?: number;
  defaultLimit?: number;
};

export const DEFAULT_BM25_OPTIONS: Required<Bm25Options> = {
  nameWeight: 3,
  serverWeight: 3,
  descriptionWeight: 1,
  substringBonus: 5,
  descriptionTruncateLength: 200,
  defaultLimit: 10,
};

function tokenize(text: string): string[] {
  const withSpacedCamelCase = text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  return withSpacedCamelCase
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
}

function namespacedId(tool: IndexedTool): string {
  return `${tool.server}.${tool.name}`;
}

function weightedTermFrequencies(tool: IndexedTool, opts: Required<Bm25Options>): Map<string, number> {
  const freqs = new Map<string, number>();
  const add = (tokens: string[], weight: number) => {
    for (const token of tokens) {
      freqs.set(token, (freqs.get(token) ?? 0) + weight);
    }
  };
  add(tokenize(tool.name), opts.nameWeight);
  // Index the server name too, so a query token like "grafana" boosts that
  // server's tools; without this the server name is unsearchable and
  // "grafana dashboards" can rank a same-keyword tool on another server first.
  add(tokenize(tool.server), opts.serverWeight);
  add(tokenize(tool.description), opts.descriptionWeight);
  return freqs;
}

/**
 * Build a bm25 search strategy with custom ranking weights. Unset options fall
 * back to DEFAULT_BM25_OPTIONS. Used both for the default `searchTools` export
 * and for per-deployment tuning via config (`search.options`).
 */
export function createBm25Strategy(options: Bm25Options = {}): SearchStrategy {
  const opts: Required<Bm25Options> = { ...DEFAULT_BM25_OPTIONS, ...options };

  return function bm25(
    index: IndexedTool[],
    query: string,
    limit = opts.defaultLimit,
  ): ScoredMatch[] {
    const queryTokens = [...new Set(tokenize(query))];
    if (queryTokens.length === 0 || index.length === 0) {
      return [];
    }

    const docFrequencies = index.map((tool) => weightedTermFrequencies(tool, opts));

    const documentFrequency = new Map<string, number>();
    for (const freqs of docFrequencies) {
      for (const token of freqs.keys()) {
        documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
      }
    }

    const totalDocs = index.length;
    const idf = (token: string): number => {
      const df = documentFrequency.get(token) ?? 0;
      return Math.log(1 + (totalDocs - df + 0.5) / (df + 0.5));
    };

    const lowerQuery = query.trim().toLowerCase();

    const scored: ScoredMatch[] = index.map((tool, i) => {
      const freqs = docFrequencies[i];
      let score = 0;
      for (const token of queryTokens) {
        const tf = freqs.get(token) ?? 0;
        if (tf > 0) {
          score += idf(token) * tf;
        }
      }
      if (lowerQuery.length > 0 && namespacedId(tool).toLowerCase().includes(lowerQuery)) {
        score += opts.substringBonus;
      }
      return {
        id: namespacedId(tool),
        server: tool.server,
        name: tool.name,
        description:
          tool.description.length > opts.descriptionTruncateLength
            ? `${tool.description.slice(0, opts.descriptionTruncateLength)}...`
            : tool.description,
        score,
      };
    });

    return scored
      .filter((match) => match.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  };
}

/** The default bm25 strategy, using DEFAULT_BM25_OPTIONS. */
export const searchTools: SearchStrategy = createBm25Strategy();

/**
 * A search strategy ranks the tool index for a query. Built-ins are selected by
 * name via config/CLI; library consumers can pass their own function directly to
 * buildGateway(). May be async so future strategies (e.g. embeddings) fit the same seam.
 */
export type SearchStrategy = (
  index: IndexedTool[],
  query: string,
  limit: number,
) => ScoredMatch[] | Promise<ScoredMatch[]>;

export const DEFAULT_SEARCH_STRATEGY = "bm25";

// `searchTools` is a BM25-flavored weighted TF-IDF ranker — the default built-in.
export const BUILTIN_SEARCH_STRATEGIES: Record<string, SearchStrategy> = {
  bm25: searchTools,
};

/**
 * Resolve a built-in strategy by name; throws with the available names if unknown.
 * `options` tunes bm25's ranking weights (see Bm25Options) — ignored by other
 * strategies. Passing no options returns the shared default `searchTools` instance.
 */
export function resolveSearchStrategy(
  name: string = DEFAULT_SEARCH_STRATEGY,
  options?: Bm25Options,
): SearchStrategy {
  if (name === "bm25" && options && Object.keys(options).length > 0) {
    return createBm25Strategy(options);
  }

  const strategy = BUILTIN_SEARCH_STRATEGIES[name];
  if (!strategy) {
    const available = Object.keys(BUILTIN_SEARCH_STRATEGIES).join(", ");
    throw new Error(`Unknown search strategy "${name}". Available: ${available}`);
  }
  return strategy;
}
