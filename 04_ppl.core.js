// 04_ppl.core.js
// p5.js から直接呼ばれる setup/draw を含む“中核”モジュール
// フォールバック込み

(function (PPLns) {
  'use strict';
  const PPL = (window.PPL = window.PPL || {});

  // ---- CFG フォールバック ----
  const DEFAULT_CFG = {
    CANVAS_W: 960,
    CANVAS_H: 540,
    COLS: 6,
    ROWS: 12,
    CELL: 32,
    BOARD_X: 40,
    BOARD_Y: 40,
    FALL_INTERVAL_MS: 800,
    CHAIN_TICK_MS: 300,
    DECK_TOTAL: 136,
    DPR: (window.devicePixelRatio || 1),
    CPU_COOLDOWN_LANDS: 2,
    CPU_BOARD_MIN: 0,
    CPU_MAX_WINS: Infinity
  };
  PPL.CFG = PPL.CFG || DEFAULT_CFG;
  PPL.getCFG = PPL.getCFG || function () { return PPL.CFG; };
  const C = PPL.getCFG();

  // ---- 牌モデル ----
  class Piece {
    constructor(id, suit, num = null, honor = null, isRed = false, source = 'deck') {
      this.id = id;
      this.suit = suit;     // 'man'|'pin'|'sou'|'honor'
      this.num = num;       // 1..9 or null
      this.honor = honor;   // 'E'|'S'|'W'|'N'|'P'|'F'|'C' or null
      this.isRed = isRed;
      this._src = source;
    }
  }
  PPL.Piece = Piece;

  // ---- 山（136枚） ----
  class Deck {
    constructor(rng) {
      this.rng = rng || Math.random;
      this.p = [];
      this._create();
      this._shuffle();
    }
    _create() {
      let id = 0;
      ['man', 'pin', 'sou'].forEach(s => {
        for (let n = 1; n <= 9; n++) {
          for (let k = 0; k < 4; k++) {
            const red = (n === 5 && k === 0);
            this.p.push(new Piece(id++, s, n, null, red, 'deck'));
          }
        }
      });
      ['E', 'S', 'W', 'N', 'P', 'F', 'C'].forEach(h => {
        for (let k = 0; k < 4; k++) {
          this.p.push(new Piece(id++, 'honor', null, h, false, 'deck'));
        }
      });
    }
    _shuffle() {
      for (let i = this.p.length - 1; i > 0; i--) {
        const j = Math.floor(this.rng() * (i + 1));
        [this.p[i], this.p[j]] = [this.p[j], this.p[i]];
      }
    }
    draw() { return this.p.pop() || null; }
    remaining() { return this.p.length; }
  }
  PPL.Deck = Deck;

  // ---- 盤面 ----
  class Board {
    constructor(cols, rows) {
      this.COLS = cols;
      this.ROWS = rows;
      this.grid = Array.from({ length: rows }, () => Array(cols).fill(null));
    }
    get(x, y) {
      if (x < 0 || x >= this.COLS || y < 0 || y >= this.ROWS) return null;
      return this.grid[y][x];
    }
    set(x, y, t) {
      if (x < 0 || x >= this.COLS || y < 0 || y >= this.ROWS) return;
      this.grid[y][x] = t;
    }
    isEmpty(x, y) { return this.get(x, y) === null; }
    clearAll() {
      for (let y = 0; y < this.ROWS; y++) for (let x = 0; x < this.COLS; x++) this.grid[y][x] = null;
    }
    applyGravity() {
      for (let x = 0; x < this.COLS; x++) {
        let write = this.ROWS - 1;
        for (let y = this.ROWS - 1; y >= 0; y--) {
          const t = this.grid[y][x];
          if (t) {
            if (write !== y) { this.grid[write][x] = t; this.grid[y][x] = null; }
            write--;
          }
        }
      }
    }
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
            const { x: px, y: py } = st.pop();
            grp.push({ x: px, y: py });
            const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
            for (const [dx, dy] of dirs) {
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
        const t = this.grid[y][x]; if (t) { t._src = 'board'; out.push(t); }
      }
      return out;
    }
  }
  PPL.Board = Board;

  // ---- 落下ペア ----
  class FallingPair {
    constructor(a, b) { this.ax = a; this.rt = b; this.x = 2; this.y = 0; this.r = 0; }
    _off() { return [{ dx: 0, dy: 0 }, { dx: 1, dy: 1 }, { dx: 0, dy: 2 }, { dx: -1, dy: 1 }][this.r]; }
    positions() { const o = this._off(); return [{ x: this.x, y: this.y + 1, t: this.ax }, { x: this.x + o.dx, y: this.y + o.dy, t: this.rt }]; }
    canMove(board, nx, ny, nr = this.r) {
      const tmp = new FallingPair(this.ax, this.rt); tmp.x = nx; tmp.y = ny; tmp.r = nr;
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
      this.state = 'title';         // 'title'|'play'|'alloc'|'hold'|'gameover'
      this.board = new Board(C.COLS, C.ROWS);
      this.deck = new Deck(Math.random);
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

      this.allocTiles = [];
      this.allocAssign = new Map();
      this.allocMode = 'hand';
      this.awaitAlloc = false;

      this.playerHold = null;
      this.cpuHold = null;
      this.holdEvaluated = false;

      this.cpuScore = 0;
      this.cpuWins = 0;
      this.cpuCooldown = 0;

      this.result = null;

      this._prepareNext(4);
    }

    update(dt) {
      switch (this.state) {
        case 'title': this._updateTitle(); break;
        case 'play': this._updatePlay(dt); break;
        case 'alloc': break;
        case 'hold': this._updateHold(); break;
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
            this.processing = false;

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
      const fp = this.falling; if (!fp) return;

      if (this.input.just['ArrowLeft'] || this._rep('ArrowLeft')) { if (fp.canMove(this.board, fp.x - 1, fp.y)) fp.x--; }
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
        // プレイヤー：厳密14枚のみ
        const pj = window.PPL.MJ ? window.PPL.MJ.solve14(this.hand) : { won: false, reason: 'MJ not loaded' };
        if (pj.won) {
          const sc = window.PPL.CPU ? window.PPL.CPU.basicScore(pj.hand) : 0;
          this.playerHold = { won: true, hand: pj.hand, score: sc, pair: pj.pair, melds: pj.melds };
        } else {
          this.playerHold = { won: false, reason: pj.reason };
        }

        // CPU：CPUパラメータガードを適用
        const boardPieces = this.board.allPieces();
        const boardCount  = boardPieces.length;
        const canTryCPU =
          (this.cpuCooldown === 0) &&
          (boardCount >= (C.CPU_BOARD_MIN ?? 0)) &&
          (this.cpuWins < (C.CPU_MAX_WINS ?? Infinity));

        this.cpuHold = (window.PPL.CPU && canTryCPU)
          ? window.PPL.CPU.tryWin(boardPieces, this.discards, this)
          : { won: false, reason: 'skip' };

        this.holdEvaluated = true;
      }

      // 何かキーで確定（ゲーム継続）
      if (Object.keys(this.input.just).length) {
        if (this.playerHold && this.playerHold.won) {
          this.score += this.playerHold.score;
          this.hand = []; // 仕様：プレイヤー和了後は手牌を空に
        }
        if (this.cpuHold && this.cpuHold.won) {
          this.cpuScore += this.cpuHold.score;
          this.cpuWins++;
          this.cpuCooldown = (C.CPU_COOLDOWN_LANDS || 2);
          this.board.clearAll(); // 仕様：CPU和了後は盤面全消去
        }
        this.playerHold = null; this.cpuHold = null; this.holdEvaluated = false;
        this.state = 'play'; this.processing = true; this.chainTimer = 0;
      }
    }

    _land() {
      const ps = this.falling.positions();
      for (const p of ps) { if (p.y >= 0) this.board.set(p.x, p.y, p.t); }
      this.falling = null;
      if (this.cpuCooldown > 0) this.cpuCooldown--;
      this.processing = true; this.chainTimer = 0; this.chainLevel = 0;
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
      this.allocTiles = []; this.allocAssign.clear(); this.awaitAlloc = false;
      this.state = 'hold'; this.holdEvaluated = false;
    }

    _prepareNext(n) {
      while (this.nextQ.length < n && this.deck.remaining() > 0) {
        this.nextQ.push(this.deck.draw());
      }
    }

    _canSupplyNext() {
      const rest = (this.deck ? this.deck.remaining() : 0) + this.nextQ.length;
      return rest >= 2;
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
        const a = this.nextQ.shift(), b = this.nextQ.shift();
        this.falling = new FallingPair(a, b);
        this._prepareNext(2);
        return;
      }
      if (!this.falling && !this.processing && this.state === 'play' && !this._canSupplyNext()) {
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
    _rep(k) { const r = this.input.rep[k]; if (!r) return false; r.t += 16.7; if (r.t > 300) { if (r.t > 350) { r.t = 310; return true; } } return false; }

    // UIフック（配置モーダル）
    onAllocToggleMode(m) { this.allocMode = m; }
    onAllocToggleTile(id) { this.allocAssign.set(id, this.allocMode); }
    onAllocConfirm() { const cnt = this._allocCounts(); if (cnt.hand <= 14) this._finalizeAlloc(); }
    onAllocReset() { for (const t of this.allocTiles) this.allocAssign.set(t.id, 'hand'); }
    _allocCounts() {
      let hand = 0, discard = 0;
      for (const t of this.allocTiles) { const a = this.allocAssign.get(t.id) || 'hand'; if (a === 'hand') hand++; else discard++; }
      return { hand, discard };
    }

    cpuPool() { return { board: this.board.allPieces(), disc: this.discards.slice() }; }
  }
  PPL.Game = Game;

})(window.PPL || {});

// ====== p5 のグローバルフック ======
let __ppl_game;

function setup() {
  const C = (window.PPL && window.PPL.getCFG) ? window.PPL.getCFG() : {
    CANVAS_W: 960, CANVAS_H: 540, DPR: (window.devicePixelRatio || 1)
  };
  createCanvas(C.CANVAS_W, C.CANVAS_H);
  // ★ DPR（Retina）対応
  if (typeof pixelDensity === 'function') {
    pixelDensity(C.DPR || (window.devicePixelRatio || 1));
  }
  __ppl_game = new window.PPL.Game();
}

function draw() {
  background(236, 240, 241);
  if (!__ppl_game) return;

  __ppl_game.update(16.7);

  if (window.PPL.UI) {
    window.PPL.UI.Hitbox && window.PPL.UI.Hitbox.clear && window.PPL.UI.Hitbox.clear();
    // タイトル
    if (__ppl_game.state === 'title') { window.PPL.UI.drawTitle && window.PPL.UI.drawTitle(); return; }

    // 盤面＆HUD
    window.PPL.UI.drawBoard && window.PPL.UI.drawBoard(__ppl_game);
    window.PPL.UI.drawHUD && window.PPL.UI.drawHUD(__ppl_game);

    // 配置モーダル
    if (__ppl_game.state === 'alloc' && window.PPL.UI.drawAllocModal) window.PPL.UI.drawAllocModal(__ppl_game);

    // ホールド
    if (__ppl_game.state === 'hold' && window.PPL.UI.drawHoldOverlay) { window.PPL.UI.drawHoldOverlay(__ppl_game); return; }

    // ゲーム終了
    if (__ppl_game.state === 'gameover' && window.PPL.UI.drawGameOverOverlay) { window.PPL.UI.drawGameOverOverlay(__ppl_game); return; }
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
    case 'alloc-mode': __ppl_game.onAllocToggleMode(hit.mode); break;
    case 'alloc-tile': __ppl_game.onAllocToggleTile(hit.tileId); break;
    case 'alloc-confirm': __ppl_game.onAllocConfirm(); break;
    case 'alloc-reset': __ppl_game.onAllocReset(); break;
  }
}
