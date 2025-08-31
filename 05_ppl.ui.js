// 05_ppl.ui.js
// 描画と簡易UI（ヒットボックス管理を含む）

(function () {
  const P = (window.PPL = window.PPL || {});
  const UI = (P.UI = P.UI || {});
  const C = (P.getCFG ? P.getCFG() : {
    CANVAS_W: 960, CANVAS_H: 540, COLS: 6, ROWS: 12, CELL: 32, BOARD_X: 40, BOARD_Y: 40, DECK_TOTAL: 136
  });

  // ------------------------------
  // Hitbox 管理
  // ------------------------------
  UI.Hitbox = UI.Hitbox || {
    _list: [],
    clear() { this._list.length = 0; },
    add(x, y, w, h, payload) { this._list.push({ x, y, w, h, payload }); },
    dispatch(mx, my) {
      for (let i = this._list.length - 1; i >= 0; i--) {
        const r = this._list[i];
        if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) return r.payload;
      }
      return null;
    }
  };

  // ------------------------------
  // 並び替えルール（萬→筒→索→字）
  // ------------------------------
  const SUIT_ORDER = { man: 0, pin: 1, sou: 2, honor: 3 };
  const HONOR_ORDER = { E: 0, S: 1, W: 2, N: 3, P: 4, F: 5, C: 6 };

  function tileCompare(a, b) {
    const sa = SUIT_ORDER[a.suit] ?? 99;
    const sb = SUIT_ORDER[b.suit] ?? 99;
    if (sa !== sb) return sa - sb;

    if (a.suit === 'honor' || b.suit === 'honor') {
      const ha = HONOR_ORDER[a.honor] ?? 99;
      const hb = HONOR_ORDER[b.honor] ?? 99;
      return ha - hb;
    }
    const na = a.num ?? 0;
    const nb = b.num ?? 0;
    return na - nb;
  }
  function sortTiles(arr) {
    return (arr || []).slice().sort(tileCompare);
  }

  // ------------------------------
  // 牌描画（テキスト顔）— 正方形タイル版
  // ------------------------------
  const FACE_COL = {
    man: "#c62828", // 萬（「萬」は常に赤）
    pin: "#1565c0",
    sou: "#2e7d32",
    wind: "#111",
    dragon_chun: "#c62828",
    dragon_hatsu:"#2e7d32",
    dragon_haku: "#111"
  };
  const KANJI_NUM = ["一","二","三","四","五","六","七","八","九"];
  const ROMAN_NUM = ["Ⅰ","Ⅱ","Ⅲ","Ⅳ","Ⅴ","Ⅵ","Ⅶ","Ⅷ","Ⅸ"];
  const MARU_NUM  = ["①","②","③","④","⑤","⑥","⑦","⑧","⑨"];

  // 角丸矩形
  function roundRect(ctx, x, y, w, h, r){
    const rr = Math.min(r, w/2, h/2);
    ctx.beginPath();
    ctx.moveTo(x+rr, y);
    ctx.arcTo(x+w, y, x+w, y+h, rr);
    ctx.arcTo(x+w, y+h, x, y+h, rr);
    ctx.arcTo(x, y+h, x, y, rr);
    ctx.arcTo(x, y, x+w, y, rr);
    ctx.closePath();
  }

  // Piece -> painter option
  function pieceToOpt(t){
    if (!t) return null;
    if (t.suit === 'honor'){
      if (t.honor === 'P') return { type:'dragon', dragon:'haku' };
      if (t.honor === 'F') return { type:'dragon', dragon:'hatsu' };
      if (t.honor === 'C') return { type:'dragon', dragon:'chun' };
      return { type:'wind', wind: t.honor || 'E' };
    }
    return { type: t.suit, num: t.num || 1, isRed: !!t.isRed };
  }

  // タイル描画（ctx）
  function drawTileCanvas2D(ctx, x, y, size, opt){
    if (!opt) return;
    const w = size, h = size; // 正方形
    const r = Math.round(size * 0.18);
    const cx = x + w/2;
    const cy = y + h/2;

    ctx.save();
    // 台座（白）
    roundRect(ctx, x, y, w, h, r);
    ctx.fillStyle = "#fff";
    ctx.fill();
    // 内枠
    ctx.lineWidth = Math.max(1.5, size * 0.06);
    ctx.strokeStyle = "#333";
    ctx.lineJoin = "round";
    ctx.stroke();

    // 数牌
    if (opt.type === "man" || opt.type === "pin" || opt.type === "sou"){
      const suitText = (opt.type === 'man') ? "萬" : (opt.type === 'pin' ? "筒" : "索");
      const suitCol  = (opt.type === 'man') ? FACE_COL.man : (opt.type === 'pin' ? FACE_COL.pin : FACE_COL.sou);

      let topText = "?";
      if (opt.type === 'man') topText = KANJI_NUM[(opt.num||1)-1] || "?";
      if (opt.type === 'pin') topText = MARU_NUM[(opt.num||1)-1] || String(opt.num||1);
      if (opt.type === 'sou') topText = ROMAN_NUM[(opt.num||1)-1] || "?";

      const numCol  = opt.isRed ? FACE_COL.dragon_chun : (opt.type === 'man' ? "#111" : suitCol);
      const suitColFinal = suitCol; // 「萬」は常に赤

      const numSize  = Math.round(size * 0.60);
      const suitSize = Math.round(size * 0.46);

      ctx.fillStyle = numCol;
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.font = `bold ${numSize}px "Noto Sans JP", system-ui, sans-serif`;
      ctx.fillText(topText, cx, y + size * 0.46);

      ctx.fillStyle = suitColFinal;
      ctx.textBaseline = "hanging";
      ctx.font = `bold ${suitSize}px "Noto Sans JP", system-ui, sans-serif`;
      ctx.fillText(suitText, cx, y + size * 0.52);

      ctx.restore();
      return;
    }

    // 風牌
    if (opt.type === "wind"){
      const map = {E:"東", S:"南", W:"西", N:"北"};
      ctx.fillStyle = FACE_COL.wind;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `bold ${Math.round(size * 0.60)}px "Noto Sans JP", system-ui, sans-serif`;
      ctx.fillText(map[opt.wind] || "？", cx, cy);
      ctx.restore();
      return;
    }

    // 三元牌
    if (opt.type === "dragon"){
      if (opt.dragon === "haku"){
        // 白は文字なし
      } else if (opt.dragon === "hatsu"){
        ctx.fillStyle = FACE_COL.dragon_hatsu;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = `bold ${Math.round(size * 0.60)}px "Noto Sans JP", system-ui, sans-serif`;
        ctx.fillText("發", cx, cy);
      } else {
        ctx.fillStyle = FACE_COL.dragon_chun;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = `bold ${Math.round(size * 0.60)}px "Noto Sans JP", system-ui, sans-serif`;
        ctx.fillText("中", cx, cy);
      }
      ctx.restore();
      return;
    }

    ctx.restore();
  }

  // 既存APIを維持：Piece→Canvas2D描画
  function drawTile(piece, x, y, size){
    const ctx = (window.drawingContext || (window._renderer && window._renderer.drawingContext));
    if (!ctx) return;
    const opt = pieceToOpt(piece);
    drawTileCanvas2D(ctx, x, y, size, opt);
  }

  // keys からダミー牌を生成（CPUプレビュー/ホールド描画用）
  function tileFromKey(k) {
    if (!k) return null;
    if (Array.isArray(k)) k = k[0];
    if (typeof k === 'object' && k.key) k = k.key;
    if (typeof k !== 'string') return null;

    if (k.startsWith('h_')) {
      const h = k.split('_')[1];
      return new P.Piece(-1, 'honor', null, h, false, 'cpu');
    }
    const [suit, n] = k.split('_');
    if (!suit || !n) return null;
    return new P.Piece(-1, suit, parseInt(n, 10), null, false, 'cpu');
  }

  // ------------------------------
  // 盤面・落下中・NEXT
  // ------------------------------
  UI.drawBoard = function (game) {
    const bx = C.BOARD_X, by = C.BOARD_Y, cs = C.CELL;
    // 外枠
    push();
    stroke(52, 73, 94); strokeWeight(2); noFill();
    rect(bx - 1, by - 1, C.COLS * cs + 2, C.ROWS * cs + 2);

    // グリッド
    stroke(189, 195, 199); strokeWeight(1);
    for (let i = 0; i <= C.COLS; i++) line(bx + i * cs, by, bx + i * cs, by + C.ROWS * cs);
    for (let i = 0; i <= C.ROWS; i++) line(bx, by + i * cs, bx + C.COLS * cs, by + i * cs);
    pop();

    // 固定牌
    for (let y = 0; y < C.ROWS; y++) for (let x = 0; x < C.COLS; x++) {
      const t = game.board.get(x, y);
      if (t) drawTile(t, bx + x * cs, by + y * cs, cs);
    }

    // 落下中
    if (game.falling) {
      for (const p of game.falling.positions()) {
        if (p.y >= 0) drawTile(p.t, bx + p.x * cs, by + p.y * cs, cs);
      }
    }
  };

  // ------------------------------
  // HUD（右パネル）
  // ------------------------------
  UI.drawHUD = function (game) {
    const panelX = C.BOARD_X + C.COLS * C.CELL + 60;
    const panelY = C.BOARD_Y;

    // 残り牌バー
    const remain = game.deck && typeof game.deck.remaining === 'function' ? game.deck.remaining() : 0;
    const total = C.DECK_TOTAL || 136;
    const barW = 300, barH = 14;
    push();
    noStroke(); fill(210); rect(panelX, panelY, barW, barH, 6);
    fill(52, 152, 219); rect(panelX, panelY, barW * (remain / total), barH, 6);

    // ラベル
    fill(44, 62, 80); textAlign(LEFT, TOP); textSize(16);
    text(`残り牌: ${remain}/${total}`, panelX, panelY + 18);

    // NEXT
    text(`NEXT:`, panelX, panelY + 44);
    if (Array.isArray(game.nextQ)) {
      if (game.nextQ[0]) drawTile(game.nextQ[0], panelX + 60, panelY + 36, 28);
      if (game.nextQ[1]) drawTile(game.nextQ[1], panelX + 95, panelY + 36, 28);
    }

    // スコア類
    text(`スコア: ${game.score}`, panelX, panelY + 76);
    text(`連鎖: ${game.chainLevel || 0}`, panelX, panelY + 100);

    // 手牌（表示のみ）
    const handSorted = sortTiles(game.hand);
    text(`手牌: ${game.hand.length}/14`, panelX, panelY + 124);
    let x = panelX, y = panelY + 150;
    for (const t of handSorted) { drawTile(t, x, y, 28); x += 34; if (x > panelX + barW - 30) { x = panelX; y += 34; } }

    // 仕切り線
    stroke(180); strokeWeight(2); line(panelX, y + 40, panelX + barW, y + 40);

    // CPU 情報
    const cpuY = y + 56;
    noStroke(); fill(44, 62, 80); text(`CPU スコア: ${game.cpuScore || 0}`, panelX, cpuY);
    text(`成立状況:`, panelX, cpuY + 24);

    // プレビュー
    let preview = null;
    try {
      if (P.CPU && typeof P.CPU.previewPartial === 'function') {
        preview = P.CPU.previewPartial(game.cpuPool ? game.cpuPool() : { board: [], disc: [] });
      }
    } catch { preview = null; }

    const drawMeldCPU = (meld, sx, sy) => {
      if (!meld) return sx;
      if (meld.type === 'triplet') {
        const t = tileFromKey(meld.keys ? meld.keys[0] : meld.key);
        if (t) { drawTile(t, sx, sy, 22); drawTile(t, sx + 26, sy, 22); drawTile(t, sx + 52, sy, 22); }
        return sx + 80;
      } else if (meld.type === 'sequence') {
        const t1 = tileFromKey(meld.keys && meld.keys[0]);
        const t2 = tileFromKey(meld.keys && meld.keys[1]);
        const t3 = tileFromKey(meld.keys && meld.keys[2]);
        if (t1 && t2 && t3) { drawTile(t1, sx, sy, 22); drawTile(t2, sx + 26, sy, 22); drawTile(t3, sx + 52, sy, 22); }
        return sx + 80;
      }
      return sx;
    };

    let sx = panelX, sy = cpuY + 48;
    if (preview && Array.isArray(preview.melds) && preview.melds.length > 0) {
      const limit = Math.min(preview.melds.length, 4);
      for (let i = 0; i < limit; i++) sx = drawMeldCPU(preview.melds[i], sx, sy);
      if (preview.pair && preview.pair.key) {
        const t = tileFromKey(preview.pair.key);
        if (t) { drawTile(t, sx + 8, sy + 30, 22); drawTile(t, sx + 34, sy + 30, 22); }
      }
    } else {
      fill(120); text('（未成立）', panelX + 64, cpuY + 24);
    }

    pop();
  };

  // ------------------------------
  // 配置モーダル
  // ------------------------------
  UI.drawAllocModal = function (game) {
    // 背景
    push();
    fill(0, 0, 0, 140); noStroke(); rect(0, 0, C.CANVAS_W, C.CANVAS_H);
    pop();

    const W = C.CANVAS_W * 0.82, H = C.CANVAS_H * 0.70;
    const X = (C.CANVAS_W - W) / 2, Y = (C.CANVAS_H - H) / 2;

    // 本体
    push();
    noStroke(); fill(255); rect(X, Y, W, H, 8);
    fill(44, 62, 80); textSize(18); textAlign(LEFT, TOP);
    text('【 牌の配置を調整してください 】', X + 16, Y + 12);
    textSize(12); fill(90);
    text('手牌は14枚まで。超えた分は捨ててください。', X + 16, Y + 40);

    // モードボタン
    const btnW = 74, btnH = 28, gap = 10;
    const btnY = Y + 64, btnX1 = X + 16, btnX2 = btnX1 + btnW + gap;
    const active = (m) => (game.allocMode === m);

    const drawBtn = (bx, by, label, mode) => {
      const bg = active(mode) ? color(52, 152, 219) : color(230);
      fill(bg); noStroke(); rect(bx, by, btnW, btnH, 6);
      fill(active(mode) ? 255 : 40); textAlign(CENTER, CENTER); textSize(13);
      text(label, bx + btnW / 2, by + btnH / 2);
      UI.Hitbox.add(bx, by, btnW, btnH, { type: 'alloc-mode', mode });
    };
    drawBtn(btnX1, btnY, '手牌', 'hand');
    drawBtn(btnX2, btnY, '捨て牌', 'discard');

    // タイル一覧（ダブル枠）
    const listX = X + 16, listY = btnY + 40;
    let dx = listX, dy = listY;
    const TILE = 30, STEP = 36;
    const showTiles = sortTiles(game.allocTiles);

    // 枠色を明示（手牌＝青 / 捨て牌＝赤）
    const HAND_BORDER = color(52, 152, 219);
    const DISC_BORDER = color(231, 76, 60);

    for (const t of showTiles) {
      const assign = game.allocAssign.get(t.id) || 'hand';
      const frameCol = (assign === 'discard') ? DISC_BORDER : HAND_BORDER;

      // 外側ハイライト枠（指定：捨て牌は赤）
      push();
      noFill();
      stroke(frameCol);
      strokeWeight(3.5);
      strokeJoin(ROUND);
      rect(dx, dy, TILE, TILE, 6);

      // 牌（内枠つき）
      drawTile(t, dx, dy, TILE);
      pop();

      // ヒットボックス
      UI.Hitbox.add(dx, dy, TILE, TILE, { type: 'alloc-tile', tileId: t.id });

      dx += STEP;
      if (dx + TILE > X + W - 16) { dx = listX; dy += STEP; }
    }

    // プレビュー（右側情報）
    const infoX = X + W - 260;
    const infoY = Y + 28;
    fill(44, 62, 80); textAlign(LEFT, TOP); textSize(14);
    const cnt = (() => {
      let hand = 0, discard = 0;
      for (const t of game.allocTiles) {
        const a = game.allocAssign.get(t.id) || 'hand';
        if (a === 'hand') hand++; else discard++;
      }
      return { hand, discard };
    })();
    text('プレビュー（手牌 14枚まで）', infoX, infoY);
    text(`手牌: ${Math.min(cnt.hand, 14)}/14`, infoX, infoY + 22);
    text(`捨て牌: ${cnt.discard}`, infoX, infoY + 40);
    if (cnt.hand > 14) {
      fill(192, 57, 43);
      text('あと ' + (cnt.hand - 14) + ' 枚捨ててください', infoX, infoY + 60);
      fill(44, 62, 80);
    }

    // 手牌プレビュー（下部）— 手牌のみ表示
    let px = X + 16, py = Y + H - 90;
    fill(44, 62, 80); text('手牌プレビュー', px, py - 20);
    const hands = [];
    for (const t of game.allocTiles) if ((game.allocAssign.get(t.id) || 'hand') === 'hand') hands.push(t);
    const handsSorted = sortTiles(hands);
    for (let i = 0; i < Math.min(handsSorted.length, 14); i++) {
      drawTile(handsSorted[i], px, py, 28);
      px += 34; if (px > X + W - 40) { px = X + 16; py += 34; }
    }

    // ボタン
    const okX = X + W - 220, okY = Y + H - 48, okW = 90, okH = 32;
    const reX = X + W - 110, reY = okY, reW = 90, reH = 32;

    const canConfirm = (cnt.hand <= 14);
    fill(canConfirm ? color(39, 174, 96) : color(160));
    noStroke(); rect(okX, okY, okW, okH, 6);
    fill(255); textAlign(CENTER, CENTER); textSize(14); text('確定', okX + okW / 2, okY + okH / 2);
    UI.Hitbox.add(okX, okY, okW, okH, { type: 'alloc-confirm' });

    fill(245); stroke(120); rect(reX, reY, reW, reH, 6);
    noStroke(); fill(60); text('リセット', reX + reW / 2, reY + reH / 2);
    UI.Hitbox.add(reX, reY, reW, reH, { type: 'alloc-reset' });

    pop();
  };

  // ------------------------------
  // ホールド（結果確認）
  // ------------------------------
  UI.drawHoldOverlay = function (game) {
    // 背景
    push();
    fill(0, 0, 0, 160); noStroke(); rect(0, 0, C.CANVAS_W, C.CANVAS_H);
    pop();

    const W = 640, H = 320, X = (C.CANVAS_W - W) / 2, Y = (C.CANVAS_H - H) / 2;

    push();
    fill(255); noStroke(); rect(X, Y, W, H, 8);
    fill(44, 62, 80); textAlign(CENTER, TOP); textSize(20);
    text('結果確認（何かキーで継続）', X + W / 2, Y + 14);

    // プレイヤー結果
    textAlign(LEFT, TOP); textSize(16);
    text('プレイヤー', X + 20, Y + 50);
    let px = X + 20, py = Y + 80;

    if (game.playerHold && game.playerHold.won) {
      const melds = game.playerHold.melds || [];
      if (Array.isArray(melds[0])) {
        for (const arr of melds) {
          const t1 = arr[0], t2 = arr[1], t3 = arr[2];
          drawTile(t1, px, py, 26); drawTile(t2, px + 28, py, 26); drawTile(t3, px + 56, py, 26);
          px += 90;
        }
      } else if (melds[0] && melds[0].type) {
        for (const m of melds) {
          if (m.type === 'triplet') {
            const t = tileFromKey(m.key || (m.keys && m.keys[0]));
            drawTile(t, px, py, 26); drawTile(t, px + 28, py, 26); drawTile(t, px + 56, py, 26);
            px += 90;
          } else if (m.type === 'sequence') {
            const t1 = tileFromKey(m.keys && m.keys[0]);
            const t2 = tileFromKey(m.keys && m.keys[1]);
            const t3 = tileFromKey(m.keys && m.keys[2]);
            drawTile(t1, px, py, 26); drawTile(t2, px + 28, py, 26); drawTile(t3, px + 56, py, 26);
            px += 90;
          }
        }
      }
      if (Array.isArray(game.playerHold.pair) && game.playerHold.pair.length >= 2) {
        drawTile(game.playerHold.pair[0], X + 20, py + 36, 26);
        drawTile(game.playerHold.pair[1], X + 48, py + 36, 26);
      } else if (typeof game.playerHold.pair === 'string') {
        const t = tileFromKey(game.playerHold.pair);
        drawTile(t, X + 20, py + 36, 26); drawTile(t, X + 48, py + 36, 26);
      }
      fill(39, 174, 96); text(`+${game.playerHold.score} 点`, X + W - 160, Y + 50);
    } else {
      fill(120); text('（未成立）', X + 20, py);
    }

    // CPU 結果
    fill(44, 62, 80); text('CPU', X + 20, Y + 150);
    px = X + 20; py = Y + 180;
    if (game.cpuHold && game.cpuHold.won) {
      for (const m of (game.cpuHold.melds || [])) {
        if (m.type === 'triplet') {
          const t = tileFromKey(m.key || (m.keys && m.keys[0])); drawTile(t, px, py, 26); drawTile(t, px + 28, py, 26); drawTile(t, px + 56, py, 26);
          px += 90;
        } else if (m.type === 'sequence') {
          const t1 = tileFromKey(m.keys && m.keys[0]);
          const t2 = tileFromKey(m.keys && m.keys[1]);
          const t3 = tileFromKey(m.keys && m.keys[2]);
          drawTile(t1, px, py, 26); drawTile(t2, px + 28, py, 26); drawTile(t3, px + 56, py, 26);
          px += 90;
        }
      }
      if (game.cpuHold.pair) {
        const t = tileFromKey(game.cpuHold.pair);
        drawTile(t, X + 20, py + 36, 26); drawTile(t, X + 48, py + 36, 26);
      }
      fill(39, 174, 96); text(`+${game.cpuHold.score} 点`, X + W - 160, Y + 150);
    } else {
      fill(120); text('（未成立）', X + 20, py);
    }

    pop();
  };

  // ------------------------------
  // ゲーム終了オーバーレイ
  // ------------------------------
  UI.drawGameOverOverlay = function (g) {
    push();
    fill(0, 0, 0, 180); noStroke(); rect(0, 0, C.CANVAS_W, C.CANVAS_H);

    const W = 520, H = 240, X = (C.CANVAS_W - W) / 2, Y = (C.CANVAS_H - H) / 2;
    fill(255); noStroke(); rect(X, Y, W, H, 8);

    fill(44, 62, 80); textAlign(CENTER, TOP); textSize(22);
    text('ゲーム終了', X + W / 2, Y + 16);

    textSize(16);
    text(`あなた: ${g?.result?.playerTotal ?? 0} 点`, X + W / 2, Y + 70);
    text(`CPU   : ${g?.result?.cpuTotal ?? 0} 点`, X + W / 2, Y + 100);

    const winner = g?.result?.winner;
    const msg = winner === 'player' ? 'あなたの勝ち' : winner === 'cpu' ? 'CPUの勝ち' : '引き分け';
    text(msg, X + W / 2, Y + 136);

    text('Rキーで再開', X + W / 2, Y + 176);
    pop();
  };

  // ------------------------------
  // タイトル
  // ------------------------------
  UI.drawTitle = function () {
    push();
    fill(44, 62, 80); noStroke();
    textAlign(CENTER, CENTER);
    textSize(48); text('牌牌連鎖', C.CANVAS_W / 2, C.CANVAS_H / 2 - 40);
    textSize(18); text('何かキーを押してスタート', C.CANVAS_W / 2, C.CANVAS_H / 2 + 20);
    pop();
  };

})();
