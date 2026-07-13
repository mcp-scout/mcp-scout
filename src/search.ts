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

const NAME_WEIGHT = 3;
const DESCRIPTION_WEIGHT = 1;
const SUBSTRING_BONUS = 5;
const DESCRIPTION_TRUNCATE_LENGTH = 200;

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

function weightedTermFrequencies(tool: IndexedTool): Map<string, number> {
  const freqs = new Map<string, number>();
  const add = (tokens: string[], weight: number) => {
    for (const token of tokens) {
      freqs.set(token, (freqs.get(token) ?? 0) + weight);
    }
  };
  add(tokenize(tool.name), NAME_WEIGHT);
  add(tokenize(tool.description), DESCRIPTION_WEIGHT);
  return freqs;
}

export function searchTools(
  index: IndexedTool[],
  query: string,
  limit = 10,
): ScoredMatch[] {
  const queryTokens = [...new Set(tokenize(query))];
  if (queryTokens.length === 0 || index.length === 0) {
    return [];
  }

  const docFrequencies = index.map(weightedTermFrequencies);

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
      score += SUBSTRING_BONUS;
    }
    return {
      id: namespacedId(tool),
      server: tool.server,
      name: tool.name,
      description:
        tool.description.length > DESCRIPTION_TRUNCATE_LENGTH
          ? `${tool.description.slice(0, DESCRIPTION_TRUNCATE_LENGTH)}...`
          : tool.description,
      score,
    };
  });

  return scored
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
