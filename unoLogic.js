// unoLogic.js — Core UNO rules engine (server-authoritative)
'use strict';

const COLORS = ['red', 'yellow', 'green', 'blue'];
const WILD = 'wild';

function buildDeck() {
  const deck = [];
  let uid = 0;
  const push = (card, count = 1) => {
    for (let i = 0; i < count; i++) deck.push({ ...card, uid: `c${uid++}` });
  };

  for (const color of COLORS) {
    push({ color, value: '0', type: 'number' }, 1);
    for (let n = 1; n <= 9; n++) push({ color, value: String(n), type: 'number' }, 2);
    push({ color, value: 'skip', type: 'skip' }, 2);
    push({ color, value: 'reverse', type: 'reverse' }, 2);
    push({ color, value: 'draw2', type: 'draw2' }, 2);
  }
  push({ color: WILD, value: 'wild', type: 'wild' }, 4);
  push({ color: WILD, value: 'wild4', type: 'wild4' }, 4);

  return deck;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function canPlay(card, topCard, activeColor) {
  if (card.type === 'wild' || card.type === 'wild4') return true;
  const color = activeColor || topCard.color;
  if (card.color === color) return true;
  if (card.type === 'number' && topCard.type === 'number' && card.value === topCard.value) return true;
  if (card.type !== 'number' && card.type === topCard.type) return true;
  return false;
}

class UnoGame {
  constructor(roomId, playerIds) {
    this.roomId = roomId;
    this.players = playerIds.map((id) => ({ id, hand: [], calledUno: false }));
    this.direction = 1;
    this.turnIndex = 0;
    this.activeColor = null;
    this.discard = [];
    this.drawPile = [];
    this.pendingDraw = 0; // accumulated draw2/wild4 stack
    this.status = 'playing'; // playing | finished
    this.winner = null;
    this._deal();
  }

  _deal() {
    let deck = shuffle(buildDeck());
    for (const p of this.players) {
      p.hand = deck.splice(0, 7);
    }
    // first discard must be a number card to keep things simple/fair
    let firstIdx = deck.findIndex((c) => c.type === 'number');
    const first = deck.splice(firstIdx, 1)[0];
    this.discard = [first];
    this.activeColor = first.color;
    this.drawPile = deck;
  }

  currentPlayer() {
    return this.players[this.turnIndex];
  }

  topCard() {
    return this.discard[this.discard.length - 1];
  }

  _advanceTurn(steps = 1) {
    const n = this.players.length;
    this.turnIndex = (this.turnIndex + this.direction * steps + n * 4) % n;
    this._enforceUnoPenalty();
  }

  // Kalau pemain lupa "UNO!" waktu tangannya tinggal 1 kartu, begitu giliran
  // balik ke dia lagi dia otomatis kena hukuman ambil 2 kartu (aturan asli UNO).
  _enforceUnoPenalty() {
    const p = this.currentPlayer();
    if (p && p.pendingUnoPenalty && p.hand.length === 1 && !p.calledUno) {
      this.drawCards(p, 2);
      p.pendingUnoPenalty = false;
    }
  }

  _reshuffleIfNeeded() {
    if (this.drawPile.length === 0) {
      const top = this.discard.pop();
      this.drawPile = shuffle(this.discard);
      this.discard = [top];
    }
  }

  drawCards(player, count) {
    const drawn = [];
    for (let i = 0; i < count; i++) {
      this._reshuffleIfNeeded();
      if (this.drawPile.length === 0) break;
      const card = this.drawPile.pop();
      player.hand.push(card);
      drawn.push(card);
    }
    return drawn;
  }

  // action: { type: 'play', uid, chosenColor? } | { type: 'draw' } | { type: 'callUno' }
  applyAction(playerId, action) {
    const player = this.players.find((p) => p.id === playerId);
    if (!player) return { ok: false, error: 'Pemain tidak ditemukan' };
    if (this.status !== 'playing') return { ok: false, error: 'Game sudah selesai' };

    // PENTING: callUno HARUS bisa dipanggil kapan pun, bukan cuma pas giliran
    // sendiri -- karena begitu kartu ke-2-terakhir dimainkan, giliran langsung
    // pindah ke pemain lain. Kalau dicek "harus giliran sendiri" di sini,
    // tombol UNO jadi nyaris mustahil kepake (bug lama).
    if (action.type === 'callUno') {
      if (player.hand.length === 1) {
        player.calledUno = true;
        player.pendingUnoPenalty = false;
      }
      return { ok: true };
    }

    if (this.currentPlayer().id !== playerId) return { ok: false, error: 'Bukan giliranmu' };

    if (action.type === 'draw') {
      const count = this.pendingDraw > 0 ? this.pendingDraw : 1;
      this.drawCards(player, count);
      this.pendingDraw = 0;
      player.calledUno = false;
      this._advanceTurn(1);
      return { ok: true };
    }

    if (action.type === 'play') {
      const idx = player.hand.findIndex((c) => c.uid === action.uid);
      if (idx === -1) return { ok: false, error: 'Kartu tidak ada di tanganmu' };
      const card = player.hand[idx];
      const top = this.topCard();

      if (this.pendingDraw > 0) {
        const stackable = (card.type === 'draw2' && top.type === 'draw2') ||
          (card.type === 'wild4');
        if (!stackable) return { ok: false, error: 'Harus tumpuk Draw kartu atau ambil kartu' };
      } else if (!canPlay(card, top, this.activeColor)) {
        return { ok: false, error: 'Kartu tidak bisa dimainkan' };
      }

      if ((card.type === 'wild' || card.type === 'wild4') && !COLORS.includes(action.chosenColor)) {
        return { ok: false, error: 'Pilih warna untuk kartu wild' };
      }

      // Fitur "kartu dobel": kalau kartu utama angka, boleh sekalian buang
      // kartu angka lain yang nilainya sama persis (warna boleh beda).
      let extraCards = [];
      if (card.type === 'number' && Array.isArray(action.extraUids) && action.extraUids.length) {
        for (const eUid of action.extraUids) {
          if (eUid === action.uid) continue;
          const eCard = player.hand.find((c) => c.uid === eUid);
          if (eCard && eCard.type === 'number' && eCard.value === card.value) {
            extraCards.push(eCard);
          }
        }
      }

      const playedUids = new Set([card.uid, ...extraCards.map((c) => c.uid)]);
      player.hand = player.hand.filter((c) => !playedUids.has(c.uid));
      this.discard.push(card, ...extraCards);

      const lastPlayed = extraCards.length ? extraCards[extraCards.length - 1] : card;
      if (card.type === 'wild' || card.type === 'wild4') {
        this.activeColor = action.chosenColor;
      } else {
        this.activeColor = lastPlayed.color;
      }

      if (player.hand.length === 0) {
        this.status = 'finished';
        this.winner = player.id;
        return { ok: true, gameOver: true, winner: player.id, doubled: extraCards.length };
      }

      if (player.hand.length === 1 && !player.calledUno) {
        // penalty handled by room layer via timer; flag it here
        player.pendingUnoPenalty = true;
      } else {
        player.pendingUnoPenalty = false;
      }
      if (player.hand.length !== 1) player.calledUno = false;

      // resolve action effects
      switch (card.type) {
        case 'skip':
          this._advanceTurn(2);
          break;
        case 'reverse':
          this.direction *= -1;
          if (this.players.length === 2) this._advanceTurn(2);
          else this._advanceTurn(1);
          break;
        case 'draw2':
          this.pendingDraw += 2;
          this._advanceTurn(1);
          break;
        case 'wild4':
          this.pendingDraw += 4;
          this._advanceTurn(1);
          break;
        default:
          this._advanceTurn(1);
      }
      return { ok: true, doubled: extraCards.length };
    }

    return { ok: false, error: 'Aksi tidak dikenal' };
  }

  // Dipakai server saat waktu giliran habis: kalau ada kartu yang bisa
  // dimainkan, otomatis mainkan salah satu (dipilih acak dari yang valid).
  // Kalau tidak ada kartu yang bisa dimainkan, otomatis ambil kartu.
  getRandomValidAction() {
    const player = this.currentPlayer();
    const top = this.topCard();

    if (this.pendingDraw > 0) {
      const stackable = player.hand.filter(
        (c) => (c.type === 'draw2' && top.type === 'draw2') || c.type === 'wild4'
      );
      if (stackable.length) {
        const card = stackable[Math.floor(Math.random() * stackable.length)];
        const chosenColor = card.type === 'wild4' ? COLORS[Math.floor(Math.random() * COLORS.length)] : undefined;
        return { type: 'play', uid: card.uid, chosenColor };
      }
      return { type: 'draw' };
    }

    const playable = player.hand.filter((c) => canPlay(c, top, this.activeColor));
    if (playable.length) {
      const card = playable[Math.floor(Math.random() * playable.length)];
      const chosenColor =
        card.type === 'wild' || card.type === 'wild4'
          ? COLORS[Math.floor(Math.random() * COLORS.length)]
          : undefined;
      return { type: 'play', uid: card.uid, chosenColor };
    }
    return { type: 'draw' };
  }

  publicState(forPlayerId) {
    return {
      roomId: this.roomId,
      status: this.status,
      winner: this.winner,
      direction: this.direction,
      activeColor: this.activeColor,
      pendingDraw: this.pendingDraw,
      topCard: this.topCard(),
      drawPileCount: this.drawPile.length,
      currentPlayerId: this.currentPlayer().id,
      players: this.players.map((p) => ({
        id: p.id,
        cardCount: p.hand.length,
        calledUno: p.calledUno,
      })),
      yourHand: forPlayerId ? (this.players.find((p) => p.id === forPlayerId) || {}).hand || [] : [],
    };
  }
}

module.exports = { UnoGame, COLORS };
