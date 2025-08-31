// 02_ppl.mahjong.js
(function (PPL) {
  'use strict';
  PPL = (window.PPL = window.PPL || {});
  const MJ = (PPL.MJ = PPL.MJ || {});

  // ---- 34種インデックス ----
  const HONOR_IDX = { E:27, S:28, W:29, N:30, P:31, F:32, C:33 };
  function idxFromPiece(t){
    if (t.suit==='honor') return HONOR_IDX[t.honor] ?? 31;
    if (t.suit==='man') return t.num - 1;
    if (t.suit==='pin') return 9 + (t.num - 1);
    if (t.suit==='sou') return 18 + (t.num - 1);
    return 0;
  }
  function isHonorIdx(i){ return i>=27; }
  function suitOfIdx(i){ return (i<9)?'man':(i<18)?'pin':(i<27)?'sou':'honor'; }
  function numOfIdx(i){ return (i<27)? (i%9)+1 : null; }

  // ---- バケット/カウント ----
  function makeBuckets(tiles){
    const b = Array.from({length:34},()=>[]);
    for(const t of tiles) b[idxFromPiece(t)].push(t);
    return b;
  }
  function countsFromTiles(tiles){
    const c = new Array(34).fill(0);
    for(const t of tiles) c[idxFromPiece(t)]++;
    return c;
  }
  function cloneCounts(c){ return c.slice(); }

  // ---- 14枚専用：厳密判定（全消費） ----
  // return {won, pair:[2], melds:[[3]x4], hand:[14]}
  MJ.solve14 = function(tiles){
    if (!Array.isArray(tiles) || tiles.length!==14) return {won:false, reason:'not14'};
    const counts = countsFromTiles(tiles);
    const path = [];
    const memo = new Map(); // key: counts.join('|') + '|' + usedPair + '|' + melds

    function key(c, usedPair, melds){ return c.join(',')+'|'+(usedPair?1:0)+'|'+melds; }

    function firstNonZero(c){ for(let i=0;i<34;i++) if (c[i]>0) return i; return -1; }

    function dfs(c, usedPair, melds){
      if (melds===4 && usedPair){
        for(let i=0;i<34;i++) if (c[i]!==0) return false;
        return true;
      }
      const k = key(c, usedPair, melds);
      if (memo.has(k)) return memo.get(k);

      const i = firstNonZero(c);
      if (i<0) return false;

      // 刻子
      if (c[i]>=3){
        c[i]-=3; path.push({type:'trip', i});
        if (dfs(c, usedPair, melds+1)) return memo.set(k,true).get(k);
        path.pop(); c[i]+=3;
      }
      // 順子
      if (!isHonorIdx(i)){
        const p=i%9;
        if (p<=6 && c[i]>=1 && c[i+1]>=1 && c[i+2]>=1){
          c[i]--; c[i+1]--; c[i+2]--; path.push({type:'seq', i});
          if (dfs(c, usedPair, melds+1)) return memo.set(k,true).get(k);
          path.pop(); c[i]++; c[i+1]++; c[i+2]++;
        }
      }
      // 雀頭
      if (!usedPair && c[i]>=2){
        c[i]-=2; path.push({type:'pair', i});
        if (dfs(c, true, melds)) return memo.set(k,true).get(k);
        path.pop(); c[i]+=2;
      }
      memo.set(k,false);
      return false;
    }

    const ok = dfs(cloneCounts(counts), false, 0);
    if (!ok) return {won:false, reason:'no14'};

    // 構成を具体の牌で復元（赤ドラ優先で取り出す）
    const buckets = makeBuckets(tiles).map(arr => {
      return arr.slice().sort((a,b)=> (b.isRed?1:0) - (a.isRed?1:0));
    });
    const melds = [], pair=[];
    for(const step of path){
      if (step.type==='pair'){
        pair.push(buckets[step.i].pop(), buckets[step.i].pop());
      }else if (step.type==='trip'){
        melds.push([buckets[step.i].pop(), buckets[step.i].pop(), buckets[step.i].pop()]);
      }else{
        const i=step.i;
        melds.push([ buckets[i].pop(), buckets[i+1].pop(), buckets[i+2].pop() ]);
      }
    }
    const hand = melds.flat().concat(pair);
    return {won:true, pair, melds, hand};
  };

  // ---- プール（多数枚）から「14枚を選んで」和了が作れるか ----
  MJ.solveFromPool = function(tilesPool){
    if (!Array.isArray(tilesPool) || tilesPool.length<14) return {won:false, reason:'lack'};
    const counts = countsFromTiles(tilesPool);
    const path = [];
    const memo = new Map();

    function key(c, used, melds, usedPair){
      let s='';
      for(let i=0;i<34;i++){ if (c[i]>0) s+=i+':'+c[i]+';'; }
      return s+'|'+used+'|'+melds+'|'+(usedPair?1:0);
    }
    function dfs(c, used, melds, usedPair){
      if (melds===4 && usedPair && used===14) return true;
      if (used>14) return false;
      const restCap = (4-melds)*3 + (usedPair?0:2);
      if (used + restCap < 14) return false;

      const k=key(c,used,melds,usedPair);
      if (memo.has(k)) return memo.get(k);

      // 順子候補
      for(let base=0;base<=18;base+=9){
        for(let n=0;n<=6;n++){
          const i=base+n;
          if (c[i]>0 && c[i+1]>0 && c[i+2]>0){
            c[i]--; c[i+1]--; c[i+2]--; path.push({type:'seq', i});
            if (dfs(c, used+3, melds+1, usedPair)) return memo.set(k,true).get(k);
            path.pop(); c[i]++; c[i+1]++; c[i+2]++;
          }
        }
      }
      // 刻子候補
      for(let i=0;i<34;i++){
        if (c[i]>=3){
          c[i]-=3; path.push({type:'trip', i});
          if (dfs(c, used+3, melds+1, usedPair)) return memo.set(k,true).get(k);
          path.pop(); c[i]+=3;
        }
      }
      // 雀頭候補
      if (!usedPair){
        for(let i=0;i<34;i++){
          if (c[i]>=2){
            c[i]-=2; path.push({type:'pair', i});
            if (dfs(c, used+2, melds, true)) return memo.set(k,true).get(k);
            path.pop(); c[i]+=2;
          }
        }
      }
      memo.set(k,false);
      return false;
    }

    const ok = dfs(cloneCounts(counts), 0, 0, false);
    if (!ok) return {won:false, reason:'notFound'};

    // 復元（赤優先）
    const buckets = makeBuckets(tilesPool).map(arr => {
      return arr.slice().sort((a,b)=> (b.isRed?1:0) - (a.isRed?1:0));
    });
    const melds = [], pair=[];
    for(const step of path){
      if (step.type==='pair'){
        pair.push(buckets[step.i].pop(), buckets[step.i].pop());
      }else if (step.type==='trip'){
        melds.push([buckets[step.i].pop(), buckets[step.i].pop(), buckets[step.i].pop()]);
      }else{
        const i=step.i;
        melds.push([ buckets[i].pop(), buckets[i+1].pop(), buckets[i+2].pop() ]);
      }
    }
    const hand = melds.flat().concat(pair);
    return {won:true, pair, melds, hand};
  };

  // ---- 部分プレビュー（最大化貪欲） ----
  MJ.greedyPreview = function(pool){
    if (!pool || pool.length===0) return {pair:null, mentsu:[]};
    const b = makeBuckets(pool);
    const c = b.map(a=>a.length);
    const out=[];
    // 刻子を最大化
    for(let i=0;i<34;i++){
      while(c[i]>=3){ out.push([b[i].pop(),b[i].pop(),b[i].pop()]); c[i]-=3; }
    }
    // 順子を最大化
    for(let base=0;base<=18;base+=9){
      for(let n=0;n<=6;n++){
        const i=base+n;
        while(c[i]>0 && c[i+1]>0 && c[i+2]>0){
          out.push([b[i].pop(),b[i+1].pop(),b[i+2].pop()]);
          c[i]--; c[i+1]--; c[i+2]--;
        }
      }
    }
    // 対子があれば1組
    let pr=null;
    for(let i=0;i<34;i++){
      if (c[i]>=2){ pr=[b[i].pop(),b[i].pop()]; break; }
    }
    return {pair:pr, mentsu:out};
  };

  MJ.utils = { idxFromPiece, isHonorIdx, suitOfIdx, numOfIdx, makeBuckets, countsFromTiles };
})(window.PPL || {});
