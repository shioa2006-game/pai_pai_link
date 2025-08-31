// 01_ppl.config.js
(function (PPL) {
  'use strict';
  PPL = (window.PPL = window.PPL || {});
  const CFG = {
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

    DECK_TOTAL: 136,
    FALL_INTERVAL_MS: 1000,
    CHAIN_TICK_MS: 500,

    // CPU 調整
    CPU_COOLDOWN_LANDS: 2,  // CPUが和了した後、2回の着地分は休止
    CPU_BOARD_MIN: 6,       // 盤面タイルが6未満なら判定しない
    CPU_MAX_WINS: 2         // 1ステージ相当での最大和了回数（MVP用）
  };
  PPL.CFG = CFG;
  PPL.getCFG = () => PPL.CFG;
})(window.PPL || {});
