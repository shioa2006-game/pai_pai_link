// 01_ppl.config.js
(function (PPL) {
  'use strict';
  PPL = (window.PPL = window.PPL || {});

  const CFG = {
    // Canvas / Layout
    CANVAS_W: 960,
    CANVAS_H: 540,
    DPR: (window.devicePixelRatio || 1),

    COLS: 6,
    ROWS: 12,
    CELL: 32,

    BOARD_X: 40,
    BOARD_Y: 40,
    PANEL_X: 300,
    PANEL_Y: 40,

    MODAL_W: 860,
    MODAL_H: 420,
    MODAL_TILE_SIZE: 32,
    MODAL_GRID_GAP: 8,
    MODAL_RIGHT_W: 250,

    // Game
    DECK_TOTAL: 136,
    FALL_INTERVAL_MS: 1000,
    CHAIN_TICK_MS: 500,

    // --- CPU 挙動（今回の仕様） ---
    // クールダウン／回数上限／盤面最小ガードは実質無効化
    CPU_COOLDOWN_LANDS: 0,  // 無効化
    CPU_BOARD_MIN: 0,       // 無効化
    CPU_MAX_WINS: Infinity, // 無制限

    // 追加パラメータ
    CPU_WIN_PER_HOLD: 1,          // 1HOLDにつき最大1回
    CPU_CLEAR_POLICY: 'used-only' // CPU勝利時、使用した盤面牌のみ除去
  };

  PPL.CFG = CFG;
  PPL.getCFG = () => PPL.CFG;
})(window.PPL || {});
