// 04_ppl.core.js
// p5.js から直接呼ばれる setup/draw を含む“中核”モジュール

(function () {
  'use strict';
  const PPL = (window.PPL = window.PPL || {});
  const C = PPL.getCFG ? PPL.getCFG() : {
    CANVAS_W: 960, CANVAS_H: 540, COLS: 6, ROWS: 12, CELL: 32, BOARD_X: 40, BOARD_Y: 40,
    FALL_INTERVAL_MS: 800, CHAIN_TICK_MS: 300, DECK_TOTAL: 136, DPR: (window.devicePixelRatio || 1),
    CPU_COOLDOWN_LANDS: 0, CPU_BOARD_MIN: 0, CPU_MAX_WINS: Infinity,
    CPU_WIN_PER_HOLD: 1, CPU_CLEAR_POLICY: 'used-only',
    BIAS_ENABLED: true, BIAS_WINDOW_PAIRS: 16, BIAS_ZORO_TARGET: 0.24, BIAS_ZORO_MIN: 0.12, BIAS_ZORO_MAX: 0.36,
    BIAS_ZORO_FEEDBACK: 0.6, BIAS_MAX_STREAK: 2, BIAS_STREAK_PENALTY: 0.2, BIAS_REMAINING_GAMMA: 1.2, BIAS_NOISE_EPS: 1e-3
  };

  // ---- 牌モデル ----
  class Piece {
    constructor(id, suit, num = null, honor = null, isRed = false, source = 'deck') {
      this.id = id;
      this.suit = suit;   // 'man'|'pin'|'sou'|'honor'
      this.num = num;     // 1..9 or null
      this.honor = honor; // 'E'|'S'|'W'|'N'|'P'|'F'|'C' or null
      this.isRed = isRed;
      this._src   = source;
      this.isOjama = false;
    }
  }
  PPL.Piece = Piece;

  // ---- ユーティリティ ----
  function fyShuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  // ---- 山（偏り計画器つき） ----
  class Deck {
    constructor(rng) {
      this.rng = rng || Math.random;

      // スート別バケット
      this.buckets = {
        man:   [],
        pin:   [],
        sou:   [],
        honor: []
      };
      this._pairBuf = [];  // 次ペアから供給する 2 枚（draw()はここから 1 枚ずつ返す）
      this.totalLeft = 0;

      // 偏り計画器（A+B）
      this._planner = new SuitPlanner(this);

      this._create();
      this._shuffleBuckets();
    }

    _create() {
      let id = 0;
      // 数牌（萬・筒・索）：各 1..9 を4枚（5の一枚は赤）
      ['man', 'pin', 'sou'].forEach(s => {
        for (let n = 1; n <= 9; n++) {
          for (let k = 0; k < 4; k++) {
            const red = (n === 5 && k === 0);
            const p = new Piece(id++, s, n, null, red, 'deck');
            this.buckets[s].push(p);
            this.totalLeft++;
          }
        }
      });
      // 字牌（東南西北白發中）各 4 枚
      ['E','S','W','N','P','F','C'].forEach(h => {
        for (let k = 0; k < 4; k++) {
          const p = new Piece(id++, 'honor', null, h, false, 'deck');
          this.buckets.honor.push(p);
          this.totalLeft++;
        }
      });
    }

    _shuffleBuckets() {
      fyShuffle(this.buckets.man,   this.rng);
      fyShuffle(this.buckets.pin,   this.rng);
      fyShuffle(this.buckets.sou,   this.rng);
      fyShuffle(this.buckets.honor, this.rng);
    }

    // 在庫枚数
    _countBySuit() {
      return {
        man:   this.buckets.man.length,
        pin:   this.buckets.pin.length,
        sou:   this.buckets.sou.length,
        honor: this.buckets.honor.length
      };
    }

    // 指定スートから1枚取り出す
    _popSuit(suit) {
      const b = this.buckets[suit];
      if (!b || b.length === 0) return null;
      const t = b.pop();
      if (t) { this.totalLeft--; }
      return t;
    }

    // public: 残り総数（ペアバッファも含む）
    remaining() {
      return this.totalLeft + this._pairBuf.length;
    }

    // public: 1 枚ドロー（内部的にはペア単位で計画→バッファ供給）
    draw() {
      if (this._pairBuf.length === 0) {
        if (this.totalLeft <= 0) return null;

        // 残り 1 枚だけのときは単発で供給
        if (this.totalLeft === 1) {
          const inv = this._countBySuit();
          const one = this._planner.pickOneSuit(inv);
          if (!one) return null;
          const t = this._popSuit(one);
          if (t) this._pairBuf.push(t);
        } else {
          // 通常：ペアを計画して 2 枚供給
          const tiles = this._planner.nextPairTiles();
          for (const t of tiles) if (t) this._pairBuf.push(t);
        }
      }
      return this._pairBuf.shift() || null;
    }
  }
  PPL.Deck = Deck;

  // ---- スート計画器（A+B） ----
  class SuitPlanner {
    constructor(deck) {
      this.deck = deck;
      this.win = [];           // 直近ペアのゾロ履歴（true/false）
      this.lastMain = null;    // 直近ペアの主スート
      this.streak = 0;         // 主スート連続数
    }

    // ゾロ確率を目標へ寄せる（在庫・上下限を加味）
    _decideZoro(inv) {
      const Cfg = C;
      if (!Cfg.BIAS_ENABLED) return false;

      // 在庫上、ゾロ可能なスートが無ければ false
      const anyZoroable = (inv.man>=2)||(inv.pin>=2)||(inv.sou>=2)||(inv.honor>=2);
      if (!anyZoroable) return false;

      const w = this.win;
      const cur = (w.length === 0) ? Cfg.BIAS_ZORO_TARGET
                                   : (w.reduce((a,b)=>a+(b?1:0),0) / w.length);

      // 負帰還で目標へ
      let p = Cfg.BIAS_ZORO_TARGET + Cfg.BIAS_ZORO_FEEDBACK * (Cfg.BIAS_ZORO_TARGET - cur);
      p = clamp(p, Cfg.BIAS_ZORO_MIN, Cfg.BIAS_ZORO_MAX);

      return (this.deck.rng() < p);
    }

    // 走り抑制を含むスート重み
    _weights(inv) {
      const Cfg = C;
      const total = inv.man + inv.pin + inv.sou + inv.honor;
      const g = Math.max(1.0, Cfg.BIAS_REMAINING_GAMMA || 1.0);

      const base = {
        man:   inv.man   > 0 ? Math.pow(inv.man   / total, g) : 0,
        pin:   inv.pin   > 0 ? Math.pow(inv.pin   / total, g) : 0,
        sou:   inv.sou   > 0 ? Math.pow(inv.sou   / total, g) : 0,
        honor: inv.honor > 0 ? Math.pow(inv.honor / total, g) : 0
      };

      // 連続上限に達していたら主スートを強く抑制
      if (this.lastMain && this.streak >= (Cfg.BIAS_MAX_STREAK || 2)) {
        const pen = Math.max(0, Cfg.BIAS_STREAK_PENALTY || 0.2);
        base[this.lastMain] *= pen;
      }

      // 微小ノイズでブレを作る（0 のものには付けない）
      const eps = Cfg.BIAS_NOISE_EPS || 1e-3;
      for (const k of ['man','pin','sou','honor']) {
        if (base[k] > 0) base[k] += eps * this.deck.rng();
      }
      return base;
    }

    _weightedPick(weights, forbidSet) {
      const entries = [];
      let sum = 0;
      for (const k of ['man','pin','sou','honor']) {
        if (forbidSet && forbidSet.has(k)) continue;
        const w = weights[k] || 0;
        if (w > 0) { entries.push([k, w]); sum += w; }
      }
      if (entries.length === 0) return null;
      let r = this.deck.rng() * sum;
      for (const [k, w] of entries) {
        r -= w;
        if (r <= 0) return k;
      }
      return entries[entries.length - 1][0];
    }

    // 在庫だけで 1 スートを選ぶ（単発ドロー用）
    pickOneSuit(inv) {
      const w = this._weights(inv);
      return this._weightedPick(w, null);
    }

    // 次ペアを計画し、実タイル 2 枚を返す
    nextPairTiles() {
      const inv0 = this.deck._countBySuit();
      const total = inv0.man + inv0.pin + inv0.sou + inv0.honor;
      if (total <= 0) return [];

      // A: ゾロにするか
      let zoro = false;
      if (C.BIAS_ENABLED) {
        zoro = this._decideZoro(inv0);
        // 在庫が 2 未満のスートしか無い場合は強制非ゾロ
        if (zoro) {
          const zoroable = ['man','pin','sou','honor'].some(s => inv0[s] >= 2);
          if (!zoroable) zoro = false;
        }
      }

      // B: 走り抑制を掛けた重みでスートを選択
      const weights = this._weights(inv0);

      let tiles = [];
      let mainSuit = null;

      if (zoro) {
        // ゾロ：在庫2以上のスートから 1 種を重み選択
        const forbid = new Set();
        for (const s of ['man','pin','sou','honor']) if (inv0[s] < 2) forbid.add(s);
        const s = this._weightedPick(weights, forbid);
        if (!s) {
          // フォールバック：非ゾロへ
          zoro = false;
        } else {
          const t1 = this.deck._popSuit(s);
          const t2 = this.deck._popSuit(s);
          if (t1) tiles.push(t1);
          if (t2) tiles.push(t2);
          mainSuit = s;
        }
      }

      if (!zoro) {
        // 非ゾロ：まず s1 を重み選択 → 次に s2 を（s1 以外から）
        const s1 = this._weightedPick(weights, null);
        if (!s1) return []; // 在庫切れの安全弁

        const inv1 = this.deck._countBySuit(); // s1 選択前と同じだが簡便に
        const w2 = this._weights(inv1);
        const forbid2 = new Set([s1]);
        const s2 = this._weightedPick(w2, forbid2);
        if (!s2) {
          // s2 が選べない場合（在庫的な偏り）、s1 単色でフォールバック（在庫2未満なら単発×2回扱い）
          const t1 = this.deck._popSuit(s1);
          const t2 = this.deck._popSuit(s1);
          if (t1) tiles.push(t1);
          if (t2) tiles.push(t2);
          mainSuit = s1;
        } else {
          const t1 = this.deck._popSuit(s1);
          const t2 = this.deck._popSuit(s2);
          if (t1) tiles.push(t1);
          if (t2) tiles.push(t2);
          mainSuit = s1; // 非ゾロの主スートは最初に選んだ方
        }
      }

      // 履歴を更新
      const isZoro = (tiles.length === 2) && (tiles[0].suit === tiles[1].suit);
      this.win.push(isZoro);
      if (this.win.length > (C.BIAS_WINDOW_PAIRS || 16)) this.win.shift();

      if (mainSuit) {
        if (this.lastMain === mainSuit) this.streak++;
        else { this.lastMain = mainSuit; this.streak = 1; }
      }

      return tiles;
    }
  }

  // ---- 盤面 ----
  class Board {
    constructor(cols, rows) {
      this.COLS = cols; this.ROWS = rows;
      this.grid = Array.from({ length: rows }, () => Array(cols).fill(null));
    }
    get(x, y) { if (x < 0 || x >= this.COLS || y < 0 || y >= this.ROWS) return null; return this.grid[y][x]; }
    set(x, y, t) { if (x < 0 || x >= this.COLS || y < 0 || y >= this.ROWS) return; this.grid[y][x] = t; }
    isEmpty(x, y) { return this.get(x, y) === null; }
    clearAll() { for (let y = 0; y < this.ROWS; y++) for (let x = 0; x < this.COLS; x++) this.grid[y][x] = null; }

    // 参照一致の牌だけを除去（重力は掛けない）
    removeTiles(tiles) {
      if (!tiles || !tiles.length) return;
      for (const t of tiles) {
        let done = false;
        for (let y = 0; y < this.ROWS && !done; y++) {
          for (let x = 0; x < this.COLS && !done; x++) {
            if (this.grid[y][x] === t) { this.grid[y][x] = null; done = true; }
          }
        }
      }
    }

    /**
     * 重力を 1 回適用し、何か 1 枚でも動いたら true を返す（完全収束判定用）
     */
    applyGravityMoved() {
      let moved = false;
      for (let x = 0; x < this.COLS; x++) {
        let write = this.ROWS - 1;
        for (let y = this.ROWS - 1; y >= 0; y--) {
          const t = this.grid[y][x];
          if (t) {
            if (write !== y) {
              this.grid[write][x] = t;
              this.grid[y][x] = null;
              moved = true;
            }
            write--;
          }
        }
      }
      return moved;
    }
    // 互換API（戻り値は使わない）
    applyGravity() { this.applyGravityMoved(); }

    // 同スート4連結以上で消去
    checkAndClearChains(min = 4) {
      const vis = Array.from({ length: this.ROWS }, () => Array(this.COLS).fill(false));
      const removed = [];
      for (let y = 0; y < this.ROWS; y++) {
        for (let x = 0; x < this.COLS; x++) {
          const t = this.grid[y][x];
          if (!t || vis[y][x]) continue;
          const suit = t.suit;
          const st = [{ x, y }]; vis[y][x] = true;
          const grp = [];
          while (st.length) {
            const { x: px, y: py } = st.pop(); grp.push({ x: px, y: py });
            const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
            for (const [dx,dy] of dirs) {
              const nx = px + dx, ny = py + dy;
              if (nx < 0 || nx >= this.COLS || ny < 0 || ny >= this.ROWS) continue;
              if (vis[ny][nx]) continue;
              const nt = this.grid[ny][nx];
              if (nt && nt.suit === suit) { vis[ny][nx] = true; st.push({ x: nx, y: ny }); }
            }
          }
          if (grp.length >= min) {
            for (const g of grp) { removed.push(this.grid[g.y][g.x]); this.grid[g.y][g.x] = null; }
          }
        }
      }
      return removed;
    }
    allPieces() {
      const out = [];
      for (let y = 0; y < this.ROWS; y++) for (let x = 0; x < this.COLS; x++) {
        const t = this.grid[y][x];
        if (t) { t._src = 'board'; out.push(t); }
      }
      return out;
    }
  }
  PPL.Board = Board;

  // ---- 落下ペア ----
  class FallingPair {
    constructor(a, b) { this.ax = a; this.rt = b; this.x = 2; this.y = 0; this.r = 0; }
    _off() { return [{ dx: 0, dy: 0 }, { dx: 1, dy: 1 }, { dx: 0, dy: 2 }, { dx: -1, dy: 1 }][this.r]; }
    positions() {
      const o = this._off();
      return [{ x: this.x, y: this.y + 1, t: this.ax }, { x: this.x + o.dx, y: this.y + o.dy, t: this.rt }];
    }
    canMove(board, nx, ny, nr = this.r) {
      const tmp = new FallingPair(this.ax, this.rt);
      tmp.x = nx; tmp.y = ny; tmp.r = nr;
      const ps = tmp.positions();
      for (const p of ps) {
        if (p.y < 0) continue;
        if (p.x < 0 || p.x >= board.COLS || p.y >= board.ROWS) return false;
        if (!board.isEmpty(p.x, p.y)) return false;
      }
      return true;
    }
  }
  PPL.FallingPair = FallingPair;

  // ---- ゲーム本体 ----
  class Game {
    constructor() {
      this.state = 'title'; // 'title'|'play'|'alloc'|'hold'|'gameover'
      this.board = new Board(C.COLS, C.ROWS);
      this.deck  = new Deck(Math.random);
      this.nextQ = [];
      this.falling = null;

      this.score = 0;
      this.chainLevel = 0;
      this.fallTimer = 0;
      this.chainTimer = 0;
      this.processing = false;
      this.chainCollected = [];

      this.input = { keys: {}, just: {}, rep: {} };

      this.hand = [];
      this.discards = [];

      // 配置モーダル
      this.allocTiles = [];
      this.allocAssign = new Map();
      this.allocMode = 'hand';
      this.awaitAlloc = false;

      // HOLD
      this.playerHold = null;
      this.cpuHold    = null;
      this.holdEvaluated = false;

      // CPU集計（統計用途のみ）
      this.cpuScore = 0;
      this.cpuWins  = 0;
      this.cpuCooldown = 0; // 互換フィールド（今回仕様では未使用）

      this.result = null;
      this._prepareNext(4);
    }

    // --- 盤面を完全に落下収束させる（最大 ROWS 回） ---
    _settleBoardFully() {
      let tries = 0;
      while (this.board.applyGravityMoved()) {
        tries++;
        if (tries > this.board.ROWS) break; // 安全ブレーク
      }
    }

    update(dt) {
      switch (this.state) {
        case 'title': this._updateTitle(); break;
        case 'play':  this._updatePlay(dt); break;
        case 'alloc': break;
        case 'hold':  this._updateHold(); break;
        case 'gameover': break;
      }
      this.input.just = {};
    }

    _updateTitle() {
      if (Object.keys(this.input.just).length) {
        this.state = 'play';
        this._spawnIfNeeded();
      }
    }

    _updatePlay(dt) {
      if (this.processing) {
        // 連鎖進行（落下→消去）
        this.chainTimer += dt;
        if (this.chainTimer >= C.CHAIN_TICK_MS) {
          this.chainTimer = 0;

          this.board.applyGravity();
          const removed = this.board.checkAndClearChains(4);
          if (removed.length > 0) {
            this.chainLevel++;
            this.score += removed.length * 100 * this.chainLevel;
            this.chainCollected.push(...removed);
            return;
          } else {
            // ★ ここで一度完全収束させてから配置モーダルへ
            this.processing = false;
            this._settleBoardFully();

            if (this.chainCollected.length > 0) {
              const got = this.chainCollected.slice();
              this.chainCollected = [];
              this._openAlloc(got);
              return;
            }
            this.chainLevel = 0;
            this._spawnIfNeeded();
          }
        }
        return;
      }

      if (!this.falling) this._spawnIfNeeded();
      const fp = this.falling;
      if (!fp) return;

      if (this.input.just['ArrowLeft'] || this._rep('ArrowLeft'))  { if (fp.canMove(this.board, fp.x - 1, fp.y)) fp.x--; }
      if (this.input.just['ArrowRight'] || this._rep('ArrowRight')) { if (fp.canMove(this.board, fp.x + 1, fp.y)) fp.x++; }
      if (this.input.just['z'] || this.input.just['Z']) { const nr = (fp.r + 1) % 4; if (fp.canMove(this.board, fp.x, fp.y, nr)) fp.r = nr; }
      if (this.input.just['x'] || this.input.just['X']) { const nr = (fp.r + 3) % 4; if (fp.canMove(this.board, fp.x, fp.y, nr)) fp.r = nr; }

      const interval = (this.input.keys['ArrowDown'] ? C.FALL_INTERVAL_MS / 4 : C.FALL_INTERVAL_MS);
      this.fallTimer += dt;
      if (this.fallTimer >= interval) {
        this.fallTimer = 0;
        if (fp.canMove(this.board, fp.x, fp.y + 1)) fp.y++;
        else this._land();
      }
    }

    _updateHold() {
      if (!this.holdEvaluated) {
        // --- プレイヤー：厳密14枚のみ ---
        const pj = (window.PPL.MJ && window.PPL.MJ.solve14)
          ? window.PPL.MJ.solve14(this.hand)
          : { won: false, reason: 'MJ not loaded' };

        if (pj.won) {
          const sc = (window.PPL.CPU ? window.PPL.CPU.basicScore(pj.hand) : 0);
          this.playerHold = { won: true, hand: pj.hand, score: sc, pair: pj.pair, melds: pj.melds };
        } else {
          this.playerHold = { won: false, reason: pj.reason };
        }

        // --- CPU：毎HOLDで必ず試行（プール14未満のみスキップ） ---
        const boardPieces = this.board.allPieces();
        const poolCount = boardPieces.length + this.discards.length;

        if (poolCount >= 14 && window.PPL.CPU && window.PPL.CPU.tryWin) {
          this.cpuHold = window.PPL.CPU.tryWin(boardPieces, this.discards, this);
        } else {
          this.cpuHold = { won: false, reason: 'pool<14' };
        }

        this.holdEvaluated = true;
      }

      // 何かキーで確定（ゲーム継続）
      if (Object.keys(this.input.just).length) {
        // プレイヤー和了
        if (this.playerHold && this.playerHold.won) {
          this.score += this.playerHold.score;
          this.hand = []; // プレイヤー和了後は手牌を空に
        }

        // CPU和了
        if (this.cpuHold && this.cpuHold.won) {
          this.cpuScore += this.cpuHold.score;
          this.cpuWins++;

          // used-only 除去（config優先）
          const policy = (C.CPU_CLEAR_POLICY || 'used-only');
          if (policy === 'used-only') {
            const usedB = this.cpuHold.usedBoardTiles || [];
            const usedD = this.cpuHold.usedDiscardTiles || [];
            if (usedB.length) this.board.removeTiles(usedB);

            // 捨て牌から使った分を消費（参照一致で1枚だけ削除）
            if (usedD.length) {
              for (const t of usedD) {
                const idx = this.discards.indexOf(t);
                if (idx >= 0) this.discards.splice(idx, 1);
              }
            }
          } else {
            // 互換：全消去
            this.board.clearAll();
          }
        }

        // ★ ここで必ず盤面を完全落下させ、必要なら連鎖処理を開始
        this._settleBoardFully();
        this.processing = true;      // 落下後に消える塊があれば連鎖処理が走る
        this.chainTimer = 0;
        this.chainLevel = 0;
        this.chainCollected = [];

        // HOLDを閉じてプレイ再開
        this.playerHold = null;
        this.cpuHold = null;
        this.holdEvaluated = false;
        this.state = 'play';
      }
    }

    _land() {
      const ps = this.falling.positions();
      for (const p of ps) if (p.y >= 0) this.board.set(p.x, p.y, p.t);
      this.falling = null;

      if (this.cpuCooldown > 0) this.cpuCooldown--;

      this.processing = true;
      this.chainTimer = 0;
      this.chainLevel = 0;
      this.chainCollected = [];
    }

    _openAlloc(removed) {
      // 現状仕様：既存手牌も含め編集可
      this.allocTiles = this.hand.concat(removed);
      this.allocAssign.clear();
      for (const t of this.allocTiles) this.allocAssign.set(t.id, 'hand');
      this.allocMode = 'hand';
      this.awaitAlloc = true;
      this.state = 'alloc';
      this.processing = false;
    }

    _finalizeAlloc() {
      const nextHand = [], nextDiscard = [];
      for (const t of this.allocTiles) {
        const a = this.allocAssign.get(t.id) || 'hand';
        if (a === 'hand') nextHand.push(t); else nextDiscard.push(t);
      }
      while (nextHand.length > 14) nextDiscard.push(nextHand.pop());
      this.hand = nextHand.slice(0, 14);
      for (const d of nextDiscard) this.discards.push(d);

      this.allocTiles = [];
      this.allocAssign.clear();
      this.awaitAlloc = false;

      // ★ HOLD に入る直前にも完全収束させてから表示
      this._settleBoardFully();

      this.state = 'hold';
      this.holdEvaluated = false;
    }

    // null をキューに入れないように堅牢化
    _prepareNext(n) {
      while (this.nextQ.length < n && this.deck.remaining() > 0) {
        const t = this.deck.draw();
        if (!t) break;
        this.nextQ.push(t);
      }
    }
    _canSupplyNext() { const rest = (this.deck ? this.deck.remaining() : 0) + this.nextQ.length; return rest >= 2; }

    // ゲーム終了前の自動最終判定（HOLDなしで1回だけ）
    _autoFinalHold() {
      if (this.state !== 'play') return;

      // プレイヤー（14枚ちょうどのときのみ）
      if (window.PPL.MJ && window.PPL.MJ.solve14 && Array.isArray(this.hand) && this.hand.length === 14) {
        const pj = window.PPL.MJ.solve14(this.hand);
        if (pj && pj.won) {
          const sc = (window.PPL.CPU ? window.PPL.CPU.basicScore(pj.hand) : 0);
          this.score += sc;
        }
      }

      // CPU（盤面＋捨て牌プール）
      const boardPieces = this.board.allPieces();
      const poolCount = boardPieces.length + this.discards.length;
      if (poolCount >= 14 && window.PPL.CPU && window.PPL.CPU.tryWin) {
        const cr = window.PPL.CPU.tryWin(boardPieces, this.discards, this);
        if (cr && cr.won) {
          this.cpuScore += cr.score;
          this.cpuWins++;
        }
      }
    }

    _toGameOver() {
      this.state = 'gameover';
      this.result = {
        playerTotal: this.score,
        cpuTotal: this.cpuScore,
        winner: (this.score > this.cpuScore) ? 'player' : (this.score < this.cpuScore) ? 'cpu' : 'draw'
      };
    }

    _spawnIfNeeded() {
      if (!this.falling && this.nextQ.length >= 2) {
        let a = this.nextQ.shift();
        let b = this.nextQ.shift();
        if (!a || !b) {
          this._prepareNext(2);
          if (!a && this.nextQ.length) a = this.nextQ.shift();
          if (!b && this.nextQ.length) b = this.nextQ.shift();
        }
        if (a && b) {
          this.falling = new PPL.FallingPair(a, b);
          this._prepareNext(2);
          return;
        }
      }
      if (!this.falling && !this.processing && this.state === 'play' && !this._canSupplyNext()) {
        // 山が尽きた最終瞬間に、自動最終判定を実行してからリザルトへ
        if (typeof this._autoFinalHold === 'function') this._autoFinalHold();
        this._toGameOver();
      }
    }

    // 入力
    keyDown(k) {
      this.input.just[k] = !this.input.keys[k];
      this.input.keys[k] = true;
      if (!this.input.rep[k]) this.input.rep[k] = { t: 0 };
    }
    keyUp(k) { this.input.keys[k] = false; delete this.input.rep[k]; }
    _rep(k) {
      const r = this.input.rep[k]; if (!r) return false;
      r.t += 16.7; if (r.t > 300) { if (r.t > 350) { r.t = 310; return true; } }
      return false;
    }

    // UIフック（配置モーダル）
    onAllocToggleMode(m) { this.allocMode = m; }
    onAllocToggleTile(id) { this.allocAssign.set(id, this.allocMode); }
    onAllocConfirm() { const cnt = this._allocCounts(); if (cnt.hand <= 14) this._finalizeAlloc(); }
    onAllocReset() { for (const t of this.allocTiles) this.allocAssign.set(t.id, 'hand'); }
    _allocCounts() {
      let hand = 0, discard = 0;
      for (const t of this.allocTiles) {
        const a = this.allocAssign.get(t.id) || 'hand';
        if (a === 'hand') hand++; else discard++;
      }
      return { hand, discard };
    }

    // CPUプール（デバッグ用）
    cpuPool() { return { board: this.board.allPieces(), disc: this.discards.slice() }; }
  }
  PPL.Game = Game;
})();

// ====== p5 のグローバルフック ======
let __ppl_game;

function setup() {
  const C = (window.PPL && window.PPL.getCFG) ? window.PPL.getCFG() : { CANVAS_W: 960, CANVAS_H: 540, DPR: (window.devicePixelRatio || 1) };
  createCanvas(C.CANVAS_W, C.CANVAS_H);

  // DPR（Retina）対応
  if (typeof pixelDensity === 'function') pixelDensity(C.DPR || (window.devicePixelRatio || 1));

  __ppl_game = new window.PPL.Game();
}

function draw() {
  background(236, 240, 241);
  if (!__ppl_game) return;

  __ppl_game.update(16.7);

  if (window.PPL.UI) {
    window.PPL.UI.Hitbox && window.PPL.UI.Hitbox.clear && window.PPL.UI.Hitbox.clear();

    // タイトル
    if (__ppl_game.state === 'title') {
      window.PPL.UI.drawTitle && window.PPL.UI.drawTitle();
      return;
    }

    // 盤面＆HUD
    window.PPL.UI.drawBoard && window.PPL.UI.drawBoard(__ppl_game);
    window.PPL.UI.drawHUD && window.PPL.UI.drawHUD(__ppl_game);

    // 配置モーダル
    if (__ppl_game.state === 'alloc' && window.PPL.UI.drawAllocModal) window.PPL.UI.drawAllocModal(__ppl_game);

    // ホールド
    if (__ppl_game.state === 'hold' && window.PPL.UI.drawHoldOverlay) {
      window.PPL.UI.drawHoldOverlay(__ppl_game);
      return;
    }

    // ゲーム終了
    if (__ppl_game.state === 'gameover' && window.PPL.UI.drawGameOverOverlay) {
      window.PPL.UI.drawGameOverOverlay(__ppl_game);
      return;
    }
  }
}

function keyPressed() {
  if (!__ppl_game) return;

  // R リスタート（ゲーム終了時のみ）
  if ((__ppl_game.state === 'gameover') && (key === 'r' || key === 'R')) {
    __ppl_game = new window.PPL.Game();
    return;
  }

  __ppl_game.keyDown(key);
  if ([37, 38, 39, 40].includes(keyCode)) return false;
}

function keyReleased() { if (__ppl_game) __ppl_game.keyUp(key); }

function mousePressed() {
  if (!__ppl_game || !window.PPL.UI || !window.PPL.UI.Hitbox || !window.PPL.UI.Hitbox.dispatch) return;
  const hit = window.PPL.UI.Hitbox.dispatch(mouseX, mouseY);
  if (!hit) return;
  switch (hit.type) {
    case 'alloc-mode':   __ppl_game.onAllocToggleMode(hit.mode); break;
    case 'alloc-tile':   __ppl_game.onAllocToggleTile(hit.tileId); break;
    case 'alloc-confirm':__ppl_game.onAllocConfirm(); break;
    case 'alloc-reset':  __ppl_game.onAllocReset(); break;
  }
}
