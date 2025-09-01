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
    CPU_COOLDOWN_LANDS: 0,   // 無効化
    CPU_BOARD_MIN: 0,        // 無効化
    CPU_MAX_WINS: Infinity,  // 無制限

    // 追加パラメータ
    CPU_WIN_PER_HOLD: 1,           // 1HOLDにつき最大1回
    CPU_CLEAR_POLICY: 'used-only', // CPU勝利時、使用した盤面牌のみ除去

    // -----------------------------------------------------
    // 「絶妙な偏り」：A+B（ゾロ率の短期均し + 走り防止）
    // -----------------------------------------------------
    BIAS_ENABLED: true,           // オン/オフ切り替え

    // A) ゾロ（同スート2枚）率の短期均し
    BIAS_WINDOW_PAIRS: 16,        // 直近ペア数の観測窓
    BIAS_ZORO_TARGET: 0.24,       // 目標ゾロ率（ぷよ流の“素直さ”を感じる付近）
    BIAS_ZORO_MIN: 0.12,          // 次ペアをゾロにする確率の下限
    BIAS_ZORO_MAX: 0.36,          // 上限
    BIAS_ZORO_FEEDBACK: 0.6,      // 目標との差に対するフィードバック強度（0..1）

    // B) 走り防止
    BIAS_MAX_STREAK: 2,           // 主スートの連続何ペアまで許容するか
    BIAS_STREAK_PENALTY: 0.2,     // 連続上限到達時、そのスートの重みにかける係数

    // 在庫偏重（終盤の枯渇ケア）
    BIAS_REMAINING_GAMMA: 1.2,    // 在庫比率の重み指数（1.0で線形、>1で在庫多い色に寄せる）

    // 微小ノイズ（重みが同程度のときのブレ）
    BIAS_NOISE_EPS: 1e-3
  };

  PPL.CFG = CFG;
  PPL.getCFG = () => PPL.CFG;
})(window.PPL || {});
