// 03_ppl.cpu.js // CPUロジック
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

  // ---- CPU：和了判定（HOLD表示用：pairは「文字列」） ----
  CPU.tryWin = function tryWin(boardPieces, discards /*, game */) {
    const boardArr = Array.isArray(boardPieces) ? boardPieces : (boardPieces?.board || []);
    const discArr  = Array.isArray(discards)    ? discards    : (boardPieces?.disc  || []);
    const poolLen = boardArr.length + discArr.length;
    if (poolLen < 14) return { won: false, reason: 'pool<14' };

    const counts = buildCountsFromTiles(boardArr.concat(discArr));

    // 雀頭候補を一つ選び、残りで4面子をDFS
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

        // ★ UI契約：pair は文字列キー（'pin_5'）
        return {
          won: true,
          hand,               // 実タイル（内部用：赤カウント等）
          pair: pk,           // ★ HOLDの tileFromKey が文字列を期待
          melds,              // {type, keys:[...]}（キー配列）
          usedBoardTiles,     // 盤面除去用
          usedDiscardTiles,   // 捨て牌消費用
          score
        };
      }
    }

    return { won: false, reason: 'no-combo' };
  };

  // ---- CPU：成立状況プレビュー（HUD用：pairは {key:文字列}） ----
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

    // 雀頭候補（HUDは {key:'...'} を期待）
    let pair = null;
    for (const k in counts) if ((counts[k] | 0) >= 2) { pair = { key: k }; break; }

    const won = !!(pair && melds.length === 4);
    return { won, melds, pair };
  };
})();
