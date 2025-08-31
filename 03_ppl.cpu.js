// 03_ppl.cpu.js
// CPUロジック（拡張用）

(function () {
  const P = (window.PPL = window.PPL || {});
  const CPU = (P.CPU = P.CPU || {});

  const SUITS = ['man', 'pin', 'sou'];

  // ---- ユーティリティ ----
  function keyOf(t) {
    return t.suit === 'honor' ? `h_${t.honor}` : `${t.suit}_${t.num}`;
  }
  function fromKey(key, sampleMap) {
    if (sampleMap && sampleMap[key]) {
      const s = sampleMap[key];
      return new P.Piece(-1, s.suit, s.num, s.honor, s.isRed, 'cpu');
    }
    if (key.startsWith('h_')) {
      const h = key.split('_')[1];
      return new P.Piece(-1, 'honor', null, h, false, 'cpu');
    }
    const [suit, n] = key.split('_');
    return new P.Piece(-1, suit, parseInt(n, 10), null, false, 'cpu');
  }
  function buildCounts(pool) {
    const counts = {};
    const sample = {};
    for (const t of pool) {
      const k = keyOf(t);
      counts[k] = (counts[k] || 0) + 1;
      if (!sample[k]) sample[k] = t;
    }
    return { counts, sample };
  }
  function cloneCounts(src) {
    const o = {};
    for (const k in src) o[k] = src[k];
    return o;
  }

  // 4面子が作れるか
  function canFormFourMentsu(counts, depth, outMelds) {
    if (depth === 4) return true;

    // 刻子
    for (const k in counts) {
      if (counts[k] >= 3) {
        counts[k] -= 3;
        outMelds.push({ type: 'triplet', key: k });
        if (canFormFourMentsu(counts, depth + 1, outMelds)) return true;
        outMelds.pop();
        counts[k] += 3;
      }
    }
    // 順子
    for (const s of SUITS) {
      for (let n = 1; n <= 7; n++) {
        const k1 = `${s}_${n}`, k2 = `${s}_${n + 1}`, k3 = `${s}_${n + 2}`;
        if ((counts[k1] | 0) > 0 && (counts[k2] | 0) > 0 && (counts[k3] | 0) > 0) {
          counts[k1]--; counts[k2]--; counts[k3]--;
          outMelds.push({ type: 'sequence', keys: [k1, k2, k3] });
          if (canFormFourMentsu(counts, depth + 1, outMelds)) return true;
          outMelds.pop();
          counts[k1]++; counts[k2]++; counts[k3]++;
        }
      }
    }
    return false;
  }

  // ---- スコア：簡易（赤ドラのみ加点） ----
  CPU.basicScore = CPU.basicScore || function basicScore(hand) {
    let score = 2000; // 基礎点
    for (const t of hand || []) if (t.isRed) score += 1000;
    return score;
  };

  // ---- CPU：和了判定 ----
  CPU.tryWin = CPU.tryWin || function tryWin(boardPieces, discards, game) {
    let pool = [];
    if (Array.isArray(boardPieces)) pool = boardPieces.concat(discards || []);
    else if (boardPieces && boardPieces.board) pool = (boardPieces.board || []).concat(boardPieces.disc || []);
    if (pool.length < 14) return { won: false, reason: 'pool<14' };

    if (game && game.cpuCooldown > 0) return { won: false, reason: 'cooldown' };

    const { counts, sample } = buildCounts(pool);

    // 雀頭候補
    for (const pairKey in counts) {
      if (counts[pairKey] < 2) continue;
      const c = cloneCounts(counts);
      c[pairKey] -= 2;

      const melds = [];
      if (canFormFourMentsu(c, 0, melds)) {
        const hand = [];
        for (const m of melds) {
          if (m.type === 'triplet') {
            for (let i = 0; i < 3; i++) hand.push(fromKey(m.key, sample));
          } else {
            for (const k of m.keys) hand.push(fromKey(k, sample));
          }
        }
        hand.push(fromKey(pairKey, sample));
        hand.push(fromKey(pairKey, sample));

        return {
          won: true,
          hand,
          pair: pairKey,
          melds,
          score: CPU.basicScore(hand)
        };
      }
    }
    return { won: false, reason: 'no-combo' };
  };

  // ---- CPU：成立状況プレビュー（UI用） ----
  CPU.previewPartial = CPU.previewPartial || function previewPartial(poolOrBoard, discards) {
    let pool = [];
    if (Array.isArray(poolOrBoard)) pool = poolOrBoard.concat(discards || []);
    else if (poolOrBoard && poolOrBoard.board) pool = (poolOrBoard.board || []).concat(poolOrBoard.disc || []);

    const { counts } = buildCounts(pool);

    const melds = [];
    // 刻子優先
    for (const k in counts) {
      while (counts[k] >= 3 && melds.length < 4) {
        counts[k] -= 3;
        melds.push({ type: 'triplet', keys: [k, k, k] });
      }
    }
    // 次に順子
    for (const s of SUITS) {
      for (let n = 1; n <= 7 && melds.length < 4; n++) {
        const k1 = `${s}_${n}`, k2 = `${s}_${n + 1}`, k3 = `${s}_${n + 2}`;
        while ((counts[k1] | 0) > 0 && (counts[k2] | 0) > 0 && (counts[k3] | 0) > 0 && melds.length < 4) {
          counts[k1]--; counts[k2]--; counts[k3]--;
          melds.push({ type: 'sequence', keys: [k1, k2, k3] });
        }
      }
    }
    // 雀頭候補（あれば1つ）
    let pair = null;
    for (const k in counts) if (counts[k] >= 2) { pair = { key: k }; break; }

    const won = !!(pair && melds.length === 4);
    return { won, melds, pair };
  };

})();
