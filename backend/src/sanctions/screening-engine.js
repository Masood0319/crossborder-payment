// ============================================================================
// Real-Time AML & Sanctions Screening Pipeline (JavaScript ES Modules)
// Multi-algorithm fuzzy matching: Jaro-Winkler, Token Sort, Levenshtein, Soundex
// SLA: Sub-40ms end-to-end execution
// ============================================================================

import { SANCTIONS_DATABASE } from './watchlists.js';

export function normalizeName(raw) {
  if (!raw) return '';
  return raw
    .toLowerCase()
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, ' ')
    .replace(/\b(al|el|sheikh|syed|haji|mirza|choudhry|mr|mrs|ms|dr|llc|inc|corp|ltd)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function jaroWinklerDistance(s1, s2) {
  if (s1 === s2) return 1.0;
  if (s1.length === 0 || s2.length === 0) return 0.0;

  const matchWindow = Math.floor(Math.max(s1.length, s2.length) / 2) - 1;
  const s1Matches = new Array(s1.length).fill(false);
  const s2Matches = new Array(s2.length).fill(false);

  let matches = 0;
  for (let i = 0; i < s1.length; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, s2.length);

    for (let j = start; j < end; j++) {
      if (!s2Matches[j] && s1[i] === s2[j]) {
        s1Matches[i] = true;
        s2Matches[j] = true;
        matches++;
        break;
      }
    }
  }

  if (matches === 0) return 0.0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < s1.length; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }

  const jaro =
    (matches / s1.length + matches / s2.length + (matches - transpositions / 2) / matches) / 3.0;

  let prefix = 0;
  const maxPrefix = Math.min(4, Math.min(s1.length, s2.length));
  for (let i = 0; i < maxPrefix; i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }

  const prefixScale = 0.1;
  return jaro + prefix * prefixScale * (1 - jaro);
}

export function levenshteinDistance(s1, s2) {
  const m = s1.length;
  const n = s2.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }

  return dp[m][n];
}

export function levenshteinRatio(s1, s2) {
  const maxLen = Math.max(s1.length, s2.length);
  if (maxLen === 0) return 1.0;
  const dist = levenshteinDistance(s1, s2);
  return 1.0 - dist / maxLen;
}

export function tokenSortRatio(s1, s2) {
  const tokens1 = s1.split(/\s+/).filter(Boolean).sort().join(' ');
  const tokens2 = s2.split(/\s+/).filter(Boolean).sort().join(' ');
  return levenshteinRatio(tokens1, tokens2);
}

export function soundex(name) {
  if (!name) return '0000';
  const clean = name.toUpperCase().replace(/[^A-Z]/g, '');
  if (clean.length === 0) return '0000';

  const firstLetter = clean[0];
  const soundexMap = {
    B: '1', F: '1', P: '1', V: '1',
    C: '2', G: '2', J: '2', K: '2', Q: '2', S: '2', X: '2', Z: '2',
    D: '3', T: '3',
    L: '4',
    M: '5', N: '5',
    R: '6',
  };

  let code = firstLetter;
  let prevDigit = soundexMap[firstLetter] || '0';

  for (let i = 1; i < clean.length && code.length < 4; i++) {
    const char = clean[i];
    const digit = soundexMap[char];

    if (digit && digit !== prevDigit) {
      code += digit;
      prevDigit = digit;
    } else if (!digit) {
      prevDigit = '0';
    }
  }

  return code.padEnd(4, '0');
}

export function soundexScore(s1, s2) {
  const words1 = s1.split(/\s+/).filter(Boolean);
  const words2 = s2.split(/\s+/).filter(Boolean);

  let matches = 0;
  for (const w1 of words1) {
    const snd1 = soundex(w1);
    for (const w2 of words2) {
      if (snd1 === soundex(w2)) {
        matches++;
        break;
      }
    }
  }

  const minWords = Math.max(1, Math.min(words1.length, words2.length));
  return Math.min(1.0, matches / minWords);
}

function hasSameNameTokens(name, candidate) {
  return tokenSortRatio(normalizeName(name), normalizeName(candidate)) === 1;
}

export function calculateEnsembleMatch(inquiryName, candidateName) {
  const n1 = normalizeName(inquiryName);
  const n2 = normalizeName(candidateName);

  if (!n1 || !n2) {
    throw new Error('Both names are required for sanctions screening');
  }

  if (n1 === n2) {
    return {
      confidencePercent: 100.0,
      breakdown: [
        { algorithm: 'JARO_WINKLER', score: 1.0, weight: 0.4 },
        { algorithm: 'TOKEN_SORT', score: 1.0, weight: 0.3 },
        { algorithm: 'LEVENSHTEIN', score: 1.0, weight: 0.2 },
        { algorithm: 'SOUNDEX_PHONETIC', score: 1.0, weight: 0.1 },
      ],
    };
  }

  if (tokenSortRatio(n1, n2) === 1) {
    return {
      confidencePercent: 100.0,
      breakdown: [
        { algorithm: 'JARO_WINKLER', score: jaroWinklerDistance(n1, n2), weight: 0.4 },
        { algorithm: 'TOKEN_SORT', score: 1.0, weight: 0.3 },
        { algorithm: 'LEVENSHTEIN', score: levenshteinRatio(n1, n2), weight: 0.2 },
        { algorithm: 'SOUNDEX_PHONETIC', score: soundexScore(n1, n2), weight: 0.1 },
      ],
    };
  }

  const jw = jaroWinklerDistance(n1, n2);
  const ts = tokenSortRatio(n1, n2);
  const lev = levenshteinRatio(n1, n2);
  const snd = soundexScore(n1, n2);

  const weighted = jw * 0.4 + ts * 0.3 + lev * 0.2 + snd * 0.1;
  const confidencePercent = Math.round(weighted * 10000) / 100;

  return {
    confidencePercent,
    breakdown: [
      { algorithm: 'JARO_WINKLER', score: Math.round(jw * 1000) / 1000, weight: 0.4 },
      { algorithm: 'TOKEN_SORT', score: Math.round(ts * 1000) / 1000, weight: 0.3 },
      { algorithm: 'LEVENSHTEIN', score: Math.round(lev * 1000) / 1000, weight: 0.2 },
      { algorithm: 'SOUNDEX_PHONETIC', score: Math.round(snd * 1000) / 1000, weight: 0.1 },
    ],
  };
}

export function screenEntity(name, role, thresholdPercent = 75.0, blockThresholdPercent = 85.0) {
  const startTime = performance.now();
  const matches = [];
  if (!Array.isArray(SANCTIONS_DATABASE) || SANCTIONS_DATABASE.length === 0) {
    throw new Error('Sanctions watchlist is unavailable');
  }
  if (normalizeName(name).length < 2) {
    throw new Error('A valid name is required for sanctions screening');
  }

  for (const entity of SANCTIONS_DATABASE) {
    const primaryEval = calculateEnsembleMatch(name, entity.primaryName);
    if (primaryEval.confidencePercent >= thresholdPercent) {
      matches.push({
        entityId: entity.id,
        entityName: entity.primaryName,
        matchedOnAlias: entity.primaryName,
        source: entity.source,
        confidenceScore: primaryEval.confidencePercent,
        breakdown: primaryEval.breakdown,
        isHit: hasSameNameTokens(name, entity.primaryName)
          && primaryEval.confidencePercent >= blockThresholdPercent,
      });
    }

    for (const alias of entity.aliases) {
      const aliasEval = calculateEnsembleMatch(name, alias);
      if (aliasEval.confidencePercent >= thresholdPercent) {
        matches.push({
          entityId: entity.id,
          entityName: entity.primaryName,
          matchedOnAlias: alias,
          source: entity.source,
          confidenceScore: aliasEval.confidencePercent,
          breakdown: aliasEval.breakdown,
          isHit: hasSameNameTokens(name, alias)
            && aliasEval.confidencePercent >= blockThresholdPercent,
        });
      }
    }
  }

  matches.sort((a, b) => b.confidenceScore - a.confidenceScore);
  const highestScore = matches.length > 0 ? matches[0].confidenceScore : 0.0;
  const executionTimeMs = Math.round((performance.now() - startTime) * 100) / 100;

  let status = 'CLEARED';
  if (matches.some(match => match.isHit)) {
    status = 'CONFIRMED_MATCH';
  } else if (highestScore >= thresholdPercent) {
    status = 'POTENTIAL_MATCH';
  }

  return {
    searchTerm: name,
    role,
    status,
    maxConfidence: highestScore,
    executionTimeMs,
    matches,
    decisionTimestamp: new Date().toISOString(),
  };
}

export function screenTransactionParties(transactionId, senderName, receiverName) {
  const t0 = performance.now();

  const senderScreening = screenEntity(senderName, 'SENDER');
  const receiverScreening = screenEntity(receiverName, 'RECEIVER');

  const combinedRiskScore = Math.max(senderScreening.maxConfidence, receiverScreening.maxConfidence);

  let decision = 'APPROVE';
  if (senderScreening.status === 'CONFIRMED_MATCH' || receiverScreening.status === 'CONFIRMED_MATCH') {
    decision = 'REJECT_BLOCKED';
  } else if (senderScreening.status === 'POTENTIAL_MATCH' || receiverScreening.status === 'POTENTIAL_MATCH') {
    decision = 'FLAG_FOR_REVIEW';
  }

  const isCleared = decision === 'APPROVE';
  const totalExecutionTimeMs = Math.round((performance.now() - t0) * 100) / 100;

  return {
    transactionId,
    isCleared,
    senderScreening,
    receiverScreening,
    combinedRiskScore,
    decision,
    totalExecutionTimeMs,
  };
}
