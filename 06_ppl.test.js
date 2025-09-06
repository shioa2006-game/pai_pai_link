// 06_ppl.test.js
// ブラウザ内・ゼロ依存の軽量テストランナー＋テスト本体
(function () {
  'use strict';
  const P = (window.PPL = window.PPL || {});

  // ------------------------------
  // Minimal test runner
  // ------------------------------
  const Test = P.Test || (P.Test = {});
  function now() { return (typeof performance !== 'undefined' ? performance.now() : Date.now()); }

  const results = [];
  function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
  function eq(a,b,msg){ if(a!==b) throw new Error(msg||`expected ${a}===${b}`); }
  function approx(a,b,eps,msg){ if(Math.abs(a-b)>(eps??1e-6)) throw new Error(msg||`|${a}-${b}|>${eps}`); }
  function measure(fn){ const s=now(); const r=fn(); return {ms:now()-s, ret:r}; }

  function log(ok,label,ms,extra){
    const tag = ok?'✅':'❌';
    console.log(`%c${tag} ${label} (${ms.toFixed(1)}ms)`, `color:${ok?'#2ecc71':'#e74c3c'};font-weight:bold;`);
    if(extra){
      if (extra instanceof Error) {
        console.error(extra.message);
        if (extra.stack) console.error(extra.stack);
      } else {
        console.log(extra);
      }
    }
  }

  Test.runAll = function runAll(){
    const exists = (x)=> (typeof x!=='undefined' && x!==null);
    if (!exists(P.Board)||!exists(P.Deck)||!exists(P.Piece)||!exists(P.MJ)||!exists(P.CPU)) {
      console.warn('PPL.* not ready'); return;
    }
    console.groupCollapsed('%cPPL.Test: start','color:#3498db;font-weight:bold;');
    const all = [
      ['MJ.solve14 基本形', t_mj_solve14_basic],
      ['MJ.solve14 赤牌混在', t_mj_solve14_red],
      ['MJ.solveFromPool 14抽出', t_mj_solveFromPool],
      ['偏り: ゾロ率＆連続抑制', t_bias_stats],
      ['盤面: 完全落下', t_board_settle],
      ['盤面: 4連結消去', t_board_clear4],
      ['CPU.tryWin 成功/枚数一致', t_cpu_trywin_basic],
      ['CPU.tryWin 失敗(プール<14)', t_cpu_trywin_fail_small],
      ['結合: 連鎖→配置→HOLD', t_flow_alloc_hold],
      ['結合: CPU used-only 除去→落下', t_flow_cpu_usedonly],
      ['結合: 山切れ最終判定', t_flow_autofinal]
    ];
    let pass=0;
    for (const [name,fn] of all){
      try{
        const {ms}=measure(fn);
        log(true,name,ms);
        pass++;
      }catch(e){
        log(false,name,0,e);
      }
    }
    console.log(`%cPPL.Test: ${pass}/${all.length} passed`, 'color:#34495e;font-weight:bold;');
    console.groupEnd();
  };

  // ------------------------------
  // Helpers
  // ------------------------------
  let __tid = 10000;
  function pid(){ return __tid++; }
  function m(n,r=false){ return new P.Piece(pid(),'man',n,null,r); }
  function p(n,r=false){ return new P.Piece(pid(),'pin',n,null,r); }
  function s(n,r=false){ return new P.Piece(pid(),'sou',n,null,r); }
  function h(ch){ return new P.Piece(pid(),'honor',null,ch); } // ch: 'E','S','W','N','P','F','C'

  function fillBoard(board, list){ // list: array of [x,y,piece]
    for(const [x,y,t] of list) board.set(x,y,t);
  }

  function settle(board){
    let c=0; while(board.applyGravityMoved()){ if(++c>board.ROWS) break; }
  }

  // ------------------------------
  // Tests
  // ------------------------------

  // A-1-1 基本
  function t_mj_solve14_basic(){
    const hand=[];
    // 123m / 456p / 789s / 444m / 白白
    hand.push(m(1),m(2),m(3));
    hand.push(p(4),p(5),p(6));
    hand.push(s(7),s(8),s(9));
    hand.push(m(4),m(4),m(4));
    hand.push(h('P'),h('P'));
    const r = P.MJ.solve14(hand);
    assert(r && r.won,'should win');
    eq((r.melds||[]).length,4,'melds=4');
    eq((r.pair||[]).length,2,'pair=2');
  }

  // A-1-4 赤牌混在
  function t_mj_solve14_red(){
    const hand=[];
    hand.push(m(1),m(2),m(3));
    hand.push(p(4),p(5,true),p(6)); // 赤
    hand.push(s(7),s(8),s(9));
    hand.push(m(4),m(4),m(4));
    hand.push(h('C'),h('C'));
    const r = P.MJ.solve14(hand);
    assert(r.won,'should win');
    assert((r.hand||[]).some(t=>t.isRed),'hand contains red');
  }

  // A-2 solveFromPool
  function t_mj_solveFromPool(){
    const pool=[];
    pool.push(m(1),m(2),m(3));
    pool.push(p(4),p(5),p(6));
    pool.push(s(7),s(8),s(9));
    pool.push(m(4),m(4),m(4));
    pool.push(h('P'),h('P'));
    // おまけ牌
    pool.push(p(1),s(1));
    const r = P.MJ.solveFromPool(pool);
    assert(r && r.won,'pool should win');
    eq((r.hand||[]).length,14,'exact 14 chosen');
  }

  // A-3 偏り統計
  function t_bias_stats(){
    const rng = (P.makeRNG ? P.makeRNG(123456) : Math.random);
    const deck = new P.Deck(rng);
    const Cfg = P.getCFG ? P.getCFG() : {};
    const N = Math.min(200, Math.floor(deck.remaining()/2));
    let zoro=0, lastMain=null, streak=0, maxStreak=0;
    for(let i=0;i<N;i++){
      const a=deck.draw(), b=deck.draw(); if(!a||!b) break;
      const isZ = (a.suit===b.suit); if(isZ) zoro++;
      const main = a.suit; // 非ゾロの主スートは先頭タイル
      streak = (main===lastMain) ? streak+1 : 1; lastMain=main;
      if(streak>maxStreak) maxStreak=streak;
    }
    const rate = zoro / N;
    const lo = (Cfg.BIAS_ZORO_MIN ?? 0.12) - 0.04;
    const hi = (Cfg.BIAS_ZORO_MAX ?? 0.36) + 0.04;
    assert(rate>=lo && rate<=hi, `zoro rate ${rate.toFixed(3)} out of [${lo},${hi}]`);
    const limit = (Cfg.BIAS_MAX_STREAK ?? 2) + 1;
    assert(maxStreak<=limit, `max streak ${maxStreak} > ${limit}`);
    if (console && console.table) console.table({pairs:N, zoro, rate:+rate.toFixed(3), maxStreak});
  }

  // A-4-1 完全落下
  function t_board_settle(){
    const b = new P.Board(6,12);
    // 1列目に隙間だらけで3枚置く
    b.set(0,0,m(1)); b.set(0,2,p(2)); b.set(0,5,s(3));
    settle(b);
    // どの牌も真下は非空（最下段は除く）
    for(let y=0;y<12;y++) for(let x=0;x<6;x++){
      const t=b.get(x,y); if(!t) continue;
      if(y<11) assert(b.get(x,y+1)!==null,`floating at (${x},${y})`);
    }
  }

  // A-4-2 4連結消去
  function t_board_clear4(){
    const b = new P.Board(6,12);
    // 2x2 の萬で4連結
    const t1=m(1), t2=m(1), t3=m(1), t4=m(1);
    b.set(1,1,t1); b.set(2,1,t2); b.set(1,2,t3); b.set(2,2,t4);
    const removed = b.checkAndClearChains(4);
    eq(removed.length,4,'remove 4');
    assert(b.get(1,1)===null && b.get(2,1)===null && b.get(1,2)===null && b.get(2,2)===null,'cleared');
  }

  // B-1 CPU.tryWin 成功
  function t_cpu_trywin_basic(){
    const board=[], disc=[];
    // 123m / 123p / 789s / 444m / 白白
    board.push(m(1),m(2),m(3));
    board.push(p(1),p(2),p(3));
    board.push(s(7),s(8),s(9));
    board.push(m(4),m(4),m(4));
    disc.push(h('P'),h('P')); // pair
    const r = P.CPU.tryWin(board, disc, null);
    assert(r && r.won,'cpu should win');
    eq(((r.usedBoardTiles||[]).length + (r.usedDiscardTiles||[]).length),14,'used tiles = 14');
    // UI互換
    assert(Array.isArray(r.pair) && typeof r.pair[0]==='string','pair key array');
    assert(Array.isArray(r.melds) && r.melds[0] && r.melds[0].keys,'melds keys');
  }

  // B-2 失敗系：プール < 14
  function t_cpu_trywin_fail_small(){
    const board=[m(1),m(2),m(3)];
    const disc=[h('P'),h('P')];
    const r = P.CPU.tryWin(board, disc, null);
    assert(!r.won && r.reason==='pool<14','should skip under 14');
  }

  // C-1 連鎖→配置→HOLD
  function t_flow_alloc_hold(){
    const g = new P.Game();

    // ★ 重要：new直後は state==='title' なので、play にしてから連鎖Tickを回す
    g.state = 'play';

    // 盤面に 4 連結を仕込む
    const b=g.board;
    b.set(0,0,m(1)); b.set(1,0,m(1)); b.set(0,1,m(1)); b.set(1,1,m(1));

    // 連鎖処理1tickで消す
    const tick = (P.getCFG?P.getCFG():{}).CHAIN_TICK_MS || 300;
    g.processing=true; g.chainTimer = tick;
    g.update(0); // ここで消去が走る

    // もう1tickで収束→配置モーダルへ
    g.chainTimer = tick;
    g.update(0);

    eq(g.state,'alloc','open alloc');
    assert((g.allocTiles||[]).length>0,'got tiles');

    // すべて手牌にして確定（14枚以下の範囲で）
    for(const t of g.allocTiles) g.allocAssign.set(t.id,'hand');
    g.onAllocConfirm();

    eq(g.state,'hold','go hold');

    // 初回 update で判定実行（playerHold / cpuHold を埋める）
    g.update(0);
    assert(g.playerHold && g.cpuHold,'holds evaluated');
  }

  // C-2 CPU used-only 除去→落下
  function t_flow_cpu_usedonly(){
    const g = new P.Game();
    g.discards.length = 0;
    // 盤面に 123m / 123p / 789s / 444m を配置
    const list=[];
    list.push([0,0,m(1)],[1,0,m(2)],[2,0,m(3)]);
    list.push([0,1,p(1)],[1,1,p(2)],[2,1,p(3)]);
    list.push([0,2,s(7)],[1,2,s(8)],[2,2,s(9)]);
    list.push([3,0,m(4)],[3,1,m(4)],[3,2,m(4)]);
    fillBoard(g.board, list);
    g.discards.push(h('P'),h('P')); // pair
    // HOLD へ飛ばして評価
    g.state='hold'; g.holdEvaluated=false;
    g.update(0); // evaluate
    // 閉じる（何かキー）
    g.keyDown('Enter'); g.update(0);
    // 盤面から12枚分が除去され、完全落下している
    let cnt=0; for(let y=0;y<g.board.ROWS;y++)for(let x=0;x<g.board.COLS;x++){ if(g.board.get(x,y)) cnt++; }
    assert(cnt===0,'used-only removed all used board tiles');
  }

  // C-3 山切れ最終判定
  function t_flow_autofinal(){
    const g = new P.Game();
    // 手牌は和了14枚
    g.hand.length = 0;
    g.hand.push(m(1),m(2),m(3));
    g.hand.push(p(4),p(5),p(6));
    g.hand.push(s(7),s(8),s(9));
    g.hand.push(m(4),m(4),m(4));
    g.hand.push(h('P'),h('P'));
    // CPU用プールも成立
    g.discards.length = 0;
    g.board.clearAll();
    fillBoard(g.board, [[0,0,m(1)],[1,0,m(2)],[2,0,m(3)],
                        [0,1,p(1)],[1,1,p(2)],[2,1,p(3)],
                        [0,2,s(7)],[1,2,s(8)],[2,2,s(9)],
                        [3,0,m(4)],[3,1,m(4)],[3,2,m(4)]]);
    g.discards.push(h('C'),h('C'));

    // 山を枯渇させる
    g.nextQ.length = 0;
    g.deck = { remaining(){return 0;}, draw(){return null;} };

    // play 状態で update すると gameover へ
    g.state='play'; g.processing=false; g.falling=null;
    g.update(16.7);
    eq(g.state,'gameover','game over');
    assert(g.result && typeof g.result.playerTotal==='number' && typeof g.result.cpuTotal==='number','result filled');
  }

  // ここで IIFE を閉じる
})();
