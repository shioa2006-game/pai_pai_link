// 03_ppl.cpu.js // CPUロジック（厳密解フォールバック付き）
(function () {
  const P = (window.PPL = window.PPL || {});
  const CPU = (P.CPU = P.CPU || {});
  const SUITS = ['man', 'pin', 'sou'];

  // ---- ユーティリティ ----
  function keyOf(t) {
    return t.suit === 'honor' ? `h_${t.honor}` : `${t.suit}_${t.num}`;
  }

  function buildCountsFromTiles(arr) {
    const counts = {};
    for (const t of arr) {
      const k = keyOf(t);
      counts[k] = (counts[k] || 0) + 1;
    }
    return counts;
  }

  function cloneCounts(c) {
    const n = {};
    for (const k in c) n[k] = c[k];
    return n;
  }

  // ---- スコア（基礎2000 + 赤×1000） ----
  CPU.basicScore = CPU.basicScore || function basicScore(hand) {
    let score = 2000;
    for (const t of hand || []) if (t.isRed) score += 1000;
    return score;
  };

  // ---- 4面子＋雀頭 DFS（キー文字列ベース） ----
  function canFormFourMentsu(counts, depth, outMelds) {
    if (depth === 4) return true;

    // 1) 刻子優先
    for (const k in counts) {
      if ((counts[k] | 0) >= 3) {
        counts[k] -= 3;
        outMelds.push({ type: 'triplet', keys: [k, k, k] });
        if (canFormFourMentsu(counts, depth + 1, outMelds)) return true;
        outMelds.pop();
        counts[k] += 3;
      }
    }

    // 2) 順子（萬/筒/索のみ）
    for (const s of SUITS) {
      for (let n = 1; n <= 7; n++) {
        const k1 = `${s}_${n}`;
        const k2 = `${s}_${n + 1}`;
        const k3 = `${s}_${n + 2}`;
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

  // 実タイルの割当（キー列→ board/disc 参照を取得）
  function realizeHandFromKeys(boardTiles, discTiles, pairKey, meldsKeys) {
    const mapB = new Map();
    const mapD = new Map();
    const pushMap = (m, k, t) => { if (!m.has(k)) m.set(k, []); m.get(k).push(t); };

    for (const t of boardTiles) pushMap(mapB, keyOf(t), t);
    for (const t of discTiles)  pushMap(mapD, keyOf(t), t);

    const usedBoardTiles = [];
    const usedDiscardTiles = [];
    const hand = [];

    // disc優先で消費（好みで変更可）
    const takeOne = (k) => {
      let arr = mapD.get(k);
      if (arr && arr.length) {
        const t = arr.pop();
        usedDiscardTiles.push(t); hand.push(t);
        return true;
      }
      arr = mapB.get(k);
      if (arr && arr.length) {
        const t = arr.pop();
        usedBoardTiles.push(t); hand.push(t);
        return true;
      }
      return false; // countsと不一致の保険
    };

    // 雀頭2枚
    if (!takeOne(pairKey) || !takeOne(pairKey)) return null;

    // 面子×4（各3枚）
    for (const m of meldsKeys) {
      for (const k of m.keys) if (!takeOne(k)) return null;
    }

    return { hand, usedBoardTiles, usedDiscardTiles };
  }

  // ---- CPU：和了判定（UI互換返却） ----
  // UI側は pair を「キー配列（2要素）」として描画するため、それに合わせる。
  CPU.tryWin = function tryWin(boardPieces, discards /*, game */) {
    const boardArr = Array.isArray(boardPieces) ? boardPieces : (boardPieces?.board || []);
    const discArr  = Array.isArray(discards)    ? discards    : (boardPieces?.disc  || []);
    const poolLen = boardArr.length + discArr.length;
    if (poolLen < 14) return { won: false, reason: 'pool<14' };

    // ---------- まずは従来の軽探索 ----------
    const counts = buildCountsFromTiles(boardArr.concat(discArr));

    for (const pk in counts) {
      if ((counts[pk] | 0) < 2) continue;
      const c2 = cloneCounts(counts);
      c2[pk] -= 2;
      const melds = [];
      if (canFormFourMentsu(c2, 0, melds)) {
        const realized = realizeHandFromKeys(boardArr, discArr, pk, melds);
        if (!realized) continue;

        const { hand, usedBoardTiles, usedDiscardTiles } = realized;
        const score = CPU.basicScore(hand);

        return {
          won: true,
          hand,
          pair: [pk, pk],      // UI描画用（startsWith可）
          melds,               // {type, keys:[...]} の配列
          usedBoardTiles,
          usedDiscardTiles,
          score
        };
      }
    }

    // ---------- フォールバック：厳密解 ----------
    if (P.MJ && typeof P.MJ.solveFromPool === 'function') {
      const pool = boardArr.concat(discArr);
      const res = P.MJ.solveFromPool(pool);
      if (res && res.won) {
        // 使った実タイルは res.hand（14枚）に入っている
        const discSet = new Set(discArr);
        const usedBoardTiles = [];
        const usedDiscardTiles = [];
        for (const t of res.hand) {
          if (discSet.has(t)) usedDiscardTiles.push(t); else usedBoardTiles.push(t);
        }

        // UI互換のため melds を {type, keys} に変換
        const typedMelds = [];
        for (const m of res.melds || []) {
          if (!Array.isArray(m) || m.length !== 3) continue;
          const k1 = keyOf(m[0]), k2 = keyOf(m[1]), k3 = keyOf(m[2]);
          if (k1 === k2 && k2 === k3) {
            typedMelds.push({ type: 'triplet', keys: [k1, k2, k3] });
          } else {
            // 数牌の並びであることを前提（solveFromPoolが作るのは順子or刻子）
            typedMelds.push({ type: 'sequence', keys: [k1, k2, k3] });
          }
        }
        // pair はキー配列へ
        let pairKey = keyOf((res.pair && res.pair[0]) || res.hand[0]);
        const score = CPU.basicScore(res.hand);

        return {
          won: true,
          hand: res.hand,
          pair: [pairKey, pairKey],
          melds: typedMelds,
          usedBoardTiles,
          usedDiscardTiles,
          score
        };
      }
    }

    return { won: false, reason: 'no-combo' };
  };

  // ---- CPU：成立状況プレビュー（UI用） ----
  // こちらも pair はキー配列に統一する。
  CPU.previewPartial = CPU.previewPartial || function previewPartial(poolOrBoard, discards) {
    let pool = [];
    if (Array.isArray(poolOrBoard)) pool = poolOrBoard.concat(discards || []);
    else if (poolOrBoard && poolOrBoard.board) pool = (poolOrBoard.board || []).concat(poolOrBoard.disc || []);

    const counts = buildCountsFromTiles(pool);
    const melds = [];

    // 刻子最大化
    for (const k in counts) {
      while ((counts[k] | 0) >= 3 && melds.length < 4) {
        counts[k] -= 3;
        melds.push({ type: 'triplet', keys: [k, k, k] });
      }
    }
    // 順子最大化
    for (const s of SUITS) {
      for (let n = 1; n <= 7 && melds.length < 4; n++) {
        const k1 = `${s}_${n}`, k2 = `${s}_${n + 1}`, k3 = `${s}_${n + 2}`;
        while ((counts[k1] | 0) > 0 && (counts[k2] | 0) > 0 && (counts[k3] | 0) > 0 && melds.length < 4) {
          counts[k1]--; counts[k2]--; counts[k3]--;
          melds.push({ type: 'sequence', keys: [k1, k2, k3] });
        }
      }
    }

    // 雀頭候補（あれば配列化）
    let pair = null;
    for (const k in counts) if ((counts[k] | 0) >= 2) { pair = [k, k]; break; }

    const won = !!(pair && melds.length === 4);
    return { won, melds, pair };
  };
})();
