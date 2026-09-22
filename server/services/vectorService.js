// Vector and Text Processing Service for Hybrid RAG Search
// Computes normalized term frequencies, n-grams, and cosine similarity for knowledge chunks

// Indonesian stop words for medical/first aid context filtering
const STOP_WORDS = new Set([
  'yang', 'untuk', 'pada', 'ke', 'para', 'namun', 'menurut', 'antara', 'dia', 'dua',
  'ia', 'seperti', 'jika', 'sehingga', 'kembali', 'dan', 'ini', 'karena', 'oleh',
  'saat', 'harus', 'itu', 'adalah', 'dengan', 'dari', 'akan', 'atau', 'dalam', 'bisa',
  'sudah', 'juga', 'ada', 'di', 'the', 'and', 'of', 'to', 'in', 'is', 'for', 'that'
]);

export function tokenize(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2 && !STOP_WORDS.has(word));
}

export function computeTermFrequencies(tokens) {
  const tf = {};
  for (const token of tokens) {
    tf[token] = (tf[token] || 0) + 1;
  }
  // Normalize
  const total = tokens.length || 1;
  const normalized = {};
  for (const [k, v] of Object.entries(tf)) {
    normalized[k] = v / total;
  }
  return normalized;
}

export function cosineSimilarity(tf1, tf2) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (const val of Object.values(tf1)) {
    normA += val * val;
  }
  for (const val of Object.values(tf2)) {
    normB += val * val;
  }

  if (normA === 0 || normB === 0) return 0;

  for (const [term, val] of Object.entries(tf1)) {
    if (tf2[term]) {
      dotProduct += val * tf2[term];
    }
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
